// Pruebas del servidor: se ejecuta el Worker ya empaquetado contra una base
// SQLite en memoria (misma sintaxis que D1) y un servicio push simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/dist/worker.js';

const ece = createRequire(import.meta.url)('http_ece');

// --- Imitación mínima de la API de D1 ---
class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; }
  runSync() { const s = this.db.prepare(this.sql); return /^\s*SELECT/i.test(this.sql) ? { results: s.all(...this.args) } : { meta: { changes: Number(s.run(...this.args).changes) } }; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try { const r = stmts.map((s) => s.runSync()); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}

// --- "iPhone" simulado: claves de una suscripción push real ---
function fakeDevice(host = 'web.push.apple.com') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh, auth,
    subscription: { endpoint: `https://${host}/QABC-${crypto.randomBytes(6).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
  };
}

let clock = Date.parse('2026-11-13T10:00:20Z'); // viernes, 11:00 en Madrid
const pushes = [];
let pushStatus = 201;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  pushes.push({ url: String(url), headers: init.headers, body: Buffer.from(init.body) });
  return new Response(pushStatus === 201 ? '' : 'error', { status: pushStatus });
};
test.after(() => { globalThis.fetch = realFetch; });

const TOKEN = 'clave-privada-de-prueba-123';
const env = { DB: new D1(), AUTH_TOKEN: TOKEN, NOW: () => clock };
const BASE = 'https://agenda-push.ejemplo.workers.dev';
const api = (path, { method = 'GET', body, token = TOKEN } = {}) =>
  worker.fetch(new Request(BASE + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
const tickAt = async (isoTime) => { clock = Date.parse(isoTime); await worker.scheduled({ scheduledTime: clock }, env, { waitUntil() {} }); };
const decrypt = (dev, p) => JSON.parse(ece.decrypt(p.body, { version: 'aes128gcm', privateKey: dev.ecdh, authSecret: dev.auth.toString('base64url') }).toString());
const item = (o) => ({ notes: '', categoryId: '', repeat: null, reminders: [], updatedAt: clock, ...o });

const phone = fakeDevice();
let vapidPublicKey;

test('sin clave no se puede leer ni escribir nada', async () => {
  for (const [path, method] of [['/api/info', 'GET'], ['/api/sync', 'POST'], ['/api/hoy', 'GET'], ['/api/test', 'POST']]) {
    assert.equal((await api(path, { method, token: '' })).status, 401);
    assert.equal((await api(path, { method, token: 'otra-clave-incorrecta' })).status, 401);
  }
  assert.equal((await worker.fetch(new Request(BASE + '/api/info'), { DB: env.DB, AUTH_TOKEN: 'corta' })).status, 500);
  assert.equal((await api('/cal/' + 'x'.repeat(32) + '.ics', { token: '' })).status, 404);
});

test('info, suscripción y notificación de prueba cifrada con VAPID válido', async () => {
  const info = await (await api('/api/info')).json();
  vapidPublicKey = info.vapidPublicKey;
  assert.equal(Buffer.from(vapidPublicKey, 'base64url').length, 65);
  assert.equal((await api('/api/subscribe', { method: 'POST', body: { subscription: { endpoint: 'https://atacante.example/x', keys: phone.subscription.keys } } })).status, 400);
  assert.equal((await api('/api/subscribe', { method: 'POST', body: { subscription: phone.subscription, appUrl: 'https://usuario.github.io/agenda/', device: 'iPhone' } })).status, 200);

  const r = await (await api('/api/test', { method: 'POST', body: {} })).json();
  assert.equal(r.sent, 1);
  const p = pushes.pop();
  assert.equal(p.url, phone.subscription.endpoint);
  assert.equal(p.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(+p.headers.TTL > 0);
  // el mensaje se descifra con las claves del dispositivo (implementación independiente)
  const msg = decrypt(phone, p);
  assert.equal(msg.web_push, 8030);
  assert.equal(msg.notification.title, 'Notificación de prueba');
  assert.equal(msg.notification.navigate, 'https://usuario.github.io/agenda/');
  // el JWT VAPID está firmado con la clave pública anunciada y es válido para Apple
  const [, t, k] = p.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapidPublicKey);
  const [h, c, s] = t.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.ok(claims.exp > clock / 1000 && claims.exp <= clock / 1000 + 24 * 3600);
  assert.match(claims.sub, /^https:\/\//);
  const raw = Buffer.from(vapidPublicKey, 'base64url');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('un recordatorio programado llega a su hora, una sola vez', async () => {
  // «Llamar» a las 15:30 con avisos 15 min antes y en el momento
  const llamada = item({ id: 'llamada', kind: 'reminder', title: 'Llamar al banco', date: '2026-11-13', time: '15:30', reminders: [{ t: 'rel', min: 15 }, { t: 'rel', min: 0 }] });
  const r = await (await api('/api/sync', { method: 'POST', body: { since: 0, changes: [llamada] } })).json();
  assert.equal(r.applied, 1);
  const info = await (await api('/api/info')).json();
  assert.deepEqual(info.next.map((n) => new Date(n.fireAt).toISOString()), ['2026-11-13T14:15:00.000Z', '2026-11-13T14:30:00.000Z']);

  pushes.length = 0;
  await tickAt('2026-11-13T14:14:05Z');
  assert.equal(pushes.length, 0); // todavía no
  await tickAt('2026-11-13T14:15:04Z');
  assert.equal(pushes.length, 1);
  assert.deepEqual(decrypt(phone, pushes[0]).notification, { title: 'Llamar al banco', body: 'En 15 min · 15:30', navigate: 'https://usuario.github.io/agenda/#d=2026-11-13', lang: 'es', dir: 'ltr', silent: false });
  await tickAt('2026-11-13T14:16:04Z');
  await tickAt('2026-11-13T14:15:30Z'); // ejecución repetida del mismo minuto
  assert.equal(pushes.length, 1); // sin duplicados
  await tickAt('2026-11-13T14:30:02Z');
  assert.equal(pushes.length, 2);
  assert.equal(decrypt(phone, pushes[1]).notification.body, 'Ahora · 15:30');
  // volver a sincronizar el mismo elemento no reenvía nada
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ ...llamada, updatedAt: clock }] } });
  await tickAt('2026-11-13T14:31:02Z');
  assert.equal(pushes.length, 2);
});

test('cambiar, completar o eliminar actualiza o cancela los avisos', async () => {
  clock = Date.parse('2026-11-13T15:00:00Z');
  const next = async () => (await (await api('/api/info')).json()).next.map((n) => `${new Date(n.fireAt).toISOString().slice(0, 16)} ${n.title}`);
  const cita = item({ id: 'cita', kind: 'event', title: 'Dentista', date: '2026-11-14', start: '10:00', end: '11:00', reminders: [{ t: 'rel', min: 60 }] });
  const tarea = item({ id: 'tarea', kind: 'task', title: 'Entregar trabajo', date: '2026-11-14', time: '23:59', priority: 'urgent', reminders: [{ t: 'abs', at: '2026-11-14T09:00' }, { t: 'abs', at: '2026-11-14T22:00' }] });
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [cita, tarea] } });
  assert.deepEqual(await next(), ['2026-11-14T08:00 Dentista', '2026-11-14T08:00 Entregar trabajo', '2026-11-14T21:00 Entregar trabajo'].sort());
  // la cita se mueve a las 12:00
  clock += 1000;
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ ...cita, start: '12:00', end: '13:00', updatedAt: clock }] } });
  assert.ok((await next()).includes('2026-11-14T10:00 Dentista'));
  assert.ok(!(await next()).includes('2026-11-14T08:00 Dentista'));
  // la tarea se completa → sus avisos desaparecen
  clock += 1000;
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ ...tarea, doneAt: new Date(clock).toISOString(), updatedAt: clock }] } });
  assert.deepEqual(await next(), ['2026-11-14T10:00 Dentista']);
  // se deshace → vuelven
  clock += 1000;
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ ...tarea, updatedAt: clock }] } });
  assert.equal((await next()).length, 3);
  // la cita se elimina
  clock += 1000;
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ id: 'cita', kind: 'event', deleted: true, updatedAt: clock }] } });
  assert.deepEqual(await next(), ['2026-11-14T08:00 Entregar trabajo', '2026-11-14T21:00 Entregar trabajo']);
  // una modificación más antigua que la guardada se ignora
  const r = await (await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ ...cita, updatedAt: clock - 5000 }] } })).json();
  assert.equal(r.applied, 0);
  pushes.length = 0;
  await tickAt('2026-11-14T08:00:03Z');
  assert.equal(pushes.length, 1);
  assert.equal(decrypt(phone, pushes[0]).notification.body, 'Vence hoy a las 23:59');
});

test('las series siguen avisando semanas después sin abrir la app', async () => {
  clock = Date.parse('2026-11-14T12:00:00Z');
  const clase = item({ id: 'clase', kind: 'event', title: 'Clase de estadística', date: '2026-11-19', start: '18:00', end: '20:00', repeat: { freq: 'weekly', interval: 1, days: [4] }, reminders: [{ t: 'rel', min: 30 }], exdates: ['2026-12-03'] });
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [clase] } });
  pushes.length = 0;
  // el cron sigue funcionando cada minuto; aquí se simulan los minutos relevantes de 4 semanas
  for (let day = 14; day <= 44; day++) {
    const d = new Date(Date.UTC(2026, 10, day));
    const ds = d.toISOString().slice(0, 10);
    await tickAt(`${ds}T05:00:00Z`);
    await tickAt(`${ds}T16:30:01Z`);
    await tickAt(`${ds}T21:00:01Z`); // «Entregar trabajo» del día 14
  }
  const got = pushes.map((p) => decrypt(phone, p).notification).filter((n) => n.title === 'Clase de estadística');
  assert.deepEqual(got.map((n) => n.navigate.slice(-10)), ['2026-11-19', '2026-11-26', '2026-12-10']); // el 3 dic está eliminada
  assert.ok(got.every((n) => n.body === 'En 30 min · 18:00–20:00'));
});

test('reintento si el servicio push falla y baja de suscripciones caducadas', async () => {
  clock = Date.parse('2026-12-15T09:00:00Z');
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [item({ id: 'r1', kind: 'reminder', title: 'Reintento', date: '2026-12-15', time: '10:30', reminders: [{ t: 'rel', min: 0 }] })] } });
  pushes.length = 0;
  pushStatus = 503;
  await tickAt('2026-12-15T09:30:01Z');
  assert.equal(pushes.length, 1);
  pushStatus = 201;
  await tickAt('2026-12-15T09:31:01Z');
  assert.equal(pushes.length, 2); // reenviado al minuto siguiente
  await tickAt('2026-12-15T09:32:01Z');
  assert.equal(pushes.length, 2);
  // suscripción caducada (410) → se elimina
  const old = fakeDevice('fcm.googleapis.com');
  await api('/api/subscribe', { method: 'POST', body: { subscription: old.subscription, appUrl: 'https://usuario.github.io/agenda/' } });
  assert.equal((await (await api('/api/info')).json()).subs, 2);
  pushStatus = 410;
  await api('/api/test', { method: 'POST', body: {} });
  pushStatus = 201;
  assert.equal((await (await api('/api/info')).json()).subs, 0);
  await api('/api/subscribe', { method: 'POST', body: { subscription: phone.subscription, appUrl: 'https://usuario.github.io/agenda/' } });
});

test('aviso de prueba programado, resumen diario, Atajos y calendario .ics', async () => {
  clock = Date.parse('2026-12-16T10:00:10Z');
  pushes.length = 0;
  const r = await (await api('/api/test', { method: 'POST', body: { delay: 60 } })).json();
  await tickAt('2026-12-16T10:01:59Z');
  assert.equal(pushes.length, r.scheduledFor <= clock ? 1 : 0);
  await tickAt('2026-12-16T10:02:01Z');
  assert.equal(pushes.length, 1);
  assert.equal(decrypt(phone, pushes[0]).notification.title, 'Aviso programado de prueba');

  // resumen diario a las 07:30 (hora de Madrid)
  await api('/api/sync', { method: 'POST', body: { since: 0, changes: [{ id: 'settings', kind: 'settings', digestOn: true, digestTime: '07:30', updatedAt: clock }] } });
  pushes.length = 0;
  await tickAt('2026-12-17T06:29:01Z');
  assert.equal(pushes.length, 0);
  await tickAt('2026-12-17T06:30:01Z');
  await tickAt('2026-12-17T06:31:01Z');
  assert.equal(pushes.length, 1);
  const d = decrypt(phone, pushes[0]).notification;
  assert.equal(d.title, 'Tu día · jueves 17');
  assert.match(d.body, /1 actividad · 1 atrasada\nPrimero: 18:00 Clase de estadística/);

  // Atajos: añadir tarea y leer el resumen
  const add = await (await api('/api/tarea', { method: 'POST', body: { titulo: 'Comprar material', prioridad: 'alta' } })).json();
  assert.ok(add.ok);
  const hoy = await (await api('/api/hoy')).text();
  assert.match(hoy, /^Jueves, 17 de diciembre/);
  assert.match(hoy, /18:00–20:00 · Clase de estadística/);
  assert.match(hoy, /TAREAS ATRASADAS \(1\)\n☐ Entregar trabajo — desde el sáb 14 nov/);
  assert.match(hoy, /TAREAS DE HOY\n☐ Comprar material/);

  // un dispositivo nuevo recupera todo con since = 0
  const all = await (await api('/api/sync', { method: 'POST', body: { since: 0, changes: [] } })).json();
  assert.ok(all.items.some((i) => i.id === add.id && i.priority === 'high'));
  assert.ok(all.items.some((i) => i.id === 'cita' && i.deleted));
  const none = await (await api('/api/sync', { method: 'POST', body: { since: all.rev, changes: [] } })).json();
  assert.equal(none.items.length, 0);

  // calendario suscribible
  const info = await (await api('/api/info')).json();
  const res = await worker.fetch(new Request(info.feedUrl), env);
  assert.equal(res.status, 200);
  const ics = await res.text();
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=TH/);
  assert.match(ics, /SUMMARY:☐ Comprar material/);
});
