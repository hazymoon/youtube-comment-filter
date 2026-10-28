import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

// Shorts で次の動画へ移った直後は、前の動画の判定待ちのコメントがまだ DOM に残っていて、遷移の完了後のスキャンで
// 順番待ちに入りうる。取り出す時点でもう判定の要らないコメントは AI に送らず飛ばす（次の動画の判定が後回しにならないように）

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/**
 * 偽の cloneSession。prompt はテストが応答するまで待つ。
 * @returns {{ calls: { texts: string[], answer: () => void }[], cloneSession: () => Promise<object> }}
 */
function createHarness() {
  const calls = [];
  const cloneSession = async () => ({
    prompt(input) {
      return new Promise((resolve) => {
        const payload = JSON.parse(input.slice(input.indexOf('\n') + 1));
        calls.push({
          texts: payload.map((item) => item.text),
          answer: () => resolve(JSON.stringify(payload.map((item) => ({ id: item.id, hide: false, category: null })))),
        });
      });
    },
    destroy() {},
  });
  return { calls, cloneSession };
}

/**
 * prompt が count 回呼ばれるまで待つ。
 * @param {{ calls: unknown[] }} h ハーネス
 * @param {number} count 待つ件数
 */
async function waitForCalls(h, count) {
  for (let i = 0; i < 100 && h.calls.length < count; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(h.calls.length, count, `prompt が ${count} 回呼ばれるはず`);
}

/** マイクロタスクとタイマーを一巡させる。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('取り出す時点で判定の要らなくなったコメントは、AI に送らずに飛ばす', async () => {
  const h = createHarness();
  const wanted = new Set(['a', 'b', 'c']);
  const verdicts = [];
  const queue = createAiQueue({
    cloneSession: h.cloneSession,
    batchSize: 1,
    timeoutMs: 1000,
    maxChars: 500,
    categories: CATEGORIES,
    onVerdict: (id) => verdicts.push(id),
    onPending() {},
    onFatal() {},
    createTimeoutSignal: () => new AbortController().signal,
    isWanted: (id) => wanted.has(id),
  });
  queue.enqueue([
    { id: 'a', text: '本文 a' },
    { id: 'b', text: '本文 b' },
    { id: 'c', text: '本文 c' },
  ]);

  await waitForCalls(h, 1);
  assert.deepEqual(h.calls[0].texts, ['本文 a']);
  // a の判定中に、b のコメントが DOM から消える
  wanted.delete('b');
  h.calls[0].answer();

  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].texts, ['本文 c'], 'b を飛ばして c を判定する');
  h.calls[1].answer();
  await settle();
  assert.equal(h.calls.length, 2, 'b は AI に送らない');
  assert.deepEqual(verdicts, ['a', 'c']);
  assert.equal(queue.size(), 0, '飛ばしたものは待ち行列にも処理中にも残さない');
});

test('飛ばしたコメントも、後で enqueue し直せば判定する', async () => {
  const h = createHarness();
  const wanted = new Set();
  const queue = createAiQueue({
    cloneSession: h.cloneSession,
    batchSize: 1,
    timeoutMs: 1000,
    maxChars: 500,
    categories: CATEGORIES,
    onVerdict() {},
    onPending() {},
    onFatal() {},
    createTimeoutSignal: () => new AbortController().signal,
    isWanted: (id) => wanted.has(id),
  });
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.calls.length, 0, '要らないので送らない');

  wanted.add('a');
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await waitForCalls(h, 1);
  assert.deepEqual(h.calls[0].texts, ['本文 a']);
});
