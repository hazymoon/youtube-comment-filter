import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountText } from '../src/decide.js';
import { compileRules } from '../src/rules.js';
import { createThreadProcessor } from '../src/scanner.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

// 件数バーに読み込み済みのコメントの総数を出し、そのうち何件を隠したかを先頭に置く。
// 隠した割合が多い動画はコメント欄を開かない、と利用者が判断できるようにするため。

test('件数の文字列は、読み込み済みの総数と非表示の合計を先頭に置き、内訳を括弧に入れる', () => {
  assert.equal(
    buildCountText({ total: 40, ngUser: 1, ngWord: 2, ai: 3, pending: 4, judging: 0 }),
    '読み込み済み 40 件中 10 件を非表示（NG ユーザ 1 / NG ワード 2 / AI 3 / 判定待ち 4）',
  );
});

test('判定中があるときだけ、判定中の件数を末尾に添える', () => {
  assert.equal(
    buildCountText({ total: 5, ngUser: 0, ngWord: 0, ai: 0, pending: 0, judging: 5 }),
    '読み込み済み 5 件中 0 件を非表示（NG ユーザ 0 / NG ワード 0 / AI 0 / 判定待ち 0）・判定中 5 件',
  );
});

/**
 * 偽の要素。
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
 * 偽の thread。replies を渡すと返信の入れ物の下に置く。
 * @param {{ id?: string, text?: string, handle?: string, replies?: object[] }} [options]
 */
function makeThread({ id = 'c1', text = '本文', handle = '/@alice', replies = [] } = {}) {
  const content = el({ tag: 'yt-attributed-string', text });
  const author = el({ tag: 'a' });
  author.setAttribute('href', handle);
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: { [CONTENT_TEXT_SELECTOR]: content, [AUTHOR_LINK_SELECTOR]: author },
    data: { commentId: id },
    polymerController: { data: {}, __data: { commentEntity: { author: { channelId: null } } } },
  });
  content.parentElement = viewModel;
  const children = [el({ id: 'comment-container', children: [viewModel] })];
  if (replies.length > 0) {
    const renderer = el({ tag: 'ytd-comment-replies-renderer', children: replies });
    children.push(el({ id: 'replies', children: [renderer] }));
  }
  return el({ tag: 'ytd-comment-thread-renderer', children });
}

test('countThreads の total は集計したコメントの数で、隠したスレッドの返信は数えない', () => {
  const processor = createThreadProcessor({
    rules: compileRules({ ngUsers: ['@troll'] }),
    cache: { get: () => null, set() {} },
    getAiMode: () => 'disabled',
  });
  const reply = makeThread({ id: 'r1', text: '返信' });
  const hiddenParent = makeThread({ id: 'p1', handle: '/@troll', replies: [reply] });
  const shown = makeThread({ id: 'c2' });
  const notYet = makeThread({ id: 'c3' });
  processor.processThreads([hiddenParent, reply, shown]);

  const counts = processor.countThreads([hiddenParent, reply, shown, notYet]);
  assert.equal(counts.total, 3);
  assert.equal(counts.ngUser, 1);
  assert.equal(counts.judging, 1);
});
