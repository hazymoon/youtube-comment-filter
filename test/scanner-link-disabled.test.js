import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

// allowLinkDomains を指定していないときは、本文のリンクを読まない（使わない機能のために DOM を走査しない）。

/**
 * 偽の要素を作る。querySelectorAll を呼んだ回数を数える。
 * @param {object} [spec]
 */
function el({ tag = 'div', id = '', text = '', children = [], query = {}, data, polymerController } = {}) {
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
    queryAllCalls: 0,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    querySelector: (selector) => query[selector] ?? null,
    querySelectorAll: () => {
      node.queryAllCalls += 1;
      return [];
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 偽の thread を作る。本文の要素を content に付ける。
 */
function makeThread() {
  const content = el({ tag: 'yt-attributed-string', text: '本文' });
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: { [CONTENT_TEXT_SELECTOR]: content },
    data: { commentId: 'c1' },
    polymerController: { data: {}, __data: { commentEntity: { author: { channelId: null } } } },
  });
  const thread = el({
    tag: 'ytd-comment-thread-renderer',
    children: [el({ id: 'comment-container', children: [viewModel] })],
  });
  thread.content = content;
  return thread;
}

/**
 * 判定器を作る。
 * @param {object} rulesConfig compileRules に渡す設定
 */
function makeProcessor(rulesConfig) {
  return createThreadProcessor({
    rules: compileRules(rulesConfig),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'ready',
  });
}

test('allowLinkDomains を指定しなければ、本文のリンクを読まない', () => {
  const thread = makeThread();
  makeProcessor({}).processThreads([thread]);
  assert.equal(thread.content.queryAllCalls, 0);
});

test('allowLinkDomains を指定すれば、本文のリンクを読む', () => {
  const thread = makeThread();
  makeProcessor({ allowLinkDomains: [] }).processThreads([thread]);
  assert.equal(thread.content.queryAllCalls, 1);
});
