import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_BUTTON_CLASS } from '../src/selectors.js';
import { buildStyles } from '../src/styles.js';

// NG 登録のボタンをキーボードのフォーカスで見せる規則（issue #18）。
// マウスのクリックでフォーカスが残ったときには出さないよう、:focus-visible だけに反応させる。

/** 動画ページの 2 つと Shorts の 2 つ。styles.js の COMMENTS_SCOPES が作るコメント欄の範囲 */
const SCOPES = [
  'html[data-ycf-shorts] ytd-shorts ytd-comments',
  'ytd-shorts ytd-comments',
  'html[data-ycf-watch] ytd-comments#comments',
  'ytd-watch-flexy ytd-comments#comments',
];

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

test('コメント欄のすべての範囲で、キーボードのフォーカスがあるコメントの NG ボタンを見せる', () => {
  const rules = rulesOf(buildStyles());
  for (const scope of SCOPES) {
    const selector = `${scope} ytd-comment-thread-renderer${SHOWN}:has(:focus-visible) .${BLOCK_BUTTON_CLASS}`;
    const rule = rules.find((r) => r.selectors.includes(selector));
    assert.ok(rule, selector);
    assert.match(rule.body, /display:\s*inline-block\s*!important/, selector);
  }
});

test('マウスのクリックによるフォーカスにも当たる :focus-within では NG ボタンを見せない', () => {
  const rules = rulesOf(buildStyles());
  const focusWithin = rules
    .flatMap((r) => r.selectors)
    .filter((s) => s.includes(':focus-within') && s.includes(BLOCK_BUTTON_CLASS));
  assert.deepEqual(focusWithin, []);
});

test(':has() を解釈しないブラウザでもホバーの規則が無効にならないよう、フォーカスの規則はホバーと別の規則にする', () => {
  const rules = rulesOf(buildStyles());
  const focusRules = rules.filter((r) =>
    r.selectors.some((s) => s.includes(':has(') && s.includes(BLOCK_BUTTON_CLASS)),
  );
  assert.ok(focusRules.length > 0, 'フォーカスで見せる規則がある');
  for (const rule of focusRules) {
    assert.ok(
      rule.selectors.every((s) => s.includes(':has(')),
      rule.selectors.join(',\n'),
    );
  }
});
