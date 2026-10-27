import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNavigationState,
  pageKeyFromUrl,
  pageKindFromPathname,
  shortsIdFromUrl,
  videoIdFromUrl,
} from '../src/navigation.js';

test('videoIdFromUrl は動画ページの v だけを返す', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=abc&t=10s'), 'abc');
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=abc&lc=Ugx'), 'abc');
  assert.equal(videoIdFromUrl('https://www.youtube.com/'), null);
  assert.equal(videoIdFromUrl('https://www.youtube.com/shorts/abc'), null);
  assert.equal(videoIdFromUrl('not a url'), null);
});

test('同じ動画の中での遷移（時刻・lc= 付きの URL）は動画の変更として扱わない', () => {
  const nav = createNavigationState('https://www.youtube.com/watch?v=abc');
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/watch?v=abc&t=42s'), { videoChanged: false });
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/watch?v=abc&lc=UgxCOMMENT'), { videoChanged: false });
});

test('別の動画や動画以外のページへの遷移は動画の変更として扱う', () => {
  const nav = createNavigationState('https://www.youtube.com/watch?v=abc');
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/watch?v=xyz'), { videoChanged: true });
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/'), { videoChanged: true });
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/watch?v=xyz'), { videoChanged: true });
});

test('遷移の開始から完了までは順番待ちに入れない', () => {
  const nav = createNavigationState('https://www.youtube.com/watch?v=abc');
  assert.equal(nav.canEnqueue(), true);
  nav.start();
  assert.equal(nav.canEnqueue(), false, '前の動画の thread を入れ直さない');
  nav.finish('https://www.youtube.com/watch?v=xyz');
  assert.equal(nav.canEnqueue(), true);
});

test('pageKindFromPathname は動画ページと Shorts だけを対象にする', () => {
  assert.equal(pageKindFromPathname('/watch'), 'watch');
  assert.equal(pageKindFromPathname('/shorts/abc'), 'shorts');
  assert.equal(pageKindFromPathname('/shorts'), null);
  assert.equal(pageKindFromPathname('/'), null);
  assert.equal(pageKindFromPathname('/@handle/shorts'), null);
});

test('shortsIdFromUrl は /shorts/<id> の id だけを返す', () => {
  assert.equal(shortsIdFromUrl('https://www.youtube.com/shorts/abc'), 'abc');
  assert.equal(shortsIdFromUrl('https://www.youtube.com/shorts/abc?feature=share'), 'abc');
  assert.equal(shortsIdFromUrl('https://www.youtube.com/shorts/'), null);
  assert.equal(shortsIdFromUrl('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(shortsIdFromUrl('not a url'), null);
});

test('pageKeyFromUrl は同じ動画 ID でも動画ページと Shorts を別のキーにする', () => {
  assert.equal(pageKeyFromUrl('https://www.youtube.com/watch?v=abc'), 'watch:abc');
  assert.equal(pageKeyFromUrl('https://www.youtube.com/shorts/abc'), 'shorts:abc');
  assert.equal(pageKeyFromUrl('https://www.youtube.com/'), null);
});

test('Shorts で次の動画へ移ると動画の変更として扱い、同じ Shorts の中の遷移は扱わない', () => {
  const nav = createNavigationState('https://www.youtube.com/shorts/abc');
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/shorts/abc?lc=UgxCOMMENT'), { videoChanged: false });
  nav.start();
  assert.deepEqual(nav.finish('https://www.youtube.com/shorts/xyz'), { videoChanged: true });
  nav.start();
  assert.deepEqual(
    nav.finish('https://www.youtube.com/watch?v=xyz'),
    { videoChanged: true },
    '同じ ID でもページの種類が変われば別',
  );
});
