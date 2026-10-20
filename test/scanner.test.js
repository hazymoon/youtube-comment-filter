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
  REASON_ATTR,
  STATE_ATTR,
} from '../src/selectors.js';

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
    query,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
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
 * 偽の thread を作る。content（本文の要素）と viewModel を返り値に付ける。
 * @param {object} [options]
 */
function makeThread({ id = 'c1', text = '本文', handle = '/@alice', replies = [] } = {}) {
  const content = el({ tag: 'yt-attributed-string', text });
  const query = { [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: el({ tag: 'a' }) };
  query[AUTHOR_LINK_SELECTOR].setAttribute('href', handle);
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query,
    data: { commentId: id },
    polymerController: { data: {}, __data: { commentEntity: { author: { channelId: null } } } },
  });
  content.parentElement = viewModel;
  const children = [el({ id: 'comment-container', children: [viewModel] })];
  if (replies.length > 0) {
    const renderer = el({ tag: 'ytd-comment-replies-renderer', children: replies });
    children.push(el({ id: 'replies', children: [renderer] }));
  }
  const thread = el({ tag: 'ytd-comment-thread-renderer', children });
  thread.content = content;
  thread.viewModel = viewModel;
  return thread;
}

/**
 * 判定器を作る。
 * @param {object} [options]
 */
function makeProcessor({ aiMode = 'ready', ngUsers = [], ngWords = [] } = {}) {
  const cacheSets = [];
  const cacheEntries = new Map();
  const state = { aiMode };
  const processor = createThreadProcessor({
    rules: compileRules({ ngUsers, ngWords }),
    cache: {
      get: (id, hash) => cacheEntries.get(`${id}:${hash}`) ?? null,
      set: (id, hash, verdict) => {
        cacheSets.push([id, hash, verdict]);
        cacheEntries.set(`${id}:${hash}`, verdict);
      },
    },
    getAiMode: () => state.aiMode,
  });
  return { processor, cacheSets, state };
}

test('判定前の本文は順番待ちに入り、判定が出たら表示になる', () => {
  const { processor, cacheSets } = makeProcessor();
  const thread = makeThread();
  assert.deepEqual(processor.processThreads([thread]), [{ id: 'c1', text: '本文' }]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
  assert.equal(thread.getAttribute(REASON_ATTR), 'awaiting-ai');

  const result = processor.applyVerdict([thread], 'c1', { hide: false, category: null }, { id: 'c1', text: '本文' });
  assert.deepEqual(result, { needsRescan: false });
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.deepEqual(cacheSets, [['c1', hashString('本文'), { hide: false, category: null }]]);
});

test('判定が返る前に本文が変わったら、属性のハッシュが古いままでも表示にせず、保存もせず再スキャンを求める', () => {
  const { processor, cacheSets } = makeProcessor();
  const thread = makeThread();
  processor.processThreads([thread]);
  // 次のスキャンより先に本文が差し替わり、そこへ古い本文の判定が返る
  thread.content.textContent = '差し替わった本文';
  const result = processor.applyVerdict([thread], 'c1', { hide: false, category: null }, { id: 'c1', text: '本文' });
  assert.deepEqual(result, { needsRescan: true });
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
  assert.deepEqual(cacheSets, [], '本文が変わっていたら保存しない');
});

test('同じ ID の thread が DOM に無ければ判定は保存する', () => {
  const { processor, cacheSets } = makeProcessor();
  processor.applyVerdict([], 'gone', { hide: true, category: '暴言' }, { id: 'gone', text: 'x' });
  assert.equal(cacheSets.length, 1);
});

test('判定待ちの通知のときに本文が変わっていたら、再スキャンを求める', () => {
  const { processor } = makeProcessor();
  const thread = makeThread();
  processor.processThreads([thread]);
  thread.content.textContent = '差し替わった本文';
  const result = processor.applyPending([thread], 'c1', { id: 'c1', text: '本文' });
  assert.deepEqual(result, { needsRescan: true });
  assert.equal(thread.getAttribute(REASON_ATTR), 'awaiting-ai');
});

test('判定待ちの通知は、本文が同じなら ai-unresolved にする', () => {
  const { processor } = makeProcessor();
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.deepEqual(processor.applyPending([thread], 'c1', { id: 'c1', text: '本文' }), { needsRescan: false });
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai-unresolved');
  // 次のスキャンでは判定し直しとして新しいコメントの後に回す
  const fresh = makeThread({ id: 'c2', text: '新しい' });
  assert.deepEqual(processor.processThreads([thread, fresh]), [
    { id: 'c2', text: '新しい' },
    { id: 'c1', text: '本文' },
  ]);
});

test('表示に決めた thread の本文が差し替わったら、変化の通知の時点で同期的に判定前に戻す', () => {
  const { processor } = makeProcessor({ aiMode: 'disabled' });
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  thread.setAttribute(EXPANDED_ATTR, '');

  // Polymer が要素を使い回して別のコメントを入れた
  thread.viewModel.data = { commentId: 'c9' };
  thread.content.textContent = '別のコメント';
  const textNode = { nodeType: 3, parentElement: thread.content };
  processor.revalidate([textNode]);
  assert.equal(thread.getAttribute(STATE_ATTR), null, 'CSS で隠れる判定前に戻す');
  assert.equal(thread.hasAttribute(EXPANDED_ATTR), false);

  // その後のスキャンで判定し直す
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(ID_ATTR), 'c9');
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
});

test('空の本文で表示に決めた後に本文が入ったら、変化の通知の時点で判定前に戻す', () => {
  const { processor } = makeProcessor();
  const thread = makeThread({ text: '' });
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  thread.content.textContent = '遅れて入った本文';
  processor.revalidate([thread.content]);
  assert.equal(thread.getAttribute(STATE_ATTR), null);
});

test('変化の通知で ID も本文も同じなら状態に触れない', () => {
  const { processor } = makeProcessor({ aiMode: 'disabled' });
  const thread = makeThread();
  processor.processThreads([thread]);
  processor.revalidate([thread.content, thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
});

test('1 件の読み取りで例外が出ても、その thread を判定待ちにして残りを続ける', () => {
  const { processor } = makeProcessor({ aiMode: 'disabled' });
  const broken = makeThread({ id: 'bad' });
  broken.viewModel.querySelector = () => {
    throw new Error('boom');
  };
  const ok = makeThread({ id: 'ok' });
  assert.doesNotThrow(() => processor.processThreads([broken, ok]));
  assert.equal(broken.getAttribute(STATE_ATTR), 'pending');
  assert.equal(broken.getAttribute(REASON_ATTR), 'unreadable');
  assert.equal(ok.getAttribute(STATE_ATTR), 'shown');
});

test('件数の集計では、状態の属性がまだ無い thread を判定中に数える', () => {
  const { processor } = makeProcessor();
  const counts = processor.countThreads([makeThread()]);
  assert.equal(counts.judging, 1);
});

test('要素が使い回されて ID が変わったら、全文表示の固定を外して判定し直す', () => {
  const { processor } = makeProcessor({ aiMode: 'disabled' });
  const thread = makeThread();
  processor.processThreads([thread]);
  thread.setAttribute(EXPANDED_ATTR, '');
  thread.viewModel.data = { commentId: 'c2' };
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(ID_ATTR), 'c2');
  assert.equal(thread.hasAttribute(EXPANDED_ATTR), false);
});

test('読めない thread は判定待ちにし、読めるようになったら判定し直す', () => {
  const { processor } = makeProcessor({ aiMode: 'disabled' });
  const thread = makeThread();
  const content = thread.viewModel.query[CONTENT_TEXT_SELECTOR];
  delete thread.viewModel.query[CONTENT_TEXT_SELECTOR];
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
  assert.equal(thread.getAttribute(REASON_ATTR), 'unreadable');
  assert.equal(processor.countThreads([thread]).pending, 1);

  thread.viewModel.query[CONTENT_TEXT_SELECTOR] = content;
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(HASH_ATTR), hashString('本文'));
});

test('親が NG なら返信は判定も集計もせず、スレッド 1 件として数える', () => {
  const { processor } = makeProcessor({ ngUsers: ['@troll'] });
  const reply = makeThread({ id: 'r1', text: '返信' });
  const parent = makeThread({ id: 'p1', handle: '/@troll', replies: [reply] });
  assert.deepEqual(processor.processThreads([parent, reply]), []);
  assert.equal(parent.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(reply.getAttribute(STATE_ATTR), null);
  const counts = processor.countThreads([parent, reply]);
  assert.equal(counts.ngUser, 1);
  assert.equal(counts.judging, 0);
});

test('AI が失敗したら、判定中だったコメントは次のスキャンで表示に戻る', () => {
  const { processor, state } = makeProcessor();
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
  state.aiMode = 'failed';
  assert.deepEqual(processor.processThreads([thread]), []);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
});

test('キャッシュに判定があれば順番待ちに入れずに従う', () => {
  const { processor } = makeProcessor();
  const first = makeThread();
  processor.processThreads([first]);
  processor.applyVerdict([first], 'c1', { hide: true, category: '暴言' }, { id: 'c1', text: '本文' });
  const again = makeThread();
  assert.deepEqual(processor.processThreads([again]), []);
  assert.equal(again.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(again.getAttribute(REASON_ATTR), 'ai');
});

test('thread の外の要素が通知されたら、その中の thread も確かめる（入れ物ごと差し込まれたとき）', () => {
  const { processor } = makeProcessor({ aiMode: 'disabled' });
  const thread = makeThread();
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');

  // 切り離している間に中身が別のコメントに差し替わり、入れ物ごと差し込み直された
  thread.viewModel.data = { commentId: 'c9' };
  thread.content.textContent = '別のコメント';
  const container = el({ tag: 'div', id: 'contents' });
  container.querySelectorAll = (selector) => (selector === 'ytd-comment-thread-renderer' ? [thread] : []);
  processor.revalidate([container]);
  assert.equal(thread.getAttribute(STATE_ATTR), null, 'CSS で隠れる判定前に戻す');
});
