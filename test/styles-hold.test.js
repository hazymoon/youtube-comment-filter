import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyles } from '../src/styles.js';

// マウスを離した時点までに見せた量を、離した後も保つ。不快だと判断して離した時点より先は見せない。
// 一度マウスを乗せた（またはフォーカスした）コメントには main.js が印（data-ycf-held）を付け、
// 印のある本文では見せる量の transition を長い待ち時間で止めて、離した時点の量のまま残す。

const css = buildStyles();
const SHOWN = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer[data-ycf-state="shown"]';
const BASE = `${SHOWN} > #comment-container ytd-expander#expander > #content {`;
const HELD = `${SHOWN}[data-ycf-held] > #comment-container ytd-expander#expander > #content`;
const HOVER = `${SHOWN} > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`;
const FOCUS = `${SHOWN} > #comment-container ytd-expander#expander > #content:focus-visible`;
const EXPANDED = `${SHOWN}[data-ycf-expanded] > #comment-container ytd-expander#expander > #content`;

function blockOf(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function declarationOf(block, property) {
  return new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+);`).exec(block)?.[1].trim();
}

test('印のある本文では、見せる量を戻す transition を長い待ち時間で止める', () => {
  const transition = declarationOf(blockOf(HELD), 'transition');
  assert.ok(transition, '印のある本文に transition がある');
  const m = /^--ycf-reveal 0s linear (\d+)s$/.exec(transition);
  assert.ok(m, `時間 0 と待ち時間だけの transition: ${transition}`);
  assert.ok(Number(m[1]) >= 86400, '待ち時間は 1 日以上');
});

test('印のある本文では、見せる量そのものは書かず、離した時点の値を transition に保たせる', () => {
  assert.equal(declarationOf(blockOf(HELD), '--ycf-reveal'), undefined);
});

test('印のある本文では、clip-path を見せる量に連動させて、見せた範囲を描画の対象に残す', () => {
  const clip = declarationOf(blockOf(HELD), 'clip-path');
  assert.equal(clip, declarationOf(blockOf(HOVER), 'clip-path'), 'ホバーと同じ式');
  assert.match(clip, /var\(--ycf-reveal/);
});

test('印の規則は Shorts と動画ページの両方のコメント欄に当てる', () => {
  const start = css.indexOf(HELD);
  const head = css.slice(css.lastIndexOf('}', start) + 1, css.indexOf('{', start));
  assert.match(head, /ytd-shorts|html\[data-ycf-shorts\]/);
  assert.match(head, /ytd-watch-flexy/);
});

test('印の規則はホバー・フォーカス・全文固定の規則より前に置き、それらに上書きされるようにする', () => {
  const held = css.indexOf(HELD);
  assert.ok(held > css.indexOf(BASE), '既定の表示より後');
  for (const later of [HOVER, FOCUS, EXPANDED]) assert.ok(held < css.indexOf(later), later);
});

test('印の無い既定の表示は、文頭だけの clip-path のまま transition を持たない', () => {
  const base = blockOf(BASE);
  assert.doesNotMatch(declarationOf(base, 'clip-path'), /var\(/);
  assert.doesNotMatch(base, /transition/);
});
