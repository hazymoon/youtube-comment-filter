/**
 * @file Violentmonkey の「値」タブに書く NG ユーザ・NG ワードの読み取り。
 *
 * スクリプト本体の NG_USERS / NG_WORDS は dist を貼り替えると空に戻るが、値は貼り替えても残る。
 * 値は JSON なので正規表現を直接書けず、"/…/flags" の形の文字列で書く。
 */

/** 値の名前。「値」タブにこの名前で文字列の配列を書く */
export const NG_USERS_VALUE_KEY = 'ngUsers';

/** 値の名前。「値」タブにこの名前で文字列の配列を書く */
export const NG_WORDS_VALUE_KEY = 'ngWords';

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
 * 「値」タブの NG ユーザ・NG ワードを、NG_USERS / NG_WORDS と同じ形にする。
 * 不正な要素は例外にせず捨て、理由を warnings に入れる（設定の 1 か所の誤りでスクリプト全体を止めないため）。
 * @param {{ ngUsers: unknown, ngWords: unknown }} stored GM_getValue で読んだ値
 * @returns {{ ngUsers: string[], ngWords: (string|RegExp)[], warnings: string[] }}
 */
export function parseStoredSettings({ ngUsers, ngWords }) {
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
  return { ngUsers: readStringArray(ngUsers, NG_USERS_VALUE_KEY, warnings), ngWords: words, warnings };
}
