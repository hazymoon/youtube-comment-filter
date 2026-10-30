/**
 * @file 動画の投稿者と、コメントの投稿者の表示名を読む関数（なりすましの判定に使う。rules.js の matchImpersonation）。
 *
 * dom.js と同じく、渡された document・要素から querySelector / getAttribute / textContent と page 世界のデータだけを読む。
 */

import { findOwnViewModel, handleFromHref } from './dom.js';
import { videoIdFromUrl } from './navigation.js';
import {
  SHORTS_OWNER_HANDLE_SELECTOR,
  SHORTS_OWNER_NAME_SELECTOR,
  SHORTS_TAG,
  WATCH_FLEXY_TAG,
  WATCH_OWNER_HANDLE_SELECTOR,
  WATCH_OWNER_NAME_SELECTOR,
  WATCH_VIDEO_ID_ATTR,
} from './selectors.js';

/**
 * 要素の textContent の前後の空白を除いたものを返す。空なら null。
 * @param {any} el 要素
 * @returns {string|null}
 */
function trimmedTextOf(el) {
  const text = String(el?.textContent ?? '').trim();
  return text === '' ? null : text;
}

/**
 * 投稿者の要素の入れ物から、ハンドルと表示名を読む。どちらも読めなければ null。
 * @param {any} root 入れ物
 * @param {string} handleSelector ハンドルのリンク
 * @param {string} nameSelector 表示名の要素
 * @returns {import('./rules.js').VideoOwner|null}
 */
function readOwnerIn(root, handleSelector, nameSelector) {
  const handle = handleFromHref(root?.querySelector?.(handleSelector)?.getAttribute?.('href'));
  const displayName = trimmedTextOf(root?.querySelector?.(nameSelector));
  return handle === null && displayName === null ? null : { handle, displayName };
}

/**
 * いまの動画の投稿者を読む。読めないときは null（呼び出し側はなりすましの判定をしない）。
 * 動画ページでは、遷移の途中に前の動画の投稿者が残るので、ytd-watch-flexy の video-id が URL の動画と一致するときだけ読む。
 * Shorts では投稿者の要素に動画 ID が無く確かめられないので、そのまま読む（遷移の直後は前の動画の投稿者を返しうる。
 * 投稿者が変わったら scanner.js が判定し直す）。docs/dom-structure.md「動画の投稿者」
 * @param {any} doc document
 * @param {import('./navigation.js').PageKind|null} pageKind ページの種類
 * @param {string} href location.href
 * @returns {import('./rules.js').VideoOwner|null}
 */
export function readVideoOwner(doc, pageKind, href) {
  if (pageKind === 'watch') {
    const flexy = doc?.querySelector?.(WATCH_FLEXY_TAG);
    const videoId = videoIdFromUrl(href);
    if (!flexy || videoId === null || flexy.getAttribute?.(WATCH_VIDEO_ID_ATTR) !== videoId) return null;
    return readOwnerIn(flexy, WATCH_OWNER_HANDLE_SELECTOR, WATCH_OWNER_NAME_SELECTOR);
  }
  if (pageKind === 'shorts') {
    return readOwnerIn(doc?.querySelector?.(SHORTS_TAG), SHORTS_OWNER_HANDLE_SELECTOR, SHORTS_OWNER_NAME_SELECTOR);
  }
  return null;
}

/**
 * コメントの投稿者の表示名を読む（commentEntity.author.displayName。docs/dom-structure.md「データ」）。
 * extractComment の戻り値の形を変えないよう、別の関数にしている。
 * @param {any} threadEl ytd-comment-thread-renderer
 * @returns {string|null}
 */
export function readCommentAuthorDisplayName(threadEl) {
  const name = findOwnViewModel(threadEl)?.polymerController?.__data?.commentEntity?.author?.displayName;
  return typeof name === 'string' && name !== '' ? name : null;
}
