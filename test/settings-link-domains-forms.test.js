import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredLinkDomains } from '../src/settings.js';

// allowLinkDomains に URL や *. 付きで書いても、ドメインとして読み取る。

test('http:// / https:// 付きの値は、ホスト名を取り出して受け付ける', () => {
  assert.deepEqual(
    parseStoredLinkDomains(['https://example.org', 'http://Sub.Example.NET/path?x=1', 'https://www.example.com/']),
    { domains: ['example.org', 'sub.example.net', 'www.example.com'], warnings: [] },
  );
});

test('先頭の *. は取り除いて受け付ける', () => {
  assert.deepEqual(parseStoredLinkDomains(['*.example.org', ' *.Example.com ']), {
    domains: ['example.org', 'example.com'],
    warnings: [],
  });
});

test('取り出した結果が読めない値は、今までどおり捨てて警告する', () => {
  const result = parseStoredLinkDomains([
    'https://com',
    '*.com',
    '*.',
    'ftp://example.org',
    'https://user:pass@example.org',
    'https://',
    '**.example.org',
    '*example.org',
  ]);
  assert.deepEqual(result.domains, []);
  assert.equal(result.warnings.length, 8);
});
