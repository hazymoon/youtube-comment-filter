import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractComment } from '../src/dom.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

// カスタム絵文字の名前は、原文の attachmentRuns が画像として描く範囲だけを取り除く。
// 投稿者が本文に手で打った :名前: まで取り除くと、NG ワードを :scam: のように書くだけで照合をすり抜けられるため

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
 * 画像の絵文字の範囲（実機の commentEntity.properties.content.attachmentRuns と同じ形）。
 * @param {number} startIndex
 * @param {number} length
 */
function imageRun(startIndex, length) {
  return { startIndex, length, element: { type: { imageType: { image: { sources: [{ url: 'https://example.invalid/e.png' }] } } } } };
}

/**
 * 偽の thread を作る。
 * @param {{ domText: string, polymerText: string, runs?: unknown }} options
 */
function makeThread({ domText, polymerText, runs }) {
  const content = { content: polymerText };
  if (runs !== undefined) content.attachmentRuns = runs;
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: {
      [CONTENT_TEXT_SELECTOR]: el({ tag: 'yt-attributed-string', text: domText }),
      [AUTHOR_LINK_SELECTOR]: el({ tag: 'a', attrs: { href: '/@alice' } }),
    },
    data: { commentId: 'UgxRUNS' },
    polymerController: {
      data: {},
      __data: { commentEntity: { author: { channelId: 'UCabcdefghijklmnopqrstuv' }, properties: { content } } },
    },
  });
  return el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
}

test('画像として描かれるカスタム絵文字の名前は取り除く', () => {
  const extracted = extractComment(
    makeThread({
      domText: '\nCame back to check',
      polymerText: ':whistle-red-blow:\nCame back to check',
      runs: [imageRun(0, 18)],
    }),
  );
  assert.equal(extracted.text, 'Came back to check');
});

test('投稿者が手で打った :名前: は、画像の範囲でなければ取り除かない（NG ワードのすり抜けを防ぐ）', () => {
  const extracted = extractComment(makeThread({ domText: 'free :scam: here', polymerText: 'free :scam: here', runs: [] }));
  assert.equal(extracted.text, 'free :scam: here');
});

test('attachmentRuns が無ければ、何も取り除かない', () => {
  const extracted = extractComment(makeThread({ domText: 'free :scam:', polymerText: 'free :scam:' }));
  assert.equal(extracted.text, 'free :scam:');
});

test('画像として描かれる普通の絵文字は文字として残す', () => {
  const extracted = extractComment(
    makeThread({ domText: 'bird content! ', polymerText: 'bird content! 😂', runs: [imageRun(14, 2)] }),
  );
  assert.equal(extracted.text, 'bird content! 😂');
});

test('複数のカスタム絵文字を、後ろの位置がずれないように取り除く', () => {
  const extracted = extractComment(
    makeThread({ domText: 'a b', polymerText: 'a:yt:b:face-blue-smiling:', runs: [imageRun(1, 4), imageRun(6, 19)] }),
  );
  assert.equal(extracted.text, 'ab');
});

test('範囲が原文の外を指すときは取り除かない', () => {
  const extracted = extractComment(makeThread({ domText: 'a :yt:', polymerText: 'a :yt:', runs: [imageRun(4, 10)] }));
  assert.equal(extracted.text, 'a :yt:');
});

test('カスタム絵文字だけの本文は、取り除いた結果が空なので本文の要素から読む', () => {
  const extracted = extractComment(makeThread({ domText: ' ', polymerText: ':yt: ', runs: [imageRun(0, 4)] }));
  assert.equal(extracted.text, '');
});
