import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/** 偽のセッションを持つ順番待ちの部品。prompt はテストが応答するまで待つ。 */
function createHarness() {
  const calls = [];
  const verdicts = [];
  const pending = [];
  return {
    calls,
    verdicts,
    pending,
    options: {
      async cloneSession() {
        return {
          prompt(input) {
            return new Promise((resolve) => {
              calls.push({ payload: JSON.parse(input.slice(input.indexOf('\n') + 1)), resolve });
            });
          },
          destroy() {},
        };
      },
      batchSize: 5,
      timeoutMs: 1000,
      maxChars: 500,
      categories: CATEGORIES,
      onVerdict: (id, verdict) => verdicts.push([id, verdict]),
      onPending: (id) => pending.push(id),
      onFatal: () => {},
      createTimeoutSignal: () => new AbortController().signal,
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('判定が出たら欠落の再判定済みの印も消し、後で再び enqueue されて欠落したらまた 1 件で再判定する', async () => {
  const h = createHarness();
  const queue = createAiQueue(h.options);
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.calls.length, 1);

  // 欠落 → 1 件で再判定 → 判定が出る
  h.calls[0].resolve('[]');
  await settle();
  assert.equal(h.calls.length, 2, '欠落したので 1 件で再判定する');
  h.calls[1].resolve(JSON.stringify([{ id: 'c0', hide: false, category: null }]));
  await settle();
  assert.deepEqual(h.verdicts, [['a', { hide: false, category: null }]]);
  assert.deepEqual(h.pending, []);

  // 再び enqueue され、また欠落したら、もう一度 1 件で再判定する
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.calls.length, 3);
  h.calls[2].resolve('[]');
  await settle();
  assert.equal(h.calls.length, 4, '判定が出た後の欠落でも 1 件で再判定する');
  assert.deepEqual(h.pending, []);

  // 再判定でも欠落したら判定待ち
  h.calls[3].resolve('[]');
  await settle();
  assert.deepEqual(h.pending, ['a']);
  assert.equal(queue.size(), 0);
});
