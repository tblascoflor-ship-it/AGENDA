// Tareas: pendientes (con las atrasadas acumuladas), completadas y canceladas.

import { html, useMemo } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { Icon, TaskRow, Empty, openLayer, ui } from './common.js';
import { openDetail } from './detail.js';

const FILTERS = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'overdue', label: 'Atrasadas' },
  { id: 'urgent', label: 'Urgentes' },
  { id: 'done', label: 'Completadas' },
  { id: 'cancelled', label: 'Canceladas' },
];

export function Tasks({ filter, onFilter, cat, onCat }) {
  const today = ui.today;
  const items = store.state.items;
  const data = useMemo(() => {
    const byCat = (list) => (cat ? list.filter((t) => t.categoryId === cat) : list);
    const pending = byCat(M.pendingTasks(items, D.addDays(today, 60)));
    return { pending, done: byCat(M.completedTasks(items)), cancelled: byCat(M.cancelledTasks(items)) };
  }, [store.state.version, today, cat]);

  const overdue = data.pending.filter((t) => t.date < today).sort((a, b) => M.prioRank(a.priority) - M.prioRank(b.priority) || a.date.localeCompare(b.date));
  const row = (i, mode) => html`<${TaskRow} key=${i.uid} inst=${i} today=${today} mode=${mode} onToggle=${actions.toggleDone} onOpen=${openDetail} />`;
  const group = (title, list, mode, extra = '') =>
    list.length > 0 &&
    html`<section class=${'block ' + extra}>
      <h2>${title} <span class="count">${list.length}</span></h2>
      <div class="card list">${list.map((i) => row(i, mode))}</div>
    </section>`;

  let body;
  if (filter === 'pending' || filter === 'urgent') {
    let list = data.pending;
    if (filter === 'urgent') list = list.filter((t) => t.priority === 'urgent');
    const tomorrow = D.addDays(today, 1);
    const week = D.addDays(today, 7);
    // De cada serie solo se muestra su próxima repetición futura (las atrasadas, todas)
    const seen = new Set();
    const future = list.filter((t) => {
      if (t.date <= tomorrow) return false;
      if (!t.recurring) return true;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    const od = filter === 'urgent' ? overdue.filter((t) => t.priority === 'urgent') : overdue;
    body =
      list.length === 0
        ? html`<${Empty} title=${filter === 'urgent' ? 'Nada urgente' : 'No tienes tareas pendientes'} text=${filter === 'urgent' ? 'No hay tareas pendientes con prioridad urgente.' : 'Pulsa + para añadir una tarea.'} />`
        : html`
            ${group('Atrasadas', od, 'overdue', 'overdue-block')}
            ${group('Hoy', list.filter((t) => t.date === today), 'day')}
            ${group('Mañana', list.filter((t) => t.date === tomorrow), 'day')}
            ${group('Próximos 7 días', future.filter((t) => t.date <= week), 'list')}
            ${group('Más adelante', future.filter((t) => t.date > week), 'list')}
          `;
  } else if (filter === 'overdue') {
    body = overdue.length === 0 ? html`<${Empty} title="Ninguna tarea atrasada" text="Las tareas que no completes en su día aparecerán aquí hasta que las hagas, las reprogrames o las canceles." />` : group('Atrasadas', overdue, 'overdue', 'overdue-block');
  } else {
    const list = filter === 'done' ? data.done : data.cancelled;
    const field = filter === 'done' ? 'doneAt' : 'cancelledAt';
    if (list.length === 0) {
      body = html`<${Empty} title=${filter === 'done' ? 'Aún no hay tareas completadas' : 'Ninguna tarea cancelada'} text=${filter === 'done' ? 'Tu historial de tareas hechas se guardará aquí.' : ''} />`;
    } else {
      const groups = [];
      for (const t of list.slice(0, 400)) {
        const d = D.todayLocal(new Date(t[field]));
        const g = groups[groups.length - 1];
        if (g && g.d === d) g.list.push(t);
        else groups.push({ d, list: [t] });
      }
      body = html`${groups.map(
        (g) => html`<section class="block" key=${g.d}>
          <h2>${D.fmtRel(g.d, today)} <span class="count">${g.list.length}</span></h2>
          <div class="card list">${g.list.map((i) => row(i, 'done'))}</div>
        </section>`
      )}
      ${list.length > 400 && html`<p class="quiet">Se muestran las 400 más recientes. Usa la búsqueda para encontrar las anteriores.</p>`}`;
    }
  }

  return html`
    <div class="view tasks">
      <header class="top">
        <div>
          <h1>Tareas</h1>
          <p class="sub">${data.pending.filter((t) => t.date <= today).length} para hoy o atrasadas · ${data.done.length} completadas</p>
        </div>
        <button class="icon-btn" aria-label="Buscar" onClick=${() => openLayer({ type: 'search' })}><${Icon} name="search" /></button>
      </header>
      <div class="filters">
        ${FILTERS.map((f) => html`<button key=${f.id} class=${'fchip' + (filter === f.id ? ' on' : '')} aria-pressed=${filter === f.id} onClick=${() => onFilter(f.id)}>${f.label}${f.id === 'overdue' && overdue.length ? html` <b>${overdue.length}</b>` : ''}</button>`)}
        <label class=${'fchip select' + (cat ? ' on' : '')}>
          ${cat ? (store.category(cat) || {}).name || 'Categoría' : 'Categoría'} <${Icon} name="down" size=${14} />
          <select value=${cat} onChange=${(e) => onCat(e.target.value)}>
            <option value="">Todas las categorías</option>
            ${store.state.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
          </select>
        </label>
      </div>
      ${body}
    </div>
  `;
}
