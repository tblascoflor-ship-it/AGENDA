// Utilidades de fecha. Las fechas son cadenas 'YYYY-MM-DD' y las horas 'HH:MM'
// en hora local "de pared": así no dependen de husos ni de cambios de hora.

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

export function parse(d) {
  return { y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) };
}

const DAY = 86400000;
export function toNum(d) {
  const p = parse(d);
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY);
}
export function fromNum(n) {
  const t = new Date(n * DAY);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export const addDays = (d, n) => fromNum(toNum(d) + n);
export const diffDays = (a, b) => toNum(b) - toNum(a);

// Día de la semana: 1 = lunes … 7 = domingo
export function dow(d) {
  const n = toNum(d); // 1970-01-01 fue jueves
  return ((((n + 3) % 7) + 7) % 7) + 1;
}
export const startOfWeek = (d) => addDays(d, 1 - dow(d));
export const startOfMonth = (d) => d.slice(0, 8) + '01';
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addMonths(d, n) {
  const p = parse(d);
  const idx = p.m - 1 + n;
  const y = p.y + Math.floor(idx / 12);
  const m = (((idx % 12) + 12) % 12) + 1;
  return ymd(y, m, Math.min(p.d, daysInMonth(y, m)));
}
// Número de semana ISO
export function isoWeek(d) {
  const thursday = toNum(startOfWeek(d)) + 3;
  const y = parse(fromNum(thursday)).y;
  const jan4 = toNum(ymd(y, 1, 4));
  const week1 = toNum(startOfWeek(fromNum(jan4)));
  return Math.floor((thursday - week1) / 7) + 1;
}

export function todayLocal(now = new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
export function nowHM(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
export const hmToMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
export function minToHM(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isHM = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

// ---------- Textos en español ----------
export const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const DIAS_CORTO = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const DIAS_LETRA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const dayName = (d) => DIAS[dow(d) - 1];

// "viernes, 13 de noviembre"
export function fmtLong(d, withYear = false) {
  const p = parse(d);
  return `${dayName(d)}, ${p.d} de ${MESES[p.m - 1]}${withYear ? ' de ' + p.y : ''}`;
}
// "vie 13 nov" (añade el año si no es el de referencia)
export function fmtShort(d, ref) {
  const p = parse(d);
  const yr = ref && parse(ref).y !== p.y ? ` ${p.y}` : '';
  return `${DIAS_CORTO[dow(d) - 1]} ${p.d} ${MESES_CORTO[p.m - 1]}${yr}`;
}
export function fmtDayMonth(d, ref) {
  const p = parse(d);
  const yr = ref && parse(ref).y !== p.y ? ` ${p.y}` : '';
  return `${p.d} ${MESES_CORTO[p.m - 1]}${yr}`;
}
// "Hoy", "Mañana", "Ayer", "el jueves", "jue 19 nov"
export function fmtRel(d, today) {
  const n = diffDays(today, d);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  if (n > 1 && n < 7) return cap(dayName(d));
  return cap(fmtShort(d, today));
}
export function fmtMonthYear(d) {
  const p = parse(d);
  return `${cap(MESES[p.m - 1])} ${p.y}`;
}
export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
// Marca de tiempo ISO → "13 nov, 10:32" en hora local del dispositivo
export function fmtStamp(iso, today) {
  const t = new Date(iso);
  if (isNaN(t)) return '';
  const d = todayLocal(t);
  return `${fmtDayMonth(d, today)}, ${nowHM(t)}`;
}
