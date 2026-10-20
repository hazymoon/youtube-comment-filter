/**
 * @file コメントの表示状態の決定と、件数バーの文字列の組み立て（純粋関数）。
 */

/**
 * AI 判定の状態。
 * - 'initializing': availability() の確認中か、基底セッションを作成中
 * - 'ready': 基底セッションができ、判定できる
 * - 'needs-activation': モデルのダウンロードが要り、ユーザー操作（「コメントを表示」のクリック）を待っている
 * - 'disabled': AI を使わない（設定で無効、LanguageModel が無い、availability() が 'unavailable'）
 * - 'failed': 推論や作成でタイムアウト以外のエラーが起き、AI を止めた
 * @typedef {'initializing'|'ready'|'needs-activation'|'disabled'|'failed'} AiMode
 */

/**
 * 表示状態の理由。
 * - 'ngUser' / 'ngWord' / 'ai': 非表示にした理由
 * - 'unreadable': DOM からコメントを読めないので判定待ちとして隠している
 * - 'awaiting-ai': AI の判定の順番待ちか判定中
 * - 'ai-unresolved': AI の判定が得られなかった（タイムアウト・応答の欠落）。判定し直すまで判定待ちとして隠す
 * @typedef {'ngUser'|'ngWord'|'ai'|'unreadable'|'awaiting-ai'|'ai-unresolved'} StateReason
 */

/**
 * @typedef {object} Decision
 * @property {'shown'|'hidden'|'pending'} state 表示状態
 * @property {StateReason} [reason] 理由（表示するときは無い）
 * @property {boolean} enqueue AI の判定の順番待ちに入れるか
 */

/**
 * コメントの表示状態を決める。
 *
 * 順に、読めない → 判定待ち（fail-closed）、ルールで NG → 非表示、本文が空 → 表示（AI に送らない）、
 * AI が使えない → 表示（ルールは通過済み）、キャッシュがある → それに従う、それ以外 → AI の判定を待つ。
 * ルールを本文が空かより先に見るのは、画像の絵文字だけのコメントにも NG ユーザ（投稿者・@返信の宛先）を効かせるため。
 * AI の準備中（'initializing' / 'needs-activation'）でも順番待ちに入れる。順番待ちは基底セッションの準備を待ってから判定する。
 *
 * @param {object} input
 * @param {import('./dom.js').ExtractedComment | { unreadable: string }} input.extracted extractComment の結果
 * @param {{ reason: 'ngUser'|'ngWord'|null }|null} input.ruleResult judgeByRules の結果（読めないときは null でよい）
 * @param {AiMode} input.aiMode AI 判定の状態
 * @param {{ hide: boolean, category: string|null }|null} input.cached キャッシュの判定結果
 * @param {boolean} [input.aiUnresolved] 同じコメント（ID と本文が同じ）の AI 判定が前に得られなかったか
 * @returns {Decision}
 */
export function decideState({ extracted, ruleResult, aiMode, cached, aiUnresolved = false }) {
  if ('unreadable' in extracted) return { state: 'pending', reason: 'unreadable', enqueue: false };
  if (ruleResult?.reason === 'ngUser' || ruleResult?.reason === 'ngWord') {
    return { state: 'hidden', reason: ruleResult.reason, enqueue: false };
  }
  if (extracted.text === '') return { state: 'shown', enqueue: false };
  if (aiMode === 'disabled' || aiMode === 'failed') return { state: 'shown', enqueue: false };
  if (cached) return cached.hide ? { state: 'hidden', reason: 'ai', enqueue: false } : { state: 'shown', enqueue: false };
  return { state: 'pending', reason: aiUnresolved ? 'ai-unresolved' : 'awaiting-ai', enqueue: true };
}

/**
 * @typedef {object} StateCounts
 * @property {number} ngUser NG ユーザで非表示
 * @property {number} ngWord NG ワードで非表示
 * @property {number} ai AI の判定で非表示
 * @property {number} pending 判定待ち（読めない、または AI の判定が得られなかった）
 * @property {number} judging 判定中（AI の順番待ち・判定中。判定待ちには数えない）
 */

/**
 * 表示状態を集計する。隠したスレッドの中のコメントは呼び出し側が除いて渡す（スレッド 1 件として数えるため）。
 * reason が 'awaiting-ai' のものは判定中、'unreadable' と 'ai-unresolved' のものは判定待ちに数える。
 * 判定待ちに数えたコメントを順番待ちに入れ直しても、判定が出るまでは判定待ちのまま数える。
 * @param {{ state: string|null, reason?: string|null }[]} records 各コメントの状態
 * @returns {StateCounts}
 */
export function countStates(records) {
  const counts = { ngUser: 0, ngWord: 0, ai: 0, pending: 0, judging: 0 };
  for (const { state, reason } of records) {
    if (state === 'hidden') {
      if (reason === 'ngUser') counts.ngUser += 1;
      else if (reason === 'ngWord') counts.ngWord += 1;
      else if (reason === 'ai') counts.ai += 1;
    } else if (state === 'pending') {
      if (reason === 'awaiting-ai') counts.judging += 1;
      else counts.pending += 1;
    }
  }
  return counts;
}

/**
 * 件数バーの件数の文字列を組み立てる。読み込み済みの総数と非表示の合計を先頭に置き、内訳を括弧に入れる
 * （隠した割合が多い動画はコメント欄を開かない、と利用者が判断できるようにするため）。
 * 判定待ちは隠しているので非表示の合計に含める。判定中のものがあるときだけ末尾に件数を添える。
 * @param {StateCounts & { total: number }} counts countStates の結果と、集計したコメントの数
 * @returns {string}
 */
export function buildCountText(counts) {
  const hidden = counts.ngUser + counts.ngWord + counts.ai + counts.pending;
  const base =
    `読み込み済み ${counts.total} 件中 ${hidden} 件を非表示` +
    `（NG ユーザ ${counts.ngUser} / NG ワード ${counts.ngWord} / AI ${counts.ai} / 判定待ち ${counts.pending}）`;
  return counts.judging > 0 ? `${base}・判定中 ${counts.judging} 件` : base;
}

/**
 * @typedef {object} AiState
 * @property {AiMode} mode AI 判定の状態
 * @property {'config'|'unsupported'|'unavailable'} [disabledReason] 'disabled' の理由
 * @property {number|null} [progress] モデルのダウンロードの進み具合（0〜1）。ダウンロード中でなければ null
 */

/**
 * 件数バーの AI の状態の文字列を組み立てる。AI を使わないときはルールのみで判定していることを示す。
 * @param {AiState} aiState AI の状態
 * @returns {string}
 */
export function buildStatusText(aiState) {
  switch (aiState.mode) {
    case 'ready':
      return 'AI 判定: 有効';
    case 'initializing':
      if (typeof aiState.progress === 'number') {
        return `AI 判定: モデルをダウンロード中 ${Math.round(Math.min(1, Math.max(0, aiState.progress)) * 100)}%`;
      }
      return 'AI 判定: 準備中';
    case 'needs-activation':
      return 'AI 判定: 「コメントを表示」を押すとモデルのダウンロードを始めます';
    case 'disabled':
      if (aiState.disabledReason === 'config') return 'AI 判定: 設定で無効（ルールのみで判定）';
      return 'AI 判定: この環境では使えません（ルールのみで判定）';
    case 'failed':
      return 'AI 判定: エラーで停止（ルールのみで判定）';
    default:
      return '';
  }
}
