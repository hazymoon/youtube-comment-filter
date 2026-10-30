import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import {
  AUTHOR_LINK_SELECTOR,
  CONTENT_TEXT_SELECTOR,
  REASON_STRIP_CLASS,
  REVEALED_ATTR,
  STATE_ATTR,
  THREAD_TAG,
} from '../src/selectors.js';
import { createCountBar, moveFocusOffReasonStrip, reasonStripOfKeyEvent } from '../src/ui.js';

// 理由の帯（issue #11）のレビューの指摘への対応

/**
 * 偽の thread を作る（reason-strip.test.js と同じ形）。
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
  return thread;
}

test('一時表示の属性は、規則の変更で表示に変わったら外し、もう一度隠しても開いたまま出さない', () => {
  const processor = createThreadProcessor({
    rules: compileRules({ ngWords: ['spam'] }),
    cache: { get: () => null, set: () => {} },
    getAiMode: () => 'disabled',
  });
  const thread = makeThread('@eve', 'spam');
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  thread.setAttribute(REVEALED_ATTR, '');

  processor.setRules(compileRules({}));
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  assert.equal(thread.hasAttribute(REVEALED_ATTR), false, '表示に変わったら外す');

  processor.setRules(compileRules({ ngWords: ['spam'] }));
  processor.processThreads([thread]);
  assert.equal(thread.getAttribute(STATE_ATTR), 'hidden');
  assert.equal(thread.hasAttribute(REVEALED_ATTR), false, '新たに隠したコメントは閉じて出す');
});

/**
 * 理由の帯の偽の要素。
 */
function makeStrip() {
  const strip = { nodeType: 1, classList: { contains: (c) => c === REASON_STRIP_CLASS } };
  return strip;
}

/**
 * キー入力の偽のイベント。
 * @param {object} fields 上書きする項目
 */
function keyEvent(fields) {
  return {
    key: 'Enter',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...fields,
  };
}

test('reasonStripOfKeyEvent は帯の上の Enter・Space だけを帯に返す（YouTube の再生ショートカットに渡さないため）', () => {
  const strip = makeStrip();
  const other = { nodeType: 1, classList: { contains: () => false } };
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: strip })), strip);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: strip, key: ' ' })), strip);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: strip, key: 'k' })), null);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: strip, ctrlKey: true })), null);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: strip, repeat: true })), null);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: strip, isComposing: true })), null);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: other })), null);
  assert.equal(reasonStripOfKeyEvent(keyEvent({ target: null })), null);
});

test('moveFocusOffReasonStrip は帯にフォーカスがあるときだけ移し先へ移す（帯が消えて body に落ちないように）', () => {
  const focused = [];
  const fallback = { focus: (options) => focused.push(options) };
  moveFocusOffReasonStrip(makeStrip(), fallback);
  assert.equal(focused.length, 1);
  assert.deepEqual(focused[0], { preventScroll: true });

  moveFocusOffReasonStrip({ nodeType: 1, classList: { contains: () => false } }, fallback);
  moveFocusOffReasonStrip(null, fallback);
  assert.equal(focused.length, 1, '帯以外のフォーカスは動かさない');
});

test('件数バーは「理由を表示」のボタンをフォーカスの移し先として返す', () => {
  const doc = {
    createElement() {
      const el = {
        textContent: '',
        children: [],
        setAttribute() {},
        addEventListener() {},
        append: (...c) => el.children.push(...c),
      };
      return el;
    },
  };
  const bar = createCountBar({ doc, onToggle: () => {} });
  assert.ok(bar.reasonsButton);
  assert.equal(bar.reasonsButton.textContent, '理由を表示');
});
