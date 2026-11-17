// Mejoras de la versión 1.1: captura rápida, buscar hueco, estadísticas e
// importación de calendarios.

import { html, useState, useRef, useEffect, useMemo } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import * as M from '../shared/model.js';
import { parseQuick } from '../shared/quick.js';
import { freeSlots } from '../shared/slots.js';
import { computeStats } from '../shared/stats.js';
import { parseICS } from '../shared/icsimport.js';
import { reminderLabel } from '../shared/reminders.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { Sheet, Icon, Empty, Segmented, openLayer, closeLayer, toast, ui } from './common.js';


// ---------- Captura rápida ----------

const EXAMPLES = ['Entregar trabajo jueves 23:59 urgente', 'Gimnasio mañana de 17 a 18', 'Estudiar inglés todos los lunes a las 19, avísame 15 min antes'];

// Convierte lo interpretado en los campos de un elemento del tipo elegido
function quickFields(r, kind) {
  const f = { kind, title: r.title, notes: '', categoryId: '', date: r.date, repeat: r.repeat, reminders: r.reminders.slice() };
  const t = r.start || r.time;
  if (kind === 'event') {
    if (!t) Object.assign(f, { allDay: true, start: '', end: '' });
    else Object.assign(f, { allDay: false, start: t, end: r.end || D.minToHM(Math.min(D.hmToMin(t) + 60, 1439)) });
    if (!f.reminders.length && t) f.reminders = [{ t: 'rel', min: 15 }];
  } else if (kind === 'task') {
    Object.assign(f, { time: t || '', priority: r.priority });
  } else {
    Object.assign(f, { time: t || D.minToHM(Math.min(23 * 60, Math.ceil((D.hmToMin(ui.now) + 1) / 60) * 60)) });
    if (!f.reminders.length) f.reminders = [{ t: 'rel', min: 0 }];
  }
  return f;
}

export function QuickAdd({ layer }) {
  const [text, setText] = useState('');
  const [forced, setForced] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    setTimeout(() => ref.current && ref.current.focus(), 350);
  }, []);
  const r = useMemo(() => {
    const p = parseQuick(text, ui.today, ui.now);
    if (layer.date && !p.found.includes('date') && !p.repeat) p.date = layer.date; // día abierto en el calendario
    return p;
  }, [text, ui.today]);
  const kind = forced || r.kind;
  const f = quickFields(r, kind);
  const valid = r.title.length > 0;
  const chips = [D.fmtRel(f.date, ui.today)];
  if (kind === 'event') chips.push(f.allDay ? 'Todo el día' : `${f.start}–${f.end}`);
  else if (f.time) chips.push(f.time);
  if (kind === 'task' && f.priority !== 'medium') chips.push(`Prioridad ${M.prioLabel(f.priority).toLowerCase()}`);
  if (f.repeat) chips.push(M.repeatLabel(f.repeat, f.date, ui.today));
  for (const x of f.reminders) chips.push(`Aviso: ${reminderLabel(x, ui.today).toLowerCase()}`);

  const save = async () => {
    if (!valid) return;
    await actions.create(f);
    closeLayer();
    toast({ event: 'Actividad guardada', task: 'Tarea guardada', reminder: 'Recordatorio guardado' }[kind]);
  };
  const more = () => {
    closeLayer();
    openLayer({ type: 'editor', kind, date: f.date, preset: f });
  };
  return html`
    <${Sheet} title="Escribir rápido" left="Cancelar" right="Guardar" rightDisabled=${!valid} onLeft=${() => closeLayer()} onRight=${save}>
      <div class="group">
        <input ref=${ref} class="field title-field" type="text" placeholder="Qué, cuándo y a qué hora" value=${text} enterkeyhint="done" maxlength="200"
          onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
      </div>
      ${valid
        ? html`
            <div class="group">
              <div class="cell stack">
                <span>He entendido</span>
                <strong class="quick-title">${r.title}</strong>
                <div class="chips">${chips.map((c) => html`<span class="chip">${c}</span>`)}</div>
                <${Segmented} value=${kind} onChange=${setForced} options=${[{ id: 'task', label: 'Tarea' }, { id: 'event', label: 'Actividad' }, { id: 'reminder', label: 'Recordatorio' }]} />
              </div>
              <button class="cell-btn" onClick=${more}><${Icon} name="edit" size=${18} /> Más opciones</button>
            </div>
          `
        : html`<div class="group">
            <div class="cell stack">
              <span>Ejemplos</span>
              ${EXAMPLES.map((x) => html`<button class="example" onClick=${() => (setText(x), ref.current && ref.current.focus())}>${x}</button>`)}
            </div>
            <p class="note">Entiende fechas (mañana, el jueves, 19/11, en 3 días), horas y franjas (a las 17:30, de 17 a 19), repeticiones (cada día, todos los lunes), prioridad (urgente, importante) y avisos (avísame 1 hora antes).</p>
          </div>`}
    <//>
  `;
}

// ---------- Buscar hueco ----------

const DURATIONS = [30, 60, 90, 120, 180];

export function FindSlot({ layer }) {
  const item = store.get(layer.id);
  const [duration, setDuration] = useState(60);
  const inst = item ? M.instance(item, M.isRecurring(item) ? layer.key0 : item.date) : { date: ui.today, title: '', categoryId: '' };
  const today = ui.today;
  const to = inst.date > today ? (D.diffDays(today, inst.date) > 13 ? D.addDays(today, 13) : inst.date) : D.addDays(today, 6);
  const slots = useMemo(() => freeSlots(store.state.items, { from: today, to, duration, today, nowMin: D.hmToMin(ui.now), perDay: 3, max: 14 }), [store.state.version, duration, today, to, ui.now]);
  const book = async (s) => {
    const ev = await actions.create({
      kind: 'event',
      title: inst.title,
      notes: `Tiempo reservado para la tarea «${inst.title}».`,
      categoryId: inst.categoryId,
      date: s.date,
      allDay: false,
      start: D.minToHM(s.s),
      end: D.minToHM(s.e),
      repeat: null,
      reminders: [{ t: 'rel', min: 15 }],
    });
    closeLayer();
    toast(`Hueco reservado: ${D.fmtRel(s.date, today).toLowerCase()}, ${D.minToHM(s.s)}–${D.minToHM(s.e)}`, { label: 'Deshacer', run: () => store.remove([ev.id]) });
  };
  if (!item) return null;
  const groups = [];
  for (const s of slots) {
    const g = groups[groups.length - 1];
    if (g && g.date === s.date) g.list.push(s);
    else groups.push({ date: s.date, list: [s] });
  }
  return html`
    <${Sheet} title="Buscar hueco" left="Cerrar" onLeft=${() => closeLayer()} tall>
      <p class="lead">${inst.title}. Franjas libres entre tus actividades, de 8:00 a 22:00${inst.date > today ? `, hasta ${D.fmtRel(to, today).toLowerCase()}` : ''}.</p>
      <div class="group">
        <div class="cell stack">
          <span>Duración</span>
          <div class="chips">${DURATIONS.map((d) => html`<button class=${'chip pick' + (d === duration ? ' on' : '')} aria-pressed=${d === duration} onClick=${() => setDuration(d)}>${D.fmtDuration(d)}</button>`)}</div>
        </div>
      </div>
      ${groups.length === 0 && html`<${Empty} title="Sin huecos de esa duración" text="Prueba con menos tiempo o libera alguna franja del calendario." />`}
      ${groups.map(
        (g) => html`<h4 class="sec" key=${g.date}>${D.fmtRel(g.date, today)} <span class="h-sub">${D.parse(g.date).d} ${D.MESES_CORTO[D.parse(g.date).m - 1]}</span></h4>
          <div class="group">
            ${g.list.map(
              (s) => html`<button class="cell-btn between" key=${s.date + s.s} onClick=${() => book(s)}>
                <span><${Icon} name="clock" size=${18} /> ${D.minToHM(s.s)}–${D.minToHM(s.e)}</span>
                <em>${s.until - s.e > 0 ? `libre hasta las ${s.until === 1440 ? '24:00' : D.minToHM(s.until)}` : 'justo'}</em>
              </button>`
            )}
          </div>`
      )}
    <//>
  `;
}

// ---------- Estadísticas ----------

export function Stats() {
  const today = ui.today;
  const s = useMemo(() => computeStats(store.state.items, today), [store.state.version, today]);
  const [pick, setPick] = useState(6);
  const max = Math.max(1, ...s.last7.map((d) => d.n));
  const sel = s.last7[pick];
  const totalMin = s.hours.reduce((a, h) => a + h.minutes, 0);
  const maxMin = Math.max(1, ...s.hours.map((h) => h.minutes));
  const tile = (value, label, sub) => html`<div class="tile"><strong>${value}</strong><span>${label}</span>${sub && html`<em>${sub}</em>`}</div>`;
  return html`
    <${Sheet} title="Estadísticas" left="Cerrar" onLeft=${() => closeLayer()} tall>
      <div class="tiles">
        ${tile(s.streak, s.streak === 1 ? 'día de racha' : 'días de racha', 'Días seguidos sin dejar tareas pendientes')}
        ${tile(s.thisWeek, s.thisWeek === 1 ? 'completada esta semana' : 'completadas esta semana', `${s.lastWeek} la semana pasada`)}
        ${tile(s.onTime == null ? '—' : `${s.onTime} %`, 'a tiempo', s.onTime == null ? 'Aún no hay datos' : `De ${s.onTimeBase} en los últimos 30 días`)}
        ${tile(s.pendingNow, s.pendingNow === 1 ? 'pendiente hoy' : 'pendientes hoy', s.overdue ? `${s.overdue} ${s.overdue === 1 ? 'atrasada' : 'atrasadas'}` : 'Ninguna atrasada')}
      </div>

      <h4 class="sec">Tareas completadas, últimos 7 días</h4>
      <div class="group pad">
        <div class="cols" role="group" aria-label="Tareas completadas por día">
          ${s.last7.map(
            (d, i) => html`<button key=${d.date} class=${'colbar' + (i === pick ? ' on' : '')} aria-pressed=${i === pick} aria-label=${`${D.fmtLong(d.date)}: ${d.n}`} onClick=${() => setPick(i)}>
              <span class="colval">${i === pick || d.n === max ? d.n : ''}</span>
              <i style=${`height:${d.n ? Math.max(4, (d.n / max) * 100) : 0}%`}></i>
              <span class="collab">${D.DIAS_LETRA[D.dow(d.date) - 1]}</span>
            </button>`
          )}
        </div>
        <p class="chart-note">${D.cap(D.fmtRel(sel.date, today))}, ${D.parse(sel.date).d} de ${D.MESES[D.parse(sel.date).m - 1]}: ${sel.n} ${sel.n === 1 ? 'tarea completada' : 'tareas completadas'}</p>
      </div>

      <h4 class="sec">Horas por categoría, esta semana</h4>
      ${s.hours.length === 0
        ? html`<p class="quiet">No hay actividades con horario esta semana.</p>`
        : html`<div class="group pad">
            ${s.hours.map((h) => {
              const c = store.category(h.categoryId);
              return html`<div class="hbar" key=${h.categoryId}>
                <div class="hbar-head"><span><i class="dot" style=${`background:${c ? c.color : store.DEFAULT_COLOR}`}></i>${c ? c.name : 'Sin categoría'}</span><b>${D.fmtDuration(h.minutes)}</b></div>
                <div class="hbar-track"><i style=${`width:${Math.max(2, (h.minutes / maxMin) * 100)}%;background:${c ? c.color : store.DEFAULT_COLOR}`}></i></div>
              </div>`;
            })}
            <p class="chart-note">Total: ${D.fmtDuration(totalMin)} de lunes a domingo</p>
          </div>`}
      <p class="note out">${s.totalDone} ${s.totalDone === 1 ? 'tarea completada' : 'tareas completadas'} en total.</p>
    <//>
  `;
}

// ---------- Importar calendario (.ics) ----------

export function IcsImport({ layer }) {
  const [categoryId, setCategoryId] = useState('');
  const [reminder, setReminder] = useState('');
  const [busy, setBusy] = useState(false);
  const info = useMemo(() => parseICS(layer.text), [layer.text]);
  const sample = info.items.slice(0, 5);
  const run = async () => {
    setBusy(true);
    const r = parseICS(layer.text, { categoryId, reminderMin: reminder === '' ? null : +reminder });
    const fresh = r.items.filter((i) => !store.get(i.id) || store.get(i.id).deleted).length;
    const at = new Date().toISOString();
    await store.save(r.items.map((i) => ({ createdAt: at, ...i })));
    closeLayer();
    toast(`Calendario importado: ${fresh} ${fresh === 1 ? 'nueva' : 'nuevas'}, ${r.items.length - fresh} actualizadas`);
  };
  return html`
    <${Sheet} title="Importar calendario" left="Cancelar" right=${info.events ? 'Importar' : null} rightDisabled=${busy} onLeft=${() => closeLayer()} onRight=${run}>
      ${info.events === 0
        ? html`<${Empty} title="No se han encontrado actividades" text="El archivo no parece un calendario .ics con eventos." />`
        : html`
            <p class="lead">${layer.name || 'Archivo'}: ${info.events} ${info.events === 1 ? 'actividad' : 'actividades'}${info.series ? `, ${info.series} de ellas se repiten` : ''}.</p>
            <div class="group">
              ${sample.map((i) => html`<div class="cell info" key=${i.id}><${Icon} name="calendar" size=${18} /><span>${i.title}<br /><em class="hint">${D.fmtShort(i.date, ui.today)}${i.allDay ? '' : ` · ${i.start}–${i.end}`}${i.repeat ? ` · ${M.repeatLabel(i.repeat, i.date, ui.today)}` : ''}</em></span></div>`)}
              ${info.events > sample.length && html`<p class="note">… y ${info.events - sample.length} más.</p>`}
            </div>
            <div class="group">
              <label class="cell"><span>Categoría</span>
                <select value=${categoryId} onChange=${(e) => setCategoryId(e.target.value)}>
                  <option value="">Ninguna</option>
                  ${store.state.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
                </select>
              </label>
              <label class="cell"><span>Aviso</span>
                <select value=${reminder} onChange=${(e) => setReminder(e.target.value)}>
                  <option value="">Sin aviso</option>
                  <option value="0">En el momento</option>
                  <option value="15">15 minutos antes</option>
                  <option value="30">30 minutos antes</option>
                  <option value="60">1 hora antes</option>
                </select>
              </label>
              <p class="note">Si vuelves a importar el mismo calendario, las actividades se actualizan en lugar de duplicarse.${info.unsupported ? ` ${info.unsupported} ${info.unsupported === 1 ? 'serie usa' : 'series usan'} una regla de repetición que la agenda no admite y se ${info.unsupported === 1 ? 'importa' : 'importan'} como actividad única.` : ''}</p>
            </div>
          `}
    <//>
  `;
}
