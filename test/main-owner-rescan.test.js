import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import {
  SHORTS_COMMENTS_SELECTOR,
  SHORTS_OWNER_HANDLE_SELECTOR,
  SHORTS_OWNER_NAME_SELECTOR,
  SHORTS_TAG,
  THREAD_TAG,
} from '../src/selectors.js';

// 動画の投稿者の要素はコメント欄の外にあり、コメント欄の監視には変化が届かない。Shorts では投稿者の要素が
// 遷移より遅れて変わるので（docs/dom-structure.md「動画の投稿者」）、document の変化で投稿者を読み直し、
// 変わっていたらスキャンして判定し直す

/**
 * 起動に必要な分だけの偽の要素。
 * @param {string} tag タグ名
 * @param {Record<string, string>} [initialAttrs] 属性
 */
function fakeElement(tag, initialAttrs = {}) {
  const attrs = new Map(Object.entries(initialAttrs));
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    nextElementSibling: null,
    textContent: '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: (name) => attrs.get(name) ?? null,
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    toggleAttribute(name, force) {
      const on = force ?? !attrs.has(name);
      if (on) attrs.set(name, '');
      else attrs.delete(name);
      return on;
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append: (...children) => element.children.push(...children),
    insertBefore(node, ref) {
      node.parentNode = element;
      node.nextElementSibling = ref;
      return node;
    },
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return element;
}

/**
 * ビルド結果を Shorts のページの偽の DOM で実行する。動画の投稿者は owner で差し替えられる。
 * スキャンの回数は、コメント欄の thread を数えた回数（scans）で見る。
 */
function runOnShorts() {
  const state = { owner: { href: '/@holo_dendoshi/shorts', name: 'ホロの伝道師' }, scans: 0 };
  const comments = fakeElement('ytd-comments');
  comments.isConnected = true;
  comments.parentNode = fakeElement('div');
  comments.querySelectorAll = (selector) => {
    if (selector === THREAD_TAG) state.scans += 1;
    return [];
  };
  const shorts = fakeElement(SHORTS_TAG);
  shorts.querySelector = (selector) => {
    if (selector === SHORTS_OWNER_HANDLE_SELECTOR) return fakeElement('a', { href: state.owner.href });
    if (selector === SHORTS_OWNER_NAME_SELECTOR)
      return { ...fakeElement('yt-formatted-string'), textContent: state.owner.name };
    return null;
  };
  const html = fakeElement('html');
  /** @type {{ target: any, callback: Function, active: boolean }[]} */
  const observed = [];
  const timers = [];
  const document = {
    documentElement: html,
    head: null,
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: fakeElement,
    getElementById: () => null,
    querySelector(selector) {
      if (selector === SHORTS_COMMENTS_SELECTOR) return comments;
      if (selector === SHORTS_TAG) return shorts;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = {
    document,
    window: { addEventListener() {} },
    location: { href: 'https://www.youtube.com/shorts/abc', pathname: '/shorts/abc' },
    console: { ...console, debug() {} },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.entries = [];
      }
      observe(target) {
        const entry = { target, callback: this.callback, active: true };
        this.entries.push(entry);
        observed.push(entry);
      }
      disconnect() {
        for (const entry of this.entries) entry.active = false;
      }
    },
    performance,
    AbortSignal,
    AbortController,
    TextEncoder,
    URL,
    DOMException,
  };

  vm.runInNewContext(buildUserscript(), context);

  const flush = () => {
    for (let i = 0; i < 10 && timers.length > 0; i++) for (const fn of timers.splice(0)) fn();
  };
  /** document の監視（コメント欄の外の変化）にだけ通知する */
  const notifyDocument = () => {
    for (const entry of observed.filter((e) => e.active && e.target === html)) {
      entry.callback([{ type: 'childList', target: html, addedNodes: [], removedNodes: [] }]);
    }
    flush();
  };
  return { state, flush, notifyDocument };
}

test('コメント欄の外で動画の投稿者が変わったら、スキャンして判定し直す', () => {
  const { state, flush, notifyDocument } = runOnShorts();
  flush();
  const before = state.scans;
  assert.ok(before > 0, '起動時にスキャンする');

  state.owner = { href: '/@Holo_0_0/shorts', name: 'ホロライブの雑学' };
  notifyDocument();
  assert.ok(state.scans > before, '投稿者が変わったのでスキャンする');
});

test('動画の投稿者が変わらなければ、document の変化ではスキャンしない', () => {
  const { state, flush, notifyDocument } = runOnShorts();
  flush();
  const before = state.scans;
  notifyDocument();
  assert.equal(state.scans, before);
});
