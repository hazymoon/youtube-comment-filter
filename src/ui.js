/**
 * @file 件数バー。要素は createElement と textContent だけで作る（Trusted Types のため文字列 HTML の代入はしない）。
 */

import { BAR_ID } from './selectors.js';

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
