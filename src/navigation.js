/**
 * @file SPA の遷移の状態（純粋関数）。別の動画へ移ったか、順番待ちに入れてよいかを決める。
 */

import { WATCH_PATHNAME } from './selectors.js';

/**
 * URL から動画 ID（v パラメータ）を取り出す。動画ページでなければ null。
 * @param {string} href URL
 * @returns {string|null}
 */
export function videoIdFromUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.pathname !== WATCH_PATHNAME) return null;
  const id = url.searchParams.get('v');
  return id ? id : null;
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
 * - コメント欄を閉じて判定を捨てるのは、動画 ID が変わったときだけにする。同じ動画の中の遷移
 *   （時刻や lc= 付きの URL）で読んでいる途中の欄を閉じないため
 * - 遷移の開始から完了までは順番待ちに入れない。DOM に残る前の動画の thread を入れ直さないため
 *
 * 遷移のイベントが来る条件は未確認（selectors.js の NAVIGATE_START_EVENT / NAVIGATE_FINISH_EVENT）。
 * 開始だけ来て完了が来ないと順番待ちに入れられないままになるので、工程 3 で確かめる。
 *
 * @param {string} initialHref 起動時の URL
 * @returns {NavigationState}
 */
export function createNavigationState(initialHref) {
  let videoId = videoIdFromUrl(initialHref);
  let navigating = false;
  return {
    start() {
      navigating = true;
    },
    finish(href) {
      navigating = false;
      const next = videoIdFromUrl(href);
      const videoChanged = next !== videoId;
      videoId = next;
      return { videoChanged };
    },
    canEnqueue() {
      return !navigating;
    },
  };
}
