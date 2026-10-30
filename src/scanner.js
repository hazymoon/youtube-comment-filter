/**
 * @file コメント欄の thread の判定と表示状態の反映。document・LanguageModel・順番待ちに触れず、
 * 渡された thread の要素と注入された依存だけを使う（テストで偽の要素を渡せるようにするため）。
 */

import { countStates, decideState } from './decide.js';
import { extractComment, extractLinkHrefs, isInsideHiddenThread } from './dom.js';
import { hashString } from './hash.js';
import { judgeByRules, judgeExemption } from './rules.js';
import { EXEMPTION_ATTR, EXPANDED_ATTR, HASH_ATTR, ID_ATTR, REASON_ATTR, STATE_ATTR, THREAD_TAG } from './selectors.js';

/** AI が隠したコメントを DEBUG で出すときの本文の文字数の上限。誤判定かを見分けられる程度に短くする */
const AI_HIDDEN_EXCERPT_CHARS = 60;

/**
 * judgeExemption の結果を、EXEMPTION_ATTR に記録する文字列にする。判定から外さないときは空文字。
 * @param {string|null} exemption judgeExemption の結果
 * @returns {string}
 */
function exemptionRecordOf(exemption) {
  return exemption ?? '';
}

/**
 * thread の表示状態の属性を書き換える。変わらない属性には触れない。
 * @param {Element} thread ytd-comment-thread-renderer
 * @param {'shown'|'hidden'|'pending'} state 表示状態
 * @param {string|undefined} reason 理由
 */
export function applyThreadState(thread, state, reason) {
  if (thread.getAttribute(STATE_ATTR) !== state) thread.setAttribute(STATE_ATTR, state);
  if (reason === undefined) {
    if (thread.hasAttribute(REASON_ATTR)) thread.removeAttribute(REASON_ATTR);
  } else if (thread.getAttribute(REASON_ATTR) !== reason) {
    thread.setAttribute(REASON_ATTR, reason);
  }
}

/**
 * thread をいま読んだコメントが、判定したコメント（ID と本文）と同じかを調べる。
 * 属性（data-ycf-id / data-ycf-hash）はスキャンでしか更新しないので、本文が差し替わってから
 * 次のスキャンまでの間は古い値を指す。判定を反映する前は属性ではなく DOM を読み直して比べる。
 * @param {Element} thread ytd-comment-thread-renderer
 * @param {string} id 判定したコメントの ID
 * @param {string} judgedHash 判定した本文のハッシュ
 * @returns {'same'|'text-changed'|'other'} 'text-changed' は同じ ID で本文だけが違う、'other' は別のコメントか読めない
 */
function compareWithJudged(thread, id, judgedHash) {
  let extracted;
  try {
    extracted = extractComment(thread);
  } catch {
    return 'other';
  }
  if ('unreadable' in extracted || extracted.id !== id) return 'other';
  return extracted.textHash === judgedHash ? 'same' : 'text-changed';
}

/**
 * 変化の通知の対象（要素かテキストノード）から、それを含むいちばん内側の thread を返す。
 * @param {any} target MutationRecord の target
 * @returns {Element|null}
 */
function threadOfTarget(target) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  return typeof element?.closest === 'function' ? element.closest(THREAD_TAG) : null;
}

/**
 * @typedef {object} ThreadProcessor
 * @property {(threads: Iterable<Element>) => { id: string, text: string }[]} processThreads
 *   thread を文書順に判定して表示状態を反映し、AI の順番待ちに入れるコメントを返す。
 *   隠したスレッドの中は飛ばし、ID と本文が前回と同じで表示か非表示に確定済みのものも飛ばす。
 *   ID か本文が変わっていたら（Polymer の要素の再利用）全文表示の固定を外して判定し直す。
 *   判定から外すかどうかの結果（judgeExemption）だけが変わったら、全文表示の固定は保ったまま判定し直す。
 *   返す順は文書順で、前に AI の判定が得られなかったコメントは新しいコメントの後に回す
 * @property {(threads: Iterable<Element>, id: string, verdict: { hide: boolean, category: string|null }, item: { id: string, text: string }) => { needsRescan: boolean }} applyVerdict
 *   AI の判定を、判定したコメントと一致する thread に反映する
 * @property {(threads: Iterable<Element>, id: string, item: { id: string, text: string }) => { needsRescan: boolean }} applyPending
 *   AI の判定が得られなかったことを、判定したコメントと一致する thread に反映する
 * @property {(threads: Iterable<Element>) => import('./decide.js').StateCounts & { total: number }} countThreads
 *   件数バーの件数を集計する。total は集計したコメントの数（隠したスレッドの中の返信は数えない）
 * @property {(targets: Iterable<any>) => void} revalidate
 *   変化した要素を含む thread について、表示中のコメントが判定したものと同じかを同期で確かめ、
 *   違えば判定前（CSS で隠れる状態）に戻す。判定から外すかどうかの結果だけが変わったときは、
 *   判定から外して表示していたものが外れなくなった場合だけ判定前に戻し、ほかは次のスキャンに任せる
 * @property {(rules: import('./rules.js').CompiledRules) => void} setRules
 *   ルールを差し替える。表示か非表示に確定済みのコメントも、次の processThreads で新しいルールで判定し直す。
 *   新しいルールに当たらず、状態が AI の判定などルールに依らずに決まっていたものは、その状態を保つ
 */

/**
 * thread の判定と表示状態の反映を作る。
 * @param {object} options
 * @param {import('./rules.js').CompiledRules} options.rules compileRules の結果
 * @param {import('./rules.js').ExemptOptions} [options.exempt] 判定から外す対象。省略時はどれも外さない（許可ユーザは常に外す）
 * @param {{ get: (id: string, textHash: string) => ({ hide: boolean, category: string|null }|null), set: (id: string, textHash: string, verdict: { hide: boolean, category: string|null }) => void }} options.cache
 *   AI の判定のキャッシュ
 * @param {() => import('./decide.js').AiMode} options.getAiMode AI 判定の状態
 * @param {(...args: unknown[]) => void} [options.debugLog] 判定の経過を出す。本文は、AI が隠したコメントの冒頭
 *   （AI_HIDDEN_EXCERPT_CHARS 文字まで）だけを渡す
 * @param {(thread: Element) => void} [options.onShown] AI の判定で表示にした thread を受け取る。
 *   AI の判定はスキャンの外で反映されるため、スキャンで付けるもの（NG 登録のボタン）をここで付ける
 * @returns {ThreadProcessor}
 */
export function createThreadProcessor({
  rules,
  exempt = { owner: false, pinned: false, verified: false },
  cache,
  getAiMode,
  debugLog = () => {},
  onShown = () => {},
}) {
  let currentRules = rules;
  /** ルールを差し替えた回数。thread ごとに、判定したときの rulesVersion を judgedRulesVersion に持つ */
  let rulesVersion = 0;
  /** @type {WeakMap<Element, number>} */
  const judgedRulesVersion = new WeakMap();

  /**
   * AI が隠したコメントのカテゴリと本文の冒頭を出す。隠したコメントを画面で確かめる手段が無いので、
   * AI の誤判定を利用者が確かめられるようにするため（DEBUG のときだけ出る。保存はしない）。
   * @param {string|null} category カテゴリ
   * @param {string} text 本文
   */
  function logAiHidden(category, text) {
    const chars = [...text];
    const excerpt =
      chars.length > AI_HIDDEN_EXCERPT_CHARS ? `${chars.slice(0, AI_HIDDEN_EXCERPT_CHARS).join('')}…` : text;
    debugLog('AI が隠したコメント', category, excerpt);
  }

  /**
   * 確定済みの thread の状態が、ルールにも判定から外す条件にも依らずに決まったものか
   * （表示で理由が無い、または AI の判定で非表示）。ルールで隠していたものと判定から外していたものは、
   * 新しいルールで外れたら AI の判定が要るので含めない。
   * @param {Element} thread ytd-comment-thread-renderer
   * @returns {boolean}
   */
  function keepsVerdictWithoutRules(thread) {
    const state = thread.getAttribute(STATE_ATTR);
    const reason = thread.getAttribute(REASON_ATTR);
    return (state === 'shown' && reason === null) || (state === 'hidden' && reason === 'ai');
  }

  /**
   * 1 つの thread を判定して表示状態を反映する。順番待ちに入れるものは fresh か retries に積む。
   * @param {Element} thread ytd-comment-thread-renderer
   * @param {import('./decide.js').AiMode} aiMode AI 判定の状態
   * @param {{ id: string, text: string }[]} fresh 新しく判定するもの
   * @param {{ id: string, text: string }[]} retries 前に AI の判定が得られなかったもの
   */
  function processOne(thread, aiMode, fresh, retries) {
    if (isInsideHiddenThread(thread)) return;
    const extracted = extractComment(thread);
    if ('unreadable' in extracted) {
      if (thread.hasAttribute(ID_ATTR)) {
        thread.removeAttribute(ID_ATTR);
        thread.removeAttribute(HASH_ATTR);
        thread.removeAttribute(EXEMPTION_ATTR);
        thread.removeAttribute(EXPANDED_ATTR);
      }
      if (thread.getAttribute(REASON_ATTR) !== 'unreadable') debugLog('読めないコメント', extracted.unreadable);
      applyThreadState(thread, 'pending', 'unreadable');
      return;
    }

    const prevState = thread.getAttribute(STATE_ATTR);
    const same = thread.getAttribute(ID_ATTR) === extracted.id && thread.getAttribute(HASH_ATTR) === extracted.textHash;
    const settled = same && (prevState === 'shown' || prevState === 'hidden');
    // 判定から外す条件のデータは本文より遅れて届きうる。判定から外すかどうかの結果が変わったら確定済みでも
    // 判定し直す（settled は変えないので、判定から外れなかったものは下の keepsVerdictWithoutRules の経路で AI の判定を保つ）。
    // 条件のデータではなく結果を比べ、設定で外していない条件や結果を変えない変化では判定し直さない
    const exemption = judgeExemption(extracted, currentRules, exempt);
    const exemptionRecord = exemptionRecordOf(exemption);
    const exemptionChanged = thread.getAttribute(EXEMPTION_ATTR) !== exemptionRecord;
    if (settled && !exemptionChanged && judgedRulesVersion.get(thread) === rulesVersion) return;
    if (exemptionChanged) thread.setAttribute(EXEMPTION_ATTR, exemptionRecord);
    if (!same) {
      thread.setAttribute(ID_ATTR, extracted.id);
      thread.setAttribute(HASH_ATTR, extracted.textHash);
      thread.removeAttribute(EXPANDED_ATTR);
      // 投稿者を読めないと NG ユーザが効かない（表示のまま通る）。工程 3 で取得元の変化に気づけるよう記録する
      if (extracted.author.handle === null && extracted.author.channelId === null) {
        debugLog('投稿者を読めないコメント', extracted.id);
      }
    }
    const aiUnresolved = same && thread.getAttribute(REASON_ATTR) === 'ai-unresolved';

    /** @type {ReturnType<typeof judgeByRules>} */
    const ruleResult =
      exemption === null
        ? judgeByRules(
            // リンクの判定を使わないときは、本文のリンクを読まない（DOM の走査を増やさないため）
            currentRules.linkFilterEnabled ? { ...extracted, linkHrefs: extractLinkHrefs(thread) } : extracted,
            currentRules,
          )
        : { reason: null };
    if (settled && exemption === null && ruleResult.reason === null && keepsVerdictWithoutRules(thread)) {
      // ルールの差し替えで判定し直したが、新しいルールにも当たらない。AI の判定（表示・非表示）はルールに依らないので
      // そのまま保つ。キャッシュから消えていると判定待ちに戻って隠れ、AI に送り直すことになるため
      judgedRulesVersion.set(thread, rulesVersion);
      return;
    }
    const needsCache =
      exemption === null &&
      ruleResult.reason === null &&
      extracted.text !== '' &&
      aiMode !== 'disabled' &&
      aiMode !== 'failed';
    const cached = needsCache ? cache.get(extracted.id, extracted.textHash) : null;
    const decision = decideState({ extracted, ruleResult, aiMode, cached, aiUnresolved, exempt: exemption !== null });
    applyThreadState(thread, decision.state, decision.reason);
    judgedRulesVersion.set(thread, rulesVersion);
    if (decision.state !== 'pending' || !same) {
      debugLog('判定', extracted.id, decision.state, decision.reason ?? '', exemption ?? ruleResult.detail ?? '');
    }
    if (decision.state === 'hidden' && decision.reason === 'ai') logAiHidden(cached?.category ?? null, extracted.text);
    if (decision.enqueue) {
      (aiUnresolved ? retries : fresh).push({ id: extracted.id, text: extracted.text });
    }
  }

  return {
    processThreads(threads) {
      const aiMode = getAiMode();
      /** @type {{ id: string, text: string }[]} */
      const fresh = [];
      /** @type {{ id: string, text: string }[]} */
      const retries = [];

      for (const thread of threads) {
        try {
          processOne(thread, aiMode, fresh, retries);
        } catch (error) {
          // 1 件の失敗で残りの thread が判定前のまま残らないよう、その thread だけ判定待ちにして続ける
          debugLog('判定中の例外', error);
          applyThreadState(thread, 'pending', 'unreadable');
        }
      }
      return [...fresh, ...retries];
    },

    applyVerdict(threads, id, verdict, item) {
      const judgedHash = hashString(item.text);
      let needsRescan = false;
      let textChanged = false;
      for (const thread of threads) {
        if (thread.getAttribute(ID_ATTR) !== id) continue;
        const comparison = compareWithJudged(thread, id, judgedHash);
        if (comparison !== 'same') {
          // 判定中に本文が変わったか、要素が別のコメントに使い回された。いまの本文はスキャンで判定し直す
          needsRescan = true;
          if (comparison === 'text-changed') textChanged = true;
          continue;
        }
        if (thread.getAttribute(STATE_ATTR) !== 'pending') continue;
        if (verdict.hide) applyThreadState(thread, 'hidden', 'ai');
        else {
          applyThreadState(thread, 'shown', undefined);
          onShown(thread);
        }
        debugLog('AI の判定', id, verdict.hide ? `hidden(${verdict.category})` : 'shown');
        if (verdict.hide) logAiHidden(verdict.category, item.text);
      }
      // 本文が変わったコメントの判定は保存しない（ID ごとの保存枠を古い本文の判定で埋めないため）。
      // 該当する thread が DOM に無いときは保存する（本文のハッシュと組で保存するので取り違えない）
      if (!textChanged) cache.set(id, judgedHash, verdict);
      return { needsRescan };
    },

    applyPending(threads, id, item) {
      const judgedHash = hashString(item.text);
      let needsRescan = false;
      for (const thread of threads) {
        if (thread.getAttribute(ID_ATTR) !== id) continue;
        if (compareWithJudged(thread, id, judgedHash) !== 'same') {
          // 順番待ちは ID で重複を除くので、判定中に変わった本文は入れ直されていない。スキャンで入れ直す
          needsRescan = true;
          continue;
        }
        if (thread.getAttribute(STATE_ATTR) !== 'pending') continue;
        applyThreadState(thread, 'pending', 'ai-unresolved');
        debugLog('AI の判定待ち', id);
      }
      return { needsRescan };
    },

    setRules(rules) {
      currentRules = rules;
      rulesVersion += 1;
    },

    countThreads(threads) {
      const records = [];
      for (const thread of threads) {
        if (isInsideHiddenThread(thread)) continue;
        const state = thread.getAttribute(STATE_ATTR);
        // 状態の属性がまだ無い thread（判定前・判定前に戻したもの）は CSS で隠れているので、判定中に数える
        if (state === null) records.push({ state: 'pending', reason: 'awaiting-ai' });
        else records.push({ state, reason: thread.getAttribute(REASON_ATTR) });
      }
      return { ...countStates(records), total: records.length };
    },

    revalidate(targets) {
      /** @type {Set<Element>} */
      const seen = new Set();
      /** @type {Element[]} */
      const candidates = [];
      for (const target of targets) {
        const thread = threadOfTarget(target);
        if (thread) candidates.push(thread);
        // 入れ物ごと差し込まれたとき、通知の target は thread の外なので、中の thread も確かめる
        if (target?.nodeType === 1 && typeof target.querySelectorAll === 'function') {
          candidates.push(...target.querySelectorAll(THREAD_TAG));
        }
      }
      for (const thread of candidates) {
        if (seen.has(thread)) continue;
        seen.add(thread);
        if (thread.getAttribute(STATE_ATTR) === null) continue;
        let extracted;
        try {
          extracted = extractComment(thread);
        } catch {
          extracted = { unreadable: '例外' };
        }
        if ('unreadable' in extracted) {
          if (thread.getAttribute(REASON_ATTR) === 'unreadable') continue;
        } else if (
          thread.getAttribute(ID_ATTR) === extracted.id &&
          thread.getAttribute(HASH_ATTR) === extracted.textHash
        ) {
          const exemptionRecord = exemptionRecordOf(judgeExemption(extracted, currentRules, exempt));
          if (thread.getAttribute(EXEMPTION_ATTR) === exemptionRecord) continue;
          // 判定から外すかどうかの結果だけが変わった。判定から外して表示していたものが外れなくなったときだけ、
          // 判定していない本文が見えたままにならないよう判定前に戻す。ほかは状態を保ち、次のスキャンが
          // 属性の違いを見て判定し直す（AI の判定を保つため。判定前に戻すと AI に送り直しうる）。
          // 本文は同じなので全文表示の固定と data-ycf-id / data-ycf-hash は残す
          const exemptedNow =
            thread.getAttribute(STATE_ATTR) === 'shown' && thread.getAttribute(REASON_ATTR) === 'exempt';
          if (!exemptedNow || exemptionRecord !== '') continue;
          thread.removeAttribute(STATE_ATTR);
          thread.removeAttribute(REASON_ATTR);
          debugLog('判定から外す条件が外れたので判定前に戻す', extracted.id);
          continue;
        }
        // 判定していないコメントが描画されないよう、次のスキャンを待たずに判定前に戻す。
        // data-ycf-id / data-ycf-hash は残し、スキャンが変化を見て判定し直す
        thread.removeAttribute(STATE_ATTR);
        thread.removeAttribute(REASON_ATTR);
        thread.removeAttribute(EXPANDED_ATTR);
        debugLog('表示中のコメントが変わったので判定前に戻す', thread.getAttribute(ID_ATTR) ?? '');
      }
    },
  };
}
