import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { CONTENT_LINK_SELECTOR, CONTENT_TEXT_SELECTOR, REASON_ATTR, STATE_ATTR } from '../src/selectors.js';

// スキャンで本文のリンクを読み、許可外のドメインへのリンクを含むコメントを NG ワードの扱いで隠す。

/**
 * 偽の要素を作る。querySelector / querySelectorAll は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 */
function el({
  tag = 'div',
  id = '',
  text = '',
  children = [],
  query = {},
  queryAll = {},
  data,
  polymerController,
} = {}) {
  const attrs = new Map();
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    textContent: text,
    data,
    polymerController,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    querySelector: (selector) => query[selector] ?? null,
    querySelectorAll: (selector) => queryAll[selector] ?? [],
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 本文にリンクを持つ偽の thread を作る。
 * @param {string[]} hrefs 本文のリンクの href
 * @param {object} [options]
 * @param {boolean} [options.isCreator] 投稿者が動画のチャンネル所有者か
 */
function makeThread(hrefs, { isCreator = false } = {}) {
  const links = hrefs.map((href) => {
    const a = el({ tag: 'a' });
    a.setAttribute('href', href);
    return a;
  });
  const content = el({
    tag: 'yt-attributed-string',
    text: '詳しくはこちら',
    queryAll: { [CONTENT_LINK_SELECTOR]: links },
  });
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: { [CONTENT_TEXT_SELECTOR]: content },
    data: { commentId: 'c1' },
    polymerController: { data: {}, __data: { commentEntity: { author: { channelId: null, isCreator } } } },
  });
  return el({
    tag: 'ytd-comment-thread-renderer',
    children: [el({ id: 'comment-container', children: [viewModel] })],
  });
}

/**
 * 判定器を作る。
 * @param {object} rulesConfig compileRules に渡す設定
 * @param {object} [exempt] 判定から外す対象
 */
function makeProcessor(rulesConfig, exempt) {
  return createThreadProcessor({
    rules: compileRules(rulesConfig),
    exempt,
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'ready',
  });
}

const EVIL = `/redirect?event=comments&redir_token=T&q=${encodeURIComponent('https://evil.example/')}`;

test('許可外のドメインへのリンクを含むコメントは NG ワードの理由で隠し、AI に送らない', () => {
  const processor = makeProcessor({ allowLinkDomains: ['example.com'] });
  const thread = makeThread(['/@alice', EVIL]);
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');
});

test('allowLinkDomains を指定しなければ、リンクでは隠さず AI の順番待ちに入れる', () => {
  const processor = makeProcessor({});
  const thread = makeThread([EVIL]);
  assert.deepEqual(processor.processThreads([thread]), [{ id: 'c1', text: '詳しくはこちら' }]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
});

test('判定から外すコメント（チャンネル所有者）はリンクでも隠さない', () => {
  const processor = makeProcessor({ allowLinkDomains: [] }, { owner: true, pinned: false, verified: false });
  const thread = makeThread([EVIL], { isCreator: true });
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});
