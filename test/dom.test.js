import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractComment, findOwnViewModel, isInsideHiddenThread } from '../src/dom.js';
import { hashString } from '../src/hash.js';
import {
  AUTHOR_LINK_SELECTOR,
  CONTENT_LINK_SELECTOR,
  CONTENT_TEXT_FALLBACK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  OWNER_BADGE_LINK_SELECTOR,
  PUBLISHED_TIME_LINK_SELECTOR,
} from '../src/selectors.js';

const CHANNEL_ID = 'UCabcdefghijklmnopqrstuv';

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 * @param {string} [spec.tag] タグ名
 * @param {string} [spec.id] id
 * @param {Record<string, string>} [spec.attrs] 属性
 * @param {string} [spec.text] textContent
 * @param {object[]} [spec.children] 子要素
 * @param {Record<string, object>} [spec.query] querySelector の結果
 * @param {unknown} [spec.data] data
 * @param {unknown} [spec.polymerController] polymerController
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
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
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
 * @param {string|null} [options.dataId] view-model の .data.commentId
 * @param {string|null} [options.controllerId] .polymerController.data.commentId
 * @param {string|null} [options.lcHref] 投稿日時のリンクの href
 * @param {string|null} [options.authorHref] a#author-text の href
 * @param {string|null} [options.badgeHref] a#name の href（チャンネル所有者）
 * @param {string|null} [options.channelId] 投稿者のチャンネル ID
 * @param {string|null} [options.text] 本文。null なら本文の要素を作らない
 * @param {{ text: string, href: string }|null} [options.link] 本文の最初のリンク
 * @param {boolean} [options.fallbackOnly] 本文を代わりの取得先だけで取れるようにする
 * @param {boolean} [options.noViewModel] 本体の要素を作らない
 * @param {object[]} [options.replies] #replies の中の返信の thread
 */
function makeThread({
  dataId = 'UgxCOMMENT1',
  controllerId = null,
  lcHref = null,
  authorHref = '/@alice',
  badgeHref = null,
  channelId = CHANNEL_ID,
  text = '  本文です  ',
  link = null,
  fallbackOnly = false,
  noViewModel = false,
  replies = [],
} = {}) {
  const query = {};
  if (text !== null) {
    const contentQuery = {};
    if (link) contentQuery[CONTENT_LINK_SELECTOR] = el({ tag: 'a', attrs: { href: link.href }, text: link.text });
    const content = el({ tag: 'yt-attributed-string', text, query: contentQuery });
    query[fallbackOnly ? CONTENT_TEXT_FALLBACK_SELECTOR : CONTENT_TEXT_SELECTOR] = content;
  }
  if (authorHref !== null) {
    query[AUTHOR_LINK_SELECTOR] = el({
      tag: 'a',
      id: 'author-text',
      attrs: badgeHref ? { href: authorHref, hidden: '' } : { href: authorHref },
    });
  }
  if (badgeHref !== null) query[OWNER_BADGE_LINK_SELECTOR] = el({ tag: 'a', id: 'name', attrs: { href: badgeHref } });
  if (lcHref !== null) query[PUBLISHED_TIME_LINK_SELECTOR] = el({ tag: 'a', attrs: { href: lcHref } });

  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query,
    data: dataId === null ? {} : { commentId: dataId },
    polymerController: {
      data: controllerId === null ? {} : { commentId: controllerId },
      __data: { commentEntity: { author: { channelId } } },
    },
  });
  const container = el({ id: 'comment-container', children: noViewModel ? [] : [viewModel] });
  const children = [container];
  if (replies.length > 0) {
    const repliesRenderer = el({
      tag: 'ytd-comment-replies-renderer',
      children: [el({ id: 'expanded-threads', children: replies })],
    });
    children.push(el({ id: 'replies', children: [repliesRenderer] }));
  }
  return el({ tag: 'ytd-comment-thread-renderer', children });
}

test('通常のコメントから ID・本文・投稿者を読む', () => {
  const thread = makeThread();
  assert.deepEqual(extractComment(thread), {
    id: 'UgxCOMMENT1',
    text: '本文です',
    textHash: hashString('本文です'),
    author: { handle: '@alice', channelId: CHANNEL_ID, isOwner: false, isVerified: false },
    isReply: false,
    isPinned: false,
    leadingMentionHref: null,
  });
});

test('チャンネル所有者のコメントは、hidden の a#author-text の href からもハンドルを読める', () => {
  const thread = makeThread({ authorHref: '/@owner', badgeHref: '/@owner' });
  assert.equal(extractComment(thread).author.handle, '@owner');
});

test('a#author-text が無ければバッジの a#name の href からハンドルを読む', () => {
  const thread = makeThread({ authorHref: null, badgeHref: '/@owner' });
  assert.equal(extractComment(thread).author.handle, '@owner');
});

test('パーセントエンコードされたハンドルは解いて返す', () => {
  const thread = makeThread({ authorHref: `/@${encodeURIComponent('ゆーざー')}` });
  assert.equal(extractComment(thread).author.handle, '@ゆーざー');
});

test('返信は isReply が true になる', () => {
  const reply = makeThread({ dataId: 'UgxREPLY1' });
  const parent = makeThread({ replies: [reply] });
  assert.equal(extractComment(parent).isReply, false);
  const extracted = extractComment(reply);
  assert.equal(extracted.id, 'UgxREPLY1');
  assert.equal(extracted.isReply, true);
});

test('親の thread から読むと、入れ子の返信の本体ではなく親自身の本体を返す', () => {
  const reply = makeThread({ dataId: 'UgxREPLY1' });
  const parent = makeThread({ replies: [reply] });
  assert.equal(findOwnViewModel(parent).data.commentId, 'UgxCOMMENT1');
});

test('ID が .data に無ければ polymerController.data、さらに無ければ lc= から読む', () => {
  assert.equal(extractComment(makeThread({ dataId: null, controllerId: 'UgxCTRL' })).id, 'UgxCTRL');
  const fromHref = makeThread({ dataId: null, lcHref: '/watch?v=abc123&lc=UgxFROMHREF' });
  assert.equal(extractComment(fromHref).id, 'UgxFROMHREF');
});

test('ID が取れなければ unreadable', () => {
  const result = extractComment(makeThread({ dataId: null, lcHref: '/watch?v=abc123' }));
  assert.ok('unreadable' in result);
});

test('本文の要素が無ければ unreadable、本体の要素が無くても unreadable', () => {
  assert.ok('unreadable' in extractComment(makeThread({ text: null })));
  assert.ok('unreadable' in extractComment(makeThread({ noViewModel: true })));
});

test('本文を #content-text で取れなければ代わりの取得先から読む', () => {
  assert.equal(extractComment(makeThread({ text: '代わり', fallbackOnly: true })).text, '代わり');
});

test('本文の要素が空なら text は空文字（unreadable にしない）', () => {
  const result = extractComment(makeThread({ text: '   ' }));
  assert.equal(result.text, '');
  assert.equal(result.textHash, hashString(''));
});

test('本文が先頭のリンクの文字列で始まるときだけ leadingMentionHref を返す', () => {
  const mention = makeThread({
    text: '  @someone ありがとう',
    link: { text: ' @someone ', href: `/channel/${CHANNEL_ID}` },
  });
  assert.equal(extractComment(mention).leadingMentionHref, `/channel/${CHANNEL_ID}`);

  const notLeading = makeThread({
    text: '詳しくは https://example.com を見て',
    link: { text: 'https://example.com', href: 'https://www.youtube.com/redirect?q=https://example.com' },
  });
  assert.equal(extractComment(notLeading).leadingMentionHref, null);
});

test('isInsideHiddenThread は祖先の thread が hidden のときだけ true（自身は見ない）', () => {
  const grandchild = makeThread({ dataId: 'G' });
  const child = makeThread({ dataId: 'C', replies: [grandchild] });
  const parent = makeThread({ replies: [child] });

  assert.equal(isInsideHiddenThread(child), false);
  child.setAttribute('data-ycf-state', 'hidden');
  assert.equal(isInsideHiddenThread(child), false, '自身が hidden でも祖先でなければ false');
  assert.equal(isInsideHiddenThread(grandchild), true);

  child.setAttribute('data-ycf-state', 'shown');
  parent.setAttribute('data-ycf-state', 'hidden');
  assert.equal(isInsideHiddenThread(grandchild), true, '2 段上の祖先が hidden でも true');
  assert.equal(isInsideHiddenThread(parent), false);
});
