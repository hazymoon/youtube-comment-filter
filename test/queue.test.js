import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

const CATEGORIES = [
  { name: '暴言', description: '乱暴な言葉' },
  { name: '煽り・挑発', description: '挑発' },
];

/**
 * 偽の LanguageModel と、順番待ちの観測用の記録を作る。
 * prompt はテストが answer / fail するまで待つ。
 * @param {{ ignoreAbort?: boolean, cloneError?: Error }} [options]
 */
function createHarness(options = {}) {
  const calls = [];
  const timeouts = [];
  const verdicts = [];
  const pending = [];
  const fatals = [];
  const stats = { active: 0, maxActive: 0, clones: 0, destroys: 0 };

  const cloneSession = async () => {
    if (options.cloneError) throw options.cloneError;
    stats.clones += 1;
    let destroyed = false;
    return {
      prompt(input, promptOptions) {
        stats.active += 1;
        stats.maxActive = Math.max(stats.maxActive, stats.active);
        return new Promise((resolve, reject) => {
          const payload = JSON.parse(input.slice(input.indexOf('\n') + 1));
          calls.push({ input, payload, options: promptOptions, resolve, reject, isDestroyed: () => destroyed });
          if (!options.ignoreAbort) {
            promptOptions.signal.addEventListener('abort', () => reject(promptOptions.signal.reason), { once: true });
          }
        }).finally(() => {
          stats.active -= 1;
        });
      },
      destroy() {
        destroyed = true;
        stats.destroys += 1;
      },
    };
  };

  return {
    calls,
    timeouts,
    verdicts,
    pending,
    fatals,
    stats,
    options: {
      cloneSession,
      timeoutMs: 1000,
      maxChars: 500,
      categories: CATEGORIES,
      onVerdict: (id, verdict) => verdicts.push([id, verdict]),
      onPending: (id) => pending.push(id),
      onFatal: (error) => fatals.push(error),
      createTimeoutSignal: () => {
        const controller = new AbortController();
        timeouts.push(controller);
        return controller.signal;
      },
    },
  };
}

/** マイクロタスクとタイマーを一巡させる。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * n 件目の prompt 呼び出しを待つ。
 * @param {{ calls: unknown[] }} h ハーネス
 * @param {number} count 待つ件数
 */
async function waitForCalls(h, count) {
  for (let i = 0; i < 100 && h.calls.length < count; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(h.calls.length, count, `prompt が ${count} 回呼ばれるはず`);
}

/**
 * 呼び出しに応答する。
 * @param {{ payload: { id: string, text: string }[], resolve: (v: string) => void }} call 呼び出し
 * @param {(item: { id: string, text: string }) => object|null} [decide] 要素ごとの応答。null なら欠落させる
 */
function answer(call, decide = (item) => ({ id: item.id, hide: item.text.includes('NG'), category: item.text.includes('NG') ? '暴言' : null })) {
  call.resolve(JSON.stringify(call.payload.map(decide).filter((v) => v !== null)));
}

function items(...ids) {
  return ids.map((id) => ({ id, text: `本文 ${id}` }));
}

function timeoutError() {
  return new DOMException('timed out', 'TimeoutError');
}

test('batchSize 件ずつに分けて直列に処理し、セッションを必ず destroy する', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue([...items('a', 'b', 'c', 'd', 'e'), { id: 'f', text: 'NG です' }, { id: 'g', text: '普通' }]);
  assert.equal(queue.size(), 7);

  await waitForCalls(h, 1);
  assert.deepEqual(h.calls[0].payload.map((v) => v.id), ['c0', 'c1', 'c2']);
  assert.equal(h.calls[0].options.omitResponseConstraintInput, true);
  assert.equal(h.calls[0].options.responseConstraint.items.properties.category.enum.at(-1), null);
  assert.ok(h.calls[0].options.signal instanceof AbortSignal);
  await settle();
  assert.equal(h.calls.length, 1, '前のバッチが終わるまで次を投げない');

  answer(h.calls[0]);
  await waitForCalls(h, 2);
  assert.equal(h.calls[0].isDestroyed(), true);
  assert.equal(h.calls[1].payload.length, 3);
  answer(h.calls[1]);
  await waitForCalls(h, 3);
  assert.equal(h.calls[2].payload.length, 1);
  answer(h.calls[2]);
  await settle();

  assert.equal(h.stats.maxActive, 1);
  assert.equal(h.stats.clones, 3);
  assert.equal(h.stats.destroys, 3);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(h.verdicts[5], ['f', { hide: true, category: '暴言' }]);
  assert.deepEqual(h.pending, []);
  assert.equal(queue.size(), 0);
});

test('応答から欠けたコメントは 1 件ずつ 1 回だけ再判定し、それでも欠けたら onPending', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 4 });
  queue.enqueue(items('a', 'b', 'c', 'd'));
  await waitForCalls(h, 1);
  // b and d are missing.
  answer(h.calls[0], (item) => (item.id === 'c1' || item.id === 'c3' ? null : { id: item.id, hide: false, category: null }));

  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].payload, [{ id: 'c0', text: '本文 b' }]);
  answer(h.calls[1]);
  await waitForCalls(h, 3);
  assert.deepEqual(h.calls[2].payload, [{ id: 'c0', text: '本文 d' }]);
  h.calls[2].resolve('壊れた応答');
  await settle();

  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['a', 'c', 'b']);
  assert.deepEqual(h.pending, ['d']);
  assert.equal(h.stats.destroys, 3);
  assert.equal(queue.size(), 0);
});

test('タイムアウトしたバッチは全件 onPending にし、末尾に 1 回だけ入れ直す', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a', 'b', 'c', 'd'));
  await waitForCalls(h, 1);
  h.timeouts[0].abort(timeoutError());
  await waitForCalls(h, 2);
  assert.deepEqual(h.pending, ['a', 'b']);
  assert.equal(h.calls[0].isDestroyed(), true);
  // Requeued at the tail: c, d come first.
  assert.deepEqual(h.calls[1].payload.map((v) => v.text), ['本文 c', '本文 d']);
  answer(h.calls[1]);

  await waitForCalls(h, 3);
  assert.deepEqual(h.calls[2].payload.map((v) => v.text), ['本文 a', '本文 b']);
  assert.equal(queue.size(), 2);
  h.timeouts[2].abort(timeoutError());
  await settle();

  assert.equal(h.calls.length, 3, '2 回目のタイムアウトでは入れ直さない');
  assert.deepEqual(h.pending, ['a', 'b', 'a', 'b']);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['c', 'd']);
  assert.deepEqual(h.fatals, []);
  assert.equal(queue.size(), 0);
});

test('入れ直した後に判定できれば onVerdict が出る', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 5 });
  queue.enqueue(items('a'));
  await waitForCalls(h, 1);
  h.timeouts[0].abort(timeoutError());
  await waitForCalls(h, 2);
  answer(h.calls[1]);
  await settle();
  assert.deepEqual(h.pending, ['a']);
  assert.deepEqual(h.verdicts, [['a', { hide: false, category: null }]]);
});

test('タイムアウト以外の例外は onFatal を呼び、以降の enqueue を無視する', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a', 'b', 'c'));
  await waitForCalls(h, 1);
  const error = new DOMException('kErrorUnknown', 'UnknownError');
  h.calls[0].reject(error);
  await settle();

  assert.deepEqual(h.fatals, [error]);
  assert.equal(h.calls[0].isDestroyed(), true);
  assert.equal(queue.size(), 0);
  queue.enqueue(items('x'));
  queue.reset();
  queue.enqueue(items('y'));
  await settle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.verdicts, []);
  assert.deepEqual(h.pending, []);
});

test('cloneSession の失敗も onFatal にする', async () => {
  const error = new Error('NotAllowedError');
  const h = createHarness({ cloneError: error });
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a'));
  await settle();
  assert.deepEqual(h.fatals, [error]);
  queue.enqueue(items('b'));
  await settle();
  assert.equal(h.fatals.length, 1);
});

test('reset は実行中の prompt を中断し、古い結果を流さない。reset 後の enqueue は普通に動く', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a', 'b', 'c'));
  await waitForCalls(h, 1);
  queue.reset();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(queue.size(), 0);
  queue.enqueue(items('x'));
  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].payload.map((v) => v.text), ['本文 x']);
  answer(h.calls[1]);
  await settle();

  assert.equal(h.calls[0].isDestroyed(), true);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['x']);
  assert.deepEqual(h.pending, []);
  assert.deepEqual(h.fatals, []);
  assert.equal(h.stats.maxActive, 1);
});

test('中断を無視して遅れて返った結果も、reset 後なら流さず、次の判定はその後に始める', async () => {
  const h = createHarness({ ignoreAbort: true });
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a', 'b'));
  await waitForCalls(h, 1);
  queue.reset();
  queue.enqueue(items('x'));
  await settle();
  assert.equal(h.calls.length, 1, '古い prompt が終わるまで新しい prompt を投げない');
  answer(h.calls[0]);
  await waitForCalls(h, 2);
  answer(h.calls[1]);
  await settle();
  assert.deepEqual(h.verdicts.map(([id]) => id), ['x']);
  assert.equal(h.stats.maxActive, 1);
});

test('reset 前に始まったバッチのタイムアウトは onPending に流さない', async () => {
  const h = createHarness({ ignoreAbort: true });
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a'));
  await waitForCalls(h, 1);
  queue.reset();
  h.calls[0].reject(new DOMException('aborted', 'AbortError'));
  await settle();
  assert.deepEqual(h.pending, []);
  assert.deepEqual(h.fatals, []);
});

test('待ち行列か処理中に同じ id があれば重ねない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 1 });
  queue.enqueue(items('a', 'b', 'a'));
  queue.enqueue(items('b'));
  assert.equal(queue.size(), 2);
  await waitForCalls(h, 1);
  queue.enqueue(items('a')); // in flight
  assert.equal(queue.size(), 2);
  answer(h.calls[0]);
  await waitForCalls(h, 2);
  answer(h.calls[1]);
  await settle();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['a', 'b']);

  // Once finished, the same id can be enqueued again (e.g. after the text changed).
  queue.enqueue(items('a'));
  await waitForCalls(h, 3);
});

test('batchSize 1 では 1 件ずつ判定し、欠落は 1 回だけ再判定する', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 1 });
  queue.enqueue(items('a', 'b'));
  await waitForCalls(h, 1);
  assert.equal(h.calls[0].payload.length, 1);
  h.calls[0].resolve('[]');
  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].payload, [{ id: 'c0', text: '本文 a' }]);
  h.calls[1].resolve('[]');
  await waitForCalls(h, 3);
  assert.deepEqual(h.calls[2].payload, [{ id: 'c0', text: '本文 b' }]);
  answer(h.calls[2]);
  await settle();
  assert.deepEqual(h.pending, ['a']);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['b']);
  assert.equal(h.stats.destroys, 3);
});

test('onVerdict の中で reset されたら、同じバッチの残りの判定を流さない', async () => {
  const h = createHarness();
  let queue;
  const log = [];
  queue = createAiQueue({
    ...h.options,
    batchSize: 2,
    onVerdict: (id) => {
      log.push(['v', id]);
      if (id === 'a') queue.reset();
    },
    onPending: (id) => log.push(['p', id]),
  });
  queue.enqueue(items('a', 'b'));
  await waitForCalls(h, 1);
  answer(h.calls[0]);
  await settle();
  assert.deepEqual(log, [['v', 'a']]);
  assert.equal(queue.size(), 0);
});

test('onPending の中で reset されたら、同じバッチの残りを流さない', async () => {
  const h = createHarness();
  let queue;
  const log = [];
  queue = createAiQueue({
    ...h.options,
    batchSize: 2,
    onVerdict: (id) => log.push(['v', id]),
    onPending: (id) => {
      log.push(['p', id]);
      if (id === 'a') queue.reset();
    },
  });
  queue.enqueue(items('a', 'b'));
  await waitForCalls(h, 1);
  h.timeouts[0].abort(timeoutError());
  await settle();
  assert.deepEqual(log, [['p', 'a']]);
  assert.equal(h.calls.length, 1, 'reset 後に入れ直したものを判定しない');
  assert.equal(queue.size(), 0);
});

test('欠落の再判定がタイムアウトして入れ直された後に再び欠けても、再判定を重ねない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a', 'b'));
  await waitForCalls(h, 1);
  answer(h.calls[0], (item) => (item.id === 'c1' ? null : { id: item.id, hide: false, category: null }));
  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].payload, [{ id: 'c0', text: '本文 b' }]);
  h.timeouts[1].abort(timeoutError());
  await waitForCalls(h, 3);
  assert.deepEqual(h.calls[2].payload, [{ id: 'c0', text: '本文 b' }]);
  h.calls[2].resolve('[]');
  await settle();

  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['a']);
  assert.deepEqual(h.pending, ['b', 'b']);
  assert.equal(h.stats.destroys, 3);
  assert.equal(queue.size(), 0);
});

test('欠落の再判定中に reset されたら、その結果を流さない', async () => {
  const h = createHarness({ ignoreAbort: true });
  const queue = createAiQueue({ ...h.options, batchSize: 2 });
  queue.enqueue(items('a', 'b'));
  await waitForCalls(h, 1);
  answer(h.calls[0], (item) => (item.id === 'c1' ? null : { id: item.id, hide: false, category: null }));
  await waitForCalls(h, 2);
  queue.reset();
  answer(h.calls[1]);
  await settle();

  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['a']);
  assert.deepEqual(h.pending, []);
  assert.equal(h.stats.destroys, 2);
  assert.equal(queue.size(), 0);
});

test('onVerdict / onPending に判定に使ったコメント（id と本文）を渡す', async () => {
  const h = createHarness();
  const log = [];
  const queue = createAiQueue({
    ...h.options,
    batchSize: 2,
    onVerdict: (id, verdict, item) => log.push(['v', id, item]),
    onPending: (id, item) => log.push(['p', id, item]),
  });
  queue.enqueue([{ id: 'a', text: '本文 a' }, { id: 'b', text: '本文 b' }]);
  await waitForCalls(h, 1);
  answer(h.calls[0], (item) => (item.id === 'c1' ? null : { id: item.id, hide: false, category: null }));
  await waitForCalls(h, 2);
  h.calls[1].resolve('[]');
  await settle();
  assert.deepEqual(log, [
    ['v', 'a', { id: 'a', text: '本文 a' }],
    ['p', 'b', { id: 'b', text: '本文 b' }],
  ]);
});
