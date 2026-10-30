import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCommentAuthorDisplayName, readVideoOwner } from '../src/owner.js';
import {
  SHORTS_OWNER_HANDLE_SELECTOR,
  SHORTS_OWNER_NAME_SELECTOR,
  SHORTS_TAG,
  WATCH_FLEXY_TAG,
  WATCH_OWNER_HANDLE_SELECTOR,
  WATCH_OWNER_NAME_SELECTOR,
} from '../src/selectors.js';

// 動画の投稿者は docs/dom-structure.md「動画の投稿者」の場所から読む

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 * @param {string} [spec.tag] タグ名
 * @param {Record<string, string>} [spec.attrs] 属性
 * @param {string} [spec.text] textContent
 * @param {Record<string, object>} [spec.query] querySelector の結果
 * @param {unknown} [spec.polymerController] polymerController
 * @param {object[]} [spec.children] 子要素
 * @param {string} [spec.id] id
 */
function el({ tag = 'div', attrs = {}, text = '', query = {}, polymerController, children = [], id = '' } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    textContent: text,
    polymerController,
    children,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    querySelector: (selector) => query[selector] ?? null,
  };
  return node;
}

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SHORTS_URL = 'https://www.youtube.com/shorts/Ga15JINEj0Y';

/**
 * 動画ページの偽の document を作る。
 * @param {object} [options]
 * @param {string|null} [options.videoId] ytd-watch-flexy の video-id
 * @param {string|null} [options.href] 投稿者のリンクの href
 * @param {string|null} [options.name] 表示名
 */
function watchDoc({ videoId = 'dQw4w9WgXcQ', href = '/@RickAstleyYT', name = 'Rick Astley' } = {}) {
  const query = {};
  if (href !== null) query[WATCH_OWNER_HANDLE_SELECTOR] = el({ tag: 'a', attrs: { href } });
  if (name !== null) query[WATCH_OWNER_NAME_SELECTOR] = el({ tag: 'yt-formatted-string', text: name });
  const flexy = el({ tag: WATCH_FLEXY_TAG, attrs: videoId === null ? {} : { 'video-id': videoId }, query });
  return el({ tag: 'html', query: { [WATCH_FLEXY_TAG]: flexy } });
}

/**
 * Shorts のページの偽の document を作る。
 * @param {object} [options]
 * @param {string|null} [options.href] 投稿者のリンクの href
 * @param {string|null} [options.name] 表示名
 */
function shortsDoc({ href = '/@holo_dendoshi/shorts', name = 'ホロの伝道師 【ホロライブ切り抜き】' } = {}) {
  const query = {};
  if (href !== null) query[SHORTS_OWNER_HANDLE_SELECTOR] = el({ tag: 'a', attrs: { href } });
  if (name !== null) query[SHORTS_OWNER_NAME_SELECTOR] = el({ tag: 'yt-formatted-string', text: name });
  return el({ tag: 'html', query: { [SHORTS_TAG]: el({ tag: SHORTS_TAG, query }) } });
}

test('動画ページの投稿者のハンドルと表示名を読む', () => {
  assert.deepEqual(readVideoOwner(watchDoc(), 'watch', WATCH_URL), {
    handle: '@RickAstleyYT',
    displayName: 'Rick Astley',
  });
});

test('動画ページで、ytd-watch-flexy の video-id が URL の動画と違うときは読まない（遷移の途中で前の動画の投稿者が残る）', () => {
  assert.equal(readVideoOwner(watchDoc({ videoId: 'previousVid' }), 'watch', WATCH_URL), null);
  assert.equal(readVideoOwner(watchDoc({ videoId: null }), 'watch', WATCH_URL), null);
  assert.equal(readVideoOwner(el({ tag: 'html' }), 'watch', WATCH_URL), null);
});

test('Shorts の投稿者のハンドル（/@handle/shorts）と表示名を読む', () => {
  assert.deepEqual(readVideoOwner(shortsDoc(), 'shorts', SHORTS_URL), {
    handle: '@holo_dendoshi',
    displayName: 'ホロの伝道師 【ホロライブ切り抜き】',
  });
});

test('片方だけ読めればそれを返し、どちらも読めなければ null を返す', () => {
  assert.deepEqual(readVideoOwner(shortsDoc({ name: null }), 'shorts', SHORTS_URL), {
    handle: '@holo_dendoshi',
    displayName: null,
  });
  assert.deepEqual(
    readVideoOwner(
      watchDoc({ href: '/channel/UCabcdefghijklmnopqrstuv', name: '  Rick Astley\n' }),
      'watch',
      WATCH_URL,
    ),
    {
      handle: null,
      displayName: 'Rick Astley',
    },
  );
  assert.equal(readVideoOwner(shortsDoc({ href: null, name: '   ' }), 'shorts', SHORTS_URL), null);
  assert.equal(readVideoOwner(el({ tag: 'html' }), 'shorts', SHORTS_URL), null);
});

test('対象のページでなければ読まない', () => {
  assert.equal(readVideoOwner(watchDoc(), null, 'https://www.youtube.com/'), null);
});

test('遷移で投稿者の要素が変わったら、読み直した値が変わる', () => {
  const doc = shortsDoc();
  const first = readVideoOwner(doc, 'shorts', SHORTS_URL);
  const next = shortsDoc({ href: '/@Holo_0_0/shorts', name: 'ホロライブの雑学' });
  assert.notDeepEqual(readVideoOwner(next, 'shorts', 'https://www.youtube.com/shorts/EK8CDFheJ1k'), first);
  assert.deepEqual(readVideoOwner(next, 'shorts', 'https://www.youtube.com/shorts/EK8CDFheJ1k'), {
    handle: '@Holo_0_0',
    displayName: 'ホロライブの雑学',
  });
});

/**
 * 偽の thread を作る。
 * @param {unknown} author commentEntity.author
 */
function threadWithAuthor(author) {
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    polymerController: { __data: { commentEntity: { author } } },
  });
  const container = el({ id: 'comment-container', children: [viewModel] });
  return el({ tag: 'ytd-comment-thread-renderer', children: [container] });
}

test('コメントの投稿者の表示名を commentEntity.author.displayName から読む', () => {
  assert.equal(readCommentAuthorDisplayName(threadWithAuthor({ displayName: '@alice' })), '@alice');
  assert.equal(readCommentAuthorDisplayName(threadWithAuthor({ displayName: '' })), null);
  assert.equal(readCommentAuthorDisplayName(threadWithAuthor({})), null);
  assert.equal(readCommentAuthorDisplayName(threadWithAuthor(undefined)), null);
  assert.equal(readCommentAuthorDisplayName(el({ tag: 'ytd-comment-thread-renderer' })), null);
});
