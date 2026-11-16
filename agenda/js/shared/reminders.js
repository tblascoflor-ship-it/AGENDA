// Cálculo de los avisos: a qué instante exacto (UTC) debe enviarse cada
// recordatorio de cada ocurrencia, y con qué texto. Lo ejecuta el servidor.

import * as D from './dates.js';
import { expand, isRecurring, isPending } from './model.js';
import { zonedToUtc, utcToZoned, wallMinus, DEFAULT_TZ } from './tz.js';

export const DEFAULT_TIME = '09:00'; // hora de referencia para tareas sin hora y actividades de todo el día

export const QUICK_REMINDERS = [
  { min: 0, label: 'En el momento' },
  { min: 5, label: '5 minutos antes' },
  { min: 15, label: '15 minutos antes' },
  { min: 30, label: '30 minutos antes' },
  { min: 60, label: '1 hora antes' },
  { min: 1440, label: '1 día antes' },
  { min: 2880, label: '2 días antes' },
  { min: 10080, label: '1 semana antes' },
];

export function reminderLabel(r, ref) {
  if (r.t === 'abs') {
    const d = r.at.slice(0, 10);
    return `${D.fmtDayMonth(d, ref)}, ${r.at.slice(11, 16)}`;
  }
  const q = QUICK_REMINDERS.find((x) => x.min === r.min);
  if (q) return q.label;
  if (r.min % 1440 === 0) return `${r.min / 1440} días antes`;
  if (r.min % 60 === 0) return `${r.min / 60} horas antes`;
  return `${r.min} minutos antes`;
}

export const reminderKey = (r) => (r.t === 'abs' ? `a${r.at}` : `r${r.min}`);

// Hora de referencia de una ocurrencia
export function baseHM(inst) {
  if (inst.kind === 'event') return inst.allDay ? DEFAULT_TIME : inst.start || DEFAULT_TIME;
  return inst.time || DEFAULT_TIME;
}
const hasTime = (inst) => (inst.kind === 'event' ? !inst.allDay : !!inst.time);

function whenText(inst, fireDate, minutesLeft) {
  const days = D.diffDays(fireDate, inst.date);
  const hm = hasTime(inst) ? baseHM(inst) : '';
  const range = inst.kind === 'event' && !inst.allDay && inst.end ? `${inst.start}–${inst.end}` : hm;
  const task = inst.kind === 'task';
  if (days < 0) return task ? `Venció el ${D.fmtShort(inst.date)}` : `Fue el ${D.fmtShort(inst.date)}`;
  if (days === 0) {
    if (!hm) return task ? 'Vence hoy' : 'Hoy';
    if (minutesLeft <= 0) return task ? `Vence ahora (${hm})` : `Ahora · ${range}`;
    if (minutesLeft < 60) return task ? `Vence en ${minutesLeft} min (${hm})` : `En ${minutesLeft} min · ${range}`;
    return task ? `Vence hoy a las ${hm}` : `Hoy · ${range}`;
  }
  const day = `${D.dayName(inst.date)} ${D.parse(inst.date).d}`;
  const at = hm ? (task ? ` a las ${hm}` : ` · ${range}`) : '';
  if (days === 1) return task ? `Vence mañana${at}` : `Mañana, ${day}${at}`;
  const dist = days === 7 ? 'En 1 semana' : `En ${days} días`;
  return task ? `Vence en ${days === 7 ? '1 semana' : days + ' días'}: ${day} de ${D.MESES[D.parse(inst.date).m - 1]}${at}` : `${dist}: ${day} de ${D.MESES[D.parse(inst.date).m - 1]}${at}`;
}

// Avisos de un elemento cuyo instante de envío cae en [fromMs, toMs).
// Devuelve [{ id, fireAt, title, body, date }], sin duplicados.
export function computeFires(item, fromMs, toMs, tz = DEFAULT_TZ) {
  if (!item || item.deleted || !item.date) return [];
  const all = [item.reminders || []].concat(Object.values(item.overrides || {}).map((o) => (o && o.reminders) || []));
  let maxMin = 0;
  let any = false;
  for (const list of all)
    for (const r of list) {
      any = true;
      if (r.t === 'rel') maxMin = Math.max(maxMin, r.min || 0);
    }
  if (!any) return [];
  const fromDate = D.addDays(utcToZoned(fromMs, tz).date, -1);
  const toDate = D.addDays(utcToZoned(toMs, tz).date, Math.ceil(maxMin / 1440) + 1);
  const out = new Map();
  const rec = isRecurring(item);
  const add = (inst, fireAt, absKey) => {
    if (!(fireAt >= fromMs && fireAt < toMs)) return;
    const minute = Math.floor(fireAt / 60000);
    const id = `${item.id}|${absKey || inst.key}|${minute}`;
    if (out.has(id)) return;
    const base = zonedToUtc(inst.date, baseHM(inst), tz);
    const fireLocal = utcToZoned(fireAt, tz);
    out.set(id, {
      id,
      fireAt: minute * 60000,
      title: inst.title || (inst.kind === 'task' ? 'Tarea' : 'Recordatorio'),
      body: whenText(inst, fireLocal.date, Math.round((base - fireAt) / 60000)),
      date: inst.date,
    });
  };
  // Los avisos relativos se calculan para cada ocurrencia cercana
  const insts = rec ? expand(item, fromDate, toDate) : [expand(item, item.date, item.date)[0]].filter(Boolean);
  for (const inst of insts) {
    if (inst.kind === 'task' && !isPending(inst)) continue;
    for (const r of inst.reminders || []) {
      if (r.t === 'rel') {
        const w = wallMinus(inst.date, baseHM(inst), r.min || 0);
        add(inst, zonedToUtc(w.date, w.hm, tz));
      } else if (r.t === 'abs' && (!rec || (item.overrides && item.overrides[inst.key] && item.overrides[inst.key].reminders))) {
        add(inst, zonedToUtc(r.at.slice(0, 10), r.at.slice(11, 16), tz), rec ? null : 'abs');
      }
    }
  }
  // En una serie, un aviso con fecha y hora fijas suena una sola vez, referido
  // a la primera ocurrencia pendiente a partir de ese momento.
  if (rec) {
    for (const r of item.reminders || []) {
      if (r.t !== 'abs') continue;
      const fireAt = zonedToUtc(r.at.slice(0, 10), r.at.slice(11, 16), tz);
      if (!(fireAt >= fromMs && fireAt < toMs)) continue;
      const d0 = r.at.slice(0, 10);
      const next = expand(item, d0, D.addDays(d0, 400))
        .filter((i) => item.kind !== 'task' || isPending(i))
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (next) add(next, fireAt, 'abs');
    }
  }
  return Array.from(out.values()).sort((a, b) => a.fireAt - b.fireAt);
}

// ¿Hasta qué fecha puede seguir generando avisos o apareciendo como pendiente?
// Sirve al servidor para no recorrer el historial antiguo cada vez.
export function activeUntil(item) {
  if (!item || item.deleted || !item.date) return '0000-00-00';
  if (isRecurring(item)) return item.repeat.until && item.kind !== 'task' ? D.addDays(item.repeat.until, 15) : '9999-12-31';
  if (item.kind === 'task') {
    if (item.doneAt || item.cancelledAt) return String(item.doneAt || item.cancelledAt).slice(0, 10);
    return '9999-12-31';
  }
  let last = item.date;
  for (const r of item.reminders || []) if (r.t === 'abs' && r.at.slice(0, 10) > last) last = r.at.slice(0, 10);
  return D.addDays(last, 2);
}
