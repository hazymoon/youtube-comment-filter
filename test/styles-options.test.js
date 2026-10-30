import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHARS, REVEAL_DELAY_MS, REVEAL_MS_PER_LINE } from '../src/config.js';
import { buildStyles } from '../src/styles.js';

// 文頭の文字数・待ち時間・1 行あたりの時間は「値」タブで変えられるので、CSS は読んだ値から作る。
// 引数を省いたときは config.js の既定値で作る。

const SHOWN = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer[data-ycf-state="shown"]';
const BASE = `${SHOWN} > #comment-container ytd-expander#expander > #content {`;
const HOVER = `${SHOWN} > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`;

function blockOf(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

test('引数を省くと config.js の既定値で作る', () => {
  assert.equal(
    buildStyles(),
    buildStyles({ previewChars: PREVIEW_CHARS, revealDelayMs: REVEAL_DELAY_MS, revealMsPerLine: REVEAL_MS_PER_LINE }),
  );
});

test('previewChars を渡すと、既定の表示で見せる文頭の幅に反映する', () => {
  const css = buildStyles({ previewChars: 37 });
  const block = blockOf(css, BASE);
  assert.match(block, /(?:^|\s)mask-image:[^;]*max\(37em,/);
  assert.match(block, /clip-path:\s*inset\(0 calc\(100% - 37em\)/);
  assert.doesNotMatch(css, new RegExp(`\\b${PREVIEW_CHARS}em\\b`));
});

test('revealDelayMs と revealMsPerLine を渡すと、ホバーの見せ方の時間に反映する', () => {
  const css = buildStyles({ revealDelayMs: 120, revealMsPerLine: 450 });
  const block = blockOf(css, HOVER);
  // 4 行ぶんを 1 行あたりの時間で見せる
  assert.match(block, /transition:\s*--ycf-reveal 1800ms linear 120ms/);
});

test('一部だけ渡すと、残りは既定値で作る', () => {
  const css = buildStyles({ revealDelayMs: 0 });
  const block = blockOf(css, HOVER);
  assert.match(block, new RegExp(`transition:\\s*--ycf-reveal ${4 * REVEAL_MS_PER_LINE}ms linear 0ms`));
  assert.match(blockOf(css, BASE), new RegExp(`max\\(${PREVIEW_CHARS}em,`));
});
