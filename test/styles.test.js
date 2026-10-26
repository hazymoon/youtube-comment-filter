import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyles } from '../src/styles.js';

const css = buildStyles();
const T = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer';

/**
 * セレクタに続く宣言ブロックを返す（そのセレクタを含む規則の { } の中身）。
 * @param {string} selector セレクタの一部
 * @returns {string}
 */
function blockOf(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

test('data-ycf-open が無いときコメント欄を visibility:hidden で閉じる', () => {
  assert.match(blockOf('html:not([data-ycf-open]) ytd-watch-flexy ytd-comments#comments'), /visibility:\s*hidden/);
});

test('属性なしと pending の thread は、直下の #comment-container を隠して 1 行の帯にし、直下の #replies も隠す', () => {
  for (const thread of [`${T}:not([data-ycf-state])`, `${T}[data-ycf-state="pending"]`]) {
    assert.ok(css.includes(`${thread} > #comment-container`), `${thread} > #comment-container`);
    assert.ok(css.includes(`${thread} > #replies`), `${thread} > #replies`);
    assert.ok(css.includes(`${thread} > #comment-container::before`));
  }
  const container = blockOf(`${T}:not([data-ycf-state]) > #comment-container,`);
  assert.match(container, /visibility:\s*hidden/);
  assert.match(container, /max-height:/);
  const band = blockOf(`${T}[data-ycf-state="pending"] > #comment-container::before`);
  assert.match(band, /content:\s*"判定中…"/);
  // 閉じた欄の中で帯だけが浮き出ないよう、visible は欄を開いているときの規則にだけ書く
  assert.doesNotMatch(band, /visibility:\s*visible/);
  assert.match(
    blockOf(`html[data-ycf-open] ${T}[data-ycf-state="pending"] > #comment-container::before`),
    /visibility:\s*visible/,
  );
  assert.match(blockOf(`${T}[data-ycf-state="pending"] > #replies`), /display:\s*none/);
});

test('hidden の thread は display:none', () => {
  assert.match(blockOf(`${T}[data-ycf-state="hidden"] {`), /display:\s*none/);
});

test('shown の本文は既定もホバーも 4 行の箱・全文固定で解除し、#more / #less を隠す', () => {
  const content = `${T}[data-ycf-state="shown"] > #comment-container ytd-expander#expander > #content`;
  assert.match(blockOf(`${content} {`), /-webkit-line-clamp:\s*4/);
  assert.match(
    blockOf(
      `${T}[data-ycf-state="shown"] > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`,
    ),
    /-webkit-line-clamp:\s*4/,
  );
  assert.match(
    blockOf(`${T}[data-ycf-state="shown"][data-ycf-expanded] > #comment-container ytd-expander#expander > #content`),
    /-webkit-line-clamp:\s*unset/,
  );
  assert.ok(
    css.includes(`${T}[data-ycf-state="shown"] > #comment-container ytd-expander#expander > tp-yt-paper-button#more`),
  );
  assert.match(
    blockOf(`${T}[data-ycf-state="shown"] > #comment-container ytd-expander#expander > tp-yt-paper-button#less`),
    /display:\s*none/,
  );
});

test('thread から #comment-container / #replies へは必ず直下結合子で書く', () => {
  assert.doesNotMatch(css, /ytd-comment-thread-renderer(?:\[[^\]]*\]|:not\([^)]*\))*\s+#(?:comment-container|replies)/);
});

test('件数バーは YouTube のテーマ変数で色を指定する', () => {
  const bar = blockOf('#ycf-bar {');
  assert.match(bar, /var\(--yt-spec-text-primary/);
});
