/**
 * @file AI 判定結果のキャッシュ（件数上限付きの LRU）。
 */

/**
 * @typedef {object} AiCacheStorage
 * @property {() => unknown} load 保存済みの値を読む（無ければ undefined など）
 * @property {(value: unknown) => void} save 値を保存する
 */

/**
 * @typedef {object} AiCache
 * @property {(id: string, textHash: string) => ({ hide: boolean, category: string|null }|null)} get
 *   判定結果を返す。本文のハッシュが保存時と違えば null（コメントが編集されたら判定し直す）。
 *   使った順番を更新し、set と同じく書き込みを予約する
 * @property {(id: string, textHash: string, verdict: { hide: boolean, category: string|null }) => void} set
 *   判定結果を保存する。書き込みは schedule で予約してまとめる
 * @property {() => void} flush 予約中の書き込みを待たずに保存する
 */

/**
 * 保存形式のエントリが正しい形か。
 * @param {unknown} entry [hide(0|1), category|null, textHash, seq]
 * @returns {boolean}
 */
function isValidCacheEntry(entry) {
  return (
    Array.isArray(entry) &&
    entry.length === 4 &&
    (entry[0] === 0 || entry[0] === 1) &&
    (entry[1] === null || typeof entry[1] === 'string') &&
    typeof entry[2] === 'string' &&
    Number.isFinite(entry[3])
  );
}

/**
 * AI 判定結果のキャッシュを作る。
 *
 * 保存形式は `{ version, seq, entries: { [commentId]: [hide(0|1), category|null, textHash, seq] } }`。
 * seq は最後に使った順番で、件数が maxEntries を超えたら seq の古いものから捨てる。
 * 読み込んだ値が壊れている、または version（プロンプトとカテゴリのバージョン）が違うときは空から始める。
 *
 * 判定待ち（タイムアウト）の結果は呼び出し側が set しない前提。
 * 複数タブで同時に書き込むと後勝ちになり、他のタブの判定結果は失われるが、失われたものは再判定されるだけなので受け入れる。
 *
 * @param {object} options
 * @param {number} options.maxEntries 保存する件数の上限
 * @param {string} options.version プロンプトとカテゴリのバージョン（promptVersion の値）
 * @param {AiCacheStorage} options.storage 保存先
 * @param {(fn: () => void) => (() => void)} options.schedule 書き込みを予約し、取り消す関数を返す
 * @returns {AiCache}
 */
export function createAiCache({ maxEntries, version, storage, schedule }) {
  // Map insertion order doubles as LRU order: oldest first.
  /** @type {Map<string, [0|1, string|null, string, number]>} */
  const entries = new Map();
  let seq = 0;
  /** @type {(() => void)|null} */
  let cancelScheduled = null;
  // Set before calling schedule so that a schedule implementation that runs fn synchronously still clears it.
  let scheduled = false;

  let loaded;
  try {
    loaded = storage.load();
  } catch {
    loaded = undefined;
  }
  if (
    loaded !== null &&
    typeof loaded === 'object' &&
    /** @type {any} */ (loaded).version === version &&
    /** @type {any} */ (loaded).entries !== null &&
    typeof (/** @type {any} */ (loaded).entries) === 'object'
  ) {
    const raw = /** @type {{ seq?: unknown, entries: Record<string, unknown> }} */ (loaded);
    const valid = Object.entries(raw.entries).filter(([, entry]) => isValidCacheEntry(entry));
    valid.sort((a, b) => /** @type {any} */ (a[1])[3] - /** @type {any} */ (b[1])[3]);
    for (const [id, entry] of valid) {
      entries.set(id, /** @type {[0|1, string|null, string, number]} */ ([...(/** @type {any[]} */ (entry))]));
    }
    const maxSeq = valid.length > 0 ? /** @type {any} */ (valid[valid.length - 1][1])[3] : 0;
    seq = Math.max(Number.isFinite(raw.seq) ? /** @type {number} */ (raw.seq) : 0, maxSeq);
    evictOverflow();
  }

  function evictOverflow() {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function serialize() {
    return { version, seq, entries: Object.fromEntries(entries) };
  }

  /** 書き込みを予約する。予約済みなら重ねない。 */
  function requestSave() {
    if (scheduled) return;
    scheduled = true;
    const cancel = schedule(() => {
      scheduled = false;
      cancelScheduled = null;
      saveNow();
    });
    if (scheduled) cancelScheduled = cancel;
  }

  function saveNow() {
    try {
      storage.save(serialize());
    } catch {
      // 保存に失敗しても判定は続ける（次の保存で取り戻すか、再判定されるだけ）
    }
  }

  return {
    get(id, textHash) {
      const entry = entries.get(id);
      if (!entry || entry[2] !== textHash) return null;
      seq += 1;
      entry[3] = seq;
      entries.delete(id);
      entries.set(id, entry);
      // 使った順番も保存しないと、読み直した後によく見るコメントほど先に捨てられる
      requestSave();
      return { hide: entry[0] === 1, category: entry[1] };
    },

    set(id, textHash, verdict) {
      seq += 1;
      entries.delete(id);
      entries.set(id, [verdict.hide ? 1 : 0, verdict.category ?? null, textHash, seq]);
      evictOverflow();
      requestSave();
    },

    flush() {
      if (cancelScheduled !== null) cancelScheduled();
      cancelScheduled = null;
      scheduled = false;
      saveNow();
    },
  };
}
