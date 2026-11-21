import test from 'node:test';
import assert from 'node:assert/strict';
import { withinDeadline } from '../extension/core/deadline.js';
test('retorna o resultado de chamada rápida', async () => {
  assert.equal(await withinDeadline(async () => 'ready', 200), 'ready');
});
test('reporta timeout quando a operação nunca conclui', async () => {
  await assert.rejects(withinDeadline(() => new Promise(() => {}), 10), /REQUEST_TIMEOUT/);
});
test('preserva um erro original e rejeita duração inválida', async () => {
  await assert.rejects(withinDeadline(() => { throw new Error('unavailable'); }, 200), /unavailable/);
  await assert.rejects(withinDeadline(() => 'x', -10), /INVALID_DEADLINE/);
});
