// Inicio: el centro de control del día.

import { html, useMemo, useState } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { Icon, TaskRow, EventRow, openLayer, ui } from './common.js';
import { openDetail } from './detail.js';

// Filas del día ordenadas por hora: actividades de todo el día, con hora y recordatorios
export function dayRows(seg) {
  const rows = seg.allDay.map((inst) => ({ inst, s: -1, e: 1440, key: inst.uid }));
  for (const t of seg.timed) rows.push({ inst: t.inst, seg: t, s: t.s, e: t.e, key: t.inst.uid + t.s });
  for (const p of seg.points) rows.push({ inst: p, s: D.hmToMin(p.time || '00:00'), e: D.hmToMin(p.time || '00:00'), key: p.uid });
  return rows.sort((a, b) => a.s - b.s || a.e - b.e);
}

function Ring({ done, total }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const f = total ? done / total : 0;
  return html`<svg class=${'ring' + (total && done === total ? ' full' : '')} width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
    <circle cx="22" cy="22" r=${r} class="ring-bg" />
    ${f > 0 && html`<circle cx="22" cy="22" r=${r} class="ring-fg" stroke-dasharray=${`${c * f} ${c}`} transform="rotate(-90 22 22)" />`}
  </svg>`;
}

function nextUp(ov, nowMin) {
  for (const r of dayRows(ov.today)) {
    if (r.s < 0) continue;
    if (r.inst.kind === 'reminder' ? r.s >= nowMin : r.e > nowMin) {
      const live = r.s <= nowMin && r.inst.kind !== 'reminder';
      const mins = live ? r.e - nowMin : r.s - nowMin;
      return { row: r, label: live ? 'Ahora' : 'A continuación', note: live ? `Termina en ${D.fmtDuration(mins)}` : mins === 0 ? 'Empieza ahora' : `Empieza en ${D.fmtDuration(mins)}` };
    }
  }
  const tm = dayRows(ov.tomorrow).find((r) => r.s >= 0);
  if (tm) return { row: tm, label: 'Mañana', note: '' };
  return null;
}

export function Home({ onGo }) {
  const today = ui.today;
  const nowMin = D.hmToMin(ui.now);
  const ov = useMemo(() => M.overview(store.state.items, today), [store.state.version, today]);
  const [showDone, setShowDone] = useState(false);
  const rows = dayRows(ov.today);
  const tomorrowRows = dayRows(ov.tomorrow);
  const next = nextUp(ov, nowMin);
  const { done, total } = ov.progress;
  const p = D.parse(today);
  const nowIndex = rows.findIndex((r) => r.s > nowMin);
  const OVERDUE_MAX = 6;

  const progressText = total === 0 ? 'Sin tareas para hoy' : done === total ? `Las ${total === 1 ? 'tarea de hoy, hecha' : total + ' tareas de hoy, hechas'}` : `${done} de ${total} ${total === 1 ? 'tarea' : 'tareas'} de hoy`;

  return html`
    <div class="view home">
      <header class="top">
        <div>
          <h1>${D.cap(D.dayName(today))}</h1>
          <p class="sub">${p.d} de ${D.MESES[p.m - 1]} de ${p.y}</p>
        </div>
        <button class="icon-btn" aria-label="Buscar" onClick=${() => openLayer({ type: 'search' })}><${Icon} name="search" /></button>
      </header>

      <div class="summary">
        <div class="progress" onClick=${() => onGo('tasks')}>
          <${Ring} done=${done} total=${total} />
          <div><b>${progressText}</b>${ov.overdue.length > 0 && html`<span class="late">${ov.overdue.length} ${ov.overdue.length === 1 ? 'atrasada' : 'atrasadas'}</span>`}</div>
        </div>
        ${next &&
        html`<div class=${'next' + (next.label === 'Ahora' ? ' live' : '')} style=${`--c:${store.colorOf(next.row.inst.categoryId)}`} onClick=${() => openDetail(next.row.inst)}>
          <span class="next-label">${next.label}</span>
          <strong>${next.row.inst.title}</strong>
          <span class="next-time">${next.row.inst.kind === 'reminder' ? next.row.inst.time : `${D.minToHM(next.row.s)}–${next.row.e === 1440 ? '24:00' : D.minToHM(next.row.e)}`}${next.note ? ` · ${next.note}` : ''}</span>
        </div>`}
      </div>

      ${ov.overdue.length > 0 &&
      html`<section class="block overdue-block">
        <h2>Tareas atrasadas <span class="count">${ov.overdue.length}</span></h2>
        <div class="card list">
          ${ov.overdue.slice(0, OVERDUE_MAX).map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode="overdue" onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}
          ${ov.overdue.length > OVERDUE_MAX && html`<button class="more" onClick=${() => onGo('tasks', 'overdue')}>Ver las ${ov.overdue.length} atrasadas</button>`}
        </div>
      </section>`}

      <section class="block">
        <h2>Hoy</h2>
        ${rows.length === 0
          ? html`<p class="quiet">No hay actividades programadas.</p>`
          : html`<div class="card list timeline">
              ${rows.map((r, i) => html`
                ${i === nowIndex && i > 0 && html`<div class="now-line" key="now"><span>${ui.now}</span></div>`}
                <${EventRow} key=${r.key} inst=${r.inst} seg=${r.seg} onOpen=${openDetail} past=${r.s >= 0 && (r.inst.kind === 'reminder' ? r.s < nowMin : r.e <= nowMin)} now=${r.seg && r.s <= nowMin && r.e > nowMin} />
              `)}
            </div>`}
      </section>

      <section class="block">
        <h2>Tareas de hoy</h2>
        ${ov.tasksToday.length === 0
          ? html`<p class="quiet">${done > 0 ? 'Todo hecho por hoy.' : 'Ninguna tarea para hoy. Pulsa + para añadir una.'}</p>`
          : html`<div class="card list">${ov.tasksToday.map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode="day" onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}</div>`}
        ${ov.doneToday.length > 0 &&
        html`<button class="fold" aria-expanded=${showDone} onClick=${() => setShowDone(!showDone)}>
            <${Icon} name=${showDone ? 'down' : 'chevron'} size=${16} /> Completadas hoy (${ov.doneToday.length})
          </button>
          ${showDone && html`<div class="card list">${ov.doneToday.map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode="done" onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}</div>`}`}
      </section>

      <section class="block">
        <h2>Mañana <span class="h-sub">${D.dayName(D.addDays(today, 1))} ${D.parse(D.addDays(today, 1)).d}</span></h2>
        ${tomorrowRows.length + ov.tasksTomorrow.length === 0
          ? html`<p class="quiet">Nada previsto todavía.</p>`
          : html`<div class="card list">
              ${tomorrowRows.map((r) => html`<${EventRow} key=${r.key} inst=${r.inst} seg=${r.seg} onOpen=${openDetail} />`)}
              ${ov.tasksTomorrow.map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode="day" onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}
            </div>`}
      </section>

      ${ov.upcoming.length > 0 &&
      html`<section class="block">
        <h2>Próximos días</h2>
        <div class="card list">
          ${ov.upcoming.slice(0, 8).map((i) =>
            i.kind === 'task'
              ? html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode="list" onToggle=${actions.toggleDone} onOpen=${openDetail} />`
              : html`<div class="found" key=${i.uid}><span class="found-date">${D.fmtRel(i.date, today)}</span><${EventRow} inst=${i} onOpen=${openDetail} /></div>`
          )}
          ${ov.upcoming.length > 8 && html`<button class="more" onClick=${() => onGo('tasks')}>Ver todas las tareas</button>`}
        </div>
      </section>`}
    </div>
  `;
}
