// Buscar hueco: franjas libres entre las actividades de cada día.

import * as D from './dates.js';
import { daySegments } from './model.js';

// Devuelve [{ date, s, e, until }] (minutos del día). `until` es hasta cuándo sigue libre.
export function freeSlots(items, { from, to, duration, today, nowMin = 0, dayStart = 480, dayEnd = 1320, perDay = 3, max = 12 }) {
  const out = [];
  const up = (m, q) => Math.ceil(m / q) * q;
  for (let d = from; d <= to && out.length < max; d = D.addDays(d, 1)) {
    const busy = daySegments(items, d).timed.map((t) => [t.s, t.e]).sort((a, b) => a[0] - b[0]);
    let cursor = dayStart;
    if (d === today) cursor = Math.max(cursor, up(nowMin + 5, 30));
    if (d < today) continue;
    let n = 0;
    // dentro de un hueco amplio se ofrecen varias horas de inicio
    const offer = (end) => {
      for (let s = cursor; s + duration <= end && n < perDay && out.length < max; s += Math.max(duration, 120)) {
        out.push({ date: d, s, e: s + duration, until: end });
        n++;
      }
    };
    for (const [s, e] of busy) {
      if (s > cursor) offer(Math.min(s, dayEnd));
      cursor = Math.max(cursor, up(e, 15));
      if (cursor >= dayEnd) break;
    }
    if (cursor < dayEnd) offer(dayEnd);
  }
  return out;
}
