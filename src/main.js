/**
 * @file エントリポイント。DOM の監視・表示状態の反映・件数バー・AI 判定を結線する。
 */

import { cacheVersion } from './ai.js';
import { createAiCache } from './cache.js';
import {
  AI_BATCH_SIZE,
  AI_CACHE_MAX_ENTRIES,
  AI_CATEGORIES,
  AI_ENABLED,
  AI_MAX_CHARS,
  AI_TIMEOUT_MS,
  ALLOW_USERS,
  DEBUG,
  EXEMPT_OWNER,
  EXEMPT_PINNED,
  EXEMPT_VERIFIED,
  NG_USERS,
  NG_WORDS,
} from './config.js';
import { buildCountText, buildStatusText } from './decide.js';
import { directChildById, extractComment, findOwnViewModel } from './dom.js';
import { restoreFocusAfterHide } from './focus.js';
import { createLanguageModelController } from './lm.js';
import { createNavigationState, pageKindFromPathname } from './navigation.js';
import {
  ALLOW_USERS_VALUE_KEY,
  NG_USERS_VALUE_KEY,
  NG_WORDS_VALUE_KEY,
  appendStoredUser,
  parseStoredSettings,
} from './settings.js';
import { createAiQueue } from './queue.js';
import { compileRules } from './rules.js';
import { createThreadProcessor } from './scanner.js';
import {
  COMMENT_CONTAINER_ID,
  COMMENTS_SELECTOR,
  EXPANDED_ATTR,
  EXPANDER_SELECTOR,
  INTERACTIVE_SELECTOR,
  NAVIGATE_FINISH_EVENT,
  NAVIGATE_START_EVENT,
  OPEN_ATTR,
  SHORTS_ATTR,
  SHORTS_COMMENTS_SELECTOR,
  STATE_ATTR,
  STYLE_ID,
  THREAD_TAG,
  WATCH_ATTR,
  WATCH_COMMENTS_SELECTOR,
} from './selectors.js';
import { buildStyles } from './styles.js';
import { createCountBar, ensureBlockButton, isBlockButtonInsertion } from './ui.js';

/** GM_setValue に保存するキャッシュのキー */
const CACHE_STORAGE_KEY = 'aiCache';

/** キャッシュの書き込みをまとめる時間（ミリ秒） */
const CACHE_SAVE_DELAY_MS = 2000;

/** DOM の変化を受けてからスキャンするまでの時間（ミリ秒）。連続する変化を 1 回にまとめる */
const SCAN_DELAY_MS = 50;

/**
 * 判定の経過を console に出す（DEBUG のときだけ）。本文は出さない。
 * @param {...unknown} args 出す値
 */
function debugLog(...args) {
  // console.debug は Chrome の既定の表示レベル（詳細を除く）では出ないので、console.log で出す
  if (DEBUG) console.log('[youtube-comment-filter]', ...args);
}

/**
 * style 要素を差し込む。document-start では head が無いことがあるので html 要素の直下に入れる。
 * @param {Document} doc document
 */
function injectStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = buildStyles();
  (doc.head ?? doc.documentElement).appendChild(style);
}

/**
 * GM_getValue / GM_setValue を使うキャッシュの保存先を作る。使えない環境では保存しない。
 * @returns {import('./cache.js').AiCacheStorage}
 */
function createGmStorage() {
  return {
    load() {
      return typeof GM_getValue === 'function' ? GM_getValue(CACHE_STORAGE_KEY) : undefined;
    },
    save(value) {
      if (typeof GM_setValue === 'function') GM_setValue(CACHE_STORAGE_KEY, value);
    },
  };
}

/**
 * 「値」タブの NG ユーザ・NG ワード・許可ユーザを読む。まだ無い値は空の配列で作り、「値」タブに名前が出るようにする
 * （利用者が値の名前を覚えていなくても書き込めるようにするため）。GM_* が使えない環境では空にする。
 * @returns {ReturnType<typeof parseStoredSettings>}
 */
function readStoredSettings() {
  if (typeof GM_getValue !== 'function') {
    return parseStoredSettings({ ngUsers: undefined, ngWords: undefined, allowUsers: undefined });
  }
  const read = (key) => {
    const value = GM_getValue(key);
    if (value === undefined && typeof GM_setValue === 'function') GM_setValue(key, []);
    return value;
  };
  return parseStoredSettings({
    ngUsers: read(NG_USERS_VALUE_KEY),
    ngWords: read(NG_WORDS_VALUE_KEY),
    allowUsers: read(ALLOW_USERS_VALUE_KEY),
  });
}

/**
 * 設定ブロックと「値」タブの NG ユーザ・NG ワード・許可ユーザを合わせて照合器にする。設定の誤りは console に出す。
 * @returns {import('./rules.js').CompiledRules}
 */
function buildRules() {
  const stored = readStoredSettings();
  for (const warning of stored.warnings) console.warn('[youtube-comment-filter]', warning);
  const rules = compileRules({
    ngUsers: [...NG_USERS, ...stored.ngUsers],
    ngWords: [...NG_WORDS, ...stored.ngWords],
    allowUsers: [...ALLOW_USERS, ...stored.allowUsers],
  });
  for (const warning of rules.warnings) console.warn('[youtube-comment-filter]', warning);
  return rules;
}

/**
 * ユーザスクリプトの起動処理。ビルドが IIFE の最後でこの関数を呼ぶ。
 */
export function main() {
  const doc = document;
  injectStyles(doc);
  updatePageAttrs();
  const navigation = createNavigationState(location.href);

  const rules = buildRules();

  const cache = createAiCache({
    maxEntries: AI_CACHE_MAX_ENTRIES,
    version: cacheVersion(AI_CATEGORIES, AI_BATCH_SIZE),
    storage: createGmStorage(),
    schedule(fn) {
      const timer = setTimeout(fn, CACHE_SAVE_DELAY_MS);
      return () => clearTimeout(timer);
    },
  });

  /** @type {Element|null} 監視中のコメント欄 */
  let commentsEl = null;
  /** @type {MutationObserver|null} */
  let commentsObserver = null;
  /** @type {MutationObserver|null} コメント欄の出現を待つ監視 */
  let documentObserver = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let scanTimer = null;
  /**
   * NG 登録を確定した thread。thread を隠すのは次のスキャンなので、そこでフォーカスを移すために覚えておく
   * @type {Element|null}
   */
  let pendingFocusThread = null;

  const lm = createLanguageModelController({
    categories: AI_CATEGORIES,
    enabled: AI_ENABLED,
    onStateChange(aiState) {
      debugLog('AI の状態', aiState);
      // AI が使えなくなったら判定中のコメントを表示に戻すため、状態が変わるたびにスキャンし直す
      scheduleScan();
      renderBar();
    },
  });

  const processor = createThreadProcessor({
    rules,
    exempt: { owner: EXEMPT_OWNER, pinned: EXEMPT_PINNED, verified: EXEMPT_VERIFIED },
    cache,
    getAiMode: () => lm.getState().mode,
    debugLog,
    onShown: (thread) => ensureBlockButton(findOwnViewModel(thread), doc, onBlockClick),
  });

  const queue = createAiQueue({
    cloneSession: () => lm.cloneSession(),
    batchSize: AI_BATCH_SIZE,
    timeoutMs: AI_TIMEOUT_MS,
    maxChars: AI_MAX_CHARS,
    categories: AI_CATEGORIES,
    onVerdict(id, verdict, item) {
      const { needsRescan } = processor.applyVerdict(currentThreads(), id, verdict, item);
      if (needsRescan) scheduleScan();
      renderBar();
    },
    onPending(id, item) {
      const { needsRescan } = processor.applyPending(currentThreads(), id, item);
      if (needsRescan) scheduleScan();
      renderBar();
    },
    onFatal(error) {
      console.warn('[youtube-comment-filter] AI の判定を止め、ルールだけで判定します', error);
      lm.markFailed(error);
      scheduleScan();
      renderBar();
    },
  });

  const bar = createCountBar({
    doc,
    onToggle() {
      // ユーザー操作の有効期限が切れないよう、await を挟まずに最初に呼ぶ
      lm.activate();
      if (doc.documentElement.hasAttribute(OPEN_ATTR)) doc.documentElement.removeAttribute(OPEN_ATTR);
      else doc.documentElement.setAttribute(OPEN_ATTR, '');
      renderBar();
    },
  });

  /**
   * 監視中のコメント欄の中の thread を文書順に返す。
   * @returns {Element[]}
   */
  function currentThreads() {
    return commentsEl ? Array.from(commentsEl.querySelectorAll(THREAD_TAG)) : [];
  }

  /** 対象のページ（動画ページか Shorts）の種類。対象外なら null */
  function currentPageKind() {
    return pageKindFromPathname(location.pathname);
  }

  /** 対象のページ（動画ページか Shorts）か */
  function isTargetPage() {
    return currentPageKind() !== null;
  }

  /**
   * ページの種類に応じて html に WATCH_ATTR / SHORTS_ATTR を付ける（CSS が対象のコメント欄を決めるのに使う）。
   * 遷移で種類が変わったら付け替える
   */
  function updatePageAttrs() {
    const kind = currentPageKind();
    doc.documentElement.toggleAttribute(WATCH_ATTR, kind === 'watch');
    doc.documentElement.toggleAttribute(SHORTS_ATTR, kind === 'shorts');
  }

  /**
   * いまのページの種類のコメント欄を探す。
   * Shorts のページでも動画ページの ytd-comments#comments は DOM に残るので（逆も同じ）、ページの種類で探し分ける。
   * @returns {Element|null}
   */
  function findComments() {
    const kind = currentPageKind();
    if (kind === 'shorts') return doc.querySelector(SHORTS_COMMENTS_SELECTOR);
    // ytd-watch-flexy は未確認なので、外れたときは確認済みの ytd-comments#comments だけで探す
    if (kind === 'watch') return doc.querySelector(WATCH_COMMENTS_SELECTOR) ?? doc.querySelector(COMMENTS_SELECTOR);
    return null;
  }

  /** 件数バーを更新する。隠したスレッドの中のコメントは数えない。 */
  function renderBar() {
    bar.update({
      open: doc.documentElement.hasAttribute(OPEN_ATTR),
      countText: buildCountText(processor.countThreads(currentThreads())),
      statusText: buildStatusText(lm.getState()),
      visible: isTargetPage() && commentsEl !== null,
    });
  }

  /**
   * コメント欄の thread を判定して表示状態を反映する（規則は scanner.js の processThreads）。
   * 遷移中は AI の順番待ちに入れない。
   */
  function scan() {
    scanTimer = null;
    if (!commentsEl || !isTargetPage()) {
      // コメント欄を離れたら、前の欄の thread へのフォーカスの移し替えを持ち越さない
      pendingFocusThread = null;
      renderBar();
      return;
    }
    const startedAt = DEBUG ? performance.now() : 0;
    const threads = currentThreads();
    const items = processor.processThreads(threads);
    for (const thread of threads) {
      if (thread.getAttribute(STATE_ATTR) === 'shown') ensureBlockButton(findOwnViewModel(thread), doc, onBlockClick);
    }
    if (pendingFocusThread) {
      // NG 登録で thread が隠れると、フォーカスしていたボタンごと消えて body に落ちるので、近くの表示中のコメントへ移す
      const thread = pendingFocusThread;
      pendingFocusThread = null;
      restoreFocusAfterHide({ threads, thread, activeElement: doc.activeElement, doc, fallback: bar.button });
    }
    // 遷移中は入れない。判定中のまま残った thread は、遷移の完了後のスキャンで入れる
    if (items.length > 0 && navigation.canEnqueue()) queue.enqueue(items);
    renderBar();
    // 工程 3 でスキャンの所要時間を実ページで測るための記録
    if (DEBUG) debugLog('スキャン', threads.length, '件', `${(performance.now() - startedAt).toFixed(1)}ms`);
  }

  /** スキャンを予約する。予約済みなら重ねない。 */
  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(scan, SCAN_DELAY_MS);
  }

  /**
   * 動画ページか Shorts のコメント欄を探して監視し、件数バーを差し込む。要素が作り直されていたら付け直す。
   * まだ無ければ document を監視して出現を待つ。
   */
  function attach() {
    updatePageAttrs();
    if (!isTargetPage()) {
      // 対象のページ以外では document 全体やコメント欄の監視を残さない
      documentObserver?.disconnect();
      documentObserver = null;
      commentsObserver?.disconnect();
      commentsObserver = null;
      commentsEl = null;
      renderBar();
      return;
    }
    const found = findComments();
    // 見つからないときも監視を外す。動画ページと Shorts の間を移ると、前のページのコメント欄が
    // DOM に残ったまま（isConnected のまま）になり、それを監視し続けないため
    if (found !== commentsEl) {
      commentsObserver?.disconnect();
      commentsObserver = null;
      commentsEl = found;
      if (found) {
        commentsObserver = new MutationObserver(onCommentsMutation);
        // 自分が書き換える data-ycf-* 属性で再スキャンが回り続けないよう、属性は hidden だけを監視する。
        // 固定の印と所有者の代替判定は hidden の有無で決まり（dom.js の readIsPinned / readIsOwner）、要素が残ったまま
        // hidden だけが付け外しされうるため。コメント欄の中の hidden はこのスクリプトでは書き換えない
        commentsObserver.observe(found, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['hidden'],
        });
      }
    }
    if (commentsEl && !commentsEl.isConnected) {
      commentsObserver?.disconnect();
      commentsObserver = null;
      commentsEl = null;
    }
    if (commentsEl) {
      bar.attach(commentsEl);
      documentObserver?.disconnect();
      documentObserver = null;
    } else if (!documentObserver) {
      let pending = false;
      documentObserver = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
          pending = false;
          attach();
        }, SCAN_DELAY_MS);
      });
      documentObserver.observe(doc.documentElement, { childList: true, subtree: true });
    }
    scheduleScan();
  }

  /**
   * コメント欄の変化。MutationObserver のコールバックは描画より前に走るので、ここで表示中のコメントが
   * 判定したものと同じかを同期で確かめ、違えば判定前に戻す（要素の使い回しや本文の遅れた描画で、
   * 判定していない本文が 1 フレームでも見えないようにするため）。重い判定と順番待ちへの投入はスキャンに任せる。
   * @param {MutationRecord[]} records 変化
   */
  function onCommentsMutation(records) {
    // NG 登録のボタンの差し込みは自分の変化なので除く（スキャンが差し込むたびにもう 1 回スキャンが回らないように）
    const relevant = records.filter((record) => !isBlockButtonInsertion(record));
    if (relevant.length === 0) return;
    // 差し込まれた要素も渡す。target は差し込み先の親なので、差し込まれた thread は target からは見つからない。
    // hidden の変化の通知では target が変化した要素なので、それを含む thread を確かめる
    processor.revalidate(relevant.flatMap((record) => [record.target, ...record.addedNodes]));
    scheduleScan();
  }

  /**
   * NG 登録のボタンのクリック。押された時点の投稿者を読み、確認のうえ「値」タブの ngUsers に足して判定し直す。
   * ハンドルが読めればハンドルを、読めなければチャンネル ID を保存する（「値」タブで見分けやすいため）。
   * @param {HTMLElement} button 押されたボタン
   */
  function onBlockClick(button) {
    const thread = button.closest(THREAD_TAG);
    if (!thread || !commentsEl || !commentsEl.contains(thread)) return;
    let extracted;
    try {
      extracted = extractComment(thread);
    } catch {
      return;
    }
    if ('unreadable' in extracted) return;
    const entry = extracted.author.handle ?? extracted.author.channelId;
    if (!entry) {
      window.alert('投稿者を読めないため、NG ユーザに追加できません。');
      return;
    }
    if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') return;
    if (!window.confirm(`${entry} を NG ユーザに追加しますか？\n（Violentmonkey の「値」タブの ngUsers に保存します）`))
      return;
    // 確認の間に「値」タブが書き換えられていても消さないよう、確認の後に読み直す
    const next = appendStoredUser(GM_getValue(NG_USERS_VALUE_KEY), entry);
    if (!next) {
      window.alert('「値」タブの ngUsers が配列ではないため、追加できません。');
      return;
    }
    GM_setValue(NG_USERS_VALUE_KEY, next);
    debugLog('NG ユーザに追加', entry);
    pendingFocusThread = thread;
    processor.setRules(buildRules());
    scheduleScan();
  }

  /**
   * 段階表示のクリック。本文（thread の直下の #comment-container 内の ytd-expander#expander）のクリックで
   * 全文表示の固定を切り替える。リンク・ボタン上と、文字列の選択中は反応しない。
   * @param {MouseEvent} event クリック
   */
  function onDocumentClick(event) {
    const target = /** @type {any} */ (event.target);
    if (!target || typeof target.closest !== 'function') return;
    const expander = target.closest(EXPANDER_SELECTOR);
    if (!expander) return;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    if (interactive && expander.contains(interactive)) return;
    const selection = doc.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString() !== '') return;
    // 返信の本文のクリックで親を切り替えないよう、いちばん内側の thread の直下の #comment-container の中かを確かめる
    const thread = expander.closest(THREAD_TAG);
    const container = thread ? directChildById(thread, COMMENT_CONTAINER_ID) : null;
    if (!thread || !container || !container.contains(expander)) return;
    if (thread.getAttribute(STATE_ATTR) !== 'shown' || !commentsEl || !commentsEl.contains(thread)) return;
    thread.toggleAttribute(EXPANDED_ATTR);
  }

  doc.addEventListener('click', onDocumentClick);

  doc.addEventListener(NAVIGATE_START_EVENT, () => {
    // 完了までは順番待ちに入れない（DOM に残る前の動画の thread を入れ直さないため）
    navigation.start();
  });
  doc.addEventListener(NAVIGATE_FINISH_EVENT, () => {
    // 別の動画へ移ったときだけ、前の動画の判定を止めてコメント欄を閉じた状態に戻す。
    // 同じ動画の中の遷移（時刻や lc= 付きの URL）では、読んでいる途中の欄を閉じない
    if (navigation.finish(location.href).videoChanged) {
      pendingFocusThread = null;
      queue.reset();
      doc.documentElement.removeAttribute(OPEN_ATTR);
    }
    attach();
    renderBar();
  });

  const flushCache = () => cache.flush();
  window.addEventListener('pagehide', flushCache);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flushCache();
  });

  void lm.init();
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
}
