import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_BUTTON_CLASS } from '../src/selectors.js';
import { buildStyles } from '../src/styles.js';

// NG 登録のボタンへタブで移れるようにする（issue #18）。
// Chrome はフォーカスを移すとき先に元の要素からフォーカスを外すので、その瞬間に :has(:focus-visible) が外れる。
// ボタンを display:none で隠していると、移る先のボタンがフォーカスできなくなりタブの移動が取りやめになる。
// そのため隠すときも display:none にせず、透明にしてマウスで押せなくするだけにする。

/** 動画ページの 2 つと Shorts の 2 つ。styles.js の COMMENTS_SCOPES が作るコメント欄の範囲 */
const SCOPES = [
  'html[data-ycf-shorts] ytd-shorts ytd-comments',
  'ytd-shorts ytd-comments',
  'html[data-ycf-watch] ytd-comments#comments',
  'ytd-watch-flexy ytd-comments#comments',
];

const THREAD = 'ytd-comment-thread-renderer';
const SHOWN = '[data-ycf-state="shown"]:not([data-ycf-reason="exempt"]) > #comment-container ytd-comment-view-model';

/**
 * CSS を規則ごとのセレクタと宣言に分ける（入れ子の無い規則だけを扱う）。
 * @param {string} css
 * @returns {{ selectors: string[], body: string }[]}
 */
function rulesOf(css) {
  return css
    .split('}')
    .filter((chunk) => chunk.includes('{'))
    .map((chunk) => {
      const [head, body] = chunk.split('{');
      return {
        selectors: head
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        body,
      };
    });
}

/**
 * セレクタを含む規則を探す。
 * @param {{ selectors: string[], body: string }[]} rules
 * @param {string} selector
 */
function ruleOf(rules, selector) {
  const rule = rules.find((r) => r.selectors.includes(selector));
  assert.ok(rule, selector);
  return rule;
}

test('NG ボタンの既定の規則は display:none にせず、透明にしてマウスで押せなくする（タブで移れるようにする）', () => {
  const base = ruleOf(rulesOf(buildStyles()), `.${BLOCK_BUTTON_CLASS}`);
  assert.doesNotMatch(base.body, /display:\s*none/);
  assert.doesNotMatch(base.body, /visibility:\s*hidden/);
  assert.match(base.body, /opacity:\s*0\s*!important/);
  assert.match(base.body, /pointer-events:\s*none\s*!important/);
});

test('ホバーとキーボードのフォーカスで見せる規則は、不透明にしてマウスで押せるようにする', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    for (const pseudo of [':hover', ':has(:focus-visible)']) {
      const rule = ruleOf(rules, `${scope} ${THREAD}${SHOWN}${pseudo} .${BLOCK_BUTTON_CLASS}`);
      assert.match(rule.body, /opacity:\s*1\s*!important/, pseudo);
      assert.match(rule.body, /pointer-events:\s*auto\s*!important/, pseudo);
    }
  }
});

test('ボタン自身にキーボードのフォーカスがあるときも、同じ範囲と条件で見せる（:has() に頼らない）', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    const selector = `${scope} ${THREAD}${SHOWN} .${BLOCK_BUTTON_CLASS}:focus-visible`;
    const rule = ruleOf(rules, selector);
    assert.ok(
      rule.selectors.every((s) => !s.includes(':has(')),
      ':has() を解釈しないブラウザで規則ごと捨てられないよう、:has() を含む規則と分ける',
    );
    assert.match(rule.body, /opacity:\s*1\s*!important/, selector);
    assert.match(rule.body, /pointer-events:\s*auto\s*!important/, selector);
  }
});

test('判定から外したコメントと表示中でないコメントの NG ボタンは display:none にし、タブでも移れないようにする', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    for (const condition of ['[data-ycf-state="shown"][data-ycf-reason="exempt"]', ':not([data-ycf-state="shown"])']) {
      const selector = `${scope} ${THREAD}${condition} > #comment-container .${BLOCK_BUTTON_CLASS}`;
      const rule = ruleOf(rules, selector);
      assert.ok(
        rule.selectors.every((s) => !s.includes(':has(')),
        selector,
      );
      assert.match(rule.body, /display:\s*none\s*!important/, selector);
    }
  }
});
