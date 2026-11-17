// Piezas comunes de la interfaz: iconos, hojas modales, avisos y filas.

import { html, useEffect, useRef } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import * as store from '../store.js';

// ---------- Capas (hojas, menús y avisos breves) ----------
export const ui = { layers: [], toast: null, today: D.todayLocal(), now: D.nowHM() };
const subs = new Set();
export const onUi = (fn) => (subs.add(fn), () => subs.delete(fn));
const emit = () => subs.forEach((fn) => fn());
let seq = 1;
let toastTimer = null;

export function openLayer(layer) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  clearTimeout(toastTimer);
  ui.toast = null; // un aviso breve nunca debe tapar la hoja o el menú que se abre
  ui.layers = ui.layers.concat([{ ...layer, key: seq++ }]);
  emit();
}
export function closeLayer(n = 1) {
  ui.layers = ui.layers.slice(0, Math.max(0, ui.layers.length - n));
  emit();
}
export function closeAll() {
  ui.layers = [];
  emit();
}
export function toast(text, action) {
  clearTimeout(toastTimer);
  ui.toast = { text, action, key: seq++ };
  emit();
  toastTimer = setTimeout(() => {
    ui.toast = null;
    emit();
  }, action ? 6000 : 2600);
}
export function dismissToast() {
  clearTimeout(toastTimer);
  ui.toast = null;
  emit();
}
// Menú de opciones. actions: [{ label, danger, run }]
export const menu = (title, actions, message) => openLayer({ type: 'menu', title, message, actions });
export const confirmDanger = (title, label, run, message) => menu(title, [{ label, danger: true, run }], message);
export function setClock() {
  const t = D.todayLocal();
  const n = D.nowHM();
  if (t !== ui.today || n !== ui.now) {
    ui.today = t;
    ui.now = n;
    emit();
  }
}

// ---------- Iconos ----------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M7 2v3M17 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5z',
  tasks: 'M4 6.5l1.8 1.8L9 5M4 13l1.8 1.8L9 11.5M4 19.5l1.8 1.8L9 18M12.5 7H20M12.5 13.5H20M12.5 20H20',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.6-4.6',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  repeat: 'M17 2l3.5 3.5L17 9M3.5 11V9A3.5 3.5 0 0 1 7 5.5h13.5M7 22l-3.5-3.5L7 15M20.5 13v2a3.5 3.5 0 0 1-3.5 3.5H3.5',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 21h4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.5a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1L17.5 7',
  edit: 'M4 20h4L19.5 8.5a2 2 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  note: 'M5 6h14M5 11h14M5 16h9',
  tag: 'M3.5 12.5V4.5h8l9 9-8 8zM8 9h.01',
  flag: 'M5 21V4M5 4.5h12l-2.5 4.5 2.5 4.5H5',
  undo: 'M8 5L3.5 9.5 8 14M4 9.5h10a6 6 0 0 1 0 12h-3',
  cancel: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM6 6l12 12',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  chart: 'M5 20v-8M12 20V5M19 20v-5',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  list: 'M4 7l1.6 1.6L8.5 5.5M4 16l1.6 1.6L8.5 14.5M12 7h8M12 16h8',
};
export function Icon({ name, size = 22, stroke = 1.8, cls = '' }) {
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name]} /></svg>`;
}

// ---------- Hoja modal ----------
export function Sheet({ title, left, right, onLeft, onRight, rightDisabled, children, tall }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    requestAnimationFrame(() => el && el.classList.add('in'));
  }, []);
  return html`
    <div class="layer" ref=${ref}>
      <div class="scrim" onClick=${onLeft}></div>
      <section class=${'sheet' + (tall ? ' tall' : '')} role="dialog" aria-modal="true" aria-label=${title}>
        <header class="sheet-bar">
          <button class="bar-btn" onClick=${onLeft}>${left || 'Cerrar'}</button>
          <h2>${title}</h2>
          ${right ? html`<button class="bar-btn strong" disabled=${rightDisabled} onClick=${onRight}>${right}</button>` : html`<span class="bar-btn ghost"></span>`}
        </header>
        <div class="sheet-body">${children}</div>
      </section>
    </div>
  `;
}

export function Menu({ layer }) {
  const ref = useRef(null);
  useEffect(() => {
    requestAnimationFrame(() => ref.current && ref.current.classList.add('in'));
  }, []);
  const pick = (a) => {
    closeLayer();
    a.run && a.run();
  };
  return html`
    <div class="layer menu-layer" ref=${ref}>
      <div class="scrim" onClick=${() => closeLayer()}></div>
      <div class="menu" role="dialog" aria-modal="true">
        <div class="menu-group">
          ${(layer.title || layer.message) &&
          html`<div class="menu-head">${layer.title && html`<strong>${layer.title}</strong>`}${layer.message && html`<span>${layer.message}</span>`}</div>`}
          ${layer.actions.map((a) => html`<button class=${'menu-item' + (a.danger ? ' danger' : '')} onClick=${() => pick(a)}>${a.label}</button>`)}
        </div>
        <div class="menu-group"><button class="menu-item cancel" onClick=${() => closeLayer()}>Cancelar</button></div>
      </div>
    </div>
  `;
}

// ---------- Textos ----------
export function overdueText(inst, today) {
  const days = D.diffDays(inst.date, today);
  const since = days === 1 ? 'ayer' : days < 7 ? `el ${D.dayName(inst.date)}` : `el ${D.fmtDayMonth(inst.date, today)}`;
  return { since: `Pendiente desde ${since}`, days: days === 1 ? '1 día' : `${days} días` };
}
export function whenText(inst, today) {
  if (inst.kind === 'event') {
    if (inst.allDay) return 'Todo el día';
    return `${inst.start}–${inst.end}`;
  }
  return inst.time || '';
}

// ---------- Filas ----------
export function Check({ inst, onToggle }) {
  const done = !!inst.doneAt;
  return html`<button
    class=${`check p-${inst.priority}` + (done ? ' on' : '') + (inst.cancelledAt ? ' off' : '')}
    role="checkbox"
    aria-checked=${done}
    aria-label=${done ? 'Marcar como pendiente' : 'Marcar como completada'}
    onClick=${(e) => {
      e.stopPropagation();
      onToggle(inst);
    }}
  >
    ${done && html`<${Icon} name="check" size=${15} stroke=${3} />`}
  </button>`;
}

// Fila de tarea. mode: 'overdue' | 'day' (dentro de un día) | 'list' (muestra fecha) | 'done'
export function TaskRow({ inst, today, mode = 'list', onToggle, onOpen }) {
  const cat = store.category(inst.categoryId);
  const overdue = M.isPending(inst) && inst.date < today;
  const bits = [];
  if (mode === 'done' && inst.doneAt) bits.push(`Completada el ${D.fmtStamp(inst.doneAt, today)}`);
  else if (inst.cancelledAt) bits.push(`Cancelada el ${D.fmtStamp(inst.cancelledAt, today)}`);
  else if (overdue) {
    const t = overdueText(inst, today);
    bits.push(html`<span class="late">${t.since}</span>`, html`<span class="late-days">${t.days}</span>`);
  } else {
    if (mode === 'list') bits.push(D.fmtRel(inst.date, today));
    if (inst.time) bits.push(inst.time);
  }
  if (inst.origDate && inst.origDate !== inst.date && M.isPending(inst)) bits.push(`Fecha original: ${D.fmtDayMonth(inst.origDate, today)}`);
  if (cat) bits.push(html`<span class="cat"><i style=${`background:${cat.color}`}></i>${cat.name}</span>`);
  return html`
    <div class=${`row task p-${inst.priority}` + (inst.doneAt ? ' done' : '') + (inst.cancelledAt ? ' cancelled' : '') + (overdue ? ' overdue' : '')} onClick=${() => onOpen(inst)}>
      <${Check} inst=${inst} onToggle=${onToggle} />
      <div class="row-main">
        <div class="row-title">${inst.title || 'Sin título'}</div>
        <div class="row-meta">
          ${bits.map((b) => html`<span>${b}</span>`)}
          ${inst.subtasks.length > 0 && html`<span class="kind"><${Icon} name="list" size=${13} /> ${inst.subtasks.filter((x) => inst.subDone.includes(x.id)).length}/${inst.subtasks.length}</span>`}
          ${inst.recurring && html`<${Icon} name="repeat" size=${13} />`}
          ${(inst.reminders.length > 0 || inst.nag > 0) && M.isPending(inst) && html`<${Icon} name="bell" size=${13} />`}
        </div>
      </div>
      ${M.isPending(inst) && html`<span class=${`prio p-${inst.priority}`}>${M.prioLabel(inst.priority)}</span>`}
    </div>
  `;
}

// Fila de actividad o recordatorio dentro de un día
export function EventRow({ inst, seg, onOpen, past, now }) {
  const color = store.colorOf(inst.categoryId);
  const cat = store.category(inst.categoryId);
  const reminder = inst.kind === 'reminder';
  const t1 = reminder ? inst.time : inst.allDay ? 'Todo' : seg ? D.minToHM(seg.s) : inst.start;
  const t2 = reminder ? '' : inst.allDay ? 'el día' : seg ? (seg.e === 1440 ? '24:00' : D.minToHM(seg.e)) : inst.end;
  return html`
    <div class=${'row event' + (past ? ' past' : '') + (now ? ' now' : '')} onClick=${() => onOpen(inst)}>
      <div class="time"><b>${t1}</b><span>${t2}</span></div>
      <i class="bar" style=${`background:${color}`}></i>
      <div class="row-main">
        <div class="row-title">${inst.title || 'Sin título'}</div>
        <div class="row-meta">
          ${reminder && html`<span class="kind"><${Icon} name="bell" size=${13} /> Recordatorio</span>`}
          ${cat && html`<span>${cat.name}</span>`}
          ${now && html`<span class="live-tag">En curso</span>`}
          ${inst.recurring && html`<${Icon} name="repeat" size=${13} />`}
        </div>
      </div>
    </div>
  `;
}

export function Empty({ title, text }) {
  return html`<div class="empty"><strong>${title}</strong>${text && html`<span>${text}</span>`}</div>`;
}

export function Segmented({ value, options, onChange, cls = '' }) {
  return html`<div class=${'seg ' + cls} role="tablist">
    ${options.map((o) => html`<button role="tab" aria-selected=${o.id === value} class=${o.id === value ? 'on' : ''} onClick=${() => onChange(o.id)}>${o.label}</button>`)}
  </div>`;
}
