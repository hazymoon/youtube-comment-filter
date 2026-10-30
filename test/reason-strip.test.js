import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountText, buildReasonText } from '../src/decide.js';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import {
  AUTHOR_LINK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  DETAIL_ATTR,
  REASON_STRIP_CLASS,
  REASONS_ATTR,
  REVEALED_ATTR,
  STATE_ATTR,
  THREAD_TAG,
} from '../src/selectors.js';
import { buildStyles } from '../src/styles.js';
import { createCountBar, ensureReasonStrip, isReasonStripMutation } from '../src/ui.js';

// 隠したコメントの理由を帯で示し、一時的に再表示できるようにする（issue #11）

test('buildReasonText は NG ユーザの照合の種類ごとに文言を変える', () => {
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ngUser', detail: 'handle' }),
    'NG ユーザ（投稿者のハンドル）で非表示',
  );
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ngUser', detail: 'channelId' }),
    'NG ユーザ（投稿者のチャンネル ID）で非表示',
  );
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ngUser', detail: 'mention' }),
    'NG ユーザ（@返信の宛先）で非表示',
  );
  assert.equal(buildReasonText({ state: 'hidden', reason: 'ngUser', detail: null }), 'NG ユーザで非表示');
});

test('buildReasonText は投稿者へのなりすましと許可していないリンクを NG ユーザ・NG ワードと分けて示す', () => {
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ngUser', detail: 'impersonation' }),
    '投稿者へのなりすましで非表示',
  );
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ngWord', detail: 'link:example.com' }),
    '許可していないリンク（example.com）で非表示',
  );
});

test('buildReasonText は NG ワードの一致した語を示し、長い語は切り詰める', () => {
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ngWord', detail: '/死ね|しね/i' }),
    'NG ワード「/死ね|しね/i」で非表示',
  );
  assert.equal(buildReasonText({ state: 'hidden', reason: 'ngWord', detail: null }), 'NG ワードで非表示');
  const long = 'あ'.repeat(50);
  const text = buildReasonText({ state: 'hidden', reason: 'ngWord', detail: long });
  assert.ok(text.length < long.length, text);
  assert.match(text, /^NG ワード「あ+…」で非表示$/);
});

test('buildReasonText は AI のカテゴリを示し、カテゴリが無ければ AI の判定とだけ示す', () => {
  assert.equal(
    buildReasonText({ state: 'hidden', reason: 'ai', detail: '人格攻撃・侮辱' }),
    'AI（人格攻撃・侮辱）で非表示',
  );
  assert.equal(buildReasonText({ state: 'hidden', reason: 'ai', detail: null }), 'AI の判定で非表示');
});

test('buildReasonText は判定待ちと判定中を件数バーと同じ分け方で示す', () => {
  assert.equal(buildReasonText({ state: 'pending', reason: 'unreadable', detail: null }), '判定待ち');
  assert.equal(buildReasonText({ state: 'pending', reason: 'ai-unresolved', detail: null }), '判定待ち');
  assert.equal(buildReasonText({ state: 'pending', reason: 'awaiting-ai', detail: null }), '判定中…');
});

test('件数バーの文言は変えない', () => {
  assert.equal(
    buildCountText({ ngUser: 1, ngWord: 2, ai: 3, pending: 4, judging: 0, total: 20 }),
    '読み込み済み 20 件中 10 件を非表示（NG ユーザ 1 / NG ワード 2 / AI 3 / 判定待ち 4）',
  );
});

/**
 * 偽の要素を作る（属性・子要素・イベントだけ）。
 * @param {string} tag タグ名
 */
function fakeElement(tag) {
  const attrs = new Map();
  const listeners = {};
  const classes = new Set();
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    textContent: '',
    classList: { contains: (c) => classes.has(c) },
    set className(value) {
      classes.clear();
      for (const c of String(value).split(/\s+/)) if (c) classes.add(c);
    },
    get firstElementChild() {
      return element.children[0] ?? null;
    },
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    toggleAttribute(name, force) {
      const on = force ?? !attrs.has(name);
      if (on) attrs.set(name, '');
      else attrs.delete(name);
      return on;
    },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    append(...children) {
      for (const child of children) {
        child.parentElement = element;
        element.children.push(child);
      }
    },
    appendChild(child) {
      element.append(child);
      return child;
    },
    insertBefore(child, ref) {
      child.parentElement = element;
      const index = ref === null ? element.children.length : element.children.indexOf(ref);
      element.children.splice(index, 0, child);
      return child;
    },
    listeners,
  };
  return element;
}

const fakeDoc = { createElement: fakeElement };

test('件数バーに「理由を表示」のトグルボタンがあり、押すと onToggleReasons を呼び、aria-pressed で状態を示す', () => {
  let toggled = 0;
  const bar = createCountBar({ doc: fakeDoc, onToggle: () => {}, onToggleReasons: () => (toggled += 1) });
  const reasonsButton = bar.element.children.find((child) => child.textContent === '理由を表示');
  assert.ok(reasonsButton, '理由を表示のボタン');
  assert.notEqual(reasonsButton, bar.button, '開閉ボタンとは別');
  assert.equal(reasonsButton.type, 'button');

  bar.update({ open: true, countText: '', statusText: '', visible: true, reasons: false });
  assert.equal(reasonsButton.getAttribute('aria-pressed'), 'false');
  bar.update({ open: true, countText: '', statusText: '', visible: true, reasons: true });
  assert.equal(reasonsButton.getAttribute('aria-pressed'), 'true');

  let stopped = false;
  reasonsButton.listeners.click({ preventDefault() {}, stopPropagation: () => (stopped = true) });
  assert.equal(toggled, 1);
  assert.ok(stopped, 'YouTube 側のクリック処理に渡さない');
});

test('ensureReasonStrip は thread の先頭に 1 回だけ帯の button を差し込み、文言と一時表示の状態を合わせる', () => {
  const thread = fakeElement(THREAD_TAG);
  const container = fakeElement('div');
  container.id = 'comment-container';
  thread.append(container);
  const clicked = [];
  const strip = ensureReasonStrip(thread, fakeDoc, { text: 'NG ワード「a」で非表示', expanded: false }, (s) =>
    clicked.push(s),
  );
  assert.equal(thread.children[0], strip, '先頭に差し込む');
  assert.equal(strip.tagName, 'BUTTON');
  assert.equal(strip.type, 'button');
  assert.equal(strip.classList.contains(REASON_STRIP_CLASS), true);
  assert.equal(strip.textContent, 'NG ワード「a」で非表示');
  assert.equal(strip.getAttribute('aria-expanded'), 'false');

  const again = ensureReasonStrip(thread, fakeDoc, { text: 'AI の判定で非表示', expanded: true }, () => {});
  assert.equal(again, strip, '差し込み済みなら作り直さない');
  assert.equal(thread.children.length, 2);
  assert.equal(strip.textContent, 'AI の判定で非表示');
  assert.equal(strip.getAttribute('aria-expanded'), 'true');

  let prevented = false;
  strip.listeners.click({ preventDefault: () => (prevented = true), stopPropagation() {} });
  assert.deepEqual(clicked, [strip], '最初に渡した onClick を呼ぶ');
  assert.ok(prevented);
});

test('isReasonStripMutation は帯の差し込みと帯の中の文言の書き換えを見分ける（自分の変化で再スキャンを回さないため）', () => {
  const strip = { nodeType: 1, classList: { contains: (c) => c === REASON_STRIP_CLASS } };
  strip.closest = (selector) => (selector === `.${REASON_STRIP_CLASS}` ? strip : null);
  const other = { nodeType: 1, classList: { contains: () => false }, closest: () => null };
  const textInStrip = { nodeType: 3, parentElement: strip };
  const textElsewhere = { nodeType: 3, parentElement: other };
  const thread = { nodeType: 1, classList: { contains: () => false }, closest: () => null };

  assert.equal(
    isReasonStripMutation({ type: 'childList', target: thread, addedNodes: [strip], removedNodes: [] }),
    true,
  );
  assert.equal(
    isReasonStripMutation({ type: 'childList', target: thread, addedNodes: [strip, other], removedNodes: [] }),
    false,
  );
  assert.equal(
    isReasonStripMutation({ type: 'childList', target: thread, addedNodes: [strip], removedNodes: [other] }),
    false,
  );
  // textContent の書き換えは、帯を target にした子の入れ替えになる
  assert.equal(
    isReasonStripMutation({
      type: 'childList',
      target: strip,
      addedNodes: [{ nodeType: 3 }],
      removedNodes: [{ nodeType: 3 }],
    }),
    true,
  );
  assert.equal(
    isReasonStripMutation({ type: 'characterData', target: textInStrip, addedNodes: [], removedNodes: [] }),
    true,
  );
  assert.equal(
    isReasonStripMutation({ type: 'characterData', target: textElsewhere, addedNodes: [], removedNodes: [] }),
    false,
  );
  assert.equal(
    isReasonStripMutation({ type: 'childList', target: thread, addedNodes: [other], removedNodes: [] }),
    false,
  );
  assert.equal(isReasonStripMutation({ type: 'childList', target: thread, addedNodes: [], removedNodes: [] }), false);
});

/**
 * 偽の thread を作る（block.test.js と同じ形に、本文と ID を差し替えられるようにしたもの）。
 * @param {string} handle 投稿者のハンドル
 * @param {string} text 本文
 */
function makeThread(handle, text) {
  const attrs = new Map();
  const author = { getAttribute: (name) => (name === 'href' ? `/${handle}` : null) };
  const content = { textContent: text, querySelector: () => null };
  const viewModel = {
    id: 'comment',
    tagName: 'YTD-COMMENT-VIEW-MODEL',
    children: [],
    data: { commentId: `id-${handle}` },
    querySelector: (selector) =>
      ({ [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: author })[selector] ?? null,
  };
  const container = { id: 'comment-container', tagName: 'DIV', children: [viewModel] };
  const thread = {
    nodeType: 1,
    tagName: 'YTD-COMMENT-THREAD-RENDERER',
    children: [container],
    parentElement: null,
    closest: (selector) => (selector === THREAD_TAG ? thread : null),
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
  };
  viewModel.parentElement = container;
  container.parentElement = thread;
  return { thread, content, viewModel };
}

test('ルールで隠した thread に、judgeByRules の detail を記録する', () => {
  const processor = createThreadProcessor({
    rules: compileRules({ ngUsers: ['@mallory'], ngWords: ['spam'] }),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'disabled',
  });
  const user = makeThread('@mallory', '本文').thread;
  const word = makeThread('@eve', 'buy spam now').thread;
  const kept = makeThread('@trent', 'こんにちは').thread;
  processor.processThreads([user, word, kept]);
  assert.equal(user.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(user.getAttribute(DETAIL_ATTR), 'handle');
  assert.equal(word.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(word.getAttribute(DETAIL_ATTR), 'spam');
  assert.equal(kept.getAttribute(STATE_ATTR), 'shown');
  assert.equal(kept.getAttribute(DETAIL_ATTR), null);
});

test('AI で隠した thread に、キャッシュと AI の判定のカテゴリを記録し、判定待ちには記録しない', () => {
  const processor = createThreadProcessor({
    rules: compileRules({}),
    cache: {
      get: (id) => (id === 'id-@cached' ? { hide: true, category: '人格攻撃・侮辱' } : null),
      set: () => {},
    },
    getAiMode: () => 'ready',
  });
  const cached = makeThread('@cached', '本文').thread;
  const fresh = makeThread('@fresh', '本文').thread;
  const unresolved = makeThread('@unresolved', '本文').thread;
  processor.processThreads([cached, fresh, unresolved]);
  assert.equal(cached.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(cached.getAttribute(DETAIL_ATTR), '人格攻撃・侮辱');
  assert.equal(fresh.getAttribute(STATE_ATTR), 'pending');
  assert.equal(fresh.getAttribute(DETAIL_ATTR), null);

  processor.applyVerdict([fresh], 'id-@fresh', { hide: true, category: '暴言' }, { id: 'id-@fresh', text: '本文' });
  assert.equal(fresh.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(fresh.getAttribute(DETAIL_ATTR), '暴言');

  processor.applyPending([unresolved], 'id-@unresolved', { id: 'id-@unresolved', text: '本文' });
  assert.equal(unresolved.getAttribute(STATE_ATTR), 'pending');
  assert.equal(unresolved.getAttribute(DETAIL_ATTR), null);
});

test('隠した thread が表示に変わったら detail を外す', () => {
  const processor = createThreadProcessor({
    rules: compileRules({ ngWords: ['spam'] }),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'disabled',
  });
  const { thread } = makeThread('@eve', 'spam');
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(DETAIL_ATTR), 'spam');
  processor.setRules(compileRules({}));
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.getAttribute(DETAIL_ATTR), null);
});

test('一時表示の属性は、コメント ID か本文が変わったら外し、同じコメントのままなら残す', () => {
  const processor = createThreadProcessor({
    rules: compileRules({ ngUsers: ['@mallory'] }),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'disabled',
  });
  const { thread, content, viewModel } = makeThread('@mallory', '本文');
  processor.processThreads([thread]);
  thread.setAttribute(REVEALED_ATTR, '');
  processor.processThreads([thread]);
  assert.equal(thread.hasAttribute(REVEALED_ATTR), true, '同じコメントなら残す');

  content.textContent = '別の本文';
  processor.processThreads([thread]);
  assert.equal(thread.hasAttribute(REVEALED_ATTR), false, '本文が変わったら外す');

  thread.setAttribute(REVEALED_ATTR, '');
  viewModel.data.commentId = 'id-other';
  processor.processThreads([thread]);
  assert.equal(thread.hasAttribute(REVEALED_ATTR), false, 'ID が変わったら外す');
});

test('監視の通知で表示中のコメントが変わったと分かったときも、一時表示の属性を外す', () => {
  const processor = createThreadProcessor({
    rules: compileRules({ ngUsers: ['@mallory'] }),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'disabled',
  });
  const { thread, content } = makeThread('@mallory', '本文');
  processor.processThreads([thread]);
  thread.setAttribute(REVEALED_ATTR, '');
  content.textContent = '別の本文';
  processor.revalidate([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), null, '判定前に戻す');
  assert.equal(thread.hasAttribute(REVEALED_ATTR), false);
});

/**
 * CSS を規則ごとに分ける（styles-failclosed.test.js と同じ方法）。
 * @returns {{ selectors: string[], body: string, index: number }[]}
 */
function parseRules() {
  const text = buildStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    rules.push({ selectors: match[1].split(',').map((s) => s.trim()), body: match[2], index: rules.length });
  }
  return rules;
}

/**
 * セレクタを一覧に持つ規則を返す。
 * @param {string} selector セレクタ
 */
function ruleOf(selector) {
  const rule = parseRules().find((r) => r.selectors.includes(selector));
  assert.ok(rule, `${selector} の規則が無い`);
  return rule;
}

/** コメント欄の範囲（styles.js の COMMENTS_SCOPES）ごとの、html の条件を差し込んだ thread のセレクタ */
const SCOPES = [
  (cond) => `html[data-ycf-shorts]${cond} ytd-shorts ytd-comments ${THREAD_TAG}`,
  (cond) => `html${cond} ytd-shorts ytd-comments ${THREAD_TAG}`,
  (cond) => `html[data-ycf-watch]${cond} ytd-comments#comments ${THREAD_TAG}`,
  (cond) => `html${cond} ytd-watch-flexy ytd-comments#comments ${THREAD_TAG}`,
];
const HIDDEN = `[${STATE_ATTR}="hidden"]`;
const BASE_HIDDEN = [
  `html[data-ycf-shorts] ytd-shorts ytd-comments ${THREAD_TAG}${HIDDEN}`,
  `ytd-shorts ytd-comments ${THREAD_TAG}${HIDDEN}`,
  `html[data-ycf-watch] ytd-comments#comments ${THREAD_TAG}${HIDDEN}`,
  `ytd-watch-flexy ytd-comments#comments ${THREAD_TAG}${HIDDEN}`,
];

test('理由の表示中は、隠した thread を出し、親コメントと返信を隠して帯だけを見せる（すべての範囲で）', () => {
  for (const scope of SCOPES) {
    const thread = `${scope(`[${REASONS_ATTR}]`)}${HIDDEN}`;
    assert.match(ruleOf(thread).body, /display:\s*block\s*!important/, thread);
    assert.match(
      ruleOf(`${thread}:not([${REVEALED_ATTR}]) > #comment-container`).body,
      /display:\s*none\s*!important/,
      thread,
    );
    assert.match(ruleOf(`${thread} > #replies`).body, /display:\s*none\s*!important/, thread);
    assert.match(ruleOf(`${thread} > .${REASON_STRIP_CLASS}`).body, /display:\s*block\s*!important/, thread);
  }
  assert.match(ruleOf(`.${REASON_STRIP_CLASS}`).body, /display:\s*none\s*!important/, '帯は既定で隠す');
});

test('一時表示しても返信は隠したまま、親コメントを隠す規則だけが外れる', () => {
  const rules = parseRules();
  const revealedContainer = rules
    .flatMap((r) => r.selectors.map((s) => ({ s, body: r.body })))
    .filter(({ s }) => s.includes(`[${REVEALED_ATTR}]`) && !s.includes(`:not([${REVEALED_ATTR}])`));
  for (const { s, body } of revealedContainer) {
    assert.doesNotMatch(s, /#replies/, s);
    assert.doesNotMatch(body, /display:\s*none/, s);
  }
});

test('理由の表示の上書き規則は、隠す基底の規則（display:none）を残し、その後ろに置く', () => {
  for (const selector of BASE_HIDDEN) {
    const base = ruleOf(selector);
    assert.match(base.body, /display:\s*none\s*!important/, selector);
    for (const scope of SCOPES) {
      const override = ruleOf(`${scope(`[${REASONS_ATTR}]`)}${HIDDEN}`);
      assert.ok(override.index > base.index, `${selector} より後ろ`);
    }
  }
});
