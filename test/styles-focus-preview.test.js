import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyles } from '../src/styles.js';

// キーボードだけでも段階表示を読めるようにする（issue #24）。
// 本文の枠（#content）に Tab で止まれるようにし、キーボードのフォーカスがあるときはホバーと同じ量を見せる。
// 本文の枠自体がフォーカスを持つので :has() は使わず、:hover の規則とは別の規則にする。

/** 動画ページの 2 つと Shorts の 2 つ。styles.js の COMMENTS_SCOPES が作るコメント欄の範囲 */
const SCOPES = [
  'html[data-ycf-shorts] ytd-shorts ytd-comments',
  'ytd-shorts ytd-comments',
  'html[data-ycf-watch] ytd-comments#comments',
  'ytd-watch-flexy ytd-comments#comments',
];

const THREAD = 'ytd-comment-thread-renderer';
const SHOWN = `${THREAD}[data-ycf-state="shown"]`;
const EXPANDED = `${SHOWN}[data-ycf-expanded]`;
const CONTENT = 'ytd-expander#expander > #content';

const focusOf = (scope, thread = SHOWN) => `${scope} ${thread} > #comment-container ${CONTENT}:focus-visible`;
const hoverOf = (scope, thread = SHOWN) =>
  `${scope} ${thread} > #comment-container ytd-comment-view-model:hover ${CONTENT}`;

/**
 * CSS を規則ごとのセレクタと宣言に分ける（入れ子の無い規則だけを扱う）。
 * @param {string} css
 * @returns {{ selectors: string[], body: string, index: number }[]}
 */
function rulesOf(css) {
  return css
    .split('}')
    .filter((chunk) => chunk.includes('{'))
    .map((chunk, index) => {
      const [head, body] = chunk.split('{');
      return {
        selectors: head
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        body,
        index,
      };
    });
}

function ruleOf(rules, selector) {
  const rule = rules.find((r) => r.selectors.includes(selector));
  assert.ok(rule, `${selector} の規則が無い`);
  return rule;
}

function valueOf(body, prop) {
  const escaped = prop.replace(/[-]/g, '\\-');
  return new RegExp(`(?:^|[\\s;])${escaped}:\\s*([^;]+);`).exec(body)?.[1].trim();
}

test('本文の枠にキーボードのフォーカスがあるときは、ホバーと同じ量を同じ待ち時間で見せる', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    const focus = ruleOf(rules, focusOf(scope));
    const hover = ruleOf(rules, hoverOf(scope));
    for (const prop of [
      '--ycf-reveal',
      'transition',
      'mask-image',
      '-webkit-mask-image',
      'mask-size',
      'mask-position',
      'mask-repeat',
      'clip-path',
      '-webkit-line-clamp',
      'line-height',
      'max-width',
    ]) {
      assert.ok(valueOf(focus.body, prop), `${scope}: フォーカスの規則に ${prop} がある`);
      assert.equal(valueOf(focus.body, prop), valueOf(hover.body, prop), `${scope}: ${prop} がホバーと同じ`);
    }
  }
});

test('フォーカスの規則はホバーの規則と分け、:has() を使わない', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    const focus = ruleOf(rules, focusOf(scope));
    assert.ok(
      focus.selectors.every((s) => !s.includes(':hover') && !s.includes(':has(')),
      'ホバーの規則や :has() を含む規則と同じ規則にしない（解釈できないセレクタで規則ごと捨てられないため）',
    );
  }
});

test('全文固定の間は、フォーカスがあっても 4 行に戻らない', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    const expanded = ruleOf(rules, focusOf(scope, EXPANDED));
    assert.equal(valueOf(expanded.body, 'mask-image'), 'none');
    assert.equal(valueOf(expanded.body, 'clip-path'), 'none');
    assert.match(expanded.body, /-webkit-line-clamp:\s*unset/);
    // 詳細度が同じでも負けないよう、全文固定の規則はフォーカスの規則より後に置く
    assert.ok(expanded.index > ruleOf(rules, focusOf(scope)).index, '全文固定の規則が後にある');
  }
});

test('フォーカスの位置は本文の枠の親（ytd-expander）の輪郭で示す。本文の枠はマスクと clip-path で輪郭が切れるため', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    const selector = `${scope} ${SHOWN} > #comment-container ytd-expander#expander:has(> #content:focus-visible)`;
    const rule = ruleOf(rules, selector);
    assert.match(rule.body, /outline:\s*[^;]*solid/);
    assert.ok(
      rule.selectors.every((s) => s.includes(':has(')),
      ':has() を解釈しないブラウザで、ほかの規則を巻き込んで捨てられないよう別の規則にする',
    );
  }
});

test('本文の枠の輪郭（outline）を消す規則を書かない', () => {
  assert.doesNotMatch(buildStyles(), /outline:\s*(none|0)\b/);
});
