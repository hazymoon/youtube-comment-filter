import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { appendStoredUser } from '../src/settings.js';
import { AUTHOR_LINK_SELECTOR, BLOCK_BUTTON_CLASS, CONTENT_TEXT_SELECTOR, HEADER_AUTHOR_SELECTOR, REASON_ATTR, STATE_ATTR } from '../src/selectors.js';
import { buildStyles } from '../src/styles.js';
import { ensureBlockButton } from '../src/ui.js';
import { isBlockButtonInsertion } from '../src/ui.js';

// コメントから直接 NG ユーザに登録する（issue #7）

test('appendStoredUser は配列に足し、重複は足さず、配列でない値は上書きしない', () => {
  assert.deepEqual(appendStoredUser(undefined, '@a'), ['@a']);
  assert.deepEqual(appendStoredUser(['@a'], '@b'), ['@a', '@b']);
  assert.deepEqual(appendStoredUser(['@a'], '@a'), ['@a']);
  assert.equal(appendStoredUser('@a', '@b'), null);
  const original = ['@a'];
  appendStoredUser(original, '@b');
  assert.deepEqual(original, ['@a'], '元の配列は変えない');
});

/**
 * 偽の document と #header-author を作る。
 */
function makeHeader() {
  const created = [];
  const doc = {
    createElement(tag) {
      const listeners = {};
      const classes = new Set();
      const attrs = {};
      const node = {
        tagName: tag.toUpperCase(),
        classList: { contains: (c) => classes.has(c) },
        set className(value) {
          classes.clear();
          for (const c of value.split(/\s+/)) if (c) classes.add(c);
        },
        setAttribute: (name, value) => {
          attrs[name] = value;
        },
        addEventListener: (type, fn) => {
          listeners[type] = fn;
        },
        listeners,
      };
      created.push(node);
      return node;
    },
  };
  const header = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
  const viewModel = { querySelector: (selector) => (selector === HEADER_AUTHOR_SELECTOR ? header : null) };
  return { doc, header, viewModel, created };
}

test('ensureBlockButton は #header-author の末尾に 1 回だけボタンを差し込み、押すと onClick を呼ぶ', () => {
  const { doc, header, viewModel } = makeHeader();
  const clicked = [];
  ensureBlockButton(viewModel, doc, (button) => clicked.push(button));
  ensureBlockButton(viewModel, doc, () => {});
  assert.equal(header.children.length, 1);
  const button = header.children[0];
  assert.equal(button.type, 'button');
  assert.equal(button.classList.contains(BLOCK_BUTTON_CLASS), true);

  let stopped = false;
  let prevented = false;
  button.listeners.click({ stopPropagation: () => (stopped = true), preventDefault: () => (prevented = true) });
  assert.deepEqual(clicked, [button]);
  assert.ok(stopped && prevented, 'YouTube 側のクリック処理に渡さない');
});

test('ensureBlockButton は #header-author が無ければ何もしない', () => {
  const { doc, created } = makeHeader();
  ensureBlockButton({ querySelector: () => null }, doc, () => {});
  ensureBlockButton(null, doc, () => {});
  assert.equal(created.length, 0);
});

test('NG 登録のボタンは既定で隠し、判定から外したもの以外の表示中のコメントのホバーでだけ見せる', () => {
  const css = buildStyles();
  const T = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer';
  const shownSelector = `${T}[data-ycf-state="shown"]:not([data-ycf-reason="exempt"]) > #comment-container ytd-comment-view-model:hover .${BLOCK_BUTTON_CLASS}`;
  assert.ok(css.includes(shownSelector), shownSelector);
  const base = css.indexOf(`.${BLOCK_BUTTON_CLASS} {`);
  assert.notEqual(base, -1);
  assert.match(css.slice(base, css.indexOf('}', base)), /opacity:\s*0\s*!important/);
  assert.match(css.slice(base, css.indexOf('}', base)), /pointer-events:\s*none\s*!important/);
});

/**
 * 偽の thread を作る（scanner.test.js と同じ形）。
 * @param {string} handle 投稿者のハンドル
 */
function makeThread(handle) {
  const attrs = new Map();
  const author = { getAttribute: (name) => (name === 'href' ? `/${handle}` : null) };
  const content = { textContent: '本文', querySelector: () => null };
  const viewModel = {
    id: 'comment',
    tagName: 'YTD-COMMENT-VIEW-MODEL',
    children: [],
    data: { commentId: `id-${handle}` },
    querySelector: (selector) => ({ [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: author })[selector] ?? null,
  };
  const container = { id: 'comment-container', tagName: 'DIV', children: [viewModel] };
  const thread = {
    tagName: 'YTD-COMMENT-THREAD-RENDERER',
    children: [container],
    parentElement: null,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
  };
  viewModel.parentElement = container;
  container.parentElement = thread;
  return thread;
}

test('setRules の後は、表示に確定済みのコメントも新しいルールで判定し直す', () => {
  const processor = createThreadProcessor({
    rules: compileRules({}),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'disabled',
  });
  const thread = makeThread('@eve');
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');

  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown', 'ルールが同じなら確定済みのまま');

  processor.setRules(compileRules({ ngUsers: ['@eve'] }));
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.getAttribute(REASON_ATTR), 'ngUser');
});

test('AI の判定で表示になった thread を onShown に渡す（スキャンを待たずに NG 登録のボタンを付けるため）', () => {
  const shown = [];
  const processor = createThreadProcessor({
    rules: compileRules({}),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'ready',
    onShown: (thread) => shown.push(thread),
  });
  const kept = makeThread('@eve');
  const hidden = makeThread('@mallory');
  processor.processThreads([kept, hidden]);
  assert.deepEqual(shown, [], 'AI の判定前は渡さない');

  processor.applyVerdict([kept, hidden], 'id-@eve', { hide: false, category: null }, { id: 'id-@eve', text: '本文' });
  processor.applyVerdict([kept, hidden], 'id-@mallory', { hide: true, category: '暴言' }, { id: 'id-@mallory', text: '本文' });
  assert.equal(kept.getAttribute(STATE_ATTR), 'shown');
  assert.deepEqual(shown, [kept], '隠した thread は渡さない');
});

test('isBlockButtonInsertion は NG 登録のボタンだけを差し込んだ変化を見分ける（自分の差し込みで再スキャンを回さないため）', () => {
  const button = { nodeType: 1, classList: { contains: (c) => c === BLOCK_BUTTON_CLASS } };
  const other = { nodeType: 1, classList: { contains: () => false } };
  const text = { nodeType: 3 };
  assert.equal(isBlockButtonInsertion({ type: 'childList', addedNodes: [button], removedNodes: [] }), true);
  assert.equal(isBlockButtonInsertion({ type: 'childList', addedNodes: [button, other], removedNodes: [] }), false);
  assert.equal(isBlockButtonInsertion({ type: 'childList', addedNodes: [button], removedNodes: [other] }), false);
  assert.equal(isBlockButtonInsertion({ type: 'childList', addedNodes: [text], removedNodes: [] }), false);
  assert.equal(isBlockButtonInsertion({ type: 'childList', addedNodes: [], removedNodes: [] }), false);
  assert.equal(isBlockButtonInsertion({ type: 'characterData', addedNodes: [], removedNodes: [] }), false);
});

test('setRules の後も、ルールに当たらない確定済みのコメントは AI の判定を引き直さない（キャッシュから消えていても判定待ちに戻さない）', () => {
  /** @type {Map<string, { hide: boolean, category: string|null }>} */
  const verdicts = new Map([
    ['id-@eve', { hide: false, category: null }],
    ['id-@trent', { hide: true, category: '暴言' }],
  ]);
  const processor = createThreadProcessor({
    rules: compileRules({}),
    cache: { get: (id) => verdicts.get(id) ?? null, set: () => {} },
    getAiMode: () => 'ready',
  });
  const kept = makeThread('@eve');
  const aiHidden = makeThread('@trent');
  const blocked = makeThread('@mallory');
  verdicts.set('id-@mallory', { hide: false, category: null });
  processor.processThreads([kept, aiHidden, blocked]);
  assert.equal(kept.getAttribute(STATE_ATTR), 'shown');
  assert.equal(aiHidden.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(blocked.getAttribute(STATE_ATTR), 'shown');

  // キャッシュの上限で AI の判定が消えた後に、NG ユーザを足す
  verdicts.clear();
  processor.setRules(compileRules({ ngUsers: ['@mallory'] }));
  const items = processor.processThreads([kept, aiHidden, blocked]);
  assert.deepEqual(items, [], 'AI の順番待ちに入れ直さない');
  assert.equal(kept.getAttribute(STATE_ATTR), 'shown');
  assert.equal(aiHidden.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(aiHidden.getAttribute(REASON_ATTR), 'ai');
  assert.equal(blocked.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(blocked.getAttribute(REASON_ATTR), 'ngUser');
});
