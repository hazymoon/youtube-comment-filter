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

// ラテン文字に見えるキリル文字・ギリシャ文字と、見た目の同じラテン小文字の対応表。
// 「ѕраm」のように一部の文字をキリル文字に差し替えて NG ワードの照合をすり抜ける書き方を、同じ語として照合するために使う。
// 出典は Unicode UTS #39 の confusables.txt（https://www.unicode.org/Public/security/latest/confusables.txt、
// Date: 2026-08-06）。そこから、キリル文字・ギリシャ文字の 1 文字がラテン小文字（a〜z）の 1 文字に対応する行のうち、
// NFKC と小文字化を経ても形の変わらない小文字だけを載せる。大文字は小文字化した後にこの表で引くので載せない。
// 数字や記号との置き換え（0→o など）は対象外。
// Each key carries its Unicode name because the glyphs are visually indistinguishable from their Latin values.
const CONFUSABLE_LETTER_TO_LATIN = new Map([
  ['α', 'a'], // GREEK SMALL LETTER ALPHA
  ['а', 'a'], // CYRILLIC SMALL LETTER A
  ['с', 'c'], // CYRILLIC SMALL LETTER ES
  ['ᲃ', 'c'], // CYRILLIC SMALL LETTER WIDE ES
  ['ԁ', 'd'], // CYRILLIC SMALL LETTER KOMI DE
  ['е', 'e'], // CYRILLIC SMALL LETTER IE
  ['ҽ', 'e'], // CYRILLIC SMALL LETTER ABKHASIAN CHE
  ['һ', 'h'], // CYRILLIC SMALL LETTER SHHA
  ['ι', 'i'], // GREEK SMALL LETTER IOTA
  ['і', 'i'], // CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
  ['ꙇ', 'i'], // CYRILLIC SMALL LETTER IOTA
  ['ϳ', 'j'], // GREEK LETTER YOT
  ['ј', 'j'], // CYRILLIC SMALL LETTER JE
  ['ӏ', 'l'], // CYRILLIC SMALL LETTER PALOCHKA
  ['ο', 'o'], // GREEK SMALL LETTER OMICRON
  ['σ', 'o'], // GREEK SMALL LETTER SIGMA
  ['о', 'o'], // CYRILLIC SMALL LETTER O
  ['ᲂ', 'o'], // CYRILLIC SMALL LETTER NARROW O
  ['ρ', 'p'], // GREEK SMALL LETTER RHO
  ['ϸ', 'p'], // GREEK SMALL LETTER SHO
  ['р', 'p'], // CYRILLIC SMALL LETTER ER
  ['ԛ', 'q'], // CYRILLIC SMALL LETTER QA
  ['ᴦ', 'r'], // GREEK LETTER SMALL CAPITAL GAMMA
  ['г', 'r'], // CYRILLIC SMALL LETTER GHE
  ['ѕ', 's'], // CYRILLIC SMALL LETTER DZE
  ['υ', 'u'], // GREEK SMALL LETTER UPSILON
  ['ν', 'v'], // GREEK SMALL LETTER NU
  ['ѵ', 'v'], // CYRILLIC SMALL LETTER IZHITSA
  ['ѡ', 'w'], // CYRILLIC SMALL LETTER OMEGA
  ['ш', 'w'], // CYRILLIC SMALL LETTER SHA
  ['ԝ', 'w'], // CYRILLIC SMALL LETTER WE
  ['х', 'x'], // CYRILLIC SMALL LETTER HA
  ['γ', 'y'], // GREEK SMALL LETTER GAMMA
  ['у', 'y'], // CYRILLIC SMALL LETTER U
  ['ү', 'y'], // CYRILLIC SMALL LETTER STRAIGHT U
]);

// All keys are single BMP code points, so a character class built from them matches exactly one key.
const CONFUSABLE_LETTER_PATTERN = new RegExp(`[${[...CONFUSABLE_LETTER_TO_LATIN.keys()].join('')}]`, 'gu');

/**
 * ラテン文字に見えるキリル文字・ギリシャ文字を、見た目の同じラテン小文字に置き換える。
 * 対応表は小文字だけを持つので、入力は NFKC 正規化と小文字化を済ませておく。
 * @param {string} text NFKC 正規化・小文字化済みの文字列
 * @returns {string} 置き換えた文字列。対応表にない文字（日本語・ラテン文字など）はそのまま残る
 */
export function replaceConfusableLetters(text) {
  return text.replace(CONFUSABLE_LETTER_PATTERN, (ch) => CONFUSABLE_LETTER_TO_LATIN.get(ch) ?? ch);
}

// Katakana range that has a hiragana counterpart at -0x60 (ァ..ヶ, ヽ, ヾ).
// U+30FC (ー, prolonged sound mark) is intentionally excluded.
const KATAKANA_TO_HIRAGANA_PATTERN = /[ァ-ヶヽヾ]/g;

// Punctuation, symbols (incl. most emoji), whitespace, and format characters (\p{Cf}: zero-width
// space/joiner, soft hyphen, word joiner, tag characters used by subdivision flags, ...).
// Variation selectors and the keycap mark are not \p{P}/\p{S}/\p{Cf} but only make up emoji sequences.
const MATCH_NOISE_PATTERN = /[\p{P}\p{S}\s\p{Cf}\uFE0E\uFE0F\u20E3]/gu;

// Combining marks left after NFC recomposition (e.g. overlaid strike-through U+0336, or a voiced sound
// mark that has no precomposed form with the preceding character).
const COMBINING_MARK_PATTERN = /\p{Mn}/gu;

/**
 * NG ワードの文字列照合用に本文を正規化する。
 * NFKC → 小文字化 → ラテン文字に見えるキリル文字・ギリシャ文字をラテン文字に → カタカナをひらがなに → 記号・空白・絵文字・書式文字を除去 → NFC → 結合文字を除去、の順に行う。
 * NFKC はスペーシング濁点（゛）を「空白 + 結合濁点」に分けるので、空白を除いた後に NFC で前の文字と合成し直す
 * （「は゛か」を「ばか」と照合するため）。合成できずに残った結合文字（打ち消し線など）は除く。
 * 長音符「ー」は語の一部なので残す（「ばーか」と「ばか」を同一視しない）。
 * 分かち書きや記号を挟んだ書き方（「あ ほ」「あ.ほ」）を同じ語として照合するために記号と空白を除く。
 * @param {string} text 本文
 * @returns {string} 正規化した本文。絵文字だけの本文などは空文字になる
 */
export function normalizeForMatch(text) {
  return replaceConfusableLetters(toNfkc(text).toLowerCase())
    .replace(KATAKANA_TO_HIRAGANA_PATTERN, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(MATCH_NOISE_PATTERN, '')
    .normalize('NFC')
    .replace(COMBINING_MARK_PATTERN, '');
}
