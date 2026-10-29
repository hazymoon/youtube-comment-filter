import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLanguageModelController } from '../src/lm.js';

const CATEGORIES = [{ name: '暴言', description: '乱暴な言葉' }];

/**
 * 偽の LanguageModel を作る。create はテストが resolve するまで待つ。作ったセッションごとに clone と destroy を数える。
 * @param {{ availability?: string[] }} [options] availability() が呼ばれるたびに順に返す値（尽きたら最後の値）
 */
function fakeLanguageModel({ availability = ['available'] } = {}) {
  const log = { availabilityCalls: 0, creates: [], sessions: [] };
  return {
    log,
    async availability() {
      const value = availability[Math.min(log.availabilityCalls, availability.length - 1)];
      log.availabilityCalls += 1;
      return value;
    },
    create() {
      return new Promise((resolve) => {
        log.creates.push(() => {
          const session = {
            index: log.sessions.length,
            clones: 0,
            destroyed: false,
            async clone() {
              session.clones += 1;
              return { from: session.index };
            },
            destroy() {
              session.destroyed = true;
            },
          };
          log.sessions.push(session);
          resolve(session);
        });
      });
    },
  };
}

/** マイクロタスクを一巡させる。 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function makeController(model) {
  const states = [];
  const controller = createLanguageModelController({
    categories: CATEGORIES,
    enabled: true,
    onStateChange: (state) => states.push(state.mode),
    getLanguageModel: () => model,
  });
  return { controller, states };
}

test('recreate() は基底セッションを破棄して作り直し、以降の clone は新しいセッションから作る', async () => {
  const model = fakeLanguageModel();
  const { controller, states } = makeController(model);
  await controller.init();
  model.log.creates[0]();
  await settle();
  assert.equal(controller.getState().mode, 'ready');

  controller.recreate();
  assert.equal(model.log.sessions[0].destroyed, true);
  assert.equal(controller.getState().mode, 'initializing');
  // 作り直しの間に呼ばれた clone は、新しいセッションの準備を待つ
  const cloned = controller.cloneSession();
  const ready = controller.waitForReady();
  await settle();
  assert.equal(model.log.creates.length, 2);
  model.log.creates[1]();
  await settle();

  assert.deepEqual(await cloned, { from: 1 });
  await ready;
  assert.equal(model.log.sessions[0].clones, 0);
  assert.equal(controller.getState().mode, 'ready');
  assert.deepEqual(states.slice(-2), ['initializing', 'ready']);
});

test('作り直しの時に downloadable なら needs-activation にし、activate() で作る', async () => {
  const model = fakeLanguageModel({ availability: ['available', 'downloadable'] });
  const { controller } = makeController(model);
  await controller.init();
  model.log.creates[0]();
  await settle();

  controller.recreate();
  await settle();
  assert.equal(controller.getState().mode, 'needs-activation');
  assert.equal(model.log.creates.length, 1);
  controller.activate();
  assert.equal(model.log.creates.length, 2);
});

test('ready でないときの recreate() は何もしない', async () => {
  const model = fakeLanguageModel();
  const { controller } = makeController(model);
  await controller.init();
  controller.recreate();
  await settle();
  assert.equal(model.log.creates.length, 1, '作成中は作り直さない');

  model.log.creates[0]();
  await settle();
  controller.markFailed(new Error('x'));
  controller.recreate();
  await settle();
  assert.equal(model.log.creates.length, 1, 'failed では作り直さない');
  assert.equal(model.log.sessions[0].destroyed, false);
});
