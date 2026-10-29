import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiQueue } from '../src/queue.js';

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/**
 * clone や prompt が返らなくなったセッションを再現する順番待ちの部品を作る。
 * Chrome が裏でモデルを片付けると、基底セッションの clone や prompt が中断にも応じないまま返らなくなる。
 * @param {{ hangClones?: number, ignoreAbort?: boolean, readyGate?: Promise<void> }} [options]
 *   hangClones: 最初の何回の clone を返さないか。ignoreAbort: prompt が中断に応じない。
 *   readyGate: 渡すと、基底セッションの準備はそれが解決するまで待つ
 */
function createHarness(options = {}) {
  const calls = [];
  const timeouts = [];
  const verdicts = [];
  const pending = [];
  const fatals = [];
  const stale = [];
  const stats = { cloneCalls: 0, destroys: 0 };
  return {
    calls,
    timeouts,
    verdicts,
    pending,
    fatals,
    stale,
    stats,
    options: {
      async waitForReady() {
        if (options.readyGate) await options.readyGate;
      },
      cloneSession() {
        stats.cloneCalls += 1;
        if (stats.cloneCalls <= (options.hangClones ?? 0)) return new Promise(() => {});
        return Promise.resolve({
          prompt(input, promptOptions) {
            return new Promise((resolve, reject) => {
              const payload = JSON.parse(input.slice(input.indexOf('\n') + 1));
              calls.push({ payload, resolve });
              if (!options.ignoreAbort) {
                promptOptions.signal.addEventListener('abort', () => reject(promptOptions.signal.reason), {
                  once: true,
                });
              }
            });
          },
          destroy() {
            stats.destroys += 1;
          },
        });
      },
      batchSize: 1,
      timeoutMs: 1000,
      maxChars: 500,
      categories: CATEGORIES,
      onVerdict: (id, verdict) => verdicts.push([id, verdict]),
      onPending: (id) => pending.push(id),
      onFatal: (error) => fatals.push(error),
      onSessionStale: () => stale.push(true),
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

test('clone が返らなくてもタイムアウトで判定待ちにし、次のコメントの判定へ進む', async () => {
  const h = createHarness({ hangClones: 1 });
  const queue = createAiQueue(h.options);
  queue.enqueue([
    { id: 'a', text: '本文 a' },
    { id: 'b', text: '本文 b' },
  ]);
  await settle();
  assert.equal(h.timeouts.length, 1, 'clone の待ちもタイムアウトに含める');
  h.timeouts[0].abort(timeoutError());
  await settle();

  assert.deepEqual(h.pending, ['a']);
  assert.deepEqual(h.stale, [true], 'clone が返らなければ、すぐ基底セッションを作り直させる');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    h.calls[0].payload.map((v) => v.text),
    ['本文 b'],
  );
  assert.deepEqual(h.fatals, []);
});

test('prompt が中断に応じなくてもタイムアウトで判定待ちにし、次のコメントの判定へ進む', async () => {
  const h = createHarness({ ignoreAbort: true });
  const queue = createAiQueue(h.options);
  queue.enqueue([
    { id: 'a', text: '本文 a' },
    { id: 'b', text: '本文 b' },
  ]);
  await settle();
  assert.equal(h.calls.length, 1);
  h.timeouts[0].abort(timeoutError());
  await settle();

  assert.deepEqual(h.pending, ['a']);
  assert.deepEqual(h.stale, [], '1 回のタイムアウトでは作り直させない（遅いだけのこともある）');
  assert.equal(h.stats.destroys, 1, '返らなかったセッションも destroy する');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(
    h.calls[1].payload.map((v) => v.text),
    ['本文 b'],
  );

  // 見捨てた prompt が後から返っても流さない
  h.calls[0].resolve(JSON.stringify([{ id: 'c0', hide: true, category: '暴言' }]));
  await settle();
  assert.deepEqual(h.verdicts, []);
  assert.deepEqual(h.fatals, []);

  // 続けてタイムアウトしたら、基底セッションが使えなくなったとみなす
  h.timeouts[1].abort(timeoutError());
  await settle();
  assert.deepEqual(h.stale, [true]);
});

test('タイムアウトの間に応答が返っていれば、作り直させない', async () => {
  const h = createHarness();
  const queue = createAiQueue(h.options);
  queue.enqueue([
    { id: 'a', text: '本文 a' },
    { id: 'b', text: '本文 b' },
    { id: 'c', text: '本文 c' },
  ]);
  await settle();
  h.timeouts[0].abort(timeoutError());
  await settle();
  h.calls[1].resolve(JSON.stringify([{ id: 'c0', hide: false, category: null }]));
  await settle();
  h.timeouts[2].abort(timeoutError());
  await settle();
  assert.deepEqual(h.verdicts, [['b', { hide: false, category: null }]]);
  assert.deepEqual(h.pending, ['a', 'c']);
  assert.deepEqual(h.stale, []);
});

test('タイムアウトの後で clone が返ったら、そのセッションも destroy する', async () => {
  let resolveClone = () => {};
  const h = createHarness();
  const late = { destroyed: false };
  let first = true;
  const original = h.options.cloneSession;
  h.options.cloneSession = () => {
    if (!first) return original();
    first = false;
    return new Promise((resolve) => {
      resolveClone = () => resolve({ prompt: () => new Promise(() => {}), destroy: () => (late.destroyed = true) });
    });
  };
  const queue = createAiQueue(h.options);
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  h.timeouts[0].abort(timeoutError());
  await settle();
  assert.deepEqual(h.pending, ['a']);

  resolveClone();
  await settle();
  assert.equal(late.destroyed, true);
});

test('基底セッションの準備（waitForReady）を待つ間はタイムアウトを数えない', async () => {
  let openGate = () => {};
  const readyGate = new Promise((resolve) => {
    openGate = resolve;
  });
  const h = createHarness({ readyGate });
  const queue = createAiQueue(h.options);
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  assert.equal(h.timeouts.length, 0);
  assert.equal(h.stats.cloneCalls, 0, '準備ができるまで clone しない');

  openGate();
  await settle();
  assert.equal(h.timeouts.length, 1);
  assert.equal(h.calls.length, 1);
});

test('reset の後で clone が返らずタイムアウトしても onSessionStale を呼ぶ（基底セッションは遷移と関係なく使えなくなっている）', async () => {
  const h = createHarness({ hangClones: 1 });
  const queue = createAiQueue(h.options);
  queue.enqueue([{ id: 'a', text: '本文 a' }]);
  await settle();
  queue.reset();
  h.timeouts[0].abort(timeoutError());
  await settle();
  assert.deepEqual(h.stale, [true]);
  assert.deepEqual(h.pending, [], 'reset 前のバッチは判定待ちに流さない');
});
