/**
 * @file 本スクリプトの CSS。
 */

import { PREVIEW_CHARS, REVEAL_DELAY_MS, REVEAL_MS_PER_LINE } from './config.js';
import {
  BAR_ID,
  BLOCK_BUTTON_CLASS,
  COMMENT_CONTAINER_ID,
  EXPANDED_ATTR,
  EXPANDER_CONTENT_ID,
  EXPANDER_SELECTOR,
  LESS_BUTTON_SELECTOR,
  MORE_BUTTON_SELECTOR,
  OPEN_ATTR,
  REASON_ATTR,
  REPLIES_ID,
  SHORTS_ATTR,
  SHORTS_COMMENTS_SELECTOR,
  STATE_ATTR,
  THREAD_TAG,
  VIEW_MODEL_TAG,
  WATCH_ATTR,
  WATCH_COMMENTS_SELECTOR,
  COMMENTS_SELECTOR,
} from './selectors.js';

/** ホバーで見せる行数 */
const HOVER_LINES = 4;

/** 表示するコメントの本文の行の高さ（rem）。ホバーで行ごとに見せるマスクの帯の高さと揃えるため、明示する */
const LINE_HEIGHT_REM = 2;

/**
 * 件数バーの色。YouTube の色変数を参照し、変数が無いときはライト・ダークそれぞれの既定値に落とす。
 * YouTube は色変数の名前を --yt-spec-* から --yt-sys-color-baseline--* へ変えており、旧名は未定義になる。
 * 名前がまた変わってもダークモードで黒文字にならないよう、最後の既定値はテーマごとに持つ。
 * @type {Record<string, { vars: string[], light: string, dark: string }>}
 */
const BAR_COLORS = {
  text: { vars: ['--yt-sys-color-baseline--text-primary', '--yt-spec-text-primary'], light: '#0f0f0f', dark: '#f1f1f1' },
  subtext: { vars: ['--yt-sys-color-baseline--text-secondary', '--yt-spec-text-secondary'], light: '#606060', dark: '#aaa' },
  background: {
    vars: ['--yt-sys-color-baseline--tonal-background', '--yt-spec-badge-chip-background'],
    light: 'rgba(0, 0, 0, 0.05)',
    dark: 'rgba(255, 255, 255, 0.1)',
  },
  buttonHover: {
    vars: ['--yt-sys-color-baseline--mono-tonal-hover', '--yt-spec-mono-tonal-hover'],
    light: 'rgba(0, 0, 0, 0.1)',
    dark: 'rgba(255, 255, 255, 0.2)',
  },
};

/**
 * 色変数を順に参照し、どれも無ければ既定値を使う var() を作る。
 * @param {keyof typeof BAR_COLORS} name 色の名前
 * @param {'light' | 'dark'} theme 既定値のテーマ
 * @returns {string}
 */
function barColor(name, theme) {
  const { vars, [theme]: fallback } = BAR_COLORS[name];
  return vars.reduceRight((inner, v) => `var(${v}, ${inner})`, fallback);
}

/**
 * ダークモードの件数バーの色の規則。YouTube は html の dark 属性でダークモードを示す。
 * @returns {string}
 */
function darkBarColorRules() {
  return `html[dark] #${BAR_ID} {
  background: ${barColor('background', 'dark')};
  color: ${barColor('text', 'dark')};
}
html[dark] #${BAR_ID} button {
  background: ${barColor('background', 'dark')};
  color: ${barColor('text', 'dark')};
}
html[dark] #${BAR_ID} button:hover {
  background: ${barColor('buttonHover', 'dark')};
}
html[dark] #${BAR_ID} .ycf-status {
  color: ${barColor('subtext', 'dark')};
}`;
}

/**
 * 対象のコメント欄を指すセレクタの組み立て方。html 要素への条件（開閉）を足せる形で返す。
 * - WATCH_ATTR: 動画ページかを JS が html の属性で宣言する。確認済みのセレクタ（COMMENTS_SELECTOR）だけに依存する
 * - WATCH_COMMENTS_SELECTOR: 未確認の ytd-watch-flexy に依存する。属性が付く前の保険として併記する
 * - SHORTS_ATTR / SHORTS_COMMENTS_SELECTOR: Shorts のコメント欄（id の無い ytd-comments）。動画ページと同じく、
 *   属性で宣言したものと、属性が付く前の保険の 2 つを並べる
 * どちらかが外れても、もう一方で閉じる・隠す規則が当たるようにする（fail-closed）。
 * @type {((htmlCondition: string) => string)[]}
 */
const COMMENTS_SCOPES = [
  // 同じ規則の中のセレクタの順序は適用結果に影響しない。既存のテストが規則の最後のセレクタを
  // 動画ページの範囲として読むので、Shorts の範囲を先に置く
  (htmlCondition) => `html[${SHORTS_ATTR}]${htmlCondition} ${SHORTS_COMMENTS_SELECTOR}`,
  (htmlCondition) => (htmlCondition ? `html${htmlCondition} ${SHORTS_COMMENTS_SELECTOR}` : SHORTS_COMMENTS_SELECTOR),
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
 * - 対象は動画ページと Shorts のコメント欄の中だけにする。ほかのページのコメントを判定前のまま隠さないため
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
  // NG 登録のボタンは、判定から外したもの以外の表示中のコメントにホバーしたとき、またはコメント内に
  // キーボードのフォーカスがあるときだけ見せる。display:none の要素にはタブで移動できないため、コメント内の要素
  // （ボタンの前にある投稿者名のリンクなど）にフォーカスが来た時点で見せ、そこからタブでボタンへ進めるようにする。
  // :focus-within だとマウスのクリックで残ったフォーカスにも当たり、クリック後にボタンが出たままになるので、
  // :has(:focus-visible) を使う。ボタン自身へタブで移ったときも :focus-visible なので、移った後も消えない。
  // 直下結合子で書き、返信にホバー・フォーカスしたときに親のボタンが出ないようにする
  const blockButtonOf = (thread, pseudo) =>
    `${thread}[${STATE_ATTR}="shown"]:not([${REASON_ATTR}="exempt"]) > #${COMMENT_CONTAINER_ID} ${VIEW_MODEL_TAG}${pseudo} .${BLOCK_BUTTON_CLASS}`;
  const blockButtonHover = forEachScope((thread) => [blockButtonOf(thread, ':hover')]);
  // :has() を解釈しないブラウザでは、:has() を含むセレクタリストの規則全体が捨てられる。
  // ホバーの規則を巻き込まないよう別の規則にする。:is(:hover, :has(...)) にまとめる形は、:is() の中の
  // 無効なセレクタを読み飛ばすかどうかがブラウザの実装時期で揺れたため採らない
  const blockButtonFocus = forEachScope((thread) => [blockButtonOf(thread, ':has(:focus-visible)')]);

  const contentOf = (container) => `${container} ${EXPANDER_SELECTOR} > #${EXPANDER_CONTENT_ID}`;
  const hoverOf = (container) => `${container} ${VIEW_MODEL_TAG}:hover ${EXPANDER_SELECTOR} > #${EXPANDER_CONTENT_ID}`;
  const shownContent = forEachScope((thread) => [contentOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`)]);
  const hoverContent = forEachScope((thread) => [hoverOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`)]);
  // 全文固定の間にホバーしても 4 行に戻らないよう、ホバーの規則より詳細度の高いセレクタも並べる
  const expandedContent = forEachScope((thread) => {
    const container = `${thread}[${STATE_ATTR}="shown"][${EXPANDED_ATTR}] > #${COMMENT_CONTAINER_ID}`;
    return [contentOf(container), hoverOf(container)];
  });
  // ホバーで見せる行のマスク。--ycf-reveal が 0 から HOVER_LINES まで増えるにつれ、i 行目は i から i+1 の間で
  // 左から右へ見えていく（読む順）。1 行目は既定の表示で見えている文頭の幅から始める
  const revealMasks = Array.from({ length: HOVER_LINES }, (_, line) => {
    const progress = `clamp(0, var(--ycf-reveal) - ${line}, 1) * 100%`;
    const stop = line === 0 ? `max(${PREVIEW_CHARS}em, calc(${progress}))` : `calc(${progress})`;
    return `linear-gradient(to right, #000 ${stop}, transparent ${stop})`;
  }).join(', ');
  const revealPositions = Array.from({ length: HOVER_LINES }, (_, line) => (line === 0 ? '0 0' : `0 ${line * LINE_HEIGHT_REM}rem`)).join(', ');
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

/* ホバーで見せる量。数値として登録し、transition で増やせるようにする */
@property --ycf-reveal {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

/* 表示: 段階表示（既定は文頭の PREVIEW_CHARS 文字ほど、ホバーで 4 行、クリックで全文）。
   1 行に収まる短いコメントでも全文が見えないよう、既定では行数に加えて幅も制限する。
   見せる量の transition はホバーの規則にだけ書く（マウスを外したら待たずに文頭だけに戻すため） */
${shownContent} {
  display: -webkit-box !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  max-height: none !important;
  max-width: ${PREVIEW_CHARS}em !important;
  line-height: ${LINE_HEIGHT_REM}rem !important;
  -webkit-line-clamp: 1 !important;
  cursor: pointer;
}
/* ホバー: 待ち時間の後、1 行ずつ左から右へ見せる。行の高さをマスクの帯の高さと揃える */
${hoverContent} {
  max-width: none !important;
  -webkit-line-clamp: ${HOVER_LINES} !important;
  line-height: ${LINE_HEIGHT_REM}rem !important;
  --ycf-reveal: ${HOVER_LINES};
  transition: --ycf-reveal ${HOVER_LINES * REVEAL_MS_PER_LINE}ms linear ${REVEAL_DELAY_MS}ms;
  -webkit-mask-image: ${revealMasks};
  mask-image: ${revealMasks};
  -webkit-mask-size: 100% ${LINE_HEIGHT_REM}rem;
  mask-size: 100% ${LINE_HEIGHT_REM}rem;
  -webkit-mask-position: ${revealPositions};
  mask-position: ${revealPositions};
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
${expandedContent} {
  display: block !important;
  overflow: visible !important;
  max-width: none !important;
  -webkit-line-clamp: unset !important;
  -webkit-mask-image: none;
  mask-image: none;
}
${shownButtons} {
  display: none !important;
}

/* NG 登録のボタン */
.${BLOCK_BUTTON_CLASS} {
  display: none !important;
  margin-left: 8px;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: ${barColor('subtext', 'light')};
  font-family: "Roboto", "Arial", sans-serif;
  font-size: 1.1rem;
  line-height: 1.8rem;
  cursor: pointer;
}
html[dark] .${BLOCK_BUTTON_CLASS} {
  color: ${barColor('subtext', 'dark')};
}
${blockButtonHover} {
  display: inline-block !important;
}
${blockButtonFocus} {
  display: inline-block !important;
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
  background: ${barColor('background', 'light')};
  color: ${barColor('text', 'light')};
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
  background: ${barColor('background', 'light')};
  color: ${barColor('text', 'light')};
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
#${BAR_ID} button:hover {
  background: ${barColor('buttonHover', 'light')};
}
#${BAR_ID} .ycf-status {
  color: ${barColor('subtext', 'light')};
}
/* ダークモード: 色変数が無いときの既定値だけを差し替える */
${darkBarColorRules()}
`;
}
