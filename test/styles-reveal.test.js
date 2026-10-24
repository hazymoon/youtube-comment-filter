import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_DELAY_MS, REVEAL_MS_PER_LINE } from '../src/config.js';
import { buildStyles } from '../src/styles.js';

// ホバーで全文が一度に見えないよう、少し待ってから 1 行ずつ左から右へ見せていく。
// 読む順に見えるので、不快だと判断した時点でマウスを外せば残りは見えない。外したらすぐ文頭だけに戻す。

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

test('待ち時間と 1 行あたりの時間は 0 以上の整数', () => {
  assert.ok(Number.isInteger(REVEAL_DELAY_MS) && REVEAL_DELAY_MS >= 0);
  assert.ok(Number.isInteger(REVEAL_MS_PER_LINE) && REVEAL_MS_PER_LINE > 0);
});

test('見せる量を表すカスタムプロパティを、アニメーションできる数値として登録する', () => {
  assert.match(css, /@property --ycf-reveal\s*\{[^}]*syntax:\s*'<number>'[^}]*initial-value:\s*0/);
});

test('ホバーでは待ち時間の後に 4 行ぶんを順に見せ、行ごとのマスクで左から右へ見せる', () => {
  const hover = blockOf(HOVER);
  assert.match(hover, /--ycf-reveal:\s*4/);
  assert.match(
    hover,
    new RegExp(`transition:\\s*--ycf-reveal ${4 * REVEAL_MS_PER_LINE}ms linear ${REVEAL_DELAY_MS}ms`),
  );
  const mask = /(?:^|\s)mask-image:\s*([^;]+);/.exec(hover);
  assert.ok(mask, 'mask-image がある');
  assert.equal(mask[1].match(/linear-gradient\(to right/g)?.length, 4, '1 行に 1 つずつ');
  assert.match(hover, /mask-position:\s*0 0,\s*0 2rem,\s*0 4rem,\s*0 6rem/);
  // マスクの行の高さと本文の行の高さを一致させる
  assert.match(hover, /line-height:\s*2rem\s*!important/);
});

test('マウスを外したらすぐ戻すため、既定の表示には見せる量の transition を書かない', () => {
  assert.doesNotMatch(blockOf(BASE), /transition/);
});

test('全文固定ではマスクを外す', () => {
  assert.match(blockOf(EXPANDED), /(?:^|\s)mask-image:\s*none/);
});
