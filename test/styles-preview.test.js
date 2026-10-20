import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHARS } from '../src/config.js';
import { buildStyles } from '../src/styles.js';

// 1 行に収まる短いコメントは、既定の 1 行表示で全文が見えてしまう。
// 既定では文頭の PREVIEW_CHARS 文字ほどの幅だけを見せ、ホバーと全文固定で幅の制限を外す。

const css = buildStyles();
const SHOWN = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer[data-ycf-state="shown"]';

function blockOf(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

test('PREVIEW_CHARS は正の整数', () => {
  assert.ok(Number.isInteger(PREVIEW_CHARS) && PREVIEW_CHARS > 0);
});

test('既定の表示は文頭の PREVIEW_CHARS 文字ほどの幅に制限する', () => {
  const block = blockOf(`${SHOWN} > #comment-container ytd-expander#expander > #content {`);
  assert.match(block, new RegExp(`max-width:\\s*${PREVIEW_CHARS}em\\s*!important`));
});

test('ホバーと全文固定では幅の制限を外す', () => {
  assert.match(
    blockOf(`${SHOWN} > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`),
    /max-width:\s*none\s*!important/,
  );
  assert.match(
    blockOf(`${SHOWN}[data-ycf-expanded] > #comment-container ytd-expander#expander > #content`),
    /max-width:\s*none\s*!important/,
  );
});
