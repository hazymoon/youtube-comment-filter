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
  REASON_STRIP_CLASS,
  REASONS_ATTR,
  REPLIES_ID,
  REVEALED_ATTR,
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
  text: {
    vars: ['--yt-sys-color-baseline--text-primary', '--yt-spec-text-primary'],
    light: '#0f0f0f',
    dark: '#f1f1f1',
  },
  subtext: {
    vars: ['--yt-sys-color-baseline--text-secondary', '--yt-spec-text-secondary'],
    light: '#606060',
    dark: '#aaa',
  },
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
  return COMMENTS_SCOPES.flatMap((scope) =>
    build(`${scope('')} ${THREAD_TAG}`, (cond) => `${scope(cond)} ${THREAD_TAG}`),
  ).join(',\n');
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
 * @param {object} [options] 見せ方の設定。省いた項目は config.js の既定値を使う
 * @param {number} [options.previewChars] 既定で見せる文頭の文字数（「値」の previewChars）
 * @param {number} [options.revealDelayMs] 続きを見せ始めるまでの待ち時間（ミリ秒、「値」の revealDelayMs）
 * @param {number} [options.revealMsPerLine] 続きを 1 行ぶん見せる時間（ミリ秒、「値」の revealMsPerLine）
 * @returns {string}
 */
export function buildStyles({
  previewChars = PREVIEW_CHARS,
  revealDelayMs = REVEAL_DELAY_MS,
  revealMsPerLine = REVEAL_MS_PER_LINE,
} = {}) {
  const close = COMMENTS_SCOPES.map((scope) => scope(`:not([${OPEN_ATTR}])`)).join(',\n');
  const unjudgedStates = [`:not([${STATE_ATTR}])`, `[${STATE_ATTR}="pending"]`];
  const unjudgedThread = forEachScope((thread) => unjudgedStates.map((st) => `${thread}${st}`));
  const unjudgedContainer = forEachScope((thread) =>
    unjudgedStates.map((st) => `${thread}${st} > #${COMMENT_CONTAINER_ID}`),
  );
  const unjudgedReplies = forEachScope((thread) => unjudgedStates.map((st) => `${thread}${st} > #${REPLIES_ID}`));
  const unjudgedBand = forEachScope((thread) =>
    unjudgedStates.map((st) => `${thread}${st} > #${COMMENT_CONTAINER_ID}::before`),
  );
  const openBand = forEachScope((_thread, withHtml) =>
    unjudgedStates.map((st) => `${withHtml(`[${OPEN_ATTR}]`)}${st} > #${COMMENT_CONTAINER_ID}::before`),
  );
  const waitingBand = forEachScope((thread) =>
    ['unreadable', 'ai-unresolved'].map(
      (reason) => `${thread}[${STATE_ATTR}="pending"][${REASON_ATTR}="${reason}"] > #${COMMENT_CONTAINER_ID}::before`,
    ),
  );
  const hiddenThread = forEachScope((thread) => [`${thread}[${STATE_ATTR}="hidden"]`]);
  // 理由の表示中（html の REASONS_ATTR）だけ、隠した thread を出して中身を隠し、先頭の帯（ui.js の ensureReasonStrip）を見せる。
  // 基底の display:none は残して後ろで上書きする（html の条件の分だけ詳細度が高い）。帯が押されたら（REVEALED_ATTR）
  // 親コメントを隠す規則だけを外し、返信は隠したままにする。親を見せる規則で display の値を決めず、YouTube の既定の表示に任せる
  const reasonThreadOf = (withHtml) => `${withHtml(`[${REASONS_ATTR}]`)}[${STATE_ATTR}="hidden"]`;
  const reasonThread = forEachScope((_thread, withHtml) => [reasonThreadOf(withHtml)]);
  const reasonHiddenChildren = forEachScope((_thread, withHtml) => [
    `${reasonThreadOf(withHtml)}:not([${REVEALED_ATTR}]) > #${COMMENT_CONTAINER_ID}`,
    `${reasonThreadOf(withHtml)} > #${REPLIES_ID}`,
  ]);
  const reasonStrip = forEachScope((_thread, withHtml) => [`${reasonThreadOf(withHtml)} > .${REASON_STRIP_CLASS}`]);
  // NG 登録のボタンは、判定から外したもの以外の表示中のコメントにホバーしたとき、またはコメント内に
  // キーボードのフォーカスがあるときだけ見せる。:focus-within だとマウスのクリックで残ったフォーカスにも当たり、
  // クリック後にボタンが出たままになるので、:has(:focus-visible) を使う。
  // 見せないときも display:none にはせず、透明にしてマウスで押せなくするだけにする。Chrome はフォーカスを移すとき
  // 先に元の要素（ボタンの前にある投稿時刻のリンクなど）からフォーカスを外すので、その瞬間に :has(:focus-visible) が
  // 外れる。ボタンが display:none に戻るとフォーカスできない要素になり、タブでの移動が取りやめになる。
  // ボタン自身の :focus-visible でも見せ、フォーカスが移った瞬間から見えるようにする。
  // 直下結合子で書き、返信にホバー・フォーカスしたときに親のボタンが出ないようにする
  const blockButtonOf = (thread, pseudo) =>
    `${thread}[${STATE_ATTR}="shown"]:not([${REASON_ATTR}="exempt"]) > #${COMMENT_CONTAINER_ID} ${VIEW_MODEL_TAG}${pseudo} .${BLOCK_BUTTON_CLASS}`;
  const blockButtonHover = forEachScope((thread) => [blockButtonOf(thread, ':hover')]);
  const blockButtonSelfFocus = forEachScope((thread) => [`${blockButtonOf(thread, '')}:focus-visible`]);
  // 既定の規則がボタンをタブの順序に残すので、押せないコメントのボタンは display:none にしてタブでも移れないようにする。
  // :has() を解釈しないブラウザでも当たるよう、:has() を使わずに書く
  const blockButtonUnusable = forEachScope((thread) =>
    [`[${STATE_ATTR}="shown"][${REASON_ATTR}="exempt"]`, `:not([${STATE_ATTR}="shown"])`].map(
      (cond) => `${thread}${cond} > #${COMMENT_CONTAINER_ID} .${BLOCK_BUTTON_CLASS}`,
    ),
  );
  // :has() を解釈しないブラウザでは、:has() を含むセレクタリストの規則全体が捨てられる。
  // ホバーの規則を巻き込まないよう別の規則にする。:is(:hover, :has(...)) にまとめる形は、:is() の中の
  // 無効なセレクタを読み飛ばすかどうかがブラウザの実装時期で揺れたため採らない
  const blockButtonFocus = forEachScope((thread) => [blockButtonOf(thread, ':has(:focus-visible)')]);

  const contentOf = (container) => `${container} ${EXPANDER_SELECTOR} > #${EXPANDER_CONTENT_ID}`;
  const hoverOf = (container) => `${container} ${VIEW_MODEL_TAG}:hover ${EXPANDER_SELECTOR} > #${EXPANDER_CONTENT_ID}`;
  const shownContent = forEachScope((thread) => [
    contentOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`),
  ]);
  const hoverContent = forEachScope((thread) => [
    hoverOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`),
  ]);
  // キーボードで本文の枠（main.js の decorateThread が Tab で止まれるようにする）にフォーカスがあるときも、
  // ホバーと同じ量を見せる。本文の枠自体がフォーカスを持つので :has() は要らない。:hover とは別の規則にし、
  // どちらかのセレクタを解釈できないブラウザでも、もう一方の規則が捨てられないようにする
  const focusOf = (container) => `${contentOf(container)}:focus-visible`;
  const focusContent = forEachScope((thread) => [
    focusOf(`${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID}`),
  ]);
  // 本文の枠はマスクと clip-path で自身の輪郭（outline）も切れるので、フォーカスの位置は親の ytd-expander の輪郭で示す。
  // :has() を解釈しないブラウザで、ほかの規則を巻き込んで捨てられないよう別の規則にする
  const focusRing = forEachScope((thread) => [
    `${thread}[${STATE_ATTR}="shown"] > #${COMMENT_CONTAINER_ID} ${EXPANDER_SELECTOR}:has(> #${EXPANDER_CONTENT_ID}:focus-visible)`,
  ]);
  // 全文固定の間にホバー・フォーカスしても 4 行に戻らないよう、それらの規則より詳細度の高いセレクタも並べる。
  // フォーカスのセレクタは別の規則にし、:focus-visible を解釈できないブラウザで全文固定の規則ごと捨てられないようにする
  const expandedContainer = (thread) => `${thread}[${STATE_ATTR}="shown"][${EXPANDED_ATTR}] > #${COMMENT_CONTAINER_ID}`;
  const expandedContent = forEachScope((thread) => [
    contentOf(expandedContainer(thread)),
    hoverOf(expandedContainer(thread)),
  ]);
  const expandedFocusContent = forEachScope((thread) => [focusOf(expandedContainer(thread))]);
  // 行ごとに見せるマスク。既定の表示とホバーの両方に掛ける。--ycf-reveal が 0 から HOVER_LINES まで増えるにつれ、
  // i 行目は i から i+1 の間で左から右へ見えていく（読む順）。1 行目は文頭の previewChars 文字ほどの幅から始めるので、
  // 見せる量が 0 の既定の表示では文頭だけが見え、2 行目以降は隠れる。
  // @property が効かないブラウザでは --ycf-reveal が未定義になり、mask-image ごと無効になって全文が見えてしまう。
  // 既定値 0 を持たせ、そのときも既定の表示は文頭だけに留める
  const revealMasks = Array.from({ length: HOVER_LINES }, (_, line) => {
    const progress = `clamp(0, var(--ycf-reveal, 0) - ${line}, 1) * 100%`;
    const stop = line === 0 ? `max(${previewChars}em, calc(${progress}))` : `calc(${progress})`;
    return `linear-gradient(to right, #000 ${stop}, transparent ${stop})`;
  }).join(', ');
  const revealPositions = Array.from({ length: HOVER_LINES }, (_, line) =>
    line === 0 ? '0 0' : `0 ${line * LINE_HEIGHT_REM}rem`,
  ).join(', ');
  // マスクは見た目だけを隠し、透明な部分にあるリンクもクリック・ホバーに反応する。clip-path は描画と
  // クリックの対象を両方切り、レイアウトには影響しないので、確保した高さを保ったまま見せた範囲だけを対象にする。
  // 既定の表示は 1 行目の文頭だけを切り出す。見せる量の変数や min()/max() に頼らない単純な式にして、
  // マスクの式を解釈できないブラウザで mask-image が無効になっても、文頭より先が見えないようにする（fail-closed）
  const previewClip = `inset(0 calc(100% - ${previewChars}em) calc(100% - ${LINE_HEIGHT_REM}rem) 0)`;
  // ホバーでは見せる量に連動させる。下端は見せる量に 1 行を足した高さで、見せている途中の行と 1 行目を含む。
  // 右端は 1 行目を見せ終えるまで、見せた幅（文頭の previewChars 文字ほど以上）に合わせる
  const revealClip =
    `inset(0 max(0px, min(100% - ${previewChars}em, (1 - var(--ycf-reveal, 0)) * 100%)) ` +
    `calc(100% - (var(--ycf-reveal, 0) + 1) * ${LINE_HEIGHT_REM}rem) 0)`;
  // ホバーとキーボードのフォーカスで見せるときの宣言。両方の規則で同じ量を見せるため、1 か所で組み立てる
  const revealDeclarations = `  max-width: none !important;
  -webkit-line-clamp: ${HOVER_LINES} !important;
  line-height: ${LINE_HEIGHT_REM}rem !important;
  --ycf-reveal: ${HOVER_LINES};
  transition: --ycf-reveal ${HOVER_LINES * revealMsPerLine}ms linear ${revealDelayMs}ms;
  -webkit-mask-image: ${revealMasks};
  mask-image: ${revealMasks};
  -webkit-mask-size: 100% ${LINE_HEIGHT_REM}rem;
  mask-size: 100% ${LINE_HEIGHT_REM}rem;
  -webkit-mask-position: ${revealPositions};
  mask-position: ${revealPositions};
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  clip-path: ${revealClip};`;
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

/* 理由の帯。既定では見せず、理由の表示中の隠した thread でだけ見せる */
.${REASON_STRIP_CLASS} {
  display: none !important;
}
/* 理由の表示中: 隠した thread を出し、親コメントと返信を隠して帯だけを見せる */
${reasonThread} {
  display: block !important;
}
${reasonHiddenChildren} {
  display: none !important;
}
${reasonStrip} {
  display: block !important;
  box-sizing: border-box;
  width: 100%;
  min-height: 2.4rem;
  margin: 0;
  padding: 0 0 0 56px;
  border: none;
  background: transparent;
  color: ${barColor('subtext', 'light')};
  font-family: "Roboto", "Arial", sans-serif;
  font-size: 1.2rem;
  line-height: 2.4rem;
  text-align: left;
  cursor: pointer;
}
html[dark] .${REASON_STRIP_CLASS} {
  color: ${barColor('subtext', 'dark')};
}
.${REASON_STRIP_CLASS}:hover {
  text-decoration: underline;
}
.${REASON_STRIP_CLASS}[aria-expanded="true"] {
  font-weight: 500;
}

/* ホバーで見せる量。数値として登録し、transition で増やせるようにする */
@property --ycf-reveal {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

/* 表示: 段階表示（既定は文頭の previewChars 文字ほど、ホバーで HOVER_LINES 行、クリックで全文）。
   ホバーで本文の高さが伸縮してレイアウトが動かないよう、既定でもホバーと同じ -webkit-line-clamp（HOVER_LINES）と
   幅で本文を組み、見せる量は行ごとのマスクだけで変える。line-clamp は行数の上限なので、高さは本文の行数
   （HOVER_LINES 行まで）で決まり、ホバーの前後で変わらない。1 行に収まる短いコメントでも全文が見えないよう、
   既定では 1 行目のマスクで文頭の previewChars 文字ほどの幅だけを見せ、2 行目以降を隠す。
   マスクはクリックの対象を減らさないので、clip-path で描画とクリックの対象も見せた範囲に絞る。
   行の高さはマスクの帯の高さと揃える。
   キーボードで本文の枠にフォーカスしたときもホバーと同じ量を見せ、Enter・Space で全文に切り替える（main.js）。
   見せる量の transition はホバー・フォーカスの規則にだけ書く（マウスやフォーカスが外れたら待たずに文頭だけに戻すため） */
${shownContent} {
  display: -webkit-box !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  max-height: none !important;
  max-width: none !important;
  line-height: ${LINE_HEIGHT_REM}rem !important;
  -webkit-line-clamp: ${HOVER_LINES} !important;
  cursor: pointer;
  -webkit-mask-image: ${revealMasks};
  mask-image: ${revealMasks};
  -webkit-mask-size: 100% ${LINE_HEIGHT_REM}rem;
  mask-size: 100% ${LINE_HEIGHT_REM}rem;
  -webkit-mask-position: ${revealPositions};
  mask-position: ${revealPositions};
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  clip-path: ${previewClip};
}
/* ホバー: 待ち時間の後、1 行ずつ左から右へ見せる。行数・幅・マスクは既定の表示と同じにし、見せる量だけを増やす。
   clip-path は見せる量に連動させ、まだ見せていない行をクリックの対象から外す */
${hoverContent} {
${revealDeclarations}
}
/* キーボードのフォーカス: ホバーと同じ量を同じ待ち時間で見せる */
${focusContent} {
${revealDeclarations}
}
/* フォーカスの位置を本文の枠の親の輪郭で示す */
${focusRing} {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  border-radius: 4px;
}
${expandedContent} {
  display: block !important;
  overflow: visible !important;
  max-width: none !important;
  -webkit-line-clamp: unset !important;
  -webkit-mask-image: none;
  mask-image: none;
  clip-path: none;
}
${expandedFocusContent} {
  display: block !important;
  overflow: visible !important;
  max-width: none !important;
  -webkit-line-clamp: unset !important;
  -webkit-mask-image: none;
  mask-image: none;
  clip-path: none;
}
${shownButtons} {
  display: none !important;
}

/* NG 登録のボタン。タブで移れるよう display:none にせず、透明にしてマウスで押せなくする */
.${BLOCK_BUTTON_CLASS} {
  display: inline-block !important;
  opacity: 0 !important;
  pointer-events: none !important;
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
  opacity: 1 !important;
  pointer-events: auto !important;
}
${blockButtonFocus} {
  display: inline-block !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
${blockButtonSelfFocus} {
  display: inline-block !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
/* 判定から外したコメント・表示中でないコメントのボタンはタブでも移れないようにする */
${blockButtonUnusable} {
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
#${BAR_ID} button[aria-pressed="true"] {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
#${BAR_ID} .ycf-status {
  color: ${barColor('subtext', 'light')};
}
/* ダークモード: 色変数が無いときの既定値だけを差し替える */
${darkBarColorRules()}
`;
}
