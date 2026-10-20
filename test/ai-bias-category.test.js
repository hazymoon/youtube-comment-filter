import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialPrompts } from '../src/ai.js';
import { AI_CATEGORIES } from '../src/config.js';

// 集団や出来事への一方的な決めつけも隠す（利用者の方針）。攻撃的な言葉が無くても隠す対象にするため、
// カテゴリを足し、指示文と対話例で「具体的な批判は表示・一方的な決めつけは非表示」を示す。

const BIAS = '偏見・決めつけ';

test('既定のカテゴリに「偏見・決めつけ」がある', () => {
  const category = AI_CATEGORIES.find((c) => c.name === BIAS);
  assert.ok(category);
  assert.ok(category.description.includes('決めつけ'));
});

test('指示文は、一方的に断定・決めつける主張をカテゴリに当てはまれば hide にすると示す', () => {
  const system = buildInitialPrompts(AI_CATEGORIES)[0].content;
  assert.ok(system.includes('一方的に断定'));
});

test('対話例は、決めつけの例を「偏見・決めつけ」で隠し、出来事への中立な感想は表示にする', () => {
  const prompts = buildInitialPrompts(AI_CATEGORIES);
  const input = JSON.parse(prompts[1].content.slice(prompts[1].content.indexOf('\n') + 1));
  const output = JSON.parse(prompts[2].content);
  assert.ok(output.some((v) => v.hide === true && v.category === BIAS));
  const neutral = input.find((v) => v.text.includes('続報'));
  assert.ok(neutral, '出来事への中立な感想の例がある');
  assert.equal(output.find((v) => v.id === neutral.id).hide, false);
});

test('「偏見・決めつけ」が無いカテゴリでは、決めつけの例を対話例に入れない', () => {
  const categories = [{ name: '人格攻撃・侮辱', description: '侮辱' }];
  const output = JSON.parse(buildInitialPrompts(categories)[2].content);
  assert.ok(output.every((v) => v.category === null || v.category === '人格攻撃・侮辱'));
  assert.ok(output.every((v) => !(v.hide === true && v.category === null)));
});
