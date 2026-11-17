// Estadísticas sencillas a partir del historial.

import * as D from './dates.js';
import { completedTasks, expandAll, daySegments, pendingTasks } from './model.js';

export function computeStats(items, today, toLocalDate = (iso) => D.todayLocal(new Date(iso))) {
  const done = completedTasks(items).map((t) => ({ t, day: toLocalDate(t.doneAt) }));
  const perDay = {};
  for (const x of done) perDay[x.day] = (perDay[x.day] || 0) + 1;

  // Completadas en los últimos 7 días
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = D.addDays(today, -i);
    last7.push({ date: d, n: perDay[d] || 0 });
  }
  const mon = D.startOfWeek(today);
  const count = (a, b) => done.filter((x) => x.day >= a && x.day <= b).length;
  const thisWeek = count(mon, today);
  const lastWeek = count(D.addDays(mon, -7), D.addDays(mon, -1));

  // Puntualidad: completadas en su día o antes (últimos 30 días)
  const recent = done.filter((x) => x.day > D.addDays(today, -30));
  const onTime = recent.filter((x) => x.day <= x.t.date).length;

  // Racha: días seguidos (con tareas) en los que no quedó ninguna pendiente
  const byDate = {};
  for (const t of expandAll(items, D.addDays(today, -400), today, ['task'])) {
    if (t.cancelledAt) continue;
    const g = byDate[t.date] || (byDate[t.date] = { all: 0, done: 0 });
    g.all++;
    if (t.doneAt) g.done++;
  }
  let streak = 0;
  for (let i = 0; i <= 400; i++) {
    const g = byDate[D.addDays(today, -i)];
    if (!g) continue; // un día sin tareas ni suma ni rompe la racha
    if (g.done === g.all) streak++;
    else if (i === 0) continue; // hoy aún no ha terminado
    else break;
  }

  // Horas por categoría esta semana (lunes a domingo)
  const mins = {};
  for (let i = 0; i < 7; i++) {
    for (const s of daySegments(items, D.addDays(mon, i)).timed) {
      const k = s.inst.categoryId || '';
      mins[k] = (mins[k] || 0) + (s.e - s.s);
    }
  }
  const hours = Object.entries(mins)
    .map(([categoryId, m]) => ({ categoryId, minutes: m }))
    .sort((a, b) => b.minutes - a.minutes);

  const pending = pendingTasks(items, today);
  return {
    last7,
    thisWeek,
    lastWeek,
    totalDone: done.length,
    onTime: recent.length ? Math.round((onTime / recent.length) * 100) : null,
    onTimeBase: recent.length,
    streak,
    hours,
    pendingNow: pending.length,
    overdue: pending.filter((t) => t.date < today).length,
  };
}
