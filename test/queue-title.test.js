import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

// 順番待ちに入れたコメントの title（スキャンした時点の動画のタイトル）を、AI への入力と判定の受け口まで落とさずに運ぶ

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

test('入れたコメントの title を AI への入力に付け、判定の受け口にも渡す', async () => {
  const h = createHarness();
  const received = [];
  const queue = createAiQueue({
    ...h.options,
    batchSize: 1,
    onVerdict: (id, verdict, item) => received.push(item),
  });
  queue.enqueue([{ id: 'a', text: '良かったですね', title: '高速道路で多重事故' }]);
  await waitForCalls(h, 1);
  assert.deepEqual(h.calls[0].payload, [{ id: 'c0', title: '高速道路で多重事故', text: '良かったですね' }]);
  h.calls[0].resolve(JSON.stringify([{ id: 'c0', hide: true, category: '暴言' }]));
  await settle();
  assert.equal(received.length, 1);
  assert.equal(received[0].title, '高速道路で多重事故');
});

test('title が null のコメントは、判定の受け口にも null のまま渡す', async () => {
  const h = createHarness();
  const received = [];
  const queue = createAiQueue({
    ...h.options,
    batchSize: 1,
    onVerdict: (id, verdict, item) => received.push(item),
  });
  queue.enqueue([{ id: 'a', text: '本文', title: null }]);
  await waitForCalls(h, 1);
  assert.deepEqual(h.calls[0].payload, [{ id: 'c0', text: '本文' }]);
  h.calls[0].resolve(JSON.stringify([{ id: 'c0', hide: false, category: null }]));
  await settle();
  assert.equal(received[0].title, null);
});

test('タイトル無しで待っているコメントは、後からタイトル付きで入れ直すとタイトルを付けて判定する', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 1 });
  // a を判定している間に、b がタイトル無しで待つ
  queue.enqueue([
    { id: 'a', text: '一つ目', title: '高速道路で多重事故' },
    { id: 'b', text: '良かったですね', title: null },
  ]);
  await waitForCalls(h, 1);
  // 次のスキャンでタイトルが読めた
  queue.enqueue([{ id: 'b', text: '良かったですね', title: '高速道路で多重事故' }]);
  assert.equal(queue.size(), 2, '入れ直しても件数は増えない');
  h.calls[0].resolve(JSON.stringify([{ id: 'c0', hide: false, category: null }]));
  await waitForCalls(h, 2);
  assert.deepEqual(h.calls[1].payload, [{ id: 'c0', title: '高速道路で多重事故', text: '良かったですね' }]);
});

test('タイトル付きで待っているコメントのタイトルは、入れ直しで null や別のタイトルに変えない', async () => {
  const h = createHarness();
  const queue = createAiQueue({ ...h.options, batchSize: 1 });
  queue.enqueue([
    { id: 'a', text: '一つ目', title: 'x' },
    { id: 'b', text: '本文', title: '住宅火災' },
  ]);
  await waitForCalls(h, 1);
  queue.enqueue([{ id: 'b', text: '本文', title: null }]);
  h.calls[0].resolve(JSON.stringify([{ id: 'c0', hide: false, category: null }]));
  await waitForCalls(h, 2);
  assert.equal(h.calls[1].payload[0].title, '住宅火災');
});
