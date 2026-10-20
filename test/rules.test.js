import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, judgeByRules } from '../src/rules.js';

const UC_A = 'UCabcdefghijklmnopqrstuv';
const UC_B = 'UC0123456789_-ABCDEFGHIJ';

test('ハンドルは完全一致で、記号の有無を区別する', () => {
  const rules = compileRules({ ngUsers: ['@foo_bar'] });
  assert.equal(rules.matchUser({ handle: '@foo_bar' }), 'handle');
  assert.equal(rules.matchUser({ handle: 'foo_bar' }), 'handle');
  assert.equal(rules.matchUser({ handle: '@foobar' }), null);
  assert.equal(rules.matchUser({ handle: '@foo_bar2' }), null);
});

test('ハンドルは大文字小文字を無視し、全角の @ も NFKC で一致する', () => {
  const rules = compileRules({ ngUsers: ['＠Foo.Bar'] });
  assert.deepEqual(rules.warnings, []);
  assert.equal(rules.matchUser({ handle: '@foo.bar' }), 'handle');
  assert.equal(rules.matchUser({ handle: '@FOO.BAR' }), 'handle');
  assert.equal(rules.matchUser({ handle: '＠ｆｏｏ.ｂａｒ' }), 'handle');
});

test('チャンネル ID は大文字小文字を区別して一致する', () => {
  const rules = compileRules({ ngUsers: [UC_A] });
  assert.equal(rules.matchUser({ handle: null, channelId: UC_A }), 'channelId');
  assert.equal(rules.matchUser({ channelId: UC_A.toUpperCase() }), null);
  assert.equal(rules.matchUser({ handle: null, channelId: null }), null);
});

test('不正な NG ユーザは warnings に入れて捨てる', () => {
  const rules = compileRules({ ngUsers: ['UCshort', 'foo', '@', '@a b', 123, UC_B] });
  assert.equal(rules.warnings.length, 5);
  assert.equal(rules.matchUser({ channelId: UC_B }), 'channelId');
  assert.equal(rules.matchUser({ handle: 'foo' }), null);
});

test('文字列の NG ワードは正規化後に部分一致する', () => {
  const rules = compileRules({ ngWords: ['あほ', 'ＮＧ'] });
  assert.deepEqual(rules.matchWord('この あ ほ が'), { word: 'あほ' });
  assert.deepEqual(rules.matchWord('アホらしい'), { word: 'あほ' });
  assert.deepEqual(rules.matchWord('ｱﾎ'), { word: 'あほ' });
  assert.deepEqual(rules.matchWord('これはng'), { word: 'ＮＧ' });
  assert.equal(rules.matchWord('ありがとう'), null);
});

test('既知の限界: 短い語は別の語の一部にも一致する', () => {
  const rules = compileRules({ ngWords: ['カス'] });
  assert.deepEqual(rules.matchWord('かすかに聞こえる'), { word: 'カス' });
});

test('正規化すると空になる NG ワードは warnings に入れて捨てる', () => {
  const rules = compileRules({ ngWords: ['！？', '😀', ' ', null] });
  assert.equal(rules.warnings.length, 4);
  assert.equal(rules.matchWord('！？😀'), null);
});

test('正規化後に空になる本文は照合しない', () => {
  const rules = compileRules({ ngWords: [/^$/] });
  assert.equal(rules.matchWord('😀👍'), null);
});

test('正規表現は NFKC の本文と正規化後の本文のどちらかで一致すれば NG', () => {
  const rules = compileRules({ ngWords: [/ゴミ|カス/, /あほ/] });
  // Katakana pattern matches the NFKC text (normalized text is hiragana).
  assert.deepEqual(rules.matchWord('このゴミ動画'), { word: '/ゴミ|カス/' });
  assert.deepEqual(rules.matchWord('ｶｽ'), { word: '/ゴミ|カス/' });
  // Hiragana pattern matches the normalized text.
  assert.deepEqual(rules.matchWord('ア ホ'), { word: '/あほ/' });
});

test('記号を前提にした正規表現は NFKC の本文で一致する', () => {
  const rules = compileRules({ ngWords: [/https?:\/\/bit\.ly\//i] });
  assert.deepEqual(rules.matchWord('見て ＨＴＴＰＳ://bit.ly/xyz'), { word: '/https?:\\/\\/bit\\.ly\\//i' });
});

test('g フラグ付きの正規表現を続けて呼んでも結果が変わらない', () => {
  const rules = compileRules({ ngWords: [/ばか/gy] });
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(rules.matchWord('ばか'), { word: '/ばか/gy' });
  }
});

test('matchMention: href の /@handle でハンドルを照合する', () => {
  const rules = compileRules({ ngUsers: ['@troll', '@日本語ハンドル'] });
  assert.equal(rules.matchMention({ text: '@troll こんにちは', leadingMentionHref: '/@troll' }), true);
  assert.equal(rules.matchMention({ text: '@Troll', leadingMentionHref: 'https://www.youtube.com/@Troll' }), true);
  assert.equal(
    rules.matchMention({ text: '@日本語ハンドル', leadingMentionHref: `/@${encodeURIComponent('日本語ハンドル')}` }),
    true,
  );
  assert.equal(rules.matchMention({ text: '@other', leadingMentionHref: '/@other' }), false);
});

test('matchMention: href の /channel/UC... でチャンネル ID を照合する', () => {
  const rules = compileRules({ ngUsers: [UC_A] });
  assert.equal(rules.matchMention({ text: '@表示名 ちがうよ', leadingMentionHref: `/channel/${UC_A}` }), true);
  assert.equal(rules.matchMention({ text: '@表示名', leadingMentionHref: `/channel/${UC_B}` }), false);
});

test('matchMention: href が無ければ本文先頭の @ハンドルで照合する', () => {
  const rules = compileRules({ ngUsers: ['@troll'] });
  assert.equal(rules.matchMention({ text: '  ＠TROLL それは違う' }), true);
  assert.equal(rules.matchMention({ text: '@troll', leadingMentionHref: null }), true);
  assert.equal(rules.matchMention({ text: 'それは違う @troll' }), false);
});

test('matchMention: 表示名だけの宛先は一致しない', () => {
  const rules = compileRules({ ngUsers: ['@troll123'] });
  // Display name "荒らし太郎" links to the NG user's handle page only via href; text alone does not match.
  assert.equal(rules.matchMention({ text: '@荒らし太郎 それは違う' }), false);
  assert.equal(rules.matchMention({ text: '@荒らし太郎 それは違う', leadingMentionHref: '/@someone' }), false);
});

test('judgeByRules: 投稿者 → 返信の宛先 → NG ワードの順に判定する', () => {
  const rules = compileRules({ ngUsers: ['@author', '@target'], ngWords: ['ばか'] });
  const base = { author: { handle: '@someone', channelId: null }, text: 'こんにちは', isReply: false, leadingMentionHref: null };

  assert.deepEqual(judgeByRules(base, rules), { reason: null });
  assert.deepEqual(
    judgeByRules({ ...base, author: { handle: '@author' }, text: '@target ばか', isReply: true }, rules),
    { reason: 'ngUser', detail: 'handle' },
  );
  assert.deepEqual(
    judgeByRules({ ...base, text: '@target ばか', isReply: true, leadingMentionHref: '/@target' }, rules),
    { reason: 'ngUser', detail: 'mention' },
  );
  // Mentions only count for replies.
  assert.deepEqual(judgeByRules({ ...base, text: '@target ばか', isReply: false }, rules), { reason: 'ngWord', detail: 'ばか' });
  assert.deepEqual(judgeByRules({ ...base, text: 'バカ' }, rules), { reason: 'ngWord', detail: 'ばか' });
});

test('g / y フラグ付きの正規表現は NFKC の本文でだけ一致する入力でも、続けて呼んで結果が変わらない', () => {
  // 'ゴミ' matches only the NFKC text (the normalized text is 'ごみ'), so a retained lastIndex would break the 2nd call.
  for (const pattern of [/ゴミ/g, /ゴミ/y, /ゴミ/gy]) {
    const rules = compileRules({ ngWords: [pattern] });
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(rules.matchWord('ゴミ'), { word: String(pattern) });
    }
  }
});
