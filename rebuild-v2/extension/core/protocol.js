/** Isolated command protocol. No reliance on any legacy namespace. */
export const PROTOCOL = 1;
export const REQUEST = Object.freeze({
  HEALTH: 'CORE_HEALTH',
  READ_PREFERENCES: 'PREFERENCES_READ',
  WRITE_PREFERENCES: 'PREFERENCES_WRITE',
  WEB_PRESENCE: 'WEB_PRESENCE'
});
const MAX_ID_LENGTH = 64;

export function validRequest(message) {
  return Boolean(message && typeof message === 'object' && !Array.isArray(message)
    && message.protocol === PROTOCOL
    && typeof message.requestId === 'string'
    && message.requestId.length > 0 && message.requestId.length <= MAX_ID_LENGTH
    && Object.values(REQUEST).includes(message.kind));
}

export function result(requestId, data) {
  return { protocol: PROTOCOL, requestId, ok: true, data };
}

export function failure(requestId, code) {
  return { protocol: PROTOCOL, requestId: typeof requestId === 'string' ? requestId.slice(0, MAX_ID_LENGTH) : '', ok: false, error: { code } };
}

export function validResponse(response, requestId) {
  return Boolean(response && typeof response === 'object' && response.protocol === PROTOCOL
    && response.requestId === requestId && typeof response.ok === 'boolean'
    && (response.ok === true || typeof response.error?.code === 'string'));
}
