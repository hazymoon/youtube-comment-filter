/**
 * @file LanguageModel（Chrome の Prompt API）との接続。基底セッションを 1 つ作り、判定ごとに clone させる。
 */

import { buildInitialPrompts } from './ai.js';

/**
 * availability() と create() に同じものを渡す（片方だけに付けると結果が食い違いうる。docs/review-findings.md）。
 */
const LM_LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
};

/**
 * page 世界の LanguageModel を返す。無ければ undefined。
 * @returns {any}
 */
function defaultLanguageModel() {
  return typeof LanguageModel === 'undefined' ? undefined : LanguageModel;
}

/**
 * @typedef {object} LanguageModelController
 * @property {() => import('./decide.js').AiState} getState 現在の状態
 * @property {() => Promise<void>} init availability() を確かめ、使えるなら基底セッションの作成を始める
 * @property {() => void} activate ユーザー操作を起点に基底セッションの作成を始める。クリックハンドラの同期区間で最初に呼ぶ
 * @property {() => Promise<any>} cloneSession 基底セッションの準備を待って clone する。作成に失敗していれば reject する
 * @property {(error: unknown) => void} markFailed 推論でタイムアウト以外のエラーが起きたことを記録する
 * @property {() => void} destroy 基底セッションを破棄する
 */

/**
 * LanguageModel との接続を作る。
 *
 * - AI_ENABLED が false か LanguageModel が無ければ 'disabled'
 * - availability() が 'available' なら、ユーザー操作なしでそのまま作成する（'initializing' → 'ready'）
 * - 'downloadable' / 'downloading' なら、ダウンロードにユーザー操作が要るので 'needs-activation' にして activate() を待つ
 * - 'unavailable' なら 'disabled'、availability() の例外や作成の失敗は 'failed'
 *
 * 基底セッションは SPA の遷移をまたいで使い回す（作成にモデルの読み込み分の時間がかかるため。docs/spike.md）。
 *
 * @param {object} options
 * @param {{ name: string, description: string }[]} options.categories AI_CATEGORIES
 * @param {boolean} options.enabled AI_ENABLED
 * @param {(state: import('./decide.js').AiState) => void} options.onStateChange 状態が変わった
 * @param {() => any} [options.getLanguageModel] LanguageModel を返す（テストで差し替える）
 * @returns {LanguageModelController}
 */
export function createLanguageModelController({ categories, enabled, onStateChange, getLanguageModel = defaultLanguageModel }) {
  /** @type {import('./decide.js').AiState} */
  let state = { mode: 'initializing', progress: null };
  /** @type {Promise<any>|null} */
  let createPromise = null;
  /** @type {any} */
  let baseSession = null;
  let availabilityPending = false;

  /** @type {(session: any) => void} */
  let resolveReady = () => {};
  /** @type {(error: unknown) => void} */
  let rejectReady = () => {};
  /** 基底セッションの準備。作成の成否が決まるまで待たせる */
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // cloneSession が呼ばれないまま失敗しても未処理の reject にしない
  ready.catch(() => {});

  /**
   * 状態を変えて知らせる。
   * @param {import('./decide.js').AiState} next 次の状態
   */
  function setState(next) {
    state = next;
    onStateChange(state);
  }

  /**
   * AI を使わない状態にする。
   * @param {'config'|'unsupported'|'unavailable'} reason 理由
   */
  function disable(reason) {
    setState({ mode: 'disabled', disabledReason: reason });
    rejectReady(new Error(`LanguageModel を使いません（${reason}）`));
  }

  /**
   * 基底セッションの作成を始める。await を挟まずに create を呼ぶ（クリックのユーザー操作を失わないため）。
   * @param {any} languageModel LanguageModel
   */
  function startCreate(languageModel) {
    if (createPromise) return;
    setState({ mode: 'initializing', progress: null });
    try {
      createPromise = Promise.resolve(
        languageModel.create({
          ...LM_LANGUAGE_OPTIONS,
          initialPrompts: buildInitialPrompts(categories),
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              if (state.mode !== 'initializing') return;
              const loaded = Number(event?.loaded);
              // ダウンロード済みでも 0 → 1 が即時に届くので、1 に達したら進み具合を消す（docs/spike.md）
              setState({ mode: 'initializing', progress: Number.isFinite(loaded) && loaded < 1 ? loaded : null });
            });
          },
        }),
      );
    } catch (error) {
      createPromise = Promise.reject(error);
    }
    createPromise.then(
      (session) => {
        baseSession = session;
        if (state.mode === 'initializing') setState({ mode: 'ready' });
        resolveReady(session);
      },
      (error) => {
        if (state.mode !== 'disabled') setState({ mode: 'failed' });
        rejectReady(error);
      },
    );
  }

  return {
    getState() {
      return state;
    },

    async init() {
      if (!enabled) {
        disable('config');
        return;
      }
      const languageModel = getLanguageModel();
      if (!languageModel || typeof languageModel.availability !== 'function') {
        disable('unsupported');
        return;
      }
      setState({ mode: 'initializing', progress: null });
      let availability;
      availabilityPending = true;
      try {
        availability = await languageModel.availability(LM_LANGUAGE_OPTIONS);
      } catch (error) {
        availabilityPending = false;
        if (!createPromise) {
          setState({ mode: 'failed' });
          rejectReady(error);
        }
        return;
      }
      availabilityPending = false;
      if (createPromise) {
        // activate() が先に作成を始めた。使えない環境なら作成の失敗より「使えない」を優先して示す
        if (availability === 'unavailable') disable('unavailable');
        return;
      }
      if (availability === 'available') {
        startCreate(languageModel);
      } else if (availability === 'downloadable' || availability === 'downloading') {
        setState({ mode: 'needs-activation' });
      } else {
        disable('unavailable');
      }
    },

    activate() {
      if (createPromise) return;
      // availability() の結果を待っている間に押されたときも、ユーザー操作を逃さないようここで作成を始める
      if (state.mode !== 'needs-activation' && !(state.mode === 'initializing' && availabilityPending)) return;
      const languageModel = getLanguageModel();
      if (!languageModel) return;
      startCreate(languageModel);
    },

    async cloneSession() {
      const session = await ready;
      return session.clone();
    },

    markFailed() {
      if (state.mode !== 'disabled' && state.mode !== 'failed') setState({ mode: 'failed' });
    },

    destroy() {
      try {
        baseSession?.destroy();
      } catch {
        // 破棄の失敗は無視する（ページを離れるときにしか呼ばない）
      }
      baseSession = null;
    },
  };
}
