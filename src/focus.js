/**
 * @file NG 登録で thread が隠れた後に、フォーカスを移す先を決める。
 *
 * NG 登録のボタンは thread の中にあり、登録した後のスキャンで thread ごと display:none になる。
 * そのままだとフォーカスが body に落ち、キーボードで操作している人は次の Tab がどこから始まるか分からなくなるので、
 * 近くの表示中のコメントへ移す。
 * main.js から DOM の読み書きを切り離し、偽の要素でテストできるようにするためにこのファイルに置く。
 */

import { findOwnViewModel, isInsideHiddenThread } from './dom.js';
import { AUTHOR_LINK_SELECTOR, STATE_ATTR } from './selectors.js';

/**
 * コメントの中でフォーカスを移す要素の代わりの候補。投稿者のリンクが無いときに使う。
 * NG 登録のボタン（button）はホバー中しか表示しない（styles.js）ので、表示されていない要素へ移さないよう a だけにする
 */
const FALLBACK_LINK_SELECTOR = 'a[href]';

/**
 * thread が画面に出ているか。表示状態が shown で、祖先の thread も隠れていないものに限る。
 * 親を隠すと返信は親ごと消えるが、返信の表示状態は shown のまま残りうるため、祖先も確かめる。
 * @param {any} thread ytd-comment-thread-renderer
 * @returns {boolean}
 */
function isVisibleThread(thread) {
  return thread?.isConnected !== false && thread?.getAttribute?.(STATE_ATTR) === 'shown' && !isInsideHiddenThread(thread);
}

/**
 * thread の中でフォーカスを移す要素を返す。投稿者のリンク（AUTHOR_LINK_SELECTOR）を選び、無ければ本体の中の最初のリンクにする。
 * 入れ子の返信の要素を選ばないよう、thread の直下のコメント本体（findOwnViewModel）の中だけを探す。
 * @param {any} thread ytd-comment-thread-renderer
 * @returns {any|null} フォーカスできる要素。無ければ null
 */
function focusableIn(thread) {
  const viewModel = findOwnViewModel(thread);
  const target = viewModel?.querySelector?.(AUTHOR_LINK_SELECTOR) ?? viewModel?.querySelector?.(FALLBACK_LINK_SELECTOR) ?? null;
  return typeof target?.focus === 'function' ? target : null;
}

/**
 * フォーカスがその thread が隠れたせいで失われたか（または失われようとしているか）。
 * 隠した直後はブラウザがまだフォーカスを body へ移していないので、thread の中にあるときも失われたとみなす。
 * 利用者がすでに別の場所へ移していたら、そこから奪わない。
 * @param {any} thread NG 登録のボタンが押された thread
 * @param {any} activeElement document.activeElement
 * @param {any} doc document
 * @returns {boolean}
 */
function isFocusLost(thread, activeElement, doc) {
  if (!activeElement || activeElement === doc?.body || activeElement === doc?.documentElement) return true;
  return typeof thread?.contains === 'function' && thread.contains(activeElement);
}

/**
 * thread が隠れたか。表示状態が hidden か、祖先の thread が隠れていれば隠れている。
 * 判定待ち（pending）は NG 登録では起きないので、隠れたとはみなさない。
 * @param {any} thread ytd-comment-thread-renderer
 * @returns {boolean}
 */
function isHiddenThread(thread) {
  return thread.getAttribute?.(STATE_ATTR) === 'hidden' || isInsideHiddenThread(thread);
}

/**
 * NG 登録のボタンが押された thread が隠れたときに、フォーカスを移す先を決める。
 *
 * - thread がまだ表示中（ルールに当たらなかったなど）なら移さない
 * - フォーカスが thread の外の要素にあるなら移さない（利用者が移した先を奪わない）
 * - 移す先は threads（文書順。返信も含む）で thread より後ろの、いちばん近い表示中のコメント。
 *   無ければ thread より前の、いちばん近い表示中のコメント。それも無ければ fallback（件数バーのボタン）
 * - 同じスキャンで隠れた同じ投稿者のコメントや、隠した thread の中の返信は表示中ではないので飛ばす
 * - thread が DOM から外れて threads に無いときは、前後が分からないので fallback にする
 *   （件数バーはコメント欄の直前にあるので、次の Tab で先頭のコメントへ進める）
 * @param {object} options
 * @param {any[]} options.threads コメント欄の thread（文書順）
 * @param {any} options.thread NG 登録のボタンが押された thread
 * @param {any} options.activeElement document.activeElement
 * @param {any} options.doc document（body との比較に使う）
 * @param {any} [options.fallback] 表示中のコメントが無いときの移し先
 * @returns {any|null} フォーカスを移す要素。移さないときは null
 */
export function pickFocusTarget({ threads, thread, activeElement, doc, fallback = null }) {
  if (!thread) return null;
  if (thread.isConnected !== false && !isHiddenThread(thread)) return null;
  if (!isFocusLost(thread, activeElement, doc)) return null;
  const index = threads.indexOf(thread);
  if (index !== -1) {
    const ordered = [...threads.slice(index + 1), ...threads.slice(0, index).reverse()];
    for (const candidate of ordered) {
      if (!isVisibleThread(candidate)) continue;
      const target = focusableIn(candidate);
      if (target) return target;
    }
  }
  return typeof fallback?.focus === 'function' ? fallback : null;
}

/**
 * pickFocusTarget の結果へフォーカスを移す。
 * focus() は既定のスクロールのまま呼ぶ。ブラウザは移した要素が画面の外にあるときだけスクロールするので、
 * キーボードで操作している人には移した先が見え、マウスで押した人には、隣のコメントへ移すだけでページは動かない。
 * @param {Parameters<typeof pickFocusTarget>[0]} options pickFocusTarget と同じ
 * @returns {any|null} フォーカスを移した要素。移さなかったときは null
 */
export function restoreFocusAfterHide(options) {
  const target = pickFocusTarget(options);
  target?.focus();
  return target;
}
