// js/shared/dates.js
var pad = (n) => String(n).padStart(2, "0");
var ymd = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
function parse(d) {
  return { y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) };
}
var DAY = 864e5;
function toNum(d) {
  const p = parse(d);
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY);
}
function fromNum(n) {
  const t = new Date(n * DAY);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
var addDays = (d, n) => fromNum(toNum(d) + n);
var diffDays = (a, b) => toNum(b) - toNum(a);
function dow(d) {
  const n = toNum(d);
  return ((n + 3) % 7 + 7) % 7 + 1;
}
var startOfWeek = (d) => addDays(d, 1 - dow(d));
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function todayLocal(now = /* @__PURE__ */ new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
var hmToMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
function minToHM(min) {
  const m = (min % 1440 + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
var isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
var isHM = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
var DIAS = ["lunes", "martes", "mi\xE9rcoles", "jueves", "viernes", "s\xE1bado", "domingo"];
var DIAS_CORTO = ["lun", "mar", "mi\xE9", "jue", "vie", "s\xE1b", "dom"];
var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
var MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
var dayName = (d) => DIAS[dow(d) - 1];
function fmtLong(d, withYear = false) {
  const p = parse(d);
  return `${dayName(d)}, ${p.d} de ${MESES[p.m - 1]}${withYear ? " de " + p.y : ""}`;
}
function fmtShort(d, ref) {
  const p = parse(d);
  const yr = ref && parse(ref).y !== p.y ? ` ${p.y}` : "";
  return `${DIAS_CORTO[dow(d) - 1]} ${p.d} ${MESES_CORTO[p.m - 1]}${yr}`;
}

// js/shared/model.js
var PRIORITIES = [
  { id: "urgent", label: "Urgente", rank: 0 },
  { id: "high", label: "Alta", rank: 1 },
  { id: "medium", label: "Media", rank: 2 },
  { id: "low", label: "Baja", rank: 3 }
];
var prioRank = (p) => (PRIORITIES.find((x) => x.id === p) || PRIORITIES[2]).rank;
var FAR_PAST = "0001-01-01";
var isRecurring = (item) => !!(item && item.repeat && item.repeat.freq);
function baseDates(item, from, to) {
  const start = item.date;
  if (!start) return [];
  if (!isRecurring(item)) return start >= from && start <= to ? [start] : [];
  const r = item.repeat;
  const interval = Math.max(1, parseInt(r.interval, 10) || 1);
  const end = r.until && r.until < to ? r.until : to;
  if (end < start || end < from) return [];
  const out = [];
  const nEnd = toNum(end);
  if (r.freq === "daily") {
    const n0 = toNum(start);
    const nf = Math.max(n0, toNum(from));
    const k = Math.ceil((nf - n0) / interval);
    for (let n = n0 + k * interval; n <= nEnd; n += interval) out.push(fromNum(n));
  } else if (r.freq === "weekly") {
    const days = r.days && r.days.length ? r.days : [dow(start)];
    const w0 = toNum(startOfWeek(start));
    for (let n = Math.max(toNum(start), toNum(from)); n <= nEnd; n++) {
      const pos = (n - w0) % 7;
      if (Math.floor((n - w0) / 7) % interval !== 0) {
        n += 6 - pos;
        continue;
      }
      if (days.includes(pos + 1)) out.push(fromNum(n));
    }
  } else if (r.freq === "monthly") {
    const s = parse(start);
    const f = parse(from < start ? start : from);
    let k = Math.max(0, (f.y - s.y) * 12 + (f.m - s.m));
    k = Math.max(0, Math.floor(k / interval) * interval);
    for (; ; k += interval) {
      const idx = s.m - 1 + k;
      const y = s.y + Math.floor(idx / 12);
      const m = idx % 12 + 1;
      const ds = ymd(y, m, Math.min(s.d, daysInMonth(y, m)));
      if (ds > end) break;
      if (ds >= from && ds >= start) out.push(ds);
    }
  }
  return out;
}
var isOccurrence = (item, date) => baseDates(item, date, date).length > 0;
function instance(item, key) {
  const rec = isRecurring(item);
  const ov = rec && item.overrides ? item.overrides[key] : null;
  const st = rec ? item.occ && item.occ[key] || {} : item;
  return {
    title: item.title || "",
    notes: item.notes || "",
    categoryId: item.categoryId || "",
    allDay: !!item.allDay,
    start: item.start || "",
    end: item.end || "",
    time: item.time || "",
    priority: item.priority || "medium",
    reminders: item.reminders || [],
    nag: item.nag || 0,
    // avisos insistentes: minutos entre avisos mientras siga pendiente
    subtasks: item.subtasks || [],
    // [{ id, title }]
    ...ov || {},
    item,
    id: item.id,
    kind: item.kind,
    key,
    uid: `${item.id}|${key}`,
    recurring: rec,
    edited: !!ov,
    date: ov && ov.date || key,
    origDate: rec ? key : item.origDate || item.date,
    doneAt: st.doneAt || null,
    cancelledAt: st.cancelledAt || null,
    subDone: st.subDone || []
    // ids de las subtareas hechas (por repetición en las series)
  };
}
function expand(item, from, to) {
  if (!item || item.deleted || !item.date) return [];
  if (!isRecurring(item)) return item.date >= from && item.date <= to ? [instance(item, item.date)] : [];
  const ex = new Set(item.exdates || []);
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const k of baseDates(item, from, to)) {
    if (ex.has(k)) continue;
    seen.add(k);
    const i = instance(item, k);
    if (i.date >= from && i.date <= to) out.push(i);
  }
  const ov = item.overrides || {};
  for (const k in ov) {
    if (seen.has(k) || ex.has(k)) continue;
    const d = ov[k] && ov[k].date;
    if (d && d >= from && d <= to && isOccurrence(item, k)) out.push(instance(item, k));
  }
  return out;
}
function expandAll(items, from, to, kinds) {
  const out = [];
  for (const it of items) {
    if (it.deleted || kinds && !kinds.includes(it.kind)) continue;
    for (const i of expand(it, from, to)) out.push(i);
  }
  return out;
}
function timeRange(inst) {
  const s = hmToMin(inst.start || "00:00");
  let e = hmToMin(inst.end || inst.start || "00:00");
  if (e <= s) e += 1440;
  return { s, e };
}
function daySegments(items, date) {
  const prev = addDays(date, -1);
  const allDay = [];
  const timed = [];
  const points = [];
  for (const it of items) {
    if (it.deleted) continue;
    if (it.kind === "event") {
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
    } else if (it.kind === "reminder") {
      for (const inst of expand(it, date, date)) points.push(inst);
    }
  }
  timed.sort((a, b) => a.s - b.s || b.e - a.e);
  points.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return { allDay, timed, points };
}
var isPending = (inst) => !inst.doneAt && !inst.cancelledAt;
function sortTasks(list) {
  return list.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99") || prioRank(a.priority) - prioRank(b.priority) || a.title.localeCompare(b.title)
  );
}
function pendingTasks(items, until) {
  const out = [];
  for (const it of items) {
    if (it.deleted || it.kind !== "task") continue;
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
    if (it.deleted || it.kind !== "task") continue;
    if (!isRecurring(it)) {
      if (it[field]) out.push(instance(it, it.date));
    } else {
      const occ = it.occ || {};
      for (const k in occ) if (occ[k] && occ[k][field]) out.push(instance(it, k));
    }
  }
  return out.sort((a, b) => String(b[field]).localeCompare(String(a[field])));
}
var completedTasks = (items) => stateList(items, "doneAt").filter((i) => !i.cancelledAt || i.doneAt);
function overview(items, today, toLocalDate = (iso) => todayLocal(new Date(iso))) {
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const pending = pendingTasks(items, weekEnd);
  const overdue = pending.filter((t) => t.date < today).sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || a.date.localeCompare(b.date));
  const tasksToday = pending.filter((t) => t.date === today);
  const tasksTomorrow = pending.filter((t) => t.date === tomorrow);
  const done = completedTasks(items).filter((t) => t.date === today || toLocalDate(t.doneAt) === today);
  const doneToday = done.filter((t) => toLocalDate(t.doneAt) === today || t.date === today);
  const upcomingReminders = expandAll(items, addDays(today, 2), weekEnd, ["reminder"]);
  const upcoming = pending.filter((t) => t.date > tomorrow && t.date <= weekEnd).concat(upcomingReminders).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99"));
  return {
    today: daySegments(items, today),
    tomorrow: daySegments(items, tomorrow),
    overdue,
    tasksToday,
    tasksTomorrow,
    doneToday,
    upcoming,
    progress: { done: doneToday.length, total: doneToday.length + tasksToday.length },
    badge: overdue.length + tasksToday.length
  };
}
function overviewText(ov, today, nowHM) {
  const lines = [`${cap(fmtLong(today))}`];
  const t = ov.today;
  if (t.allDay.length || t.timed.length || t.points.length) {
    lines.push("", "HOY");
    for (const i of t.allDay) lines.push(`Todo el d\xEDa \xB7 ${i.title}`);
    const rows = t.timed.map((s) => ({ k: s.s, txt: `${minToHM(s.s)}\u2013${minToHM(s.e)} \xB7 ${s.inst.title}` })).concat(t.points.map((i) => ({ k: hmToMin(i.time || "00:00"), txt: `${i.time} \xB7 ${i.title}` }))).sort((a, b) => a.k - b.k);
    for (const r of rows) lines.push(r.txt);
  } else lines.push("", "Sin actividades hoy");
  if (ov.overdue.length) {
    lines.push("", `TAREAS ATRASADAS (${ov.overdue.length})`);
    for (const i of ov.overdue.slice(0, 8)) lines.push(`\u2610 ${i.title} \u2014 desde el ${fmtShort(i.date, today)}`);
    if (ov.overdue.length > 8) lines.push(`\u2026 y ${ov.overdue.length - 8} m\xE1s`);
  }
  if (ov.tasksToday.length) {
    lines.push("", "TAREAS DE HOY");
    for (const i of ov.tasksToday) lines.push(`\u2610 ${i.title}${i.time ? " \u2014 " + i.time : ""}`);
  }
  if (!ov.overdue.length && !ov.tasksToday.length) lines.push("", "Sin tareas pendientes para hoy");
  return lines.join("\n");
}
function weekAhead(items, today) {
  const from = addDays(today, 1);
  const to = addDays(today, 7);
  const load = {};
  let events = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    const seg = daySegments(items, d);
    const own = seg.timed.filter((t) => !t.before);
    events += seg.allDay.length + own.length + seg.points.length;
    load[d] = seg.timed.reduce((a, t) => a + t.e - t.s, 0);
  }
  const pending = pendingTasks(items, to);
  const tasks = pending.filter((t) => t.date >= from);
  for (const t of tasks) load[t.date] += 60;
  const carried = pending.filter((t) => t.date < from).length;
  let busiest = "";
  for (const d in load) if (load[d] > 0 && (!busiest || load[d] > load[busiest])) busiest = d;
  return { from, to, events, tasks, carried, busiest };
}
function weekAheadText(w) {
  const a = parse(w.from);
  const b = parse(w.to);
  const title = `Tu semana: ${a.d}${a.m !== b.m ? " " + MESES_CORTO[a.m - 1] : ""}\u2013${b.d} ${MESES_CORTO[b.m - 1]}`;
  const head = [`${w.events} ${w.events === 1 ? "actividad" : "actividades"}`, `${w.tasks.length} ${w.tasks.length === 1 ? "tarea" : "tareas"}`];
  if (w.carried) head.push(`${w.carried} ${w.carried === 1 ? "pendiente" : "pendientes"} de antes`);
  const lines = [head.join(" \xB7 ")];
  const top = w.tasks.slice().sort((x, y) => prioRank(x.priority) - prioRank(y.priority) || x.date.localeCompare(y.date)).slice(0, 3);
  if (top.length) lines.push("Tareas: " + top.map((t) => `${DIAS_CORTO[dow(t.date) - 1]} ${t.title}`).join("; "));
  if (w.busiest) lines.push(`D\xEDa m\xE1s cargado: ${dayName(w.busiest)}`);
  return { title, body: lines.join("\n") };
}

// js/shared/tz.js
var DEFAULT_TZ = "Europe/Madrid";
var cache = {};
function parts(ms, tz) {
  const f = cache[tz] || (cache[tz] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }));
  const o = {};
  for (const p of f.formatToParts(ms)) o[p.type] = p.value;
  if (o.hour === "24") o.hour = "00";
  return o;
}
function utcToZoned(ms, tz = DEFAULT_TZ) {
  const p = parts(ms, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
function offsetAt(ms, tz) {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1e3) * 1e3;
}
function zonedToUtc(date, hm, tz = DEFAULT_TZ) {
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5));
  const off1 = offsetAt(wall, tz);
  let t = wall - off1;
  const off2 = offsetAt(t, tz);
  if (off2 !== off1) t = wall - off2;
  return t;
}
function wallMinus(date, hm, minutes) {
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5)) - minutes * 6e4;
  const t = new Date(wall);
  const p2 = (n) => String(n).padStart(2, "0");
  return {
    date: `${String(t.getUTCFullYear()).padStart(4, "0")}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`,
    hm: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`
  };
}

// js/shared/reminders.js
var DEFAULT_TIME = "09:00";
function baseHM(inst) {
  if (inst.kind === "event") return inst.allDay ? DEFAULT_TIME : inst.start || DEFAULT_TIME;
  return inst.time || DEFAULT_TIME;
}
var hasTime = (inst) => inst.kind === "event" ? !inst.allDay : !!inst.time;
function whenText(inst, fireDate, minutesLeft) {
  const days = diffDays(fireDate, inst.date);
  const hm = hasTime(inst) ? baseHM(inst) : "";
  const range = inst.kind === "event" && !inst.allDay && inst.end ? `${inst.start}\u2013${inst.end}` : hm;
  const task = inst.kind === "task";
  if (days < 0) return task ? `Venci\xF3 el ${fmtShort(inst.date)}` : `Fue el ${fmtShort(inst.date)}`;
  if (days === 0) {
    if (!hm) return task ? "Vence hoy" : "Hoy";
    if (minutesLeft <= 0) return task ? `Vence ahora (${hm})` : `Ahora \xB7 ${range}`;
    if (minutesLeft < 60) return task ? `Vence en ${minutesLeft} min (${hm})` : `En ${minutesLeft} min \xB7 ${range}`;
    return task ? `Vence hoy a las ${hm}` : `Hoy \xB7 ${range}`;
  }
  const day = `${dayName(inst.date)} ${parse(inst.date).d}`;
  const at = hm ? task ? ` a las ${hm}` : ` \xB7 ${range}` : "";
  if (days === 1) return task ? `Vence ma\xF1ana${at}` : `Ma\xF1ana, ${day}${at}`;
  const dist = days === 7 ? "En 1 semana" : `En ${days} d\xEDas`;
  return task ? `Vence en ${days === 7 ? "1 semana" : days + " d\xEDas"}: ${day} de ${MESES[parse(inst.date).m - 1]}${at}` : `${dist}: ${day} de ${MESES[parse(inst.date).m - 1]}${at}`;
}
function computeFires(item, fromMs, toMs, tz = DEFAULT_TZ) {
  if (!item || item.deleted || !item.date) return [];
  const all = [item.reminders || []].concat(Object.values(item.overrides || {}).map((o) => o && o.reminders || []));
  let maxMin = 0;
  let any = item.kind === "task" && (item.nag > 0 || Object.values(item.overrides || {}).some((o) => o && o.nag > 0));
  for (const list of all)
    for (const r of list) {
      any = true;
      if (r.t === "rel") maxMin = Math.max(maxMin, r.min || 0);
    }
  if (!any) return [];
  const fromDate = addDays(utcToZoned(fromMs, tz).date, -1);
  const toDate = addDays(utcToZoned(toMs, tz).date, Math.ceil(maxMin / 1440) + 1);
  const out = /* @__PURE__ */ new Map();
  const rec = isRecurring(item);
  const add = (inst, fireAt, absKey, body) => {
    if (!(fireAt >= fromMs && fireAt < toMs)) return;
    const minute = Math.floor(fireAt / 6e4);
    const id = `${item.id}|${absKey || inst.key}|${minute}`;
    if (out.has(id)) return;
    const base = zonedToUtc(inst.date, baseHM(inst), tz);
    const fireLocal = utcToZoned(fireAt, tz);
    out.set(id, {
      id,
      fireAt: minute * 6e4,
      title: inst.title || (inst.kind === "task" ? "Tarea" : "Recordatorio"),
      body: body ? body(fireLocal.date) : whenText(inst, fireLocal.date, Math.round((base - fireAt) / 6e4)),
      date: inst.date
    });
  };
  const insts = rec ? expand(item, fromDate, toDate) : [expand(item, item.date, item.date)[0]].filter(Boolean);
  for (const inst of insts) {
    if (inst.kind === "task" && !isPending(inst)) continue;
    for (const r of inst.reminders || []) {
      if (r.t === "rel") {
        const w = wallMinus(inst.date, baseHM(inst), r.min || 0);
        add(inst, zonedToUtc(w.date, w.hm, tz));
      } else if (r.t === "abs" && (!rec || item.overrides && item.overrides[inst.key] && item.overrides[inst.key].reminders)) {
        add(inst, zonedToUtc(r.at.slice(0, 10), r.at.slice(11, 16), tz), rec ? null : "abs");
      }
    }
  }
  if (rec) {
    for (const r of item.reminders || []) {
      if (r.t !== "abs") continue;
      const fireAt = zonedToUtc(r.at.slice(0, 10), r.at.slice(11, 16), tz);
      if (!(fireAt >= fromMs && fireAt < toMs)) continue;
      const d0 = r.at.slice(0, 10);
      const next = expand(item, d0, addDays(d0, 400)).filter((i) => item.kind !== "task" || isPending(i)).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (next) add(next, fireAt, "abs");
    }
  }
  if (item.kind === "task") {
    const list = rec ? expand(item, addDays(fromDate, -NAG_DAYS), toDate) : insts;
    for (const inst of list) {
      if (!(inst.nag > 0) || !isPending(inst)) continue;
      const text = (fireDate) => fireDate === inst.date ? inst.time ? `Sigue pendiente \xB7 venc\xEDa a las ${inst.time}` : "Sigue pendiente \xB7 era para hoy" : `Sigue pendiente desde el ${fmtShort(inst.date)}`;
      for (const t of nagTimes(inst, inst.nag, fromMs, toMs, tz)) add(inst, t, "nag", text);
    }
  }
  return Array.from(out.values()).sort((a, b) => a.fireAt - b.fireAt);
}
var NAG_DAYS = 14;
function nagTimes(inst, step, fromMs, toMs, tz) {
  const res = [];
  if (step >= 1440) {
    for (let d = addDays(utcToZoned(fromMs, tz).date, -1); ; d = addDays(d, 1)) {
      const t = zonedToUtc(d, DEFAULT_TIME, tz);
      if (t >= toMs) break;
      const n = diffDays(inst.date, d);
      if (n >= 1 && n <= NAG_DAYS && t >= fromMs) res.push(t);
    }
    return res;
  }
  const base = zonedToUtc(inst.date, baseHM(inst), tz);
  const stepMs = step * 6e4;
  const last = base + NAG_DAYS * 864e5;
  const k = Math.max(1, Math.ceil((fromMs - base) / stepMs));
  for (let t = base + k * stepMs; t < toMs && t <= last; t += stepMs) {
    const hm = utcToZoned(t, tz).hm;
    if (hm >= "08:00" && hm <= "22:00") res.push(t);
  }
  return res;
}
function activeUntil(item) {
  if (!item || item.deleted || !item.date) return "0000-00-00";
  if (isRecurring(item)) return item.repeat.until && item.kind !== "task" ? addDays(item.repeat.until, 15) : "9999-12-31";
  if (item.kind === "task") {
    if (item.doneAt || item.cancelledAt) return String(item.doneAt || item.cancelledAt).slice(0, 10);
    return "9999-12-31";
  }
  let last = item.date;
  for (const r of item.reminders || []) if (r.t === "abs" && r.at.slice(0, 10) > last) last = r.at.slice(0, 10);
  return addDays(last, 2);
}

// js/shared/ics.js
var esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
var dnum = (d) => d.replace(/-/g, "");
var dt = (d, hm) => `${dnum(d)}T${hm.replace(":", "")}00`;
var BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = " " + rest.slice(73);
  }
  out.push(rest);
  return out.join("\r\n");
}
function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
function rrule(item, dateOnly) {
  const r = item.repeat;
  const n = Math.max(1, parseInt(r.interval, 10) || 1);
  let s = "";
  if (r.freq === "daily") s = `FREQ=DAILY;INTERVAL=${n}`;
  else if (r.freq === "weekly") {
    const days = (r.days && r.days.length ? r.days : [dow(item.date)]).slice().sort();
    s = `FREQ=WEEKLY;INTERVAL=${n};WKST=MO;BYDAY=${days.map((d) => BYDAY[d - 1]).join(",")}`;
  } else {
    const d = parse(item.date).d;
    s = `FREQ=MONTHLY;INTERVAL=${n};`;
    if (d <= 28) s += `BYMONTHDAY=${d}`;
    else {
      const list = [];
      for (let x = 28; x <= d; x++) list.push(x);
      s += `BYMONTHDAY=${list.join(",")};BYSETPOS=-1`;
    }
  }
  if (r.until) s += dateOnly ? `;UNTIL=${dnum(r.until)}` : `;UNTIL=${dnum(r.until)}T225959Z`;
  return s;
}
function alarms(inst, lines) {
  for (const r of inst.reminders || []) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(inst.title)}`);
    if (r.t === "abs") lines.push(`TRIGGER;VALUE=DATE-TIME:${dt(r.at.slice(0, 10), r.at.slice(11, 16))}`);
    else {
      const m = r.min || 0;
      lines.push(`TRIGGER:${m === 0 ? "PT0M" : m % 1440 === 0 ? `-P${m / 1440}D` : `-PT${m}M`}`);
    }
    lines.push("END:VALARM");
  }
}
function vevent(inst, tz, stamp, extra) {
  const L = ["BEGIN:VEVENT", `UID:${inst.id}@agenda`, `DTSTAMP:${stamp}`];
  const task = inst.kind === "task";
  L.push(`SUMMARY:${esc((task ? "\u2610 " : "") + inst.title)}`);
  if (inst.notes) L.push(`DESCRIPTION:${esc(inst.notes)}`);
  let dateOnly = false;
  if (inst.kind === "event" && !inst.allDay) {
    const r = timeRange(inst);
    const endDate = r.e > 1440 ? addDays(inst.date, 1) : inst.date;
    L.push(`DTSTART;TZID=${tz}:${dt(inst.date, inst.start)}`);
    L.push(`DTEND;TZID=${tz}:${dt(endDate, minToHM(r.e))}`);
  } else if ((task || inst.kind === "reminder") && inst.time) {
    const end = hmToMin(inst.time) + 15;
    L.push(`DTSTART;TZID=${tz}:${dt(inst.date, inst.time)}`);
    L.push(`DTEND;TZID=${tz}:${dt(end >= 1440 ? addDays(inst.date, 1) : inst.date, minToHM(end))}`);
  } else {
    dateOnly = true;
    L.push(`DTSTART;VALUE=DATE:${dnum(inst.date)}`);
    L.push(`DTEND;VALUE=DATE:${dnum(addDays(inst.date, 1))}`);
  }
  if (extra) extra(L, dateOnly);
  alarms(inst, L);
  L.push("END:VEVENT");
  return L;
}
function buildICS(items, { tz = DEFAULT_TZ, name = "Agenda", nowMs = Date.now() } = {}) {
  const stamp = utcStamp(nowMs);
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agenda personal//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${tz}`];
  for (const it of items) {
    if (it.deleted || !it.date || !["event", "task", "reminder"].includes(it.kind)) continue;
    if (!isRecurring(it)) {
      if (it.kind === "task" && (it.doneAt || it.cancelledAt)) continue;
      out.push(...vevent(instance(it, it.date), tz, stamp));
      continue;
    }
    const master = { ...instance({ ...it, overrides: {} }, it.date) };
    const ovKeys = Object.keys(it.overrides || {}).filter((k) => isOccurrence(it, k));
    const skip = new Set(it.exdates || []);
    if (it.kind === "task") {
      for (const k in it.occ || {}) if (it.occ[k].doneAt || it.occ[k].cancelledAt) skip.add(k);
    }
    const timeOf = master.kind === "event" ? master.start : master.time;
    out.push(
      ...vevent(master, tz, stamp, (L, dateOnly) => {
        L.push(`RRULE:${rrule(it, dateOnly)}`);
        const ex = Array.from(skip).filter((k) => !ovKeys.includes(k) && isOccurrence(it, k)).sort();
        for (const k of ex) L.push(dateOnly ? `EXDATE;VALUE=DATE:${dnum(k)}` : `EXDATE;TZID=${tz}:${dt(k, timeOf)}`);
      })
    );
    for (const k of ovKeys) {
      const inst = instance(it, k);
      const lines = vevent(inst, tz, stamp, (L) => {
        const masterDateOnly = !(master.kind === "event" ? !master.allDay : !!master.time);
        L.push(masterDateOnly ? `RECURRENCE-ID;VALUE=DATE:${dnum(k)}` : `RECURRENCE-ID;TZID=${tz}:${dt(k, timeOf)}`);
        if (skip.has(k)) L.push("STATUS:CANCELLED");
      });
      out.push(...lines);
    }
  }
  out.push("END:VCALENDAR");
  return out.map(fold).join("\r\n") + "\r\n";
}

// worker/src/webpush.js
var te = new TextEncoder();
var b64u = {
  enc(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/"));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
};
function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}
async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u.enc(pub), privateJwk: jwk };
}
var jwtCache = /* @__PURE__ */ new Map();
async function vapidAuthorization(endpoint, vapid, subject, nowMs = Date.now()) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  if (hit && hit.pub === vapid.publicKey && hit.exp - 3600 > nowMs / 1e3) return hit.header;
  const exp = Math.floor(nowMs / 1e3) + 12 * 3600;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud, exp, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)));
  const header = `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${vapid.publicKey}`;
  jwtCache.set(aud, { header, exp, pub: vapid.publicKey });
  return header;
}
async function encryptPayload(sub, plaintext) {
  const uaPublic = b64u.dec(sub.p256dh);
  const authSecret = b64u.dec(sub.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = concat(plaintext, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}
async function sendPush(sub, payload, vapid, { ttl = 21600, urgency = "high", subject, nowMs } = {}) {
  try {
    const body = await encryptPayload(sub, te.encode(typeof payload === "string" ? payload : JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, vapid, subject, nowMs),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: urgency
      },
      body
    });
    let detail = "";
    if (!res.ok) detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, detail };
  } catch (e) {
    return { ok: false, status: 0, gone: false, detail: String(e && e.message || e).slice(0, 200) };
  }
}

// worker/src/index.js
var HOUR = 36e5;
var HORIZON = 72 * HOUR;
var REFRESH = 36 * HOUR;
var GRACE = 2 * 6e4;
var EXPIRE = 12 * HOUR;
var AGENDA_KINDS = ["event", "task", "reminder"];
var PUSH_HOSTS = /(^|\.)(push\.apple\.com|googleapis\.com|mozilla\.com|notify\.windows\.com)$/;
var SCHEMA = [
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL, active_until TEXT NOT NULL DEFAULT '9999-12-31', has_rem INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS items_rev ON items(rev)`,
  `CREATE INDEX IF NOT EXISTS items_active ON items(deleted, active_until)`,
  `CREATE TABLE IF NOT EXISTS notif (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, fire_at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, date TEXT, status INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS notif_due ON notif(status, fire_at)`,
  `CREATE INDEX IF NOT EXISTS notif_item ON notif(item_id, status)`,
  `CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, app_url TEXT, device TEXT, created_at INTEGER, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`
];
var schemaReady = null;
function ensureSchema(db) {
  if (schemaReady !== db) {
    schemaReady = db;
    return db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
}
var nowOf = (env) => env.NOW ? env.NOW() : Date.now();
var tzOf = (env) => env.TZ_NAME || DEFAULT_TZ;
async function getMeta(db, keys) {
  const q = await db.prepare(`SELECT key, value FROM meta WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all();
  const o = {};
  for (const r of q.results) o[r.key] = r.value;
  return o;
}
var setMeta = (db, key, value) => db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));
async function batchAll(db, stmts, size = 40) {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}
function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400"
  };
}
function reply(env, body, status = 200, type = "application/json; charset=utf-8") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": type, "Cache-Control": "no-store", ...cors(env) }
  });
}
async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function checkAuth(req, env) {
  if (!env.AUTH_TOKEN || String(env.AUTH_TOKEN).length < 12) return "config";
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return "denied";
  return await sameSecret(token, String(env.AUTH_TOKEN)) ? "ok" : "denied";
}
var vapidCache = null;
async function getVapid(db) {
  if (vapidCache) return vapidCache;
  const m = await getMeta(db, ["vapid"]);
  if (m.vapid) return vapidCache = JSON.parse(m.vapid);
  const fresh = await generateVapidKeys();
  await db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").bind("vapid", JSON.stringify(fresh)).run();
  const again = await getMeta(db, ["vapid"]);
  return vapidCache = JSON.parse(again.vapid);
}
var delPending = (db, id) => db.prepare("DELETE FROM notif WHERE item_id = ? AND status = 0").bind(id);
function fireStatements(db, item, from, to, tz) {
  const out = [];
  for (const f of computeFires(item, from, to, tz)) {
    out.push(
      db.prepare("INSERT OR IGNORE INTO notif (id, item_id, fire_at, title, body, date) VALUES (?, ?, ?, ?, ?, ?)").bind(f.id, item.id, f.fireAt, f.title, f.body, f.date)
    );
  }
  return out;
}
async function currentHorizon(db, now) {
  const m = await getMeta(db, ["horizon"]);
  let h = +m.horizon || 0;
  if (h < now + HOUR) {
    h = now + HORIZON;
    await setMeta(db, "horizon", h).run();
  }
  return h;
}
async function regenAll(db, now, tz) {
  const horizon = now + HORIZON;
  const today = utcToZoned(now, tz).date;
  const q = await db.prepare("SELECT data FROM items WHERE deleted = 0 AND has_rem = 1 AND active_until >= ?").bind(addDays(today, -1)).all();
  const stmts = [];
  for (const r of q.results) {
    const item = JSON.parse(r.data);
    stmts.push(delPending(db, item.id), ...fireStatements(db, item, now - GRACE, horizon, tz));
  }
  stmts.push(setMeta(db, "horizon", horizon));
  await batchAll(db, stmts);
}
async function loadActive(db, fromDate) {
  const q = await db.prepare(`SELECT data FROM items WHERE deleted = 0 AND active_until >= ? AND kind IN ('event','task','reminder')`).bind(fromDate).all();
  return q.results.map((r) => JSON.parse(r.data));
}
function payloadFor(sub, n) {
  const base = sub.app_url || "";
  const navigate = base ? base + (n.date ? `#d=${n.date}` : "") : void 0;
  return { web_push: 8030, notification: { title: n.title, body: n.body, navigate, lang: "es", dir: "ltr", silent: false } };
}
async function pushToAll(env, db, n, now) {
  const subs = (await db.prepare("SELECT * FROM subs").all()).results;
  if (!subs.length) return { sent: 0, results: [], subs: 0 };
  const vapid = await getVapid(db);
  const m = await getMeta(db, ["origin"]);
  const subject = env.VAPID_SUBJECT || m.origin || "https://workers.cloudflare.com";
  const results = [];
  const after = [];
  let sent = 0;
  for (const s of subs) {
    const r = await sendPush(s, payloadFor(s, n), vapid, { subject, nowMs: now });
    results.push({ host: new URL(s.endpoint).host, device: s.device || "", status: r.status, ok: r.ok, detail: r.detail });
    if (r.ok) {
      sent++;
      after.push(db.prepare("UPDATE subs SET last_ok = ?, fails = 0 WHERE endpoint = ?").bind(now, s.endpoint));
    } else if (r.gone) after.push(db.prepare("DELETE FROM subs WHERE endpoint = ?").bind(s.endpoint));
    else after.push(db.prepare("UPDATE subs SET fails = fails + 1 WHERE endpoint = ?").bind(s.endpoint));
  }
  if (after.length) await db.batch(after);
  return { sent, results, subs: subs.length, transient: results.some((r) => !r.ok && (r.status === 0 || r.status === 429 || r.status >= 500)) };
}
async function tick(env, db) {
  const now = nowOf(env);
  const tz = tzOf(env);
  const due = (await db.prepare("SELECT * FROM notif WHERE status = 0 AND fire_at <= ? ORDER BY fire_at LIMIT 10").bind(now).all()).results;
  for (const n of due) {
    if (n.fire_at < now - EXPIRE) {
      await db.prepare("UPDATE notif SET status = 3 WHERE id = ?").bind(n.id).run();
      continue;
    }
    const claim = await db.prepare("UPDATE notif SET status = 1, sent_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 0").bind(now, n.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const r = await pushToAll(env, db, n, now);
    if (r.sent === 0 && r.subs > 0 && r.transient && n.attempts < 3) {
      await db.prepare("UPDATE notif SET status = 0 WHERE id = ?").bind(n.id).run();
    } else if (r.sent === 0) {
      await db.prepare("UPDATE notif SET status = 2 WHERE id = ?").bind(n.id).run();
    }
  }
  const m = await getMeta(db, ["horizon", "digest", "digest_day", "clean_day", "weekly", "weekly_day"]);
  const local = utcToZoned(now, tz);
  const writes = [setMeta(db, "last_tick", now)];
  if ((+m.horizon || 0) - now < REFRESH) await regenAll(db, now, tz);
  if (m.digest && m.digest_day !== local.date) {
    const late = hmToMin(local.hm) - hmToMin(m.digest);
    if (late >= 0 && late < 180) {
      writes.push(setMeta(db, "digest_day", local.date));
      const ov = overview(await loadActive(db, addDays(local.date, -1)), local.date, (iso) => utcToZoned(Date.parse(iso), tz).date);
      const nEv = ov.today.timed.length + ov.today.allDay.length + ov.today.points.length;
      const parts2 = [];
      if (nEv) parts2.push(`${nEv} ${nEv === 1 ? "actividad" : "actividades"}`);
      if (ov.tasksToday.length) parts2.push(`${ov.tasksToday.length} ${ov.tasksToday.length === 1 ? "tarea" : "tareas"} para hoy`);
      if (ov.overdue.length) parts2.push(`${ov.overdue.length} ${ov.overdue.length === 1 ? "atrasada" : "atrasadas"}`);
      if (parts2.length) {
        const first = ov.today.timed[0];
        const body = parts2.join(" \xB7 ") + (first ? `
Primero: ${minToHM(first.s)} ${first.inst.title}` : "");
        await pushToAll(env, db, { title: `Tu d\xEDa \xB7 ${dayName(local.date)} ${parse(local.date).d}`, body, date: local.date }, now);
      }
    }
  }
  if (m.weekly && m.weekly_day !== local.date) {
    const [wday, wtime] = m.weekly.split("|");
    const late = hmToMin(local.hm) - hmToMin(wtime);
    if (dow(local.date) === +wday && late >= 0 && late < 180) {
      writes.push(setMeta(db, "weekly_day", local.date));
      const w = weekAhead(await loadActive(db, addDays(local.date, -1)), local.date);
      if (w.events || w.tasks.length || w.carried) {
        const txt = weekAheadText(w);
        await pushToAll(env, db, { title: txt.title, body: txt.body, date: w.from }, now);
      }
    }
  }
  if (m.clean_day !== local.date) {
    writes.push(setMeta(db, "clean_day", local.date), db.prepare("DELETE FROM notif WHERE status != 0 AND fire_at < ?").bind(now - 14 * 24 * HOUR));
  }
  await db.batch(writes);
}
function validChange(c) {
  return c && typeof c.id === "string" && c.id.length > 0 && c.id.length <= 80 && typeof c.kind === "string" && c.kind.length <= 20 && Number.isFinite(c.updatedAt);
}
async function applyChanges(env, db, changes) {
  const now = nowOf(env);
  const tz = tzOf(env);
  const existing = /* @__PURE__ */ new Map();
  for (let i = 0; i < changes.length; i += 50) {
    const ids = changes.slice(i, i + 50).map((c) => c.id);
    const q = await db.prepare(`SELECT id, updated_at FROM items WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    for (const r of q.results) existing.set(r.id, r.updated_at);
  }
  let rev = (await db.prepare("SELECT COALESCE(MAX(rev), 0) AS r FROM items").first()).r;
  const stmts = [];
  const applied = [];
  for (const c of changes) {
    const prev = existing.get(c.id);
    if (prev !== void 0 && prev >= c.updatedAt) continue;
    rev++;
    const agenda = AGENDA_KINDS.includes(c.kind);
    const hasRem = agenda && !c.deleted && (c.reminders && c.reminders.length || c.nag > 0 || Object.values(c.overrides || {}).some((o) => o && (o.reminders && o.reminders.length || o.nag > 0))) ? 1 : 0;
    stmts.push(
      db.prepare(
        `INSERT INTO items (id, kind, data, updated_at, deleted, rev, active_until, has_rem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev, active_until = excluded.active_until, has_rem = excluded.has_rem`
      ).bind(c.id, c.kind, JSON.stringify(c), c.updatedAt, c.deleted ? 1 : 0, rev, agenda ? activeUntil(c) : "9999-12-31", hasRem)
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
  const settings = applied.find((c) => c.kind === "settings");
  if (settings) {
    stmts.push(setMeta(db, "digest", settings.digestOn && isHM(settings.digestTime) ? settings.digestTime : ""));
    const wday = Math.min(7, Math.max(1, parseInt(settings.weeklyDay, 10) || 7));
    stmts.push(setMeta(db, "weekly", settings.weeklyOn && isHM(settings.weeklyTime) ? `${wday}|${settings.weeklyTime}` : ""));
  }
  await batchAll(db, stmts);
  return applied.length;
}
async function handleSync(req, env, db) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return reply(env, { error: "Petici\xF3n no v\xE1lida" }, 400);
  const since = Number.isFinite(body.since) ? body.since : 0;
  const changes = (Array.isArray(body.changes) ? body.changes : []).filter(validChange).slice(0, 500);
  const applied = changes.length ? await applyChanges(env, db, changes) : 0;
  const LIMIT = 1500;
  const q = await db.prepare("SELECT data, rev FROM items WHERE rev > ? ORDER BY rev LIMIT ?").bind(since, LIMIT + 1).all();
  const rows = q.results.slice(0, LIMIT);
  const rev = rows.length ? rows[rows.length - 1].rev : since;
  const more = q.results.length > LIMIT;
  return reply(env, `{"rev":${rev},"more":${more},"applied":${applied},"items":[${rows.map((r) => r.data).join(",")}]}`);
}
async function route(req, env, db) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const now = nowOf(env);
  const tz = tzOf(env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (path === "/") return reply(env, "Servidor de la agenda en marcha.", 200, "text/plain; charset=utf-8");
  const cal = path.match(/^\/cal\/([A-Za-z0-9_-]{20,})\.ics$/);
  if (cal && req.method === "GET") {
    const m = await getMeta(db, ["feed_key"]);
    if (!m.feed_key || !await sameSecret(cal[1], m.feed_key)) return reply(env, "No encontrado", 404, "text/plain; charset=utf-8");
    const today = utcToZoned(now, tz).date;
    const ics = buildICS(await loadActive(db, addDays(today, -60)), { tz, nowMs: now });
    return reply(env, ics, 200, "text/calendar; charset=utf-8");
  }
  if (!path.startsWith("/api/")) return reply(env, { error: "No encontrado" }, 404);
  const auth = await checkAuth(req, env);
  if (auth === "config") return reply(env, { error: "Falta configurar el secreto AUTH_TOKEN (m\xEDnimo 12 caracteres) en el Worker." }, 500);
  if (auth !== "ok") return reply(env, { error: "Clave incorrecta" }, 401);
  if (path === "/api/info" && req.method === "GET") {
    const vapid = await getVapid(db);
    let m = await getMeta(db, ["last_tick", "feed_key", "origin", "digest"]);
    const setup = [];
    if (!m.feed_key) {
      m.feed_key = b64u.enc(crypto.getRandomValues(new Uint8Array(24)));
      setup.push(db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").bind("feed_key", m.feed_key));
    }
    if (m.origin !== url.origin) setup.push(setMeta(db, "origin", url.origin));
    if (setup.length) {
      await db.batch(setup);
      m = await getMeta(db, ["last_tick", "feed_key", "origin", "digest"]);
    }
    const counts = await db.prepare("SELECT (SELECT COUNT(*) FROM subs) AS subs, (SELECT COUNT(*) FROM items WHERE deleted = 0) AS items").first();
    const next = (await db.prepare("SELECT title, body, fire_at AS fireAt FROM notif WHERE status = 0 AND fire_at > ? ORDER BY fire_at LIMIT 8").bind(now - GRACE).all()).results;
    return reply(env, {
      ok: true,
      vapidPublicKey: vapid.publicKey,
      subs: counts.subs,
      items: counts.items,
      now,
      lastTick: +m.last_tick || 0,
      tz,
      digest: m.digest || "",
      feedUrl: `${url.origin}/cal/${m.feed_key}.ics`,
      next
    });
  }
  if (path === "/api/sync" && req.method === "POST") return handleSync(req, env, db);
  if (path === "/api/subscribe" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const s = b && b.subscription;
    let host = "";
    try {
      const u = new URL(s.endpoint);
      if (u.protocol === "https:") host = u.hostname;
    } catch (e) {
    }
    if (!s || !host || !PUSH_HOSTS.test(host) || !s.keys || typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string") {
      return reply(env, { error: "Suscripci\xF3n no v\xE1lida" }, 400);
    }
    const appUrl = typeof b.appUrl === "string" && /^https:\/\/[^\s#?]+$/.test(b.appUrl) ? b.appUrl : "";
    await db.prepare(
      `INSERT INTO subs (endpoint, p256dh, auth, app_url, device, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, app_url = excluded.app_url, device = excluded.device, fails = 0`
    ).bind(s.endpoint, s.keys.p256dh, s.keys.auth, appUrl, String(b.device || "").slice(0, 60), now).run();
    return reply(env, { ok: true });
  }
  if (path === "/api/unsubscribe" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (b && typeof b.endpoint === "string") await db.prepare("DELETE FROM subs WHERE endpoint = ?").bind(b.endpoint).run();
    return reply(env, { ok: true });
  }
  if (path === "/api/test" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const delay = Math.max(0, Math.min(3600, parseInt(b && b.delay, 10) || 0));
    if (delay > 0) {
      const at = Math.ceil((now + delay * 1e3) / 6e4) * 6e4;
      const hm = utcToZoned(at, tz).hm;
      await db.prepare("INSERT OR REPLACE INTO notif (id, item_id, fire_at, title, body, date, status, attempts) VALUES (?, ?, ?, ?, ?, ?, 0, 0)").bind(`test|${at}`, "test", at, "Aviso programado de prueba", `Programado para las ${hm}. Si lo ves con la app cerrada, todo funciona.`, null).run();
      return reply(env, { ok: true, scheduledFor: at });
    }
    const r = await pushToAll(env, db, { title: "Notificaci\xF3n de prueba", body: "Las notificaciones de tu agenda funcionan.", date: null }, now);
    return reply(env, { ok: r.sent > 0, sent: r.sent, subs: r.subs, results: r.results });
  }
  if (path === "/api/hoy" && req.method === "GET") {
    const local = utcToZoned(now, tz);
    const ov = overview(await loadActive(db, addDays(local.date, -1)), local.date, (iso) => utcToZoned(Date.parse(iso), tz).date);
    return reply(env, overviewText(ov, local.date, local.hm), 200, "text/plain; charset=utf-8");
  }
  if (path === "/api/tarea" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const title = String(b && (b.titulo || b.title) || "").trim().slice(0, 200);
    if (!title) return reply(env, { error: "Falta el t\xEDtulo" }, 400);
    const local = utcToZoned(now, tz);
    const prio = { urgente: "urgent", alta: "high", media: "medium", baja: "low" }[String(b.prioridad || "").toLowerCase()] || "medium";
    const iso = new Date(now).toISOString();
    const item = {
      id: crypto.randomUUID(),
      kind: "task",
      title,
      notes: "",
      categoryId: "",
      date: isDate(b.fecha) ? b.fecha : local.date,
      time: isHM(b.hora) ? b.hora : "",
      priority: prio,
      repeat: null,
      reminders: [],
      createdAt: iso,
      updatedAt: now,
      history: [{ at: iso, a: "created" }]
    };
    await applyChanges(env, db, [item]);
    return reply(env, { ok: true, id: item.id, mensaje: `Tarea a\xF1adida: ${title}` });
  }
  return reply(env, { error: "No encontrado" }, 404);
}
var index_default = {
  async fetch(req, env) {
    try {
      if (!env.DB) return reply(env, { error: "Falta enlazar la base de datos D1 con el nombre DB." }, 500);
      await ensureSchema(env.DB);
      return await route(req, env, env.DB);
    } catch (e) {
      return reply(env, { error: "Error interno", detail: String(e && e.message || e).slice(0, 300) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await ensureSchema(env.DB);
    await tick(env, env.DB);
  }
};
export {
  index_default as default
};
