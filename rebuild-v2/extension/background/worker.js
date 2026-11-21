import { REQUEST, validRequest, result, failure } from '../core/protocol.js';
import { readPreferences, writePreferences } from '../core/preferences.js';

const chromeApi = globalThis.chrome;

async function dispatch(message) {
  if (!validRequest(message)) return failure(message?.requestId, 'INVALID_REQUEST');
  try {
    switch (message.kind) {
      case REQUEST.HEALTH:
        return result(message.requestId, {
          version: chromeApi.runtime.getManifest().version,
          worker: 'RESPONDING',
          automation: 'DISABLED',
          license: 'NOT_IMPLEMENTED'
        });
      case REQUEST.READ_PREFERENCES:
        return result(message.requestId, await readPreferences(chromeApi.storage.local));
      case REQUEST.WRITE_PREFERENCES:
        return result(message.requestId, await writePreferences(chromeApi.storage.local, message.payload));
      default:
        return failure(message.requestId, 'UNSUPPORTED_REQUEST');
    }
  } catch (error) {
    const code = error?.message;
    if (code === 'PREFERENCES_SCHEMA_MISMATCH' || code === 'PREFERENCES_INVALID_INPUT') {
      return failure(message.requestId, code);
    }
    return failure(message.requestId, 'STORAGE_UNAVAILABLE');
  }
}

// A worker may be suspended at any time. No global session state is trusted.
chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chromeApi.runtime.id) return false;
  void dispatch(message).then(respond, () => respond(failure(message?.requestId, 'INTERNAL_ERROR')));
  return true;
});
