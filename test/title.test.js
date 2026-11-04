import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTS_TAG, SHORTS_TITLE_LINK_SELECTOR, WATCH_FLEXY_TAG, WATCH_TITLE_SELECTOR } from '../src/selectors.js';
import { readVideoTitle } from '../src/title.js';

// AI の判定の手がかりに、いまの動画のタイトルを読む。遷移の途中に前の動画のタイトルが残っていても
// それを使わないよう、動画ページでも Shorts でも、URL の動画 ID と一致するときだけ読む

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 * @param {Record<string, string>} [spec.attrs] 属性
 * @param {string} [spec.text] textContent
 * @param {Record<string, object>} [spec.query] querySelector の結果
 */
function el({ attrs = {}, text = '', query = {} } = {}) {
  return {
    textContent: text,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    querySelector: (selector) => query[selector] ?? null,
  };
}

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SHORTS_URL = 'https://www.youtube.com/shorts/Ga15JINEj0Y';

/**
 * 動画ページの偽の document を作る。
 * @param {object} [options]
 * @param {string|null} [options.videoId] ytd-watch-flexy の video-id
 * @param {string|null} [options.title] タイトルの要素の textContent。null なら要素が無い
 */
function watchDoc({ videoId = 'dQw4w9WgXcQ', title = '高速道路で多重事故' } = {}) {
  const query = title === null ? {} : { [WATCH_TITLE_SELECTOR]: el({ text: title }) };
  const flexy = el({ attrs: videoId === null ? {} : { 'video-id': videoId }, query });
  return el({ query: { [WATCH_FLEXY_TAG]: flexy } });
}

/**
 * Shorts のページの偽の document を作る。
 * @param {object} [options]
 * @param {string|null} [options.href] タイトルのリンクの href。null ならリンクが無い
 * @param {string} [options.title] タイトルのリンクの textContent
 */
function shortsDoc({ href = SHORTS_URL, title = '川に流された子どもを救助' } = {}) {
  const query = href === null ? {} : { [SHORTS_TITLE_LINK_SELECTOR]: el({ attrs: { href }, text: title }) };
  return el({ query: { [SHORTS_TAG]: el({ query }) } });
}

test('動画ページでは、URL の動画と一致する ytd-watch-flexy のタイトルを読む', () => {
  assert.equal(readVideoTitle(watchDoc(), 'watch', WATCH_URL, 100), '高速道路で多重事故');
});

test('動画ページで video-id が URL の動画と違えば、前の動画のタイトルなので読まない', () => {
  assert.equal(readVideoTitle(watchDoc({ videoId: 'other' }), 'watch', WATCH_URL, 100), null);
  assert.equal(readVideoTitle(watchDoc({ videoId: null }), 'watch', WATCH_URL, 100), null);
});

test('Shorts では、タイトルのリンクの動画 ID が URL の動画と一致するときだけ読む', () => {
  assert.equal(readVideoTitle(shortsDoc(), 'shorts', SHORTS_URL, 100), '川に流された子どもを救助');
  const stale = shortsDoc({ href: 'https://www.youtube.com/shorts/previous' });
  assert.equal(readVideoTitle(stale, 'shorts', SHORTS_URL, 100), null);
  assert.equal(readVideoTitle(shortsDoc({ href: null }), 'shorts', SHORTS_URL, 100), null);
});

test('タイトルの要素が無い・空白だけのときと、対象外のページでは null', () => {
  assert.equal(readVideoTitle(watchDoc({ title: null }), 'watch', WATCH_URL, 100), null);
  assert.equal(readVideoTitle(watchDoc({ title: ' \n ' }), 'watch', WATCH_URL, 100), null);
  assert.equal(readVideoTitle(watchDoc(), null, WATCH_URL, 100), null);
  assert.equal(readVideoTitle(null, 'watch', WATCH_URL, 100), null);
});

test('前後の空白を除き、続く空白を 1 つにまとめ、code point 単位で切り詰める', () => {
  const doc = watchDoc({ title: '\n  事故の\n   続報😀😀  ' });
  assert.equal(readVideoTitle(doc, 'watch', WATCH_URL, 100), '事故の 続報😀😀');
  const cut = readVideoTitle(doc, 'watch', WATCH_URL, 6);
  assert.equal(cut, '事故の 続報');
  assert.equal(readVideoTitle(doc, 'watch', WATCH_URL, 7), '事故の 続報😀');
});
