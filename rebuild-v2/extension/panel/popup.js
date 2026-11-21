import { PROTOCOL, REQUEST, validResponse } from '../core/protocol.js';
import { withinDeadline } from '../core/deadline.js';

const byId = (id) => document.getElementById(id);
let serial = 0;
let generation = 0;
function request(kind, payload) {
  const requestId = `${Date.now().toString(36)}-${++serial}`;
  return { protocol: PROTOCOL, kind, requestId, ...(payload === undefined ? {} : { payload }) };
}
async function workerRequest(kind, payload) {
  const req = request(kind, payload);
  const response = await withinDeadline(() => chrome.runtime.sendMessage(req), 4000);
  if (!validResponse(response, req.requestId)) throw new Error('Resposta inesperada');
  if (!response.ok) throw new Error(response.error.code);
  return response.data;
}
async function webPresence() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) return 'Sem guia ativa';
  const req = request(REQUEST.WEB_PRESENCE);
  try {
    const response = await withinDeadline(() => chrome.tabs.sendMessage(active.id, req), 2500);
    if (!validResponse(response, req.requestId) || !response.ok) return 'Resposta inválida';
    return response.data.connected ? 'Ponte ativa' : 'Não conectada';
  } catch {
    return 'Abra o WhatsApp Web';
  }
}
async function refresh() {
  const current = ++generation;
  const button = byId('refresh');
  button.disabled = true;
  const checkbox = byId('diagnostics');
  checkbox.disabled = true;
  byId('worker').textContent = 'Verificando';
  byId('storage').textContent = 'Verificando';
  byId('web').textContent = 'Verificando';
  const outcomes = await Promise.allSettled([
    workerRequest(REQUEST.HEALTH),
    workerRequest(REQUEST.READ_PREFERENCES),
    webPresence()
  ]);
  if (current !== generation) return;
  const [worker, storage, web] = outcomes;
  byId('worker').textContent = worker.status === 'fulfilled' && worker.value.worker === 'RESPONDING' ? 'Respondendo' : 'Indisponível';
  if (storage.status === 'fulfilled') {
    byId('storage').textContent = 'Íntegras (v1)';
    checkbox.checked = storage.value.diagnosticsEnabled;
    checkbox.disabled = false;
  } else {
    byId('storage').textContent = 'Erro de leitura';
  }
  byId('web').textContent = web.status === 'fulfilled' ? web.value : 'Indisponível';
  byId('status').textContent = worker.status === 'fulfilled' && storage.status === 'fulfilled'
    ? 'Núcleo local respondendo. Teste comercial não realizado.'
    : 'Falha no núcleo: verifique o serviço da extensão.';
  button.disabled = false;
}
byId('refresh').addEventListener('click', () => { void refresh(); });
byId('diagnostics').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  input.disabled = true;
  try {
    await workerRequest(REQUEST.WRITE_PREFERENCES, { diagnosticsEnabled: input.checked });
    byId('status').textContent = 'Preferência salva no navegador.';
  } catch {
    byId('status').textContent = 'Não foi possível salvar. Nenhuma alteração presumida.';
  } finally {
    await refresh();
  }
});
void refresh();
