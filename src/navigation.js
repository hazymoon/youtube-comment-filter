/**
 * @file SPA の遷移の状態（純粋関数）。別の動画へ移ったか、順番待ちに入れてよいかを決める。
 */

import { SHORTS_PATHNAME_PREFIX, WATCH_PATHNAME } from './selectors.js';

/**
 * @typedef {'watch'|'shorts'} PageKind 対象にするページの種類
 */

/**
 * パスから対象のページの種類を返す。対象外なら null。
 * @param {string} pathname location.pathname
 * @returns {PageKind|null}
 */
export function pageKindFromPathname(pathname) {
  if (pathname === WATCH_PATHNAME) return 'watch';
  if (typeof pathname === 'string' && pathname.startsWith(SHORTS_PATHNAME_PREFIX)) return 'shorts';
  return null;
}

/**
 * URL を解釈する。解釈できなければ null。
 * @param {string} href URL
 * @returns {URL|null}
 */
function parseUrl(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/**
 * URL から動画 ID（v パラメータ）を取り出す。動画ページでなければ null。
 * @param {string} href URL
 * @returns {string|null}
 */
export function videoIdFromUrl(href) {
  const url = parseUrl(href);
  if (!url || url.pathname !== WATCH_PATHNAME) return null;
  const id = url.searchParams.get('v');
  return id ? id : null;
}

/**
 * URL から Shorts の動画 ID（/shorts/<id> の <id>）を取り出す。Shorts のページでなければ null。
 * @param {string} href URL
 * @returns {string|null}
 */
export function shortsIdFromUrl(href) {
  const url = parseUrl(href);
  if (!url || !url.pathname.startsWith(SHORTS_PATHNAME_PREFIX)) return null;
  const id = url.pathname.slice(SHORTS_PATHNAME_PREFIX.length).split('/')[0];
  return id ? id : null;
}

/**
 * URL から、コメント欄の判定を引き継いでよい単位のキーを作る。対象のページでなければ null。
 * 同じ動画でも動画ページと Shorts ではコメント欄の要素が別なので、ページの種類もキーに含める。
 * @param {string} href URL
 * @returns {string|null} "watch:<id>" か "shorts:<id>"
 */
export function pageKeyFromUrl(href) {
  const watchId = videoIdFromUrl(href);
  if (watchId) return `watch:${watchId}`;
  const shortsId = shortsIdFromUrl(href);
  if (shortsId) return `shorts:${shortsId}`;
  return null;
}

/**
 * @typedef {object} NavigationState
 * @property {() => void} start 遷移の開始（yt-navigate-start）
 * @property {(href: string) => { videoChanged: boolean }} finish 遷移の完了（yt-navigate-finish）。別の動画か動画以外のページへ移ったかを返す
 * @property {() => boolean} canEnqueue AI の順番待ちに入れてよいか
 */

/**
 * 遷移の状態を作る。
 *
 * - コメント欄を閉じて判定を捨てるのは、動画（Shorts を含む）が変わったときだけにする。同じ動画の中の遷移
 *   （時刻や lc= 付きの URL）で読んでいる途中の欄を閉じないため
 * - Shorts で次の動画へ移ると、コメント欄の要素は使い回されたまま中身が入れ替わる（docs/dom-structure.md）。
 *   動画ページと同じく別の動画として扱い、欄を閉じる
 * - 遷移の開始から完了までは順番待ちに入れない。DOM に残る前の動画の thread を入れ直さないため
 *
 * @param {string} initialHref 起動時の URL
 * @returns {NavigationState}
 */
export function createNavigationState(initialHref) {
  let pageKey = pageKeyFromUrl(initialHref);
  let navigating = false;
  return {
    start() {
      navigating = true;
    },
    finish(href) {
      navigating = false;
      const next = pageKeyFromUrl(href);
      const videoChanged = next !== pageKey;
      pageKey = next;
      return { videoChanged };
    },
    canEnqueue() {
      return !navigating;
    },
  };
}
