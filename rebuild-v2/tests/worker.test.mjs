import test from 'node:test';
import assert from 'node:assert/strict';
let sequence = 0;
async function startWorker({ broken = false, legacy = undefined } = {}) {
  let listener;
  const data = legacy ?? {};
  globalThis.chrome = {
    runtime: {
      id: 'isolated-lab',
      getManifest: () => ({ version: '0.1.0' }),
      onMessage: { addListener: (fn) => { listener = fn; } }
    },
    storage: { local: {
      get: async (key) => { if (broken) throw new Error('offline'); return { [key]: data[key] }; },
      set: async (patch) => { if (broken) throw new Error('offline'); Object.assign(data, patch); }
    } }
  };
  await import(`../extension/background/worker.js?case=${++sequence}`);
  async function send(message, id = 'isolated-lab') {
    return new Promise((resolve) => {
      const handled = listener(message, { id }, resolve);
      if (!handled) resolve(undefined);
    });
  }
  return { send, data };
}
test('worker atende health sem autenticação falsa', async () => {
  const { send } = await startWorker();
  const r = await send({ protocol: 1, kind: 'CORE_HEALTH', requestId: 'r1' });
  assert.equal(r.ok, true);
  assert.equal(r.data.worker, 'RESPONDING');
  assert.equal(r.data.license, 'NOT_IMPLEMENTED');
});
test('worker não atende remetente estranho e recusa mensagem arbitrária', async () => {
  const { send } = await startWorker();
  const req = { protocol: 1, kind: 'CORE_HEALTH', requestId: 'r2' };
  assert.equal(await send(req, 'foreign-extension'), undefined);
  assert.equal((await send({ ...req, kind: 'REMOTE_EVAL' })).error.code, 'INVALID_REQUEST');
});
test('worker não mascara falha de armazenamento', async () => {
  const { send } = await startWorker({ broken: true });
  const r = await send({ protocol: 1, kind: 'PREFERENCES_READ', requestId: 'r3' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'STORAGE_UNAVAILABLE');
});
