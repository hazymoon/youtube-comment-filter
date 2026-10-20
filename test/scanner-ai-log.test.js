import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

// DEBUG のとき、AI が隠したコメントのカテゴリと本文の冒頭を出す（工程 3 で AI の誤判定を確かめるため）。
// キャッシュの判定で隠したときも出す。出力は利用者のブラウザのコンソールだけで、保存はしない。

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 */
function el({ tag = 'div', id = '', text = '', children = [], query = {}, data, polymerController } = {}) {
  const attrs = new Map();
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    textContent: text,
    data,
    polymerController,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    querySelector: (selector) => query[selector] ?? null,
    closest(selector) {
      for (let n = node; n; n = n.parentElement) {
        if (n.tagName.toLowerCase() === selector) return n;
      }
      return null;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 偽の thread を作る。
 * @param {{ id?: string, text?: string }} [options]
 */
function makeThread({ id = 'c1', text = '本文' } = {}) {
  const content = el({ tag: 'yt-attributed-string', text });
  const author = el({ tag: 'a' });
  author.setAttribute('href', '/@alice');
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: { [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: author },
    data: { commentId: id },
    polymerController: { data: {}, __data: { commentEntity: { author: { channelId: null } } } },
  });
  content.parentElement = viewModel;
  return el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
}

function makeLoggingProcessor({ cached = null, ngWords = [] } = {}) {
  const logs = [];
  const processor = createThreadProcessor({
    rules: compileRules({ ngWords }),
    cache: { get: () => cached, set() {} },
    getAiMode: () => 'ready',
    debugLog: (...args) => logs.push(args),
  });
  return { processor, logs };
}

const aiHiddenLogs = (logs) => logs.filter(([label]) => label === 'AI が隠したコメント');

test('AI の判定で隠したら、カテゴリと本文の冒頭を出す', () => {
  const { processor, logs } = makeLoggingProcessor();
  const thread = makeThread({ text: '隠される本文' });
  processor.processThreads([thread]);
  processor.applyVerdict([thread], 'c1', { hide: true, category: '暴言' }, { id: 'c1', text: '隠される本文' });
  assert.deepEqual(aiHiddenLogs(logs), [['AI が隠したコメント', '暴言', '隠される本文']]);
});

test('キャッシュの判定で隠したときも出す', () => {
  const { processor, logs } = makeLoggingProcessor({ cached: { hide: true, category: '煽り・挑発' } });
  processor.processThreads([makeThread({ text: '前に隠した本文' })]);
  assert.deepEqual(aiHiddenLogs(logs), [['AI が隠したコメント', '煽り・挑発', '前に隠した本文']]);
});

test('本文の冒頭は 60 文字までにする', () => {
  const { processor, logs } = makeLoggingProcessor({ cached: { hide: true, category: '暴言' } });
  processor.processThreads([makeThread({ text: 'あ'.repeat(61) })]);
  assert.equal(aiHiddenLogs(logs)[0][2], `${'あ'.repeat(60)}…`);
});

test('表示にした判定と、ルールで隠したものは出さない', () => {
  const { processor, logs } = makeLoggingProcessor({ ngWords: ['ばか'] });
  const thread = makeThread();
  processor.processThreads([thread, makeThread({ id: 'c2', text: 'ばか' })]);
  processor.applyVerdict([thread], 'c1', { hide: false, category: null }, { id: 'c1', text: '本文' });
  assert.deepEqual(aiHiddenLogs(logs), []);
});
