// Almacenamiento local permanente (IndexedDB) y estado en memoria.
// Cada cambio se escribe en disco inmediatamente y se marca como "pendiente
// de sincronizar" (dirty) hasta que el servidor lo confirma.

const DB_NAME = 'agenda';
const DB_VERSION = 1;
const AGENDA_KINDS = ['event', 'task', 'reminder'];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-trabajo', name: 'Trabajo', color: '#2f6fed' },
  { id: 'cat-estudios', name: 'Estudios', color: '#8b5cf6' },
  { id: 'cat-gimnasio', name: 'Gimnasio', color: '#12a594' },
  { id: 'cat-personal', name: 'Personal', color: '#e8590c' },
  { id: 'cat-citas', name: 'Citas', color: '#d6409f' },
  { id: 'cat-otras', name: 'Otras', color: '#7c8594' },
];
export const CATEGORY_COLORS = ['#2f6fed', '#8b5cf6', '#12a594', '#e8590c', '#d6409f', '#7c8594', '#0e9bd8', '#b7791f', '#c2410c', '#4d7c0f', '#be123c', '#475569'];
export const DEFAULT_COLOR = '#7c8594';

const all = new Map(); // id → registro (incluye borrados lógicos)
const listeners = new Set();
let db = null;
let onLocalChange = () => {};

export const state = {
  ready: false,
  version: 0,
  items: [], // actividades, tareas y recordatorios no borrados
  categories: [],
  settings: { id: 'settings', kind: 'settings', digestOn: false, digestTime: '07:30' },
  meta: { serverUrl: '', token: '', lastRev: 0, lastSync: 0, theme: 'auto', vapidKey: '' },
  persisted: null,
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const setChangeHook = (fn) => (onLocalChange = fn);
export const get = (id) => all.get(id);
export const category = (id) => state.categories.find((c) => c.id === id);
export const colorOf = (id) => (category(id) || {}).color || DEFAULT_COLOR;

function refresh() {
  const items = [];
  const cats = [];
  for (const r of all.values()) {
    if (r.deleted) continue;
    if (AGENDA_KINDS.includes(r.kind)) items.push(r);
    else if (r.kind === 'category') cats.push(r);
    else if (r.kind === 'settings') state.settings = r;
  }
  cats.sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
  state.items = items;
  state.categories = cats;
  state.version++;
  for (const fn of listeners) fn();
}

// ---------- IndexedDB ----------
const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Base de datos bloqueada por otra pestaña'));
  });
}
function putMany(records) {
  return new Promise((res, rej) => {
    const tx = db.transaction('items', 'readwrite');
    const os = tx.objectStore('items');
    for (const r of records) os.put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('No se pudo guardar'));
  });
}

export async function init() {
  db = await open();
  db.onversionchange = () => db.close();
  const tx = db.transaction(['items', 'meta'], 'readonly');
  const [records, meta] = await Promise.all([req(tx.objectStore('items').getAll()), req(tx.objectStore('meta').get('meta'))]);
  for (const r of records) all.set(r.id, r);
  if (meta) Object.assign(state.meta, meta);
  if (!state.meta.seeded) {
    // Primera apertura: categorías iniciales. updatedAt = 1 para que, si ya
    // existen en el servidor (otro dispositivo), prevalezcan las del servidor.
    const seed = DEFAULT_CATEGORIES.filter((c) => !all.has(c.id)).map((c, i) => ({ ...c, kind: 'category', order: i, updatedAt: 1, dirty: 1 }));
    if (seed.length) {
      await putMany(seed);
      for (const r of seed) all.set(r.id, r);
    }
    await setMeta({ seeded: true }, true);
  }
  // Pide al sistema que no borre estos datos para liberar espacio
  try {
    if (navigator.storage && navigator.storage.persist) state.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch (e) {}
  state.ready = true;
  refresh();
}

export async function setMeta(patch, silent) {
  Object.assign(state.meta, patch);
  await req(db.transaction('meta', 'readwrite').objectStore('meta').put({ ...state.meta }, 'meta'));
  if (!silent) refresh();
}

// Guarda cambios hechos en este dispositivo
export async function save(records) {
  const now = Date.now();
  const out = records.map((r) => ({ ...r, updatedAt: Math.max(now, (all.get(r.id) || {}).updatedAt + 1 || 0), dirty: 1 }));
  await putMany(out);
  for (const r of out) all.set(r.id, r);
  refresh();
  onLocalChange();
  return out;
}
// Borrado lógico: el registro queda como marca para que el borrado se sincronice
export function remove(ids) {
  return save(ids.filter((id) => all.has(id)).map((id) => ({ id, kind: all.get(id).kind, deleted: true })));
}

// ---------- Sincronización ----------
export const dirtyRecords = () => Array.from(all.values()).filter((r) => r.dirty);
export const stats = () => ({ total: state.items.length, dirty: dirtyRecords().length, records: all.size });

export async function markClean(sent) {
  const out = [];
  for (const s of sent) {
    const cur = all.get(s.id);
    if (cur && cur.dirty && cur.updatedAt === s.updatedAt) {
      const { dirty, ...clean } = cur;
      out.push(clean);
    }
  }
  if (!out.length) return;
  await putMany(out);
  for (const r of out) all.set(r.id, r);
  refresh();
}
// Aplica cambios llegados del servidor (gana la modificación más reciente)
export async function applyRemote(records) {
  const out = [];
  for (const r of records) {
    if (!r || !r.id) continue;
    const cur = all.get(r.id);
    if (cur && (cur.updatedAt > r.updatedAt || (cur.updatedAt === r.updatedAt && !cur.dirty))) continue;
    if (cur && cur.updatedAt === r.updatedAt && cur.dirty) {
      const { dirty, ...clean } = cur;
      out.push(clean);
      continue;
    }
    const { dirty, ...clean } = r;
    out.push(clean);
  }
  if (!out.length) return 0;
  await putMany(out);
  for (const r of out) all.set(r.id, r);
  refresh();
  return out.length;
}
// Al conectar con un servidor distinto, todo se vuelve a enviar
export async function markAllDirty() {
  const out = Array.from(all.values()).map((r) => ({ ...r, dirty: 1 }));
  await putMany(out);
  for (const r of out) all.set(r.id, r);
  refresh();
}

// ---------- Copia de seguridad ----------
export function exportData() {
  const items = Array.from(all.values()).map(({ dirty, ...r }) => r);
  return { app: 'agenda-personal', format: 1, exportedAt: new Date().toISOString(), items };
}
// Importa una copia sin duplicar: los registros se identifican por su id y
// solo se sustituyen si los de la copia son más recientes.
export async function importData(data) {
  if (!data || data.app !== 'agenda-personal' || !Array.isArray(data.items)) throw new Error('El archivo no es una copia de seguridad de esta agenda.');
  const out = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of data.items) {
    if (!r || typeof r.id !== 'string' || typeof r.kind !== 'string') {
      skipped++;
      continue;
    }
    const cur = all.get(r.id);
    if (!cur) added++;
    else if ((r.updatedAt || 0) > (cur.updatedAt || 0)) updated++;
    else {
      skipped++;
      continue;
    }
    out.push({ ...r, updatedAt: r.updatedAt || Date.now(), dirty: 1 });
  }
  if (out.length) {
    await putMany(out);
    for (const r of out) all.set(r.id, r);
    refresh();
    onLocalChange();
  }
  return { added, updated, skipped };
}
