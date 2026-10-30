import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, judgeByRules } from '../src/rules.js';

// 許可したドメイン以外へのリンクを含むコメントを隠す（allowLinkDomains）。
// 外部へのリンクの href は YouTube の /redirect?…&q=<URL> の相対パスになる（docs/dom-structure.md）。

/**
 * YouTube の外部リンクの href（/redirect?event=…&redir_token=…&q=<URL>）を作る。
 * @param {string} url 飛び先
 * @returns {string}
 */
function redirectHref(url) {
  return `/redirect?event=comments&redir_token=TOKEN&q=${encodeURIComponent(url)}`;
}

test('allowLinkDomains を指定しないと、外部へのリンクがあっても判定しない', () => {
  const rules = compileRules({});
  assert.equal(rules.matchLink([redirectHref('https://evil.example/')]), null);
  assert.deepEqual(
    judgeByRules({ author: {}, text: '見て', linkHrefs: [redirectHref('https://evil.example/')] }, rules),
    {
      reason: null,
    },
  );
});

test('/redirect の q を復号してホスト名を求め、許可外なら返す', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(rules.matchLink([redirectHref('https://evil.example/path?x=1')]), { host: 'evil.example' });
  assert.equal(rules.matchLink([redirectHref('https://example.com/path')]), null);
});

test('絶対形の https://www.youtube.com/redirect も q を見る', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  const href = `https://www.youtube.com/redirect?q=${encodeURIComponent('https://evil.example/')}`;
  assert.deepEqual(rules.matchLink([href]), { host: 'evil.example' });
});

test('/redirect を経ない外部の絶対 URL もホスト名で判定する', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(rules.matchLink(['https://evil.example/']), { host: 'evil.example' });
  assert.equal(rules.matchLink(['https://www.example.com/']), null);
});

test('許可リストはサブドメインも許可するが、末尾が一致するだけの別ドメインは許可しない', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.equal(rules.matchLink([redirectHref('https://www.example.com/')]), null);
  assert.equal(rules.matchLink([redirectHref('https://a.b.example.com/')]), null);
  assert.deepEqual(rules.matchLink([redirectHref('https://notexample.com/')]), { host: 'notexample.com' });
  assert.deepEqual(rules.matchLink([redirectHref('https://example.com.evil.net/')]), {
    host: 'example.com.evil.net',
  });
});

test('ホスト名の大文字小文字を区別しない', () => {
  const rules = compileRules({ allowLinkDomains: ['Example.COM'] });
  assert.equal(rules.matchLink([redirectHref('HTTPS://WWW.EXAMPLE.COM/')]), null);
  assert.deepEqual(rules.matchLink([redirectHref('https://EVIL.example/')]), { host: 'evil.example' });
});

test('末尾のドットの付いたホスト名も、付いていないものと同じに扱う', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.equal(rules.matchLink([redirectHref('https://www.example.com./')]), null);
});

test('YouTube 内の相対パス（@メンション・チャンネル・時刻リンク）は常に許可する', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  assert.equal(
    rules.matchLink(['/@alice', '/channel/UCabcdefghijklmnopqrstuv', '/watch?v=abcdefghijk&t=83s', '/hashtag/x']),
    null,
  );
});

test('youtube.com・youtu.be とそのサブドメインは、絶対形でも /redirect の先でも常に許可する', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  assert.equal(
    rules.matchLink([
      'https://www.youtube.com/watch?v=abcdefghijk',
      'https://youtube.com/@alice',
      'https://m.youtube.com/watch?v=abcdefghijk',
      'https://youtu.be/abcdefghijk',
      redirectHref('https://youtu.be/abcdefghijk'),
      redirectHref('https://music.youtube.com/'),
    ]),
    null,
  );
  assert.deepEqual(rules.matchLink(['https://notyoutube.com/']), { host: 'notyoutube.com' });
  assert.deepEqual(rules.matchLink(['https://youtube.com.evil.net/']), { host: 'youtube.com.evil.net' });
});

test('/redirect の先がさらに YouTube の /redirect なら、内側の飛び先で判定する', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  const inner = `https://www.youtube.com/redirect?q=${encodeURIComponent('https://evil.example/')}`;
  assert.deepEqual(rules.matchLink([redirectHref(inner)]), { host: 'evil.example' });
});

test('壊れた URL・q の無い /redirect・ホスト名の無いリンクは判定しない', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  assert.equal(
    rules.matchLink([
      '/redirect?event=comments',
      '/redirect?q=',
      redirectHref('not a url'),
      redirectHref('http://['),
      'http://[',
      'mailto:someone@evil.example',
      '',
    ]),
    null,
  );
});

test('許可外のリンクが 1 つでもあれば、最初の許可外のホスト名を返す', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(
    rules.matchLink([
      '/@alice',
      redirectHref('https://example.com/'),
      redirectHref('https://first.example/'),
      redirectHref('https://second.example/'),
    ]),
    { host: 'first.example' },
  );
});

test('judgeByRules: 許可外のリンクは NG ワードの扱いで detail に link:<host> を入れる', () => {
  const rules = compileRules({ allowLinkDomains: ['example.com'] });
  assert.deepEqual(
    judgeByRules({ author: {}, text: '見て', linkHrefs: [redirectHref('https://evil.example/')] }, rules),
    { reason: 'ngWord', detail: 'link:evil.example' },
  );
  assert.deepEqual(
    judgeByRules({ author: {}, text: '見て', linkHrefs: [redirectHref('https://example.com/')] }, rules),
    { reason: null },
  );
});

test('judgeByRules: NG ユーザ・NG ワードに当たればそちらを先に返す', () => {
  const rules = compileRules({ ngUsers: ['@troll'], ngWords: ['宣伝'], allowLinkDomains: [] });
  const linkHrefs = [redirectHref('https://evil.example/')];
  assert.deepEqual(judgeByRules({ author: { handle: '@troll' }, text: '見て', linkHrefs }, rules), {
    reason: 'ngUser',
    detail: 'handle',
  });
  assert.deepEqual(judgeByRules({ author: {}, text: '宣伝です', linkHrefs }, rules), {
    reason: 'ngWord',
    detail: '宣伝',
  });
});

test('judgeByRules: linkHrefs が無いコメントはリンクで判定しない', () => {
  const rules = compileRules({ allowLinkDomains: [] });
  assert.deepEqual(judgeByRules({ author: {}, text: '見て' }, rules), { reason: null });
});
