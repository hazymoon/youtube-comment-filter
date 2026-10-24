import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR, REASON_ATTR, STATE_ATTR } from '../src/selectors.js';

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
    query,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    querySelector: (selector) => node.query[selector] ?? null,
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
 * 原文を polymer のデータに持つ偽の thread を作る。content（本文の要素）を返り値に付ける。
 * @param {string} original 原文
 */
function makeThread(original) {
  const content = el({ tag: 'yt-attributed-string', text: original });
  const query = { [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: el({ tag: 'a' }) };
  query[AUTHOR_LINK_SELECTOR].setAttribute('href', '/@alice');
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query,
    data: { commentId: 'c1' },
    polymerController: {
      data: {},
      __data: { commentEntity: { author: { channelId: null }, properties: { content: { content: original } } } },
    },
  });
  content.parentElement = viewModel;
  const thread = el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
  thread.content = content;
  return thread;
}

test('表示中のコメントを翻訳・原文に戻しても、判定前に戻さず AI にも送り直さない', () => {
  const cacheSets = [];
  const processor = createThreadProcessor({
    rules: compileRules({ ngUsers: [], ngWords: [] }),
    cache: { get: () => null, set: (...args) => cacheSets.push(args) },
    getAiMode: () => 'ready',
  });
  const thread = makeThread('Great video');
  assert.equal(processor.processThreads([thread]).length, 1);
  processor.applyVerdict([thread], 'c1', { hide: false, category: null }, { id: 'c1', text: 'Great video' });
  assert.equal(thread.getAttribute(STATE_ATTR), 'shown');

  for (const displayed of ['素晴らしい動画です', 'Great video']) {
    thread.content.textContent = displayed;
    processor.revalidate([thread.content]);
    assert.equal(thread.getAttribute(STATE_ATTR), 'shown', `「${displayed}」の表示で判定前に戻さない`);
    assert.equal(thread.getAttribute(REASON_ATTR), null);
    assert.deepEqual(processor.processThreads([thread]), [], `「${displayed}」の表示で AI に送り直さない`);
    assert.equal(thread.getAttribute(STATE_ATTR), 'shown');
  }
  assert.equal(cacheSets.length, 1);
});
