import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractComment } from '../src/dom.js';
import { hashString } from '../src/hash.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_LINK_SELECTOR, CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 */
function el({ tag = 'div', id = '', attrs = {}, text = '', children = [], query = {}, data, polymerController } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    textContent: text,
    data,
    polymerController,
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    querySelector: (selector) => query[selector] ?? null,
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 偽の thread を作る。
 * @param {object} [options]
 * @param {string} [options.domText] #content-text の textContent（翻訳中は訳文）
 * @param {unknown} [options.polymerText] commentEntity.properties.content.content。undefined なら properties を作らない
 * @param {{ text: string, href: string }|null} [options.link] 本文の最初のリンク
 */
function makeThread({ domText = '', polymerText, link = null } = {}) {
  const contentQuery = {};
  if (link) contentQuery[CONTENT_LINK_SELECTOR] = el({ tag: 'a', attrs: { href: link.href }, text: link.text });
  const content = el({ tag: 'yt-attributed-string', text: domText, query: contentQuery });
  const commentEntity = { author: { channelId: 'UCabcdefghijklmnopqrstuv' } };
  if (polymerText !== undefined) commentEntity.properties = { content: { content: polymerText } };
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: {
      [CONTENT_TEXT_SELECTOR]: content,
      [AUTHOR_LINK_SELECTOR]: el({ tag: 'a', attrs: { href: '/@alice' } }),
    },
    data: { commentId: 'UgxTRANSLATE' },
    polymerController: { data: {}, __data: { commentEntity } },
  });
  return el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
}

test('#content-text が訳文に差し替わっていても、本文は polymer の原文から読む', () => {
  const extracted = extractComment(makeThread({ domText: '素晴らしい動画です', polymerText: '  Great video  ' }));
  assert.equal(extracted.text, 'Great video');
  assert.equal(extracted.textHash, hashString('Great video'));
});

test('polymer の原文が空文字なら、判定せずに表示しないよう #content-text の textContent から読む', () => {
  const extracted = extractComment(makeThread({ domText: '表示中の本文', polymerText: '' }));
  assert.equal(extracted.text, '表示中の本文');
});

test('polymer の原文が文字列でなければ #content-text の textContent から読む', () => {
  assert.equal(extractComment(makeThread({ domText: '  表示中の本文  ' })).text, '表示中の本文');
  assert.equal(extractComment(makeThread({ domText: '表示中の本文', polymerText: null })).text, '表示中の本文');
});

test('先頭の @メンションの判定は、polymer の原文ではなく #content-text の文字列で行う', () => {
  const extracted = extractComment(
    makeThread({
      domText: '@someone ありがとう',
      polymerText: 'ありがとう',
      link: { text: '@someone', href: '/channel/UCabcdefghijklmnopqrstuv' },
    }),
  );
  assert.equal(extracted.leadingMentionHref, '/channel/UCabcdefghijklmnopqrstuv');
});
