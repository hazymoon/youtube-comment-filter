import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationState, videoIdFromUrl } from '../src/navigation.js';

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
