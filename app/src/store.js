// store.js — keeps characters and view preferences on the phone (localStorage).
// Every access is wrapped: private browsing or a full disk must not break the app.

const INDEX_KEY = 'gcs.index';
const charKey = id => `gcs.char.${id}`;
const uiKey = id => `gcs.ui.${id}`;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

/** Saved characters, most recently used first: [{id, name, title, player, file, updated}] */
export function listCharacters() {
  const list = read(INDEX_KEY, []);
  return Array.isArray(list) ? list.sort((a, b) => (b.updated || 0) - (a.updated || 0)) : [];
}

export function upsertCharacter(entry) {
  const list = listCharacters().filter(c => c.id !== entry.id);
  list.unshift(entry);
  write(INDEX_KEY, list);
}

export function touchCharacter(id) {
  const list = listCharacters();
  const entry = list.find(c => c.id === id);
  if (entry) { entry.updated = Date.now(); write(INDEX_KEY, list); }
}

export function removeCharacter(id) {
  write(INDEX_KEY, listCharacters().filter(c => c.id !== id));
  try { localStorage.removeItem(charKey(id)); localStorage.removeItem(uiKey(id)); } catch { /* ignore */ }
}

/** The character's file text, exactly as it would be saved back to GCS. */
export function loadCharacterText(id) {
  try { return localStorage.getItem(charKey(id)); } catch { return null; }
}

/** Throws if the phone's storage is full, so the caller can tell the player. */
export function saveCharacterText(id, text) {
  write(charKey(id), text);
}

/** Per-character view state: which containers are collapsed, last tab. */
export function loadUi(id) {
  const ui = read(uiKey(id), null);
  if (!ui) return { collapsed: ['log'], tab: 'stats' }; // first open: long point log starts folded
  return { collapsed: Array.isArray(ui.collapsed) ? ui.collapsed : [], tab: ui.tab || 'stats' };
}

export function saveUi(id, ui) {
  try { write(uiKey(id), ui); } catch { /* view state is a convenience; ignore */ }
}
