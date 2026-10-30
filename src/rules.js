/**
 * @file NG ユーザ・NG ワードによるルール判定。
 */

import { normalizeForMatch, normalizeIdentityName, toNfkc } from './normalize.js';

const CHANNEL_ID_PATTERN = /^UC[0-9A-Za-z_-]{22}$/;
const MENTION_HREF_HANDLE_PATTERN = /^\/@([^/]+)/;
const MENTION_HREF_CHANNEL_PATTERN = /^\/channel\/(UC[0-9A-Za-z_-]{22})(?:\/|$)/;
const LEADING_MENTION_TEXT_PATTERN = /^@([^\s@]+)/;

/**
 * ハンドルを照合用の形にする。本文の正規化（記号除去など）は通さない。
 * `.` `_` `-` を含むハンドルを区別するため（@foo_bar と @foobar は別人）。
 * @param {string} handle "@" 付きでも無しでもよい
 * @returns {string} NFKC → 小文字化し、先頭の "@" を除いたもの
 */
function normalizeHandle(handle) {
  return toNfkc(handle).trim().toLowerCase().replace(/^@/, '');
}

/**
 * 値が RegExp か。設定と照合器が別の realm で作られても判定できるように型タグで見る。
 * @param {unknown} value 値
 * @returns {value is RegExp}
 */
function isRegExp(value) {
  return Object.prototype.toString.call(value) === '[object RegExp]';
}

/**
 * href のパス部分を取り出す。絶対 URL でも相対パスでもよい。
 * @param {string} href リンクの href
 * @returns {string|null} パス。解釈できなければ null
 */
function hrefPathname(href) {
  try {
    return new URL(href, 'https://www.youtube.com').pathname;
  } catch {
    return null;
  }
}

/**
 * パーセントエンコードを解く。壊れたエンコードはそのまま返す。
 * @param {string} value 対象
 * @returns {string}
 */
function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * ユーザの指定（ハンドルかチャンネル ID）の配列を、照合用の集合に振り分ける。
 * 不正な要素は捨て、理由を warnings に入れる。
 * @param {unknown[]|undefined} entries 指定の配列
 * @param {string} label 警告に出す設定の名前
 * @param {string[]} warnings 警告の追加先
 * @returns {{ handles: Set<string>, channelIds: Set<string> }}
 */
function compileUsers(entries, label, warnings) {
  /** @type {Set<string>} */
  const handles = new Set();
  /** @type {Set<string>} */
  const channelIds = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry !== 'string') {
      warnings.push(`${label}: 文字列ではない要素を無視しました: ${String(entry)}`);
      continue;
    }
    const trimmed = entry.trim();
    if (CHANNEL_ID_PATTERN.test(trimmed)) {
      channelIds.add(trimmed);
      continue;
    }
    const nfkc = toNfkc(trimmed);
    if (nfkc.startsWith('@')) {
      const handle = normalizeHandle(nfkc);
      if (handle !== '' && !/[\s@]/.test(handle)) {
        handles.add(handle);
        continue;
      }
    }
    warnings.push(`${label}: "@ハンドル" か "UC" で始まる 24 文字のチャンネル ID ではないので無視しました: ${entry}`);
  }
  return { handles, channelIds };
}

/**
 * @typedef {object} CompiledRules
 * @property {string[]} warnings 設定から捨てた要素とその理由
 * @property {(author: { handle?: string|null, channelId?: string|null }) => ('handle'|'channelId'|null)} matchUser
 *   投稿者が NG ユーザか
 * @property {(author: { handle?: string|null, channelId?: string|null }) => boolean} matchAllowedUser
 *   投稿者が許可ユーザか
 * @property {(text: string) => ({ word: string }|null)} matchWord 本文が NG ワードを含むか
 * @property {(reply: { text: string, leadingMentionHref?: string|null }) => boolean} matchMention
 *   返信の本文が NG ユーザ宛ての @メンションで始まるか
 */

/**
 * 設定の NG ユーザ・NG ワード・許可ユーザを照合器にする。
 * 不正な要素は例外にせず捨て、理由を warnings に入れる（設定の 1 か所の誤りでスクリプト全体を止めないため）。
 * @param {{ ngUsers?: unknown[], ngWords?: unknown[], allowUsers?: unknown[] }} config NG_USERS・NG_WORDS・ALLOW_USERS
 * @returns {CompiledRules}
 */
export function compileRules({ ngUsers = [], ngWords = [], allowUsers = [] } = {}) {
  /** @type {string[]} */
  const warnings = [];
  const { handles, channelIds } = compileUsers(ngUsers, 'NG_USERS', warnings);
  const allowed = compileUsers(allowUsers, 'ALLOW_USERS', warnings);
  /** @type {{ normalized: string, label: string }[]} */
  const stringWords = [];
  /** @type {{ regexp: RegExp, label: string }[]} */
  const regexpWords = [];

  for (const entry of Array.isArray(ngWords) ? ngWords : []) {
    if (typeof entry === 'string') {
      const normalized = normalizeForMatch(entry);
      if (normalized === '') {
        warnings.push(`NG_WORDS: 正規化すると空になる（記号・空白・絵文字だけの）語を無視しました: ${entry}`);
        continue;
      }
      stringWords.push({ normalized, label: entry });
    } else if (isRegExp(entry)) {
      // Drop g/y so that lastIndex state never affects test() results.
      const regexp = new RegExp(entry.source, entry.flags.replace(/[gy]/g, ''));
      regexpWords.push({ regexp, label: String(entry) });
    } else {
      warnings.push(`NG_WORDS: 文字列でも正規表現でもない要素を無視しました: ${String(entry)}`);
    }
  }

  /**
   * ハンドルが NG ユーザか。
   * @param {string|null|undefined} handle ハンドル
   * @returns {boolean}
   */
  const isNgHandle = (handle) => typeof handle === 'string' && handles.has(normalizeHandle(handle));

  /**
   * チャンネル ID が NG ユーザか。大文字小文字を区別する。
   * @param {string|null|undefined} channelId チャンネル ID
   * @returns {boolean}
   */
  const isNgChannelId = (channelId) => typeof channelId === 'string' && channelIds.has(channelId);

  return {
    warnings,

    matchUser(author) {
      if (!author) return null;
      if (isNgHandle(author.handle)) return 'handle';
      if (isNgChannelId(author.channelId)) return 'channelId';
      return null;
    },

    matchAllowedUser(author) {
      if (!author) return false;
      if (typeof author.handle === 'string' && allowed.handles.has(normalizeHandle(author.handle))) return true;
      return typeof author.channelId === 'string' && allowed.channelIds.has(author.channelId);
    },

    matchWord(text) {
      const normalized = normalizeForMatch(text);
      if (normalized === '') return null;
      for (const { normalized: word, label } of stringWords) {
        if (normalized.includes(word)) return { word: label };
      }
      if (regexpWords.length > 0) {
        // 利用者の正規表現は元の表記（カタカナ・記号）で書かれうるため、NFKC だけの本文と正規化後の本文の両方に当てる
        const nfkc = toNfkc(text);
        for (const { regexp, label } of regexpWords) {
          if (regexp.test(nfkc) || regexp.test(normalized)) return { word: label };
        }
      }
      return null;
    },

    matchMention(reply) {
      if (!reply) return false;
      const href = reply.leadingMentionHref;
      if (typeof href === 'string' && href !== '') {
        const pathname = hrefPathname(href);
        if (pathname !== null) {
          const handleMatch = MENTION_HREF_HANDLE_PATTERN.exec(pathname);
          if (handleMatch) return isNgHandle(safeDecodeUriComponent(handleMatch[1]));
          const channelMatch = MENTION_HREF_CHANNEL_PATTERN.exec(pathname);
          // UC が NG でなくても、宛先のリンクの文字列が @ハンドルなら本文の照合で NG ハンドルに当たりうるので続ける
          if (channelMatch && isNgChannelId(channelMatch[1])) return true;
        }
        // メンションの形でないリンク（URL など）が先頭にあるときと、UC が NG でないときは、本文のテキストで判定する
      }
      // 表示名だけの宛先は、表示名がたまたまハンドルと一致しない限り一致しない（対象外の仕様）
      const textMatch = LEADING_MENTION_TEXT_PATTERN.exec(toNfkc(reply.text).trimStart());
      return textMatch !== null && isNgHandle(textMatch[1]);
    },
  };
}

/**
 * なりすましの照合に使う動画の投稿者の名前の、正規化した後の最小の文字数。
 * 短い名前は、別人のハンドル・表示名がたまたま同じになりやすいため照合に使わない
 */
const MIN_IMPERSONATED_NAME_CHARS = 3;

/** @type {WeakMap<object, Set<string>>} 動画の投稿者ごとの、照合に使う正規化した名前 */
const impersonatedNamesCache = new WeakMap();

/**
 * 動画の投稿者の、照合に使う正規化した名前（MIN_IMPERSONATED_NAME_CHARS 文字未満のものは除く）を返す。
 * 投稿者のオブジェクトごとに一度だけ作る。scanner.js は投稿者が変わるまで同じオブジェクトを渡すので、
 * コメントごとに作り直さない。
 * @param {VideoOwner} videoOwner 動画の投稿者
 * @returns {Set<string>}
 */
function impersonatedNamesOf(videoOwner) {
  let names = impersonatedNamesCache.get(videoOwner);
  if (!names) {
    names = new Set(
      [videoOwner.handle, videoOwner.displayName]
        .filter((name) => typeof name === 'string')
        .map(normalizeIdentityName)
        .filter((name) => [...name].length >= MIN_IMPERSONATED_NAME_CHARS),
    );
    impersonatedNamesCache.set(videoOwner, names);
  }
  return names;
}

/**
 * @typedef {object} VideoOwner 動画の投稿者（owner.js の readVideoOwner）
 * @property {string|null} handle "@" 付きのハンドル
 * @property {string|null} displayName 表示名
 */

/**
 * コメントの投稿者が、動画の投稿者になりすましているか。
 * コメントの投稿者のハンドルか表示名を正規化したもの（normalizeIdentityName）が、動画の投稿者のハンドルか表示名を
 * 正規化したものと完全に一致し、投稿者本人ではないときに一致とする。部分一致や似た綴りは見ない（別人を隠さないため）。
 * 本人かは isOwner に加え、ハンドルが同じか（normalizeHandle）でも見る。ハンドルはチャンネルごとに重複しないので、
 * isOwner のデータが届く前の本人のコメントを隠さないため。
 * コメントの投稿者のハンドルを読めないときは判定しない。本人かを確かめられず、隠した後に判定し直す契機も無い
 * （動画ページでは、ハンドルや isOwner が遅れて届いても判定から外す結果が変わらなければ判定し直さない）ため。
 * @param {{ handle?: string|null, displayName?: string|null, isOwner?: boolean }} author コメントの投稿者
 * @param {VideoOwner|null|undefined} videoOwner 動画の投稿者。読めないときは null
 * @returns {boolean}
 */
export function matchImpersonation(author, videoOwner) {
  if (!author || !videoOwner || author.isOwner || typeof author.handle !== 'string') return false;
  if (typeof videoOwner.handle === 'string' && normalizeHandle(author.handle) === normalizeHandle(videoOwner.handle)) {
    return false;
  }
  const ownerNames = impersonatedNamesOf(videoOwner);
  if (ownerNames.size === 0) return false;
  return [author.handle, author.displayName]
    .filter((name) => typeof name === 'string')
    .some((name) => ownerNames.has(normalizeIdentityName(name)));
}

/**
 * @typedef {object} RuleComment
 * @property {{ handle?: string|null, channelId?: string|null, displayName?: string|null, isOwner?: boolean }} author 投稿者
 * @property {string} text 本文
 * @property {boolean} [isReply] 返信か
 * @property {string|null} [leadingMentionHref] 本文の先頭にあるリンクの href
 */

/**
 * コメントをルールで判定する。
 * 優先順位は、投稿者が NG ユーザ → 返信の宛先が NG ユーザ（返信のときだけ）→ 動画の投稿者へのなりすまし → NG ワード。
 * なりすましは NG ユーザとして数える（件数バーの内訳を増やさないため）。
 * @param {RuleComment} comment コメント
 * @param {CompiledRules} rules compileRules の結果
 * @param {VideoOwner|null} [videoOwner] 動画の投稿者。読めないときは null で、なりすましの判定をしない
 * @returns {{ reason: 'ngUser'|'ngWord'|null, detail?: string }}
 *   detail は ngUser なら 'handle' | 'channelId' | 'mention' | 'impersonation'、ngWord なら一致した設定値
 */
export function judgeByRules(comment, rules, videoOwner = null) {
  const userMatch = rules.matchUser(comment.author);
  if (userMatch) return { reason: 'ngUser', detail: userMatch };
  if (comment.isReply && rules.matchMention({ text: comment.text, leadingMentionHref: comment.leadingMentionHref })) {
    return { reason: 'ngUser', detail: 'mention' };
  }
  if (matchImpersonation(comment.author, videoOwner)) return { reason: 'ngUser', detail: 'impersonation' };
  const wordMatch = rules.matchWord(comment.text);
  if (wordMatch) return { reason: 'ngWord', detail: wordMatch.word };
  return { reason: null };
}

/**
 * @typedef {object} ExemptOptions
 * @property {boolean} owner 動画のチャンネル所有者のコメントを外すか
 * @property {boolean} pinned 固定コメントを外すか
 * @property {boolean} verified 認証バッジ付きのチャンネルのコメントを外すか
 */

/**
 * コメントを判定から外す（NG ユーザ・NG ワード・AI のどれでも隠さない）かを調べる。
 * 優先順位は、動画のチャンネル所有者 → 固定コメント → 認証バッジ付き → 許可ユーザ。
 * @param {{ author: { handle?: string|null, channelId?: string|null, isOwner?: boolean, isVerified?: boolean }, isPinned?: boolean }} comment コメント
 * @param {CompiledRules} rules compileRules の結果
 * @param {ExemptOptions} options 外す対象の設定
 * @returns {'owner'|'pinned'|'verified'|'allowUser'|null} 外す理由。外さないなら null
 */
export function judgeExemption(comment, rules, options) {
  if (options.owner && comment.author.isOwner) return 'owner';
  if (options.pinned && comment.isPinned) return 'pinned';
  if (options.verified && comment.author.isVerified) return 'verified';
  if (rules.matchAllowedUser(comment.author)) return 'allowUser';
  return null;
}
