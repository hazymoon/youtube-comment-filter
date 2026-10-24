import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import { pickFocusTarget, restoreFocusAfterHide } from '../src/focus.js';
import {
  AUTHOR_LINK_SELECTOR,
  BLOCK_BUTTON_CLASS,
  COMMENTS_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  HEADER_AUTHOR_SELECTOR,
  STATE_ATTR,
  THREAD_TAG,
  WATCH_COMMENTS_SELECTOR,
} from '../src/selectors.js';

// NG 登録でスレッドが隠れた後、フォーカスを次の表示中のコメントへ移す（issue #23）

/**
 * フォーカスを受けたかを記録する偽の要素。
 * @param {string} name 見分けるための名前
 * @param {string[]} focused フォーカスを受けた要素の名前を足す配列
 */
function focusable(name, focused) {
  return { name, focus: () => focused.push(name) };
}

/**
 * 偽の thread を作る。投稿者のリンクは focus() を呼ばれると focused に名前を足す。
 * @param {string} name 見分けるための名前
 * @param {string|null} state 表示状態（data-ycf-state）
 * @param {string[]} focused フォーカスを受けた要素の名前を足す配列
 * @param {{ parent?: any, link?: boolean }} [options] parent は返信のときの親の thread
 */
function makeThread(name, state, focused, { parent = null, link = true } = {}) {
  const attrs = new Map();
  if (state !== null) attrs.set(STATE_ATTR, state);
  const author = link ? focusable(`${name}:author`, focused) : null;
  const viewModel = {
    id: 'comment',
    tagName: 'YTD-COMMENT-VIEW-MODEL',
    children: [],
    querySelector: (selector) => (selector === AUTHOR_LINK_SELECTOR ? author : null),
  };
  const container = { id: 'comment-container', tagName: 'DIV', children: [viewModel], parentElement: null };
  const repliesRenderer = parent ? { tagName: 'YTD-COMMENT-REPLIES-RENDERER', parentElement: parent } : null;
  const thread = {
    name,
    tagName: 'YTD-COMMENT-THREAD-RENDERER',
    children: [container],
    parentElement: repliesRenderer,
    isConnected: true,
    inner: [],
    getAttribute: (attr) => attrs.get(attr) ?? null,
    setAttribute: (attr, value) => attrs.set(attr, String(value)),
    contains(node) {
      return node === thread || node === author || thread.inner.includes(node);
    },
  };
  viewModel.parentElement = container;
  container.parentElement = thread;
  return thread;
}

const doc = { body: { name: 'body' }, documentElement: { name: 'html' } };

test('隠れた thread の後ろの、いちばん近い表示中のコメントの投稿者のリンクへ移す', () => {
  const focused = [];
  const a = makeThread('a', 'shown', focused);
  const blocked = makeThread('blocked', 'hidden', focused);
  const b = makeThread('b', 'shown', focused);
  const c = makeThread('c', 'shown', focused);
  const button = focusable('ng', focused);
  blocked.inner.push(button);
  const target = restoreFocusAfterHide({ threads: [a, blocked, b, c], thread: blocked, activeElement: button, doc });
  assert.equal(target?.name, 'b:author');
  assert.deepEqual(focused, ['b:author']);
});

test('フォーカスが body に落ちた後でも移す', () => {
  const focused = [];
  const blocked = makeThread('blocked', 'hidden', focused);
  const b = makeThread('b', 'shown', focused);
  assert.equal(pickFocusTarget({ threads: [blocked, b], thread: blocked, activeElement: doc.body, doc })?.name, 'b:author');
  assert.equal(pickFocusTarget({ threads: [blocked, b], thread: blocked, activeElement: null, doc })?.name, 'b:author');
});

test('隠れたもの・判定待ち・判定前・隠した thread の中の返信・投稿者のリンクの無いものは飛ばす', () => {
  const focused = [];
  const blocked = makeThread('blocked', 'hidden', focused);
  // 親ごと隠れた返信は、自分の表示状態が shown のままでも画面に出ていない
  const reply = makeThread('reply', 'shown', focused, { parent: blocked });
  const sameAuthor = makeThread('same', 'hidden', focused);
  const pending = makeThread('pending', 'pending', focused);
  const unjudged = makeThread('unjudged', null, focused);
  const noLink = makeThread('nolink', 'shown', focused, { link: false });
  const next = makeThread('next', 'shown', focused);
  const threads = [blocked, reply, sameAuthor, pending, unjudged, noLink, next];
  assert.equal(pickFocusTarget({ threads, thread: blocked, activeElement: doc.body, doc })?.name, 'next:author');
});

test('後ろに表示中のコメントが無ければ、前のいちばん近い表示中のコメントへ移す', () => {
  const focused = [];
  const first = makeThread('first', 'shown', focused);
  const near = makeThread('near', 'shown', focused);
  const blocked = makeThread('blocked', 'hidden', focused);
  const after = makeThread('after', 'hidden', focused);
  const threads = [first, near, blocked, after];
  assert.equal(pickFocusTarget({ threads, thread: blocked, activeElement: doc.body, doc })?.name, 'near:author');
});

test('表示中のコメントが 1 件も無ければ件数バーのボタンへ移す', () => {
  const focused = [];
  const blocked = makeThread('blocked', 'hidden', focused);
  const bar = focusable('bar', focused);
  restoreFocusAfterHide({ threads: [blocked], thread: blocked, activeElement: doc.body, doc, fallback: bar });
  assert.deepEqual(focused, ['bar']);
});

test('thread が DOM から外れて前後が分からないときは件数バーのボタンへ移す', () => {
  const focused = [];
  const blocked = makeThread('blocked', 'hidden', focused);
  blocked.isConnected = false;
  const other = makeThread('other', 'shown', focused);
  const bar = focusable('bar', focused);
  assert.equal(pickFocusTarget({ threads: [other], thread: blocked, activeElement: doc.body, doc, fallback: bar })?.name, 'bar');
});

test('thread が表示状態 shown のまま DOM から外れたときも件数バーのボタンへ移す', () => {
  const focused = [];
  const removed = makeThread('removed', 'shown', focused);
  removed.isConnected = false;
  const other = makeThread('other', 'shown', focused);
  const bar = focusable('bar', focused);
  assert.equal(pickFocusTarget({ threads: [other], thread: removed, activeElement: doc.body, doc, fallback: bar })?.name, 'bar');
});

test('thread がまだ表示中なら（ルールに当たらなかったなど）移さない', () => {
  const focused = [];
  const kept = makeThread('kept', 'shown', focused);
  const b = makeThread('b', 'shown', focused);
  const button = focusable('ng', focused);
  kept.inner.push(button);
  assert.equal(restoreFocusAfterHide({ threads: [kept, b], thread: kept, activeElement: button, doc }), null);
  assert.deepEqual(focused, []);
});

test('利用者がフォーカスを thread の外へ移していたら奪わない', () => {
  const focused = [];
  const blocked = makeThread('blocked', 'hidden', focused);
  const b = makeThread('b', 'shown', focused);
  const elsewhere = focusable('search', focused);
  assert.equal(restoreFocusAfterHide({ threads: [blocked, b], thread: blocked, activeElement: elsewhere, doc }), null);
  assert.deepEqual(focused, []);
});

/**
 * 起動とボタンの差し込みに必要な分だけの偽の要素。
 * @param {string} tag タグ名
 * @param {string[]} focused フォーカスを受けた要素の名前を足す配列
 */
function fakeElement(tag, focused) {
  const attrs = new Map();
  const classes = new Set();
  const listeners = {};
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    listeners,
    classList: { contains: (c) => classes.has(c) },
    set className(value) {
      classes.clear();
      for (const c of String(value).split(/\s+/)) if (c) classes.add(c);
    },
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
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    focus: () => focused.push(classes.has(BLOCK_BUTTON_CLASS) ? 'ng' : tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return element;
}

/**
 * ビルド結果の main で読める、投稿者を読める偽の thread（scanner.test.js と同じ形に #header-author を足したもの）。
 * @param {string} handle 投稿者のハンドル
 * @param {string[]} focused フォーカスを受けた要素の名前を足す配列
 */
function makeReadableThread(handle, focused) {
  const attrs = new Map();
  const author = { getAttribute: (name) => (name === 'href' ? `/${handle}` : null), focus: () => focused.push(`${handle}:author`) };
  const content = { textContent: '本文', querySelector: () => null };
  const header = {
    children: [],
    appendChild(child) {
      // onBlockClick が押されたボタンから thread をたどれるようにする
      child.closest = (selector) => (selector === THREAD_TAG ? thread : null);
      this.children.push(child);
    },
  };
  const viewModel = {
    id: 'comment',
    tagName: 'YTD-COMMENT-VIEW-MODEL',
    children: [],
    data: { commentId: `id-${handle}` },
    querySelector: (selector) =>
      ({ [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: author, [HEADER_AUTHOR_SELECTOR]: header })[selector] ?? null,
  };
  const container = { id: 'comment-container', tagName: 'DIV', children: [viewModel] };
  const thread = {
    tagName: 'YTD-COMMENT-THREAD-RENDERER',
    children: [container],
    parentElement: null,
    isConnected: true,
    header,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    contains: (node) => node === thread || header.children.includes(node) || node === author,
  };
  viewModel.parentElement = container;
  container.parentElement = thread;
  return thread;
}

test('main: NG 登録を確定した後のスキャンで、押したボタンの thread が隠れたらフォーカスを次の表示中のコメントへ移す', () => {
  const focused = [];
  const html = fakeElement('html', focused);
  const body = fakeElement('body', focused);
  const threads = [makeReadableThread('@alice', focused), makeReadableThread('@mallory', focused), makeReadableThread('@bob', focused)];
  const comments = fakeElement('ytd-comments', focused);
  comments.isConnected = true;
  comments.contains = (node) => threads.includes(node);
  comments.querySelectorAll = (selector) => (selector === THREAD_TAG ? threads : []);
  const parent = fakeElement('div', focused);
  parent.insertBefore = () => {};
  comments.parentNode = parent;
  const timers = [];
  const store = new Map();
  const document = {
    documentElement: html,
    body,
    activeElement: body,
    head: null,
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: (tag) => fakeElement(tag, focused),
    getElementById: () => null,
    querySelector: (selector) => (selector === WATCH_COMMENTS_SELECTOR || selector === COMMENTS_SELECTOR ? comments : null),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = {
    document,
    window: { addEventListener() {}, confirm: () => true, alert() {} },
    location: { href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' },
    console: { ...console, debug() {}, log() {} },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    GM_getValue: (key) => store.get(key),
    GM_setValue: (key, value) => store.set(key, value),
    performance,
    AbortSignal,
    AbortController,
    TextEncoder,
    URL,
    DOMException,
  };
  context.window.document = document;

  vm.runInNewContext(buildUserscript(), context);
  for (const fn of timers.splice(0)) fn();
  assert.deepEqual(
    threads.map((thread) => thread.getAttribute(STATE_ATTR)),
    ['shown', 'shown', 'shown'],
  );
  const button = threads[1].header.children.find((child) => child.classList.contains(BLOCK_BUTTON_CLASS));
  assert.ok(button, 'NG 登録のボタンを差し込んでいる');

  // ボタンにフォーカスがある状態で押し、確認で OK を選ぶ
  document.activeElement = button;
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(focused, [], 'スキャンの前には移さない');
  for (const fn of timers.splice(0)) fn();

  assert.equal(threads[1].getAttribute(STATE_ATTR), 'hidden');
  assert.deepEqual(focused, ['@bob:author']);
});
