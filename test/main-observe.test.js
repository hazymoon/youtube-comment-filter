import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import { COMMENTS_SELECTOR, WATCH_COMMENTS_SELECTOR } from '../src/selectors.js';

// 固定の印と所有者の代替判定は hidden 属性で決まる（dom.js の readIsPinned / readIsOwner）。印の要素が残ったまま
// hidden だけが付け外しされても判定し直せるよう、コメント欄の監視は hidden 属性の変化も受け取る

/**
 * 起動に必要な分だけの偽の要素。
 * @param {string} tag タグ名
 */
function fakeElement(tag) {
  const attrs = new Map();
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
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
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return element;
}

/**
 * ビルド結果を、コメント欄がある動画ページの偽の DOM で実行し、コメント欄の監視の設定と通知の受け口を返す。
 * @returns {{ observed: { target: any, options: any, callback: Function }[], comments: any, timers: Function[] }}
 */
function runWithComments() {
  const html = fakeElement('html');
  const comments = fakeElement('ytd-comments');
  comments.isConnected = true;
  const parent = fakeElement('div');
  parent.insertBefore = () => {};
  comments.parentNode = parent;
  const observed = [];
  const timers = [];
  const document = {
    documentElement: html,
    head: null,
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: fakeElement,
    getElementById: () => null,
    querySelector: (selector) =>
      selector === WATCH_COMMENTS_SELECTOR || selector === COMMENTS_SELECTOR ? comments : null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = {
    document,
    window: { addEventListener() {} },
    location: { href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' },
    console: { ...console, debug() {} },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target, options) {
        observed.push({ target, options, callback: this.callback });
      }
      disconnect() {}
    },
    performance,
    AbortSignal,
    AbortController,
    TextEncoder,
    URL,
    DOMException,
  };

  vm.runInNewContext(buildUserscript(), context);
  return { observed, comments, timers };
}

test('コメント欄の監視は hidden 属性の変化を受け取り、自分が書き換える data-ycf-* 属性は受け取らない', () => {
  const { observed, comments } = runWithComments();
  const watch = observed.find((entry) => entry.target === comments);
  assert.ok(watch, 'コメント欄を監視している');
  assert.equal(watch.options.attributes, true);
  assert.deepEqual([...watch.options.attributeFilter], ['hidden']);
  assert.equal(watch.options.childList, true);
  assert.equal(watch.options.subtree, true);
  assert.equal(watch.options.characterData, true);
});

test('hidden 属性の変化の通知を受けると、例外なくスキャンを予約する', () => {
  const { observed, comments, timers } = runWithComments();
  const watch = observed.find((entry) => entry.target === comments);
  // 起動時の attach が予約したスキャンを流してから、通知で新しく予約されるかを見る
  for (const fn of timers.splice(0)) fn();
  const badge = { nodeType: 1, closest: () => null, querySelectorAll: () => [] };
  watch.callback([{ type: 'attributes', attributeName: 'hidden', target: badge, addedNodes: [], removedNodes: [] }]);
  assert.equal(timers.length, 1, 'スキャンを 1 回予約する');
});
