import test from 'node:test';
import assert from 'node:assert/strict';
import { PREF_KEY, decodePreferences, readPreferences, writePreferences } from '../extension/core/preferences.js';
function fakeStorage(seed = {}) {
  const obj = structuredClone(seed);
  return { get: async (key) => ({ [key]: obj[key] }), set: async (changes) => Object.assign(obj, changes), data: obj };
}
test('início limpo cria padrão sem gravar nada implicitamente', async () => {
  const storage = fakeStorage();
  assert.deepEqual(await readPreferences(storage), { version: 1, diagnosticsEnabled: false });
  assert.deepEqual(storage.data, {});
});
test('preferência sobrevive a múltiplas leituras e nova instância', async () => {
  const storage = fakeStorage();
  await writePreferences(storage, { diagnosticsEnabled: true });
  const restarted = fakeStorage(storage.data);
  assert.deepEqual(await readPreferences(restarted), { version: 1, diagnosticsEnabled: true });
  assert.deepEqual(restarted.data[PREF_KEY], { version: 1, diagnosticsEnabled: true });
});
test('rejeita esquema desconhecido ou preferências adicionais', async () => {
  assert.throws(() => decodePreferences({ version: 999, diagnosticsEnabled: true }), /SCHEMA_MISMATCH/);
  await assert.rejects(writePreferences(fakeStorage(), { diagnosticsEnabled: true, token: 'x' }), /INVALID_INPUT/);
});
test('falhas no armazenamento não são disfarçadas como sucesso', async () => {
  const broken = { get: async () => { throw new Error('unavailable'); }, set: async () => { throw new Error('unavailable'); } };
  await assert.rejects(readPreferences(broken));
  await assert.rejects(writePreferences(broken, { diagnosticsEnabled: false }));
});
