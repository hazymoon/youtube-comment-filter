import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyles } from '../src/styles.js';

// 全文固定の規則に :focus-visible のセレクタを混ぜると、:focus-visible を解釈しないブラウザでは規則ごと捨てられ、
// クリックしても全文にならない（issue #24 のレビューの指摘）。フォーカスのセレクタは別の規則に分ける

/**
 * CSS を規則ごとのセレクタの並びに分ける（@property などの at 規則は除く）。
 * @param {string} css
 * @returns {string[][]}
 */
function selectorLists(css) {
  return [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((match) => match[1].trim())
    .filter((selectors) => selectors !== '' && !selectors.startsWith('@'))
    .map((selectors) => selectors.split(',').map((s) => s.trim()));
}

test('全文固定の既定・ホバーのセレクタと :focus-visible のセレクタは同じ規則に無い', () => {
  const lists = selectorLists(buildStyles()).filter((list) => list.some((s) => s.includes('[data-ycf-expanded]')));
  assert.ok(lists.length > 0, '全文固定の規則がある');
  for (const list of lists) {
    const withFocus = list.filter((s) => s.includes(':focus-visible'));
    assert.ok(withFocus.length === 0 || withFocus.length === list.length, list.join(',\n'));
  }
});

test('全文固定の間にフォーカスしても、全文の宣言が当たる規則がある', () => {
  const css = buildStyles();
  const focusExpanded = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    ([, selectors]) => selectors.includes('[data-ycf-expanded]') && selectors.includes(':focus-visible'),
  );
  assert.ok(focusExpanded, '全文固定かつフォーカスの規則がある');
  assert.match(focusExpanded[2], /-webkit-line-clamp:\s*unset\s*!important/);
  assert.match(focusExpanded[2], /clip-path:\s*none/);
});
