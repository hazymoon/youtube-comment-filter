import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import {
  AUTHOR_LINK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  OWNER_BADGE_LINK_SELECTOR,
  PINNED_BADGE_SELECTOR,
  REASON_ATTR,
  STATE_ATTR,
} from '../src/selectors.js';

// 判定し直すかは、判定から外す条件のデータではなく「判定から外すかどうかの結果」（judgeExemption）が変わったかで決める。
// 設定で外していない条件や、結果が変わらない条件の変化では判定し直さず、許可ユーザのように結果を変える入力は拾う

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
    query,
    getAttribute: (name) => (attrMap.has(name) ? attrMap.get(name) : null),
    setAttribute: (name, value) => attrMap.set(name, String(value)),
    hasAttribute: (name) => attrMap.has(name),
    removeAttribute: (name) => attrMap.delete(name),
    querySelector: (selector) => node.query[selector] ?? null,
    closest(selector) {
      for (let n = node; n; n = n.parentElement) {
        if (n.tagName.toLowerCase() === selector) return n;
      }
      return null;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 偽の thread を作る。投稿者のリンクは後から足せるよう、viewModel と commentEntity.author を返り値に付ける。
 * @param {object} [options]
 * @param {string|null} [options.href] 投稿者のリンクの href。null なら投稿者のリンクを描画しない
 */
function makeThread({ href = '/@alice' } = {}) {
  const content = el({ tag: 'yt-attributed-string', text: '本文' });
  const query = { [CONTENT_TEXT_SELECTOR]: content };
  if (href !== null) query[AUTHOR_LINK_SELECTOR] = el({ tag: 'a', attrs: { href } });
  const author = { channelId: null };
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query,
    data: { commentId: 'c1' },
    polymerController: { data: {}, __data: { commentEntity: { author } } },
  });
  content.parentElement = viewModel;
  const thread = el({
    tag: 'ytd-comment-thread-renderer',
    children: [el({ id: 'comment-container', children: [viewModel] })],
  });
  thread.viewModel = viewModel;
  thread.author = author;
  return thread;
}

/**
 * 固定の印を描画する。
 * @param {any} thread makeThread の結果
 */
function addPinnedBadge(thread) {
  const badge = el({ tag: 'ytw-pinned-comment-badge-renderer' });
  badge.parentElement = thread.viewModel;
  thread.viewModel.query[PINNED_BADGE_SELECTOR] = badge;
  return badge;
}

/**
 * 所有者のデータ（commentEntity.author.isCreator とバッジ）を足す。
 * @param {any} thread makeThread の結果
 */
function addOwnerData(thread) {
  thread.author.isCreator = true;
  thread.viewModel.query[OWNER_BADGE_LINK_SELECTOR] = el({ tag: 'a', attrs: { href: '/@alice' } });
}

/**
 * 判定器を作る。cache.get の呼び出しと debugLog の出力を記録する。
 * @param {object} [options]
 */
function makeProcessor({ ngWords = [], allowUsers = [], exempt = ALL } = {}) {
  const cacheGets = [];
  const logs = [];
  const processor = createThreadProcessor({
    rules: compileRules({ ngWords, allowUsers }),
    exempt,
    cache: {
      get: (id, hash) => {
        cacheGets.push([id, hash]);
        return null;
      },
      set: () => {},
    },
    getAiMode: () => 'ready',
    debugLog: (...args) => logs.push(args),
  });
  return { processor, cacheGets, logs };
}

test('設定で外していない条件のデータが届いても、NG ワードで隠したコメントは判定し直さない', () => {
  const { processor, logs } = makeProcessor({ ngWords: ['本文'], exempt: NONE });
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');

  const logsBefore = logs.length;
  addOwnerData(thread);
  addPinnedBadge(thread);
  thread.author.isVerified = true;
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(logs.length, logsBefore, '判定し直していない');
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');
});

test('判定から外す結果が変わらない条件の変化（所有者のまま固定が外れる）では判定し直さない', () => {
  const { processor, logs } = makeProcessor({ ngWords: ['本文'] });
  const thread = makeThread();
  addOwnerData(thread);
  addPinnedBadge(thread);
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');

  const logsBefore = logs.length;
  delete thread.viewModel.query[PINNED_BADGE_SELECTOR];
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(logs.length, logsBefore, '判定し直していない');
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});

test('投稿者のハンドルが後から届いて許可ユーザに当たったら、次のスキャンで判定から外す', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'], allowUsers: ['@alice'] });
  const thread = makeThread({ href: null });
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');

  thread.viewModel.query[AUTHOR_LINK_SELECTOR] = el({ tag: 'a', attrs: { href: '/@alice' } });
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});

test('revalidate は、許可ユーザとして表示したコメントが許可ユーザに当たらなくなったら判定前に戻す', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'], allowUsers: ['@alice'] });
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');

  const link = thread.viewModel.query[AUTHOR_LINK_SELECTOR];
  link.setAttribute('href', '/@bob');
  processor.revalidate([thread.viewModel]);
  assert.equal(thread.getAttribute(STATE_ATTR), null, 'CSS で隠れる判定前に戻す');

  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');
});

test('revalidate は、判定から外す理由が変わっても外れたままなら判定前に戻さない', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'] });
  const thread = makeThread();
  addOwnerData(thread);
  const badge = addPinnedBadge(thread);
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');

  delete thread.viewModel.query[PINNED_BADGE_SELECTOR];
  processor.revalidate([badge.parentElement]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});
