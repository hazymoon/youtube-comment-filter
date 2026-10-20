import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLanguageModelController } from '../src/lm.js';

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/**
 * 偽の LanguageModel を作る。create はテストが resolve / reject するまで待つ。
 * @param {{ availability?: string|Error }} [options]
 */
function fakeLanguageModel({ availability = 'available' } = {}) {
  const log = { availabilityOptions: [], createOptions: [], creates: [], clones: 0 };
  const model = {
    log,
    async availability(options) {
      log.availabilityOptions.push(options);
      if (availability instanceof Error) throw availability;
      return availability;
    },
    create(options) {
      log.createOptions.push(options);
      return new Promise((resolve, reject) => {
        log.creates.push({
          resolve: () =>
            resolve({
              clone: async () => {
                log.clones += 1;
                return { id: `clone-${log.clones}` };
              },
              destroy() {},
            }),
          reject,
        });
      });
    },
  };
  return model;
}

/** マイクロタスクを一巡させる。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * コントローラを作る。
 * @param {object} model 偽の LanguageModel
 * @param {boolean} [enabled] AI_ENABLED
 */
function makeController(model, enabled = true) {
  const states = [];
  const controller = createLanguageModelController({
    categories: CATEGORIES,
    enabled,
    onStateChange: (state) => states.push(state.mode),
    getLanguageModel: () => model,
  });
  return { controller, states };
}

test('AI_ENABLED が false なら disabled（config）で、cloneSession は reject する', async () => {
  const { controller } = makeController(fakeLanguageModel(), false);
  await controller.init();
  assert.deepEqual(controller.getState(), { mode: 'disabled', disabledReason: 'config' });
  await assert.rejects(controller.cloneSession());
});

test('LanguageModel が無ければ disabled（unsupported）', async () => {
  const { controller } = makeController(undefined);
  await controller.init();
  assert.deepEqual(controller.getState(), { mode: 'disabled', disabledReason: 'unsupported' });
});

test('unavailable なら disabled（unavailable）、availability の例外なら failed', async () => {
  const unavailable = makeController(fakeLanguageModel({ availability: 'unavailable' }));
  await unavailable.controller.init();
  assert.equal(unavailable.controller.getState().mode, 'disabled');
  assert.equal(unavailable.controller.getState().disabledReason, 'unavailable');

  const broken = makeController(fakeLanguageModel({ availability: new Error('boom') }));
  await broken.controller.init();
  assert.equal(broken.controller.getState().mode, 'failed');
  await assert.rejects(broken.controller.cloneSession());
});

test('available ならユーザー操作なしで作成し、ready になってから clone できる。availability と create に同じ言語指定を渡す', async () => {
  const model = fakeLanguageModel();
  const { controller, states } = makeController(model);
  await controller.init();
  assert.equal(model.log.creates.length, 1);
  assert.equal(controller.getState().mode, 'initializing');

  const clonePromise = controller.cloneSession();
  model.log.creates[0].resolve();
  assert.deepEqual(await clonePromise, { id: 'clone-1' });
  assert.equal(controller.getState().mode, 'ready');
  assert.deepEqual(states.at(-1), 'ready');

  const [availabilityOptions] = model.log.availabilityOptions;
  const [createOptions] = model.log.createOptions;
  assert.deepEqual(createOptions.expectedInputs, availabilityOptions.expectedInputs);
  assert.deepEqual(createOptions.expectedOutputs, availabilityOptions.expectedOutputs);
  assert.deepEqual(availabilityOptions.expectedInputs, [{ type: 'text', languages: ['ja'] }]);
  assert.equal(createOptions.initialPrompts[0].role, 'system');
});

test('downloadable なら needs-activation で待ち、activate() の同期区間で create を呼ぶ', async () => {
  const model = fakeLanguageModel({ availability: 'downloadable' });
  const { controller } = makeController(model);
  await controller.init();
  assert.equal(controller.getState().mode, 'needs-activation');
  assert.equal(model.log.creates.length, 0);

  controller.activate();
  assert.equal(model.log.creates.length, 1, 'await を挟まずに create を呼ぶ');
  controller.activate();
  assert.equal(model.log.creates.length, 1, '2 回目は作成し直さない');

  // ダウンロードの進み具合を状態に出す
  const target = new EventTarget();
  model.log.createOptions[0].monitor(target);
  const progress = new Event('downloadprogress');
  progress.loaded = 0.5;
  target.dispatchEvent(progress);
  assert.deepEqual(controller.getState(), { mode: 'initializing', progress: 0.5 });

  model.log.creates[0].resolve();
  await settle();
  assert.equal(controller.getState().mode, 'ready');
});

test('作成に失敗したら failed になり、cloneSession は reject する', async () => {
  const model = fakeLanguageModel();
  const { controller } = makeController(model);
  await controller.init();
  const clonePromise = controller.cloneSession();
  model.log.creates[0].reject(new Error('NotAllowedError'));
  await assert.rejects(clonePromise, /NotAllowedError/);
  assert.equal(controller.getState().mode, 'failed');
});

test('ready の後の markFailed は failed にする。disabled は変えない', async () => {
  const model = fakeLanguageModel();
  const { controller } = makeController(model);
  await controller.init();
  model.log.creates[0].resolve();
  await settle();
  controller.markFailed(new Error('x'));
  assert.equal(controller.getState().mode, 'failed');

  const disabled = makeController(fakeLanguageModel(), false);
  await disabled.controller.init();
  disabled.controller.markFailed(new Error('x'));
  assert.equal(disabled.controller.getState().mode, 'disabled');
});
