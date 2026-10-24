import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import { findOwnExpanderContent } from '../src/dom.js';
import {
  AUTHOR_LINK_SELECTOR,
  COMMENTS_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  EXPANDED_ATTR,
  EXPANDER_SELECTOR,
  STATE_ATTR,
  WATCH_COMMENTS_SELECTOR,
} from '../src/selectors.js';
import { syncBodyControl } from '../src/ui.js';

// キーボードだけでも段階表示を読めるようにする（issue #24）。
// 表示中のコメントの本文の枠（ytd-expander#expander > #content）に Tab で止まれるようにし、
// Enter・Space で全文表示の固定を切り替える。マウスでのクリックの動きは変えない。

/**
 * 単純なセレクタ（タグ・#id・tag#id・[role="button"]）とそのカンマ区切りだけを判定する。
 * @param {any} el 要素
 * @param {string} selector セレクタ
 */
function matches(el, selector) {
  return selector.split(',').some((part) => {
    const s = part.trim();
    if (s === '[role="button"]') return el.getAttribute('role') === 'button';
    const m = /^([a-z][a-z0-9-]*)?(?:#([\w-]+))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return false;
    return (!m[1] || el.tagName.toLowerCase() === m[1]) && (!m[2] || el.id === m[2]);
  });
}

/**
 * 偽の要素。属性の書き込みを writes に記録する。
 * @param {string} tag タグ名
 * @param {string} [id] id
 */
function el(tag, id = '') {
  const attrs = new Map();
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    textContent: '',
    writes: [],
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute(name, value) {
      node.writes.push(name);
      attrs.set(name, String(value));
    },
    hasAttribute: (name) => attrs.has(name),
    removeAttribute(name) {
      if (attrs.has(name)) node.writes.push(name);
      attrs.delete(name);
    },
    toggleAttribute(name, force) {
      const on = force ?? !attrs.has(name);
      node.writes.push(name);
      if (on) attrs.set(name, '');
      else attrs.delete(name);
      return on;
    },
    append(...children) {
      for (const child of children) {
        child.parentElement = node;
        node.children.push(child);
      }
    },
    appendChild(child) {
      node.append(child);
      return child;
    },
    contains(other) {
      for (let x = other; x; x = x.parentElement) if (x === node) return true;
      return false;
    },
    closest(selector) {
      for (let x = node; x; x = x.parentElement) if (matches(x, selector)) return x;
      return null;
    },
    querySelectorAll(selector) {
      const found = [];
      const walk = (x) => {
        for (const child of x.children) {
          if (matches(child, selector)) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
    querySelector: (selector) => node.querySelectorAll(selector)[0] ?? null,
    addEventListener() {},
  };
  return node;
}

/**
 * 1 つのコメント（thread）を作る。本文の枠の中にリンクと文字列の要素を置く。
 * @param {string} handle 投稿者のハンドル
 */
function makeThread(handle) {
  const thread = el('ytd-comment-thread-renderer');
  const container = el('div', 'comment-container');
  const viewModel = el('ytd-comment-view-model', 'comment');
  viewModel.data = { commentId: `id-${handle}` };
  const author = el('a', 'author-text');
  author.setAttribute('href', `/${handle}`);
  const expander = el('ytd-expander', 'expander');
  const content = el('div', 'content');
  const text = el('yt-attributed-string', 'content-text');
  text.textContent = `${handle} の本文`;
  const span = el('span');
  const link = el('a');
  link.setAttribute('href', 'https://example.com/');
  text.append(span, link);
  content.append(text);
  expander.append(content);
  viewModel.append(author, expander);
  // 投稿者のリンクは入れ子のセレクタなので、偽の要素の querySelector では引けない。本文と投稿者だけ直接返す
  const generic = viewModel.querySelector;
  viewModel.querySelector = (selector) =>
    selector === AUTHOR_LINK_SELECTOR ? author : selector === CONTENT_TEXT_SELECTOR ? text : generic(selector);
  container.append(viewModel);
  thread.append(container);
  return { thread, content, span, link };
}

/**
 * ビルド結果を、コメント欄がある動画ページの偽の DOM で実行する。
 * @param {{ ngUsers?: string[] }} [options]
 */
function run({ ngUsers = [] } = {}) {
  const html = el('html');
  const comments = el('ytd-comments', 'comments');
  comments.isConnected = true;
  const parent = el('div');
  parent.insertBefore = () => {};
  comments.parentNode = parent;

  const parentThread = makeThread('@alice');
  const replies = el('div', 'replies');
  const reply = makeThread('@bob');
  replies.append(reply.thread);
  parentThread.thread.append(replies);
  const blocked = makeThread('@mallory');
  comments.append(parentThread.thread, blocked.thread);

  /** @type {Record<string, Function[]>} */
  const listeners = {};
  const timers = [];
  /** @type {Function[]} コメント欄の監視の通知の受け口 */
  const observers = [];
  const document = {
    documentElement: html,
    head: null,
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: (tag) => el(tag),
    getElementById: () => null,
    getSelection: () => ({ isCollapsed: true, toString: () => '' }),
    querySelector: (selector) => (selector === WATCH_COMMENTS_SELECTOR || selector === COMMENTS_SELECTOR ? comments : null),
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
  };
  const context = {
    document,
    window: { addEventListener() {}, alert() {}, confirm: () => false },
    location: { href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' },
    console: { ...console, debug() {}, warn() {} },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target) {
        if (target === comments) observers.push(this.callback);
      }
      disconnect() {}
    },
    GM_getValue: (key) => (key === 'ngUsers' ? ngUsers : []),
    GM_setValue() {},
    performance,
    AbortSignal,
    AbortController,
    TextEncoder,
    URL,
    DOMException,
  };
  vm.runInNewContext(buildUserscript(), context);

  /** 予約されたスキャンなどを流す */
  const flush = () => {
    for (let i = 0; i < 20 && timers.length > 0; i++) for (const fn of timers.splice(0)) fn();
  };
  flush();

  /**
   * イベントを document のリスナーに渡す。
   * @param {string} type 種類
   * @param {object} fields イベントの値
   */
  const fire = (type, fields) => {
    const event = {
      type,
      key: '',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
      ...fields,
    };
    for (const fn of listeners[type] ?? []) fn(event);
    return event;
  };
  /** コメント欄の変化を通知してスキャンを流す */
  const rescan = () => {
    for (const callback of observers) callback([{ type: 'childList', target: comments, addedNodes: [], removedNodes: [] }]);
    flush();
  };
  return { parentThread, reply, blocked, rescan, fire };
}

test('findOwnExpanderContent は thread 自身の本文の枠を返し、返信の本文の枠は返さない', () => {
  const parent = makeThread('@alice');
  const reply = makeThread('@bob');
  const replies = el('div', 'replies');
  replies.append(reply.thread);
  parent.thread.append(replies);
  assert.equal(findOwnExpanderContent(parent.thread), parent.content);
  assert.equal(findOwnExpanderContent(reply.thread), reply.content);
  assert.equal(findOwnExpanderContent(el('ytd-comment-thread-renderer')), null);
  assert.equal(findOwnExpanderContent(null), null);
});

test('syncBodyControl は Tab で止まれるボタンにし、正しい属性は書き直さない。外すときは取り除く', () => {
  const body = el('div', 'content');
  syncBodyControl(body, true, false);
  assert.equal(body.getAttribute('tabindex'), '0');
  assert.equal(body.getAttribute('role'), 'button');
  assert.equal(body.getAttribute('aria-expanded'), 'false');
  const writes = body.writes.length;
  syncBodyControl(body, true, false);
  assert.equal(body.writes.length, writes, '同じ状態なら書き込まない');

  syncBodyControl(body, true, true);
  assert.equal(body.getAttribute('aria-expanded'), 'true');

  syncBodyControl(body, false, false);
  for (const name of ['tabindex', 'role', 'aria-expanded']) assert.equal(body.hasAttribute(name), false, name);
  const removed = body.writes.length;
  syncBodyControl(body, false, false);
  assert.equal(body.writes.length, removed, '外した後は書き込まない');
  syncBodyControl(null, true, false);
});

test('スキャンで表示中のコメントの本文の枠を Tab で止まれるボタンにし、隠したコメントにはしない', () => {
  const { parentThread, reply, blocked, rescan } = run({ ngUsers: ['@mallory'] });
  assert.equal(parentThread.thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(blocked.thread.getAttribute(STATE_ATTR), 'hidden');
  for (const { content } of [parentThread, reply]) {
    assert.equal(content.getAttribute('tabindex'), '0');
    assert.equal(content.getAttribute('role'), 'button');
    assert.equal(content.getAttribute('aria-expanded'), 'false');
  }
  assert.equal(blocked.content.hasAttribute('tabindex'), false, '隠したコメントの本文には止まらない');
  assert.equal(blocked.content.hasAttribute('role'), false);

  const writes = parentThread.content.writes.length;
  rescan();
  assert.equal(parentThread.content.writes.length, writes, 'スキャンし直しても属性を書き直さない');
});

test('本文の枠で Enter・Space を押すと全文表示の固定を切り替え、aria-expanded も合わせる', () => {
  const { parentThread, fire } = run();
  const enter = fire('keydown', { key: 'Enter', target: parentThread.content });
  assert.equal(parentThread.thread.hasAttribute(EXPANDED_ATTR), true);
  assert.equal(parentThread.content.getAttribute('aria-expanded'), 'true');
  assert.equal(enter.defaultPrevented, true);

  const space = fire('keydown', { key: ' ', target: parentThread.content });
  assert.equal(parentThread.thread.hasAttribute(EXPANDED_ATTR), false);
  assert.equal(parentThread.content.getAttribute('aria-expanded'), 'false');
  assert.equal(space.defaultPrevented, true, 'ページのスクロールと YouTube の再生・一時停止に渡さない');
  assert.equal(space.propagationStopped, true, 'YouTube のキーボードショートカットに渡さない');
});

test('修飾キー付き・押しっぱなしの繰り返し・ほかのキー・本文の中のリンクからのキーでは切り替えない', () => {
  const { parentThread, fire } = run();
  const cases = [
    { key: 'Enter', ctrlKey: true },
    { key: 'Enter', metaKey: true },
    { key: ' ', altKey: true },
    { key: ' ', shiftKey: true },
    { key: 'Enter', repeat: true },
    { key: 'Enter', isComposing: true },
    { key: 'a' },
    { key: 'Enter', target: parentThread.link },
  ];
  for (const fields of cases) {
    const event = fire('keydown', { target: parentThread.content, ...fields });
    assert.equal(parentThread.thread.hasAttribute(EXPANDED_ATTR), false, JSON.stringify({ ...fields, target: undefined }));
    assert.equal(event.defaultPrevented, false, 'ページの既定の動きを止めない');
  }
});

test('返信の本文の枠で Enter を押しても、親のコメントは切り替えない', () => {
  const { parentThread, reply, fire } = run();
  fire('keydown', { key: 'Enter', target: reply.content });
  assert.equal(reply.thread.hasAttribute(EXPANDED_ATTR), true);
  assert.equal(parentThread.thread.hasAttribute(EXPANDED_ATTR), false);
});

test('隠したコメントの本文の枠では Enter を押しても切り替えない', () => {
  const { blocked, fire } = run({ ngUsers: ['@mallory'] });
  const event = fire('keydown', { key: 'Enter', target: blocked.content });
  assert.equal(blocked.thread.hasAttribute(EXPANDED_ATTR), false);
  assert.equal(event.defaultPrevented, false);
});

test('本文の枠をボタンにしても、マウスで本文をクリックすると切り替わり、本文の中のリンクのクリックでは切り替わらない', () => {
  const { parentThread, fire } = run();
  assert.equal(parentThread.content.getAttribute('role'), 'button');
  fire('click', { target: parentThread.span });
  assert.equal(parentThread.thread.hasAttribute(EXPANDED_ATTR), true, '本文のクリックで全文に固定する');
  assert.equal(parentThread.content.getAttribute('aria-expanded'), 'true');
  fire('click', { target: parentThread.link });
  assert.equal(parentThread.thread.hasAttribute(EXPANDED_ATTR), true, 'リンクのクリックでは切り替えない');
});

test('EXPANDER_SELECTOR は偽の要素の判定でも ytd-expander#expander に当たる', () => {
  // 偽の要素のセレクタ判定が、ここで使う定数を解釈できていることの確認
  assert.equal(matches(el('ytd-expander', 'expander'), EXPANDER_SELECTOR), true);
});
