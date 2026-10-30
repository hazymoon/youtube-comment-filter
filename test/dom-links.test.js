import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinkHrefs } from '../src/dom.js';
import { CONTENT_LINK_SELECTOR, CONTENT_TEXT_FALLBACK_SELECTOR, CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

/**
 * 偽の要素を作る。querySelector / querySelectorAll は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 * @param {string} [spec.tag] タグ名
 * @param {string} [spec.id] id
 * @param {Record<string, string>} [spec.attrs] 属性
 * @param {object[]} [spec.children] 子要素
 * @param {Record<string, object>} [spec.query] querySelector の結果
 * @param {Record<string, object[]>} [spec.queryAll] querySelectorAll の結果。null なら querySelectorAll を持たない
 */
function el({ tag = 'div', id = '', attrs = {}, children = [], query = {}, queryAll = {} } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    querySelector: (selector) => query[selector] ?? null,
  };
  if (queryAll !== null) node.querySelectorAll = (selector) => queryAll[selector] ?? [];
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 本文の要素を持つ偽の thread を作る。
 * @param {object} contentEl 本文の要素
 * @param {string} [selector] 本文の要素を返すセレクタ
 */
function makeThread(contentEl, selector = CONTENT_TEXT_SELECTOR) {
  const viewModel = el({ tag: 'ytd-comment-view-model', id: 'comment', query: { [selector]: contentEl } });
  return el({
    tag: 'ytd-comment-thread-renderer',
    children: [el({ id: 'comment-container', children: [viewModel] })],
  });
}

/**
 * 偽のリンクを作る。
 * @param {string|null} href href。null なら属性を持たない
 */
function link(href) {
  return el({ tag: 'a', attrs: href === null ? {} : { href } });
}

test('本文の中のリンクの href を文書順に返す', () => {
  const content = el({
    tag: 'yt-attributed-string',
    queryAll: {
      [CONTENT_LINK_SELECTOR]: [
        link('/channel/UCabcdefghijklmnopqrstuv'),
        link('/redirect?event=comments&q=https%3A%2F%2Fexample.com%2F'),
        link('/watch?v=abcdefghijk&t=10s'),
      ],
    },
  });
  assert.deepEqual(extractLinkHrefs(makeThread(content)), [
    '/channel/UCabcdefghijklmnopqrstuv',
    '/redirect?event=comments&q=https%3A%2F%2Fexample.com%2F',
    '/watch?v=abcdefghijk&t=10s',
  ]);
});

test('href が空か無いリンクは返さない', () => {
  const content = el({ queryAll: { [CONTENT_LINK_SELECTOR]: [link(''), link(null), link('/@alice')] } });
  assert.deepEqual(extractLinkHrefs(makeThread(content)), ['/@alice']);
});

test('#content-text が無ければ代わりの本文の要素から読む', () => {
  const content = el({ queryAll: { [CONTENT_LINK_SELECTOR]: [link('https://example.com/')] } });
  assert.deepEqual(extractLinkHrefs(makeThread(content, CONTENT_TEXT_FALLBACK_SELECTOR)), ['https://example.com/']);
});

test('本体・本文の要素が無いときや querySelectorAll を持たないときは空の配列を返す', () => {
  assert.deepEqual(extractLinkHrefs(el({ tag: 'ytd-comment-thread-renderer' })), []);
  assert.deepEqual(extractLinkHrefs(makeThread(null)), []);
  assert.deepEqual(extractLinkHrefs(makeThread(el({ queryAll: null }))), []);
});
