import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, judgeByRules } from '../src/rules.js';

// 動画の投稿者になりすましたコメント（投稿者の名前を、記号や似た文字で真似たもの）を NG ユーザとして隠す。
// 比べるのは正規化した名前の完全一致だけ（部分一致・編集距離は使わない）

const OWNER = { handle: '@RickAstleyYT', displayName: 'Rick Astley' };
const NO_RULES = compileRules();

/**
 * なりすましの判定に使う形のコメントを作る。
 * @param {object} author 投稿者
 * @param {string} [text] 本文
 */
function comment(author, text = '本文') {
  return { author: { channelId: null, isOwner: false, ...author }, text };
}

test('記号を挟んだハンドルは、動画の投稿者の表示名・ハンドルと同じ名前とみなす', () => {
  for (const handle of ['@Rick.Astley', '@rick_astley', '@Rick-Astley', '@rick_astley-yt', '@RICK.ASTLEY.YT']) {
    assert.deepEqual(
      judgeByRules(comment({ handle }), NO_RULES, OWNER),
      { reason: 'ngUser', detail: 'impersonation' },
      handle,
    );
  }
});

test('キリル文字・ギリシャ文字で似せたハンドルも、同じ名前とみなす', () => {
  // і с е у はキリル文字の小文字
  const cyrillic = '@RісkAstlеу';
  assert.deepEqual(judgeByRules(comment({ handle: cyrillic }), NO_RULES, OWNER), {
    reason: 'ngUser',
    detail: 'impersonation',
  });
  // 小文字にすると似るラテン文字が無くなる大文字（キリル文字の М）も拾う
  const owner = { handle: '@maxwellshouseofmusic', displayName: "Maxwell's House of Music" };
  assert.deepEqual(judgeByRules(comment({ handle: '@МaxwellsHouseOfMusic' }), NO_RULES, owner), {
    reason: 'ngUser',
    detail: 'impersonation',
  });
});

test('全角の英字と空白・記号だけの違いも、同じ名前とみなす', () => {
  assert.deepEqual(judgeByRules(comment({ handle: '@ｒｉｃｋａｓｔｌｅｙ' }), NO_RULES, OWNER), {
    reason: 'ngUser',
    detail: 'impersonation',
  });
});

test('コメントの投稿者の表示名が、動画の投稿者の名前と同じでも隠す', () => {
  assert.deepEqual(judgeByRules(comment({ handle: '@xyz-123', displayName: 'Rick Astley' }), NO_RULES, OWNER), {
    reason: 'ngUser',
    detail: 'impersonation',
  });
});

test('名前の一部が同じだけ・別の名前のコメントは隠さない', () => {
  for (const handle of ['@RickAstleyFan', '@rick', '@astley', '@someone']) {
    assert.deepEqual(judgeByRules(comment({ handle }), NO_RULES, OWNER), { reason: null }, handle);
  }
});

test('動画の投稿者本人のコメントは隠さない', () => {
  // 所有者の印がある
  assert.deepEqual(judgeByRules(comment({ handle: '@RickAstleyYT', isOwner: true }), NO_RULES, OWNER), {
    reason: null,
  });
  // 所有者の印がまだ読めなくても、ハンドルが同じなら同じチャンネル（ハンドルは重複しない）
  assert.deepEqual(judgeByRules(comment({ handle: '@rickastleyyt', displayName: '@RickAstleyYT' }), NO_RULES, OWNER), {
    reason: null,
  });
  // 所有者の印があれば、表示名だけが一致する別のハンドルでも隠さない
  assert.deepEqual(
    judgeByRules(comment({ handle: '@other', displayName: 'Rick Astley', isOwner: true }), NO_RULES, OWNER),
    {
      reason: null,
    },
  );
});

test('正規化して 3 文字未満になる動画の投稿者の名前では判定しない', () => {
  const owner = { handle: '@ab', displayName: 'A.B' };
  assert.deepEqual(judgeByRules(comment({ handle: '@a_b' }), NO_RULES, owner), { reason: null });
  // 短いのが表示名だけなら、ハンドルでは判定する
  const mixed = { handle: '@kumamon', displayName: 'く' };
  assert.deepEqual(judgeByRules(comment({ handle: '@kuma.mon' }), NO_RULES, mixed), {
    reason: 'ngUser',
    detail: 'impersonation',
  });
  assert.deepEqual(judgeByRules(comment({ handle: '@zz', displayName: 'く' }), NO_RULES, mixed), { reason: null });
});

test('動画の投稿者を読めないときは判定しない', () => {
  const target = comment({ handle: '@Rick.Astley' });
  assert.deepEqual(judgeByRules(target, NO_RULES, null), { reason: null });
  assert.deepEqual(judgeByRules(target, NO_RULES), { reason: null });
  assert.deepEqual(judgeByRules(target, NO_RULES, { handle: null, displayName: null }), { reason: null });
});

test('コメントの投稿者の名前が読めないか空になるときは判定しない', () => {
  assert.deepEqual(judgeByRules(comment({ handle: null }), NO_RULES, OWNER), { reason: null });
  assert.deepEqual(judgeByRules(comment({ handle: '@...', displayName: '' }), NO_RULES, OWNER), { reason: null });
});

test('NG ユーザの一致はなりすましより先に、NG ワードより前になりすましを返す', () => {
  const rules = compileRules({ ngUsers: ['@rick.astley'], ngWords: ['spam'] });
  assert.deepEqual(judgeByRules(comment({ handle: '@rick.astley' }, 'spam'), rules, OWNER), {
    reason: 'ngUser',
    detail: 'handle',
  });
  assert.deepEqual(judgeByRules(comment({ handle: '@rick_astley' }, 'spam'), rules, OWNER), {
    reason: 'ngUser',
    detail: 'impersonation',
  });
  assert.deepEqual(judgeByRules(comment({ handle: '@someone' }, 'spam'), rules, OWNER), {
    reason: 'ngWord',
    detail: 'spam',
  });
});

test('コメントの投稿者のハンドルを読めないときは、表示名が一致しても判定しない', () => {
  // ハンドルのリンクが描かれる前は、本人かどうか（ハンドルが同じか）を確かめられないので隠さない
  assert.deepEqual(judgeByRules(comment({ handle: null, displayName: 'Rick Astley' }), NO_RULES, OWNER), {
    reason: null,
  });
  assert.deepEqual(judgeByRules(comment({ handle: undefined, displayName: '@RickAstleyYT' }), NO_RULES, OWNER), {
    reason: null,
  });
});
