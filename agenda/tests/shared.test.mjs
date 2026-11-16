// Pruebas de la lógica compartida. Ejecutar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/shared/dates.js';
import * as M from '../js/shared/model.js';
import { zonedToUtc, utcToZoned } from '../js/shared/tz.js';
import { computeFires, activeUntil } from '../js/shared/reminders.js';
import { buildICS } from '../js/shared/ics.js';

const iso = (s) => new Date(s).toISOString();
const dates = (list) => list.map((i) => i.date);

test('fechas básicas', () => {
  assert.equal(D.dow('2026-11-13'), 5); // viernes
  assert.equal(D.dow('2026-11-16'), 1);
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.startOfWeek('2026-11-13'), '2026-11-09');
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.isoWeek('2026-11-13'), 46);
  assert.equal(D.isoWeek('2027-01-01'), 53);
  assert.equal(D.fmtLong('2026-11-13'), 'viernes, 13 de noviembre');
});

test('zona horaria Europe/Madrid con cambios de hora', () => {
  assert.equal(iso(zonedToUtc('2026-11-19', '17:00')), '2026-11-19T16:00:00.000Z'); // invierno, UTC+1
  assert.equal(iso(zonedToUtc('2026-07-01', '17:00')), '2026-07-01T15:00:00.000Z'); // verano, UTC+2
  // 29 mar 2026: a las 02:00 pasan a ser las 03:00
  assert.equal(iso(zonedToUtc('2026-03-29', '01:30')), '2026-03-29T00:30:00.000Z');
  assert.equal(iso(zonedToUtc('2026-03-29', '03:30')), '2026-03-29T01:30:00.000Z');
  assert.equal(utcToZoned(zonedToUtc('2026-03-29', '02:30')).hm, '03:30'); // hora inexistente
  // 25 oct 2026: a las 03:00 vuelven a ser las 02:00
  assert.equal(iso(zonedToUtc('2026-10-25', '01:30')), '2026-10-24T23:30:00.000Z');
  assert.equal(iso(zonedToUtc('2026-10-25', '03:30')), '2026-10-25T02:30:00.000Z');
  assert.equal(utcToZoned(Date.parse('2026-10-25T02:30:00Z')).hm, '03:30');
});

const trabajo = { id: 'w', kind: 'event', title: 'Trabajo', date: '2026-11-09', start: '07:30', end: '15:30', repeat: { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] } };

test('recurrencia semanal de lunes a viernes', () => {
  const r = dates(M.expand(trabajo, '2026-11-09', '2026-11-22'));
  assert.deepEqual(r, ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  assert.equal(M.expand(trabajo, '2030-03-04', '2030-03-10').length, 5); // años después
  assert.equal(M.expand(trabajo, '2026-11-01', '2026-11-08').length, 0); // antes del inicio
  assert.equal(M.repeatLabel(trabajo.repeat, trabajo.date), 'De lunes a viernes');
});

test('cada dos semanas, diaria, mensual y fecha de fin', () => {
  const q = { id: 'q', kind: 'event', date: '2026-11-05', repeat: { freq: 'weekly', interval: 2, days: [4] } };
  assert.deepEqual(dates(M.expand(q, '2026-11-01', '2026-12-31')), ['2026-11-05', '2026-11-19', '2026-12-03', '2026-12-17', '2026-12-31']);
  const d3 = { id: 'd', kind: 'event', date: '2026-11-01', repeat: { freq: 'daily', interval: 3, until: '2026-11-10' } };
  assert.deepEqual(dates(M.expand(d3, '2026-11-03', '2026-12-01')), ['2026-11-04', '2026-11-07', '2026-11-10']);
  const m = { id: 'm', kind: 'event', date: '2026-01-31', repeat: { freq: 'monthly', interval: 1 } };
  assert.deepEqual(dates(M.expand(m, '2026-01-01', '2026-04-30')), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(dates(M.expand(m, '2028-02-01', '2028-02-29')), ['2028-02-29']);
  const m2 = { id: 'm2', kind: 'event', date: '2026-01-15', repeat: { freq: 'monthly', interval: 2 } };
  assert.deepEqual(dates(M.expand(m2, '2026-04-01', '2026-08-01')), ['2026-05-15', '2026-07-15']);
});

test('editar o eliminar una sola ocurrencia no altera las demás', () => {
  const clase = { id: 'c', kind: 'event', title: 'Estadística', date: '2026-11-05', start: '18:00', end: '20:00', repeat: { freq: 'weekly', interval: 1, days: [4] } };
  const [sin] = M.applyDelete(clase, '2026-11-19', 'one');
  assert.deepEqual(dates(M.expand(sin, '2026-11-01', '2026-11-30')), ['2026-11-05', '2026-11-12', '2026-11-26']);
  const [mod] = M.applyEdit(clase, '2026-11-12', { title: 'Estadística (aula 3)', date: '2026-11-13', start: '16:00', end: '18:00' }, 'one');
  const list = M.expand(mod, '2026-11-01', '2026-11-30').sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(dates(list), ['2026-11-05', '2026-11-13', '2026-11-19', '2026-11-26']);
  assert.equal(list[1].title, 'Estadística (aula 3)');
  assert.equal(list[1].start, '16:00');
  assert.equal(list[2].title, 'Estadística');
  assert.equal(list[2].start, '18:00');
});

test('editar «esta y las siguientes» parte la serie; «toda la serie» la cambia entera', () => {
  const clase = { id: 'c', kind: 'event', title: 'Clase', date: '2026-11-05', start: '18:00', end: '20:00', repeat: { freq: 'weekly', interval: 1, days: [4] }, exdates: ['2026-12-03'] };
  const [old, fresh] = M.applyEdit(clase, '2026-11-19', { start: '19:00', end: '21:00', date: '2026-11-19', repeat: clase.repeat }, 'future', 'c2', 'now');
  assert.deepEqual(dates(M.expand(old, '2026-11-01', '2026-12-31')), ['2026-11-05', '2026-11-12']);
  assert.deepEqual(dates(M.expand(fresh, '2026-11-01', '2026-12-17')), ['2026-11-19', '2026-11-26', '2026-12-10', '2026-12-17']);
  assert.equal(fresh.id, 'c2');
  assert.equal(M.expand(fresh, '2026-11-19', '2026-11-19')[0].start, '19:00');
  const [all] = M.applyEdit(clase, '2026-11-19', { title: 'Clase nueva', date: '2026-11-19' }, 'all');
  assert.equal(all.date, '2026-11-05');
  assert.equal(M.expand(all, '2026-11-05', '2026-11-05')[0].title, 'Clase nueva');
  const [fut] = M.applyDelete(clase, '2026-11-19', 'future');
  assert.deepEqual(dates(M.expand(fut, '2026-11-01', '2026-12-31')), ['2026-11-05', '2026-11-12']);
});

test('actividad que cruza la medianoche', () => {
  const turno = { id: 'n', kind: 'event', title: 'Turno', date: '2026-11-13', start: '22:00', end: '06:00' };
  const a = M.daySegments([turno], '2026-11-13').timed[0];
  const b = M.daySegments([turno], '2026-11-14').timed[0];
  assert.deepEqual([a.s, a.e, a.after], [1320, 1440, true]);
  assert.deepEqual([b.s, b.e, b.before], [0, 360, true]);
  assert.equal(M.daySegments([turno], '2026-11-15').timed.length, 0);
});

test('tareas: se acumulan si no se completan, sin duplicarse (ejemplo del lunes)', () => {
  const mk = (id, title) => ({ id, kind: 'task', title, date: '2026-11-09', priority: 'medium' });
  let items = [mk('a', 'Estudiar estadística'), mk('b', 'Comprar material'), mk('c', 'Enviar un documento')];
  items[1] = M.setDone(items[1], '2026-11-09', true, '2026-11-09T17:00:00.000Z');
  for (const today of ['2026-11-10', '2026-11-11', '2026-11-20']) {
    const ov = M.overview(items, today);
    assert.deepEqual(ov.overdue.map((t) => t.title).sort(), ['Enviar un documento', 'Estudiar estadística']);
    assert.ok(ov.overdue.every((t) => t.date === '2026-11-09')); // conserva la fecha original
    assert.equal(D.diffDays(ov.overdue[0].date, today), D.diffDays('2026-11-09', today));
  }
  const done = M.completedTasks(items);
  assert.equal(done.length, 1);
  assert.equal(done[0].doneAt, '2026-11-09T17:00:00.000Z');
  // deshacer
  items[1] = M.setDone(items[1], '2026-11-09', false, 'x');
  assert.equal(M.overview(items, '2026-11-10').overdue.length, 3);
  assert.equal(M.completedTasks(items).length, 0);
  // la prioridad nunca cambia sola
  assert.ok(M.overview(items, '2027-01-01').overdue.every((t) => t.priority === 'medium'));
});

test('tareas: reprogramar conserva datos, fecha original e historial; cancelar', () => {
  let t = { id: 't', kind: 'task', title: 'Entrega', notes: 'PDF', date: '2026-11-09', priority: 'urgent', reminders: [{ t: 'rel', min: 60 }] };
  t = M.reschedule(t, '2026-11-09', '2026-11-12', 'T1');
  t = M.reschedule(t, '2026-11-12', '2026-11-14', 'T2');
  assert.equal(t.date, '2026-11-14');
  assert.equal(t.origDate, '2026-11-09');
  assert.equal(t.notes, 'PDF');
  assert.equal(t.priority, 'urgent');
  assert.equal(t.reminders.length, 1);
  assert.deepEqual(t.history.map((h) => [h.from, h.to]), [['2026-11-09', '2026-11-12'], ['2026-11-12', '2026-11-14']]);
  assert.equal(M.overview([t], '2026-11-13').overdue.length, 0);
  assert.equal(M.overview([t], '2026-11-15').overdue[0].origDate, '2026-11-09');
  t = M.setCancelled(t, t.date, true, 'T3');
  assert.equal(M.pendingTasks([t], '2027-01-01').length, 0);
  assert.equal(M.cancelledTasks([t]).length, 1);
  t = M.setCancelled(t, t.date, false, 'T4');
  assert.equal(M.pendingTasks([t], '2027-01-01').length, 1);
});

test('tareas recurrentes: cada repetición se completa por separado y las pendientes se acumulan', () => {
  let ing = { id: 'i', kind: 'task', title: 'Estudiar inglés', date: '2026-11-02', priority: 'low', repeat: { freq: 'weekly', interval: 1, days: [1] } };
  ing = M.setDone(ing, '2026-11-09', true, '2026-11-09T20:00:00.000Z');
  const ov = M.overview([ing], '2026-11-18');
  assert.deepEqual(dates(ov.overdue), ['2026-11-02', '2026-11-16']); // la del 9 está hecha
  assert.deepEqual(ov.overdue.map((t) => t.origDate), ['2026-11-02', '2026-11-16']);
  assert.equal(M.completedTasks([ing]).length, 1);
  assert.equal(M.completedTasks([ing])[0].key, '2026-11-09');
  // reprogramar una repetición atrasada
  ing = M.reschedule(ing, '2026-11-02', '2026-11-19', 'T');
  const ov2 = M.overview([ing], '2026-11-18');
  assert.deepEqual(dates(ov2.overdue), ['2026-11-16']);
  assert.equal(ov2.tasksTomorrow[0].origDate, '2026-11-02');
  // deshacer una repetición
  ing = M.setDone(ing, '2026-11-09', false, 'T');
  assert.equal(M.overview([ing], '2026-11-18').overdue.length, 2);
  // diaria durante un año sin tocar: 366 pendientes, un único registro
  const dia = { id: 'd', kind: 'task', title: 'Diaria', date: '2026-01-01', repeat: { freq: 'daily', interval: 1 } };
  assert.equal(M.pendingTasks([dia], '2027-01-01').length, 366);
});

test('avisos: instantes exactos, varios avisos por tarea y sin duplicados', () => {
  const llamada = { id: 'l', kind: 'reminder', title: 'Llamar', date: '2026-11-13', time: '15:30', reminders: [{ t: 'rel', min: 15 }, { t: 'rel', min: 0 }, { t: 'rel', min: 0 }] };
  const f = computeFires(llamada, Date.parse('2026-11-13T00:00:00Z'), Date.parse('2026-11-14T00:00:00Z'));
  assert.deepEqual(f.map((x) => iso(x.fireAt)), ['2026-11-13T14:15:00.000Z', '2026-11-13T14:30:00.000Z']);
  assert.equal(f[0].body, 'En 15 min · 15:30');
  assert.equal(f[1].body, 'Ahora · 15:30');
  const entrega = {
    id: 'e', kind: 'task', title: 'Entrega', date: '2026-11-19', time: '23:59',
    reminders: [{ t: 'abs', at: '2026-11-16T09:00' }, { t: 'rel', min: 1440 }, { t: 'abs', at: '2026-11-19T09:00' }, { t: 'abs', at: '2026-11-19T22:00' }],
  };
  const g = computeFires(entrega, Date.parse('2026-11-10T00:00:00Z'), Date.parse('2026-11-30T00:00:00Z'));
  assert.deepEqual(g.map((x) => x.body), ['Vence en 3 días: jueves 19 de noviembre a las 23:59', 'Vence mañana a las 23:59', 'Vence hoy a las 23:59', 'Vence hoy a las 23:59']);
  assert.equal(iso(g[1].fireAt), '2026-11-18T22:59:00.000Z');
  // completada → sin avisos
  assert.equal(computeFires(M.setDone(entrega, entrega.date, true, 'x'), 0, 4e12).length, 0);
  assert.equal(computeFires({ ...entrega, deleted: true }, 0, 4e12).length, 0);
});

test('avisos de series: solo dentro de la ventana, respetan excepciones y el cambio de hora', () => {
  const clase = { id: 'c', kind: 'event', title: 'Clase', date: '2026-10-01', start: '18:00', end: '20:00', repeat: { freq: 'weekly', interval: 1, days: [4] }, reminders: [{ t: 'rel', min: 30 }, { t: 'rel', min: 1440 }], exdates: ['2026-10-29'] };
  const f = computeFires(clase, Date.parse('2026-10-19T00:00:00Z'), Date.parse('2026-11-06T00:00:00Z'));
  assert.deepEqual(f.map((x) => iso(x.fireAt)), [
    '2026-10-21T16:00:00.000Z', // miércoles 18:00 (verano) = 1 día antes
    '2026-10-22T15:30:00.000Z', // jueves 17:30 (verano)
    '2026-11-04T17:00:00.000Z', // ya en horario de invierno
    '2026-11-05T16:30:00.000Z',
  ]);
  // ocurrencia movida de hora: el aviso sigue a la nueva hora
  const [mod] = M.applyEdit(clase, '2026-11-05', { date: '2026-11-05', start: '10:00', end: '12:00', title: 'Clase', reminders: [{ t: 'rel', min: 30 }] }, 'one');
  const g = computeFires(mod, Date.parse('2026-11-04T00:00:00Z'), Date.parse('2026-11-06T00:00:00Z'));
  assert.deepEqual(g.map((x) => iso(x.fireAt)), ['2026-11-05T08:30:00.000Z']);
  // tarea recurrente: la repetición completada no avisa
  let t = { id: 't', kind: 'task', title: 'Inglés', date: '2026-11-02', time: '10:00', repeat: { freq: 'weekly', interval: 1, days: [1] }, reminders: [{ t: 'rel', min: 0 }] };
  t = M.setDone(t, '2026-11-09', true, 'x');
  const h = computeFires(t, Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-20T00:00:00Z'));
  assert.deepEqual(h.map((x) => x.date), ['2026-11-02', '2026-11-16']);
  // «1 día antes» en el fin de semana del cambio de hora cae a la misma hora local
  const dom = { id: 'x', kind: 'event', title: 'X', date: '2026-10-25', start: '12:00', end: '13:00', reminders: [{ t: 'rel', min: 1440 }] };
  assert.equal(iso(computeFires(dom, 0, 4e12)[0].fireAt), '2026-10-24T10:00:00.000Z');
});

test('activeUntil', () => {
  assert.equal(activeUntil({ id: 'a', kind: 'event', date: '2026-11-13' }), '2026-11-15');
  assert.equal(activeUntil({ id: 'a', kind: 'task', date: '2020-01-01' }), '9999-12-31');
  assert.equal(activeUntil({ id: 'a', kind: 'task', date: '2020-01-01', doneAt: '2020-01-02T10:00:00.000Z' }), '2020-01-02');
  assert.equal(activeUntil({ id: 'a', kind: 'event', date: '2026-11-13', deleted: true }), '0000-00-00');
});

test('exportación ICS', () => {
  const ics = buildICS(
    [
      trabajo,
      { id: 'c', kind: 'event', title: 'Clase; estadística', date: '2026-11-05', start: '18:00', end: '20:00', repeat: { freq: 'weekly', interval: 1, days: [4], until: '2026-12-17' }, exdates: ['2026-11-19'], reminders: [{ t: 'rel', min: 15 }] },
      { id: 't', kind: 'task', title: 'Entrega', date: '2026-11-19', priority: 'high' },
      { id: 'd', kind: 'task', title: 'Hecha', date: '2026-11-10', doneAt: 'x' },
    ],
    { nowMs: Date.parse('2026-11-13T10:00:00Z') }
  );
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=MO,TU,WE,TH,FR\r\n/);
  assert.match(ics, /DTSTART;TZID=Europe\/Madrid:20261109T073000/);
  assert.match(ics, /SUMMARY:Clase\\; estadística/);
  assert.match(ics, /EXDATE;TZID=Europe\/Madrid:20261119T180000/);
  assert.match(ics, /UNTIL=20261217T225959Z/);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261119/);
  assert.ok(!ics.includes('Hecha'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
});
