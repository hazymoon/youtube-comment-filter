// 工程 1 の spike: YouTube の動画ページで Prompt API (LanguageModel) と
// コメント欄の DOM を実測し、結果を 1 つの JSON にまとめる。工程 2 の本体コードではない。
//
// 注入方式: このファイルは @inject-into を指定しない（Violentmonkey の既定 = auto）。
// page で再確認するときは、メタデータブロックに `// @inject-into page` の行を足して有効にする。
// 同じ内容に page 指定を入れたものが lm-spike-page.user.js で、@name を変えてあるので
// 両方を同時にインストールしても区別できる。ただし両方が同時に動くとパネルが重なり、
// LanguageModel の計測も互いに干渉するので、ダッシュボードで片方ずつ有効化して使う。
//
// 外部へのネットワーク送信は一切しない（モデルのダウンロードはブラウザ自身が行う）。
// コメント本文は記録しない。ID・ハンドルは先頭数文字以外を伏せる。

// ==UserScript==
// @name        YCF LM Spike (default inject)
// @namespace   https://github.com/hazymoon/youtube-comment-filter/spike
// @version     0.3.0
// @description Prompt API と YouTube コメント DOM の計測 spike（既定の注入方式）
// @match       https://www.youtube.com/*
// @grant       GM_info
// @grant       GM_setValue
// @grant       GM_getValue
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const PROMPT_TIMEOUT_MS = 60000;
  // availability / clone の待ち時間の上限。create はモデルのダウンロードを含みうるので長めにする
  const STEP_TIMEOUT_MS = 30000;
  const CREATE_TIMEOUT_MS = 600000;
  const CATEGORIES = ['人格攻撃・侮辱', '差別・ヘイト', '煽り・挑発', '暴言'];
  const LM_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['ja'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  };
  const SYSTEM_PROMPT = [
    'あなたは YouTube のコメントを判定するモデレーターです。',
    '入力は {"id": 文字列, "text": コメント本文} の配列です。',
    '各コメントについて、次のいずれかに当たるなら hide を true にし、category に該当するものを 1 つ入れてください。',
    '当たらないなら hide を false、category を null にしてください。',
    'カテゴリ: 人格攻撃・侮辱 / 差別・ヘイト / 煽り・挑発 / 暴言',
    '批判的でも内容に対する意見であれば hide は false です。',
    '出力は入力と同じ id を同じ順に並べた JSON 配列だけにしてください。',
  ].join('\n');

  // 架空のコメント（実在の人物・団体名を含めない）。c0..c6 は穏当、c7..c9 は不快なもの
  const COMMENTS = [
    { id: 'c0', text: '解説がとても分かりやすかったです。続きも楽しみにしています。' },
    { id: 'c1', text: '3:20 あたりの手順、自分の環境でも試したらうまくいきました。' },
    { id: 'c2', text: '音量が少し小さめに感じました。次回は上げてもらえると助かります。' },
    { id: 'c3', text: '前回の動画と比べると説明が駆け足だった気がします。' },
    { id: 'c4', text: 'BGM の選曲が好きです。何という曲ですか？' },
    { id: 'c5', text: '休日にのんびり見るのにちょうどいい長さでした。' },
    { id: 'c6', text: 'この方法には反対です。安全面の説明がもう少し欲しかった。' },
    { id: 'c7', text: 'お前みたいな頭の悪いやつは一生黙ってろ。' },
    { id: 'c8', text: 'こんな動画で喜んでる連中、ほんと程度が低いな。悔しかったら反論してみろよ。' },
    { id: 'c9', text: '消えろ。二度とコメントするな、ゴミが。' },
  ];

  // 計測段のスキーマ（task 指定どおり: top-level array、category は type 配列 + enum に null を含む）
  const SCHEMA_TYPE_ARRAY = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        hide: { type: 'boolean' },
        category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
      },
      required: ['id', 'hide', 'category'],
      additionalProperties: false,
    },
  };
  // 計測段の後に別段で試す代替表記（anyOf）
  const SCHEMA_ANY_OF = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        hide: { type: 'boolean' },
        category: { anyOf: [{ type: 'string', enum: CATEGORIES }, { type: 'null' }] },
      },
      required: ['id', 'hide', 'category'],
      additionalProperties: false,
    },
  };

  // ---------- 小物 ----------

  const errInfo = (e) => {
    if (e == null) return { name: null, message: String(e) };
    return { name: e.name || typeof e, message: e.message || String(e) };
  };
  const round = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);
  const median = (xs) => {
    const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
  };
  const safeTypeof = (fn) => {
    try {
      return fn();
    } catch (e) {
      return 'error:' + errInfo(e).name;
    }
  };
  const mask = (s, keep) => {
    if (typeof s !== 'string') return s;
    if (s.length <= keep) return s.slice(0, 1) + '***';
    return s.slice(0, keep) + '***(len=' + s.length + ')';
  };
  const userActivation = () => {
    const ua = navigator.userActivation;
    return ua ? { isActive: ua.isActive, hasBeenActive: ua.hasBeenActive } : null;
  };
  const buildInput = (items) =>
    '次のコメントを判定してください。\n' + JSON.stringify(items.map((c) => ({ id: c.id, text: c.text })));

  const getUnsafeWindow = () => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : undefined);

  // 返らない Promise で計測全体が止まらないよう、上限時間で TimeoutError にする
  const withTimeout = (promise, ms, label) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DOMException(label + ' timeout ' + ms + 'ms', 'TimeoutError')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  // ---------- パネル（Trusted Types のため createElement + textContent のみ） ----------

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    zIndex: '2147483647',
    width: '420px',
    maxWidth: 'calc(100vw - 24px)',
    background: '#111',
    color: '#eee',
    font: '12px/1.4 monospace',
    border: '1px solid #555',
    borderRadius: '6px',
    padding: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,.5)',
  });
  const title = document.createElement('div');
  title.textContent = 'YCF LM Spike';
  title.style.fontWeight = 'bold';
  const buttons = document.createElement('div');
  buttons.style.margin = '6px 0';
  const runBtn = document.createElement('button');
  runBtn.textContent = '計測開始';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'JSON をコピー';
  copyBtn.style.marginLeft = '6px';
  const status = document.createElement('div');
  status.style.whiteSpace = 'pre-wrap';
  status.textContent = '待機中';
  const pre = document.createElement('pre');
  Object.assign(pre.style, {
    maxHeight: '40vh',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    userSelect: 'text',
    background: '#000',
    padding: '4px',
    margin: '6px 0 0',
  });
  buttons.append(runBtn, copyBtn);
  panel.append(title, buttons, status, pre);
  (document.body || document.documentElement).append(panel);

  const setStatus = (s) => {
    status.textContent = s;
  };

  // ---------- 隠し方テスト ----------
  // コメント欄を読み込み前から隠したとき、YouTube がコメントを取りに行くかを隠し方ごとに観測する。
  // 隠し方は GM_setValue に保存して再読み込みし、ページ表示の直後から適用する。

  const HIDE_MODE_KEY = 'ycf_spike_hide_mode';
  const HIDE_TARGET = 'ytd-comments#comments';
  const HIDE_CSS = {
    none: '',
    display: HIDE_TARGET + '{display:none !important}',
    visibility: HIDE_TARGET + '{visibility:hidden !important}',
    opacity: HIDE_TARGET + '{opacity:0 !important}',
  };
  const HIDE_SAMPLE_MS = 1000;
  const HIDE_SAMPLE_LIMIT_MS = 180000;

  const readHideMode = () => {
    try {
      const v = GM_getValue(HIDE_MODE_KEY, 'none');
      return Object.hasOwn(HIDE_CSS, v) ? v : 'none';
    } catch (e) {
      return 'none';
    }
  };
  const hideTest = {
    mode: readHideMode(),
    pageStartedAt: new Date().toISOString(),
    url: location.pathname,
    targetMatchedAt: null,
    timeline: [],
    unhide: null,
  };
  const hideStyle = document.createElement('style');
  hideStyle.textContent = HIDE_CSS[hideTest.mode];
  (document.head || document.documentElement).append(hideStyle);

  const sampleComments = () => {
    const target = document.querySelector(HIDE_TARGET);
    return {
      threads: document.querySelectorAll('ytd-comment-thread-renderer').length,
      viewModels: document.querySelectorAll('ytd-comment-view-model').length,
      continuation: document.querySelectorAll(HIDE_TARGET + ' ytd-continuation-item-renderer').length,
      targetHeight: target ? Math.round(target.getBoundingClientRect().height) : null,
    };
  };
  // 変化があったときだけ記録して JSON を小さく保つ
  const recordSample = (list, t0, force) => {
    const s = sampleComments();
    const last = list[list.length - 1];
    const changed = !last || ['threads', 'viewModels', 'continuation', 'targetHeight'].some((k) => last[k] !== s[k]);
    if (changed || force) list.push({ atMs: Math.round(performance.now() - t0), scrollY: Math.round(scrollY), ...s });
  };
  const hideT0 = performance.now();
  const hideTimer = setInterval(() => {
    if (!hideTest.targetMatchedAt && document.querySelector(HIDE_TARGET)) {
      hideTest.targetMatchedAt = Math.round(performance.now() - hideT0);
    }
    recordSample(hideTest.timeline, hideT0, false);
    if (performance.now() - hideT0 > HIDE_SAMPLE_LIMIT_MS) clearInterval(hideTimer);
  }, HIDE_SAMPLE_MS);

  const hideRow = document.createElement('div');
  hideRow.style.margin = '6px 0';
  const hideLabel = document.createElement('span');
  hideLabel.textContent = '隠し方テスト: ';
  const hideSelect = document.createElement('select');
  for (const m of Object.keys(HIDE_CSS)) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    hideSelect.append(o);
  }
  hideSelect.value = hideTest.mode;
  const hideApplyBtn = document.createElement('button');
  hideApplyBtn.textContent = '設定して再読み込み';
  hideApplyBtn.style.marginLeft = '4px';
  const hideUnhideBtn = document.createElement('button');
  hideUnhideBtn.textContent = '解除して観測';
  hideUnhideBtn.style.marginLeft = '4px';
  const hideReportBtn = document.createElement('button');
  hideReportBtn.textContent = '隠し方の結果を出す';
  hideReportBtn.style.marginLeft = '4px';
  hideRow.append(hideLabel, hideSelect, hideApplyBtn, hideUnhideBtn, hideReportBtn);
  buttons.after(hideRow);
  if (hideTest.mode !== 'none') status.textContent = '隠し方テスト中: ' + hideTest.mode + '（終わったら none に戻す）';

  hideApplyBtn.addEventListener('click', () => {
    try {
      GM_setValue(HIDE_MODE_KEY, hideSelect.value);
      location.reload();
    } catch (e) {
      status.textContent = '隠し方の保存に失敗: ' + errInfo(e).name;
    }
  });

  // 隠すのをやめた後に、まとめて読み込みが始まるかを 15 秒観測する
  hideUnhideBtn.addEventListener('click', () => {
    if (hideTest.unhide) return;
    const t0 = performance.now();
    hideTest.unhide = { atPageMs: Math.round(t0 - hideT0), timeline: [] };
    recordSample(hideTest.unhide.timeline, t0, true);
    hideStyle.textContent = '';
    const timer = setInterval(() => {
      recordSample(hideTest.unhide.timeline, t0, false);
      if (performance.now() - t0 > 15000) {
        clearInterval(timer);
        recordSample(hideTest.unhide.timeline, t0, true);
        status.textContent = '解除後の観測が終わりました。「隠し方の結果を出す」を押してください';
      }
    }, HIDE_SAMPLE_MS);
    status.textContent = '解除後の読み込みを 15 秒観測中';
  });

  hideReportBtn.addEventListener('click', () => {
    recordSample(hideTest.timeline, hideT0, true);
    const json = JSON.stringify({ hideTest }, null, 2);
    console.log('[YCF LM Spike hideTest JSON]\n' + json);
    pre.textContent = json;
    status.textContent = '隠し方 ' + hideTest.mode + ' の結果（「JSON をコピー」で取れます）';
  });

  // ---------- 骨格ダンプ ----------
  // 工程 2 のセレクタを決めるため、コメント欄の要素構造（タグ名・id・class・属性の形式）だけを出す。
  // テキストは長さだけ、href はパスの形式とクエリのキー名だけ、aria-label / title は長さだけを記録する。

  const SKELETON_NODE_LIMIT = 4000;
  const SKELETON_ATTRS = ['role', 'hidden', 'collapsed', 'is-empty', 'slot', 'is-dismissed', 'expanded', 'disabled', 'tabindex'];

  const hrefForm = (href) => {
    if (typeof href !== 'string') return href;
    try {
      const u = new URL(href, location.origin);
      let path = u.pathname
        .replace(/^\/@[^/]+/, '/@***')
        .replace(/^\/channel\/UC[^/]+/, '/channel/UC***')
        .replace(/^\/shorts\/[^/]+/, '/shorts/***');
      const keys = [...u.searchParams.keys()];
      return (u.origin === location.origin ? '' : u.origin) + path + (keys.length ? '?' + keys.join('&') : '') + (u.hash ? '#…' : '');
    } catch (e) {
      return 'unparsable';
    }
  };

  const styleHints = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of ['display', 'visibility', 'overflow', 'max-height', '-webkit-line-clamp', 'line-height', 'white-space']) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'normal' && v !== 'visible' && v !== 'auto') out[p] = v;
    }
    return out;
  };

  function skeleton(root, maxDepth) {
    let count = 0;
    const walk = (node, depth) => {
      if (count >= SKELETON_NODE_LIMIT) return { truncated: true };
      count++;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent.trim().length;
        return len ? { text: len } : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const el = node;
      const o = { t: el.tagName.toLowerCase() };
      if (el.id) o.id = el.id;
      if (el.classList.length) o.cls = [...el.classList].slice(0, 6).join(' ');
      for (const a of SKELETON_ATTRS) if (el.hasAttribute(a)) (o.attrs ||= {})[a] = el.getAttribute(a) || '';
      if (el.hasAttribute('href')) o.href = hrefForm(el.getAttribute('href'));
      for (const a of ['aria-label', 'title']) if (el.hasAttribute(a)) (o.attrs ||= {})[a] = 'len=' + el.getAttribute(a).length;
      if (el.id === 'content-text' || /expander|truncat|more|less|content/i.test(el.id + ' ' + el.className)) o.style = styleHints(el);
      if (getComputedStyle(el).display === 'none') o.hiddenByCss = true;
      if (depth >= maxDepth) {
        if (el.childElementCount) o.children = '…' + el.childElementCount;
        return o;
      }
      const kids = [...el.childNodes].map((c) => walk(c, depth + 1)).filter(Boolean);
      if (kids.length) o.children = kids;
      return o;
    };
    const tree = walk(root, 0);
    return { nodes: count, truncated: count >= SKELETON_NODE_LIMIT, tree };
  }

  const startsWithMention = (vm) => {
    const body = vm.querySelector('#content-text');
    return !!body && body.textContent.trim().startsWith('@');
  };

  function dumpSkeleton() {
    const comments = document.querySelector('ytd-comments#comments');
    if (!comments) return { error: 'ytd-comments#comments が無い' };
    const threads = [...comments.querySelectorAll('ytd-comment-thread-renderer')];
    const replyCount = (t) => t.querySelectorAll('ytd-comment-replies-renderer ytd-comment-view-model').length;
    // 返信を展開済みで @ 返信を含むスレッドを優先し、無ければ返信を展開済みのもの
    const withMentionReply = threads.find((t) => [...t.querySelectorAll('ytd-comment-replies-renderer ytd-comment-view-model')].some(startsWithMention));
    const withReplies = withMentionReply || threads.find((t) => replyCount(t) > 0);
    const withRepliesButton = threads.find((t) => t.querySelector('ytd-comment-replies-renderer') && replyCount(t) === 0);
    const longest = threads
      .map((t) => ({ t, len: (t.querySelector('#content-text')?.textContent || '').length }))
      .sort((a, b) => b.len - a.len)[0];
    return {
      threadCount: threads.length,
      commentsTop: skeleton(comments, 5),
      threadWithReplies: withReplies
        ? { hasMentionReply: !!withMentionReply, replies: replyCount(withReplies), skeleton: skeleton(withReplies, 40) }
        : '返信を展開したスレッドが無い',
      threadWithCollapsedReplies: withRepliesButton ? skeleton(withRepliesButton, 40) : '返信が未展開のスレッドが無い',
      longestThread: longest && longest.t !== withReplies ? { textLen: longest.len, skeleton: skeleton(longest.t, 40) } : '（返信付きスレッドと同じ）',
    };
  }

  const skeletonBtn = document.createElement('button');
  skeletonBtn.textContent = '骨格を出す';
  skeletonBtn.style.marginLeft = '6px';
  buttons.append(skeletonBtn);
  skeletonBtn.addEventListener('click', () => {
    try {
      const json = JSON.stringify({ skeleton: dumpSkeleton() });
      console.log('[YCF LM Spike skeleton JSON]\n' + json);
      pre.textContent = json;
      setStatus('骨格を出しました（' + json.length + ' 文字。「JSON をコピー」で取れます）');
    } catch (e) {
      setStatus('骨格の取得に失敗: ' + errInfo(e).name + ' ' + errInfo(e).message);
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent);
      setStatus('コピーしました');
    } catch (e) {
      setStatus('コピー失敗（<pre> を選択して手動でコピーしてください）: ' + errInfo(e).name);
    }
  });

  // ---------- prompt の計測 ----------

  function checkIds(parsed, items) {
    if (!Array.isArray(parsed)) return { isArray: false };
    const want = new Set(items.map((c) => c.id));
    const got = parsed.map((r) => (r && typeof r === 'object' ? r.id : undefined));
    const seen = new Set();
    let duplicates = 0;
    for (const id of got) {
      if (seen.has(id)) duplicates++;
      seen.add(id);
    }
    return {
      isArray: true,
      length: parsed.length,
      missing: [...want].filter((id) => !seen.has(id)),
      extra: [...seen].filter((id) => !want.has(id)),
      duplicates,
      exactMatch: duplicates === 0 && seen.size === want.size && [...want].every((id) => seen.has(id)),
    };
  }

  async function timedPrompt(session, items, opts, timeoutMs) {
    const ms = timeoutMs || PROMPT_TIMEOUT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new DOMException('timeout ' + ms + 'ms', 'TimeoutError')), ms);
    const t0 = performance.now();
    const rec = {};
    try {
      const text = await session.prompt(buildInput(items), { ...opts, signal: ac.signal });
      rec.ms = round(performance.now() - t0);
      rec.response = text;
      try {
        const parsed = JSON.parse(text);
        rec.parseOk = true;
        rec.ids = checkIds(parsed, items);
      } catch (e) {
        rec.parseOk = false;
        rec.parseError = errInfo(e);
      }
    } catch (e) {
      rec.ms = round(performance.now() - t0);
      rec.error = errInfo(e);
    } finally {
      clearTimeout(timer);
    }
    return rec;
  }

  // base を clone して 1 回 prompt し、clone は必ず destroy する（履歴を持ち越さない）
  async function promptOnClone(base, items, opts, timeoutMs) {
    const t0 = performance.now();
    let clone;
    try {
      clone = await withTimeout(base.clone(), STEP_TIMEOUT_MS, 'clone');
    } catch (e) {
      return { cloneError: errInfo(e) };
    }
    const cloneMs = round(performance.now() - t0);
    const rec = await timedPrompt(clone, items, opts, timeoutMs);
    rec.cloneMs = cloneMs;
    rec.contextUsageAfter = safeTypeof(() => clone.contextUsage);
    try {
      clone.destroy();
    } catch (e) {
      rec.destroyError = errInfo(e);
    }
    return rec;
  }

  // ---------- DOM 調査 ----------

  const DOM_CANDIDATES = [
    'ytd-comments',
    'ytd-comments#comments',
    'ytd-item-section-renderer#sections',
    'ytd-comment-thread-renderer',
    'ytd-comment-view-model',
    'ytd-comment-renderer',
    'ytd-comment-replies-renderer',
    'ytd-continuation-item-renderer',
    'ytd-comments-header-renderer',
  ];
  const PROBE_PROPS = [
    'data',
    '__data',
    'polymerController',
    'controllerProxy',
    'inst',
    '__dataHost',
    'hostElement',
    'is',
  ];
  const UC_RE = /^UC[0-9A-Za-z_-]{10,}$/;

  // data 内を再帰探索し、commentId / UC で始まる browseId / @handle らしき値のキーパスだけを返す
  function searchIds(root, maxDepth) {
    const found = { commentId: [], browseIdUC: [], handle: [], authorTextKeys: [] };
    const seen = new WeakSet();
    let visited = 0;
    const LIMIT = 30000;
    const push = (list, path, value) => {
      if (list.length < 10) list.push({ path, value });
    };
    const walk = (obj, path, depth) => {
      if (obj == null || typeof obj !== 'object' || depth > maxDepth || visited > LIMIT) return;
      if (seen.has(obj)) return;
      seen.add(obj);
      if (obj instanceof Node || obj === window) return;
      visited++;
      let keys;
      try {
        keys = Object.keys(obj);
      } catch (e) {
        return;
      }
      for (const k of keys) {
        let v;
        try {
          v = obj[k];
        } catch (e) {
          continue;
        }
        const p = path ? path + '.' + k : k;
        if (typeof v === 'string') {
          if (/commentid/i.test(k)) push(found.commentId, p, mask(v, 4));
          if (UC_RE.test(v)) push(found.browseIdUC, p, mask(v, 4));
          if (/^@[\w.\-]{2,}$/.test(v)) push(found.handle, p, mask(v, 3));
        } else if (v && typeof v === 'object') {
          if (/^author(Text|Name|Handle)?$/i.test(k)) {
            if (found.authorTextKeys.length < 10) found.authorTextKeys.push({ path: p, keys: safeKeys(v) });
          }
          walk(v, p, depth + 1);
        }
      }
    };
    walk(root, '', 0);
    found.visitedObjects = visited;
    found.truncated = visited > LIMIT;
    return found;
  }

  function safeKeys(obj, n) {
    try {
      return Object.keys(obj).slice(0, n || 20);
    } catch (e) {
      return 'error:' + errInfo(e).name;
    }
  }

  function maskHref(href) {
    if (typeof href !== 'string') return href;
    let m = href.match(/\/@([^/?#]+)/);
    if (m) {
      let h = m[1];
      try {
        h = decodeURIComponent(h);
      } catch (e) {
        // URIError のときは生の値を伏せて記録する
      }
      return { form: '/@handle', value: '/@' + mask(h, 3) };
    }
    m = href.match(/\/channel\/(UC[0-9A-Za-z_-]+)/);
    if (m) return { form: '/channel/UC', value: '/channel/' + mask(m[1], 4) };
    return { form: 'other', value: mask(href, 10) };
  }

  function probeElement(el) {
    const out = { tagName: el.tagName.toLowerCase(), props: {}, ownKeysHead: safeKeys(el, 30) };
    for (const p of PROBE_PROPS) {
      out.props[p] = safeTypeof(() => {
        const v = el[p];
        return v === undefined ? 'undefined' : v === null ? 'null' : typeof v;
      });
    }
    const roots = {};
    for (const p of ['data', '__data']) {
      const v = safeTypeof(() => el[p]);
      if (v && typeof v === 'object') roots[p] = v;
    }
    const pc = safeTypeof(() => el.polymerController);
    if (pc && typeof pc === 'object') {
      out.polymerControllerKeysHead = safeKeys(pc, 30);
      for (const p of ['data', '__data']) {
        const v = safeTypeof(() => pc[p]);
        if (v && typeof v === 'object') roots['polymerController.' + p] = v;
      }
    }
    out.search = {};
    for (const [name, root] of Object.entries(roots)) {
      out.search[name] = { keysHead: safeKeys(root, 20), found: searchIds(root, 8) };
    }
    return out;
  }

  function surveyDom() {
    const res = { candidates: {}, tagsContainingYtdComment: {}, tagsContainingComment: {} };
    for (const sel of DOM_CANDIDATES) {
      res.candidates[sel] = safeTypeof(() => document.querySelectorAll(sel).length);
    }
    for (const el of document.querySelectorAll('*')) {
      const t = el.tagName;
      if (t.includes('YTD-COMMENT')) res.tagsContainingYtdComment[t] = (res.tagsContainingYtdComment[t] || 0) + 1;
      if (t.includes('COMMENT')) res.tagsContainingComment[t] = (res.tagsContainingComment[t] || 0) + 1;
    }
    let firstSel = ['ytd-comment-thread-renderer', 'ytd-comment-view-model', 'ytd-comment-renderer'].find(
      (s) => document.querySelector(s),
    );
    if (!firstSel) {
      // 既知のタグが無いときは、COMMENT を含むタグのうち件数が最大のものを調べる（タグ名変更への備え）
      const fallback = Object.entries(res.tagsContainingComment)
        .filter(([t]) => t !== 'YTD-COMMENTS')
        .sort((a, b) => b[1] - a[1])[0];
      if (fallback) {
        firstSel = fallback[0].toLowerCase();
        res.fallbackFromUnknownTag = true;
      }
    }
    if (!firstSel) {
      res.loaded = false;
      res.note = 'コメント要素が見つからない（スクロール不足か、タグ名が変わった）';
      return res;
    }
    res.loaded = true;
    const thread = document.querySelector(firstSel);
    res.firstElementSelector = firstSel;
    const targets = [thread];
    const inner = thread.querySelector('ytd-comment-view-model, ytd-comment-renderer');
    if (inner) targets.push(inner);
    res.elements = targets.map((el) => probeElement(el));

    // unsafeWindow 経由で同じ要素を取り直して比較する（content では unsafeWindow は content の global）
    const uw = getUnsafeWindow();
    res.viaUnsafeWindow = safeTypeof(() => {
      if (!uw || !uw.document) return 'unsafeWindow.document なし';
      const el = uw.document.querySelector(firstSel);
      if (!el) return '要素なし';
      const o = { sameNode: el === thread, element: probeElement(el) };
      const innerU = el.querySelector('ytd-comment-view-model, ytd-comment-renderer');
      if (innerU) o.inner = probeElement(innerU);
      return o;
    });

    // 著者リンク・タイムスタンプリンク（lc=）・本文中のメンションリンク（本文テキストは記録しない）
    const authorLinks = [...thread.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => /\/@|\/channel\/UC/.test(h || ''));
    res.authorLinkHrefs = authorLinks.slice(0, 5).map(maskHref);
    const lcLink = [...thread.querySelectorAll('a[href*="lc="]')][0];
    if (lcLink) {
      const m = lcLink.getAttribute('href').match(/[?&]lc=([^&#]+)/);
      res.timestampLink = { found: true, lc: m ? mask(m[1], 4) : null };
    } else {
      res.timestampLink = { found: false };
    }
    const body = thread.querySelector('#content-text');
    res.contentTextFound = !!body;
    if (body) res.mentionLinksInBody = [...body.querySelectorAll('a[href]')].map((a) => maskHref(a.getAttribute('href'))).slice(0, 5);
    return res;
  }

  // ---------- 本体 ----------

  async function run() {
    runBtn.disabled = true;
    const result = { startedAt: new Date().toISOString(), url: location.pathname, stages: {} };
    const S = result.stages;
    const stage = async (name, fn) => {
      setStatus('実行中: ' + name);
      try {
        S[name] = await fn();
      } catch (e) {
        S[name] = Object.assign(S[name] || {}, { error: errInfo(e) });
      }
    };

    const uw = getUnsafeWindow();
    let LM = null;
    let base = null;

    await stage('env', () => {
      const env = {
        injectInto: safeTypeof(() => GM_info.injectInto ?? null),
        scriptHandler: safeTypeof(() => GM_info.scriptHandler ?? null),
        handlerVersion: safeTypeof(() => GM_info.version ?? null),
        scriptVersion: safeTypeof(() => GM_info.script.version),
        userAgent: navigator.userAgent,
        userAgentData: safeTypeof(() =>
          navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand + '/' + b.version) : null,
        ),
        typeofLanguageModel: typeof LanguageModel,
        typeofUnsafeWindow: typeof unsafeWindow,
        typeofUnsafeWindowLanguageModel: safeTypeof(() => typeof uw?.LanguageModel),
        windowEqualsUnsafeWindow: safeTypeof(() => window === uw),
        typeofYtInitialData: safeTypeof(() => typeof uw?.ytInitialData),
        typeofGM_setValue: typeof GM_setValue,
        typeofGM_getValue: typeof GM_getValue,
        userActivationAtStart: userActivation(),
      };
      // Trusted Types は有無だけ観測する。innerHTML を試すと違反レポートが YouTube へ送られうるため代入はしない
      env.trustedTypes = safeTypeof(() => {
        const tt = window.trustedTypes || uw?.trustedTypes;
        return tt ? { present: true, hasDefaultPolicy: !!tt.defaultPolicy } : { present: false };
      });
      return env;
    });

    await stage('availability', async () => {
      const rec = { options: LM_OPTIONS };
      if (typeof LanguageModel !== 'undefined') {
        LM = LanguageModel;
        rec.source = 'global';
      } else if (uw && typeof uw.LanguageModel !== 'undefined') {
        LM = uw.LanguageModel;
        rec.source = 'unsafeWindow';
      } else {
        rec.source = null;
        rec.result = 'LanguageModel なし';
        return rec;
      }
      const t0 = performance.now();
      try {
        rec.result = await withTimeout(LM.availability(LM_OPTIONS), STEP_TIMEOUT_MS, 'availability');
      } catch (e) {
        rec.error = errInfo(e);
      }
      rec.ms = round(performance.now() - t0);
      return rec;
    });

    await stage('create', async () => {
      if (!LM) return { skipped: 'LanguageModel なし' };
      const rec = {
        availabilityBefore: S.availability.result,
        note: 'availability を await した後に create を呼んでいる',
        userActivationBeforeCreate: userActivation(),
        downloadProgress: [],
      };
      const t0 = performance.now();
      try {
        base = await LM.create({
          ...LM_OPTIONS,
          signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
          initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              rec.downloadProgress.push({ loaded: e.loaded, atMs: round(performance.now() - t0) });
              setStatus('実行中: create（ダウンロード ' + Math.round(e.loaded * 100) + '%）');
            });
          },
        });
        rec.ok = true;
      } catch (e) {
        rec.ok = false;
        rec.error = errInfo(e);
      }
      rec.ms = round(performance.now() - t0);
      return rec;
    });

    await stage('quota', async () => {
      if (!base) return { skipped: 'セッションなし' };
      const rec = {
        current: {
          contextUsage: safeTypeof(() => base.contextUsage),
          contextWindow: safeTypeof(() => base.contextWindow),
          typeofMeasureContextUsage: typeof base.measureContextUsage,
        },
        legacyTypeof: {
          inputUsage: typeof base.inputUsage,
          inputQuota: typeof base.inputQuota,
          measureInputUsage: typeof base.measureInputUsage,
          onquotaoverflow: typeof base.onquotaoverflow,
          maxTokens: typeof base.maxTokens,
          tokensLeft: typeof base.tokensLeft,
          countPromptTokens: typeof base.countPromptTokens,
        },
        legacyValues: {
          inputUsage: safeTypeof(() => base.inputUsage),
          inputQuota: safeTypeof(() => base.inputQuota),
        },
        measure10: {},
      };
      const input10 = buildInput(COMMENTS);
      const measure = typeof base.measureContextUsage === 'function'
        ? ['measureContextUsage', (i, o) => base.measureContextUsage(i, o)]
        : typeof base.measureInputUsage === 'function'
          ? ['measureInputUsage', (i, o) => base.measureInputUsage(i, o)]
          : null;
      if (!measure) {
        rec.measure10 = 'measure 系メソッドなし';
        return rec;
      }
      rec.measure10.method = measure[0];
      for (const [label, opts] of [
        ['plain', undefined],
        ['withResponseConstraint', { responseConstraint: SCHEMA_TYPE_ARRAY }],
        ['withResponseConstraintOmitInput', { responseConstraint: SCHEMA_TYPE_ARRAY, omitResponseConstraintInput: true }],
        ['input1', 'one'],
      ]) {
        try {
          rec.measure10[label] = opts === 'one'
            ? await measure[1](buildInput(COMMENTS.slice(0, 1)))
            : await measure[1](input10, opts);
        } catch (e) {
          rec.measure10[label] = errInfo(e);
        }
      }
      return rec;
    });

    await stage('prompt', async () => {
      if (!base) return { skipped: 'セッションなし' };
      const rec = {
        mode: 'clone-per-run（base を毎回 clone し、prompt 後に destroy。履歴は持ち越さない）',
        schema: 'type:["string","null"] + enum(null を含む)',
        timeoutMs: PROMPT_TIMEOUT_MS,
        contextUsageBase: safeTypeof(() => base.contextUsage),
      };
      const opts = { responseConstraint: SCHEMA_TYPE_ARRAY };
      for (const [label, items] of [['one', COMMENTS.slice(0, 1)], ['ten', COMMENTS]]) {
        const runs = [];
        for (let i = 0; i < 3; i++) {
          setStatus('実行中: prompt ' + label + ' ' + (i + 1) + '/3');
          runs.push(await promptOnClone(base, items, opts));
        }
        rec[label] = { runs, msList: runs.map((r) => r.ms), medianMs: median(runs.map((r) => (r.error ? null : r.ms))) };
      }
      return rec;
    });

    await stage('concurrency', async () => {
      if (!base) return { skipped: 'セッションなし' };
      const opts = { responseConstraint: SCHEMA_TYPE_ARRAY };
      // 同一セッションでは FIFO で直列化されるため、2 本目のタイマーはキュー待ちを含む。timeout を倍にする
      const rec = {
        timeoutMs: PROMPT_TIMEOUT_MS * 2,
        note: '各 ms はキュー待ちを含む。sameSession の 2 本目は 1 本目の履歴を含むので入力が長い分だけ不利',
      };
      const sessions = [];
      const destroyAll = () => {
        for (const s of sessions.splice(0)) {
          try {
            s.destroy();
          } catch (e) {
            // 後始末の失敗は計測結果に影響しないので無視する
          }
        }
      };
      try {
        setStatus('実行中: concurrency（同一セッションに 2 本）');
        const shared = await withTimeout(base.clone(), STEP_TIMEOUT_MS, 'clone');
        sessions.push(shared);
        const t0 = performance.now();
        const runs = await Promise.all([
          timedPrompt(shared, COMMENTS, opts, PROMPT_TIMEOUT_MS * 2),
          timedPrompt(shared, COMMENTS, opts, PROMPT_TIMEOUT_MS * 2),
        ]);
        rec.sameSession = { totalMs: round(performance.now() - t0), runs, contextUsageAfter: safeTypeof(() => shared.contextUsage) };
      } catch (e) {
        rec.sameSession = { error: errInfo(e) };
      } finally {
        destroyAll();
      }
      try {
        setStatus('実行中: concurrency（clone 2 本に 1 本ずつ）');
        const a = await withTimeout(base.clone(), STEP_TIMEOUT_MS, 'clone');
        sessions.push(a);
        const b = await withTimeout(base.clone(), STEP_TIMEOUT_MS, 'clone');
        sessions.push(b);
        const t0 = performance.now();
        const runs = await Promise.all([
          timedPrompt(a, COMMENTS, opts, PROMPT_TIMEOUT_MS * 2),
          timedPrompt(b, COMMENTS, opts, PROMPT_TIMEOUT_MS * 2),
        ]);
        rec.twoClones = { totalMs: round(performance.now() - t0), runs };
      } catch (e) {
        rec.twoClones = { error: errInfo(e) };
      } finally {
        destroyAll();
      }
      return rec;
    });

    // 計測段の後に置く（1 回目のウォームアップ観測を汚さないため）
    await stage('schemaVariants', async () => {
      if (!base) return { skipped: 'セッションなし' };
      return {
        anyOf10: await promptOnClone(base, COMMENTS, { responseConstraint: SCHEMA_ANY_OF }),
        typeArrayOmitInput10: await promptOnClone(base, COMMENTS, {
          responseConstraint: SCHEMA_TYPE_ARRAY,
          omitResponseConstraintInput: true,
        }),
      };
    });

    await stage('gm', () => {
      const rec = { typeofGM_setValue: typeof GM_setValue, typeofGM_getValue: typeof GM_getValue };
      const key = 'ycf_spike_probe';
      const value = { t: Date.now() };
      try {
        const ret = GM_setValue(key, value);
        rec.setValueOk = true;
        rec.setValueReturnsPromise = typeof ret?.then === 'function';
      } catch (e) {
        rec.setValueOk = false;
        rec.setValueError = errInfo(e);
      }
      try {
        const got = GM_getValue(key, null);
        rec.getValueOk = true;
        rec.getValueReturnsPromise = typeof got?.then === 'function';
        rec.roundTripEqual = !!got && got.t === value.t;
      } catch (e) {
        rec.getValueOk = false;
        rec.getValueError = errInfo(e);
      }
      return rec;
    });

    await stage('dom', () => surveyDom());

    if (base) {
      try {
        base.destroy();
      } catch (e) {
        result.baseDestroyError = errInfo(e);
      }
    }
    result.finishedAt = new Date().toISOString();

    const json = JSON.stringify(result, null, 2);
    console.log('[YCF LM Spike]', result);
    console.log('[YCF LM Spike JSON]\n' + json);
    pre.textContent = json;
    const notes = ['完了（injectInto=' + (S.env ? S.env.injectInto : '?') + '）'];
    if (S.dom && S.dom.loaded === false) notes.push('コメント要素なし: コメント欄までスクロールしてから再実行');
    setStatus(notes.join('\n'));
    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', () => {
    run().catch((e) => {
      setStatus('想定外のエラー: ' + errInfo(e).name + ' ' + errInfo(e).message);
      runBtn.disabled = false;
    });
  });
})();
