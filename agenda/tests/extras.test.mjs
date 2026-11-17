// Pruebas de las mejoras de la versión 1.1
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/shared/dates.js';
import * as M from '../js/shared/model.js';
import { computeFires } from '../js/shared/reminders.js';
import { parseQuick } from '../js/shared/quick.js';
import { freeSlots } from '../js/shared/slots.js';
import { computeStats } from '../js/shared/stats.js';
import { parseICS } from '../js/shared/icsimport.js';
import { buildICS } from '../js/shared/ics.js';

const T = '2026-11-16'; // lunes
const q = (s, now = '10:00') => parseQuick(s, T, now);
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);

test('captura rápida: fechas, horas y prioridad', () => {
  let r = q('Entregar estadística jueves 23:59 urgente');
  assert.deepEqual([r.title, r.kind, r.date, r.time, r.priority], ['Entregar estadística', 'task', '2026-11-19', '23:59', 'urgent']);
  r = q('Preparar examen para mañana');
  assert.deepEqual([r.title, r.date, r.time], ['Preparar examen', '2026-11-17', '']);
  r = q('llamar al banco mañana a las 10');
  assert.deepEqual([r.title, r.date, r.time], ['Llamar al banco', '2026-11-17', '10:00']);
  r = q('Dentista el 3 de diciembre a las 5 y media');
  assert.deepEqual([r.title, r.date, r.time], ['Dentista', '2026-12-03', '17:30']);
  r = q('Comprar material pasado mañana por la tarde, importante');
  assert.deepEqual([r.title, r.date, r.time, r.priority], ['Comprar material', '2026-11-18', '16:00', 'high']);
  assert.equal(q('Pagar matrícula 19/11').date, '2026-11-19');
  assert.equal(q('Pagar matrícula 5/1').date, '2027-01-05'); // ya pasó este año → el que viene
  assert.equal(q('Renovar abono el día 10').date, '2026-12-10');
  assert.equal(q('Revisar apuntes en 3 días').date, '2026-11-19');
  assert.equal(q('Reunión el lunes').date, '2026-11-23'); // hoy es lunes → el siguiente
  assert.equal(q('Entrega el viernes de la semana que viene').date, '2026-11-27');
  assert.equal(q('Leer artículo').date, T);
  assert.equal(q('Llamar a las 9', '12:00').date, '2026-11-17'); // las 9 ya pasaron → mañana
  assert.equal(q('Cena a las 9 de la noche').time, '21:00');
  assert.equal(q('Tren 7:45').time, '07:45');
  assert.equal(q('Enviar informe hoy antes de las 14h').title, 'Enviar informe');
});

test('captura rápida: franjas, repeticiones, avisos y tipo', () => {
  let r = q('Estudiar inglés todos los lunes de 17 a 19');
  assert.deepEqual([r.title, r.kind, r.date, r.start, r.end], ['Estudiar inglés', 'event', T, '17:00', '19:00']);
  assert.deepEqual(r.repeat, { freq: 'weekly', interval: 1, days: [1], until: '' });
  r = q('Trabajo de lunes a viernes de 7:30 a 15:30');
  assert.deepEqual([r.title, r.start, r.end, r.repeat.days.join('')], ['Trabajo', '07:30', '15:30', '12345']);
  r = q('Gimnasio mañana de 5 a 6');
  assert.deepEqual([r.kind, r.start, r.end], ['event', '17:00', '18:00']);
  r = q('Guardia el sábado de 22 a 6');
  assert.deepEqual([r.date, r.start, r.end], ['2026-11-21', '22:00', '06:00']);
  r = q('Clase del máster jueves a las 18 durante 2 horas, avísame 15 min antes');
  assert.deepEqual([r.title, r.kind, r.date, r.start, r.end], ['Clase del máster', 'event', '2026-11-19', '18:00', '20:00']);
  assert.deepEqual(r.reminders, [{ t: 'rel', min: 15 }]);
  r = q('Tomar la pastilla cada día a las 9');
  assert.deepEqual([r.title, r.repeat.freq, r.time], ['Tomar la pastilla', 'daily', '09:00']);
  r = q('Recuérdame llamar a mamá mañana a las 20:30');
  assert.deepEqual([r.kind, r.title, r.time], ['reminder', 'Llamar a mamá', '20:30']);
  r = q('Pádel los martes y jueves 19:00-20:30');
  assert.deepEqual([r.title, r.repeat.days.join(''), r.date, r.start, r.end], ['Pádel', '24', '2026-11-17', '19:00', '20:30']);
  assert.equal(q('Revisar presupuesto cada 2 semanas').repeat.interval, 2);
});

test('avisos insistentes: se repiten hasta completar, sin molestar de noche', () => {
  const t = { id: 'n', kind: 'task', title: 'Entregar trabajo', date: '2026-11-16', time: '12:00', nag: 120 };
  const f = computeFires(t, Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-18T00:00:00Z'));
  assert.deepEqual(f.map((x) => iso(x.fireAt)), [
    '2026-11-16T13:00', '2026-11-16T15:00', '2026-11-16T17:00', '2026-11-16T19:00', '2026-11-16T21:00', // 14–22 h de Madrid
    '2026-11-17T07:00', '2026-11-17T09:00', '2026-11-17T11:00', '2026-11-17T13:00', '2026-11-17T15:00', '2026-11-17T17:00', '2026-11-17T19:00', '2026-11-17T21:00',
  ]);
  assert.equal(f[0].body, 'Sigue pendiente · vencía a las 12:00');
  assert.equal(f[5].body, 'Sigue pendiente desde el lun 16 nov');
  // completada → se acaban
  assert.equal(computeFires(M.setDone(t, t.date, true, 'x'), 0, 4e12).length, 0);
  // reprogramada → empiezan a contar desde la nueva fecha
  const moved = M.reschedule(t, t.date, '2026-11-20', 'x');
  assert.equal(computeFires(moved, Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-20T10:00:00Z')).length, 0);
  // «cada día»: a las 09:00 de los días siguientes, 14 días como máximo
  const daily = computeFires({ ...t, nag: 1440, time: '' }, Date.parse('2026-11-10T00:00:00Z'), Date.parse('2026-12-31T00:00:00Z'));
  assert.equal(daily.length, 14);
  assert.equal(iso(daily[0].fireAt), '2026-11-17T08:00');
  assert.equal(iso(daily[13].fireAt), '2026-11-30T08:00');
  // serie: varias repeticiones pendientes no multiplican los avisos del mismo minuto
  let serie = { id: 's', kind: 'task', title: 'Inglés', date: '2026-11-09', time: '10:00', nag: 240, repeat: { freq: 'daily', interval: 1 } };
  const g = computeFires(serie, Date.parse('2026-11-16T12:00:00Z'), Date.parse('2026-11-16T22:00:00Z'));
  assert.deepEqual(g.map((x) => iso(x.fireAt)), ['2026-11-16T13:00', '2026-11-16T17:00', '2026-11-16T21:00']);
  assert.equal(g[0].body, 'Sigue pendiente desde el lun 9 nov');
  for (let d = 9; d <= 16; d++) serie = M.setDone(serie, `2026-11-${String(d).padStart(2, '0')}`, true, 'x');
  assert.equal(computeFires(serie, Date.parse('2026-11-16T12:00:00Z'), Date.parse('2026-11-16T22:00:00Z')).length, 0);
});

test('subtareas: estado por tarea y por repetición', () => {
  let t = { id: 't', kind: 'task', title: 'Trabajo', date: T, subtasks: [{ id: 'a', title: 'Índice' }, { id: 'b', title: 'Redactar' }] };
  t = M.toggleSub(t, T, 'a');
  assert.deepEqual(M.instance(t, T).subDone, ['a']);
  t = M.toggleSub(t, T, 'a');
  assert.deepEqual(M.instance(t, T).subDone, []);
  let s = { ...t, id: 's', date: '2026-11-09', repeat: { freq: 'weekly', interval: 1, days: [1] } };
  s = M.toggleSub(s, '2026-11-09', 'b');
  assert.deepEqual(M.instance(s, '2026-11-09').subDone, ['b']);
  assert.deepEqual(M.instance(s, '2026-11-16').subDone, []); // la semana siguiente empieza de cero
  assert.equal(M.instance(s, '2026-11-16').subtasks.length, 2);
  assert.ok(M.isPending(M.instance(s, '2026-11-09'))); // marcar subtareas no completa la tarea
});

const semana = [
  { id: 'w', kind: 'event', title: 'Trabajo', categoryId: 'c1', date: '2026-11-02', start: '07:30', end: '15:30', repeat: { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] } },
  { id: 'c', kind: 'event', title: 'Clase', categoryId: 'c2', date: '2026-11-05', start: '18:00', end: '20:00', repeat: { freq: 'weekly', interval: 1, days: [4] } },
];

test('buscar hueco: franjas libres entre actividades', () => {
  const s = freeSlots(semana, { from: T, to: '2026-11-19', duration: 120, today: T, nowMin: 16 * 60 + 10 });
  assert.deepEqual(s.map((x) => `${x.date.slice(8)} ${D.minToHM(x.s)}-${D.minToHM(x.e)}`), [
    '16 16:30-18:30', '16 18:30-20:30', // hoy, a partir de ahora
    '17 15:30-17:30', '17 17:30-19:30', '17 19:30-21:30',
    '18 15:30-17:30', '18 17:30-19:30', '18 19:30-21:30',
    '19 15:30-17:30', // antes de la clase de las 18:00
    '19 20:00-22:00', // y después
  ]);
  assert.equal(s[8].until, 18 * 60);
  // sin hueco suficiente no se propone nada ese día
  assert.equal(freeSlots(semana, { from: '2026-11-19', to: '2026-11-19', duration: 180, today: T }).length, 0);
  assert.equal(freeSlots(semana, { from: '2026-11-21', to: '2026-11-21', duration: 60, today: T })[0].s, 480); // sábado libre desde las 8
});

test('revisión semanal', () => {
  const items = semana.concat([
    { id: 't1', kind: 'task', title: 'Entregar trabajo', date: '2026-11-19', priority: 'urgent' },
    { id: 't2', kind: 'task', title: 'Comprar material', date: '2026-11-21', priority: 'low' },
    { id: 't3', kind: 'task', title: 'Vieja', date: '2026-11-10', priority: 'medium' },
    { id: 't4', kind: 'task', title: 'Hecha', date: '2026-11-18', priority: 'medium', doneAt: 'x' },
  ]);
  const w = M.weekAhead(items, '2026-11-15'); // domingo
  assert.deepEqual([w.from, w.to, w.events, w.tasks.length, w.carried, w.busiest], ['2026-11-16', '2026-11-22', 6, 2, 1, '2026-11-19']);
  const txt = M.weekAheadText(w);
  assert.equal(txt.title, 'Tu semana: 16–22 nov');
  assert.equal(txt.body, '6 actividades · 2 tareas · 1 pendiente de antes\nTareas: jue Entregar trabajo; sáb Comprar material\nDía más cargado: jueves');
});

test('estadísticas: racha, puntualidad y horas por categoría', () => {
  const at = (d, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();
  const day = (iso) => iso.slice(0, 10);
  const items = semana.concat([
    { id: 'a', kind: 'task', title: 'A', date: '2026-11-13', doneAt: at('2026-11-13') },
    { id: 'b', kind: 'task', title: 'B', date: '2026-11-14', doneAt: at('2026-11-14') },
    { id: 'c1', kind: 'task', title: 'C', date: '2026-11-15', doneAt: at('2026-11-16') }, // un día tarde
    { id: 'd', kind: 'task', title: 'D', date: '2026-11-11' }, // sigue pendiente → rompe la racha anterior
    { id: 'e', kind: 'task', title: 'E', date: '2026-11-10', doneAt: at('2026-11-10') },
    { id: 'f', kind: 'task', title: 'F', date: '2026-11-16' }, // la de hoy aún no cuenta
  ]);
  const s = computeStats(items, T, day);
  assert.equal(s.streak, 3); // 15, 14 y 13
  assert.equal(s.onTime, 75);
  assert.equal(s.thisWeek, 1);
  assert.equal(s.lastWeek, 3);
  assert.deepEqual(s.last7.map((x) => x.n), [1, 0, 0, 1, 1, 0, 1]);
  assert.deepEqual(s.hours, [{ categoryId: 'c1', minutes: 2400 }, { categoryId: 'c2', minutes: 120 }]);
  assert.deepEqual([s.pendingNow, s.overdue], [2, 1]);
});

test('importar .ics: series, excepciones, husos y reimportación sin duplicados', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:abc-1', 'SUMMARY:Estadística\\, grupo A', 'LOCATION:Aula 3.1', 'DTSTART;TZID=Europe/Madrid:20261105T180000', 'DTEND;TZID=Europe/Madrid:20261105T200000',
    'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261217T225959Z', 'EXDATE;TZID=Europe/Madrid:20261119T180000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:abc-1', 'RECURRENCE-ID;TZID=Europe/Madrid:20261126T180000', 'SUMMARY:Estadística (examen)', 'DTSTART;TZID=Europe/Madrid:20261127T100000', 'DTEND;TZID=Europe/Madrid:20261127T120000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:abc-2', 'SUMMARY:Reunión con una línea muy larga que el archivo parte en d', ' os trozos', 'DTSTART:20261120T090000Z', 'DURATION:PT1H30M', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:abc-3', 'SUMMARY:Puente', 'DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261209', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:abc-4', 'SUMMARY:Cumpleaños', 'DTSTART;VALUE=DATE:20260310', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:abc-5', 'SUMMARY:Lab', 'DTSTART;TZID=America/New_York:20261118T090000', 'DTEND;TZID=America/New_York:20261118T100000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:abc-6', 'SUMMARY:Rara', 'DTSTART:20261118T090000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const r = parseICS(ics, { categoryId: 'cat-estudios', reminderMin: 15 });
  assert.deepEqual([r.events, r.series, r.unsupported], [6, 4, 1]);
  const by = Object.fromEntries(r.items.map((i) => [i.title, i]));
  const est = by['Estadística, grupo A'];
  assert.deepEqual([est.date, est.start, est.end, est.repeat.until, est.notes, est.categoryId], ['2026-11-05', '18:00', '20:00', '2026-12-17', 'Aula 3.1', 'cat-estudios']);
  assert.deepEqual(est.reminders, [{ t: 'rel', min: 15 }]);
  const occ = M.expand(est, '2026-11-01', '2026-11-30').sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(occ.map((o) => `${o.date} ${o.start} ${o.title}`), ['2026-11-05 18:00 Estadística, grupo A', '2026-11-12 18:00 Estadística, grupo A', '2026-11-27 10:00 Estadística (examen)']);
  const reu = by['Reunión con una línea muy larga que el archivo parte en dos trozos'];
  assert.deepEqual([reu.date, reu.start, reu.end], ['2026-11-20', '10:00', '11:30']); // 09:00 UTC = 10:00 en Madrid
  assert.deepEqual(M.expand(by.Puente, '2026-12-01', '2026-12-31').map((o) => o.date), ['2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08']);
  assert.deepEqual(M.expand(by['Cumpleaños'], '2027-01-01', '2028-12-31').map((o) => o.date), ['2027-03-10', '2028-03-10']);
  assert.deepEqual([by.Lab.start, by.Lab.end, by.Lab.repeat.until], ['15:00', '16:00', '2026-12-02']); // Nueva York → Madrid; 3 repeticiones
  assert.equal(by.Rara.repeat, null); // regla no compatible: se importa como actividad única
  // reimportar da los mismos identificadores (no duplica)
  assert.deepEqual(parseICS(ics).items.map((i) => i.id), r.items.map((i) => i.id));
  // ida y vuelta con la exportación propia
  const back = parseICS(buildICS(semana));
  assert.deepEqual(back.items.map((i) => [i.title, i.start, i.end, i.repeat.days.join('')]), [['Trabajo', '07:30', '15:30', '12345'], ['Clase', '18:00', '20:00', '4']]);
});
