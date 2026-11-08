import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelPicker } from '../miniapp/node/bot-model.mjs';

/**
 * The model a Bot's turn runs on.
 *
 * The roster names a Bot's model as `providerId/modelId` and its effort as a level,
 * while the Host's agent takes a *selection*: the catalog entry, plus the effort to run
 * it at. Getting this wrong is not a detail: a run that hands the Host a name it does
 * not take is refused before the turn starts, so the phone would see a Bot that never
 * answers.
 *
 * The resolution mirrors the product's own: the model the Bot names, at the Bot's
 * effort, and nothing at all on a Host that does not let a run pick its model.
 */

/** The catalog the Host offers, as the official engine reads it. */
const CATALOG = {
  default: {
    providerId: 'minimax',
    modelId: 'MiniMax-M3.1-Flash',
    variants: ['thinking'],
    thinking: { default: 'medium', efforts: ['low', 'medium', 'high'] },
  },
  models: [
    {
      providerId: 'minimax',
      modelId: 'MiniMax-M3.1-Flash',
      variants: ['thinking'],
      thinking: { default: 'medium', efforts: ['low', 'medium', 'high'] },
    },
    {
      providerId: 'minimax',
      modelId: 'MiniMax-M2.1',
      displayName: 'MiniMax M2.1',
      variants: ['thinking', ''],
      thinking: { default: 'low', efforts: ['low', 'high'] },
    },
  ],
};

/**
 * A Host that lets a run pick its model.
 *
 * @param {object} [options]
 * @param {() => Promise<any>} [options.models]
 */
function hostWithModels({ models = async () => CATALOG } = {}) {
  let asked = 0;
  return {
    agent: {
      models: () => {
        asked += 1;
        return models();
      },
    },
    asked: () => asked,
  };
}

test("a Bot's own model, at its own effort, is the selection the run takes", async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  const selection = await picker.selectionFor({ model: 'minimax/MiniMax-M2.1', effort: 'high' });

  assert.deepEqual(selection, {
    providerId: 'minimax',
    modelId: 'MiniMax-M2.1',
    variant: 'thinking',
    thinking: { effort: 'high' },
  });
});

test('a Bot on the default model keeps the default model, at its effort', async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  const selection = await picker.selectionFor({ model: 'default', effort: 'low' });

  assert.deepEqual(selection, {
    providerId: 'minimax',
    modelId: 'MiniMax-M3.1-Flash',
    variant: 'thinking',
    thinking: { effort: 'low' },
  });
});

test('a Bot with no model of its own runs on the default one', async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  const selection = await picker.selectionFor({ model: undefined, effort: 'default' });

  assert.deepEqual(selection, {
    providerId: 'minimax',
    modelId: 'MiniMax-M3.1-Flash',
    variant: 'thinking',
    thinking: { effort: 'medium' },
  });
});

test('a model the catalog does not know leaves the session as it is', async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  const selection = await picker.selectionFor({ model: 'someone/else', effort: 'high' });

  assert.equal(selection, undefined);
});

test('an effort the model does not offer does not cost the turn', async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  // The first catalog model offers no 'max' effort; the Bot still runs, on its model.
  const selection = await picker.selectionFor({ model: 'minimax/MiniMax-M3.1-Flash', effort: 'max' });

  assert.deepEqual(selection, {
    providerId: 'minimax',
    modelId: 'MiniMax-M3.1-Flash',
    variant: 'thinking',
    thinking: { effort: 'medium' },
  });
});

test('thinking turned off is a model of its own', async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  const selection = await picker.selectionFor({ model: 'minimax/MiniMax-M2.1', effort: 'off' });

  assert.deepEqual(selection, { providerId: 'minimax', modelId: 'MiniMax-M2.1', variant: '' });
});

test('a Host that does not let a run pick its model gets no model at all', async () => {
  const picker = new ModelPicker({ agent: { run: async () => ({}) } });

  const selection = await picker.selectionFor({ model: 'minimax/MiniMax-M2.1', effort: 'high' });

  assert.equal(selection, undefined);
});

test('the catalog is asked for once, not once per turn', async () => {
  const host = hostWithModels();
  const picker = new ModelPicker(host);

  await picker.selectionFor({ model: 'minimax/MiniMax-M2.1', effort: 'high' });
  await picker.selectionFor({ model: 'minimax/MiniMax-M2.1', effort: 'low' });

  assert.equal(host.asked(), 1);
});

test('a failed catalog lookup is not served from the cache', async () => {
  let calls = 0;
  const host = hostWithModels({
    models: async () => {
      calls += 1;
      if (calls === 1) throw new Error('the catalog is not available');
      return CATALOG;
    },
  });
  const picker = new ModelPicker(host);

  await assert.rejects(() => picker.selectionFor({ model: 'minimax/MiniMax-M2.1' }));
  const selection = await picker.selectionFor({ model: 'minimax/MiniMax-M2.1' });

  assert.equal(selection?.modelId, 'MiniMax-M2.1');
  assert.equal(calls, 2);
});

/**
 * The catalog as the phone needs it.
 *
 * The phone offers a list of models and a list of efforts per model. A free text field
 * would offer a model the Host does not have, and an effort the model does not have, so
 * both lists are read from the Host's own catalog.
 */
test('the phone is told which models there are, and what each of them can work at', async () => {
  const picker = new ModelPicker(hostWithModels());

  const catalog = await picker.describe();

  assert.equal(catalog.supported, true);
  assert.deepEqual(catalog.default, {
    id: 'minimax/MiniMax-M3.1-Flash',
    name: 'MiniMax-M3.1-Flash',
    providerId: 'minimax',
    modelId: 'MiniMax-M3.1-Flash',
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
  });
  assert.deepEqual(catalog.models[1], {
    id: 'minimax/MiniMax-M2.1',
    name: 'MiniMax M2.1',
    providerId: 'minimax',
    modelId: 'MiniMax-M2.1',
    // This model can also run with thinking turned off, so the phone may offer that.
    efforts: ['low', 'high', 'off'],
    defaultEffort: 'low',
  });
});

test('a Host that does not let a run pick its model says so, instead of sending nothing', async () => {
  const picker = new ModelPicker({ agent: { run: async () => ({}) } });

  const catalog = await picker.describe();

  assert.deepEqual(catalog, { supported: false, models: [] });
});

test('a catalog that cannot be read leaves the phone without a list, not with a wrong one', async () => {
  const picker = new ModelPicker(
    hostWithModels({
      models: async () => {
        throw new Error('the catalog is not available');
      },
    }),
  );

  const catalog = await picker.describe();

  assert.deepEqual(catalog, { supported: false, models: [] });
});
