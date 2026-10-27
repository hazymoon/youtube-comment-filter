import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_BUTTON_CLASS } from '../src/selectors.js';
import { buildStyles } from '../src/styles.js';

// NG 登録のボタンにキーボードで移動できるようにする（issue #18）

const T = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer';

/**
 * 指定のセレクタを含む規則の宣言部分を返す。
 * @param {string} css
 * @param {string} selector
 */
function declarationsOf(css, selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, selector);
  const open = css.indexOf('{', at);
  return css.slice(open, css.indexOf('}', open));
}

test('コメント内にキーボードのフォーカスがあるときも、判定から外したもの以外の表示中のコメントの NG ボタンを見せる', () => {
  const css = buildStyles();
  const focusSelector = `${T}[data-ycf-state="shown"]:not([data-ycf-reason="exempt"]) > #comment-container ytd-comment-view-model:has(:focus-visible) .${BLOCK_BUTTON_CLASS}`;
  assert.match(declarationsOf(css, focusSelector), /display:\s*inline-block\s*!important/);
});

test('フォーカスで見せるセレクタはすべて thread から #comment-container を直下結合子でたどる（返信にフォーカスしても親のボタンを出さない）', () => {
  const css = buildStyles();
  const selectors = css
    .split(/[{}]/)
    .flatMap((part) => part.split(','))
    .map((s) => s.trim())
    .filter((s) => s.includes(':focus-visible') && s.includes(BLOCK_BUTTON_CLASS));
  assert.ok(selectors.length > 0, 'フォーカスで見せるセレクタがある');
  for (const selector of selectors) {
    assert.match(
      selector,
      /\[data-ycf-state="shown"\]:not\(\[data-ycf-reason="exempt"\]\) > #comment-container ytd-comment-view-model(:has\(:focus-visible\) | \.ycf-block:focus-visible$)/,
      selector,
    );
  }
});
