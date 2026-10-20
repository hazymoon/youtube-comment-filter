/**
 * @file 文字列のハッシュ。
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UTF8_ENCODER = new TextEncoder();

/**
 * 文字列の FNV-1a 32bit ハッシュを返す。
 * コメント本文の編集の検出と、プロンプト・カテゴリのバージョン識別に使う（暗号用途ではない）。
 * @param {string} text 対象の文字列
 * @returns {string} 8 桁の 16 進文字列
 */
export function hashString(text) {
  let hash = FNV_OFFSET_BASIS;
  // Hash UTF-8 bytes so the result is independent of UTF-16 surrogate handling.
  for (const byte of UTF8_ENCODER.encode(String(text ?? ''))) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
