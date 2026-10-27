export const DEFAULT_PREFERENCES = Object.freeze({ petId: null, scale: 0.75, autoCycle: false, windowPosition: null });
const KEYS = Object.keys(DEFAULT_PREFERENCES);
// Read-once compatibility keys from earlier local builds; these are not plugin IDs.
export const LEGACY_KEYS = Object.freeze({ petId: 'codexPetSpike.selectedPetId', scale: 'codexPetSpike.scale', autoCycle: 'codexPetSpike.demoAutoCycle' });

export function validatePreferences(raw, { partial = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !KEYS.includes(key)) || (!partial && KEYS.some((key) => key !== 'windowPosition' && !Object.hasOwn(raw, key)))) throw new Error('invalid_preferences');
  const result = partial ? {} : { windowPosition: null };
  for (const key of KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (key === 'petId' && value !== null && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value))) throw new Error('invalid_preferences');
    if (key === 'scale' && ![0.5, 0.75, 1].includes(value)) throw new Error('invalid_preferences');
    if (key === 'autoCycle' && typeof value !== 'boolean') throw new Error('invalid_preferences');
    if (key === 'windowPosition' && value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((name) => !['x', 'y'].includes(name)) || !['x', 'y'].every((name) => Number.isInteger(value[name]) && Math.abs(value[name]) <= 100000))) throw new Error('invalid_preferences');
    result[key] = value;
  }
  if (partial && !Object.keys(result).length) throw new Error('invalid_preferences');
  return result;
}

export async function preferenceRequest(fetchImpl, patch, { onlyIfUnpersisted = false } = {}) {
  const response = await fetchImpl('/api/preferences', patch === undefined ? { cache: 'no-store' } : { method: 'PATCH', headers: { 'content-type': 'application/json', ...(onlyIfUnpersisted ? { 'if-none-match': '*' } : {}) }, body: JSON.stringify(validatePreferences(patch, { partial: true })) });
  let body;
  try { body = await response.json(); } catch { throw new Error('preferences_response_invalid'); }
  if (onlyIfUnpersisted && response.status === 412 && body?.error === 'preferences_exists') return preferenceRequest(fetchImpl);
  if (!response.ok) throw new Error(body?.error || `http_${response.status}`);
  const preferences = validatePreferences(body.preferences);
  if (typeof body.persisted !== 'boolean') throw new Error('preferences_response_invalid');
  return { preferences, persisted: body.persisted };
}

export function readLegacyPreferences(storage) {
  const patch = {};
  for (const [key, storageKey] of Object.entries(LEGACY_KEYS)) {
    const raw = storage.getItem(storageKey);
    if (raw === null) continue;
    const value = key === 'scale' ? Number(raw) : key === 'autoCycle' ? raw === '1' : raw;
    try { Object.assign(patch, validatePreferences({ [key]: value }, { partial: true })); } catch { /* Ignore malformed legacy values, never persist them. */ }
  }
  return patch;
}

export async function loadPreferences(fetchImpl, storage) {
  const current = await preferenceRequest(fetchImpl);
  if (current.persisted || !storage) return current;
  let legacy;
  try { legacy = readLegacyPreferences(storage); } catch { return current; }
  if (!Object.keys(legacy).length) return current;
  const migrated = await preferenceRequest(fetchImpl, legacy, { onlyIfUnpersisted: true });
  if (!migrated.persisted) throw new Error('preferences_not_persisted');
  // Keep the migration source if persistence failed or its result is uncertain.
  if (migrated.persisted) {
    for (const key of Object.values(LEGACY_KEYS)) { try { storage.removeItem(key); } catch { /* Persisted values already won. */ } }
  }
  return migrated;
}
