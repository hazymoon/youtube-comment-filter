/**
 * @file コメントの DOM を読む関数。
 *
 * document 全体には触れず、渡された要素とその子孫・祖先だけを読む（テストで偽の要素を渡せるようにするため）。
 * 使う要素の機能は children / id / tagName / getAttribute / querySelector / textContent / parentElement と、
 * page 世界で読める data / polymerController に限る。
 */

import { hashString } from './hash.js';
import {
  AUTHOR_LINK_SELECTOR,
  COMMENT_CONTAINER_ID,
  CONTENT_LINK_SELECTOR,
  CONTENT_TEXT_FALLBACK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  OWNER_BADGE_LINK_SELECTOR,
  PUBLISHED_TIME_LINK_SELECTOR,
  REPLIES_RENDERER_TAG,
  STATE_ATTR,
  THREAD_TAG,
  VIEW_MODEL_ID,
  VIEW_MODEL_TAG,
} from './selectors.js';

const HANDLE_PATH_PATTERN = /^\/@([^/?#]+)/;

/**
 * 要素のタグ名を小文字で返す。
 * @param {any} el 要素
 * @returns {string}
 */
function tagNameOf(el) {
  return typeof el?.tagName === 'string' ? el.tagName.toLowerCase() : '';
}

/**
 * id が一致する直下の子要素を返す。
 * @param {any} el 親要素
 * @param {string} id 子要素の id
 * @param {string} [tag] 指定したときはタグ名も一致するものに限る
 * @returns {any|null}
 */
export function directChildById(el, id, tag) {
  for (const child of Array.from(el?.children ?? [])) {
    if (child?.id === id && (tag === undefined || tagNameOf(child) === tag)) return child;
  }
  return null;
}

/**
 * thread の直下の #comment-container の中のコメント本体を返す。入れ子の返信の本体は返さない。
 * @param {any} threadEl ytd-comment-thread-renderer
 * @returns {any|null} ytd-comment-view-model#comment
 */
export function findOwnViewModel(threadEl) {
  const container = directChildById(threadEl, COMMENT_CONTAINER_ID);
  return container ? directChildById(container, VIEW_MODEL_ID, VIEW_MODEL_TAG) : null;
}

/**
 * 祖先（自身は含まない）に指定のタグの要素があるかを、条件付きで調べる。
 * @param {any} el 起点
 * @param {string} tag タグ名
 * @param {(ancestor: any) => boolean} [predicate] 追加の条件
 * @returns {boolean}
 */
function hasAncestor(el, tag, predicate = () => true) {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement ?? null) {
    if (tagNameOf(node) === tag && predicate(node)) return true;
  }
  return false;
}

/**
 * 祖先の thread（自身は除く）が非表示（data-ycf-state="hidden"）か。
 * 親が非表示ならスレッドごと隠れているので、判定も件数の集計もしない。
 * @param {any} threadEl ytd-comment-thread-renderer
 * @returns {boolean}
 */
export function isInsideHiddenThread(threadEl) {
  return hasAncestor(threadEl, THREAD_TAG, (ancestor) => ancestor.getAttribute?.(STATE_ATTR) === 'hidden');
}

/**
 * href の文字列を URL として解釈する。
 * @param {string|null|undefined} href getAttribute('href') の値
 * @returns {URL|null}
 */
function parseYoutubeHref(href) {
  if (typeof href !== 'string' || href === '') return null;
  try {
    return new URL(href, 'https://www.youtube.com');
  } catch {
    return null;
  }
}

/**
 * 投稿者のリンクの href からハンドルを取り出す。
 * @param {string|null|undefined} href "/@handle" 形式
 * @returns {string|null} "@" 付きのハンドル。取り出せなければ null
 */
function handleFromHref(href) {
  const url = parseYoutubeHref(href);
  if (!url) return null;
  const match = HANDLE_PATH_PATTERN.exec(url.pathname);
  if (!match) return null;
  try {
    return `@${decodeURIComponent(match[1])}`;
  } catch {
    return `@${match[1]}`;
  }
}

/**
 * 投稿日時のリンクの href からコメント ID（lc= パラメータ）を取り出す。
 * @param {string|null|undefined} href "/watch?v=…&lc=<commentId>" 形式
 * @returns {string|null}
 */
function commentIdFromHref(href) {
  const url = parseYoutubeHref(href);
  const id = url?.searchParams.get('lc');
  return id ? id : null;
}

/**
 * 空でない文字列ならそのまま、そうでなければ null を返す。
 * @param {unknown} value 値
 * @returns {string|null}
 */
function nonEmptyString(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * コメント ID を取り出す。page 世界のデータを優先し、無ければ投稿日時のリンクの lc= を使う。
 * @param {any} viewModel ytd-comment-view-model
 * @returns {string|null}
 */
function readCommentId(viewModel) {
  return (
    nonEmptyString(viewModel?.data?.commentId) ??
    nonEmptyString(viewModel?.polymerController?.data?.commentId) ??
    commentIdFromHref(viewModel?.querySelector?.(PUBLISHED_TIME_LINK_SELECTOR)?.getAttribute?.('href'))
  );
}

/**
 * 投稿者のハンドルを取り出す。チャンネル所有者のコメントでは a#author-text が hidden になるが href は残るので、
 * a#author-text を先に見て、取れなければバッジの a#name を見る。
 * @param {any} viewModel ytd-comment-view-model
 * @returns {string|null}
 */
function readAuthorHandle(viewModel) {
  for (const selector of [AUTHOR_LINK_SELECTOR, OWNER_BADGE_LINK_SELECTOR]) {
    const handle = handleFromHref(viewModel?.querySelector?.(selector)?.getAttribute?.('href'));
    if (handle) return handle;
  }
  return null;
}

/**
 * 本文の先頭にあるリンクの href を返す（@返信の宛先の判定に使う）。
 * 本文の最初のリンクについて、本文が（先頭の空白を除いて）そのリンクの文字列で始まるときだけ返す。
 * @param {any} contentEl 本文の要素
 * @param {string} rawText 本文の要素の textContent
 * @returns {string|null}
 */
function readLeadingMentionHref(contentEl, rawText) {
  const link = contentEl?.querySelector?.(CONTENT_LINK_SELECTOR);
  if (!link) return null;
  const linkText = String(link.textContent ?? '').trim();
  if (linkText === '' || !rawText.trimStart().startsWith(linkText)) return null;
  return nonEmptyString(link.getAttribute?.('href'));
}

/**
 * @typedef {object} ExtractedComment
 * @property {string} id コメント ID
 * @property {string} text 本文（前後の空白を除く）。画像の絵文字だけの本文などは空文字
 * @property {string} textHash 本文のハッシュ（hashString）
 * @property {{ handle: string|null, channelId: string|null }} author 投稿者
 * @property {boolean} isReply 返信か
 * @property {string|null} leadingMentionHref 本文の先頭にあるリンクの href
 */

/**
 * thread からコメントの情報を読む。
 * 本体・本文の要素が見つからないか、コメント ID が取れないときは unreadable を返す（呼び出し側は判定待ちとして隠す）。
 * @param {any} threadEl ytd-comment-thread-renderer
 * @returns {ExtractedComment | { unreadable: string }}
 */
export function extractComment(threadEl) {
  const viewModel = findOwnViewModel(threadEl);
  if (!viewModel) return { unreadable: 'コメント本体の要素が見つかりません' };
  const contentEl =
    viewModel.querySelector?.(CONTENT_TEXT_SELECTOR) ?? viewModel.querySelector?.(CONTENT_TEXT_FALLBACK_SELECTOR) ?? null;
  if (!contentEl) return { unreadable: '本文の要素が見つかりません' };
  const id = readCommentId(viewModel);
  if (!id) return { unreadable: 'コメント ID が取れません' };

  const rawText = String(contentEl.textContent ?? '');
  const text = rawText.trim();
  return {
    id,
    text,
    textHash: hashString(text),
    author: {
      handle: readAuthorHandle(viewModel),
      channelId: nonEmptyString(viewModel.polymerController?.__data?.commentEntity?.author?.channelId),
    },
    isReply: hasAncestor(threadEl, REPLIES_RENDERER_TAG),
    leadingMentionHref: readLeadingMentionHref(contentEl, rawText),
  };
}
