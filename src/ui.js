/**
 * @file 件数バーと NG 登録のボタン。要素は createElement と textContent だけで作る（Trusted Types のため文字列 HTML の代入はしない）。
 */

import { BAR_ID, BLOCK_BUTTON_CLASS, HEADER_AUTHOR_SELECTOR } from './selectors.js';

/**
 * @typedef {object} CountBar
 * @property {HTMLElement} element バーの要素
 * @property {(state: { open: boolean, countText: string, statusText: string, visible: boolean }) => void} update
 *   表示を更新する。変わった部分だけ書き換える
 * @property {(commentsEl: Element) => void} attach コメント欄の直前の兄弟として差し込む（差し込み済みなら何もしない）
 */

/**
 * 件数バーを作る。
 * バーはコメント欄（ytd-comments#comments）の直前の兄弟に置く。コメント欄を visibility:hidden で閉じても見えるようにするため。
 * @param {object} options
 * @param {Document} options.doc 要素を作る document
 * @param {() => void} options.onToggle 開閉ボタンが押された。クリックの同期区間で呼ぶ（LanguageModel.create のユーザー操作に使うため）
 * @returns {CountBar}
 */
export function createCountBar({ doc, onToggle }) {
  const element = doc.createElement('div');
  element.id = BAR_ID;
  element.hidden = true;

  const button = doc.createElement('button');
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });

  const counts = doc.createElement('span');
  counts.className = 'ycf-counts';
  const status = doc.createElement('span');
  status.className = 'ycf-status';

  element.append(button, counts, status);

  /**
   * 文字列が変わったときだけ書き換える（不要な再描画を避ける）。
   * @param {HTMLElement} el 要素
   * @param {string} text 文字列
   */
  const setText = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };

  return {
    element,
    update({ open, countText, statusText, visible }) {
      setText(button, open ? 'コメントを隠す' : 'コメントを表示');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      setText(counts, countText);
      setText(status, statusText);
      if (element.hidden === visible) element.hidden = !visible;
    },
    attach(commentsEl) {
      const parent = commentsEl.parentNode;
      if (!parent) return;
      if (element.parentNode === parent && element.nextElementSibling === commentsEl) return;
      parent.insertBefore(element, commentsEl);
    },
  };
}

/**
 * コメントの投稿者の名前の行（#header-author）の末尾に NG 登録のボタンを差し込む（差し込み済みなら何もしない）。
 * ボタンを見せるかは CSS が表示状態で決める（styles.js）。要素が別のコメントに使い回されても、
 * 押された時点の投稿者を読むので、ボタンは付け直さない。
 * @param {any} viewModel ytd-comment-view-model
 * @param {Document} doc 要素を作る document
 * @param {(button: HTMLElement) => void} onClick ボタンが押された
 */
export function ensureBlockButton(viewModel, doc, onClick) {
  const header = viewModel?.querySelector?.(HEADER_AUTHOR_SELECTOR);
  if (!header) return;
  for (const child of Array.from(header.children ?? [])) {
    if (child?.classList?.contains(BLOCK_BUTTON_CLASS)) return;
  }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = BLOCK_BUTTON_CLASS;
  button.textContent = 'NG';
  button.title = 'この投稿者を NG ユーザに追加する';
  button.setAttribute('aria-label', 'この投稿者を NG ユーザに追加する');
  button.addEventListener('click', (event) => {
    // YouTube 側のクリック処理（投稿者のページへの移動など）に渡さない
    event.preventDefault();
    event.stopPropagation();
    onClick(button);
  });
  header.appendChild(button);
}

/**
 * 変化の通知が、NG 登録のボタンを差し込んだだけのものか。
 * ensureBlockButton の差し込みもコメント欄の監視に届くので、これで再スキャンを回さないよう除くために使う。
 * @param {{ type: string, addedNodes: ArrayLike<any>, removedNodes: ArrayLike<any> }} record MutationRecord
 * @returns {boolean}
 */
export function isBlockButtonInsertion(record) {
  if (record.type !== 'childList' || record.removedNodes.length > 0 || record.addedNodes.length === 0) return false;
  return Array.from(record.addedNodes).every(
    (node) => node?.nodeType === 1 && node.classList?.contains?.(BLOCK_BUTTON_CLASS) === true,
  );
}
