import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { parseStoredLinkDomains } from '../src/settings.js';

// レビューで見つかった、リンクの判定のすり抜けと設定の読み取りの穴。

test('/redirect に q が複数あれば全部見て、1 つでも許可外ならそのホスト名を返す', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  const ok = encodeURIComponent('https://example.com/');
  const evil = encodeURIComponent('https://evil.example/');
  assert.deepEqual(rules.matchLink([`/redirect?q=${ok}&q=${evil}`]), { host: 'evil.example' });
  assert.deepEqual(rules.matchLink([`/redirect?q=${evil}&q=${ok}`]), { host: 'evil.example' });
  assert.equal(rules.matchLink([`/redirect?q=${ok}&q=${ok}`]), null);
});

test('入れ子の内側の /redirect に q が複数あっても全部見る', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  const inner = `https://www.youtube.com/redirect?q=${encodeURIComponent('https://example.com/')}&q=${encodeURIComponent('https://evil.example/')}`;
  assert.deepEqual(rules.matchLink([`/redirect?q=${encodeURIComponent(inner)}`]), { host: 'evil.example' });
});

test('linkFilterEnabled は allowLinkDomains を指定したときだけ true', () => {
  assert.equal(compileRules({}).linkFilterEnabled, false);
  assert.equal(compileRules({ allowLinkDomains: null }).linkFilterEnabled, false);
  assert.equal(compileRules({ allowLinkDomains: [] }).linkFilterEnabled, true);
});

test('ラベルが 1 つだけの値（com・localhost）は、トップレベルドメインごと許可しないよう捨てて警告する', () => {
  const result = parseStoredLinkDomains(['com', 'localhost', 'example.com']);
  assert.deepEqual(result.domains, ['example.com']);
  assert.equal(result.warnings.length, 2);
});
