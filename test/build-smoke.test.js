import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import vm from 'node:vm';
import { MODULE_ORDER, SRC_DIR, buildUserscript } from '../scripts/build.mjs';

// 結合方式では、MODULE_ORDER に無いモジュールは黙って dist から落ち、実行時に ReferenceError で止まる。
// 構文の検査（node --check）では見つからないので、一覧の突き合わせと、偽の DOM での起動で検出する。

test('src/ の全モジュールが MODULE_ORDER に入っている', () => {
  const sources = readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();
  assert.deepEqual([...MODULE_ORDER].sort(), sources);
});

/**
 * 起動に必要な分だけの偽の要素。
 * @param {string} tag タグ名
 */
function fakeElement(tag) {
  const attrs = new Map();
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: (name) => attrs.get(name) ?? null,
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    toggleAttribute(name, force) {
      const on = force ?? !attrs.has(name);
      if (on) attrs.set(name, '');
      else attrs.delete(name);
      return on;
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append: (...children) => element.children.push(...children),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return element;
}

/**
 * ビルド結果を偽の DOM で実行する。
 * @param {{ href: string, pathname: string }} location 起動時の location
 * @returns {{ html: ReturnType<typeof fakeElement>, documentListeners: string[] }}
 */
function runBuilt(location) {
  const html = fakeElement('html');
  const documentListeners = [];
  const document = {
    documentElement: html,
    head: null,
    readyState: 'loading',
    visibilityState: 'visible',
    createElement: fakeElement,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type) => documentListeners.push(type),
  };
  const context = {
    document,
    window: { addEventListener() {} },
    location,
    console: { ...console, debug() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    performance,
    AbortSignal,
    AbortController,
    TextEncoder,
    URL,
    DOMException,
  };

  vm.runInNewContext(buildUserscript(), context);
  return { html, documentListeners };
}

test('ビルド結果を偽の DOM で実行すると、起動処理が例外なく最後まで走る', () => {
  const { html, documentListeners } = runBuilt({ href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' });

  assert.equal(html.hasAttribute('data-ycf-watch'), true);
  assert.equal(html.hasAttribute('data-ycf-shorts'), false);
  // 起動処理の最後で DOMContentLoaded を待つので、そこまで走ったことを確かめる
  assert.ok(documentListeners.includes('DOMContentLoaded'), `登録されたイベント: ${documentListeners.join(', ')}`);
});

test('Shorts のページで起動すると、html に data-ycf-shorts だけを付けて最後まで走る', () => {
  const { html, documentListeners } = runBuilt({ href: 'https://www.youtube.com/shorts/abc', pathname: '/shorts/abc' });

  assert.equal(html.hasAttribute('data-ycf-shorts'), true);
  assert.equal(html.hasAttribute('data-ycf-watch'), false);
  assert.ok(documentListeners.includes('DOMContentLoaded'), `登録されたイベント: ${documentListeners.join(', ')}`);
});
