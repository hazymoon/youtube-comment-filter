import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyles } from '../src/styles.js';

const css = buildStyles();

/**
 * セレクタで始まる規則の宣言ブロックを返す。
 * @param {string} selector セレクタ（`{` の直前まで）
 * @returns {string}
 */
function blockOf(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

test('件数バーの色は YouTube の現行の色変数（--yt-sys-color-baseline--*）を参照する', () => {
  assert.match(blockOf('#ycf-bar'), /color:\s*var\(--yt-sys-color-baseline--text-primary\b/);
  assert.match(blockOf('#ycf-bar .ycf-status'), /color:\s*var\(--yt-sys-color-baseline--text-secondary\b/);
});

test('ダークモードでは色変数が無くても明るい文字色に落ちる', () => {
  // 変数が未定義のときに使われる最後のフォールバック値を取り出す
  const fallbackColor = (block) => block.match(/(?:^|;|\s)color:[^;]*?(#[0-9a-f]{3,6})\)*\s*;/i)?.[1];
  assert.equal(fallbackColor(blockOf('html[dark] #ycf-bar')), '#f1f1f1');
  assert.equal(fallbackColor(blockOf('html[dark] #ycf-bar button')), '#f1f1f1');
  assert.equal(fallbackColor(blockOf('html[dark] #ycf-bar .ycf-status')), '#aaa');
});
