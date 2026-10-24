import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHARS } from '../src/config.js';
import { buildStyles } from '../src/styles.js';

// ホバーで本文の高さが伸縮すると、コメント欄のレイアウトが上下に動いて読みにくい（#15）。
// 既定の表示でもホバーと同じ行数・幅の箱を確保し、見せる量は行ごとのマスクだけで変える。
// 既定では 1 行目の文頭 PREVIEW_CHARS 文字ほどだけが見え、2 行目以降はマスクで隠れる。

const css = buildStyles();
const SHOWN = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer[data-ycf-state="shown"]';
const BASE = `${SHOWN} > #comment-container ytd-expander#expander > #content {`;
const HOVER = `${SHOWN} > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`;
const EXPANDED = `${SHOWN}[data-ycf-expanded] > #comment-container ytd-expander#expander > #content`;

function blockOf(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

/**
 * 宣言ブロックから、接頭辞の付かないプロパティの値を返す（-webkit- 付きのものは prop に含めて渡す）。
 * @param {string} block 宣言ブロック
 * @param {string} prop プロパティ名
 * @returns {string | undefined}
 */
function valueOf(block, prop) {
  const escaped = prop.replace(/[-]/g, '\\-');
  return new RegExp(`(?:^|[\\s;])${escaped}:\\s*([^;]+);`).exec(block)?.[1].trim();
}

test('既定とホバーで行数・幅・行の高さが同じなので、ホバーしても高さが変わらない', () => {
  const base = blockOf(BASE);
  const hover = blockOf(HOVER);
  for (const prop of ['-webkit-line-clamp', 'max-width', 'line-height']) {
    assert.equal(valueOf(base, prop), valueOf(hover, prop), `${prop} が既定とホバーで同じ`);
  }
  assert.equal(valueOf(base, '-webkit-line-clamp'), '4 !important');
  assert.equal(valueOf(base, 'max-width'), 'none !important');
});

test('既定の表示にもホバーと同じ行ごとのマスクを掛け、2 行目以降を隠す', () => {
  const base = blockOf(BASE);
  const hover = blockOf(HOVER);
  for (const prop of ['mask-image', '-webkit-mask-image', 'mask-size', 'mask-position', 'mask-repeat']) {
    assert.ok(valueOf(base, prop), `既定の表示に ${prop} がある`);
    assert.equal(valueOf(base, prop), valueOf(hover, prop), `${prop} が既定とホバーで同じ`);
  }
  const mask = valueOf(base, 'mask-image');
  assert.equal(mask.match(/linear-gradient\(to right/g)?.length, 4, '1 行に 1 つずつ');
  // 見せる量が 0 でも 1 行目の文頭 PREVIEW_CHARS 文字ほどは見せる。幅の制限の代わりに、短文の全文を既定で見せない
  assert.match(mask, new RegExp(`max\\(${PREVIEW_CHARS}em,`));
});

test('見せる量の登録が効かないブラウザでも、既定の表示はマスクで隠れたままになる', () => {
  // var() が未定義だと mask-image が無効になり、マスクが外れて 4 行が見えてしまう。既定値 0 を持たせる
  const mask = valueOf(blockOf(BASE), 'mask-image');
  assert.doesNotMatch(mask, /var\(--ycf-reveal\)/);
  assert.match(mask, /var\(--ycf-reveal,\s*0\)/);
});

test('既定の表示は見せる量を変えず transition も書かない。ホバーで見せる量だけを増やす', () => {
  const base = blockOf(BASE);
  assert.doesNotMatch(base, /transition/);
  assert.doesNotMatch(base, /--ycf-reveal:/);
  assert.match(blockOf(HOVER), /--ycf-reveal:\s*4/);
});

test('全文固定ではマスクを外し、行数の制限を解除する', () => {
  const expanded = blockOf(EXPANDED);
  assert.equal(valueOf(expanded, 'mask-image'), 'none');
  assert.equal(valueOf(expanded, '-webkit-mask-image'), 'none');
  assert.match(expanded, /-webkit-line-clamp:\s*unset/);
});
