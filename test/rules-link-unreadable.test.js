import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';

// YouTube の /redirect なのに飛び先が読めないリンクは、手で作ったものとみなして許可外として隠す。
// /redirect 以外の壊れた URL・ホスト名の無いリンクは、今までどおり判定しない。

const UNVERIFIED = { host: 'www.youtube.com/redirect' };

test('/redirect に q が無い・空のときは許可外として扱う', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(rules.matchLink(['/redirect?event=comments']), UNVERIFIED);
  assert.deepEqual(rules.matchLink(['/redirect?q=']), UNVERIFIED);
  assert.deepEqual(rules.matchLink(['https://www.youtube.com/redirect']), UNVERIFIED);
});

test('/redirect の q が絶対 URL として読めないときは許可外として扱う', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  for (const q of ['//evil.example/', 'evil.example/path', 'not a url', 'http://[']) {
    assert.deepEqual(rules.matchLink([`/redirect?q=${encodeURIComponent(q)}`]), UNVERIFIED, q);
  }
});

test('/redirect の q がホスト名の無い URL（mailto: など）のときは許可外として扱う', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(rules.matchLink([`/redirect?q=${encodeURIComponent('mailto:someone@evil.example')}`]), UNVERIFIED);
});

test('q が複数あり、1 つでも読めなければ許可外として扱う', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  const ok = encodeURIComponent('https://example.com/');
  assert.deepEqual(rules.matchLink([`/redirect?q=${ok}&q=`]), UNVERIFIED);
  assert.deepEqual(rules.matchLink([`/redirect?q=${ok}&q=${encodeURIComponent('//evil.example')}`]), UNVERIFIED);
});

test('入れ子の内側の /redirect の飛び先が読めないときも許可外として扱う', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  const inner = 'https://www.youtube.com/redirect?event=comments';
  assert.deepEqual(rules.matchLink([`/redirect?q=${encodeURIComponent(inner)}`]), UNVERIFIED);
});

test('/redirect 以外の壊れた URL・ホスト名の無いリンクは今までどおり判定しない', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  assert.equal(rules.matchLink(['http://[', 'mailto:someone@evil.example', 'javascript:void(0)', '']), null);
});
