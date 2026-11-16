// Conversión entre hora local de una zona (Europe/Madrid) y UTC.
// Usa Intl, así que respeta automáticamente el horario de verano e invierno.

export const DEFAULT_TZ = 'Europe/Madrid';
const cache = {};

function parts(ms, tz) {
  const f =
    cache[tz] ||
    (cache[tz] = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }));
  const o = {};
  for (const p of f.formatToParts(ms)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

// Instante UTC (ms) → fecha y hora locales en la zona
export function utcToZoned(ms, tz = DEFAULT_TZ) {
  const p = parts(ms, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

function offsetAt(ms, tz) {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Fecha y hora locales en la zona → instante UTC (ms).
// Una hora inexistente (salto de primavera) se desplaza a la siguiente válida.
export function zonedToUtc(date, hm, tz = DEFAULT_TZ) {
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5));
  const off1 = offsetAt(wall, tz);
  let t = wall - off1;
  const off2 = offsetAt(t, tz);
  if (off2 !== off1) t = wall - off2;
  return t;
}

// Resta minutos en hora "de pared": «1 día antes» cae a la misma hora local
// aunque haya un cambio de hora por medio.
export function wallMinus(date, hm, minutes) {
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5)) - minutes * 60000;
  const t = new Date(wall);
  const p2 = (n) => String(n).padStart(2, '0');
  return {
    date: `${String(t.getUTCFullYear()).padStart(4, '0')}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`,
    hm: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`,
  };
}
