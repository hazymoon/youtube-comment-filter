import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import { BAR_ID, SHORTS_COMMENTS_SELECTOR } from '../src/selectors.js';

// Shorts で次の動画へ移ると、YouTube は yt-navigate-finish の後でコメント欄の ytd-comments を作り直すことがある
// （実機で、作り直された ytd-comments の thread に data-ycf-state が無く、件数バーも DOM に無かった）。
// 遷移のイベントを待たずに、作り直されたコメント欄を監視し直し、件数バーを付け直す

/**
 * 起動に必要な分だけの偽の要素。
 * @param {string} tag タグ名
 */
function fakeElement(tag) {
  const attrs = new Map();
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    nextElementSibling: null,
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
    inserted: [],
    insertBefore(node, ref) {
      element.inserted.push(node);
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
 * 親の要素の中に置いた、接続済みの偽のコメント欄を作る。
 * @returns {any}
 */
function connectedComments() {
  const comments = fakeElement('ytd-comments');
  comments.isConnected = true;
  comments.parentNode = fakeElement('div');
  return comments;
}

/**
 * ビルド結果を Shorts のページの偽の DOM で実行する。querySelector が返すコメント欄は current で差し替えられる。
 */
function runOnShorts() {
  const html = fakeElement('html');
  const state = { current: connectedComments() };
  /** @type {{ target: any, options: any, callback: Function, active: boolean }[]} */
  const observed = [];
  const timers = [];
  const document = {
    documentElement: html,
    head: null,
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: fakeElement,
    getElementById: () => null,
    querySelector: (selector) => (selector === SHORTS_COMMENTS_SELECTOR ? state.current : null),
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
      observe(target, options) {
        const entry = { target, options, callback: this.callback, active: true };
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

  /** 監視中のすべての observer に DOM の変化を通知し、予約されたタイマーを流しきる */
  const notifyAll = () => {
    for (const entry of observed.filter((e) => e.active)) {
      entry.callback([{ type: 'childList', target: entry.target, addedNodes: [], removedNodes: [] }]);
    }
    for (let i = 0; i < 10 && timers.length > 0; i++) for (const fn of timers.splice(0)) fn();
  };

  return { state, observed, timers, notifyAll };
}

test('コメント欄の ytd-comments が作り直されたら、遷移のイベントが無くても新しい要素を監視し直す', () => {
  const { state, observed, timers, notifyAll } = runOnShorts();
  for (const fn of timers.splice(0)) fn();
  const old = state.current;
  assert.ok(
    observed.some((e) => e.active && e.target === old),
    '起動時のコメント欄を監視している',
  );

  // YouTube が古い ytd-comments を外し、新しい ytd-comments を置く
  old.isConnected = false;
  const fresh = connectedComments();
  state.current = fresh;
  notifyAll();

  assert.ok(
    observed.some((e) => e.active && e.target === fresh),
    '新しいコメント欄を監視する',
  );
  assert.ok(!observed.some((e) => e.active && e.target === old), '古いコメント欄の監視は外す');
});

test('コメント欄の ytd-comments が作り直されたら、件数バーを新しいコメント欄の直前に付け直す', () => {
  const { state, timers, notifyAll } = runOnShorts();
  for (const fn of timers.splice(0)) fn();

  state.current.isConnected = false;
  const fresh = connectedComments();
  state.current = fresh;
  notifyAll();

  const bar = fresh.parentNode.inserted.find((node) => node.id === BAR_ID);
  assert.ok(bar, '件数バーを新しいコメント欄の親に差し込む');
  assert.equal(bar.parentNode, fresh.parentNode);
  assert.equal(bar.nextElementSibling, fresh, '件数バーの直後の兄弟が新しいコメント欄になる');
  assert.equal(bar.hidden, false, '件数バーを見せる');
});
