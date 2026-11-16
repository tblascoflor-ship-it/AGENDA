// Exportación a formato iCalendar (.ics), compatible con el Calendario de Apple.
// Las series se exportan como reglas RRULE con sus excepciones, no ocurrencia a ocurrencia.

import * as D from './dates.js';
import { isRecurring, instance, timeRange, isOccurrence } from './model.js';
import { DEFAULT_TZ } from './tz.js';

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dnum = (d) => d.replace(/-/g, '');
const dt = (d, hm) => `${dnum(d)}T${hm.replace(':', '')}00`;
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ' ' + rest.slice(73);
  }
  out.push(rest);
  return out.join('\r\n');
}
function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function rrule(item, dateOnly) {
  const r = item.repeat;
  const n = Math.max(1, parseInt(r.interval, 10) || 1);
  let s = '';
  if (r.freq === 'daily') s = `FREQ=DAILY;INTERVAL=${n}`;
  else if (r.freq === 'weekly') {
    const days = (r.days && r.days.length ? r.days : [D.dow(item.date)]).slice().sort();
    s = `FREQ=WEEKLY;INTERVAL=${n};WKST=MO;BYDAY=${days.map((d) => BYDAY[d - 1]).join(',')}`;
  } else {
    const d = D.parse(item.date).d;
    s = `FREQ=MONTHLY;INTERVAL=${n};`;
    if (d <= 28) s += `BYMONTHDAY=${d}`;
    else {
      const list = [];
      for (let x = 28; x <= d; x++) list.push(x);
      s += `BYMONTHDAY=${list.join(',')};BYSETPOS=-1`; // día 29–31 → último día disponible
    }
  }
  if (r.until) s += dateOnly ? `;UNTIL=${dnum(r.until)}` : `;UNTIL=${dnum(r.until)}T225959Z`;
  return s;
}

function alarms(inst, lines) {
  for (const r of inst.reminders || []) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(inst.title)}`);
    if (r.t === 'abs') lines.push(`TRIGGER;VALUE=DATE-TIME:${dt(r.at.slice(0, 10), r.at.slice(11, 16))}`);
    else {
      const m = r.min || 0;
      lines.push(`TRIGGER:${m === 0 ? 'PT0M' : m % 1440 === 0 ? `-P${m / 1440}D` : `-PT${m}M`}`);
    }
    lines.push('END:VALARM');
  }
}

function vevent(inst, tz, stamp, extra) {
  const L = ['BEGIN:VEVENT', `UID:${inst.id}@agenda`, `DTSTAMP:${stamp}`];
  const task = inst.kind === 'task';
  L.push(`SUMMARY:${esc((task ? '☐ ' : '') + inst.title)}`);
  if (inst.notes) L.push(`DESCRIPTION:${esc(inst.notes)}`);
  let dateOnly = false;
  if (inst.kind === 'event' && !inst.allDay) {
    const r = timeRange(inst);
    const endDate = r.e > 1440 ? D.addDays(inst.date, 1) : inst.date;
    L.push(`DTSTART;TZID=${tz}:${dt(inst.date, inst.start)}`);
    L.push(`DTEND;TZID=${tz}:${dt(endDate, D.minToHM(r.e))}`);
  } else if ((task || inst.kind === 'reminder') && inst.time) {
    const end = D.hmToMin(inst.time) + 15;
    L.push(`DTSTART;TZID=${tz}:${dt(inst.date, inst.time)}`);
    L.push(`DTEND;TZID=${tz}:${dt(end >= 1440 ? D.addDays(inst.date, 1) : inst.date, D.minToHM(end))}`);
  } else {
    dateOnly = true;
    L.push(`DTSTART;VALUE=DATE:${dnum(inst.date)}`);
    L.push(`DTEND;VALUE=DATE:${dnum(D.addDays(inst.date, 1))}`);
  }
  if (extra) extra(L, dateOnly);
  alarms(inst, L);
  L.push('END:VEVENT');
  return L;
}

// items: elementos de la agenda. Las tareas completadas o canceladas no se exportan.
export function buildICS(items, { tz = DEFAULT_TZ, name = 'Agenda', nowMs = Date.now() } = {}) {
  const stamp = utcStamp(nowMs);
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda personal//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${tz}`];
  for (const it of items) {
    if (it.deleted || !it.date || !['event', 'task', 'reminder'].includes(it.kind)) continue;
    if (!isRecurring(it)) {
      if (it.kind === 'task' && (it.doneAt || it.cancelledAt)) continue;
      out.push(...vevent(instance(it, it.date), tz, stamp));
      continue;
    }
    // Serie: evento maestro + excepciones
    const master = { ...instance({ ...it, overrides: {} }, it.date) };
    const ovKeys = Object.keys(it.overrides || {}).filter((k) => isOccurrence(it, k));
    const skip = new Set(it.exdates || []);
    if (it.kind === 'task') for (const k in it.occ || {}) if (it.occ[k].doneAt || it.occ[k].cancelledAt) skip.add(k);
    const timeOf = master.kind === 'event' ? master.start : master.time;
    out.push(
      ...vevent(master, tz, stamp, (L, dateOnly) => {
        L.push(`RRULE:${rrule(it, dateOnly)}`);
        const ex = Array.from(skip).filter((k) => !ovKeys.includes(k) && isOccurrence(it, k)).sort();
        for (const k of ex) L.push(dateOnly ? `EXDATE;VALUE=DATE:${dnum(k)}` : `EXDATE;TZID=${tz}:${dt(k, timeOf)}`);
      })
    );
    for (const k of ovKeys) {
      // una ocurrencia editada que además está completada o eliminada se marca como cancelada
      const inst = instance(it, k);
      const lines = vevent(inst, tz, stamp, (L) => {
        const masterDateOnly = !(master.kind === 'event' ? !master.allDay : !!master.time);
        L.push(masterDateOnly ? `RECURRENCE-ID;VALUE=DATE:${dnum(k)}` : `RECURRENCE-ID;TZID=${tz}:${dt(k, timeOf)}`);
        if (skip.has(k)) L.push('STATUS:CANCELLED');
      });
      out.push(...lines);
    }
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}
