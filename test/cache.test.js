import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiCache } from '../src/cache.js';

/**
 * 記録用の保存先と、手動で実行する schedule を作る。
 * @param {unknown} initial load が返す値
 */
function createHarness(initial) {
  const saved = [];
  const scheduled = [];
  let cancelCount = 0;
  return {
    saved,
    scheduled,
    get cancelCount() {
      return cancelCount;
    },
    storage: {
      load: () => initial,
      save: (value) => saved.push(structuredClone(value)),
    },
    schedule: (fn) => {
      const task = { fn, cancelled: false };
      scheduled.push(task);
      return () => {
        task.cancelled = true;
        cancelCount += 1;
      };
    },
    runScheduled() {
      const tasks = scheduled.splice(0);
      for (const task of tasks) if (!task.cancelled) task.fn();
    },
  };
}

const HIDE = { hide: true, category: '暴言' };
const SHOW = { hide: false, category: null };

test('set した判定を get で取り出せ、保存して読み直しても同じ', () => {
  const h = createHarness(undefined);
  const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
  cache.set('a', 'h1', HIDE);
  cache.set('b', 'h2', SHOW);
  assert.deepEqual(cache.get('a', 'h1'), HIDE);
  assert.deepEqual(cache.get('b', 'h2'), SHOW);
  assert.equal(cache.get('z', 'h1'), null);
  cache.flush();

  const last = h.saved.at(-1);
  assert.equal(last.version, 'v1');
  assert.deepEqual(last.entries.a.slice(0, 3), [1, '暴言', 'h1']);

  const h2 = createHarness(last);
  const reloaded = createAiCache({ maxEntries: 10, version: 'v1', storage: h2.storage, schedule: h2.schedule });
  assert.deepEqual(reloaded.get('a', 'h1'), HIDE);
  assert.deepEqual(reloaded.get('b', 'h2'), SHOW);
});

test('textHash が違えば null（編集されたコメントは判定し直す）', () => {
  const h = createHarness(undefined);
  const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
  cache.set('a', 'h1', HIDE);
  assert.equal(cache.get('a', 'h2'), null);
});

test('version が違う・壊れたデータのときは空から始める', () => {
  const stored = { version: 'old', seq: 1, entries: { a: [1, null, 'h1', 1] } };
  for (const initial of [stored, null, 'broken', 42, { version: 'v1', entries: null }, { version: 'v1' }]) {
    const h = createHarness(initial);
    const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
    assert.equal(cache.get('a', 'h1'), null);
  }
});

test('壊れたエントリだけを捨て、正しいエントリは使う', () => {
  const initial = {
    version: 'v1',
    seq: 5,
    entries: { ok: [0, null, 'h', 1], bad1: [2, null, 'h', 2], bad2: 'x', bad3: [1, 3, 'h', 3] },
  };
  const h = createHarness(initial);
  const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
  assert.deepEqual(cache.get('ok', 'h'), SHOW);
  assert.equal(cache.get('bad1', 'h'), null);
  assert.equal(cache.get('bad3', 'h'), null);
  const h2 = createHarness(initial);
  const throwing = createAiCache({
    maxEntries: 10,
    version: 'v1',
    storage: { load: () => { throw new Error('boom'); }, save: () => {} },
    schedule: h2.schedule,
  });
  assert.equal(throwing.get('ok', 'h'), null);
});

test('件数が上限を超えたら最後に使った時期が古いものから捨てる（get でも更新される）', () => {
  const h = createHarness(undefined);
  const cache = createAiCache({ maxEntries: 3, version: 'v1', storage: h.storage, schedule: h.schedule });
  cache.set('a', 'h', SHOW);
  cache.set('b', 'h', SHOW);
  cache.set('c', 'h', SHOW);
  assert.deepEqual(cache.get('a', 'h'), SHOW); // a becomes most recent
  cache.set('d', 'h', SHOW); // evicts b
  assert.equal(cache.get('b', 'h'), null);
  assert.deepEqual(cache.get('a', 'h'), SHOW);
  assert.deepEqual(cache.get('c', 'h'), SHOW);
  assert.deepEqual(cache.get('d', 'h'), SHOW);
});

test('読み込んだデータも seq の順で古いものから捨てる', () => {
  const initial = {
    version: 'v1',
    seq: 30,
    entries: { new: [0, null, 'h', 30], old: [0, null, 'h', 10], mid: [0, null, 'h', 20] },
  };
  const h = createHarness(initial);
  const cache = createAiCache({ maxEntries: 2, version: 'v1', storage: h.storage, schedule: h.schedule });
  assert.equal(cache.get('old', 'h'), null);
  assert.deepEqual(cache.get('mid', 'h'), SHOW);
  cache.set('x', 'h', SHOW); // evicts new (mid was just used)
  assert.equal(cache.get('new', 'h'), null);
  cache.flush();
  assert.ok(h.saved.at(-1).seq > 30);
});

test('set を重ねても書き込みの予約は 1 つだけ', () => {
  const h = createHarness(undefined);
  const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
  cache.set('a', 'h', SHOW);
  cache.set('b', 'h', SHOW);
  cache.set('c', 'h', SHOW);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.saved.length, 0);
  h.runScheduled();
  assert.equal(h.saved.length, 1);
  assert.deepEqual(Object.keys(h.saved[0].entries).sort(), ['a', 'b', 'c']);
  cache.set('d', 'h', SHOW);
  assert.equal(h.scheduled.length, 1, '保存後の set は新しく予約する');
});

test('flush は予約を取り消して即時に保存する', () => {
  const h = createHarness(undefined);
  const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
  cache.set('a', 'h', HIDE);
  cache.flush();
  assert.equal(h.saved.length, 1);
  assert.equal(h.cancelCount, 1);
  h.runScheduled();
  assert.equal(h.saved.length, 1, '取り消した予約は実行されない');
  cache.set('b', 'h', HIDE);
  assert.equal(h.scheduled.length, 1, 'flush 後の set は新しく予約する');
});

test('schedule が同期で fn を呼ぶ実装でも、以降の set を保存する', () => {
  const saved = [];
  const cache = createAiCache({
    maxEntries: 10,
    version: 'v1',
    storage: { load: () => undefined, save: (value) => saved.push(structuredClone(value)) },
    schedule: (fn) => {
      fn();
      return () => {};
    },
  });
  cache.set('a', 'h', SHOW);
  cache.set('b', 'h', SHOW);
  cache.set('c', 'h', SHOW);
  assert.equal(saved.length, 3);
  assert.deepEqual(Object.keys(saved.at(-1).entries).sort(), ['a', 'b', 'c']);
});

test('get で使った順番も書き込みを予約して保存する（予約済みなら重ねない）', () => {
  const h = createHarness({ version: 'v1', seq: 2, entries: { a: [0, null, 'h', 1], b: [0, null, 'h', 2] } });
  const cache = createAiCache({ maxEntries: 10, version: 'v1', storage: h.storage, schedule: h.schedule });
  assert.deepEqual(cache.get('a', 'h'), SHOW);
  assert.deepEqual(cache.get('b', 'h'), SHOW);
  assert.equal(h.scheduled.length, 1);
  h.runScheduled();
  assert.equal(h.saved.length, 1);
  assert.ok(h.saved[0].entries.a[3] > 2, 'get で更新した seq が保存される');
  assert.equal(cache.get('a', 'other'), null);
  assert.equal(h.scheduled.length, 0, '一致しなかった get は予約しない');
});
