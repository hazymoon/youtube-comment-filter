import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import * as config from '../src/config.js';
import { parseStoredOptions } from '../src/settings.js';
import {
  SHORTS_COMMENTS_SELECTOR,
  SHORTS_OWNER_HANDLE_SELECTOR,
  SHORTS_OWNER_NAME_SELECTOR,
  SHORTS_TAG,
  THREAD_TAG,
} from '../src/selectors.js';

// なりすましの判定は「値」の detectImpersonation で切れる。よくある名前の投稿者の動画で無関係なコメントが隠れるとき、
// 判定ごと止められるようにするため。切ったときは動画の投稿者も読まない

test('detectImpersonation の既定値は true で、書かなければ既定値を使う', () => {
  assert.equal(config.DETECT_IMPERSONATION, true);
  const result = parseStoredOptions(() => undefined);
  assert.equal(result.options.detectImpersonation, true);
  assert.deepEqual(result.warnings, []);
});

test('detectImpersonation に false を書くとそのまま使う', () => {
  const result = parseStoredOptions((key) => (key === 'detectImpersonation' ? false : undefined));
  assert.equal(result.options.detectImpersonation, false);
  assert.deepEqual(result.warnings, []);
});

test('detectImpersonation に真偽値以外を書くと既定値に戻して警告する', () => {
  for (const value of ['false', 0, 1, [], {}]) {
    const result = parseStoredOptions((key) => (key === 'detectImpersonation' ? value : undefined));
    assert.equal(result.options.detectImpersonation, true, JSON.stringify(value));
    assert.equal(result.warnings.length, 1, JSON.stringify(value));
    assert.match(result.warnings[0], /detectImpersonation/);
  }
});

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
 * ビルド結果を Shorts のページの偽の DOM で実行する。「値」は stored で渡す。
 * 動画の投稿者を読んだ回数（ownerReads）とスキャンの回数（scans）を数える。
 * @param {Record<string, unknown>} stored 「値」タブの値
 */
function runOnShorts(stored) {
  const state = { owner: { href: '/@holo_dendoshi/shorts', name: 'ホロの伝道師' }, scans: 0, ownerReads: 0 };
  const comments = fakeElement('ytd-comments');
  comments.isConnected = true;
  comments.parentNode = fakeElement('div');
  comments.querySelectorAll = (selector) => {
    if (selector === THREAD_TAG) state.scans += 1;
    return [];
  };
  const shorts = fakeElement(SHORTS_TAG);
  shorts.querySelector = (selector) => {
    if (selector === SHORTS_OWNER_HANDLE_SELECTOR) {
      state.ownerReads += 1;
      return fakeElement('a', { href: state.owner.href });
    }
    if (selector === SHORTS_OWNER_NAME_SELECTOR) {
      return { ...fakeElement('yt-formatted-string'), textContent: state.owner.name };
    }
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
    console: { ...console, debug() {}, warn() {} },
    GM_getValue: (key) => stored[key],
    GM_setValue() {},
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

test('既定では、スキャンで動画の投稿者を読み、投稿者が変わったらスキャンする', () => {
  const { state, flush, notifyDocument } = runOnShorts({});
  flush();
  assert.ok(state.ownerReads > 0, '動画の投稿者を読む');
  const before = state.scans;
  state.owner = { href: '/@Holo_0_0/shorts', name: 'ホロライブの雑学' };
  notifyDocument();
  assert.ok(state.scans > before, '投稿者が変わったのでスキャンする');
});

test('detectImpersonation が false なら、動画の投稿者を読まず、投稿者の変化でスキャンもしない', () => {
  const { state, flush, notifyDocument } = runOnShorts({ detectImpersonation: false });
  flush();
  const before = state.scans;
  assert.ok(before > 0, '起動時にスキャンはする');
  state.owner = { href: '/@Holo_0_0/shorts', name: 'ホロライブの雑学' };
  notifyDocument();
  assert.equal(state.ownerReads, 0, '動画の投稿者を読まない');
  assert.equal(state.scans, before, '投稿者の変化ではスキャンしない');
});
