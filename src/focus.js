/**
 * @file NG 登録で thread が隠れた後に、フォーカスを移す先を決める。
 *
 * NG 登録のボタンは thread の中にあり、登録した後のスキャンで thread ごと display:none になる。
 * そのままだとフォーカスが body に落ち、キーボードで操作している人は次の Tab がどこから始まるか分からなくなるので、
 * 近くの表示中のコメントへ移す。
 * main.js から DOM の読み書きを切り離し、偽の要素でテストできるようにするためにこのファイルに置く。
 */


import { findOwnViewModel, isInsideHiddenThread } from './dom.js';
import { AUTHOR_LINK_SELECTOR, OWNER_BADGE_LINK_SELECTOR, STATE_ATTR } from './selectors.js';

/**
 * コメントの中でフォーカスを移す要素の代わりの候補。投稿者の名前のリンクが無いか、移せなかったときに使う。
 * NG 登録のボタン（button）もフォーカスできるが、フォーカスが来るまで透明なので（styles.js）、
 * 移した時点で見えている名前のリンクを優先し、代わりの候補も a に限る
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
 * 要素か、root までの祖先に hidden 属性があるか。
 * 所有者・認証済みのチャンネルのコメントでは a#author-text に hidden が付き、focus() を呼んでも移らない（docs/dom-structure.md）
 * @param {any} el 調べる要素
 * @param {any} root コメント本体。ここより上は調べない
 * @returns {boolean}
 */
function isHiddenWithin(el, root) {
  for (let node = el; node && node !== root; node = node.parentElement ?? null) {
    if (node.hidden === true || node.hasAttribute?.('hidden')) return true;
  }
  return false;
}

/**
 * thread の中でフォーカスを移す要素の候補を、試す順に返す。
 * 投稿者のリンク（AUTHOR_LINK_SELECTOR）、所有者・認証済みのバッジの名前のリンク（OWNER_BADGE_LINK_SELECTOR）、
 * 本体の中のリンク（FALLBACK_LINK_SELECTOR。文書順）の順で、重複と hidden の付いたものを除く。
 * 入れ子の返信の要素を選ばないよう、thread の直下のコメント本体（findOwnViewModel）の中だけを探す。
 * @param {any} thread ytd-comment-thread-renderer
 * @returns {any[]}
 */
function focusablesIn(thread) {
  const viewModel = findOwnViewModel(thread);
  if (!viewModel) return [];
  const found = [
    viewModel.querySelector?.(AUTHOR_LINK_SELECTOR),
    viewModel.querySelector?.(OWNER_BADGE_LINK_SELECTOR),
    ...Array.from(viewModel.querySelectorAll?.(FALLBACK_LINK_SELECTOR) ?? []),
  ];
  return [...new Set(found)].filter((el) => typeof el?.focus === 'function' && !isHiddenWithin(el, viewModel));
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
 * @typedef {object} FocusCandidate
 * @property {any} element フォーカスを移す要素
 * @property {boolean} preventScroll focus() に渡す preventScroll
 */

/**
 * NG 登録のボタンが押された thread が隠れたときの、フォーカスの移し先の候補を試す順に返す。
 *
 * - thread がまだ表示中（ルールに当たらなかったなど）なら候補は無い
 * - フォーカスが thread の外の要素にあるなら候補は無い（利用者が移した先を奪わない）
 * - 順は threads（文書順。返信も含む）で thread より後ろの表示中のコメント（近い順）、
 *   thread より前の表示中のコメント（近い順）、fallback（件数バーのボタン）。各コメントの中は focusablesIn の順
 * - 同じスキャンで隠れた同じ投稿者のコメントや、隠した thread の中の返信は表示中ではないので飛ばす
 * - thread が DOM から外れて threads に無いときは、前後が分からないので fallback だけにする
 *   （件数バーはコメント欄の直前にあるので、次の Tab で先頭のコメントへ進める）
 * - 前のコメントと fallback は preventScroll にする。画面の上の外にあることが多く、移すたびにページが上へ戻ると、
 *   マウスで押した人の読んでいる位置が変わるため。後ろのコメントは隠れたコメントのすぐ下にあり、
 *   画面の外にあるときはキーボードで操作している人に見せるため、既定のスクロールのままにする
 * @param {Parameters<typeof pickFocusTarget>[0]} options pickFocusTarget と同じ
 * @returns {Generator<FocusCandidate>}
 */
function* focusCandidates({ threads, thread, activeElement, doc, fallback = null }) {
  if (!thread) return;
  if (thread.isConnected !== false && !isHiddenThread(thread)) return;
  if (!isFocusLost(thread, activeElement, doc)) return;
  const index = threads.indexOf(thread);
  if (index !== -1) {
    for (const [ordered, preventScroll] of [
      [threads.slice(index + 1), false],
      [threads.slice(0, index).reverse(), true],
    ]) {
      for (const candidate of ordered) {
        if (!isVisibleThread(candidate)) continue;
        for (const element of focusablesIn(candidate)) yield { element, preventScroll };
      }
    }
  }
  if (typeof fallback?.focus === 'function') yield { element: fallback, preventScroll: true };
}

/**
 * NG 登録のボタンが押された thread が隠れたときに、フォーカスを最初に試す移し先を返す（focusCandidates の先頭）。
 * 実際に移せるかは focus() を呼ぶまで分からないので、移すときは restoreFocusAfterHide を使う。
 * @param {object} options
 * @param {any[]} options.threads コメント欄の thread（文書順）
 * @param {any} options.thread NG 登録のボタンが押された thread
 * @param {any} options.activeElement document.activeElement
 * @param {any} options.doc document（body との比較と、移せたかの確認に使う）
 * @param {any} [options.fallback] 表示中のコメントへ移せないときの移し先
 * @returns {any|null} フォーカスを移す要素。移さないときは null
 */
export function pickFocusTarget(options) {
  return focusCandidates(options).next().value?.element ?? null;
}

/**
 * focusCandidates の順にフォーカスを移す。
 * focus() の後に doc.activeElement がその要素になったかを確かめ、なっていなければ次の候補を試す。
 * hidden 属性は focusablesIn で除くが、描画されていない要素などはここで飛ばす。
 * スクロールは候補ごとに focusCandidates が決めた preventScroll に従う。
 * @param {Parameters<typeof pickFocusTarget>[0]} options pickFocusTarget と同じ
 * @returns {any|null} フォーカスを移した要素。どこにも移せなかったときと、移さないときは null
 */
export function restoreFocusAfterHide(options) {
  for (const { element, preventScroll } of focusCandidates(options)) {
    element.focus({ preventScroll });
    if (options.doc?.activeElement === element) return element;
  }
  return null;
}
