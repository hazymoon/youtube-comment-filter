import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR, REASON_ATTR, STATE_ATTR } from '../src/selectors.js';

// AI に送るコメントには、スキャンした時点の動画のタイトルを付ける。順番待ちの処理時に読むと、遷移の後に
// 別の動画のタイトルが付きうるため。タイトルが読めずに判定した結果は、リロードの後にタイトル付きで判定し直せるよう
// キャッシュに書かない。タイトルを読む関数を渡さないとき（タイトルを使わない）は、従来どおり保存する

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
 * 判定器を作る。動画のタイトルは state.title を返す。
 * @param {object} [options]
 * @param {boolean} [options.withTitle] タイトルを読む関数を渡すか
 */
function makeProcessor({ withTitle = true } = {}) {
  const state = { title: '高速道路で多重事故' };
  const saved = new Map();
  const processor = createThreadProcessor({
    rules: compileRules(),
    cache: {
      get: (id, hash) => saved.get(`${id}:${hash}`) ?? null,
      set: (id, hash, verdict) => saved.set(`${id}:${hash}`, verdict),
    },
    getAiMode: () => 'ready',
    ...(withTitle ? { getVideoTitle: () => state.title } : {}),
  });
  return { processor, state, saved };
}

test('順番待ちに入れるコメントに、スキャンした時点の動画のタイトルを付ける', () => {
  const { processor } = makeProcessor();
  assert.deepEqual(processor.processThreads([makeThread({ text: '良かったですね' })]), [
    { id: 'c1', text: '良かったですね', title: '高速道路で多重事故' },
  ]);
});

test('タイトルが読めないときは title を null にして順番待ちに入れる（判定は止めない）', () => {
  const { processor, state } = makeProcessor();
  state.title = null;
  assert.deepEqual(processor.processThreads([makeThread()]), [{ id: 'c1', text: '本文', title: null }]);
});

test('タイトル付きで判定した結果はキャッシュに書く', () => {
  const { processor, saved } = makeProcessor();
  const thread = makeThread();
  const [item] = processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: false, category: null }, item);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(saved.size, 1);
});

test('タイトル無しで判定した結果は表示に反映するが、キャッシュには書かない', () => {
  const { processor, state, saved } = makeProcessor();
  state.title = null;
  const thread = makeThread();
  const [item] = processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: true, category: '暴言' }, item);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ai');
  assert.equal(saved.size, 0);
});

test('タイトルを読む関数を渡さないときは title を付けず、判定結果をキャッシュに書く', () => {
  const { processor, saved } = makeProcessor({ withTitle: false });
  const thread = makeThread();
  const items = processor.processThreads([thread]);
  assert.deepEqual(items, [{ id: 'c1', text: '本文' }]);
  processor.applyVerdict([thread], 'c1', { hide: false, category: null }, items[0]);
  assert.equal(saved.size, 1);
});

test('AI を使わない状態ではタイトルを読まない', () => {
  let reads = 0;
  for (const mode of ['disabled', 'failed']) {
    const processor = createThreadProcessor({
      rules: compileRules(),
      cache: { get: () => null, set() {} },
      getAiMode: () => mode,
      getVideoTitle: () => {
        reads += 1;
        return '高速道路で多重事故';
      },
    });
    processor.processThreads([makeThread()]);
  }
  assert.equal(reads, 0);
});

test('タイトルの読み取りが例外を投げても、タイトル無しとして判定を続ける', () => {
  const processor = createThreadProcessor({
    rules: compileRules(),
    cache: { get: () => null, set() {} },
    getAiMode: () => 'ready',
    getVideoTitle: () => {
      throw new Error('unexpected');
    },
  });
  const thread = makeThread();
  assert.deepEqual(processor.processThreads([thread]), [{ id: 'c1', text: '本文', title: null }]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'pending');
});

test('読んだタイトルが変わったときだけ、判定の経過に出す（読めないことに気づけるように）', () => {
  const logs = [];
  const state = { title: null };
  const processor = createThreadProcessor({
    rules: compileRules(),
    cache: { get: () => null, set() {} },
    getAiMode: () => 'ready',
    getVideoTitle: () => state.title,
    debugLog: (...args) => logs.push(args),
  });
  const titleLogs = () => logs.filter(([label]) => label === '動画のタイトル');
  processor.processThreads([makeThread({ id: 'c1' })]);
  processor.processThreads([makeThread({ id: 'c2' })]);
  assert.deepEqual(titleLogs(), [['動画のタイトル', null]], '読めないことを 1 度だけ出す');
  state.title = '高速道路で多重事故';
  processor.processThreads([makeThread({ id: 'c3' })]);
  assert.deepEqual(titleLogs().at(-1), ['動画のタイトル', '高速道路で多重事故']);
});
