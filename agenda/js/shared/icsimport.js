// Importación de calendarios .ics (horario de la universidad, Google Calendar,
// Outlook, Calendario de Apple…). Convierte cada VEVENT en una actividad de la
// agenda, conservando las repeticiones cuando la regla es compatible.

import * as D from './dates.js';
import { baseDates } from './model.js';
import { zonedToUtc, utcToZoned, DEFAULT_TZ } from './tz.js';

const unesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
const BYDAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function hash(str) {
  let h = 5381;
  let g = 52711;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
    g = (g * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36) + (g >>> 0).toString(36);
}

// Línea «NOMBRE;PARAM=valor:contenido»
function parseLine(line) {
  const m = /^([A-Za-z0-9-]+)((?:;[^:;=]+=(?:"[^"]*"|[^:;]*))*):(.*)$/.exec(line);
  if (!m) return null;
  const params = {};
  for (const p of m[2].split(';').filter(Boolean)) {
    const i = p.indexOf('=');
    params[p.slice(0, i).toUpperCase()] = p.slice(i + 1).replace(/^"|"$/g, '');
  }
  return { name: m[1].toUpperCase(), params, value: m[3] };
}

// Fecha/hora de iCalendar → { date, hm, allDay } en hora local de la agenda
function when(prop, tz) {
  if (!prop) return null;
  const v = prop.value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})/.exec(v);
  if (!d) return null;
  const date = `${d[1]}-${d[2]}-${d[3]}`;
  const t = /T(\d{2})(\d{2})/.exec(v);
  if (!t || prop.params.VALUE === 'DATE') return { date, hm: '', allDay: true };
  const hm = `${t[1]}:${t[2]}`;
  try {
    if (/Z$/.test(v)) return { ...utcToZoned(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]), tz), allDay: false };
    const src = prop.params.TZID;
    if (src && src !== tz) return { ...utcToZoned(zonedToUtc(date, hm, src), tz), allDay: false };
  } catch (e) {
    /* zona desconocida: se toma la hora tal cual */
  }
  return { date, hm, allDay: false };
}

function durationMin(v) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(String(v || '').trim());
  return m ? (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}

function parseRule(value, start, tz) {
  const r = {};
  for (const part of value.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) r[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  const interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
  let repeat;
  if (r.FREQ === 'DAILY') repeat = { freq: 'daily', interval };
  else if (r.FREQ === 'WEEKLY') {
    const days = (r.BYDAY || '').split(',').map((x) => BYDAY[x.trim().slice(-2)]).filter(Boolean);
    repeat = { freq: 'weekly', interval, days: days.length ? Array.from(new Set(days)).sort() : [D.dow(start)] };
  } else if (r.FREQ === 'MONTHLY' && !r.BYDAY) repeat = { freq: 'monthly', interval };
  else if (r.FREQ === 'YEARLY' && !r.BYDAY && !r.BYMONTHDAY && !r.BYYEARDAY && !r.BYWEEKNO) repeat = { freq: 'monthly', interval: 12 * interval };
  else return null; // regla no compatible
  repeat.until = '';
  if (r.UNTIL) {
    const u = when({ value: r.UNTIL, params: {} }, tz);
    if (u) repeat.until = u.date;
  } else if (r.COUNT) {
    const n = parseInt(r.COUNT, 10);
    const list = baseDates({ date: start, repeat }, start, D.addDays(start, 366 * 30));
    repeat.until = list[Math.min(n, list.length) - 1] || start;
  }
  return repeat;
}

// Devuelve { items, events, series, skipped, unsupported }
export function parseICS(text, { tz = DEFAULT_TZ, categoryId = '', reminderMin = null } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  let depth = 0;
  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT') cur = { ex: [] };
      else if (cur) depth++; // bloques anidados (VALARM): se ignoran
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth > 0) depth--;
      else if (cur && p.value.toUpperCase() === 'VEVENT') {
        events.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur || depth > 0) continue;
    if (p.name === 'EXDATE') cur.ex.push(p);
    else if (!cur[p.name]) cur[p.name] = p;
  }

  const byId = new Map();
  const result = { items: [], events: 0, series: 0, skipped: 0, unsupported: 0 };
  const build = (ev) => {
    const s = when(ev.DTSTART, tz);
    if (!s) return null;
    let e = when(ev.DTEND, tz);
    const item = { title: unesc(ev.SUMMARY && ev.SUMMARY.value) || 'Sin título', notes: [unesc(ev.DESCRIPTION && ev.DESCRIPTION.value), unesc(ev.LOCATION && ev.LOCATION.value)].filter(Boolean).join('\n').slice(0, 2000), date: s.date, allDay: s.allDay, start: '', end: '' };
    let spanDays = 0;
    if (s.allDay) {
      if (!e && ev.DURATION) spanDays = Math.round(durationMin(ev.DURATION.value) / 1440) - 1;
      else if (e) spanDays = D.diffDays(s.date, e.date) - 1;
    } else {
      item.start = s.hm;
      let mins = 60;
      if (e && !e.allDay) mins = D.diffDays(s.date, e.date) * 1440 + D.hmToMin(e.hm) - D.hmToMin(s.hm);
      else if (ev.DURATION) mins = durationMin(ev.DURATION.value);
      if (!(mins > 0)) mins = 30;
      item.end = D.minToHM(D.hmToMin(s.hm) + Math.min(mins, 1439));
    }
    return { item, spanDays };
  };

  // 1) eventos principales
  for (const ev of events) {
    if (ev['RECURRENCE-ID']) continue;
    const b = ev.STATUS && ev.STATUS.value.toUpperCase() === 'CANCELLED' ? null : build(ev);
    if (!b) {
      result.skipped++;
      continue;
    }
    const uid = (ev.UID && ev.UID.value.trim()) || `${b.item.title}|${b.item.date}|${b.item.start}`;
    const item = { id: `ics-${hash(uid)}`, kind: 'event', categoryId, repeat: null, reminders: reminderMin == null ? [] : [{ t: 'rel', min: reminderMin }], exdates: [], overrides: {}, ...b.item };
    if (ev.RRULE) {
      const rule = parseRule(ev.RRULE.value, item.date, tz);
      if (rule) item.repeat = rule;
      else result.unsupported++;
    } else if (b.spanDays > 0) {
      // varios días seguidos de «todo el día»: se representa como repetición diaria con fin
      item.repeat = { freq: 'daily', interval: 1, until: D.addDays(item.date, b.spanDays) };
    }
    for (const x of ev.ex) {
      for (const v of x.value.split(',')) {
        const w = when({ value: v, params: x.params }, tz);
        if (w) item.exdates.push(w.date);
      }
    }
    if (item.repeat) result.series++;
    result.events++;
    byId.set(uid, item);
    result.items.push(item);
  }
  // 2) ocurrencias modificadas de una serie
  for (const ev of events) {
    if (!ev['RECURRENCE-ID']) continue;
    const master = byId.get(ev.UID && ev.UID.value.trim());
    const orig = when(ev['RECURRENCE-ID'], tz);
    const b = build(ev);
    if (!master || !orig || !b || !master.repeat) continue;
    if (ev.STATUS && ev.STATUS.value.toUpperCase() === 'CANCELLED') master.exdates.push(orig.date);
    else master.overrides[orig.date] = { title: b.item.title, notes: b.item.notes, date: b.item.date, allDay: b.item.allDay, start: b.item.start, end: b.item.end };
  }
  return result;
}
