import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractComment } from '../src/dom.js';
import { CONTENT_TEXT_SELECTOR, PUBLISHED_TIME_LINK_SELECTOR } from '../src/selectors.js';

/** 3 つの取得元すべてに別の ID を持つ偽の thread を作る。 */
function makeThread({ dataId, controllerId, lcId }) {
  const node = (props) => ({
    tagName: 'DIV',
    id: '',
    children: [],
    parentElement: null,
    getAttribute: () => null,
    ...props,
  });
  const lcLink = node({ getAttribute: (name) => (name === 'href' ? `/watch?v=v1&lc=${lcId}` : null) });
  const content = node({ textContent: '本文', querySelector: () => null });
  const viewModel = node({
    tagName: 'YTD-COMMENT-VIEW-MODEL',
    id: 'comment',
    data: dataId === undefined ? {} : { commentId: dataId },
    polymerController: { data: controllerId === undefined ? {} : { commentId: controllerId }, __data: {} },
    querySelector: (selector) =>
      ({ [CONTENT_TEXT_SELECTOR]: content, [PUBLISHED_TIME_LINK_SELECTOR]: lcLink })[selector] ?? null,
  });
  const container = node({ id: 'comment-container', children: [viewModel] });
  viewModel.parentElement = container;
  const thread = node({ tagName: 'YTD-COMMENT-THREAD-RENDERER', children: [container] });
  container.parentElement = thread;
  return thread;
}

test('コメント ID は .data → polymerController.data → lc= の順に優先する', () => {
  assert.equal(
    extractComment(makeThread({ dataId: 'FROM_DATA', controllerId: 'FROM_CTRL', lcId: 'FROM_LC' })).id,
    'FROM_DATA',
  );
  assert.equal(extractComment(makeThread({ controllerId: 'FROM_CTRL', lcId: 'FROM_LC' })).id, 'FROM_CTRL');
  assert.equal(extractComment(makeThread({ lcId: 'FROM_LC' })).id, 'FROM_LC');
});
