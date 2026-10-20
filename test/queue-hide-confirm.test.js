import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

// まとめて判定したバッチで hide:true になったコメントは、1 件だけのバッチで判定し直してから結果を流す。
// 本文に埋めた指示で同じバッチの他のコメントを隠させる経路を、隠す側の判定についてだけ塞ぐため。

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

function createHarness() {
  const calls = [];
  const timeouts = [];
  const verdicts = [];
  const pending = [];
  const fatals = [];
  const cloneSession = async () => ({
    prompt(input, promptOptions) {
      return new Promise((resolve, reject) => {
        const payload = JSON.parse(input.slice(input.indexOf('\n') + 1));
        calls.push({ payload, resolve });
        promptOptions.signal.addEventListener('abort', () => reject(promptOptions.signal.reason), { once: true });
      });
    },
    destroy() {},
  });
  return {
    calls,
    timeouts,
    verdicts,
    pending,
    fatals,
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

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function waitForCalls(h, count) {
  for (let i = 0; i < 100 && h.calls.length < count; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(h.calls.length, count, `prompt が ${count} 回呼ばれるはず`);
}

/** 本文に NG を含むものだけ hide:true と答える。 */
function answerByText(call) {
  call.resolve(JSON.stringify(call.payload.map((item) => ({
    id: item.id,
    hide: item.text.includes('NG'),
    category: item.text.includes('NG') ? '暴言' : null,
  }))));
}

function answerAll(call, hide) {
  call.resolve(JSON.stringify(call.payload.map((item) => ({ id: item.id, hide, category: hide ? '暴言' : null }))));
}

const BATCH = [
  { id: 'a', text: '普通 a' },
  { id: 'b', text: 'NG b' },
  { id: 'c', text: '普通 c' },
];

test('まとめた判定で hide:true のコメントは、1 件ずつ判定し直し、隠さない判定ならそれを流す', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue(BATCH);
  await waitForCalls(h, 1);
  answerByText(h.calls[0]);

  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].payload, [{ id: 'c0', text: 'NG b' }]);
  assert.deepEqual(h.verdicts.map(([id]) => id), ['a', 'c'], '隠さない判定は再判定を待たずに流す');
  answerAll(h.calls[1], false);
  await settle();

  assert.deepEqual(h.verdicts, [
    ['a', { hide: false, category: null }],
    ['c', { hide: false, category: null }],
    ['b', { hide: false, category: null }],
  ]);
  assert.deepEqual(h.pending, []);
  assert.equal(queue.size(), 0);
});

test('1 件ずつの再判定でも hide:true なら隠す判定を流す', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue(BATCH);
  await waitForCalls(h, 1);
  answerByText(h.calls[0]);
  await waitForCalls(h, 2);
  answerByText(h.calls[1]);
  await settle();

  assert.deepEqual(h.verdicts.at(-1), ['b', { hide: true, category: '暴言' }]);
  assert.equal(h.calls.length, 2);
  assert.equal(queue.size(), 0);
});

test('全件が hide:true なら全件を 1 件ずつ判定し直す', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue(BATCH);
  await waitForCalls(h, 1);
  answerAll(h.calls[0], true);
  for (let n = 2; n <= 4; n += 1) {
    await waitForCalls(h, n);
    assert.equal(h.calls[n - 1].payload.length, 1);
    answerAll(h.calls[n - 1], n === 3);
  }
  await settle();

  assert.deepEqual(h.verdicts.map(([id, v]) => [id, v.hide]), [['a', false], ['b', true], ['c', false]]);
});

test('batchSize 1 の判定と、1 件だけのバッチの判定は判定し直さない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 1 });
  queue.enqueue([{ id: 'b', text: 'NG b' }]);
  await waitForCalls(h, 1);
  answerByText(h.calls[0]);
  await settle();

  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.verdicts, [['b', { hide: true, category: '暴言' }]]);
});

test('再判定がタイムアウトしたら判定待ちにし、隠す判定は流さない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue(BATCH);
  await waitForCalls(h, 1);
  answerByText(h.calls[0]);
  await waitForCalls(h, 2);
  h.timeouts[1].abort(new DOMException('timed out', 'TimeoutError'));
  await settle();

  assert.deepEqual(h.pending, ['b']);
  assert.ok(!h.verdicts.some(([id]) => id === 'b'));
  assert.deepEqual(h.fatals, []);
});

test('再判定の応答から欠けたら判定待ちにし、隠す判定は流さない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue(BATCH);
  await waitForCalls(h, 1);
  answerByText(h.calls[0]);
  await waitForCalls(h, 2);
  h.calls[1].resolve('[]');
  await settle();

  assert.ok(!h.verdicts.some(([id]) => id === 'b'));
  assert.deepEqual(h.pending, ['b']);
  assert.equal(queue.size(), 0);
});

test('再判定中に reset されたら、その結果を流さない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 3 });
  queue.enqueue(BATCH);
  await waitForCalls(h, 1);
  answerByText(h.calls[0]);
  await waitForCalls(h, 2);
  queue.reset();
  answerByText(h.calls[1]);
  await settle();

  assert.ok(!h.verdicts.some(([id]) => id === 'b'));
  assert.deepEqual(h.pending, []);
});
