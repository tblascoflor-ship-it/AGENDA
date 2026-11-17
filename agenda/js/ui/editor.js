// Formulario de creación y edición de actividades, tareas y recordatorios.

import { html, useState, useRef, useEffect, useLayoutEffect } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import { QUICK_REMINDERS, NAG_OPTIONS, reminderLabel, reminderKey } from '../shared/reminders.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { Sheet, Icon, closeLayer, closeAll, toast, ui } from './common.js';

const KIND = { event: 'actividad', task: 'tarea', reminder: 'recordatorio' };
const REPEAT_MODES = [
  ['none', 'No se repite'],
  ['daily', 'Todos los días'],
  ['weekly', 'Cada semana'],
  ['days', 'Determinados días de la semana'],
  ['biweekly', 'Cada dos semanas'],
  ['monthly', 'Cada mes'],
  ['custom', 'Personalizada…'],
];

function modeOf(repeat, date) {
  if (!repeat || !repeat.freq) return 'none';
  const n = Math.max(1, +repeat.interval || 1);
  const days = repeat.days || [];
  const single = days.length <= 1 && (days[0] || D.dow(date)) === D.dow(date);
  if (repeat.freq === 'daily') return n === 1 ? 'daily' : 'custom';
  if (repeat.freq === 'monthly') return n === 1 ? 'monthly' : 'custom';
  if (n === 1) return single ? 'weekly' : 'days';
  if (n === 2 && single) return 'biweekly';
  return 'custom';
}

function initial({ kind, inst, date, start, preset }) {
  if (inst) {
    const r = inst.item.repeat || null;
    return {
      kind: inst.kind,
      title: inst.title,
      notes: inst.notes,
      categoryId: inst.categoryId,
      date: inst.date,
      allDay: inst.allDay,
      start: inst.start || '09:00',
      end: inst.end || '10:00',
      time: inst.time || '',
      priority: inst.priority,
      reminders: inst.reminders.slice(),
      nag: inst.nag || 0,
      subtasks: inst.subtasks.map((x) => ({ ...x })),
      mode: modeOf(r, inst.key),
      freq: (r && r.freq) || 'weekly',
      interval: (r && r.interval) || 1,
      days: r && r.days && r.days.length ? r.days.slice() : [D.dow(inst.date)],
      until: (r && r.until) || '',
      origDate: inst.date,
      origDays: r && r.days && r.days.length === 1 ? r.days.slice() : null,
    };
  }
  const d = date || ui.today;
  let s = start;
  if (!s) {
    const next = Math.min(23 * 60, Math.ceil((D.hmToMin(ui.now) + 1) / 60) * 60);
    s = d === ui.today ? D.minToHM(next) : '09:00';
  }
  const base = {
    kind,
    title: '',
    notes: '',
    categoryId: '',
    date: d,
    allDay: false,
    start: s,
    end: D.minToHM(Math.min(D.hmToMin(s) + 60, 1439)),
    time: kind === 'reminder' ? s : '',
    priority: 'medium',
    reminders: kind === 'event' ? [{ t: 'rel', min: 15 }] : kind === 'reminder' ? [{ t: 'rel', min: 0 }] : [],
    nag: 0,
    subtasks: [],
    mode: 'none',
    freq: 'weekly',
    interval: 1,
    days: [D.dow(d)],
    until: '',
  };
  if (!preset) return base;
  // Valores que llegan de la captura rápida
  const p = { ...base };
  for (const k of ['title', 'date', 'allDay', 'start', 'end', 'time', 'priority', 'reminders']) if (preset[k] !== undefined) p[k] = preset[k];
  const rp = preset.repeat;
  if (rp && rp.freq) Object.assign(p, { mode: modeOf(rp, p.date), freq: rp.freq, interval: rp.interval || 1, days: rp.days && rp.days.length ? rp.days.slice() : [D.dow(p.date)], until: rp.until || '' });
  return p;
}

function buildRepeat(f) {
  const until = f.until && f.until >= f.date ? f.until : '';
  // Si no se ha tocado la fecha de una ocurrencia existente, la serie conserva su día
  const own = f.origDays && f.date === f.origDate ? f.origDays : [D.dow(f.date)];
  switch (f.mode) {
    case 'daily':
      return { freq: 'daily', interval: 1, until };
    case 'weekly':
      return { freq: 'weekly', interval: 1, days: own, until };
    case 'days':
      return { freq: 'weekly', interval: 1, days: f.days.length ? f.days.slice().sort() : own, until };
    case 'biweekly':
      return { freq: 'weekly', interval: 2, days: own, until };
    case 'monthly':
      return { freq: 'monthly', interval: 1, until };
    case 'custom': {
      const interval = Math.max(1, Math.min(99, parseInt(f.interval, 10) || 1));
      if (f.freq === 'weekly') return { freq: 'weekly', interval, days: f.days.length ? f.days.slice().sort() : own, until };
      return { freq: f.freq, interval, until };
    }
    default:
      return null;
  }
}

export function Editor({ layer }) {
  const editing = layer.inst || null;
  const [f, setF] = useState(() => initial(layer));
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const titleRef = useRef(null);
  useEffect(() => {
    if (!editing) setTimeout(() => titleRef.current && titleRef.current.focus(), 350);
  }, []);

  const kind = f.kind;
  const valid = f.title.trim().length > 0 && D.isDate(f.date) && (kind !== 'reminder' || D.isHM(f.time)) && (kind !== 'event' || f.allDay || (D.isHM(f.start) && D.isHM(f.end)));
  const duration = kind === 'event' && !f.allDay && D.isHM(f.start) && D.isHM(f.end) ? M.timeRange(f).e - M.timeRange(f).s : 0;

  const setStart = (v) => {
    if (!D.isHM(v)) return set({ start: v });
    const dur = D.isHM(f.start) && D.isHM(f.end) ? M.timeRange(f).e - M.timeRange(f).s : 60;
    set({ start: v, end: D.minToHM(D.hmToMin(v) + dur) });
  };
  const toggleDay = (d) => set({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : f.days.concat([d]) });
  const addReminder = (value) => {
    if (!value) return;
    let r;
    if (value === 'custom') {
      const base = D.addDays(f.date, f.date > ui.today ? -1 : 0);
      r = { t: 'abs', at: `${base}T09:00` };
    } else r = { t: 'rel', min: +value };
    if (f.reminders.some((x) => reminderKey(x) === reminderKey(r))) return;
    set({ reminders: f.reminders.concat([r]) });
  };
  const setAbs = (i, at) => set({ reminders: f.reminders.map((r, j) => (j === i ? { t: 'abs', at } : r)) });
  const dropReminder = (i) => set({ reminders: f.reminders.filter((_, j) => j !== i) });
  const subsRef = useRef(null);
  const focusNewSub = useRef(false);
  const addSub = () => {
    focusNewSub.current = true;
    set({ subtasks: f.subtasks.concat([{ id: store.uid().slice(0, 8), title: '' }]) });
  };
  // El cursor pasa al paso recién añadido en cuanto aparece, sin perder pulsaciones
  useLayoutEffect(() => {
    if (!focusNewSub.current) return;
    focusNewSub.current = false;
    const list = subsRef.current ? subsRef.current.querySelectorAll('input') : [];
    if (list.length) list[list.length - 1].focus();
  }, [f.subtasks.length]);
  const setSub = (i, title) => set({ subtasks: f.subtasks.map((x, j) => (j === i ? { ...x, title } : x)) });
  const dropSub = (i) => set({ subtasks: f.subtasks.filter((_, j) => j !== i) });

  const save = async () => {
    if (!valid) return;
    const fields = {
      kind,
      title: f.title.trim(),
      notes: f.notes.trim(),
      categoryId: f.categoryId,
      date: f.date,
      reminders: f.reminders.filter((r) => r.t === 'rel' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.at)),
      repeat: buildRepeat(f),
    };
    if (kind === 'event') Object.assign(fields, { allDay: f.allDay, start: f.start, end: f.end === f.start ? D.minToHM(D.hmToMin(f.start) + 60) : f.end });
    if (kind === 'task') {
      Object.assign(fields, { time: f.time, priority: f.priority, nag: +f.nag || 0 });
      fields.subtasks = f.subtasks.map((x) => ({ id: x.id, title: x.title.trim() })).filter((x) => x.title);
    }
    if (kind === 'reminder') Object.assign(fields, { time: f.time });
    if (editing) {
      actions.saveEdit(editing, fields, () => {
        closeAll();
        toast('Cambios guardados');
      });
    } else {
      await actions.create(fields);
      closeLayer();
      toast(kind === 'event' ? 'Actividad guardada' : kind === 'task' ? 'Tarea guardada' : 'Recordatorio guardado');
    }
  };

  const showDays = f.mode === 'days' || (f.mode === 'custom' && f.freq === 'weekly');
  const baseLabel = kind === 'event' ? (f.allDay ? 'las 09:00 de ese día' : 'la hora de inicio') : f.time ? 'la hora indicada' : 'las 09:00 de ese día';

  return html`
    <${Sheet} title=${editing ? `Editar ${KIND[kind]}` : `${kind === 'reminder' ? 'Nuevo' : 'Nueva'} ${KIND[kind]}`} left="Cancelar" right="Guardar" rightDisabled=${!valid} onLeft=${() => closeLayer()} onRight=${save} tall>
      <div class="group">
        <input ref=${titleRef} class="field title-field" type="text" placeholder="Título" value=${f.title} onInput=${(e) => set({ title: e.target.value })} enterkeyhint="done" maxlength="200" />
        <textarea class="field" rows="2" placeholder="Descripción (opcional)" value=${f.notes} onInput=${(e) => set({ notes: e.target.value })} maxlength="4000"></textarea>
      </div>

      <div class="group">
        ${kind === 'event' &&
        html`<label class="cell"><span>Todo el día</span><input type="checkbox" class="switch" checked=${f.allDay} onChange=${(e) => set({ allDay: e.target.checked })} /></label>`}
        <label class="cell"><span>${kind === 'task' ? 'Fecha límite' : 'Fecha'}</span><input type="date" value=${f.date} onChange=${(e) => e.target.value && set({ date: e.target.value })} required /></label>
        ${kind === 'event' &&
        !f.allDay &&
        html`
          <label class="cell"><span>Empieza</span><input type="time" value=${f.start} onChange=${(e) => setStart(e.target.value)} /></label>
          <label class="cell"><span>Termina</span><em class="hint">${duration ? D.fmtDuration(duration) : ''}</em><input type="time" value=${f.end} onChange=${(e) => set({ end: e.target.value })} /></label>
        `}
        ${kind !== 'event' &&
        html`<label class="cell">
          <span>Hora${kind === 'task' ? ' (opcional)' : ''}</span>
          ${kind === 'task' && f.time && html`<button class="clear" onClick=${(e) => (e.preventDefault(), set({ time: '' }))} aria-label="Quitar hora"><${Icon} name="close" size=${14} /></button>`}
          <input type="time" value=${f.time} onChange=${(e) => set({ time: e.target.value })} />
        </label>`}
      </div>

      ${kind === 'task' &&
      html`<div class="group">
        <div class="cell stack">
          <span>Prioridad</span>
          <div class="prio-pick">
            ${M.PRIORITIES.map((p) => html`<button class=${`p-${p.id}` + (f.priority === p.id ? ' on' : '')} aria-pressed=${f.priority === p.id} onClick=${() => set({ priority: p.id })}><i></i>${p.label}</button>`)}
          </div>
        </div>
      </div>`}

      <div class="group">
        <label class="cell">
          <span>Repetir</span>
          <select value=${f.mode} onChange=${(e) => set({ mode: e.target.value })}>
            ${REPEAT_MODES.map(([id, label]) => html`<option value=${id}>${label}</option>`)}
          </select>
        </label>
        ${f.mode === 'custom' &&
        html`<div class="cell">
          <span>Cada</span>
          <input class="num" type="number" inputmode="numeric" min="1" max="99" value=${f.interval} onInput=${(e) => set({ interval: e.target.value })} />
          <select value=${f.freq} onChange=${(e) => set({ freq: e.target.value })}>
            <option value="daily">días</option>
            <option value="weekly">semanas</option>
            <option value="monthly">meses</option>
          </select>
        </div>`}
        ${showDays &&
        html`<div class="cell stack">
          <div class="days">${D.DIAS_LETRA.map((l, i) => html`<button class=${f.days.includes(i + 1) ? 'on' : ''} aria-pressed=${f.days.includes(i + 1)} aria-label=${D.DIAS[i]} onClick=${() => toggleDay(i + 1)}>${l}</button>`)}</div>
        </div>`}
        ${f.mode !== 'none' &&
        html`<label class="cell">
          <span>Termina</span>
          ${f.until ? html`<button class="clear" onClick=${(e) => (e.preventDefault(), set({ until: '' }))} aria-label="Sin fecha de fin"><${Icon} name="close" size=${14} /></button>` : html`<em class="hint">Nunca</em>`}
          <input type="date" value=${f.until} min=${f.date} onChange=${(e) => set({ until: e.target.value })} />
        </label>`}
        ${f.mode !== 'none' && html`<p class="note">${M.repeatLabel(buildRepeat(f), f.date, ui.today)}</p>`}
      </div>

      <div class="group">
        <div class="cell stack">
          <span>Avisos</span>
          ${f.reminders.length === 0 && html`<em class="hint">Sin avisos</em>`}
          <div class="chips">
            ${f.reminders.map((r, i) =>
              r.t === 'abs'
                ? html`<span class="chip abs"><input type="datetime-local" value=${r.at} onChange=${(e) => e.target.value && setAbs(i, e.target.value.slice(0, 16))} /><button onClick=${() => dropReminder(i)} aria-label="Quitar aviso"><${Icon} name="close" size=${14} /></button></span>`
                : html`<span class="chip">${reminderLabel(r, ui.today)}<button onClick=${() => dropReminder(i)} aria-label="Quitar aviso"><${Icon} name="close" size=${14} /></button></span>`
            )}
          </div>
          <label class="add-select">
            <${Icon} name="plus" size=${16} /> Añadir aviso
            <select value="" onChange=${(e) => (addReminder(e.target.value), (e.target.value = ''))}>
              <option value="" disabled>Elige cuándo avisar</option>
              ${QUICK_REMINDERS.map((q) => html`<option value=${q.min}>${q.label}</option>`)}
              <option value="custom">Fecha y hora personalizadas…</option>
            </select>
          </label>
        </div>
        ${f.reminders.some((r) => r.t === 'rel') && html`<p class="note">Los avisos «antes» se calculan respecto a ${baseLabel}.</p>`}
        ${kind === 'task' &&
        html`<label class="cell">
            <span>Insistir hasta completarla</span>
            <select value=${String(f.nag)} onChange=${(e) => set({ nag: +e.target.value })}>
              ${NAG_OPTIONS.map((o) => html`<option value=${String(o.min)}>${o.label}</option>`)}
            </select>
          </label>
          ${f.nag > 0 && html`<p class="note">${f.nag >= 1440 ? 'Un aviso a las 9:00 de cada día siguiente a la fecha límite' : `Avisos desde ${f.time ? 'la hora límite' : 'las 9:00 del día límite'}, solo entre las 8:00 y las 22:00`}, mientras siga pendiente y durante 14 días como máximo.</p>`}`}
      </div>

      ${kind === 'task' &&
      html`<div class="group">
        <div class="cell stack" ref=${subsRef}>
          <span>Subtareas</span>
          ${f.subtasks.map(
            (x, i) => html`<div class="sub-edit" key=${x.id}>
              <input type="text" placeholder="Paso" value=${x.title} maxlength="120" enterkeyhint="next" onInput=${(e) => setSub(i, e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && addSub()} />
              <button class="clear" onClick=${() => dropSub(i)} aria-label="Quitar subtarea"><${Icon} name="close" size=${14} /></button>
            </div>`
          )}
          <button class="add-select" onClick=${addSub}><${Icon} name="plus" size=${16} /> Añadir subtarea</button>
        </div>
      </div>`}

      <div class="group">
        <div class="cell stack">
          <span>Categoría</span>
          <div class="chips">
            <button class=${'chip pick' + (!f.categoryId ? ' on' : '')} onClick=${() => set({ categoryId: '' })}>Ninguna</button>
            ${store.state.categories.map(
              (c) => html`<button class=${'chip pick' + (f.categoryId === c.id ? ' on' : '')} style=${`--c:${c.color}`} onClick=${() => set({ categoryId: c.id })}><i></i>${c.name}</button>`
            )}
          </div>
        </div>
      </div>

      ${editing &&
      html`<div class="group"><button class="cell-btn danger" onClick=${() => actions.removeInst(editing)}><${Icon} name="trash" size=${18} /> Eliminar</button></div>`}
    <//>
  `;
}
