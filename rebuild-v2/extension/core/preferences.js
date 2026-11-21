/** No account credentials, phone numbers, messages or contacts are persisted here. */
export const PREF_KEY = 'zvm_v2.preferences.v1';
export const DEFAULT_PREFERENCES = Object.freeze({ version: 1, diagnosticsEnabled: false });

export function decodePreferences(stored) {
  if (stored === undefined) return { ...DEFAULT_PREFERENCES };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)
    || stored.version !== 1 || typeof stored.diagnosticsEnabled !== 'boolean') {
    throw new Error('PREFERENCES_SCHEMA_MISMATCH');
  }
  return { version: 1, diagnosticsEnabled: stored.diagnosticsEnabled };
}

export async function readPreferences(storage) {
  const item = await storage.get(PREF_KEY);
  return decodePreferences(item[PREF_KEY]);
}

export async function writePreferences(storage, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 1 || typeof input.diagnosticsEnabled !== 'boolean') {
    throw new Error('PREFERENCES_INVALID_INPUT');
  }
  const value = { version: 1, diagnosticsEnabled: input.diagnosticsEnabled };
  await storage.set({ [PREF_KEY]: value });
  return value;
}
