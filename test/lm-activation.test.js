import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLanguageModelController } from '../src/lm.js';

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/** availability() をテストが resolve するまで待たせる偽の LanguageModel。 */
function fakeLanguageModel() {
  const log = { creates: 0, resolveAvailability: () => {}, createResolvers: [] };
  return {
    log,
    availability() {
      return new Promise((resolve) => {
        log.resolveAvailability = resolve;
      });
    },
    create() {
      log.creates += 1;
      return new Promise((resolve, reject) => log.createResolvers.push({ resolve, reject }));
    },
  };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function makeController(model) {
  return createLanguageModelController({
    categories: CATEGORIES,
    enabled: true,
    onStateChange: () => {},
    getLanguageModel: () => model,
  });
}

test('availability() の応答待ちの間に activate() されたら、その場で作成を始める', async () => {
  const model = fakeLanguageModel();
  const controller = makeController(model);
  const initPromise = controller.init();
  assert.equal(controller.getState().mode, 'initializing');
  controller.activate();
  assert.equal(model.log.creates, 1, 'availability() の結果を待たずに create を呼ぶ');

  model.log.resolveAvailability('downloadable');
  await initPromise;
  assert.equal(model.log.creates, 1, '作成を重ねない');
  model.log.createResolvers[0].resolve({ clone: async () => ({}), destroy() {} });
  await settle();
  assert.equal(controller.getState().mode, 'ready');
});

test("'downloading' は 'downloadable' と同じく needs-activation にする", async () => {
  const model = fakeLanguageModel();
  const controller = makeController(model);
  const initPromise = controller.init();
  model.log.resolveAvailability('downloading');
  await initPromise;
  assert.equal(controller.getState().mode, 'needs-activation');
  assert.equal(model.log.creates, 0);
});

test("activate() の後に availability() が 'unavailable' を返したら disabled にし、cloneSession は reject する", async () => {
  const model = fakeLanguageModel();
  const controller = makeController(model);
  const initPromise = controller.init();
  controller.activate();
  model.log.resolveAvailability('unavailable');
  await initPromise;
  assert.deepEqual(controller.getState(), { mode: 'disabled', disabledReason: 'unavailable' });
  await assert.rejects(controller.cloneSession());
  // 後から作成が失敗しても disabled のまま
  model.log.createResolvers[0].reject(new Error('NotSupportedError'));
  await settle();
  assert.equal(controller.getState().mode, 'disabled');
});
