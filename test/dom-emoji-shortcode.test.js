import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractComment } from '../src/dom.js';
import { AUTHOR_LINK_SELECTOR, CONTENT_TEXT_SELECTOR } from '../src/selectors.js';

// polymer の原文には、画面では画像で出るカスタム絵文字が名前（:whistle-red-blow: など）で入る（issue #22、実機で確認）

/**
 * 偽の要素を作る。querySelector は登録したセレクタの文字列に完全一致したものだけを返す。
 * @param {object} [spec]
 */
function el({ tag = 'div', id = '', attrs = {}, text = '', children = [], query = {}, data, polymerController } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    children: [],
    parentElement: null,
    textContent: text,
    data,
    polymerController,
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    querySelector: (selector) => query[selector] ?? null,
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/**
 * 偽の thread を作る。
 * @param {{ domText: string, polymerText: string }} options
 */
function makeThread({ domText, polymerText }) {
  const content = el({ tag: 'yt-attributed-string', text: domText });
  const viewModel = el({
    tag: 'ytd-comment-view-model',
    id: 'comment',
    query: {
      [CONTENT_TEXT_SELECTOR]: content,
      [AUTHOR_LINK_SELECTOR]: el({ tag: 'a', attrs: { href: '/@alice' } }),
    },
    data: { commentId: 'UgxEMOJI' },
    polymerController: {
      data: {},
      __data: {
        commentEntity: { author: { channelId: 'UCabcdefghijklmnopqrstuv' }, properties: { content: { content: polymerText } } },
      },
    },
  });
  return el({ tag: 'ytd-comment-thread-renderer', children: [el({ id: 'comment-container', children: [viewModel] })] });
}

test('原文に入ったカスタム絵文字の名前は、本文から取り除く（NG ワードが絵文字の名前に一致しないように）', () => {
  const extracted = extractComment(
    makeThread({ domText: '\nCame back to check', polymerText: ':whistle-red-blow:\nCame back to check' }),
  );
  assert.equal(extracted.text, 'Came back to check');
});

test('本文の途中や複数のカスタム絵文字の名前も取り除く', () => {
  const extracted = extractComment(makeThread({ domText: 'すごい  いいね', polymerText: 'すごい:face-blue-smiling: いいね:yt:' }));
  assert.equal(extracted.text, 'すごい いいね');
});

test('時刻のような数字だけのコロン区切りは取り除かない', () => {
  const extracted = extractComment(makeThread({ domText: '1:23:45 が好き', polymerText: '1:23:45 が好き' }));
  assert.equal(extracted.text, '1:23:45 が好き');
});

test('普通の絵文字は文字として残す', () => {
  const extracted = extractComment(makeThread({ domText: 'bird content! ', polymerText: 'bird content! 😂' }));
  assert.equal(extracted.text, 'bird content! 😂');
});

test('カスタム絵文字だけの本文は、取り除いた結果が空なので本文の要素から読む（これまでどおり画像の絵文字だけなら空文字）', () => {
  const extracted = extractComment(makeThread({ domText: '', polymerText: ':face-blue-smiling::yt:' }));
  assert.equal(extracted.text, '');
});
