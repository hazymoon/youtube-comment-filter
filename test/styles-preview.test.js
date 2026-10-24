import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHARS } from '../src/config.js';
import { buildStyles } from '../src/styles.js';

// 1 行に収まる短いコメントは、既定の 1 行表示で全文が見えてしまう。
// 既定では 1 行目のマスクで文頭の PREVIEW_CHARS 文字ほどだけを見せる。
// 高さをホバーの前後で変えないよう、幅（max-width）ではなくマスクで見せる量を絞る。
// 既定・ホバー・全文固定の区別（クリックの対象を絞る clip-path）は styles-clip.test.js で確かめる。

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

test('既定の表示は 1 行目のマスクで文頭の PREVIEW_CHARS 文字ほどだけを見せる', () => {
  const block = blockOf(`${SHOWN} > #comment-container ytd-expander#expander > #content {`);
  assert.match(block, new RegExp(`(?:^|\\s)mask-image:[^;]*max\\(${PREVIEW_CHARS}em,`));
});

test('ホバーと全文固定でも幅を制限しない', () => {
  assert.match(
    blockOf(`${SHOWN} > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`),
    /max-width:\s*none\s*!important/,
  );
  assert.match(
    blockOf(`${SHOWN}[data-ycf-expanded] > #comment-container ytd-expander#expander > #content`),
    /max-width:\s*none\s*!important/,
  );
});
