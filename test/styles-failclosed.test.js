import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyles } from '../src/styles.js';

const css = buildStyles();
const FLEXY = 'ytd-watch-flexy ytd-comments#comments';
const WATCH = 'html[data-ycf-watch] ytd-comments#comments';
const THREAD = 'ytd-comment-thread-renderer';

/**
 * CSS を規則ごとに分け、セレクタの一覧と宣言を返す（コメントは除く）。
 * @returns {{ selectors: string[], body: string, index: number }[]}
 */
function parseRules() {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
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

test('動画ページかを JS が付ける html の属性でも判定し、ytd-watch-flexy が外れても閉じる・隠す規則が当たる', () => {
  assert.match(ruleOf(`html[data-ycf-watch]:not([data-ycf-open]) ytd-comments#comments`).body, /visibility:\s*hidden/);
  assert.match(ruleOf(`${WATCH} ${THREAD}[data-ycf-state="hidden"]`).body, /display:\s*none/);
  assert.match(ruleOf(`${WATCH} ${THREAD}[data-ycf-state="pending"] > #comment-container`).body, /visibility:\s*hidden/);
  assert.match(
    ruleOf(`${WATCH} ${THREAD}[data-ycf-state="shown"] > #comment-container ytd-expander#expander > #content`).body,
    /-webkit-line-clamp:\s*4/,
  );
});

test('判定前・判定待ちは thread 自体も隠し、#comment-container の id が変わっても中身が見えない', () => {
  for (const base of [FLEXY, WATCH]) {
    for (const state of [':not([data-ycf-state])', '[data-ycf-state="pending"]']) {
      const body = ruleOf(`${base} ${THREAD}${state}`).body;
      assert.match(body, /visibility:\s*hidden/);
      assert.match(body, /max-height:/);
      assert.match(body, /overflow:\s*hidden/);
    }
  }
});

test('全文固定の間は、ホバーしても 4 行に戻らない（全文固定の規則がホバーの規則に勝つ）', () => {
  const hover = ruleOf(`${FLEXY} ${THREAD}[data-ycf-state="shown"] > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`);
  const expandedHover = ruleOf(
    `${FLEXY} ${THREAD}[data-ycf-state="shown"][data-ycf-expanded] > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`,
  );
  assert.match(expandedHover.body, /-webkit-line-clamp:\s*unset/);
  assert.ok(expandedHover.index > hover.index, 'ホバーの規則より後に置く');
});

test('Shorts のコメント欄（ytd-shorts の中の id の無い ytd-comments）にも、属性と保険の両方で閉じる・隠す規則が当たる', () => {
  const SHORTS_ATTR_SCOPE = 'html[data-ycf-shorts] ytd-shorts ytd-comments';
  const SHORTS_FALLBACK_SCOPE = 'ytd-shorts ytd-comments';
  assert.match(ruleOf('html[data-ycf-shorts]:not([data-ycf-open]) ytd-shorts ytd-comments').body, /visibility:\s*hidden/);
  assert.match(ruleOf('html:not([data-ycf-open]) ytd-shorts ytd-comments').body, /visibility:\s*hidden/);
  for (const base of [SHORTS_ATTR_SCOPE, SHORTS_FALLBACK_SCOPE]) {
    assert.match(ruleOf(`${base} ${THREAD}[data-ycf-state="hidden"]`).body, /display:\s*none/);
    for (const state of [':not([data-ycf-state])', '[data-ycf-state="pending"]']) {
      assert.match(ruleOf(`${base} ${THREAD}${state}`).body, /visibility:\s*hidden/);
    }
    assert.match(
      ruleOf(`${base} ${THREAD}[data-ycf-state="shown"] > #comment-container ytd-expander#expander > #content`).body,
      /-webkit-line-clamp:\s*4/,
    );
  }
});
