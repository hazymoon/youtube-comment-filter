import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString } from '../src/hash.js';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import {
  AUTHOR_LINK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  EXPANDED_ATTR,
  HASH_ATTR,
  ID_ATTR,
  OWNER_BADGE_LINK_SELECTOR,
  PINNED_BADGE_SELECTOR,
  REASON_ATTR,
  STATE_ATTR,
} from '../src/selectors.js';

// 判定から外す条件（所有者・固定・認証済み）のデータが本文より遅れて届いたら、次のスキャンで判定し直す（issue #17）

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
 * 偽の thread を作る。判定から外す条件のデータは後から足せるよう、viewModel と commentEntity.author を返り値に付ける。
 * @param {object} [options]
 * @param {string} [options.id] コメント ID
 * @param {string} [options.text] 本文
 */
function makeThread({ id = 'c1', text = '本文' } = {}) {
  const content = el({ tag: 'yt-attributed-string', text });
  const query = {
    [CONTENT_TEXT_SELECTOR]: content,
    [AUTHOR_LINK_SELECTOR]: el({ tag: 'a', attrs: { href: '/@alice' } }),
  };
  const author = { channelId: null };
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query,
    data: { commentId: id },
    polymerController: { data: {}, __data: { commentEntity: { author } } },
  });
  content.parentElement = viewModel;
  const thread = el({
    tag: 'ytd-comment-thread-renderer',
    children: [el({ id: 'comment-container', children: [viewModel] })],
  });
  thread.content = content;
  thread.viewModel = viewModel;
  thread.author = author;
  return thread;
}

/**
 * 固定の印を後から描画する。
 * @param {any} thread makeThread の結果
 */
function addPinnedBadge(thread) {
  const badge = el({ tag: 'ytw-pinned-comment-badge-renderer' });
  badge.parentElement = thread.viewModel;
  thread.viewModel.query[PINNED_BADGE_SELECTOR] = badge;
  return badge;
}

/**
 * 所有者のデータ（commentEntity.author.isCreator とバッジ）を後から足す。
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
function makeProcessor({ ngWords = [], exempt = ALL, aiMode = 'ready' } = {}) {
  const cacheGets = [];
  const cacheEntries = new Map();
  const logs = [];
  const processor = createThreadProcessor({
    rules: compileRules({ ngWords }),
    exempt,
    cache: {
      get: (id, hash) => {
        cacheGets.push([id, hash]);
        return cacheEntries.get(`${id}:${hash}`) ?? null;
      },
      set: (id, hash, verdict) => cacheEntries.set(`${id}:${hash}`, verdict),
    },
    getAiMode: () => aiMode,
    debugLog: (...args) => logs.push(args),
  });
  return { processor, cacheGets, cacheEntries, logs };
}

test('(a) 条件のデータが無く NG ワードで隠したコメントは、所有者のデータが後から届けば次のスキャンで判定から外す', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'] });
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');
  thread.setAttribute(EXPANDED_ATTR, '');

  addOwnerData(thread);
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
  assert.equal(thread.getAttribute(ID_ATTR), 'c1', 'ID は書き換えない');
  assert.equal(thread.getAttribute(HASH_ATTR), hashString('本文'), '本文のハッシュは書き換えない');
  assert.equal(thread.hasAttribute(EXPANDED_ATTR), true, '条件だけが変わったときは全文表示の固定を外さない');
});

test('(a) AI が隠したコメントも、後から固定されたら次のスキャンで判定から外す', () => {
  const { processor } = makeProcessor();
  const thread = makeThread();
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: true, category: '暴言' }, { id: 'c1', text: '本文' });
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');

  addPinnedBadge(thread);
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});

test('(b) 条件のデータが変わっても判定から外れない AI の判定は、AI に送り直さずに保つ', () => {
  // 認証済みは設定で外していないので、isVerified が届いても判定から外れない
  const { processor, cacheEntries } = makeProcessor({ exempt: { ...ALL, verified: false } });
  const hiddenThread = makeThread({ id: 'h1', text: '隠す本文' });
  const shownThread = makeThread({ id: 's1', text: '出す本文' });
  processor.processThreads([hiddenThread, shownThread]);
  processor.applyVerdict([hiddenThread], 'h1', { hide: true, category: '暴言' }, { id: 'h1', text: '隠す本文' });
  processor.applyVerdict([shownThread], 's1', { hide: false, category: null }, { id: 's1', text: '出す本文' });
  // キャッシュから消えても判定を保つ（判定待ちに戻ると AI に送り直すことになる）
  cacheEntries.clear();

  hiddenThread.author.isVerified = true;
  shownThread.author.isVerified = true;
  assert.deepEqual(processor.processThreads([hiddenThread, shownThread]), [], 'AI に送り直さない');
  assert.equal(hiddenThread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(hiddenThread.getAttribute(REASON_ATTR), 'ai');
  assert.equal(shownThread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(shownThread.getAttribute(REASON_ATTR), null);
});

test('(b) 条件のデータが変わっても判定から外れないルールの判定は、判定し直さずに保つ', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'], exempt: NONE });
  const thread = makeThread();
  processor.processThreads([thread]);
  thread.setAttribute(EXPANDED_ATTR, '');

  addOwnerData(thread);
  addPinnedBadge(thread);
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');
  assert.equal(thread.hasAttribute(EXPANDED_ATTR), true);
});

test('(c) 条件のデータが変わらないコメントは、確定済みとして判定し直さない', () => {
  const { processor, cacheGets, logs } = makeProcessor();
  const thread = makeThread();
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: false, category: null }, { id: 'c1', text: '本文' });

  const getsBefore = cacheGets.length;
  const logsBefore = logs.length;
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(cacheGets.length, getsBefore, 'キャッシュも引かない');
  assert.equal(logs.length, logsBefore, '判定し直していない');
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
});

test('(c) 判定から外す結果を変えない条件のデータが届いても、確定済みとして飛ばして AI の判定を保つ', () => {
  const { processor, cacheGets, logs } = makeProcessor({ exempt: { ...ALL, verified: false } });
  const thread = makeThread();
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: true, category: '暴言' }, { id: 'c1', text: '本文' });
  // 設定で外していない条件のデータが届いても判定から外す結果は変わらないので、判定し直さず AI の判定を保つ
  thread.author.isVerified = true;
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');

  const getsBefore = cacheGets.length;
  const logsBefore = logs.length;
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(cacheGets.length, getsBefore, 'キャッシュも引かない');
  assert.equal(logs.length, logsBefore, '判定し直していない');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');
});

test('(d) revalidate は、判定から外して表示したコメントが外れなくなったら判定前に戻す', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'] });
  const thread = makeThread();
  const badge = addPinnedBadge(thread);
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
  thread.setAttribute(EXPANDED_ATTR, '');

  // ID と本文は同じまま固定の印だけが外れた。判定していない本文が見えたままにならないよう、通知の時点で戻す
  delete thread.viewModel.query[PINNED_BADGE_SELECTOR];
  processor.revalidate([badge.parentElement]);
  assert.equal(thread.getAttribute(STATE_ATTR), null, 'CSS で隠れる判定前に戻す');
  assert.equal(thread.getAttribute(ID_ATTR), 'c1', 'ID は残す');
  assert.equal(thread.getAttribute(HASH_ATTR), hashString('本文'), '本文のハッシュは残す');
  assert.equal(thread.hasAttribute(EXPANDED_ATTR), true, '条件だけが変わったときは全文表示の固定を外さない');

  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');
});

test('(d) revalidate は、隠したコメントに条件のデータが届いたら状態を保ち、次のスキャンで判定から外させる', () => {
  const { processor } = makeProcessor({ ngWords: ['本文'] });
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');

  const badge = addPinnedBadge(thread);
  processor.revalidate([badge]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden', '隠したままで構わないので状態に触れない');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngWord');

  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(REASON_ATTR), 'exempt');
});

test('(d) revalidate は、AI の判定を保つコメントの条件が変わっても判定前に戻さない', () => {
  const { processor, cacheEntries } = makeProcessor({ exempt: { ...ALL, verified: false } });
  const thread = makeThread();
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: true, category: '暴言' }, { id: 'c1', text: '本文' });
  cacheEntries.clear();

  thread.author.isVerified = true;
  processor.revalidate([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');
  assert.deepEqual(processor.processThreads([thread]), [], 'AI に送り直さない');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');
});
