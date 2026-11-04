import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildUserscript } from '../scripts/build.mjs';
import {
  AUTHOR_LINK_SELECTOR,
  COMMENTS_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  WATCH_COMMENTS_SELECTOR,
} from '../src/selectors.js';

// マウスを離した時点までに見せた量を、離した後も保つ。CSS が見せる量を保つのは印（data-ycf-held）のある
// コメントだけなので、マウスが乗った・フォーカスが入った表示中のコメントに印を付ける。
// 離れる前から印があるよう、入った時点で付ける。別のコメントに入れ替わったら、前のコメントで見せた量が
// 漏れないよう印を外す。偽の DOM は keyboard-preview.test.js と同じ作り。

const HELD_ATTR = 'data-ycf-held';

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
    querySelector: (selector) =>
      selector === WATCH_COMMENTS_SELECTOR || selector === COMMENTS_SELECTOR ? comments : null,
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
    for (const callback of observers)
      callback([{ type: 'childList', target: comments, addedNodes: [], removedNodes: [] }]);
    flush();
  };
  return { parentThread, reply, blocked, rescan, fire };
}

test('表示中のコメントにマウスが乗ったら印を付け、返信には付けない', () => {
  const { parentThread, reply, fire } = run();
  fire('pointerover', { target: parentThread.span });
  assert.equal(parentThread.thread.hasAttribute(HELD_ATTR), true);
  assert.equal(reply.thread.hasAttribute(HELD_ATTR), false);
});

test('返信にマウスが乗ったら返信だけに印を付け、親には付けない', () => {
  const { parentThread, reply, fire } = run();
  fire('pointerover', { target: reply.span });
  assert.equal(reply.thread.hasAttribute(HELD_ATTR), true);
  assert.equal(parentThread.thread.hasAttribute(HELD_ATTR), false);
});

test('キーボードで本文の枠にフォーカスが入ったときも印を付ける', () => {
  const { parentThread, fire } = run();
  fire('focusin', { target: parentThread.content });
  assert.equal(parentThread.thread.hasAttribute(HELD_ATTR), true);
});

test('隠したコメントには印を付けない', () => {
  const { blocked, fire } = run({ ngUsers: ['@mallory'] });
  fire('pointerover', { target: blocked.span });
  assert.equal(blocked.thread.hasAttribute(HELD_ATTR), false);
});

test('印の付いたコメントに乗り直しても書き直さない', () => {
  const { parentThread, fire } = run();
  fire('pointerover', { target: parentThread.span });
  const writes = parentThread.thread.writes.length;
  fire('pointerover', { target: parentThread.link });
  assert.equal(parentThread.thread.writes.length, writes);
});

test('thread が別のコメントに入れ替わったら印を外し、前のコメントで見せた量を引き継がない', () => {
  const { parentThread, rescan, fire } = run();
  fire('pointerover', { target: parentThread.span });
  const viewModel = parentThread.thread.children[0].children[0];
  viewModel.data = { commentId: 'id-other' };
  rescan();
  assert.equal(parentThread.thread.hasAttribute(HELD_ATTR), false);
});
