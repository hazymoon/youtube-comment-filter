import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountText, buildStatusText, countStates, decideState } from '../src/decide.js';

const comment = { id: 'a', text: '本文', textHash: 'h', author: { handle: '@x', channelId: null }, isReply: false, leadingMentionHref: null };
const pass = { reason: null };

test('読めないコメントは判定待ち（fail-closed）で、順番待ちに入れない', () => {
  assert.deepEqual(decideState({ extracted: { unreadable: 'x' }, ruleResult: null, aiMode: 'ready', cached: null }), {
    state: 'pending',
    reason: 'unreadable',
    enqueue: false,
  });
});

test('本文が空なら表示し、AI に送らない', () => {
  assert.deepEqual(decideState({ extracted: { ...comment, text: '' }, ruleResult: pass, aiMode: 'ready', cached: null }), {
    state: 'shown',
    enqueue: false,
  });
});

test('ルールで NG なら非表示（AI の状態やキャッシュより優先）', () => {
  for (const reason of ['ngUser', 'ngWord']) {
    assert.deepEqual(
      decideState({ extracted: comment, ruleResult: { reason }, aiMode: 'ready', cached: { hide: false, category: null } }),
      { state: 'hidden', reason, enqueue: false },
    );
  }
});

test('本文が空でも NG ユーザのルールは効く（画像の絵文字だけのコメント）', () => {
  assert.deepEqual(decideState({ extracted: { ...comment, text: '' }, ruleResult: { reason: 'ngUser' }, aiMode: 'ready', cached: null }), {
    state: 'hidden',
    reason: 'ngUser',
    enqueue: false,
  });
});

test('AI が使えないとき（disabled / failed）はルールを通過したコメントを表示する', () => {
  for (const aiMode of ['disabled', 'failed']) {
    assert.deepEqual(decideState({ extracted: comment, ruleResult: pass, aiMode, cached: null }), { state: 'shown', enqueue: false });
  }
});

test('キャッシュがあればそれに従う', () => {
  assert.deepEqual(decideState({ extracted: comment, ruleResult: pass, aiMode: 'ready', cached: { hide: true, category: '暴言' } }), {
    state: 'hidden',
    reason: 'ai',
    enqueue: false,
  });
  assert.deepEqual(decideState({ extracted: comment, ruleResult: pass, aiMode: 'ready', cached: { hide: false, category: null } }), {
    state: 'shown',
    enqueue: false,
  });
});

test('それ以外は AI の判定を待ち、準備中でも順番待ちに入れる', () => {
  for (const aiMode of ['ready', 'initializing', 'needs-activation']) {
    assert.deepEqual(decideState({ extracted: comment, ruleResult: pass, aiMode, cached: null }), {
      state: 'pending',
      reason: 'awaiting-ai',
      enqueue: true,
    });
  }
});

test('前に AI の判定が得られなかったコメントは判定待ちのまま、順番待ちに入れ直す', () => {
  assert.deepEqual(decideState({ extracted: comment, ruleResult: pass, aiMode: 'ready', cached: null, aiUnresolved: true }), {
    state: 'pending',
    reason: 'ai-unresolved',
    enqueue: true,
  });
});

test('countStates は理由ごとに数え、awaiting-ai は判定中、unreadable と ai-unresolved は判定待ちに数える', () => {
  const counts = countStates([
    { state: 'hidden', reason: 'ngUser' },
    { state: 'hidden', reason: 'ngUser' },
    { state: 'hidden', reason: 'ngWord' },
    { state: 'hidden', reason: 'ai' },
    { state: 'pending', reason: 'unreadable' },
    { state: 'pending', reason: 'ai-unresolved' },
    { state: 'pending', reason: 'awaiting-ai' },
    { state: 'shown', reason: null },
    { state: null, reason: null },
  ]);
  assert.deepEqual(counts, { ngUser: 2, ngWord: 1, ai: 1, pending: 2, judging: 1 });
});

test('件数の文字列は判定中があるときだけ判定中の件数を添える', () => {
  assert.equal(
    buildCountText({ total: 12, ngUser: 1, ngWord: 2, ai: 3, pending: 4, judging: 0 }),
    '読み込み済み 12 件中 10 件を非表示（NG ユーザ 1 / NG ワード 2 / AI 3 / 判定待ち 4）',
  );
  assert.equal(
    buildCountText({ total: 5, ngUser: 0, ngWord: 0, ai: 0, pending: 0, judging: 5 }),
    '読み込み済み 5 件中 0 件を非表示（NG ユーザ 0 / NG ワード 0 / AI 0 / 判定待ち 0）・判定中 5 件',
  );
});

test('状態の文字列は、AI を使わないときにルールのみであることを示す', () => {
  assert.equal(buildStatusText({ mode: 'ready' }), 'AI 判定: 有効');
  assert.equal(buildStatusText({ mode: 'initializing', progress: null }), 'AI 判定: 準備中');
  assert.equal(buildStatusText({ mode: 'initializing', progress: 0.256 }), 'AI 判定: モデルをダウンロード中 26%');
  assert.match(buildStatusText({ mode: 'needs-activation' }), /「コメントを表示」を押すと/);
  assert.equal(buildStatusText({ mode: 'disabled', disabledReason: 'config' }), 'AI 判定: 設定で無効（ルールのみで判定）');
  assert.equal(buildStatusText({ mode: 'disabled', disabledReason: 'unavailable' }), 'AI 判定: この環境では使えません（ルールのみで判定）');
  assert.equal(buildStatusText({ mode: 'disabled', disabledReason: 'unsupported' }), 'AI 判定: この環境では使えません（ルールのみで判定）');
  assert.equal(buildStatusText({ mode: 'failed' }), 'AI 判定: エラーで停止（ルールのみで判定）');
});
