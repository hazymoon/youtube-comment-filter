/**
 * @file いまの動画のタイトルを読む関数（AI の判定の手がかりに使う。ai.js の buildBatchInput）。
 *
 * owner.js と同じく、渡された document から querySelector / getAttribute / textContent だけを読む。
 */

import { shortsIdFromUrl, videoIdFromUrl } from './navigation.js';
import {
  SHORTS_TAG,
  SHORTS_TITLE_LINK_SELECTOR,
  WATCH_FLEXY_TAG,
  WATCH_TITLE_SELECTOR,
  WATCH_VIDEO_ID_ATTR,
} from './selectors.js';

/**
 * 要素の textContent の前後の空白を除き、続く空白を 1 つにまとめて、code point 単位で切り詰める。空なら null。
 * @param {any} el 要素
 * @param {number} maxChars 最大文字数
 * @returns {string|null}
 */
function titleTextOf(el, maxChars) {
  const text = String(el?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  // Truncate by code points so surrogate pairs are never split.
  return Array.from(text).slice(0, maxChars).join('');
}

/**
 * いまの動画のタイトルを読む。読めないときは null（呼び出し側はタイトル無しで判定する）。
 * 遷移の途中には前の動画のタイトルが残るので、URL の動画 ID と一致すると確かめられたときだけ読む。
 * 動画ページは ytd-watch-flexy の video-id、Shorts はタイトルのリンクの href で確かめる。docs/dom-structure.md「動画のタイトル」
 * @param {any} doc document
 * @param {import('./navigation.js').PageKind|null} pageKind ページの種類
 * @param {string} href location.href
 * @param {number} maxChars 最大文字数（AI_TITLE_MAX_CHARS）
 * @returns {string|null}
 */
export function readVideoTitle(doc, pageKind, href, maxChars) {
  if (pageKind === 'watch') {
    const flexy = doc?.querySelector?.(WATCH_FLEXY_TAG);
    const videoId = videoIdFromUrl(href);
    if (!flexy || videoId === null || flexy.getAttribute?.(WATCH_VIDEO_ID_ATTR) !== videoId) return null;
    return titleTextOf(flexy.querySelector?.(WATCH_TITLE_SELECTOR), maxChars);
  }
  if (pageKind === 'shorts') {
    const link = doc?.querySelector?.(SHORTS_TAG)?.querySelector?.(SHORTS_TITLE_LINK_SELECTOR);
    const shortsId = shortsIdFromUrl(href);
    if (!link || shortsId === null || shortsIdFromUrl(String(link.getAttribute?.('href') ?? '')) !== shortsId) {
      return null;
    }
    return titleTextOf(link, maxChars);
  }
  return null;
}
