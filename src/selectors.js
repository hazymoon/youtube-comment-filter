/**
 * @file YouTube の DOM のセレクタ・タグ名と、本スクリプトが付ける属性名の定数。
 *
 * YouTube の変更で壊れうるので、DOM に依存する文字列はここに集める。
 * 各定数のコメントに根拠を書く。「確認済み」は docs/dom-structure.md に記録した実測と一致するもの、
 * 「未確認（工程 3 で確認）」は実測の記録が無く、YouTube の一般的な構造から置いたもの。
 */

/** 動画ページの本体。未確認（工程 3 で確認）: docs/dom-structure.md は ytd-comments の外側を記録していない */
export const WATCH_FLEXY_TAG = 'ytd-watch-flexy';

/** コメント欄の外枠。確認済み（docs/dom-structure.md「コメント欄の外枠」） */
export const COMMENTS_SELECTOR = 'ytd-comments#comments';

/** 対象にするコメント欄（動画ページのものだけ）。WATCH_FLEXY_TAG が未確認なのでこの組み合わせも未確認 */
export const WATCH_COMMENTS_SELECTOR = `${WATCH_FLEXY_TAG} ${COMMENTS_SELECTOR}`;

/**
 * Shorts のページの本体。確認済み（docs/dom-structure.md「Shorts のコメント欄」）。
 * 動画ページの ytd-watch-flexy と同時に DOM に残るので、どちらのコメント欄を対象にするかはページの種類で決める
 */
export const SHORTS_TAG = 'ytd-shorts';

/**
 * Shorts のコメント欄。engagement panel の中の ytd-comments で、id が無い。
 * 確認済み（docs/dom-structure.md「Shorts のコメント欄」）
 */
export const SHORTS_COMMENTS_SELECTOR = `${SHORTS_TAG} ytd-comments`;

/** 1 コメント（返信を含む）。確認済み（docs/dom-structure.md「1 コメント = 1 ytd-comment-thread-renderer」） */
export const THREAD_TAG = 'ytd-comment-thread-renderer';

/** 返信の入れ物。祖先にあれば返信。確認済み（同上） */
export const REPLIES_RENDERER_TAG = 'ytd-comment-replies-renderer';

/** thread の直下の本体の入れ物の id。確認済み（同上） */
export const COMMENT_CONTAINER_ID = 'comment-container';

/** thread の直下の返信の入れ物の id。確認済み（同上） */
export const REPLIES_ID = 'replies';

/** コメント本体。#comment-container の直下。確認済み（同上） */
export const VIEW_MODEL_TAG = 'ytd-comment-view-model';

/** コメント本体の id。確認済み（同上） */
export const VIEW_MODEL_ID = 'comment';

/** 投稿者のリンク（href が /@handle）。確認済み（docs/dom-structure.md「ytd-comment-view-model#comment の中」） */
export const AUTHOR_LINK_SELECTOR = '#header-author h3 a#author-text';

/**
 * 所有者・認証済みのチャンネルのコメントでの投稿者のリンク（href が /@handle）。確認済み（同上）。
 * 認証済みのチャンネルにも付くので、所有者かは commentEntity.author.isCreator で決める（dom.js の readIsOwner）
 */
export const OWNER_BADGE_LINK_SELECTOR = '#author-comment-badge ytd-author-comment-badge-renderer a#name';

/** 投稿者の名前の行。NG 登録のボタンをここに差し込む。確認済み（docs/dom-structure.md「ytd-comment-view-model#comment の中」） */
export const HEADER_AUTHOR_SELECTOR = '#header-author';

/**
 * 固定コメントの印。確認済み（docs/dom-structure.md「固定コメントの印」）。印は固定コメントにだけ置かれる。
 * 外れても固定コメントを判定するだけで隠れすぎはしないが、ほかのコメントにも当たると、それらまで判定から外れてどの判定も効かなくなる
 */
export const PINNED_BADGE_SELECTOR = '#pinned-comment-badge ytw-pinned-comment-badge-renderer';

/** 投稿日時のリンク（href に lc=<commentId>）。確認済み（同上） */
export const PUBLISHED_TIME_LINK_SELECTOR = '#published-time-text a';

/**
 * 本文の要素。属性としては見えないが querySelector で取れる。確認済み（同上）。
 * 本文の文字列は polymer のデータの原文を優先し、この要素の textContent はそれが無いときに使う（dom.js の readBodyText）。
 * 先頭の @メンションのリンクはこの要素から読む
 */
export const CONTENT_TEXT_SELECTOR = '#content-text';

/** 本文の代わりの取得先。確認済み（同上） */
export const CONTENT_TEXT_FALLBACK_SELECTOR = '#expander yt-attributed-string[slot="content"]';

/** 本文の中のリンク。@返信の宛先の判定に使う。確認済み（同上。宛先は先頭の a.ytAttributedStringLink） */
export const CONTENT_LINK_SELECTOR = 'a[href]';

/** YouTube 自身の折りたたみ。確認済み（同上） */
export const EXPANDER_SELECTOR = 'ytd-expander#expander';

/** 折りたたみの中の本文の枠（-webkit-line-clamp: 4）。EXPANDER_SELECTOR の直下。確認済み（同上） */
export const EXPANDER_CONTENT_ID = 'content';

/** 「もっと見る」ボタン。確認済み（同上） */
export const MORE_BUTTON_SELECTOR = 'tp-yt-paper-button#more';

/** 「一部を表示」ボタン。確認済み（同上） */
export const LESS_BUTTON_SELECTOR = 'tp-yt-paper-button#less';

/**
 * 段階表示のクリックを反応させない要素。
 * a と tp-yt-paper-button は確認済み（本文のリンクと #more / #less）。
 * button・[role="button"]・yt-button-shape は未確認（工程 3 で確認）: 本文の周辺に現れうるものとして防御的に並べている
 */
export const INTERACTIVE_SELECTOR = 'a, button, tp-yt-paper-button, [role="button"], yt-button-shape';

/** SPA の遷移の開始。Shorts の次の動画への移動で発火することは確認済み（docs/dom-structure.md「Shorts のコメント欄」）。動画ページでは未確認 */
export const NAVIGATE_START_EVENT = 'yt-navigate-start';

/** SPA の遷移の完了。Shorts の次の動画への移動で発火することは確認済み（同上）。動画ページでは未確認 */
export const NAVIGATE_FINISH_EVENT = 'yt-navigate-finish';

/** 動画ページのパス。対象のページかの判定に使う */
export const WATCH_PATHNAME = '/watch';

/** Shorts のページのパスの接頭辞（/shorts/<videoId>）。対象のページかの判定に使う */
export const SHORTS_PATHNAME_PREFIX = '/shorts/';

/**
 * html 要素に付ける。動画ページ（WATCH_PATHNAME）にいる間だけ付ける。
 * CSS が未確認の WATCH_FLEXY_TAG だけに頼らずに対象のコメント欄を決めるため
 */
export const WATCH_ATTR = 'data-ycf-watch';

/**
 * html 要素に付ける。Shorts のページ（SHORTS_PATHNAME_PREFIX）にいる間だけ付ける。
 * WATCH_ATTR と同じく、CSS が対象のコメント欄を決めるのに使う
 */
export const SHORTS_ATTR = 'data-ycf-shorts';

/** html 要素に付ける。付いている間はコメント欄を開く */
export const OPEN_ATTR = 'data-ycf-open';

/** thread に付ける表示状態（'shown' | 'hidden' | 'pending'）。無い thread は判定前として隠す */
export const STATE_ATTR = 'data-ycf-state';

/**
 * html 要素に付ける。付いている間は、隠したコメントを理由の帯（REASON_STRIP_CLASS）にして見せる。
 * OPEN_ATTR と同じく html に置く。CSS がコメント欄の範囲ごとに条件を差し込めるのは html の条件だけのため（styles.js の forEachScope）
 */
export const REASONS_ATTR = 'data-ycf-reasons';

/** thread に付ける状態の理由（decide.js の reason） */
export const REASON_ATTR = 'data-ycf-reason';

/**
 * 隠した thread に付ける、理由の詳細。NG ユーザ・NG ワードは judgeByRules の detail、AI はカテゴリ。
 * 詳細が無いときは付けない。帯の文言（decide.js の buildReasonText）に使う
 */
export const DETAIL_ATTR = 'data-ycf-detail';

/**
 * 隠した thread に付ける。理由の帯が押され、親コメントを一時的に見せている間だけ付ける。
 * 判定の結果は変えない。コメント ID か本文が変わったら外す（scanner.js）
 */
export const REVEALED_ATTR = 'data-ycf-revealed';

/** thread に付ける、判定したコメントの ID */
export const ID_ATTR = 'data-ycf-id';

/** thread に付ける、判定した本文のハッシュ */
export const HASH_ATTR = 'data-ycf-hash';

/**
 * thread に付ける、判定したときの judgeExemption の結果（判定から外さないときは空文字）。
 * 判定から外す条件のデータ（所有者・固定・認証済み・投稿者）は本文より遅れて届きうるので、結果が変わったら判定し直す。
 * 条件のデータではなく結果を比べるのは、設定で外していない条件や結果を変えない変化で判定し直さないため。
 * HASH_ATTR は AI の判定のキャッシュのキーなので、結果はそこに混ぜずこの属性で比べる
 */
export const EXEMPTION_ATTR = 'data-ycf-exemption';

/** thread に付ける。付いている間は本文を全文表示に固定する */
export const EXPANDED_ATTR = 'data-ycf-expanded';

/** コメントに差し込む NG 登録のボタンの class */
export const BLOCK_BUTTON_CLASS = 'ycf-block';

/** 隠した thread の先頭に差し込む、理由の帯（button）の class */
export const REASON_STRIP_CLASS = 'ycf-reason';

/** 件数バーの要素の id */
export const BAR_ID = 'ycf-bar';

/** style 要素の id */
export const STYLE_ID = 'ycf-style';
