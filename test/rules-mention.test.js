import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../src/rules.js';

const UC_OTHER = 'UCzzzzzzzzzzzzzzzzzzzzzz';

test('matchMention: 宛先の href が /channel/UC… でも、UC が NG でなければ本文先頭の @ハンドルで照合する', () => {
  const rules = compileRules({ ngUsers: ['@troll'] });
  assert.equal(rules.matchMention({ text: '@troll それは違う', leadingMentionHref: `/channel/${UC_OTHER}` }), true);
  assert.equal(rules.matchMention({ text: '@someone それは違う', leadingMentionHref: `/channel/${UC_OTHER}` }), false);
});
