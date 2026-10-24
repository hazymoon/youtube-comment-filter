import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHARS } from '../src/config.js';
import { buildStyles } from '../src/styles.js';

// マスクは見た目だけを隠し、クリック・ホバーの対象からは外さない。既定の表示で透明な 2 行目以降や
// 1 行目の文頭より右にあるリンクが反応しないよう、clip-path で描画とクリックの対象を見せた範囲に絞る。
// clip-path は単純な式だけで書き、マスクの式を解釈できないブラウザでも既定の表示は文頭だけに留める。

const css = buildStyles();
const SHOWN = 'ytd-watch-flexy ytd-comments#comments ytd-comment-thread-renderer[data-ycf-state="shown"]';
const BASE = `${SHOWN} > #comment-container ytd-expander#expander > #content {`;
const HOVER = `${SHOWN} > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`;
const EXPANDED = `${SHOWN}[data-ycf-expanded] > #comment-container ytd-expander#expander > #content`;
const EXPANDED_HOVER = `${SHOWN}[data-ycf-expanded] > #comment-container ytd-comment-view-model:hover ytd-expander#expander > #content`;
const LINE_HEIGHT = '2rem';

function blockOf(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が CSS に無い`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function clipOf(block) {
  return /(?:^|[\s;])clip-path:\s*([^;]+);/.exec(block)?.[1].trim();
}

test('既定の表示は clip-path で 1 行目の文頭だけを描画とクリックの対象にする', () => {
  assert.equal(clipOf(blockOf(BASE)), `inset(0 calc(100% - ${PREVIEW_CHARS}em) calc(100% - ${LINE_HEIGHT}) 0)`);
});

test('既定の表示の clip-path は見せる量の変数や min()/max() に頼らない', () => {
  // マスクの式を解釈できないブラウザでも clip-path だけで文頭に絞れるよう、単純な式で書く
  const clip = clipOf(blockOf(BASE));
  assert.ok(clip, '既定の表示に clip-path がある');
  assert.doesNotMatch(clip, /var\(|min\(|max\(/);
});

test('ホバーでは clip-path を見せる量に連動させ、まだ見せていない行をクリックの対象から外す', () => {
  const clip = clipOf(blockOf(HOVER));
  assert.ok(clip, 'ホバーに clip-path がある');
  assert.notEqual(clip, clipOf(blockOf(BASE)));
  assert.match(clip, /^inset\(/);
  // 下端は見せる量に 1 行を足した高さ。見せている途中の行と 1 行目は常に含む
  assert.ok(clip.includes(`calc(100% - (var(--ycf-reveal, 0) + 1) * ${LINE_HEIGHT})`), clip);
  // 右端は 1 行目を見せ終えるまで、見せた幅（文頭の PREVIEW_CHARS 文字ほど以上）に合わせる
  assert.ok(clip.includes(`min(100% - ${PREVIEW_CHARS}em, (1 - var(--ycf-reveal, 0)) * 100%)`), clip);
  assert.ok(clip.includes('max(0px,'), clip);
});

test('全文固定では、ホバー中も clip-path を外す', () => {
  assert.equal(clipOf(blockOf(EXPANDED)), 'none');
  assert.equal(clipOf(blockOf(EXPANDED_HOVER)), 'none');
});
