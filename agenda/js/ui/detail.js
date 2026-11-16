// Ficha de un elemento, reprogramación de tareas y búsqueda.

import { html, useState, useRef, useEffect } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import { reminderLabel } from '../shared/reminders.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { Sheet, Icon, Check, TaskRow, EventRow, Empty, openLayer, closeLayer, overdueText, ui } from './common.js';

const HISTORY = { created: 'Creada', done: 'Completada', undone: 'Marcada como pendiente', moved: 'Reprogramada', cancelled: 'Cancelada', restored: 'Restaurada' };

export const openDetail = (inst) => openLayer({ type: 'detail', id: inst.id, key0: inst.key });
export const openEditor = (opts) => openLayer({ type: 'editor', ...opts });

export function Detail({ layer }) {
  const item = store.get(layer.id);
  if (!item || item.deleted) {
    setTimeout(() => closeLayer(), 0);
    return null;
  }
  // Una tarea no recurrente cambia de clave al reprogramarse
  const key = M.isRecurring(item) ? layer.key0 : item.date;
  const inst = M.instance(item, key);
  const today = ui.today;
  const cat = store.category(inst.categoryId);
  const task = inst.kind === 'task';
  const pending = task && M.isPending(inst);
  const overdue = pending && inst.date < today;
  const when = inst.kind === 'event' ? (inst.allDay ? 'Todo el día' : `${inst.start} – ${inst.end}${M.timeRange(inst).e > 1440 ? ' (día siguiente)' : ''} · ${D.fmtDuration(M.timeRange(inst).e - M.timeRange(inst).s)}`) : inst.time;
  const history = (item.history || []).slice().reverse();

  return html`
    <${Sheet} title=${task ? 'Tarea' : inst.kind === 'event' ? 'Actividad' : 'Recordatorio'} left="Cerrar" right="Editar" onLeft=${() => closeLayer()} onRight=${() => openEditor({ inst })}>
      <div class="detail-head">
        ${task && html`<${Check} inst=${inst} onToggle=${actions.toggleDone} />`}
        ${!task && html`<i class="dot" style=${`background:${store.colorOf(inst.categoryId)}`}></i>`}
        <h3 class=${inst.doneAt ? 'struck' : ''}>${inst.title || 'Sin título'}</h3>
      </div>

      ${task &&
      html`<div class="state">
        ${inst.doneAt && html`<span class="pill ok">Completada el ${D.fmtStamp(inst.doneAt, today)}</span>`}
        ${inst.cancelledAt && html`<span class="pill">Cancelada el ${D.fmtStamp(inst.cancelledAt, today)}</span>`}
        ${overdue && html`<span class="pill late">${overdueText(inst, today).since} · ${overdueText(inst, today).days}</span>`}
        ${pending && html`<span class=${`pill prio p-${inst.priority}`}>Prioridad ${M.prioLabel(inst.priority).toLowerCase()}</span>`}
      </div>`}

      <div class="group">
        <div class="cell info"><${Icon} name="calendar" size=${18} /><span>${D.cap(D.fmtLong(inst.date, D.parse(inst.date).y !== D.parse(today).y))}</span></div>
        ${when && html`<div class="cell info"><${Icon} name="clock" size=${18} /><span>${when}</span></div>`}
        ${inst.origDate !== inst.date && html`<div class="cell info"><${Icon} name="undo" size=${18} /><span>Fecha original: ${D.fmtLong(inst.origDate, true)}</span></div>`}
        ${inst.recurring && html`<div class="cell info"><${Icon} name="repeat" size=${18} /><span>${M.repeatLabel(item.repeat, item.date, today)}${inst.edited ? ' · esta ocurrencia está modificada' : ''}</span></div>`}
        ${cat && html`<div class="cell info"><${Icon} name="tag" size=${18} /><span>${cat.name}</span></div>`}
        ${inst.reminders.length > 0 && html`<div class="cell info"><${Icon} name="bell" size=${18} /><span>${inst.reminders.map((r) => reminderLabel(r, today)).join(' · ')}</span></div>`}
        ${inst.notes && html`<div class="cell info notes"><${Icon} name="note" size=${18} /><span>${inst.notes}</span></div>`}
      </div>

      ${task &&
      html`<div class="group">
        <button class="cell-btn" onClick=${() => actions.toggleDone(inst)}><${Icon} name=${inst.doneAt ? 'undo' : 'check'} size=${18} /> ${inst.doneAt ? 'Volver a dejar pendiente' : 'Marcar como completada'}</button>
        ${pending && html`<button class="cell-btn" onClick=${() => openLayer({ type: 'reschedule', id: inst.id, key0: inst.key })}><${Icon} name="calendar" size=${18} /> Reprogramar</button>`}
        ${!inst.doneAt &&
        html`<button class="cell-btn" onClick=${() => actions.setCancelled(inst, !inst.cancelledAt)}><${Icon} name=${inst.cancelledAt ? 'undo' : 'cancel'} size=${18} /> ${inst.cancelledAt ? 'Restaurar tarea' : 'Cancelar tarea'}</button>`}
      </div>`}

      ${task &&
      history.length > 0 &&
      html`<div class="group">
        <div class="cell stack">
          <span>Historial</span>
          <ul class="history">
            ${history.map(
              (h) => html`<li><b>${HISTORY[h.a] || h.a}${h.a === 'moved' ? `: ${D.fmtDayMonth(h.from, today)} → ${D.fmtDayMonth(h.to, today)}` : ''}</b><span>${D.fmtStamp(h.at, today)}</span></li>`
            )}
          </ul>
        </div>
      </div>`}

      <div class="group"><button class="cell-btn danger" onClick=${() => actions.removeInst(inst)}><${Icon} name="trash" size=${18} /> Eliminar</button></div>
    <//>
  `;
}

export function Reschedule({ layer }) {
  const item = store.get(layer.id);
  if (!item) return null;
  const key = M.isRecurring(item) ? layer.key0 : item.date;
  const inst = M.instance(item, key);
  const today = ui.today;
  const go = (d) => {
    closeLayer();
    actions.reschedule(inst, d);
  };
  const nextMon = D.addDays(D.startOfWeek(today), 7);
  const quick = [
    ['Hoy', today],
    ['Mañana', D.addDays(today, 1)],
    ['Pasado mañana', D.addDays(today, 2)],
    [D.dow(today) === 7 ? 'Mañana, lunes' : 'El lunes que viene', nextMon],
    ['Dentro de una semana', D.addDays(today, 7)],
  ].filter(([, d], i, arr) => d !== inst.date && arr.findIndex((x) => x[1] === d) === i);
  return html`
    <${Sheet} title="Reprogramar" left="Cancelar" onLeft=${() => closeLayer()}>
      <p class="lead">${inst.title}. Se conservan la descripción, la prioridad, los avisos y el historial.</p>
      <div class="group">
        ${quick.map(([label, d]) => html`<button class="cell-btn between" onClick=${() => go(d)}><span>${label}</span><em>${D.fmtShort(d, today)}</em></button>`)}
        <label class="cell"><span>Otra fecha</span><input type="date" value=${inst.date} onChange=${(e) => e.target.value && go(e.target.value)} /></label>
      </div>
    <//>
  `;
}

export function Search() {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    setTimeout(() => ref.current && ref.current.focus(), 350);
  }, []);
  const today = ui.today;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = norm(q).split(/\s+/).filter(Boolean);
  let tasks = [];
  let events = [];
  if (words.length) {
    const match = (it) => {
      const hay = norm(`${it.title} ${it.notes} ${(store.category(it.categoryId) || {}).name || ''} ${Object.values(it.overrides || {}).map((o) => `${o.title || ''} ${o.notes || ''}`).join(' ')}`);
      return words.every((w) => hay.includes(w));
    };
    for (const it of store.state.items.filter(match)) {
      if (it.kind === 'task') {
        if (!M.isRecurring(it)) tasks.push(M.instance(it, it.date));
        else {
          // de una serie: la próxima repetición pendiente (o la última)
          const list = M.expand(it, '0001-01-01', D.addDays(today, 366)).sort((a, b) => a.date.localeCompare(b.date));
          const pick = list.find((i) => M.isPending(i) && i.date >= today) || list.filter((i) => M.isPending(i)).pop() || list.pop();
          if (pick) tasks.push(pick);
        }
      } else {
        const list = M.expand(it, '0001-01-01', D.addDays(today, 366)).sort((a, b) => a.date.localeCompare(b.date));
        const pick = list.find((i) => i.date >= today) || list.pop();
        if (pick) events.push(pick);
      }
    }
    tasks = M.sortTasks(tasks).reverse().slice(0, 60);
    events.sort((a, b) => b.date.localeCompare(a.date));
    events = events.slice(0, 60);
  }
  return html`
    <${Sheet} title="Buscar" left="Cerrar" onLeft=${() => closeLayer()} tall>
      <div class="search-box"><${Icon} name="search" size=${18} /><input ref=${ref} type="search" placeholder="Actividades y tareas, también antiguas" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      ${words.length === 0 && html`<${Empty} title="Escribe para buscar" text="Se busca en títulos, descripciones y categorías de todo tu historial." />`}
      ${words.length > 0 && tasks.length + events.length === 0 && html`<${Empty} title="Sin resultados" text=${`No hay nada que contenga «${q.trim()}».`} />`}
      ${tasks.length > 0 &&
      html`<h4 class="sec">Tareas</h4>
        <div class="card list">${tasks.map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode=${i.doneAt ? 'done' : 'list'} onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}</div>`}
      ${events.length > 0 &&
      html`<h4 class="sec">Actividades y recordatorios</h4>
        <div class="card list">
          ${events.map(
            (i) => html`<div class="found" key=${i.uid}><span class="found-date">${D.fmtRel(i.date, today)}${i.recurring ? ' · se repite' : ''}</span><${EventRow} inst=${i} onOpen=${openDetail} /></div>`
          )}
        </div>`}
    <//>
  `;
}
