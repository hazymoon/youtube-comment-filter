import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import { restoreFocusAfterHide } from '../src/focus.js';
import {
  AUTHOR_LINK_SELECTOR,
  BLOCK_BUTTON_CLASS,
  COMMENTS_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  HEADER_AUTHOR_SELECTOR,
  NAVIGATE_FINISH_EVENT,
  OWNER_BADGE_LINK_SELECTOR,
  STATE_ATTR,
  THREAD_TAG,
  WATCH_COMMENTS_SELECTOR,
} from '../src/selectors.js';

// NG 登録で thread が隠れた後のフォーカスの移し先を、候補の順に試す（issue #23）。
// 所有者・認証済みのチャンネルのコメントでは a#author-text に hidden が付き、名前のリンクはバッジの a#name になる
// （docs/dom-structure.md「ytd-comment-view-model#comment の中」）。

/**
 * 実際のブラウザに合わせた偽の document。focus() を受けた要素が隠れていなければ activeElement を移す。
 */
function makeDoc() {
  return { body: { name: 'body' }, documentElement: { name: 'html' }, activeElement: null };
}

/**
 * 偽の要素。自身か祖先に hidden 属性があれば、focus() を呼ばれてもフォーカスは移らない（実際のブラウザと同じ）。
 * @param {string} name 見分けるための名前
 * @param {any} doc makeDoc の document
 * @param {any[]} calls focus() の呼び出し（[名前, オプション]）を足す配列
 * @param {{ hidden?: boolean, parent?: any, focusable?: boolean }} [options]
 *   focusable: false は、hidden 属性は無いが描画されていないなどでフォーカスを受けない要素
 */
function makeElement(name, doc, calls, { hidden = false, parent = null, focusable = true } = {}) {
  const attrs = new Map();
  if (hidden) attrs.set('hidden', '');
  const element = {
    name,
    parentElement: parent,
    hasAttribute: (attr) => attrs.has(attr),
    focus(options) {
      calls.push([name, options]);
      if (!focusable) return;
      for (let node = element; node; node = node.parentElement ?? null) {
        if (node.hasAttribute?.('hidden')) return;
      }
      doc.activeElement = element;
    },
  };
  return element;
}

/**
 * 偽の thread を作る。links は本体の中のリンクを文書順に並べたもの。
 * @param {string} name 見分けるための名前
 * @param {string} state 表示状態（data-ycf-state）
 * @param {(viewModel: any) => { author?: any, badge?: any, links: any[] }} build 本体を親にしてリンクを作る
 */
function makeThread(name, state, build = () => ({ links: [] })) {
  const attrs = new Map([[STATE_ATTR, state]]);
  const viewModel = { id: 'comment', tagName: 'YTD-COMMENT-VIEW-MODEL', children: [], hasAttribute: () => false };
  const { author = null, badge = null, links } = build(viewModel);
  viewModel.querySelector = (selector) =>
    ({ [AUTHOR_LINK_SELECTOR]: author, [OWNER_BADGE_LINK_SELECTOR]: badge, 'a[href]': links[0] ?? null })[selector] ?? null;
  viewModel.querySelectorAll = (selector) => (selector === 'a[href]' ? links : []);
  const container = { id: 'comment-container', tagName: 'DIV', children: [viewModel] };
  const thread = {
    name,
    tagName: 'YTD-COMMENT-THREAD-RENDERER',
    children: [container],
    parentElement: null,
    isConnected: true,
    inner: [],
    getAttribute: (attr) => attrs.get(attr) ?? null,
    contains: (node) => node === thread || thread.inner.includes(node) || links.includes(node),
  };
  viewModel.parentElement = container;
  container.parentElement = thread;
  return thread;
}

/** 通常のコメント。投稿者のリンク a#author-text と、投稿日時のリンクがある */
function normalThread(name, state, doc, calls) {
  return makeThread(name, state, (viewModel) => {
    const author = makeElement(`${name}:author`, doc, calls, { parent: viewModel });
    const time = makeElement(`${name}:time`, doc, calls, { parent: viewModel });
    return { author, links: [author, time] };
  });
}

/** 所有者・認証済みのチャンネルのコメント。a#author-text は hidden で、バッジの a#name が名前のリンク */
function ownerThread(name, state, doc, calls) {
  return makeThread(name, state, (viewModel) => {
    const author = makeElement(`${name}:author`, doc, calls, { parent: viewModel, hidden: true });
    const badge = makeElement(`${name}:name`, doc, calls, { parent: viewModel });
    const time = makeElement(`${name}:time`, doc, calls, { parent: viewModel });
    // 文書順では隠れた a#author-text が先に来るので、a[href] の最初のものも隠れたリンクになる
    return { author, badge, links: [author, badge, time] };
  });
}

/** NG 登録のボタンが押されて隠れた thread。ボタンにフォーカスがある */
function blockedThread(doc, calls) {
  const thread = makeThread('blocked', 'hidden');
  const button = makeElement('ng', doc, calls);
  thread.inner.push(button);
  doc.activeElement = button;
  return thread;
}

test('後ろが所有者・認証済みのコメントなら、隠れた a#author-text ではなくバッジの a#name へ移す', () => {
  const doc = makeDoc();
  const calls = [];
  const blocked = blockedThread(doc, calls);
  const owner = ownerThread('owner', 'shown', doc, calls);
  const after = normalThread('after', 'shown', doc, calls);
  const target = restoreFocusAfterHide({ threads: [blocked, owner, after], thread: blocked, activeElement: doc.activeElement, doc });
  assert.equal(doc.activeElement?.name, 'owner:name');
  assert.equal(target?.name, 'owner:name');
});

test('祖先に hidden がある投稿者のリンクも隠れているとみなして飛ばす', () => {
  const doc = makeDoc();
  const calls = [];
  const blocked = blockedThread(doc, calls);
  const next = makeThread('next', 'shown', (viewModel) => {
    const h3 = makeElement('next:h3', doc, calls, { parent: viewModel, hidden: true });
    const author = makeElement('next:author', doc, calls, { parent: h3 });
    const time = makeElement('next:time', doc, calls, { parent: viewModel });
    return { author, links: [author, time] };
  });
  restoreFocusAfterHide({ threads: [blocked, next], thread: blocked, activeElement: doc.activeElement, doc });
  assert.equal(doc.activeElement?.name, 'next:time');
  assert.ok(!calls.some(([name]) => name === 'next:author'), '隠れたリンクの focus() は呼ばない');
});

test('投稿者のリンクもバッジも無ければ、本体の中の最初の a[href] へ移す', () => {
  const doc = makeDoc();
  const calls = [];
  const blocked = blockedThread(doc, calls);
  const next = makeThread('next', 'shown', (viewModel) => ({ links: [makeElement('next:time', doc, calls, { parent: viewModel })] }));
  const target = restoreFocusAfterHide({ threads: [blocked, next], thread: blocked, activeElement: doc.activeElement, doc });
  assert.equal(target?.name, 'next:time');
  assert.equal(doc.activeElement?.name, 'next:time');
});

test('focus() でフォーカスが移らなければ、同じコメントの次の候補、次のコメントの順に試す', () => {
  const doc = makeDoc();
  const calls = [];
  const blocked = blockedThread(doc, calls);
  // hidden 属性は無いが描画されていないなどで、focus() を呼んでも移らないリンクだけのコメント
  const broken = makeThread('broken', 'shown', (viewModel) => {
    const author = makeElement('broken:author', doc, calls, { parent: viewModel, focusable: false });
    const time = makeElement('broken:time', doc, calls, { parent: viewModel, focusable: false });
    return { author, links: [author, time] };
  });
  const allHidden = makeThread('allhidden', 'shown', (viewModel) => {
    const author = makeElement('allhidden:author', doc, calls, { parent: viewModel, hidden: true });
    return { author, links: [author] };
  });
  const next = normalThread('next', 'shown', doc, calls);
  const target = restoreFocusAfterHide({ threads: [blocked, broken, allHidden, next], thread: blocked, activeElement: doc.activeElement, doc });
  assert.equal(target?.name, 'next:author');
  assert.equal(doc.activeElement?.name, 'next:author');
  assert.deepEqual(
    calls.map(([name]) => name),
    ['broken:author', 'broken:time', 'next:author'],
  );
});

test('後ろのコメントでどれも移せなければ、前のコメント、件数バーのボタンの順に試す', () => {
  const doc = makeDoc();
  const calls = [];
  const before = ownerThread('before', 'shown', doc, calls);
  const blocked = blockedThread(doc, calls);
  const afterHiddenOnly = makeThread('after', 'shown', (viewModel) => {
    const author = makeElement('after:author', doc, calls, { parent: viewModel, hidden: true });
    return { author, links: [author] };
  });
  const bar = makeElement('bar', doc, calls);
  restoreFocusAfterHide({ threads: [before, blocked, afterHiddenOnly], thread: blocked, activeElement: doc.activeElement, doc, fallback: bar });
  assert.equal(doc.activeElement?.name, 'before:name');

  const doc2 = makeDoc();
  const calls2 = [];
  const blocked2 = blockedThread(doc2, calls2);
  const ownerOnlyHidden = makeThread('x', 'shown', (viewModel) => {
    const author = makeElement('x:author', doc2, calls2, { parent: viewModel, hidden: true });
    return { author, links: [author] };
  });
  const bar2 = makeElement('bar', doc2, calls2);
  const target = restoreFocusAfterHide({ threads: [ownerOnlyHidden, blocked2], thread: blocked2, activeElement: doc2.activeElement, doc: doc2, fallback: bar2 });
  assert.equal(target?.name, 'bar');
  assert.equal(doc2.activeElement?.name, 'bar');
});

test('どの候補にも移せなければ null を返す', () => {
  const doc = makeDoc();
  const calls = [];
  const blocked = blockedThread(doc, calls);
  const bar = makeElement('bar', doc, calls, { focusable: false });
  assert.equal(restoreFocusAfterHide({ threads: [blocked], thread: blocked, activeElement: doc.activeElement, doc, fallback: bar }), null);
});

test('前のコメントと件数バーのボタンへはスクロールさせずに移し、後ろのコメントへは既定のスクロールで移す', () => {
  const doc = makeDoc();
  const calls = [];
  const blocked = blockedThread(doc, calls);
  const next = normalThread('next', 'shown', doc, calls);
  restoreFocusAfterHide({ threads: [blocked, next], thread: blocked, activeElement: doc.activeElement, doc });
  assert.equal(calls.at(-1)?.[0], 'next:author');
  assert.ok(!calls.at(-1)?.[1]?.preventScroll, '後ろのコメントへは、画面の外ならスクロールして見せる');

  const prevDoc = makeDoc();
  const prevCalls = [];
  const prev = normalThread('prev', 'shown', prevDoc, prevCalls);
  const blockedLast = blockedThread(prevDoc, prevCalls);
  restoreFocusAfterHide({ threads: [prev, blockedLast], thread: blockedLast, activeElement: prevDoc.activeElement, doc: prevDoc });
  assert.equal(prevCalls.at(-1)?.[0], 'prev:author');
  assert.equal(prevCalls.at(-1)?.[1]?.preventScroll, true);

  const barDoc = makeDoc();
  const barCalls = [];
  const only = blockedThread(barDoc, barCalls);
  const bar = makeElement('bar', barDoc, barCalls);
  restoreFocusAfterHide({ threads: [only], thread: only, activeElement: barDoc.activeElement, doc: barDoc, fallback: bar });
  assert.equal(barCalls.at(-1)?.[0], 'bar');
  assert.equal(barCalls.at(-1)?.[1]?.preventScroll, true);
});

/**
 * 起動とボタンの差し込みに必要な分だけの偽の要素（focus-after-block.test.js と同じ形）。
 * @param {string} tag タグ名
 * @param {{ document?: any }} holder focus() で activeElement を移す document の入れ物
 */
function fakeElement(tag, holder) {
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
    focus() {
      holder.focused.push(classes.has(BLOCK_BUTTON_CLASS) ? 'ng' : tag);
      holder.document.activeElement = element;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return element;
}

/**
 * ビルド結果の main で読める、投稿者を読める偽の thread（focus-after-block.test.js と同じ形）。
 * @param {string} handle 投稿者のハンドル
 * @param {{ document?: any, focused: string[] }} holder
 */
function makeReadableThread(handle, holder) {
  const attrs = new Map();
  const author = {
    getAttribute: (name) => (name === 'href' ? `/${handle}` : null),
    focus() {
      holder.focused.push(`${handle}:author`);
      holder.document.activeElement = author;
    },
  };
  const content = { textContent: '本文', querySelector: () => null };
  const header = {
    children: [],
    appendChild(child) {
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

/**
 * ビルド結果を偽の document の上で起動し、@mallory の NG 登録のボタンにフォーカスがある状態まで進める。
 * スキャンはまだ走らせない（timers に残る）。
 */
function startAndClickBlock() {
  const holder = { focused: [], document: null };
  const docListeners = {};
  const html = fakeElement('html', holder);
  const body = fakeElement('body', holder);
  const threads = [makeReadableThread('@alice', holder), makeReadableThread('@mallory', holder), makeReadableThread('@bob', holder)];
  const comments = fakeElement('ytd-comments', holder);
  comments.isConnected = true;
  comments.contains = (node) => threads.includes(node);
  comments.querySelectorAll = (selector) => (selector === THREAD_TAG ? threads : []);
  const parent = fakeElement('div', holder);
  parent.insertBefore = () => {};
  comments.parentNode = parent;
  const timers = [];
  const store = new Map();
  const location = { href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' };
  const document = {
    documentElement: html,
    body,
    activeElement: body,
    head: null,
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: (tag) => fakeElement(tag, holder),
    getElementById: () => null,
    querySelector: (selector) => (selector === WATCH_COMMENTS_SELECTOR || selector === COMMENTS_SELECTOR ? comments : null),
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      docListeners[type] = fn;
    },
  };
  holder.document = document;
  const context = {
    document,
    window: { addEventListener() {}, confirm: () => true, alert() {} },
    location,
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
  const button = threads[1].header.children.find((child) => child.classList.contains(BLOCK_BUTTON_CLASS));
  assert.ok(button, 'NG 登録のボタンを差し込んでいる');
  document.activeElement = button;
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  return { holder, threads, timers, location, document, docListeners, button };
}

test('main: 対照として、そのままスキャンすれば押したボタンの thread が隠れてフォーカスを移す', () => {
  const { holder, threads, timers } = startAndClickBlock();
  for (const fn of timers.splice(0)) fn();
  assert.equal(threads[1].getAttribute(STATE_ATTR), 'hidden');
  assert.deepEqual(holder.focused, ['@bob:author']);
});

test('main: スキャンの前にコメント欄のあるページを離れたら、戻ってきた後のスキャンでフォーカスを移さない', () => {
  const { holder, threads, timers, location, document, docListeners, button } = startAndClickBlock();
  // 動画ページ以外へ移った状態でスキャンが走る
  location.href = 'https://www.youtube.com/';
  location.pathname = '/';
  for (const fn of timers.splice(0)) fn();
  assert.deepEqual(holder.focused, []);
  // 同じ動画へ戻り、フォーカスはまだ隠れた thread の中に残っている
  location.href = 'https://www.youtube.com/watch?v=abc';
  location.pathname = '/watch';
  document.activeElement = button;
  docListeners[NAVIGATE_FINISH_EVENT]();
  for (const fn of timers.splice(0)) fn();
  assert.equal(threads[1].getAttribute(STATE_ATTR), 'hidden', '戻った後のスキャンでも thread は隠れている');
  assert.deepEqual(holder.focused, []);
});

test('main: スキャンの前に別の動画へ移ったら、その後のスキャンでフォーカスを移さない', () => {
  const { holder, threads, timers, location, document, docListeners, button } = startAndClickBlock();
  location.href = 'https://www.youtube.com/watch?v=xyz';
  document.activeElement = button;
  docListeners[NAVIGATE_FINISH_EVENT]();
  for (const fn of timers.splice(0)) fn();
  assert.equal(threads[1].getAttribute(STATE_ATTR), 'hidden', '移った後のスキャンでも thread は隠れている');
  assert.deepEqual(holder.focused, []);
});
