/**
 * @file 本スクリプトの CSS。
 */

import {
  BAR_ID,
  COMMENT_CONTAINER_ID,
  EXPANDED_ATTR,
  EXPANDER_CONTENT_ID,
  EXPANDER_SELECTOR,
  LESS_BUTTON_SELECTOR,
  MORE_BUTTON_SELECTOR,
  OPEN_ATTR,
  REASON_ATTR,
  REPLIES_ID,
  STATE_ATTR,
  THREAD_TAG,
  VIEW_MODEL_TAG,
  WATCH_ATTR,
  WATCH_COMMENTS_SELECTOR,
  COMMENTS_SELECTOR,
} from './selectors.js';

/**
 * 対象のコメント欄を指すセレクタの組み立て方。html 要素への条件（開閉）を足せる形で返す。
 * - WATCH_ATTR: 動画ページかを JS が html の属性で宣言する。確認済みのセレクタ（COMMENTS_SELECTOR）だけに依存する
 * - WATCH_COMMENTS_SELECTOR: 未確認の ytd-watch-flexy に依存する。属性が付く前の保険として併記する
 * どちらかが外れても、もう一方で閉じる・隠す規則が当たるようにする（fail-closed）。
 * @type {((htmlCondition: string) => string)[]}
 */
const COMMENTS_SCOPES = [
  (htmlCondition) => `html[${WATCH_ATTR}]${htmlCondition} ${COMMENTS_SELECTOR}`,
  (htmlCondition) => (htmlCondition ? `html${htmlCondition} ${WATCH_COMMENTS_SELECTOR}` : WATCH_COMMENTS_SELECTOR),
];

/**
 * すべてのコメント欄のセレクタについてセレクタを作り、カンマで並べる。
 * @param {(thread: string, htmlCondition: (cond: string) => string) => string[]} build 1 つのコメント欄のセレクタから作る
 * @returns {string}
 */
function forEachScope(build) {
  return COMMENTS_SCOPES.flatMap((scope) => build(`${scope('')} ${THREAD_TAG}`, (cond) => `${scope(cond)} ${THREAD_TAG}`)).join(
    ',\n',
  );
}

/**
 * CSS の文字列を返す。
 *
 * - 対象は動画ページのコメント欄の中だけにする。ほかのページのコメントを判定前のまま隠さないため
 * - thread から #comment-container / #replies へは直下結合子で書く。子孫結合子だと、入れ子の返信に親の状態が漏れる
 * - 状態の属性が無い thread は判定前として隠す（fail-closed）。スクリプトが属性を付けるまでの間も見せない
 * - 判定前・判定待ちは thread 自体も隠す。#comment-container の id が変わっても中身が見えないようにするため
 * - コメント欄を閉じるときは visibility を使う。display:none だと YouTube がコメントを読み込まない（docs/spike.md）
 * - 判定前・判定待ちのコメントは 1 行の帯にして高さを保つ。高さが 0 になると続きの読み込みが連続して走りうる
 *   （docs/review-findings.md）
 * @returns {string}
 */
export function buildStyles() {
  const close = COMMENTS_SCOPES.map((scope) => scope(`:not([${OPEN_ATTR}])`)).join(',\n');
  const unjudgedStates = [`:not([${STATE_ATTR}])`, `[${STATE_ATTR}="pending"]`];
  const unjudgedThread = forEachScope((thread) => unjudgedStates.map((st) => `${thread}${st}`));
  const unjudgedContainer = forEachScope((thread) => unjudgedStates.map((st) => `${thread}${st} > #${COMMENT_CONTAINER_ID}`));
  const unjudgedReplies = forEachScope((thread) => unjudgedStates.map((st) => `${thread}${st} > #${REPLIES_ID}`));
  const unjudgedBand = forEachScope((thread) => unjudgedStates.map((st) => `${thread}${st} > #${COMMENT_CONTAINER_ID}::before`));
  const openBand = forEachScope((_thread, withHtml) =>
    unjudgedStates.map((st) => `${withHtml(`[${OPEN_ATTR}]`)}${st} > #${COMMENT_CONTAINER_ID}::before`),
  );
  const waitingBand = forEachScope((thread) =>
    ['unreadable', 'ai-unresolved'].map(
      (reason) => `${thread}[${STATE_ATTR}="pending"][${REASON_ATTR}="${reason}"] > #${COMMENT_CONTAINER_ID}::before`,
    ),
  );
  const hiddenThread = forEachScope((thread) => [`${thread}[${STATE_ATTR}="hidden"]`]);

  const contentOf = (container) => `${container} ${EXPANDER_SELECTOR} > #${EXPANDER_CONTENT_ID}`;
  const hoverOf = (container) => `${container} ${VIEW_MODEL_TAG}:hover ${EXPANDER_SELECTOR} > #${EXPANDER_CONTENT_ID}`;
  const shownContent = forEachScope((thread) => [contentOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`)]);
  const hoverContent = forEachScope((thread) => [hoverOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`)]);
  // 全文固定の間にホバーしても 4 行に戻らないよう、ホバーの規則より詳細度の高いセレクタも並べる
  const expandedContent = forEachScope((thread) => {
    const container = `${thread}[${STATE_ATTR}="shown"][${EXPANDED_ATTR}] > #${COMMENT_CONTAINER_ID}`;
    return [contentOf(container), hoverOf(container)];
  });
  const shownButtons = forEachScope((thread) =>
    [MORE_BUTTON_SELECTOR, LESS_BUTTON_SELECTOR].map(
      (button) => `${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID} ${EXPANDER_SELECTOR} > ${button}`,
    ),
  );

  return `
/* コメント欄を閉じる */
${close} {
  visibility: hidden !important;
}

/* 判定前・判定待ち: thread 自体を 1 行の高さに切り詰めて隠す */
${unjudgedThread} {
  position: relative !important;
  visibility: hidden !important;
  max-height: 2.4rem !important;
  overflow: hidden !important;
}
/* 判定前・判定待ち: 中身を見せず 1 行の帯にする */
${unjudgedContainer} {
  position: relative !important;
  visibility: hidden !important;
  height: 2.4rem !important;
  max-height: 2.4rem !important;
  overflow: hidden !important;
}
${unjudgedBand} {
  content: "判定中…";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding-left: 56px;
  font-size: 1.2rem;
  color: var(--yt-spec-text-secondary, #606060);
}
${waitingBand} {
  content: "判定待ち";
}
/* 帯は欄を開いているときだけ見せる。閉じた欄の visibility:hidden を子孫の visible が打ち消して帯だけ浮き出るため */
${openBand} {
  visibility: visible;
}
/* 親が決まるまで返信も見せない */
${unjudgedReplies} {
  display: none !important;
}

/* 非表示: 返信ごと消す */
${hiddenThread} {
  display: none !important;
}

/* 表示: 段階表示（既定 1 行、ホバーで 4 行、クリックで全文） */
${shownContent} {
  display: -webkit-box !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  max-height: none !important;
  -webkit-line-clamp: 1 !important;
  cursor: pointer;
}
${hoverContent} {
  -webkit-line-clamp: 4 !important;
}
${expandedContent} {
  display: block !important;
  overflow: visible !important;
  -webkit-line-clamp: unset !important;
}
${shownButtons} {
  display: none !important;
}

/* 件数バー */
#${BAR_ID} {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin: 24px 0 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
  color: var(--yt-spec-text-primary, #0f0f0f);
  font-family: "Roboto", "Arial", sans-serif;
  font-size: 1.4rem;
  line-height: 2rem;
}
#${BAR_ID}[hidden] {
  display: none !important;
}
#${BAR_ID} button {
  padding: 6px 16px;
  border: none;
  border-radius: 18px;
  background: var(--yt-spec-additive-background, rgba(0, 0, 0, 0.05));
  color: var(--yt-spec-text-primary, #0f0f0f);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
#${BAR_ID} button:hover {
  background: var(--yt-spec-mono-tonal-hover, rgba(0, 0, 0, 0.1));
}
#${BAR_ID} .ycf-status {
  color: var(--yt-spec-text-secondary, #606060);
}
`;
}
