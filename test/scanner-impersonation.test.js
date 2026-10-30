import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR, REASON_ATTR, STATE_ATTR } from '../src/selectors.js';

// なりすましの判定は、スキャンのたびに読み直す動画の投稿者と比べる。Shorts では遷移の直後に前の動画の投稿者を
// 読みうるので（docs/dom-structure.md「動画の投稿者」）、投稿者が変わったら確定済みのコメントも判定し直す

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
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
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
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
 */
function makeThread({ id = 'c1', text = '本文', handle = '/@alice', author = {} } = {}) {
  const content = el({ tag: 'yt-attributed-string', text });
  const link = el({ tag: 'a' });
  link.setAttribute('href', handle);
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: { [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: link },
    data: { commentId: id },
    polymerController: { __data: { commentEntity: { author: { channelId: null, ...author } } } },
  });
  return el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
}

/**
 * 判定器を作る。動画の投稿者は state.owner を返す。
 * @param {object} [options]
 */
function makeProcessor({ owner = null, exempt } = {}) {
  const state = { owner };
  const cache = new Map();
  const processor = createThreadProcessor({
    rules: compileRules(),
    exempt,
    cache: {
      get: (id, hash) => cache.get(`${id}:${hash}`) ?? null,
      set: (id, hash, verdict) => cache.set(`${id}:${hash}`, verdict),
    },
    getAiMode: () => 'ready',
    getVideoOwner: () => state.owner,
  });
  return { processor, state };
}

const RICK = { handle: '@RickAstleyYT', displayName: 'Rick Astley' };
const OTHER = { handle: '@OTTOPEDIA', displayName: 'OTTOPEDIA' };

test('動画の投稿者の名前を真似たコメントを NG ユーザとして隠し、順番待ちに入れない', () => {
  const { processor } = makeProcessor({ owner: RICK });
  const thread = makeThread({ handle: '/@rick.astley' });
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngUser');
});

test('コメントの投稿者の表示名（commentEntity.author.displayName）でも照合する', () => {
  const { processor } = makeProcessor({ owner: RICK });
  const thread = makeThread({ handle: '/@xyz-123', author: { displayName: 'Rick Astley' } });
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngUser');
});

test('動画の投稿者を読めないときは隠さない', () => {
  const { processor } = makeProcessor({ owner: null });
  const thread = makeThread({ handle: '/@rick.astley' });
  assert.deepEqual(processor.processThreads([thread]), [{ id: 'c1', text: '本文' }]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'awaiting-ai');
});

test('判定から外す条件（認証バッジ）は、なりすましより先に効く', () => {
  const { processor } = makeProcessor({ owner: RICK, exempt: { owner: true, pinned: true, verified: true } });
  const thread = makeThread({ handle: '/@rick.astley', author: { isVerified: true } });
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});

test('所有者を判定から外さない設定でも、動画の投稿者本人のコメントはなりすましにしない', () => {
  const { processor } = makeProcessor({ owner: RICK });
  const thread = makeThread({ handle: '/@other', author: { isCreator: true, displayName: 'Rick Astley' } });
  processor.processThreads([thread]);
  assert.notEqual(thread.getAttribute(REASON_ATTR), 'ngUser');
});

test('遷移で動画の投稿者が変わったら、なりすましで隠したコメントを判定し直して戻す', () => {
  // 前の動画の投稿者を読んだままスキャンし、その後に投稿者の要素が新しい動画のものに変わった
  const { processor, state } = makeProcessor({ owner: RICK });
  const thread = makeThread({ handle: '/@rick.astley' });
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngUser');

  state.owner = OTHER;
  assert.deepEqual(processor.processThreads([thread]), [{ id: 'c1', text: '本文' }]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
  assert.equal(thread.getAttribute(REASON_ATTR), 'awaiting-ai');
});

test('遷移で動画の投稿者が変わったら、AI が表示にしたコメントもなりすましで判定し直す', () => {
  const { processor, state } = makeProcessor({ owner: OTHER });
  const thread = makeThread({ handle: '/@rick.astley' });
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: false, category: null }, { id: 'c1', text: '本文' });
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');

  state.owner = RICK;
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngUser');
});

test('動画の投稿者が変わらなければ、AI の判定を保つ', () => {
  const { processor, state } = makeProcessor({ owner: RICK });
  const thread = makeThread({ handle: '/@someone' });
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: true, category: '暴言' }, { id: 'c1', text: '本文' });
  // 同じ値の別のオブジェクトを返しても、変わったとはみなさない
  state.owner = { ...RICK };
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');
});

test('ハンドルのリンクがまだ無いコメントは、表示名が動画の投稿者と同じでも隠さない', () => {
  // 所有者の印（isCreator）もまだ届いていない本人のコメント。隠すと、動画ページでは判定し直す契機が無い
  const { processor } = makeProcessor({ owner: RICK });
  const thread = makeThread({ handle: '', author: { displayName: '@RickAstleyYT' } });
  processor.processThreads([thread]);
  assert.notEqual(thread.getAttribute(REASON_ATTR), 'ngUser');
});
