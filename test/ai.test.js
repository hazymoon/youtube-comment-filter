import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchInput,
  buildInitialPrompts,
  buildResponseSchema,
  parseBatchResponse,
  promptVersion,
} from '../src/ai.js';
import { AI_CATEGORIES } from '../src/config.js';

const NAMES = AI_CATEGORIES.map((category) => category.name);

/**
 * buildBatchInput の入力文から JSON 部分を取り出す。
 * @param {string} input 入力文
 */
function parseInputPayload(input) {
  const [header, ...rest] = input.split('\n');
  assert.equal(header, '次のコメントを判定してください。');
  return JSON.parse(rest.join('\n'));
}

test('buildBatchInput は ID を連番に置き換え、idMap で元に戻せる', () => {
  const { input, idMap } = buildBatchInput(
    [
      { id: 'UgxLongCommentId1', text: 'ひとつめ' },
      { id: 'UgxLongCommentId2', text: 'ふたつめ' },
    ],
    500,
  );
  assert.deepEqual(parseInputPayload(input), [
    { id: 'c0', text: 'ひとつめ' },
    { id: 'c1', text: 'ふたつめ' },
  ]);
  assert.deepEqual(
    [...idMap],
    [
      ['c0', 'UgxLongCommentId1'],
      ['c1', 'UgxLongCommentId2'],
    ],
  );
});

test('buildBatchInput は code point 単位で切り詰め、サロゲートペアを壊さない', () => {
  const { input } = buildBatchInput([{ id: 'x', text: '😀😀😀あいう' }], 4);
  const [{ text }] = parseInputPayload(input);
  assert.equal(text, '😀😀😀あ');
  assert.equal(text.isWellFormed(), true);
});

test('parseBatchResponse: 正常な応答', () => {
  const idMap = new Map([
    ['c0', 'A'],
    ['c1', 'B'],
  ]);
  const result = parseBatchResponse(
    JSON.stringify([
      { id: 'c0', hide: false, category: null },
      { id: 'c1', hide: true, category: '暴言' },
    ]),
    idMap,
    NAMES,
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(
    [...result.verdicts],
    [
      ['A', { hide: false, category: null }],
      ['B', { hide: true, category: '暴言' }],
    ],
  );
  assert.deepEqual(result.missing, []);
});

test('parseBatchResponse: JSON でない・配列でないときは error を入れて全件 missing', () => {
  const idMap = new Map([
    ['c0', 'A'],
    ['c1', 'B'],
  ]);
  for (const text of ['not json', '{"id":"c0","hide":true,"category":null}', 'null']) {
    const result = parseBatchResponse(text, idMap, NAMES);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.verdicts.size, 0);
    assert.deepEqual(result.missing, ['A', 'B']);
  }
});

test('parseBatchResponse: 余計な id は無視し、重複は最初の 1 件、欠落は missing', () => {
  const idMap = new Map([
    ['c0', 'A'],
    ['c1', 'B'],
    ['c2', 'C'],
  ]);
  const result = parseBatchResponse(
    JSON.stringify([
      { id: 'c9', hide: true, category: '暴言' },
      { id: 'A', hide: true, category: '暴言' },
      { id: 'c0', hide: true, category: '暴言' },
      { id: 'c0', hide: false, category: null },
      'garbage',
      null,
      { id: 'c2', hide: false, category: null },
    ]),
    idMap,
    NAMES,
  );
  assert.deepEqual(
    [...result.verdicts],
    [
      ['A', { hide: true, category: '暴言' }],
      ['C', { hide: false, category: null }],
    ],
  );
  assert.deepEqual(result.missing, ['B']);
});

test('parseBatchResponse: hide が boolean でない要素は missing、enum 外の category は null', () => {
  const idMap = new Map([
    ['c0', 'A'],
    ['c1', 'B'],
  ]);
  const result = parseBatchResponse(
    JSON.stringify([
      { id: 'c0', hide: 'true', category: '暴言' },
      { id: 'c1', hide: true, category: '存在しないカテゴリ' },
    ]),
    idMap,
    NAMES,
  );
  assert.deepEqual([...result.verdicts], [['B', { hide: true, category: null }]]);
  assert.deepEqual(result.missing, ['A']);
});

test('buildResponseSchema は実測で通った形を返す', () => {
  assert.deepEqual(
    buildResponseSchema([
      { name: 'x', description: '' },
      { name: 'y', description: '' },
    ]),
    {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          hide: { type: 'boolean' },
          category: { type: ['string', 'null'], enum: ['x', 'y', null] },
        },
        required: ['id', 'hide', 'category'],
        additionalProperties: false,
      },
    },
  );
});

test('promptVersion はカテゴリの変更で変わる', () => {
  const base = promptVersion(AI_CATEGORIES);
  assert.match(base, /^[0-9a-f]{8}$/);
  assert.equal(promptVersion(AI_CATEGORIES), base);
  const changedDescription = AI_CATEGORIES.map((category, index) =>
    index === 0 ? { ...category, description: `${category.description}（変更）` } : category,
  );
  assert.notEqual(promptVersion(changedDescription), base);
  assert.notEqual(promptVersion(AI_CATEGORIES.slice(1)), base);
});

test('buildInitialPrompts は system と対話例 1 組を返す', () => {
  const prompts = buildInitialPrompts(AI_CATEGORIES);
  assert.deepEqual(
    prompts.map((prompt) => prompt.role),
    ['system', 'user', 'assistant'],
  );

  const system = prompts[0].content;
  for (const category of AI_CATEGORIES) {
    assert.ok(system.includes(category.name));
    assert.ok(system.includes(category.description));
  }
  assert.ok(system.includes('言葉が強くても人や集団を攻撃していなければ hide は false'));

  // The example uses the same input format as real batches, and the answer covers every id.
  const exampleInput = parseInputPayload(prompts[1].content);
  const exampleOutput = JSON.parse(prompts[2].content);
  assert.deepEqual(
    exampleOutput.map((v) => v.id),
    exampleInput.map((v) => v.id),
  );
  assert.ok(exampleOutput.some((v) => v.hide === false));
  assert.ok(exampleOutput.some((v) => v.hide === true && NAMES.includes(v.category)));
  for (const verdict of exampleOutput) {
    assert.equal(verdict.category === null, verdict.hide === false);
  }
});

test('buildInitialPrompts の対話例は spike の検証用コメントを含まない', () => {
  const spikeTexts = [
    'この方法には反対です。安全面の説明がもう少し欲しかった。',
    'お前みたいな頭の悪いやつは一生黙ってろ。',
  ];
  const content = buildInitialPrompts(AI_CATEGORIES)
    .map((prompt) => prompt.content)
    .join('\n');
  for (const text of spikeTexts) assert.equal(content.includes(text), false);
});

test('buildInitialPrompts はカテゴリを書き換えても対話例のカテゴリが enum に収まる', () => {
  const categories = [{ name: '独自カテゴリ', description: '説明' }];
  const output = JSON.parse(buildInitialPrompts(categories)[2].content);
  for (const verdict of output) {
    assert.ok(verdict.category === null || verdict.category === '独自カテゴリ');
  }
});
