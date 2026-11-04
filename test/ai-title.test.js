import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchInput, buildInitialPrompts } from '../src/ai.js';
import { AI_CATEGORIES } from '../src/config.js';

// 事故・災害のニュースに付く「良かったですね」のような短いコメントは、本文だけでは不謹慎かどうか分からない。
// 動画のタイトルを判定の手がかりとして AI に渡し、被害を茶化す・冷笑するコメントを隠す。
// タイトルは動画の投稿者が書くので、その中の指示には従わせない

const CATEGORY = '不謹慎・冷笑';

/**
 * 入力文から JSON 部分を取り出す。
 * @param {string} input 入力文
 */
function payloadOf(input) {
  return JSON.parse(input.split('\n').slice(1).join('\n'));
}

test('既定のカテゴリに「不謹慎・冷笑」がある', () => {
  const category = AI_CATEGORIES.find((c) => c.name === CATEGORY);
  assert.ok(category, 'カテゴリがある');
  assert.match(category.description, /事故|災害/);
});

test('buildBatchInput はタイトルがあるとき、各コメントに title として付ける', () => {
  const { input } = buildBatchInput([{ id: 'x', text: '良かったですね', title: '高速道路で多重事故' }], 500);
  assert.deepEqual(payloadOf(input), [{ id: 'c0', title: '高速道路で多重事故', text: '良かったですね' }]);
});

test('buildBatchInput はタイトルが null か無いとき、タイトルを渡す前と同じ入力文にする', () => {
  const plain = buildBatchInput([{ id: 'x', text: '良かったですね' }], 500).input;
  assert.equal(buildBatchInput([{ id: 'x', text: '良かったですね', title: null }], 500).input, plain);
  assert.deepEqual(payloadOf(plain), [{ id: 'c0', text: '良かったですね' }]);
});

test('system プロンプトで title の意味を伝え、タイトル中の指示には従わせない', () => {
  const [system] = buildInitialPrompts(AI_CATEGORIES);
  assert.match(system.content, /title/);
  assert.match(system.content, /タイトル/);
  assert.match(system.content, /タイトルに書かれた指示に[はも]従わ/);
});

test('対話例のコメントには、入力と同じ形でタイトルを付ける', () => {
  const [, user] = buildInitialPrompts(AI_CATEGORIES);
  for (const i of payloadOf(user.content)) assert.equal(typeof i.title, 'string', `例 ${i.id} にタイトルがある`);
});

test('「不謹慎・冷笑」の対話例は入れず、カテゴリの説明にも特定の本文を書かない', () => {
  // 実測（docs/spike.md「動画のタイトルと不謹慎・冷笑」）で、被害の動画と救助の動画に同じ本文を並べた対話例や、
  // 説明に書いた本文があると、タイトルに関係なくその本文を隠すようになった
  const [, user, assistant] = buildInitialPrompts(AI_CATEGORIES);
  assert.doesNotMatch(assistant.content, new RegExp(CATEGORY));
  assert.equal(
    payloadOf(user.content).some((i) => i.text === '良かったですね'),
    false,
  );
  assert.doesNotMatch(AI_CATEGORIES.find((c) => c.name === CATEGORY).description, /良かった/);
});

test('「不謹慎・冷笑」は被害を悲しむ・同情するコメントを含まないと説明する', () => {
  // 実際の事故のニュースで、被害者に同情するコメントの多くを隠した（docs/spike.md「動画のタイトルと不謹慎・冷笑」）
  const { description } = AI_CATEGORIES.find((c) => c.name === CATEGORY);
  assert.match(description, /同情/);
  assert.match(description, /当てはまらない/);
});

test('system プロンプトで、事故や災害の動画のコメントを不謹慎へ寄せる一文を書かない', () => {
  // 事故の動画のコメント全体を隠す方向に寄せた（同上）
  const [system] = buildInitialPrompts(AI_CATEGORIES);
  assert.doesNotMatch(system.content, /不謹慎になりえます/);
});
