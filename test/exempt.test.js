import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideState } from '../src/decide.js';
import { extractComment } from '../src/dom.js';
import { compileRules, judgeExemption } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { parseStoredSettings } from '../src/settings.js';
import {
  AUTHOR_LINK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  OWNER_BADGE_LINK_SELECTOR,
  PINNED_BADGE_SELECTOR,
  REASON_ATTR,
  STATE_ATTR,
} from '../src/selectors.js';

// 動画の投稿者・固定コメント・認証バッジ付き・許可ユーザのコメントは、どの判定でも隠さない（issue #6）

const CHANNEL_ID = 'UCabcdefghijklmnopqrstuv';
const ALL = { owner: true, pinned: true, verified: true };
const NONE = { owner: false, pinned: false, verified: false };

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 */
function el({ tag = 'div', id = '', attrs = {}, text = '', children = [], query = {}, data, polymerController } = {}) {
  const attrMap = new Map(Object.entries(attrs));
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    textContent: text,
    data,
    polymerController,
    getAttribute: (name) => (attrMap.has(name) ? attrMap.get(name) : null),
    setAttribute: (name, value) => attrMap.set(name, String(value)),
    hasAttribute: (name) => attrMap.has(name),
    removeAttribute: (name) => attrMap.delete(name),
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
 * @param {string} [options.text] 本文
 * @param {string} [options.handle] 投稿者のハンドル
 * @param {boolean} [options.owner] チャンネル所有者のバッジを付けるか（a#author-text は hidden になる）
 * @param {boolean} [options.staleBadge] 所有者のバッジだけを残し、a#author-text は hidden にしない（要素の使い回し）
 * @param {'shown'|'hidden'|null} [options.pinned] 固定の印。'hidden' は hidden 属性付きで残っている
 * @param {boolean} [options.verified] commentEntity.author.isVerified
 * @param {boolean} [options.reply] 返信にする
 */
function makeThread({ text = '本文', handle = '@alice', owner = false, staleBadge = false, pinned = null, verified = false, reply = false } = {}) {
  const query = {
    [CONTENT_TEXT_SELECTOR]: el({ tag: 'yt-attributed-string', text }),
    [AUTHOR_LINK_SELECTOR]: el({ tag: 'a', attrs: owner ? { href: `/${handle}`, hidden: '' } : { href: `/${handle}` } }),
  };
  if (owner || staleBadge) query[OWNER_BADGE_LINK_SELECTOR] = el({ tag: 'a', attrs: { href: `/${handle}` } });
  if (pinned) query[PINNED_BADGE_SELECTOR] = el({ tag: PINNED_BADGE_SELECTOR, attrs: pinned === 'hidden' ? { hidden: '' } : {} });
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query,
    data: { commentId: 'c1' },
    polymerController: { data: {}, __data: { commentEntity: { author: { channelId: CHANNEL_ID, isVerified: verified } } } },
  });
  const thread = el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
  if (reply) el({ tag: 'ytd-comment-replies-renderer', children: [thread] });
  return thread;
}

test('チャンネル所有者は、バッジがあり a#author-text が hidden のときだけ isOwner になる', () => {
  assert.equal(extractComment(makeThread({ owner: true })).author.isOwner, true);
  assert.equal(extractComment(makeThread()).author.isOwner, false);
  assert.equal(extractComment(makeThread({ staleBadge: true })).author.isOwner, false, '使い回しで残ったバッジだけでは所有者にしない');
});

test('固定の印が hidden でなく、返信でないときだけ isPinned になる', () => {
  assert.equal(extractComment(makeThread({ pinned: 'shown' })).isPinned, true);
  assert.equal(extractComment(makeThread({ pinned: 'hidden' })).isPinned, false);
  assert.equal(extractComment(makeThread({ pinned: 'shown', reply: true })).isPinned, false);
});

test('commentEntity.author.isVerified が true のときだけ isVerified になる', () => {
  assert.equal(extractComment(makeThread({ verified: true })).author.isVerified, true);
  assert.equal(extractComment(makeThread()).author.isVerified, false);
});

test('許可ユーザはハンドル（大文字小文字を区別しない）かチャンネル ID で一致する', () => {
  const rules = compileRules({ allowUsers: ['@Alice', CHANNEL_ID, 'bad'] });
  assert.equal(rules.matchAllowedUser({ handle: '@alice', channelId: null }), true);
  assert.equal(rules.matchAllowedUser({ handle: null, channelId: CHANNEL_ID }), true);
  assert.equal(rules.matchAllowedUser({ handle: '@bob', channelId: null }), false);
  assert.equal(rules.warnings.length, 1);
  assert.match(rules.warnings[0], /^ALLOW_USERS:/);
});

test('judgeExemption は設定で有効な対象と許可ユーザだけを外す', () => {
  const rules = compileRules({ allowUsers: ['@carol'] });
  const owner = { author: { handle: '@x', isOwner: true, isVerified: false }, isPinned: false };
  assert.equal(judgeExemption(owner, rules, ALL), 'owner');
  assert.equal(judgeExemption(owner, rules, NONE), null);
  assert.equal(judgeExemption({ author: { handle: '@x' }, isPinned: true }, rules, ALL), 'pinned');
  assert.equal(judgeExemption({ author: { handle: '@x', isVerified: true } }, rules, ALL), 'verified');
  assert.equal(judgeExemption({ author: { handle: '@carol' } }, rules, NONE), 'allowUser', '許可ユーザは設定によらず外す');
  assert.equal(judgeExemption({ author: { handle: '@x' } }, rules, ALL), null);
});

test('decideState は判定から外すコメントを、ルールより先に表示にする', () => {
  const extracted = { id: 'c1', text: '死ね', textHash: 'h', author: { handle: '@x', channelId: null }, isReply: false };
  assert.deepEqual(decideState({ extracted, ruleResult: { reason: 'ngWord' }, aiMode: 'ready', cached: null, exempt: true }), {
    state: 'shown',
    reason: 'exempt',
    enqueue: false,
  });
  assert.equal(decideState({ extracted: { unreadable: 'x' }, ruleResult: null, aiMode: 'ready', cached: null, exempt: true }).state, 'pending');
});

test('「値」の allowUsers を読む', () => {
  assert.deepEqual(parseStoredSettings({ ngUsers: [], ngWords: [], allowUsers: ['@a', 1] }).allowUsers, ['@a']);
});

/**
 * 判定器を作る。
 * @param {object} options
 */
function makeProcessor({ ngUsers = [], ngWords = [], allowUsers = [], exempt = ALL } = {}) {
  return createThreadProcessor({
    rules: compileRules({ ngUsers, ngWords, allowUsers }),
    exempt,
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'ready',
  });
}

test('判定から外すコメントは、NG ユーザ・NG ワードでも隠さず、AI の順番待ちにも入れない', () => {
  const processor = makeProcessor({ ngUsers: ['@alice'], ngWords: ['本文'] });
  const owner = makeThread({ owner: true });
  assert.deepEqual(processor.processThreads([owner]), []);
  assert.equal(owner.getAttribute(STATE_ATTR), 'shown');
  assert.equal(owner.getAttribute(REASON_ATTR), 'exempt');

  const allowed = makeThread({ handle: '@dave' });
  const allowProcessor = makeProcessor({ ngWords: ['本文'], allowUsers: ['@dave'] });
  assert.deepEqual(allowProcessor.processThreads([allowed]), []);
  assert.equal(allowed.getAttribute(STATE_ATTR), 'shown');
});

test('設定で外していない対象は通常どおり判定する', () => {
  const processor = makeProcessor({ ngWords: ['本文'], exempt: NONE });
  const owner = makeThread({ owner: true });
  processor.processThreads([owner]);
  assert.equal(owner.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(owner.getAttribute(REASON_ATTR), 'ngWord');
});

test('固定の印のセレクタは、実ページの #pinned-comment-badge の中の ytw-pinned-comment-badge-renderer を指す', () => {
  // ytd- で始まる旧世代のタグは、実ページの固定コメントに無い（docs/dom-structure.md）
  assert.equal(PINNED_BADGE_SELECTOR, '#pinned-comment-badge ytw-pinned-comment-badge-renderer');
});
