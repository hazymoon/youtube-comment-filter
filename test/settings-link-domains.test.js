import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';
import { parseStoredLinkDomains } from '../src/settings.js';

// 「値」の allowLinkDomains の読み取り。書いていなければ機能は無効（null）。

test('値が無ければ無効（null）にする', () => {
  assert.deepEqual(parseStoredLinkDomains(undefined), { domains: null, warnings: [] });
  assert.deepEqual(parseStoredLinkDomains(null), { domains: null, warnings: [] });
});

test('配列でない値は無効にして警告する（書き誤りで外部リンクを全部隠さないため）', () => {
  const result = parseStoredLinkDomains('example.com');
  assert.equal(result.domains, null);
  assert.equal(result.warnings.length, 1);
});

test('ドメインを小文字にし、前後の空白と末尾のドットを除く', () => {
  assert.deepEqual(parseStoredLinkDomains(['example.com', 'Sub.Example.ORG', ' spaced.net ', 'dot.example.']), {
    domains: ['example.com', 'sub.example.org', 'spaced.net', 'dot.example'],
    warnings: [],
  });
});

test('空の配列は有効（YouTube 以外へのリンクを全部隠す）', () => {
  assert.deepEqual(parseStoredLinkDomains([]), { domains: [], warnings: [] });
});

test('文字列でない要素とドメインとして解釈できない文字列は捨てて警告する', () => {
  const result = parseStoredLinkDomains([
    'example.com',
    3,
    '',
    'https://example.org',
    'example.org/path',
    'example.org:8080',
    'user@example.org',
    '*.example.org',
    '.example.org',
    'a b.example',
    'example.org?x',
    'http://[',
  ]);
  assert.deepEqual(result.domains, ['example.com']);
  assert.equal(result.warnings.length, 11);
});

test('国際化ドメインは punycode にそろえ、リンクの照合と一致する', () => {
  const { domains } = parseStoredLinkDomains(['例え.jp']);
  assert.deepEqual(domains, ['xn--r8jz45g.jp']);
  const rules = compileRules({ allowLinkDomains: domains });
  assert.equal(rules.matchLink(['https://www.例え.jp/']), null);
});
