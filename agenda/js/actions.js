// Acciones del usuario: aplican las reglas del modelo y guardan en el almacén.

import * as M from './shared/model.js';
import * as D from './shared/dates.js';
import * as store from './store.js';
import { toast, menu, closeAll, ui } from './ui/common.js';

const nowISO = () => new Date().toISOString();
const fresh = (inst) => store.get(inst.id) || inst.item;

// Completar / volver a dejar pendiente (con «Deshacer»)
export async function toggleDone(inst) {
  const done = !inst.doneAt;
  await store.save([M.setDone(fresh(inst), inst.key, done, nowISO())]);
  if (navigator.vibrate) navigator.vibrate(8);
  toast(done ? 'Tarea completada' : 'Tarea pendiente de nuevo', {
    label: 'Deshacer',
    run: () => store.save([M.setDone(fresh(inst), inst.key, !done, nowISO())]),
  });
}

export async function setCancelled(inst, cancelled) {
  await store.save([M.setCancelled(fresh(inst), inst.key, cancelled, nowISO())]);
  toast(cancelled ? 'Tarea cancelada' : 'Tarea restaurada', {
    label: 'Deshacer',
    run: () => store.save([M.setCancelled(fresh(inst), inst.key, !cancelled, nowISO())]),
  });
}

export async function reschedule(inst, newDate) {
  if (!D.isDate(newDate) || newDate === inst.date) return;
  const before = fresh(inst);
  await store.save([M.reschedule(before, inst.key, newDate, nowISO())]);
  toast(`Reprogramada para ${D.fmtRel(newDate, ui.today).toLowerCase()}`, { label: 'Deshacer', run: () => store.save([before]) });
}

// Guarda un elemento nuevo
export async function create(fields) {
  const at = nowISO();
  const item = { id: store.uid(), exdates: [], overrides: {}, ...fields, createdAt: at };
  if (item.kind === 'task') item.history = [{ at, a: 'created' }];
  await store.save([item]);
  return item;
}

// Guarda una edición; si es una serie pregunta el alcance
export function saveEdit(inst, fields, done) {
  const item = fresh(inst);
  const apply = async (scope) => {
    await store.save(M.applyEdit(item, inst.key, fields, scope, store.uid(), nowISO()));
    done && done();
  };
  if (!M.isRecurring(item)) return apply('all');
  const norm = (r) => (r && r.freq ? `${r.freq}|${Math.max(1, +r.interval || 1)}|${r.freq === 'weekly' ? (r.days && r.days.length ? r.days : [D.dow(item.date)]).slice().sort().join() : ''}|${r.until || ''}` : '');
  const repeatChanged = norm(fields.repeat) !== norm(item.repeat);
  const actions = [];
  if (!repeatChanged) actions.push({ label: 'Solo esta', run: () => apply('one') });
  actions.push({ label: 'Esta y las siguientes', run: () => apply('future') }, { label: 'Toda la serie', run: () => apply('all') });
  menu('Es una serie que se repite', actions, '¿A qué quieres aplicar los cambios?');
}

export function removeInst(inst, done) {
  const item = fresh(inst);
  const ask = { task: '¿Eliminar esta tarea?', event: '¿Eliminar esta actividad?', reminder: '¿Eliminar este recordatorio?' }[item.kind];
  const apply = async (scope) => {
    await store.save(M.applyDelete(item, inst.key, scope));
    done ? done() : closeAll();
    toast('Eliminado', { label: 'Deshacer', run: () => store.save([item]) });
  };
  if (!M.isRecurring(item)) return menu(ask, [{ label: 'Eliminar', danger: true, run: () => apply('all') }]);
  menu('Es una serie que se repite', [
    { label: 'Eliminar solo esta', danger: true, run: () => apply('one') },
    { label: 'Eliminar esta y las siguientes', danger: true, run: () => apply('future') },
    { label: 'Eliminar toda la serie', danger: true, run: () => apply('all') },
  ]);
}
