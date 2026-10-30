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

// ラテン文字に見えるキリル文字・ギリシャ文字と、見た目の同じラテン文字の対応表。
// 「ѕраm」のように一部の文字をキリル文字に差し替えて NG ワードの照合をすり抜ける書き方を、同じ語として照合するために使う。
// 出典は Unicode UTS #39 の confusables.txt（Date: 2026-08-06）:
// https://www.unicode.org/Public/security/latest/confusables.txt
// そこから、キリル文字・ギリシャ文字の 1 文字（NFKC で形の変わらない文字）がラテン文字（A〜Z・a〜z）の 1 文字に対応する行を、
// 大文字・小文字とも載せる。小文字化より前に引くのは、大文字を小文字にすると似るラテン文字が変わるか無くなる文字があるため
// （ギリシャ文字の Ν は N に似るが、小文字の ν は v に似る。キリル文字の М は M に似るが、小文字の м はどれにも似ない）。
// 数字や記号との置き換え（0→o など）は対象外。
// Each key carries its Unicode name because the glyphs are visually indistinguishable from their Latin values.
const CONFUSABLE_LETTER_TO_LATIN = new Map([
  ['α', 'a'], // GREEK SMALL LETTER ALPHA
  ['а', 'a'], // CYRILLIC SMALL LETTER A
  ['Α', 'A'], // GREEK CAPITAL LETTER ALPHA
  ['А', 'A'], // CYRILLIC CAPITAL LETTER A
  ['Ь', 'b'], // CYRILLIC CAPITAL LETTER SOFT SIGN
  ['Β', 'B'], // GREEK CAPITAL LETTER BETA
  ['В', 'B'], // CYRILLIC CAPITAL LETTER VE
  ['с', 'c'], // CYRILLIC SMALL LETTER ES
  ['ᲃ', 'c'], // CYRILLIC SMALL LETTER WIDE ES
  ['С', 'C'], // CYRILLIC CAPITAL LETTER ES
  ['ԁ', 'd'], // CYRILLIC SMALL LETTER KOMI DE
  ['е', 'e'], // CYRILLIC SMALL LETTER IE
  ['ҽ', 'e'], // CYRILLIC SMALL LETTER ABKHASIAN CHE
  ['Ε', 'E'], // GREEK CAPITAL LETTER EPSILON
  ['Е', 'E'], // CYRILLIC CAPITAL LETTER IE
  ['Ϝ', 'F'], // GREEK LETTER DIGAMMA
  ['Ԍ', 'G'], // CYRILLIC CAPITAL LETTER KOMI SJE
  ['һ', 'h'], // CYRILLIC SMALL LETTER SHHA
  ['Һ', 'h'], // CYRILLIC CAPITAL LETTER SHHA
  ['Η', 'H'], // GREEK CAPITAL LETTER ETA
  ['Н', 'H'], // CYRILLIC CAPITAL LETTER EN
  ['ι', 'i'], // GREEK SMALL LETTER IOTA
  ['і', 'i'], // CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
  ['ꙇ', 'i'], // CYRILLIC SMALL LETTER IOTA
  ['ϳ', 'j'], // GREEK LETTER YOT
  ['ј', 'j'], // CYRILLIC SMALL LETTER JE
  ['Ϳ', 'J'], // GREEK CAPITAL LETTER YOT
  ['Ј', 'J'], // CYRILLIC CAPITAL LETTER JE
  ['Κ', 'K'], // GREEK CAPITAL LETTER KAPPA
  ['К', 'K'], // CYRILLIC CAPITAL LETTER KA
  ['Ι', 'l'], // GREEK CAPITAL LETTER IOTA
  ['І', 'l'], // CYRILLIC CAPITAL LETTER BYELORUSSIAN-UKRAINIAN I
  ['ӏ', 'l'], // CYRILLIC SMALL LETTER PALOCHKA
  ['Ӏ', 'l'], // CYRILLIC LETTER PALOCHKA
  ['Μ', 'M'], // GREEK CAPITAL LETTER MU
  ['Ϻ', 'M'], // GREEK CAPITAL LETTER SAN
  ['М', 'M'], // CYRILLIC CAPITAL LETTER EM
  ['Ν', 'N'], // GREEK CAPITAL LETTER NU
  ['ο', 'o'], // GREEK SMALL LETTER OMICRON
  ['σ', 'o'], // GREEK SMALL LETTER SIGMA
  ['о', 'o'], // CYRILLIC SMALL LETTER O
  ['ᲂ', 'o'], // CYRILLIC SMALL LETTER NARROW O
  ['Ο', 'O'], // GREEK CAPITAL LETTER OMICRON
  ['О', 'O'], // CYRILLIC CAPITAL LETTER O
  ['ρ', 'p'], // GREEK SMALL LETTER RHO
  ['ϸ', 'p'], // GREEK SMALL LETTER SHO
  ['р', 'p'], // CYRILLIC SMALL LETTER ER
  ['Ρ', 'P'], // GREEK CAPITAL LETTER RHO
  ['Р', 'P'], // CYRILLIC CAPITAL LETTER ER
  ['ԛ', 'q'], // CYRILLIC SMALL LETTER QA
  ['Ԛ', 'Q'], // CYRILLIC CAPITAL LETTER QA
  ['ᴦ', 'r'], // GREEK LETTER SMALL CAPITAL GAMMA
  ['г', 'r'], // CYRILLIC SMALL LETTER GHE
  ['ѕ', 's'], // CYRILLIC SMALL LETTER DZE
  ['Ѕ', 'S'], // CYRILLIC CAPITAL LETTER DZE
  ['Τ', 'T'], // GREEK CAPITAL LETTER TAU
  ['Т', 'T'], // CYRILLIC CAPITAL LETTER TE
  ['υ', 'u'], // GREEK SMALL LETTER UPSILON
  ['ν', 'v'], // GREEK SMALL LETTER NU
  ['ѵ', 'v'], // CYRILLIC SMALL LETTER IZHITSA
  ['Ѵ', 'V'], // CYRILLIC CAPITAL LETTER IZHITSA
  ['ѡ', 'w'], // CYRILLIC SMALL LETTER OMEGA
  ['ш', 'w'], // CYRILLIC SMALL LETTER SHA
  ['ԝ', 'w'], // CYRILLIC SMALL LETTER WE
  ['Ԝ', 'W'], // CYRILLIC CAPITAL LETTER WE
  ['х', 'x'], // CYRILLIC SMALL LETTER HA
  ['Χ', 'X'], // GREEK CAPITAL LETTER CHI
  ['Х', 'X'], // CYRILLIC CAPITAL LETTER HA
  ['γ', 'y'], // GREEK SMALL LETTER GAMMA
  ['у', 'y'], // CYRILLIC SMALL LETTER U
  ['ү', 'y'], // CYRILLIC SMALL LETTER STRAIGHT U
  ['Υ', 'Y'], // GREEK CAPITAL LETTER UPSILON
  ['У', 'Y'], // CYRILLIC CAPITAL LETTER U
  ['Ү', 'Y'], // CYRILLIC CAPITAL LETTER STRAIGHT U
  ['Ζ', 'Z'], // GREEK CAPITAL LETTER ZETA
]);

// All keys are single BMP code points, so a character class built from them matches exactly one key.
const CONFUSABLE_LETTER_PATTERN = new RegExp(`[${[...CONFUSABLE_LETTER_TO_LATIN.keys()].join('')}]`, 'gu');

/**
 * ラテン文字に見えるキリル文字・ギリシャ文字を、見た目の同じラテン文字に置き換える。
 * 語の文字体系は見ずにすべて置き換える。NG ワードの照合では foldMixedScriptLetters を通して、ラテン文字と混ざった語にだけ使う。
 * @param {string} text NFKC 正規化済みの文字列
 * @returns {string} 置き換えた文字列。対応表にない文字（日本語・ラテン文字など）はそのまま残る
 */
export function replaceConfusableLetters(text) {
  return text.replace(CONFUSABLE_LETTER_PATTERN, (ch) => CONFUSABLE_LETTER_TO_LATIN.get(ch) ?? ch);
}

// A token is a whitespace-delimited run; punctuation inside it (e.g. "ѕ.р.а.m") stays part of the token.
const TOKEN_PATTERN = /\S+/gu;
const LATIN_LETTER_PATTERN = /[\p{Script=Latin}&&\p{L}]/v;
const CYRILLIC_OR_GREEK_LETTER_PATTERN = /[[\p{Script=Cyrillic}\p{Script=Greek}]&&\p{L}]/v;

/**
 * ラテン文字とキリル文字・ギリシャ文字が混ざった語だけ、ラテン文字に見える文字をラテン文字にして小文字化する。
 * 語は空白で区切った単位（記号を挟んだ「ѕ.р.а.m」も 1 語）。
 * キリル文字・ギリシャ文字だけの語（本物のロシア語・ギリシャ語）は置き換えない。置き換えると、ロシア語の「сор」が「cop」になって
 * 英語の NG ワードに当たり、逆にロシア語で書いた NG ワードが英語の本文に当たるため（UTS #39 の文字体系の混在の考え方）。
 * そのため、すべての文字をキリル文字にした書き方（ЅСАМ など）や、1 文字ずつ空白で区切った書き方はすり抜ける。
 * 置き換えは小文字化の前後で 2 回行う。大文字と小文字で似るラテン文字が違う文字（Ν と ν）と、対応表に小文字だけが載る文字（Ш の小文字 ш）の両方を拾うため。
 * @param {string} text NFKC 正規化済みの本文
 * @returns {string} 小文字化した本文
 */
function foldMixedScriptLetters(text) {
  return text.replace(TOKEN_PATTERN, (token) =>
    LATIN_LETTER_PATTERN.test(token) && CYRILLIC_OR_GREEK_LETTER_PATTERN.test(token)
      ? replaceConfusableLetters(replaceConfusableLetters(token).toLowerCase())
      : token.toLowerCase(),
  );
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
 * NFKC → 小文字化（ラテン文字と混ざった語では、ラテン文字に見えるキリル文字・ギリシャ文字をラテン文字に）→ カタカナをひらがなに → 記号・空白・絵文字・書式文字を除去 → NFC → 結合文字を除去、の順に行う。
 * NFKC はスペーシング濁点（゛）を「空白 + 結合濁点」に分けるので、空白を除いた後に NFC で前の文字と合成し直す
 * （「は゛か」を「ばか」と照合するため）。合成できずに残った結合文字（打ち消し線など）は除く。
 * 長音符「ー」は語の一部なので残す（「ばーか」と「ばか」を同一視しない）。
 * 分かち書きや記号を挟んだ書き方（「あ ほ」「あ.ほ」）を同じ語として照合するために記号と空白を除く。
 * @param {string} text 本文
 * @returns {string} 正規化した本文。絵文字だけの本文などは空文字になる
 */
export function normalizeForMatch(text) {
  return foldMixedScriptLetters(toNfkc(text))
    .replace(KATAKANA_TO_HIRAGANA_PATTERN, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(MATCH_NOISE_PATTERN, '')
    .normalize('NFC')
    .replace(COMBINING_MARK_PATTERN, '');
}

/**
 * チャンネルの名前（ハンドル・表示名）を、なりすましの照合用に正規化する。
 * NFKC → ラテン文字に見えるキリル文字・ギリシャ文字をラテン文字に（小文字化の前後で 2 回）→ 記号・空白・書式文字を除去
 * （`.` `_` `-` と先頭の `@` もここで消える）→ NFC → 結合文字を除去、の順に行う。
 * 本文の正規化（normalizeForMatch）と違い、文字体系の混在は見ずにすべて置き換える。名前は短く、すべての文字を
 * キリル文字にした名前でも真似られるため、本物のロシア語の名前と取り違えるおそれより、すり抜けを防ぐ方を取る。
 * 小文字化の前後で置き換えるのは foldMixedScriptLetters と同じ理由（大文字と小文字で似るラテン文字が違うか、無くなる文字がある）。
 * カタカナとひらがなは区別したまま比べる（表示名の表記の違いは別の名前として扱う）。
 * @param {string} name ハンドル（"@" 付きでもよい）か表示名
 * @returns {string} 正規化した名前。記号だけの名前は空文字
 */
export function normalizeIdentityName(name) {
  return replaceConfusableLetters(replaceConfusableLetters(toNfkc(name)).toLowerCase())
    .replace(MATCH_NOISE_PATTERN, '')
    .normalize('NFC')
    .replace(COMBINING_MARK_PATTERN, '');
}
