/**
 * @file NG ワード照合のための本文の正規化。
 */

/**
 * 全角英数・半角カナなどの表記ゆれを NFKC で統一する。
 * @param {string} text 本文
 * @returns {string} NFKC 正規化した本文
 */
export function toNfkc(text) {
  return String(text ?? '').normalize('NFKC');
}

// Katakana range that has a hiragana counterpart at -0x60 (ァ..ヶ, ヽ, ヾ).
// U+30FC (ー, prolonged sound mark) is intentionally excluded.
const KATAKANA_TO_HIRAGANA_PATTERN = /[ァ-ヶヽヾ]/g;

// Punctuation, symbols (incl. most emoji), and whitespace.
// ZWJ, variation selectors, the keycap mark, and tag characters (U+E0001, U+E0020..U+E007F, used by
// subdivision flags) are not \p{P}/\p{S} but only make up emoji sequences.
const MATCH_NOISE_PATTERN = /[\p{P}\p{S}\s\u200D\uFE0E\uFE0F\u20E3\u{E0001}\u{E0020}-\u{E007F}]/gu;

/**
 * NG ワードの文字列照合用に本文を正規化する。
 * NFKC → 小文字化 → カタカナをひらがなに → 記号・空白・絵文字を除去、の順に行う。
 * 長音符「ー」は語の一部なので残す（「ばーか」と「ばか」を同一視しない）。
 * 分かち書きや記号を挟んだ書き方（「あ ほ」「あ.ほ」）を同じ語として照合するために記号と空白を除く。
 * @param {string} text 本文
 * @returns {string} 正規化した本文。絵文字だけの本文などは空文字になる
 */
export function normalizeForMatch(text) {
  return toNfkc(text)
    .toLowerCase()
    .replace(KATAKANA_TO_HIRAGANA_PATTERN, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(MATCH_NOISE_PATTERN, '');
}
