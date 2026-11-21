import test from 'node:test';
import assert from 'node:assert/strict';
import { validRequest, result, failure, validResponse, REQUEST } from '../extension/core/protocol.js';
test('protocolo aceita apenas formatos e comandos conhecidos', () => {
  const valid = { protocol: 1, kind: REQUEST.HEALTH, requestId: 'a1' };
  assert.equal(validRequest(valid), true);
  for (const value of [null, {}, { ...valid, protocol: 2 }, { ...valid, kind: 'EXECUTE_JS' },
    { ...valid, requestId: 'x'.repeat(65) }, { ...valid, requestId: '' }]) {
    assert.equal(validRequest(value), false);
  }
});
test('respostas associam-se ao identificador da requisição', () => {
  assert.equal(validResponse(result('a1', { ready: true }), 'a1'), true);
  assert.equal(validResponse(result('a1', {}), 'a2'), false);
  assert.equal(validResponse(failure('a1', 'DENIED'), 'a1'), true);
});
