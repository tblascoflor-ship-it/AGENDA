// Servidor privado de la agenda (Cloudflare Worker + D1, planes gratuitos).
//  - Copia remota y sincronización de los datos
//  - Programación y envío de notificaciones Web Push (cron cada minuto)
//  - Resumen para Atajos de iOS y calendario .ics suscribible
// Todo el acceso exige la clave privada AUTH_TOKEN (secreto del Worker).

import * as D from '../../js/shared/dates.js';
import { overview, overviewText } from '../../js/shared/model.js';
import { computeFires, activeUntil } from '../../js/shared/reminders.js';
import { buildICS } from '../../js/shared/ics.js';
import { utcToZoned, DEFAULT_TZ } from '../../js/shared/tz.js';
import { sendPush, generateVapidKeys, b64u } from './webpush.js';

const HOUR = 3600000;
const HORIZON = 72 * HOUR; // los avisos se materializan con 72 h de antelación…
const REFRESH = 36 * HOUR; // …y la ventana se renueva cuando quedan menos de 36 h
const GRACE = 2 * 60000; // un aviso recién creado y vencido hace < 2 min se envía igualmente
const EXPIRE = 12 * HOUR; // un aviso con más de 12 h de retraso ya no se envía
const AGENDA_KINDS = ['event', 'task', 'reminder'];
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|googleapis\.com|mozilla\.com|notify\.windows\.com)$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL, active_until TEXT NOT NULL DEFAULT '9999-12-31', has_rem INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS items_rev ON items(rev)`,
  `CREATE INDEX IF NOT EXISTS items_active ON items(deleted, active_until)`,
  `CREATE TABLE IF NOT EXISTS notif (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, fire_at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, date TEXT, status INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS notif_due ON notif(status, fire_at)`,
  `CREATE INDEX IF NOT EXISTS notif_item ON notif(item_id, status)`,
  `CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, app_url TEXT, device TEXT, created_at INTEGER, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];

let schemaReady = null;
function ensureSchema(db) {
  if (schemaReady !== db) {
    schemaReady = db;
    return db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
}

const nowOf = (env) => (env.NOW ? env.NOW() : Date.now());
const tzOf = (env) => env.TZ_NAME || DEFAULT_TZ;

async function getMeta(db, keys) {
  const q = await db.prepare(`SELECT key, value FROM meta WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const o = {};
  for (const r of q.results) o[r.key] = r.value;
  return o;
}
const setMeta = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value));

async function batchAll(db, stmts, size = 40) {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}

// ---------- Respuestas y seguridad ----------

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
function reply(env, body, status = 200, type = 'application/json; charset=utf-8') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...cors(env) },
  });
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
// Comparación en tiempo constante de la clave recibida con el secreto
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function checkAuth(req, env) {
  if (!env.AUTH_TOKEN || String(env.AUTH_TOKEN).length < 12) return 'config';
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return 'denied';
  return (await sameSecret(token, String(env.AUTH_TOKEN))) ? 'ok' : 'denied';
}

// ---------- Claves VAPID ----------

let vapidCache = null;
async function getVapid(db) {
  if (vapidCache) return vapidCache;
  const m = await getMeta(db, ['vapid']);
  if (m.vapid) return (vapidCache = JSON.parse(m.vapid));
  const fresh = await generateVapidKeys();
  await db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind('vapid', JSON.stringify(fresh)).run();
  const again = await getMeta(db, ['vapid']);
  return (vapidCache = JSON.parse(again.vapid));
}

// ---------- Programación de avisos ----------

const delPending = (db, id) => db.prepare('DELETE FROM notif WHERE item_id = ? AND status = 0').bind(id);
function fireStatements(db, item, from, to, tz) {
  const out = [];
  for (const f of computeFires(item, from, to, tz)) {
    out.push(
      db.prepare('INSERT OR IGNORE INTO notif (id, item_id, fire_at, title, body, date) VALUES (?, ?, ?, ?, ?, ?)').bind(f.id, item.id, f.fireAt, f.title, f.body, f.date)
    );
  }
  return out;
}

async function currentHorizon(db, now) {
  const m = await getMeta(db, ['horizon']);
  let h = +m.horizon || 0;
  if (h < now + HOUR) {
    h = now + HORIZON;
    await setMeta(db, 'horizon', h).run();
  }
  return h;
}

// Recalcula los avisos de todos los elementos activos (al renovar la ventana)
async function regenAll(db, now, tz) {
  const horizon = now + HORIZON;
  const today = utcToZoned(now, tz).date;
  const q = await db.prepare('SELECT data FROM items WHERE deleted = 0 AND has_rem = 1 AND active_until >= ?').bind(D.addDays(today, -1)).all();
  const stmts = [];
  for (const r of q.results) {
    const item = JSON.parse(r.data);
    stmts.push(delPending(db, item.id), ...fireStatements(db, item, now - GRACE, horizon, tz));
  }
  stmts.push(setMeta(db, 'horizon', horizon));
  await batchAll(db, stmts);
}

async function loadActive(db, fromDate) {
  const q = await db
    .prepare(`SELECT data FROM items WHERE deleted = 0 AND active_until >= ? AND kind IN ('event','task','reminder')`)
    .bind(fromDate)
    .all();
  return q.results.map((r) => JSON.parse(r.data));
}

function payloadFor(sub, n) {
  const base = sub.app_url || '';
  const navigate = base ? base + (n.date ? `#d=${n.date}` : '') : undefined;
  // Formato declarativo (iOS 18.4+): el sistema muestra el aviso sin ejecutar código.
  // En versiones anteriores lo muestra el service worker leyendo este mismo JSON.
  return { web_push: 8030, notification: { title: n.title, body: n.body, navigate, lang: 'es', dir: 'ltr', silent: false } };
}

async function pushToAll(env, db, n, now) {
  const subs = (await db.prepare('SELECT * FROM subs').all()).results;
  if (!subs.length) return { sent: 0, results: [], subs: 0 };
  const vapid = await getVapid(db);
  const m = await getMeta(db, ['origin']);
  const subject = env.VAPID_SUBJECT || m.origin || 'https://workers.cloudflare.com';
  const results = [];
  const after = [];
  let sent = 0;
  for (const s of subs) {
    const r = await sendPush(s, payloadFor(s, n), vapid, { subject, nowMs: now });
    results.push({ host: new URL(s.endpoint).host, device: s.device || '', status: r.status, ok: r.ok, detail: r.detail });
    if (r.ok) {
      sent++;
      after.push(db.prepare('UPDATE subs SET last_ok = ?, fails = 0 WHERE endpoint = ?').bind(now, s.endpoint));
    } else if (r.gone) after.push(db.prepare('DELETE FROM subs WHERE endpoint = ?').bind(s.endpoint));
    else after.push(db.prepare('UPDATE subs SET fails = fails + 1 WHERE endpoint = ?').bind(s.endpoint));
  }
  if (after.length) await db.batch(after);
  return { sent, results, subs: subs.length, transient: results.some((r) => !r.ok && (r.status === 0 || r.status === 429 || r.status >= 500)) };
}

// Se ejecuta cada minuto
async function tick(env, db) {
  const now = nowOf(env);
  const tz = tzOf(env);
  const due = (await db.prepare('SELECT * FROM notif WHERE status = 0 AND fire_at <= ? ORDER BY fire_at LIMIT 10').bind(now).all()).results;
  for (const n of due) {
    if (n.fire_at < now - EXPIRE) {
      await db.prepare('UPDATE notif SET status = 3 WHERE id = ?').bind(n.id).run();
      continue;
    }
    // Reserva el aviso antes de enviarlo: aunque dos ejecuciones coincidan, solo una lo envía
    const claim = await db.prepare('UPDATE notif SET status = 1, sent_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 0').bind(now, n.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const r = await pushToAll(env, db, n, now);
    if (r.sent === 0 && r.subs > 0 && r.transient && n.attempts < 3) {
      await db.prepare('UPDATE notif SET status = 0 WHERE id = ?').bind(n.id).run(); // reintento en el siguiente minuto
    } else if (r.sent === 0) {
      await db.prepare('UPDATE notif SET status = 2 WHERE id = ?').bind(n.id).run();
    }
  }

  const m = await getMeta(db, ['horizon', 'digest', 'digest_day', 'clean_day']);
  const local = utcToZoned(now, tz);
  const writes = [setMeta(db, 'last_tick', now)];

  if ((+m.horizon || 0) - now < REFRESH) await regenAll(db, now, tz);

  // Resumen diario opcional
  if (m.digest && m.digest_day !== local.date) {
    const late = D.hmToMin(local.hm) - D.hmToMin(m.digest);
    if (late >= 0 && late < 180) {
      writes.push(setMeta(db, 'digest_day', local.date));
      const ov = overview(await loadActive(db, D.addDays(local.date, -1)), local.date, (iso) => utcToZoned(Date.parse(iso), tz).date);
      const nEv = ov.today.timed.length + ov.today.allDay.length + ov.today.points.length;
      const parts = [];
      if (nEv) parts.push(`${nEv} ${nEv === 1 ? 'actividad' : 'actividades'}`);
      if (ov.tasksToday.length) parts.push(`${ov.tasksToday.length} ${ov.tasksToday.length === 1 ? 'tarea' : 'tareas'} para hoy`);
      if (ov.overdue.length) parts.push(`${ov.overdue.length} ${ov.overdue.length === 1 ? 'atrasada' : 'atrasadas'}`);
      if (parts.length) {
        const first = ov.today.timed[0];
        const body = parts.join(' · ') + (first ? `\nPrimero: ${D.minToHM(first.s)} ${first.inst.title}` : '');
        await pushToAll(env, db, { title: `Tu día · ${D.dayName(local.date)} ${D.parse(local.date).d}`, body, date: local.date }, now);
      }
    }
  }
  // Limpieza diaria de avisos antiguos ya enviados
  if (m.clean_day !== local.date) {
    writes.push(setMeta(db, 'clean_day', local.date), db.prepare('DELETE FROM notif WHERE status != 0 AND fire_at < ?').bind(now - 14 * 24 * HOUR));
  }
  await db.batch(writes);
}

// ---------- Sincronización ----------

function validChange(c) {
  return c && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 80 && typeof c.kind === 'string' && c.kind.length <= 20 && Number.isFinite(c.updatedAt);
}

async function applyChanges(env, db, changes) {
  const now = nowOf(env);
  const tz = tzOf(env);
  const existing = new Map();
  for (let i = 0; i < changes.length; i += 50) {
    const ids = changes.slice(i, i + 50).map((c) => c.id);
    const q = await db.prepare(`SELECT id, updated_at FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const r of q.results) existing.set(r.id, r.updated_at);
  }
  let rev = (await db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM items').first()).r;
  const stmts = [];
  const applied = [];
  for (const c of changes) {
    const prev = existing.get(c.id);
    if (prev !== undefined && prev >= c.updatedAt) continue; // gana la modificación más reciente
    rev++;
    const agenda = AGENDA_KINDS.includes(c.kind);
    const hasRem = agenda && !c.deleted && ((c.reminders && c.reminders.length) || Object.values(c.overrides || {}).some((o) => o && o.reminders && o.reminders.length)) ? 1 : 0;
    stmts.push(
      db
        .prepare(
          `INSERT INTO items (id, kind, data, updated_at, deleted, rev, active_until, has_rem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev, active_until = excluded.active_until, has_rem = excluded.has_rem`
        )
        .bind(c.id, c.kind, JSON.stringify(c), c.updatedAt, c.deleted ? 1 : 0, rev, agenda ? activeUntil(c) : '9999-12-31', hasRem)
    );
    applied.push(c);
    existing.set(c.id, c.updatedAt);
  }
  if (!applied.length) return 0;
  const agendaChanged = applied.filter((c) => AGENDA_KINDS.includes(c.kind));
  if (agendaChanged.length) {
    const horizon = await currentHorizon(db, now);
    for (const c of agendaChanged) stmts.push(delPending(db, c.id), ...fireStatements(db, c, now - GRACE, horizon, tz));
  }
  const settings = applied.find((c) => c.kind === 'settings');
  if (settings) stmts.push(setMeta(db, 'digest', settings.digestOn && D.isHM(settings.digestTime) ? settings.digestTime : ''));
  await batchAll(db, stmts);
  return applied.length;
}

async function handleSync(req, env, db) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply(env, { error: 'Petición no válida' }, 400);
  const since = Number.isFinite(body.since) ? body.since : 0;
  const changes = (Array.isArray(body.changes) ? body.changes : []).filter(validChange).slice(0, 500);
  const applied = changes.length ? await applyChanges(env, db, changes) : 0;
  const LIMIT = 1500;
  const q = await db.prepare('SELECT data, rev FROM items WHERE rev > ? ORDER BY rev LIMIT ?').bind(since, LIMIT + 1).all();
  const rows = q.results.slice(0, LIMIT);
  const rev = rows.length ? rows[rows.length - 1].rev : since;
  const more = q.results.length > LIMIT;
  // los datos ya están en JSON: se concatenan sin volver a interpretarlos
  return reply(env, `{"rev":${rev},"more":${more},"applied":${applied},"items":[${rows.map((r) => r.data).join(',')}]}`);
}

// ---------- Rutas ----------

async function route(req, env, db) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const now = nowOf(env);
  const tz = tzOf(env);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
  if (path === '/') return reply(env, 'Servidor de la agenda en marcha.', 200, 'text/plain; charset=utf-8');

  // Calendario suscribible (.ics): protegido por una clave propia, distinta de la principal
  const cal = path.match(/^\/cal\/([A-Za-z0-9_-]{20,})\.ics$/);
  if (cal && req.method === 'GET') {
    const m = await getMeta(db, ['feed_key']);
    if (!m.feed_key || !(await sameSecret(cal[1], m.feed_key))) return reply(env, 'No encontrado', 404, 'text/plain; charset=utf-8');
    const today = utcToZoned(now, tz).date;
    const ics = buildICS(await loadActive(db, D.addDays(today, -60)), { tz, nowMs: now });
    return reply(env, ics, 200, 'text/calendar; charset=utf-8');
  }

  if (!path.startsWith('/api/')) return reply(env, { error: 'No encontrado' }, 404);
  const auth = await checkAuth(req, env);
  if (auth === 'config') return reply(env, { error: 'Falta configurar el secreto AUTH_TOKEN (mínimo 12 caracteres) en el Worker.' }, 500);
  if (auth !== 'ok') return reply(env, { error: 'Clave incorrecta' }, 401);

  if (path === '/api/info' && req.method === 'GET') {
    const vapid = await getVapid(db);
    let m = await getMeta(db, ['last_tick', 'feed_key', 'origin', 'digest']);
    const setup = [];
    if (!m.feed_key) {
      m.feed_key = b64u.enc(crypto.getRandomValues(new Uint8Array(24)));
      setup.push(db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind('feed_key', m.feed_key));
    }
    if (m.origin !== url.origin) setup.push(setMeta(db, 'origin', url.origin));
    if (setup.length) {
      await db.batch(setup);
      m = await getMeta(db, ['last_tick', 'feed_key', 'origin', 'digest']);
    }
    const counts = await db.prepare('SELECT (SELECT COUNT(*) FROM subs) AS subs, (SELECT COUNT(*) FROM items WHERE deleted = 0) AS items').first();
    const next = (await db.prepare('SELECT title, body, fire_at AS fireAt FROM notif WHERE status = 0 AND fire_at > ? ORDER BY fire_at LIMIT 8').bind(now - GRACE).all()).results;
    return reply(env, {
      ok: true,
      vapidPublicKey: vapid.publicKey,
      subs: counts.subs,
      items: counts.items,
      now,
      lastTick: +m.last_tick || 0,
      tz,
      digest: m.digest || '',
      feedUrl: `${url.origin}/cal/${m.feed_key}.ics`,
      next,
    });
  }

  if (path === '/api/sync' && req.method === 'POST') return handleSync(req, env, db);

  if (path === '/api/subscribe' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const s = b && b.subscription;
    let host = '';
    try {
      const u = new URL(s.endpoint);
      if (u.protocol === 'https:') host = u.hostname;
    } catch (e) {}
    if (!s || !host || !PUSH_HOSTS.test(host) || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') {
      return reply(env, { error: 'Suscripción no válida' }, 400);
    }
    const appUrl = typeof b.appUrl === 'string' && /^https:\/\/[^\s#?]+$/.test(b.appUrl) ? b.appUrl : '';
    await db
      .prepare(
        `INSERT INTO subs (endpoint, p256dh, auth, app_url, device, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, app_url = excluded.app_url, device = excluded.device, fails = 0`
      )
      .bind(s.endpoint, s.keys.p256dh, s.keys.auth, appUrl, String(b.device || '').slice(0, 60), now)
      .run();
    return reply(env, { ok: true });
  }

  if (path === '/api/unsubscribe' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (b && typeof b.endpoint === 'string') await db.prepare('DELETE FROM subs WHERE endpoint = ?').bind(b.endpoint).run();
    return reply(env, { ok: true });
  }

  if (path === '/api/test' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const delay = Math.max(0, Math.min(3600, parseInt(b && b.delay, 10) || 0));
    if (delay > 0) {
      const at = Math.ceil((now + delay * 1000) / 60000) * 60000;
      const hm = utcToZoned(at, tz).hm;
      await db
        .prepare('INSERT OR REPLACE INTO notif (id, item_id, fire_at, title, body, date, status, attempts) VALUES (?, ?, ?, ?, ?, ?, 0, 0)')
        .bind(`test|${at}`, 'test', at, 'Aviso programado de prueba', `Programado para las ${hm}. Si lo ves con la app cerrada, todo funciona.`, null)
        .run();
      return reply(env, { ok: true, scheduledFor: at });
    }
    const r = await pushToAll(env, db, { title: 'Notificación de prueba', body: 'Las notificaciones de tu agenda funcionan.', date: null }, now);
    return reply(env, { ok: r.sent > 0, sent: r.sent, subs: r.subs, results: r.results });
  }

  // Para Atajos de iOS: resumen del día en texto
  if (path === '/api/hoy' && req.method === 'GET') {
    const local = utcToZoned(now, tz);
    const ov = overview(await loadActive(db, D.addDays(local.date, -1)), local.date, (iso) => utcToZoned(Date.parse(iso), tz).date);
    return reply(env, overviewText(ov, local.date, local.hm), 200, 'text/plain; charset=utf-8');
  }

  // Para Atajos de iOS: añadir una tarea rápida
  if (path === '/api/tarea' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const title = String((b && (b.titulo || b.title)) || '').trim().slice(0, 200);
    if (!title) return reply(env, { error: 'Falta el título' }, 400);
    const local = utcToZoned(now, tz);
    const prio = { urgente: 'urgent', alta: 'high', media: 'medium', baja: 'low' }[String(b.prioridad || '').toLowerCase()] || 'medium';
    const iso = new Date(now).toISOString();
    const item = {
      id: crypto.randomUUID(),
      kind: 'task',
      title,
      notes: '',
      categoryId: '',
      date: D.isDate(b.fecha) ? b.fecha : local.date,
      time: D.isHM(b.hora) ? b.hora : '',
      priority: prio,
      repeat: null,
      reminders: [],
      createdAt: iso,
      updatedAt: now,
      history: [{ at: iso, a: 'created' }],
    };
    await applyChanges(env, db, [item]);
    return reply(env, { ok: true, id: item.id, mensaje: `Tarea añadida: ${title}` });
  }

  return reply(env, { error: 'No encontrado' }, 404);
}

export default {
  async fetch(req, env) {
    try {
      if (!env.DB) return reply(env, { error: 'Falta enlazar la base de datos D1 con el nombre DB.' }, 500);
      await ensureSchema(env.DB);
      return await route(req, env, env.DB);
    } catch (e) {
      return reply(env, { error: 'Error interno', detail: String((e && e.message) || e).slice(0, 300) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await ensureSchema(env.DB);
    await tick(env, env.DB);
  },
};
