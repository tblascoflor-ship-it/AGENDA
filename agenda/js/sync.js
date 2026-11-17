// Sincronización con el servidor privado y gestión de las notificaciones push.
// La app funciona entera sin conexión: los cambios quedan guardados en el
// teléfono y se envían en cuanto vuelve Internet.

import * as store from './store.js';

export const net = { status: 'off', error: '', info: null }; // off | idle | syncing | offline | error
const listeners = new Set();
export const onNet = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function setNet(patch) {
  Object.assign(net, patch);
  for (const fn of listeners) fn();
}

export const configured = () => !!(store.state.meta.serverUrl && store.state.meta.token);

export async function api(path, { method = 'GET', body, cfg } = {}) {
  const { serverUrl, token } = cfg || store.state.meta;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(serverUrl.replace(/\/+$/, '') + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      const err = new Error('El servidor no ha respondido a tiempo. Revisa la conexión e inténtalo de nuevo.');
      err.name = 'AbortError';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

let running = false;
let again = false;
let timer = null;

export function scheduleSync(delay = 1200) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  if (!configured()) return setNet({ status: 'off' });
  if (running) {
    again = true;
    return;
  }
  running = true;
  setNet({ status: 'syncing', error: '' });
  try {
    for (let guard = 0; guard < 200; guard++) {
      const dirty = store.dirtyRecords().slice(0, 200);
      const changes = dirty.map(({ dirty: _d, ...r }) => r);
      const r = await api('/api/sync', { method: 'POST', body: { since: store.state.meta.lastRev || 0, changes } });
      await store.applyRemote(r.items || []);
      await store.markClean(changes);
      await store.setMeta({ lastRev: r.rev || 0, lastSync: Date.now() }, true);
      if (!r.more && store.dirtyRecords().length === 0) break;
      if (!r.more && dirty.length === 0) break;
    }
    setNet({ status: 'idle', error: '' });
  } catch (e) {
    const offline = !navigator.onLine || e.name === 'TypeError' || e.name === 'AbortError';
    setNet({ status: offline ? 'offline' : 'error', error: offline ? 'Sin conexión' : e.message });
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(300);
    }
  }
}

// Conecta (o cambia) el servidor: comprueba URL y clave antes de guardar
export async function connect(serverUrl, token) {
  serverUrl = serverUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(serverUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(serverUrl)) throw new Error('La dirección debe empezar por https://');
  const info = await api('/api/info', { cfg: { serverUrl, token: token.trim() } });
  const changed = serverUrl !== store.state.meta.serverUrl;
  await store.setMeta({ serverUrl, token: token.trim(), vapidKey: info.vapidPublicKey, ...(changed ? { lastRev: 0 } : {}) });
  if (changed) await store.markAllDirty();
  setNet({ info });
  await syncNow();
  return info;
}
export async function disconnect() {
  await store.setMeta({ serverUrl: '', token: '', lastRev: 0, vapidKey: '' });
  setNet({ status: 'off', info: null, error: '' });
}
export async function loadInfo() {
  if (!configured()) return null;
  try {
    const info = await api('/api/info');
    if (info.vapidPublicKey && info.vapidPublicKey !== store.state.meta.vapidKey) await store.setMeta({ vapidKey: info.vapidPublicKey }, true);
    setNet({ info });
    return info;
  } catch (e) {
    return null;
  }
}

// ---------- Notificaciones push ----------

export const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function pushStatus() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, permission: supported ? Notification.permission : 'unsupported', standalone: isStandalone(), ios: isIOS() };
}

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const sameKey = (sub, key) => {
  try {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    const want = keyBytes(key);
    return cur.length === want.length && cur.every((v, i) => v === want[i]);
  } catch (e) {
    return true;
  }
};

async function register(sub) {
  await api('/api/subscribe', {
    method: 'POST',
    body: { subscription: sub.toJSON(), appUrl: location.origin + location.pathname.replace(/[^/]*$/, ''), device: isIOS() ? 'iPhone' : 'Navegador' },
  });
}

async function subscribe() {
  const key = store.state.meta.vapidKey || ((await loadInfo()) || {}).vapidPublicKey;
  if (!key) throw new Error('No se pudo contactar con el servidor.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await register(sub);
  return sub;
}

// Debe llamarse desde un toque del usuario (requisito de iOS)
export async function enablePush() {
  const st = pushStatus();
  if (!st.supported) throw new Error(st.ios && !st.standalone ? 'Abre la agenda desde el icono de la pantalla de inicio para activar los avisos.' : 'Este navegador no admite notificaciones push.');
  if (!configured()) throw new Error('Conecta primero el servidor.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permiso denegado. Actívalo en Ajustes del iPhone › Notificaciones › Agenda.');
  await subscribe();
  await loadInfo();
}

// En cada apertura: si ya hay permiso, renueva la suscripción en el servidor.
// iOS puede invalidar suscripciones sin avisar; así se recuperan solas.
export async function ensureSubscription() {
  const st = pushStatus();
  if (!st.supported || st.permission !== 'granted' || !configured()) return false;
  try {
    await subscribe();
    return true;
  } catch (e) {
    return false;
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try {
      await api('/api/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
    } catch (e) {}
    await sub.unsubscribe();
  }
  await loadInfo();
}

export async function hasSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (await reg.pushManager.getSubscription()));
  } catch (e) {
    return false;
  }
}

export const sendTest = (delay = 0) => api('/api/test', { method: 'POST', body: { delay } });
