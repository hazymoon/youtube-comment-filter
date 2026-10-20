/**
 * @file AI 判定の順番待ち。1 本だけで直列に処理する。
 */

import { buildBatchInput, buildResponseSchema, parseBatchResponse } from './ai.js';

/**
 * @typedef {object} AiSession
 * @property {(input: string, options: { responseConstraint: object, omitResponseConstraintInput: boolean, signal: AbortSignal }) => Promise<string>} prompt
 * @property {() => void} destroy
 */

/**
 * @typedef {object} AiQueue
 * @property {(items: { id: string, text: string }[]) => void} enqueue 判定するコメントを末尾に加える
 * @property {() => void} reset 実行中の判定を中断し、待ち行列と再試行回数を消す（動画の遷移時に使う）
 * @property {() => number} size 待ち行列と処理中の件数の合計
 */

/**
 * 中断の理由がタイムアウトか。
 * @param {AbortSignal} signal 合成前のタイムアウト用シグナル
 * @returns {boolean}
 */
function isTimeoutAbort(signal) {
  return signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
}

/**
 * AI 判定の順番待ちを作る。
 *
 * 同一セッションへの同時投入は失敗するため（docs/spike.md）、batchSize 件ずつ取り出して 1 本で直列に処理する。
 * バッチごとに cloneSession で履歴の無いセッションを作り、終わったら必ず destroy する（前のバッチの文脈を持ち越さない）。
 *
 * - 応答から欠けたコメントは 1 件ずつのバッチで 1 回だけ再判定し、それでも欠けたら onPending。
 *   再判定がタイムアウトして入れ直されたコメントが再び欠けたときも、再判定は重ねず onPending にする
 * - タイムアウトしたバッチは全件を onPending にし、各コメント 1 回だけ行列の末尾に入れ直す。
 *   判定が出たコメントは再試行の回数を消すので、後で再び enqueue されたときはまた 1 回入れ直せる
 * - 2 件以上のバッチで hide:true になったコメントは、欠落の再判定の後に 1 件だけのバッチで判定し直し、その結果を流す。
 *   再判定がタイムアウトしたらタイムアウトと同じく扱い、応答から欠けたら onPending にする
 * - タイムアウトは clone できてから数える（基底セッションの準備を待つ時間は含めない）
 * - タイムアウト以外の例外は onFatal を呼び、以降の enqueue を無視する（呼び出し側はルールだけの判定に切り替える）。
 *   reset しても戻らない
 * - reset 前に始まった判定の結果は onVerdict / onPending に流さない。コールバックの中で reset されたときも、
 *   同じバッチの残りは流さない
 * - onVerdict / onPending には判定に使ったコメント（enqueue 時の id と本文）も渡す。
 *   判定中に本文が変わっていないかは呼び出し側が確かめ、変わっていれば判定結果を保存せず enqueue し直す
 *
 * @param {object} options
 * @param {() => Promise<AiSession>} options.cloneSession 基底セッションを clone する
 * @param {number} options.batchSize 1 バッチの件数
 * @param {number} options.timeoutMs 1 バッチの時間の上限（ミリ秒）
 * @param {number} options.maxChars 1 コメントの本文の最大文字数
 * @param {{ name: string, description: string }[]} options.categories AI_CATEGORIES
 * @param {(id: string, verdict: { hide: boolean, category: string|null }, item: { id: string, text: string }) => void} options.onVerdict
 *   判定が出た
 * @param {(id: string, item: { id: string, text: string }) => void} options.onPending 判定が得られなかった（判定待ち）
 * @param {(error: unknown) => void} options.onFatal AI が使えなくなった
 * @param {(ms: number) => AbortSignal} [options.createTimeoutSignal] タイムアウト用シグナルの生成（テストで差し替える）
 * @returns {AiQueue}
 */
export function createAiQueue({
  cloneSession,
  batchSize,
  timeoutMs,
  maxChars,
  categories,
  onVerdict,
  onPending,
  onFatal,
  createTimeoutSignal = (ms) => AbortSignal.timeout(ms),
}) {
  const effectiveBatchSize = Math.max(1, Math.floor(batchSize) || 1);
  const responseSchema = buildResponseSchema(categories);
  const categoryNames = categories.map((category) => category.name);

  /** @type {{ id: string, text: string }[]} */
  let waiting = [];
  /** @type {Set<string>} */
  const waitingIds = new Set();
  /** @type {Set<string>} */
  const inFlightIds = new Set();
  /** @type {Map<string, number>} タイムアウトによる入れ直しの回数 */
  const timeoutRetries = new Map();
  /** @type {Set<string>} 欠落による 1 件ずつの再判定を済ませた id */
  const missingRetried = new Set();
  let generation = 0;
  let resetController = new AbortController();
  let running = false;
  let fatal = false;

  /**
   * 1 バッチ分の prompt を実行する。セッションは必ず destroy する。
   * タイムアウトは clone できてから数え始める。基底セッションの準備（モデルの読み込みやダウンロード、
   * ユーザー操作の待ち）は推論の時間ではないので、上限に含めない。
   * @param {string} input 入力文
   * @param {{ signal: AbortSignal|null }} timeout 作ったタイムアウト用シグナルを入れて返す
   * @param {AbortSignal} resetSignal reset 用シグナル
   * @returns {Promise<string>}
   */
  async function runPrompt(input, timeout, resetSignal) {
    const session = await cloneSession();
    try {
      timeout.signal = createTimeoutSignal(timeoutMs);
      const signal = AbortSignal.any([timeout.signal, resetSignal]);
      signal.throwIfAborted();
      return await session.prompt(input, {
        responseConstraint: responseSchema,
        omitResponseConstraintInput: true,
        signal,
      });
    } finally {
      try {
        session.destroy();
      } catch {
        // destroy の失敗は判定に影響しないので無視する
      }
    }
  }

  /**
   * バッチを取り出した世代のままで、まだ止まっていないか。コールバックの中で reset されることがあるので、
   * コールバックを呼ぶたびに確かめる。
   * @param {number} batchGeneration 取り出した時点の世代
   * @returns {boolean}
   */
  function isCurrent(batchGeneration) {
    return batchGeneration === generation && !fatal;
  }

  /**
   * タイムアウトしたコメントを判定待ちにし、まだなら 1 回だけ末尾に入れ直す。
   * @param {{ id: string, text: string }[]} batch バッチ
   * @param {number} batchGeneration 取り出した時点の世代
   */
  function handleTimeout(batch, batchGeneration) {
    for (const item of batch) {
      if (!isCurrent(batchGeneration)) return;
      inFlightIds.delete(item.id);
      onPending(item.id, item);
      if (!isCurrent(batchGeneration)) return;
      const count = timeoutRetries.get(item.id) ?? 0;
      if (count < 1 && !waitingIds.has(item.id)) {
        timeoutRetries.set(item.id, count + 1);
        waiting.push(item);
        waitingIds.add(item.id);
      }
    }
  }

  /**
   * 回復できない失敗。行列を空にして以降を止める。
   * @param {unknown} error 例外
   */
  function handleFatal(error) {
    fatal = true;
    waiting = [];
    waitingIds.clear();
    inFlightIds.clear();
    timeoutRetries.clear();
    missingRetried.clear();
    onFatal(error);
  }

  /**
   * 1 バッチを判定し、結果を流す。
   * @param {{ id: string, text: string }[]} batch バッチ
   * @param {number} batchGeneration 取り出した時点の世代
   * @param {boolean} isMissingRetry 欠落分の 1 件ずつの再判定か
   * @returns {Promise<void>}
   */
  async function processBatch(batch, batchGeneration, isMissingRetry) {
    const { input, idMap } = buildBatchInput(batch, maxChars);
    const itemsById = new Map(batch.map((item) => [item.id, item]));
    /** @type {{ signal: AbortSignal|null }} */
    const timeout = { signal: null };
    let responseText;
    try {
      responseText = await runPrompt(input, timeout, resetController.signal);
    } catch (error) {
      if (!isCurrent(batchGeneration)) return;
      if (timeout.signal !== null && isTimeoutAbort(timeout.signal)) {
        handleTimeout(batch, batchGeneration);
        return;
      }
      handleFatal(error);
      return;
    }
    if (!isCurrent(batchGeneration)) return;

    const { verdicts, missing } = parseBatchResponse(responseText, idMap, categoryNames);
    /** @type {{ id: string, text: string }[]} */
    const toConfirm = [];
    for (const [id, verdict] of verdicts) {
      if (!isCurrent(batchGeneration)) return;
      const item = /** @type {{ id: string, text: string }} */ (itemsById.get(id));
      // 本文に埋めた指示で同じバッチの他のコメントを隠させられるため、まとめた判定の hide:true は
      // そのまま流さず、1 件だけのバッチで判定し直す。hide:false は判定し直さずに流すので、
      // 同じバッチの他のコメントの指示で表示にされる経路は残る（防げるのは AI_BATCH_SIZE が 1 のときだけ）
      if (batch.length > 1 && verdict.hide) {
        toConfirm.push(item);
        continue;
      }
      inFlightIds.delete(id);
      // 判定が出たら再試行の回数を消す。後で再び順番待ちに入ったとき（本文の再表示など）、改めて 1 回入れ直せるようにする
      timeoutRetries.delete(id);
      missingRetried.delete(id);
      onVerdict(id, verdict, item);
    }

    for (const id of missing) {
      if (!isCurrent(batchGeneration)) return;
      const item = /** @type {{ id: string, text: string }} */ (itemsById.get(id));
      if (isMissingRetry || missingRetried.has(id)) {
        inFlightIds.delete(id);
        onPending(id, item);
        continue;
      }
      missingRetried.add(id);
      await processBatch([item], batchGeneration, true);
    }

    for (const item of toConfirm) {
      if (!isCurrent(batchGeneration)) return;
      // 再判定の応答から欠けたら、欠落の再判定は重ねずに判定待ちにする
      await processBatch([item], batchGeneration, true);
    }
  }

  async function run() {
    running = true;
    try {
      while (waiting.length > 0 && !fatal) {
        const batchGeneration = generation;
        const batch = waiting.splice(0, effectiveBatchSize);
        for (const item of batch) {
          waitingIds.delete(item.id);
          inFlightIds.add(item.id);
        }
        await processBatch(batch, batchGeneration, false);
        if (batchGeneration === generation) {
          for (const item of batch) {
            // 入れ直したものは waiting 側で数えるので、処理中からは外す
            inFlightIds.delete(item.id);
          }
        }
      }
    } catch (error) {
      // Callback exceptions land here; stop the queue instead of leaving an unhandled rejection.
      if (!fatal) handleFatal(error);
    } finally {
      running = false;
    }
  }

  return {
    enqueue(items) {
      if (fatal) return;
      for (const item of items) {
        if (waitingIds.has(item.id) || inFlightIds.has(item.id)) continue;
        waiting.push({ id: item.id, text: item.text });
        waitingIds.add(item.id);
      }
      if (!running && waiting.length > 0) void run();
    },

    reset() {
      generation += 1;
      resetController.abort();
      resetController = new AbortController();
      waiting = [];
      waitingIds.clear();
      inFlightIds.clear();
      timeoutRetries.clear();
      missingRetried.clear();
    },

    size() {
      return waiting.length + inFlightIds.size;
    },
  };
}
