/**
 * @file Violentmonkey の「値」タブに書く設定の読み書き。NG ユーザ・NG ワード・許可ユーザと、設定ブロックの定数を上書きする値を扱う。
 *
 * スクリプト本体の NG_USERS / NG_WORDS は dist を貼り替えると空に戻るが、値は貼り替えても残る。
 * 値は JSON なので正規表現を直接書けず、"/…/flags" の形の文字列で書く。
 */

import {
  AI_BATCH_SIZE,
  AI_CACHE_MAX_ENTRIES,
  AI_CATEGORIES,
  AI_ENABLED,
  AI_MAX_CHARS,
  AI_TIMEOUT_MS,
  DEBUG,
  EXEMPT_OWNER,
  EXEMPT_PINNED,
  EXEMPT_VERIFIED,
  PREVIEW_CHARS,
  REVEAL_DELAY_MS,
  REVEAL_MS_PER_LINE,
} from './config.js';

/** 値の名前。「値」タブにこの名前で文字列の配列を書く */
export const NG_USERS_VALUE_KEY = 'ngUsers';

/** 値の名前。「値」タブにこの名前で文字列の配列を書く */
export const NG_WORDS_VALUE_KEY = 'ngWords';

/** 値の名前。「値」タブにこの名前で文字列の配列を書く */
export const ALLOW_USERS_VALUE_KEY = 'allowUsers';

// "/source/flags". The source must be non-empty so that "//" stays a plain word.
const REGEXP_LITERAL_PATTERN = /^\/(.+)\/([a-z]*)$/s;

/**
 * 値を文字列の配列として読む。配列でない値と文字列でない要素は捨てる。
 * @param {unknown} value 値
 * @param {string} key 値の名前（警告に使う）
 * @param {string[]} warnings 警告の追加先
 * @returns {string[]}
 */
function readStringArray(value, key, warnings) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push(`値 ${key}: 文字列の配列ではないので無視しました`);
    return [];
  }
  const strings = [];
  for (const element of value) {
    if (typeof element === 'string') strings.push(element);
    else warnings.push(`値 ${key}: 文字列ではない要素を無視しました: ${String(element)}`);
  }
  return strings;
}

/**
 * 「値」タブの NG ユーザ・NG ワード・許可ユーザを、NG_USERS / NG_WORDS / ALLOW_USERS と同じ形にする。
 * 不正な要素は例外にせず捨て、理由を warnings に入れる（設定の 1 か所の誤りでスクリプト全体を止めないため）。
 * @param {{ ngUsers: unknown, ngWords: unknown, allowUsers?: unknown }} stored GM_getValue で読んだ値
 * @returns {{ ngUsers: string[], ngWords: (string|RegExp)[], allowUsers: string[], warnings: string[] }}
 */
export function parseStoredSettings({ ngUsers, ngWords, allowUsers }) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {(string|RegExp)[]} */
  const words = [];
  for (const word of readStringArray(ngWords, NG_WORDS_VALUE_KEY, warnings)) {
    const literal = REGEXP_LITERAL_PATTERN.exec(word);
    if (!literal) {
      words.push(word);
      continue;
    }
    try {
      words.push(new RegExp(literal[1], literal[2]));
    } catch {
      warnings.push(`値 ${NG_WORDS_VALUE_KEY}: 正規表現として解釈できないので無視しました: ${word}`);
    }
  }
  return {
    ngUsers: readStringArray(ngUsers, NG_USERS_VALUE_KEY, warnings),
    ngWords: words,
    allowUsers: readStringArray(allowUsers, ALLOW_USERS_VALUE_KEY, warnings),
    warnings,
  };
}

/**
 * 「値」の ngUsers に 1 件足した配列を返す。保存は呼び出し側が行う。
 * 値が配列でないときは、利用者が書いた内容を上書きで消さないよう null を返す。
 * 同じ文字列が既にあれば足さない。
 * @param {unknown} value GM_getValue で読んだ ngUsers
 * @param {string} entry 足すハンドルかチャンネル ID
 * @returns {unknown[]|null} 足した後の配列。足せないときは null
 */
export function appendStoredUser(value, entry) {
  if (value === undefined || value === null) return [entry];
  if (!Array.isArray(value)) return null;
  return value.includes(entry) ? [...value] : [...value, entry];
}

/**
 * 「値」タブで設定ブロックの定数を上書きする値。各プロパティの説明は対応する config.js の定数。
 * @typedef {object} StoredOptions
 * @property {boolean} aiEnabled AI_ENABLED
 * @property {{ name: string, description: string }[]} aiCategories AI_CATEGORIES
 * @property {number} aiBatchSize AI_BATCH_SIZE
 * @property {number} aiTimeoutMs AI_TIMEOUT_MS
 * @property {number} aiMaxChars AI_MAX_CHARS
 * @property {number} aiCacheMaxEntries AI_CACHE_MAX_ENTRIES
 * @property {number} previewChars PREVIEW_CHARS
 * @property {number} revealDelayMs REVEAL_DELAY_MS
 * @property {number} revealMsPerLine REVEAL_MS_PER_LINE
 * @property {boolean} exemptOwner EXEMPT_OWNER
 * @property {boolean} exemptPinned EXEMPT_PINNED
 * @property {boolean} exemptVerified EXEMPT_VERIFIED
 * @property {boolean} debug DEBUG
 */

/**
 * 値が真偽値かを確かめる。
 * @param {unknown} value 値
 * @returns {string|null} 不正なら理由、正しければ null
 */
function checkStoredBoolean(value) {
  return typeof value === 'boolean' ? null : 'true か false で書いてください';
}

/**
 * 値が下限以上の整数かを確かめる関数を作る。
 * @param {number} min 下限（含む）
 * @returns {(value: unknown) => string|null} 不正なら理由、正しければ null を返す関数
 */
function storedIntegerAtLeast(min) {
  return (value) => (Number.isInteger(value) && Number(value) >= min ? null : `${min} 以上の整数で書いてください`);
}

/**
 * 値が下限以上・上限以下の整数かを確かめる関数を作る。
 * @param {number} min 下限（含む）
 * @param {number} max 上限（含む）
 * @returns {(value: unknown) => string|null} 不正なら理由、正しければ null を返す関数
 */
function storedIntegerBetween(min, max) {
  return (value) =>
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max
      ? null
      : `${min} 以上 ${max} 以下の整数で書いてください`;
}

/**
 * setTimeout が受け付ける待ち時間の上限（ミリ秒。32 ビットの符号付き整数の最大値）。
 * 超える値はタイマーの範囲外で、すぐ発火するなど、指定どおりに待たない（Node では 1 ミリ秒に丸められた）
 */
const MAX_STORED_TIMEOUT_MS = 2147483647;

/** aiBatchSize の上限。まとめた判定の所要時間と正確さを計測したのが 10 件までのため（docs/spike.md） */
const MAX_STORED_BATCH_SIZE = 10;

/**
 * 値が AI のカテゴリの配列かを確かめる。
 * @param {unknown} value 値
 * @returns {string|null} 不正なら理由、正しければ null
 */
function checkStoredCategories(value) {
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (category) =>
        typeof category === 'object' &&
        category !== null &&
        typeof category.name === 'string' &&
        category.name !== '' &&
        typeof category.description === 'string',
    );
  if (!valid) return '{ "name": 空でない文字列, "description": 文字列 } を 1 つ以上並べた配列で書いてください';
  // name は AI の応答の category の enum になる（src/ai.js の buildResponseSchema）ので、重複させない
  const names = value.map((category) => category.name);
  return new Set(names).size === names.length ? null : 'name が重複しないように書いてください';
}

/**
 * 設定ブロックの定数を上書きする値の表（値の名前 → 既定値・検査・読んだ値の写し方）。
 * 下限は、その値を下回ると動きが壊れる境目にする。
 * - aiEnabled / exemptOwner / exemptPinned / exemptVerified / debug: 真偽値
 * - aiCategories: { name: 空でない文字列, description: 文字列 } を 1 つ以上並べた配列で、name は重複しない。要素が 1 つでも不正なら全体を
 *   既定値に戻す（不正な要素だけを捨てると、利用者が隠したいカテゴリが黙って判定から抜けるため）
 * - aiBatchSize: 1 以上 10 以下の整数（1 で 1 件ずつ判定する。上限は docs/spike.md で計測した件数）
 * - aiTimeoutMs: 1 以上 2147483647 以下の整数（ミリ秒。0 以下では判定がすぐ打ち切られる。上限は setTimeout の上限）
 * 上限は、超えると動きが壊れるか計測していない範囲に入るキーにだけ付ける。
 * - aiMaxChars: 1 以上の整数（0 では AI に本文が渡らない）
 * - aiCacheMaxEntries: 1 以上の整数（0 では判定結果を保存できない）
 * - previewChars: 1 以上の整数（0 では表示するコメントの文頭も見えない）
 * - revealDelayMs: 0 以上の整数（ミリ秒。0 で待たずに見せ始める）
 * - revealMsPerLine: 1 以上の整数（ミリ秒）
 * @type {Record<keyof StoredOptions, { defaultValue: unknown, defaultLabel?: string, check: (value: unknown) => string|null, copy?: (value: any) => unknown }>}
 */
const STORED_OPTION_SPECS = {
  aiEnabled: { defaultValue: AI_ENABLED, check: checkStoredBoolean },
  aiCategories: {
    defaultValue: AI_CATEGORIES,
    // 既定のカテゴリは長いので、警告には中身でなく定数の名前を出す
    defaultLabel: '（config.js の AI_CATEGORIES）',
    check: checkStoredCategories,
    copy: (categories) => categories.map(({ name, description }) => ({ name, description })),
  },
  aiBatchSize: { defaultValue: AI_BATCH_SIZE, check: storedIntegerBetween(1, MAX_STORED_BATCH_SIZE) },
  aiTimeoutMs: { defaultValue: AI_TIMEOUT_MS, check: storedIntegerBetween(1, MAX_STORED_TIMEOUT_MS) },
  aiMaxChars: { defaultValue: AI_MAX_CHARS, check: storedIntegerAtLeast(1) },
  aiCacheMaxEntries: { defaultValue: AI_CACHE_MAX_ENTRIES, check: storedIntegerAtLeast(1) },
  previewChars: { defaultValue: PREVIEW_CHARS, check: storedIntegerAtLeast(1) },
  revealDelayMs: { defaultValue: REVEAL_DELAY_MS, check: storedIntegerAtLeast(0) },
  revealMsPerLine: { defaultValue: REVEAL_MS_PER_LINE, check: storedIntegerAtLeast(1) },
  exemptOwner: { defaultValue: EXEMPT_OWNER, check: checkStoredBoolean },
  exemptPinned: { defaultValue: EXEMPT_PINNED, check: checkStoredBoolean },
  exemptVerified: { defaultValue: EXEMPT_VERIFIED, check: checkStoredBoolean },
  debug: { defaultValue: DEBUG, check: checkStoredBoolean },
};

/**
 * 「値」タブで設定ブロックの定数を上書きする値を読む。値の名前と範囲は STORED_OPTION_SPECS にある。
 * 値が無い（undefined / null）ときは config.js の既定値を使う。
 * 不正な値は例外にせず既定値に戻し、理由を warnings に入れる（設定の 1 か所の誤りでスクリプト全体を止めないため）。
 * @param {(key: string) => unknown} read 値の名前から値を読む関数（GM_getValue）
 * @returns {{ options: StoredOptions, warnings: string[] }}
 */
export function parseStoredOptions(read) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, unknown>} */
  const options = {};
  for (const [key, spec] of Object.entries(STORED_OPTION_SPECS)) {
    const value = read(key);
    if (value === undefined || value === null) {
      options[key] = spec.defaultValue;
      continue;
    }
    const problem = spec.check(value);
    if (problem) {
      // 書いた値と既定値を取り違えないよう、どちらの値かを名指しして並べる
      const defaultText = spec.defaultLabel ?? JSON.stringify(spec.defaultValue);
      warnings.push(`値 ${key}: ${problem}。書いた値: ${JSON.stringify(value)}。既定値 ${defaultText} を使います`);
      options[key] = spec.defaultValue;
      continue;
    }
    options[key] = spec.copy ? spec.copy(value) : value;
  }
  return { options: /** @type {StoredOptions} */ (options), warnings };
}
