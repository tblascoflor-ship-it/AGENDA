// Calendario: vistas de día, semana y mes.

import { html, useMemo, useRef, useEffect } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { Icon, TaskRow, EventRow, Segmented, openLayer, ui } from './common.js';
import { openDetail, openEditor } from './detail.js';
import { dayRows } from './home.js';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Reparte en columnas las actividades que se solapan
function layout(segs) {
  const out = [];
  let cluster = [];
  let end = -1;
  const flush = () => {
    const n = Math.max(0, ...cluster.map((c) => c.col)) + 1;
    for (const c of cluster) out.push({ ...c, cols: n });
    cluster = [];
  };
  for (const s of segs) {
    if (cluster.length && s.s >= end) flush();
    let col = 0;
    while (cluster.some((c) => c.col === col && c.e > s.s)) col++;
    cluster.push({ ...s, col });
    end = Math.max(end, s.e);
  }
  if (cluster.length) flush();
  return out;
}

const tasksOn = (items, date) => M.sortTasks(M.expandAll(items, date, date, ['task']).filter((t) => !t.cancelledAt));

function swipe(onPrev, onNext) {
  let x = 0;
  let y = 0;
  return {
    onTouchStart: (e) => {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    },
    onTouchEnd: (e) => {
      const dx = e.changedTouches[0].clientX - x;
      const dy = e.changedTouches[0].clientY - y;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 45) (dx > 0 ? onPrev : onNext)();
    },
  };
}

// Columna horaria de un día (compartida por las vistas de día y semana)
function DayColumn({ date, hourH, compact }) {
  const items = store.state.items;
  const seg = useMemo(() => M.daySegments(items, date), [store.state.version, date]);
  const blocks = layout(seg.timed);
  const isToday = date === ui.today;
  const tap = (e) => {
    if (e.target !== e.currentTarget) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((y / hourH) * 60) / 30) * 30));
    openEditor({ kind: 'event', date, start: D.minToHM(min) });
  };
  return html`
    <div class=${'col' + (isToday ? ' today' : '')} style=${`height:${hourH * 24}px`} onClick=${tap}>
      ${blocks.map((b) => {
        const h = Math.max(compact ? 16 : 22, ((b.e - b.s) / 60) * hourH - 2);
        const color = store.colorOf(b.inst.categoryId);
        return html`<button
          key=${b.inst.uid + b.s}
          class=${'ev' + (h < 34 ? ' short' : '') + (b.before ? ' cont-b' : '') + (b.after ? ' cont-a' : '')}
          style=${`top:${(b.s / 60) * hourH}px;height:${h}px;left:calc(${(b.col / b.cols) * 100}% + 1px);width:calc(${100 / b.cols}% - 2px);--c:${color}`}
          onClick=${(e) => (e.stopPropagation(), openDetail(b.inst))}
        >
          <b>${b.inst.title || 'Sin título'}</b>
          ${!compact && h >= 34 && html`<span>${D.minToHM(b.s)}–${b.e === 1440 ? '24:00' : D.minToHM(b.e)}</span>`}
        </button>`;
      })}
      ${seg.points.map(
        (p) => html`<button key=${p.uid} class="pt" style=${`top:${(D.hmToMin(p.time || '00:00') / 60) * hourH - 1}px;--c:${store.colorOf(p.categoryId)}`} onClick=${(e) => (e.stopPropagation(), openDetail(p))}>
          ${!compact && html`<${Icon} name="bell" size=${11} />`}<b>${compact ? '' : `${p.time} `}${p.title}</b>
        </button>`
      )}
      ${isToday && html`<div class="nowbar" style=${`top:${(D.hmToMin(ui.now) / 60) * hourH}px`}><i></i></div>`}
    </div>
  `;
}

function HourLabels({ hourH }) {
  return html`<div class="hours" style=${`height:${hourH * 24}px`}>${HOURS.map((h) => html`<span style=${`top:${h * hourH}px`}>${h === 0 ? '' : D.pad(h) + ':00'}</span>`)}</div>`;
}

function useScrollToNow(ref, hourH, dep) {
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = Math.max(0, ((D.hmToMin(ui.now) - 90) / 60) * hourH);
  }, [dep]);
}

function DayView({ date }) {
  const H = 56;
  const ref = useRef(null);
  useScrollToNow(ref, H, 'day');
  const items = store.state.items;
  const allDay = useMemo(() => M.daySegments(items, date).allDay, [store.state.version, date]);
  const tasks = useMemo(() => tasksOn(items, date), [store.state.version, date]);
  return html`
    <div class="dayview">
      ${(allDay.length > 0 || tasks.length > 0) &&
      html`<div class="allday">
        ${allDay.map((i) => html`<button key=${i.uid} class="ad-chip" style=${`--c:${store.colorOf(i.categoryId)}`} onClick=${() => openDetail(i)}>${i.title}</button>`)}
        ${tasks.length > 0 && html`<div class="card list flat">${tasks.map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${ui.today} mode=${i.doneAt ? 'done' : 'day'} onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}</div>`}
      </div>`}
      <div class="grid-scroll" ref=${ref}>
        <div class="grid" style=${`--h:${H}px`}>
          <${HourLabels} hourH=${H} />
          <${DayColumn} date=${date} hourH=${H} />
        </div>
      </div>
    </div>
  `;
}

function WeekView({ date, onDay }) {
  const H = 46;
  const ref = useRef(null);
  useScrollToNow(ref, H, 'week');
  const start = D.startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(start, i));
  const items = store.state.items;
  const info = useMemo(
    () =>
      days.map((d) => {
        const tasks = tasksOn(items, d).filter((t) => !t.doneAt);
        const top = tasks.slice().sort((a, b) => M.prioRank(a.priority) - M.prioRank(b.priority))[0];
        return { tasks: tasks.length, prio: top && top.priority, allDay: M.daySegments(items, d).allDay };
      }),
    [store.state.version, start]
  );
  return html`
    <div class="weekview">
      <div class="week-head">
        <span class="gutter"></span>
        ${days.map(
          (d, i) => html`<button key=${d} class=${'wd' + (d === ui.today ? ' today' : '') + (d === date ? ' sel' : '')} onClick=${() => onDay(d)} aria-label=${D.fmtLong(d)}>
            <span>${D.DIAS_LETRA[i]}</span><b>${D.parse(d).d}</b>
            <em class=${info[i].tasks ? `p-${info[i].prio}` : ''}>${info[i].tasks || ''}</em>
          </button>`
        )}
      </div>
      ${info.some((x) => x.allDay.length) &&
      html`<div class="week-allday">
        <span class="gutter"></span>
        ${info.map((x, i) => html`<div key=${days[i]}>${x.allDay.map((a) => html`<button key=${a.uid} class="ad-mini" style=${`--c:${store.colorOf(a.categoryId)}`} onClick=${() => openDetail(a)}>${a.title}</button>`)}</div>`)}
      </div>`}
      <div class="grid-scroll" ref=${ref}>
        <div class="grid week" style=${`--h:${H}px`}>
          <${HourLabels} hourH=${H} />
          ${days.map((d) => html`<${DayColumn} key=${d} date=${d} hourH=${H} compact />`)}
        </div>
      </div>
    </div>
  `;
}

function MonthView({ date, onSelect, onDay }) {
  const first = D.startOfMonth(date);
  const gridStart = D.startOfWeek(first);
  const p = D.parse(date);
  const weeks = Math.ceil((D.diffDays(gridStart, first) + D.daysInMonth(p.y, p.m)) / 7);
  const gridEnd = D.addDays(gridStart, weeks * 7 - 1);
  const items = store.state.items;
  const marks = useMemo(() => {
    const map = {};
    const at = (d) => map[d] || (map[d] = { ev: [], tk: [] });
    for (const i of M.expandAll(items, gridStart, gridEnd, ['event', 'reminder'])) {
      const c = store.colorOf(i.categoryId);
      if (!at(i.date).ev.includes(c)) at(i.date).ev.push(c);
    }
    for (const i of M.expandAll(items, gridStart, gridEnd, ['task'])) if (!i.cancelledAt) at(i.date).tk.push(i);
    return map;
  }, [store.state.version, gridStart, gridEnd]);
  const seg = useMemo(() => M.daySegments(items, date), [store.state.version, date]);
  const rows = dayRows(seg);
  const tasks = useMemo(() => tasksOn(items, date), [store.state.version, date]);

  return html`
    <div class="monthview">
      <div class="month-names">${D.DIAS_LETRA.map((l) => html`<span>${l}</span>`)}</div>
      <div class="month-grid" style=${`grid-template-rows:repeat(${weeks},1fr)`}>
        ${Array.from({ length: weeks * 7 }, (_, i) => {
          const d = D.addDays(gridStart, i);
          const m = marks[d];
          const pend = m ? m.tk.filter((t) => !t.doneAt).sort((a, b) => M.prioRank(a.priority) - M.prioRank(b.priority)) : [];
          const doneOnly = m && m.tk.length > 0 && pend.length === 0;
          return html`<button key=${d} class=${'mday' + (D.parse(d).m !== p.m ? ' out' : '') + (d === ui.today ? ' today' : '') + (d === date ? ' sel' : '')} onClick=${() => onSelect(d)} aria-label=${D.fmtLong(d)}>
            <b>${D.parse(d).d}</b>
            <span class="marks">
              ${m && m.ev.slice(0, 3).map((c) => html`<i style=${`background:${c}`}></i>`)}
              ${pend.slice(0, 2).map((t) => html`<i class=${`sq p-${t.priority}`}></i>`)}
              ${doneOnly && html`<i class="sq done"></i>`}
            </span>
          </button>`;
        })}
      </div>
      <div class="month-day">
        <div class="month-day-head">
          <h3>${D.cap(D.fmtLong(date))}</h3>
          <button class="link" onClick=${() => onDay(date)}>Ver el día</button>
        </div>
        ${rows.length + tasks.length === 0
          ? html`<p class="quiet">Nada este día. Pulsa + para añadir.</p>`
          : html`<div class="card list">
              ${rows.map((r) => html`<${EventRow} key=${r.key} inst=${r.inst} seg=${r.seg} onOpen=${openDetail} />`)}
              ${tasks.map((i) => html`<${TaskRow} key=${i.uid} inst=${i} today=${ui.today} mode=${i.doneAt ? 'done' : 'day'} onToggle=${actions.toggleDone} onOpen=${openDetail} />`)}
            </div>`}
      </div>
    </div>
  `;
}

export function Calendar({ view, date, onView, onDate }) {
  const today = ui.today;
  const step = (n) => onDate(view === 'day' ? D.addDays(date, n) : view === 'week' ? D.addDays(date, 7 * n) : D.addMonths(D.startOfMonth(date), n));
  const sw = swipe(() => step(-1), () => step(1));
  let title;
  let sub = '';
  if (view === 'day') {
    title = D.cap(D.fmtRel(date, today));
    sub = D.fmtLong(date, D.parse(date).y !== D.parse(today).y);
  } else if (view === 'week') {
    const a = D.startOfWeek(date);
    const b = D.addDays(a, 6);
    title = D.fmtMonthYear(D.addDays(a, 3));
    sub = `Semana ${D.isoWeek(date)} · del ${D.parse(a).d}${D.parse(a).m !== D.parse(b).m ? ' ' + D.MESES_CORTO[D.parse(a).m - 1] : ''} al ${D.parse(b).d} ${D.MESES_CORTO[D.parse(b).m - 1]}`;
  } else {
    title = D.fmtMonthYear(date);
  }
  const atToday = view === 'day' ? date === today : view === 'week' ? D.startOfWeek(date) === D.startOfWeek(today) : date === today;

  return html`
    <div class="view calendar">
      <header class="top cal-top">
        <div>
          <h1>${title}</h1>
          ${sub && html`<p class="sub">${sub}</p>`}
        </div>
        <div class="top-actions">
          <button class="icon-btn" aria-label="Buscar" onClick=${() => openLayer({ type: 'search' })}><${Icon} name="search" /></button>
        </div>
      </header>
      <div class="cal-bar">
        <${Segmented} value=${view} onChange=${onView} options=${[{ id: 'day', label: 'Día' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' }]} />
        <div class="nav">
          <button class="icon-btn sm" aria-label="Anterior" onClick=${() => step(-1)}><${Icon} name="left" size=${20} /></button>
          <button class="today-btn" disabled=${atToday} onClick=${() => onDate(today)}>Hoy</button>
          <button class="icon-btn sm" aria-label="Siguiente" onClick=${() => step(1)}><${Icon} name="right" size=${20} /></button>
        </div>
      </div>
      <div class="cal-body" ...${sw}>
        ${view === 'day' && html`<${DayView} date=${date} />`}
        ${view === 'week' && html`<${WeekView} date=${date} onDay=${(d) => (onDate(d), onView('day'))} />`}
        ${view === 'month' && html`<${MonthView} date=${date} onSelect=${onDate} onDay=${(d) => (onDate(d), onView('day'))} />`}
      </div>
    </div>
  `;
}
