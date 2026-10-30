import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, judgeByRules } from '../src/rules.js';

// /redirect を何重にも入れ子にして、剥がす回数の上限で判定をすり抜けられないようにする。

/**
 * 飛び先を YouTube の /redirect で n 回包んだ href を作る。
 * @param {string} url 飛び先
 * @param {number} times 包む回数
 * @returns {string}
 */
function nestRedirect(url, times) {
  let href = url;
  for (let i = 0; i < times; i += 1) href = `https://www.youtube.com/redirect?q=${encodeURIComponent(href)}`;
  return href;
}

test('上限の回数までの入れ子は、いちばん内側の飛び先で判定する', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(rules.matchLink([nestRedirect('https://evil.example/', 5)]), { host: 'evil.example' });
  assert.equal(rules.matchLink([nestRedirect('https://example.com/', 5)]), null);
});

test('上限を超える入れ子は、飛び先が許可したドメインでも許可外として扱う', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  for (const times of [6, 50]) {
    assert.deepEqual(rules.matchLink([nestRedirect('https://evil.example/', times)]), {
      host: 'www.youtube.com/redirect',
    });
    assert.deepEqual(rules.matchLink([nestRedirect('https://example.com/', times)]), {
      host: 'www.youtube.com/redirect',
    });
  }
  assert.deepEqual(
    judgeByRules({ author: {}, text: '見て', linkHrefs: [nestRedirect('https://evil.example/', 6)] }, rules),
    {
      reason: 'ngWord',
      detail: 'link:www.youtube.com/redirect',
    },
  );
});
