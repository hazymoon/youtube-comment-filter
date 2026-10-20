import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/**
 * 偽の LanguageModel を持つ順番待ちの部品を作る。prompt はテストが応答するまで待つ。
 * @param {{ cloneGate?: Promise<void> }} [options] cloneGate を渡すと、clone はそれが解決するまで待つ
 */
function createHarness(options = {}) {
  const calls = [];
  const timeouts = [];
  const verdicts = [];
  const pending = [];
  const fatals = [];
  return {
    calls,
    timeouts,
    verdicts,
    pending,
    fatals,
    options: {
      async cloneSession() {
        if (options.cloneGate) await options.cloneGate;
        return {
          prompt(input, promptOptions) {
            return new Promise((resolve, reject) => {
              const payload = JSON.parse(input.slice(input.indexOf('\n') + 1));
              calls.push({ payload, resolve });
              promptOptions.signal.addEventListener('abort', () => reject(promptOptions.signal.reason), { once: true });
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
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function timeoutError() {
  return new DOMException('timed out', 'TimeoutError');
}

test('判定が出たら再試行の回数を消し、後で再び enqueue されたコメントはタイムアウトでまた入れ直される', async () => {
  const h = createHarness();
  const queue = createAiQueue(h.options);
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.calls.length, 1);

  // 1 回目のタイムアウト: 入れ直される
  h.timeouts[0].abort(timeoutError());
  await settle();
  assert.equal(h.calls.length, 2);

  // 入れ直した後に判定が出る
  h.calls[1].resolve(JSON.stringify([{ id: 'c0', hide: false, category: null }]));
  await settle();
  assert.deepEqual(h.verdicts, [['a', { hide: false, category: null }]]);
  assert.equal(queue.size(), 0);

  // 再表示などで再び enqueue され、タイムアウトしたら、また 1 回入れ直される
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.calls.length, 3);
  h.timeouts[2].abort(timeoutError());
  await settle();
  assert.equal(h.calls.length, 4, '判定が出た後のタイムアウトでも入れ直す');
  assert.deepEqual(h.pending, ['a', 'a']);

  // 判定が出ないまま 2 回目のタイムアウトなら、従来どおり入れ直さない
  h.timeouts[3].abort(timeoutError());
  await settle();
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.pending, ['a', 'a', 'a']);
  assert.deepEqual(h.fatals, []);
  assert.equal(queue.size(), 0);
});

test('基底セッションの準備を待つ間はタイムアウトを数えない', async () => {
  let openGate = () => {};
  const cloneGate = new Promise((resolve) => {
    openGate = resolve;
  });
  const h = createHarness({ cloneGate });
  const queue = createAiQueue(h.options);
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.timeouts.length, 0, 'clone できるまでタイムアウトのシグナルを作らない');
  assert.equal(h.calls.length, 0);

  openGate();
  await settle();
  assert.equal(h.timeouts.length, 1);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve(JSON.stringify([{ id: 'c0', hide: true, category: '暴言' }]));
  await settle();
  assert.deepEqual(h.verdicts, [['a', { hide: true, category: '暴言' }]]);
  assert.deepEqual(h.pending, []);
});
