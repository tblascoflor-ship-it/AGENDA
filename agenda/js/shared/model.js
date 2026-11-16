// Modelo de datos y reglas de la agenda: recurrencias, excepciones,
// estado de las tareas (pendiente / completada / cancelada) y ediciones.
// Módulo puro (sin DOM ni almacenamiento): lo usan la app y el servidor.
//
// Un elemento ("item") es uno de: actividad (event), tarea (task) o recordatorio (reminder).
//   { id, kind, title, notes, categoryId, date,
//     allDay, start, end            (actividad)
//     time, priority                (tarea; time también en recordatorio)
//     repeat: null | { freq:'daily'|'weekly'|'monthly', interval, days:[1..7], until },
//     reminders: [ {t:'rel', min} | {t:'abs', at:'YYYY-MM-DDTHH:MM'} ],
//     exdates: [fecha],             ocurrencias eliminadas de una serie
//     overrides: { fecha: {...} },  ocurrencias editadas de una serie
//     occ: { fecha: {doneAt, cancelledAt} }  estado por repetición (tareas recurrentes)
//     doneAt, cancelledAt, origDate, history  (tareas no recurrentes)
//     createdAt, updatedAt, deleted }
// Las series NO generan un registro por ocurrencia: se calculan al vuelo.

import * as D from './dates.js';

export const PRIORITIES = [
  { id: 'urgent', label: 'Urgente', rank: 0 },
  { id: 'high', label: 'Alta', rank: 1 },
  { id: 'medium', label: 'Media', rank: 2 },
  { id: 'low', label: 'Baja', rank: 3 },
];
export const prioRank = (p) => (PRIORITIES.find((x) => x.id === p) || PRIORITIES[2]).rank;
export const prioLabel = (p) => (PRIORITIES.find((x) => x.id === p) || PRIORITIES[2]).label;

export const OV_FIELDS = ['title', 'notes', 'categoryId', 'date', 'allDay', 'start', 'end', 'time', 'priority', 'reminders'];
const FAR_PAST = '0001-01-01';

export const isRecurring = (item) => !!(item && item.repeat && item.repeat.freq);

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

// ---------- Recurrencias ----------

// Fechas base de una serie dentro de [from, to] (sin aplicar excepciones)
export function baseDates(item, from, to) {
  const start = item.date;
  if (!start) return [];
  if (!isRecurring(item)) return start >= from && start <= to ? [start] : [];
  const r = item.repeat;
  const interval = Math.max(1, parseInt(r.interval, 10) || 1);
  const end = r.until && r.until < to ? r.until : to;
  if (end < start || end < from) return [];
  const out = [];
  const nEnd = D.toNum(end);
  if (r.freq === 'daily') {
    const n0 = D.toNum(start);
    const nf = Math.max(n0, D.toNum(from));
    const k = Math.ceil((nf - n0) / interval);
    for (let n = n0 + k * interval; n <= nEnd; n += interval) out.push(D.fromNum(n));
  } else if (r.freq === 'weekly') {
    const days = r.days && r.days.length ? r.days : [D.dow(start)];
    const w0 = D.toNum(D.startOfWeek(start));
    for (let n = Math.max(D.toNum(start), D.toNum(from)); n <= nEnd; n++) {
      const pos = (n - w0) % 7;
      if (Math.floor((n - w0) / 7) % interval !== 0) {
        n += 6 - pos; // salta al final de una semana que no toca
        continue;
      }
      if (days.includes(pos + 1)) out.push(D.fromNum(n));
    }
  } else if (r.freq === 'monthly') {
    const s = D.parse(start);
    const f = D.parse(from < start ? start : from);
    let k = Math.max(0, (f.y - s.y) * 12 + (f.m - s.m));
    k = Math.max(0, Math.floor(k / interval) * interval);
    for (; ; k += interval) {
      const idx = s.m - 1 + k;
      const y = s.y + Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const ds = D.ymd(y, m, Math.min(s.d, D.daysInMonth(y, m))); // día 31 → último día del mes
      if (ds > end) break;
      if (ds >= from && ds >= start) out.push(ds);
    }
  }
  return out;
}

export const isOccurrence = (item, date) => baseDates(item, date, date).length > 0;

// Una ocurrencia concreta, con sus excepciones y su estado ya aplicados
export function instance(item, key) {
  const rec = isRecurring(item);
  const ov = rec && item.overrides ? item.overrides[key] : null;
  const st = rec ? (item.occ && item.occ[key]) || {} : item;
  return {
    title: item.title || '',
    notes: item.notes || '',
    categoryId: item.categoryId || '',
    allDay: !!item.allDay,
    start: item.start || '',
    end: item.end || '',
    time: item.time || '',
    priority: item.priority || 'medium',
    reminders: item.reminders || [],
    ...(ov || {}),
    item,
    id: item.id,
    kind: item.kind,
    key,
    uid: `${item.id}|${key}`,
    recurring: rec,
    edited: !!ov,
    date: (ov && ov.date) || key,
    origDate: rec ? key : item.origDate || item.date,
    doneAt: st.doneAt || null,
    cancelledAt: st.cancelledAt || null,
  };
}

// Ocurrencias cuya fecha efectiva cae en [from, to]
export function expand(item, from, to) {
  if (!item || item.deleted || !item.date) return [];
  if (!isRecurring(item)) return item.date >= from && item.date <= to ? [instance(item, item.date)] : [];
  const ex = new Set(item.exdates || []);
  const seen = new Set();
  const out = [];
  for (const k of baseDates(item, from, to)) {
    if (ex.has(k)) continue;
    seen.add(k);
    const i = instance(item, k);
    if (i.date >= from && i.date <= to) out.push(i);
  }
  // ocurrencias movidas a este rango desde fuera de él
  const ov = item.overrides || {};
  for (const k in ov) {
    if (seen.has(k) || ex.has(k)) continue;
    const d = ov[k] && ov[k].date;
    if (d && d >= from && d <= to && isOccurrence(item, k)) out.push(instance(item, k));
  }
  return out;
}

export function expandAll(items, from, to, kinds) {
  const out = [];
  for (const it of items) {
    if (it.deleted || (kinds && !kinds.includes(it.kind))) continue;
    for (const i of expand(it, from, to)) out.push(i);
  }
  return out;
}

const PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
export function repeatLabel(repeat, startDate, ref) {
  if (!repeat || !repeat.freq) return 'No se repite';
  const n = Math.max(1, parseInt(repeat.interval, 10) || 1);
  let s = '';
  if (repeat.freq === 'daily') s = n === 1 ? 'Todos los días' : `Cada ${n} días`;
  else if (repeat.freq === 'weekly') {
    const days = (repeat.days && repeat.days.length ? repeat.days : startDate ? [D.dow(startDate)] : []).slice().sort();
    const every = n === 1 ? '' : `Cada ${n} semanas: `;
    if (days.length === 7) s = n === 1 ? 'Todos los días' : `Cada ${n} semanas, todos los días`;
    else if (days.join() === '1,2,3,4,5') s = every ? every + 'lun a vie' : 'De lunes a viernes';
    else if (days.length === 1) s = n === 1 ? `Todos los ${PLURAL[days[0] - 1]}` : `Cada ${n} semanas, los ${PLURAL[days[0] - 1]}`;
    else s = (every || 'Cada semana: ') + days.map((d) => D.DIAS_CORTO[d - 1]).join(', ');
  } else if (repeat.freq === 'monthly') {
    const day = startDate ? `, el día ${D.parse(startDate).d}` : '';
    s = (n === 1 ? 'Cada mes' : `Cada ${n} meses`) + day;
  }
  if (repeat.until) s += ` · hasta el ${D.fmtDayMonth(repeat.until, ref)}`;
  return s;
}

// ---------- Actividades en el calendario ----------

// Minutos de inicio y fin de una actividad (fin > 1440 si termina al día siguiente)
export function timeRange(inst) {
  const s = D.hmToMin(inst.start || '00:00');
  let e = D.hmToMin(inst.end || inst.start || '00:00');
  if (e <= s) e += 1440;
  return { s, e };
}

// Lo que hay que pintar en un día: actividades con hora (recortadas al día),
// actividades de todo el día y recordatorios puntuales.
export function daySegments(items, date) {
  const prev = D.addDays(date, -1);
  const allDay = [];
  const timed = [];
  const points = [];
  for (const it of items) {
    if (it.deleted) continue;
    if (it.kind === 'event') {
      for (const inst of expand(it, prev, date)) {
        if (inst.allDay) {
          if (inst.date === date) allDay.push(inst);
          continue;
        }
        const r = timeRange(inst);
        const shift = inst.date === date ? 0 : -1440;
        const s = r.s + shift;
        const e = r.e + shift;
        if (e <= 0 || s >= 1440) continue;
        timed.push({ inst, s: Math.max(0, s), e: Math.min(1440, e), before: s < 0, after: e > 1440 });
      }
    } else if (it.kind === 'reminder') {
      for (const inst of expand(it, date, date)) points.push(inst);
    }
  }
  timed.sort((a, b) => a.s - b.s || b.e - a.e);
  points.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return { allDay, timed, points };
}

// ---------- Tareas ----------

export const isPending = (inst) => !inst.doneAt && !inst.cancelledAt;

export function sortTasks(list) {
  return list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time || '99:99').localeCompare(b.time || '99:99') ||
      prioRank(a.priority) - prioRank(b.priority) ||
      a.title.localeCompare(b.title)
  );
}

// Todas las tareas pendientes: cada tarea (o cada repetición) sigue aquí
// hasta que se completa, se cancela o se elimina. Las recurrentes se generan
// desde su inicio hasta `until`; las no recurrentes se incluyen siempre.
export function pendingTasks(items, until) {
  const out = [];
  for (const it of items) {
    if (it.deleted || it.kind !== 'task') continue;
    if (!isRecurring(it)) {
      const i = instance(it, it.date);
      if (isPending(i)) out.push(i);
    } else {
      for (const i of expand(it, FAR_PAST, until)) if (isPending(i)) out.push(i);
    }
  }
  return sortTasks(out);
}

function stateList(items, field) {
  const out = [];
  for (const it of items) {
    if (it.deleted || it.kind !== 'task') continue;
    if (!isRecurring(it)) {
      if (it[field]) out.push(instance(it, it.date));
    } else {
      const occ = it.occ || {};
      for (const k in occ) if (occ[k] && occ[k][field]) out.push(instance(it, k));
    }
  }
  return out.sort((a, b) => String(b[field]).localeCompare(String(a[field])));
}
export const completedTasks = (items) => stateList(items, 'doneAt').filter((i) => !i.cancelledAt || i.doneAt);
export const cancelledTasks = (items) => stateList(items, 'cancelledAt').filter((i) => !i.doneAt);

function logged(item, entry) {
  const history = (item.history || []).concat([entry]);
  return history.length > 200 ? history.slice(-200) : history;
}
function setState(item, key, patch, action, nowISO) {
  if (isRecurring(item)) {
    const occ = { ...(item.occ || {}) };
    const cur = { ...(occ[key] || {}), ...patch };
    for (const k in cur) if (cur[k] == null) delete cur[k];
    if (Object.keys(cur).length) occ[key] = cur;
    else delete occ[key];
    return { ...item, occ };
  }
  return { ...item, ...patch, history: logged(item, { at: nowISO, a: action }) };
}
// Marca (o desmarca) una tarea o una repetición concreta como completada
export function setDone(item, key, done, nowISO) {
  return setState(item, key, { doneAt: done ? nowISO : null, cancelledAt: null }, done ? 'done' : 'undone', nowISO);
}
export function setCancelled(item, key, cancelled, nowISO) {
  return setState(item, key, { cancelledAt: cancelled ? nowISO : null, doneAt: null }, cancelled ? 'cancelled' : 'restored', nowISO);
}
// Cambia la fecha de una tarea (o de una repetición) conservando todo lo demás
export function reschedule(item, key, newDate, nowISO) {
  if (isRecurring(item)) {
    const overrides = { ...(item.overrides || {}) };
    const from = (overrides[key] && overrides[key].date) || key;
    overrides[key] = { ...(overrides[key] || {}), date: newDate };
    return { ...item, overrides, history: logged(item, { at: nowISO, a: 'moved', k: key, from, to: newDate }) };
  }
  if (newDate === item.date) return item;
  return {
    ...item,
    origDate: item.origDate || item.date,
    date: newDate,
    history: logged(item, { at: nowISO, a: 'moved', from: item.date, to: newDate }),
  };
}

// ---------- Edición y borrado con alcance ----------

function splitMap(map, key) {
  const before = {};
  const after = {};
  for (const k in map || {}) (k < key ? before : after)[k] = map[k];
  return [before, after];
}

// Aplica una edición. scope: 'one' (solo esta ocurrencia), 'future' (esta y las
// siguientes) o 'all' (toda la serie / elemento no recurrente).
// Devuelve la lista de elementos que hay que guardar.
export function applyEdit(item, key, fields, scope, newId, nowISO) {
  const rec = isRecurring(item);
  if (!rec || scope === 'all') {
    const next = { ...item, ...fields };
    if (rec) {
      const shown = instance(item, key).date;
      const delta = fields.date ? D.diffDays(shown, fields.date) : 0;
      next.date = D.addDays(item.date, delta);
    } else if (item.kind === 'task' && fields.date && fields.date !== item.date) {
      next.origDate = item.origDate || item.date;
      next.history = logged(item, { at: nowISO, a: 'moved', from: item.date, to: fields.date });
    }
    if (!rec && isRecurring(next)) {
      delete next.doneAt;
      delete next.cancelledAt;
    }
    if (!isRecurring(next)) next.repeat = null;
    return [next];
  }
  if (scope === 'one') {
    const overrides = { ...(item.overrides || {}), [key]: pick(fields, OV_FIELDS) };
    return [{ ...item, overrides }];
  }
  // 'future': la serie original termina el día anterior y nace una nueva
  if (key <= item.date) return applyEdit(item, key, fields, 'all', newId, nowISO);
  const [ovA, ovB] = splitMap(item.overrides, key);
  const [occA, occB] = splitMap(item.occ, key);
  delete ovB[key];
  const exA = (item.exdates || []).filter((d) => d < key);
  const exB = (item.exdates || []).filter((d) => d >= key);
  const old = { ...item, repeat: { ...item.repeat, until: D.addDays(key, -1) }, overrides: ovA, occ: occA, exdates: exA };
  const fresh = {
    ...item,
    ...fields,
    id: newId,
    date: fields.date || key,
    overrides: ovB,
    occ: occB,
    exdates: exB,
    history: [],
    createdAt: nowISO,
  };
  if (!isRecurring(fresh)) fresh.repeat = null;
  return [old, fresh];
}

export function applyDelete(item, key, scope) {
  if (!isRecurring(item) || scope === 'all') return [{ ...item, deleted: true }];
  if (scope === 'one') {
    const overrides = { ...(item.overrides || {}) };
    delete overrides[key];
    const exdates = Array.from(new Set([...(item.exdates || []), key]));
    return [{ ...item, overrides, exdates }];
  }
  if (key <= item.date) return [{ ...item, deleted: true }];
  return [{ ...item, repeat: { ...item.repeat, until: D.addDays(key, -1) } }];
}

// ---------- Resumen del día (Inicio, resumen diario y Atajos) ----------

export function overview(items, today, toLocalDate = (iso) => D.todayLocal(new Date(iso))) {
  const tomorrow = D.addDays(today, 1);
  const weekEnd = D.addDays(today, 7);
  const pending = pendingTasks(items, weekEnd);
  const overdue = pending
    .filter((t) => t.date < today)
    .sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || a.date.localeCompare(b.date));
  const tasksToday = pending.filter((t) => t.date === today);
  const tasksTomorrow = pending.filter((t) => t.date === tomorrow);
  const done = completedTasks(items).filter((t) => t.date === today || toLocalDate(t.doneAt) === today);
  const doneToday = done.filter((t) => toLocalDate(t.doneAt) === today || t.date === today);
  const upcomingReminders = expandAll(items, D.addDays(today, 2), weekEnd, ['reminder']);
  const upcoming = pending
    .filter((t) => t.date > tomorrow && t.date <= weekEnd)
    .concat(upcomingReminders)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
  return {
    today: daySegments(items, today),
    tomorrow: daySegments(items, tomorrow),
    overdue,
    tasksToday,
    tasksTomorrow,
    doneToday,
    upcoming,
    progress: { done: doneToday.length, total: doneToday.length + tasksToday.length },
    badge: overdue.length + tasksToday.length,
  };
}

export function overviewText(ov, today, nowHM) {
  const lines = [`${D.cap(D.fmtLong(today))}`];
  const t = ov.today;
  if (t.allDay.length || t.timed.length || t.points.length) {
    lines.push('', 'HOY');
    for (const i of t.allDay) lines.push(`Todo el día · ${i.title}`);
    const rows = t.timed
      .map((s) => ({ k: s.s, txt: `${D.minToHM(s.s)}–${D.minToHM(s.e)} · ${s.inst.title}` }))
      .concat(t.points.map((i) => ({ k: D.hmToMin(i.time || '00:00'), txt: `${i.time} · ${i.title}` })))
      .sort((a, b) => a.k - b.k);
    for (const r of rows) lines.push(r.txt);
  } else lines.push('', 'Sin actividades hoy');
  if (ov.overdue.length) {
    lines.push('', `TAREAS ATRASADAS (${ov.overdue.length})`);
    for (const i of ov.overdue.slice(0, 8)) lines.push(`☐ ${i.title} — desde el ${D.fmtShort(i.date, today)}`);
    if (ov.overdue.length > 8) lines.push(`… y ${ov.overdue.length - 8} más`);
  }
  if (ov.tasksToday.length) {
    lines.push('', 'TAREAS DE HOY');
    for (const i of ov.tasksToday) lines.push(`☐ ${i.title}${i.time ? ' — ' + i.time : ''}`);
  }
  if (!ov.overdue.length && !ov.tasksToday.length) lines.push('', 'Sin tareas pendientes para hoy');
  return lines.join('\n');
}
