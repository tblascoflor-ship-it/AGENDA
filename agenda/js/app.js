// Punto de entrada: navegación, capas y arranque.

import { html, render, useState, useEffect, useReducer } from './vendor/preact-htm.js';
import * as D from './shared/dates.js';
import * as M from './shared/model.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { ui, onUi, Icon, Menu, menu, dismissToast, setClock, closeAll } from './ui/common.js';
import { Home } from './ui/home.js';
import { Calendar } from './ui/calendar.js';
import { Tasks } from './ui/tasks.js';
import { Settings, CategoryEditor } from './ui/settings.js';
import { Editor } from './ui/editor.js';
import { Detail, Reschedule, Search, openEditor } from './ui/detail.js';

const TABS = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'calendar', label: 'Calendario', icon: 'calendar' },
  { id: 'tasks', label: 'Tareas', icon: 'tasks' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
];
const LAYERS = { editor: Editor, detail: Detail, reschedule: Reschedule, search: Search, category: CategoryEditor, menu: Menu };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0e1014' : '#f1f3f6'));
}

// Fecha indicada en la dirección (#d=AAAA-MM-DD), p. ej. al tocar una notificación
function linkedDate() {
  const m = location.hash.match(/d=(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function App() {
  const [, force] = useReducer((x) => x + 1, 0);
  const [tab, setTab] = useState('home');
  const [calView, setCalView] = useState('day');
  const [calDate, setCalDate] = useState(ui.today);
  const [filter, setFilter] = useState('pending');
  const [cat, setCat] = useState('');

  useEffect(() => {
    const offs = [store.subscribe(force), onUi(force)];
    const openLinked = () => {
      const d = linkedDate();
      if (!d) return;
      closeAll();
      setCalDate(d);
      setCalView('day');
      setTab('calendar');
      history.replaceState(null, '', location.pathname + location.search);
    };
    openLinked();
    window.addEventListener('hashchange', openLinked);
    const onMsg = (e) => {
      if (e.data && e.data.type === 'open' && e.data.url) {
        const m = String(e.data.url).match(/d=(\d{4}-\d{2}-\d{2})/);
        if (m) {
          location.hash = `d=${m[1]}`;
        }
      }
    };
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onMsg);
    return () => offs.forEach((f) => f());
  }, []);

  // Número en el icono de la app: tareas de hoy y atrasadas
  const badge = M.overview(store.state.items, ui.today).badge;
  useEffect(() => {
    try {
      if (badge > 0 && navigator.setAppBadge) navigator.setAppBadge(badge);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) {}
  }, [badge]);

  const go = (t, f) => {
    if (f) setFilter(f);
    setTab(t);
  };
  const add = () => {
    const date = tab === 'calendar' ? calDate : ui.today;
    const label = date === ui.today ? '' : `Para el ${D.fmtLong(date)}`;
    menu(label, [
      { label: 'Nueva actividad', run: () => openEditor({ kind: 'event', date }) },
      { label: 'Nueva tarea', run: () => openEditor({ kind: 'task', date }) },
      { label: 'Nuevo recordatorio', run: () => openEditor({ kind: 'reminder', date }) },
    ]);
  };
  const setTheme = (theme) => {
    applyTheme(theme);
    store.setMeta({ theme });
  };
  const showInstall = tab === 'home' && sync.isIOS() && !sync.isStandalone() && !store.state.meta.installDismissed;

  return html`
    <main class="screen">
      ${tab === 'home' &&
      html`<${Home} onGo=${go} />`}
      ${tab === 'calendar' && html`<${Calendar} view=${calView} date=${calDate} onView=${setCalView} onDate=${setCalDate} />`}
      ${tab === 'tasks' && html`<${Tasks} filter=${filter} onFilter=${setFilter} cat=${cat} onCat=${setCat} />`}
      ${tab === 'settings' && html`<${Settings} onTheme=${setTheme} />`}
      ${tab !== 'settings' && html`<button class="fab" aria-label="Añadir" onClick=${add}><${Icon} name="plus" size=${28} stroke=${2.4} /></button>`}
    </main>
    <nav class="tabbar" aria-label="Secciones">
      ${TABS.map(
        (t) => html`<button key=${t.id} class=${tab === t.id ? 'on' : ''} aria-current=${tab === t.id ? 'page' : null} onClick=${() => (tab === t.id && t.id === 'calendar' ? setCalDate(ui.today) : setTab(t.id))}>
          <${Icon} name=${t.icon} size=${24} stroke=${tab === t.id ? 2.1 : 1.8} />
          ${t.label}
          ${t.id === 'tasks' && badge > 0 && html`<span class="tab-badge">${badge > 99 ? '99+' : badge}</span>`}
        </button>`
      )}
    </nav>
    ${showInstall &&
    html`<div class="toast top">
      <span>Para instalarla: pulsa Compartir y «Añadir a pantalla de inicio».</span>
      <button onClick=${() => store.setMeta({ installDismissed: true })}>Entendido</button>
    </div>`}
    ${ui.layers.map((l) => {
      const C = LAYERS[l.type];
      return C ? html`<${C} key=${l.key} layer=${l} />` : null;
    })}
    ${ui.toast &&
    html`<div class="toast" key=${ui.toast.key} role="status">
      <span>${ui.toast.text}</span>
      ${ui.toast.action && html`<button onClick=${() => (ui.toast.action.run(), dismissToast())}>${ui.toast.action.label}</button>`}
    </div>`}
  `;
}

async function start() {
  const root = document.getElementById('app');
  try {
    await store.init();
  } catch (e) {
    root.innerHTML = `<div class="boot"><p><strong>No se pudo abrir el almacenamiento del dispositivo.</strong><br>Si estás en navegación privada, sal de ella y vuelve a abrir la agenda.<br><small>${String((e && e.message) || e)}</small></p></div>`;
    return;
  }
  applyTheme(store.state.meta.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.state.meta.theme));
  root.textContent = '';
  render(html`<${App} />`, root);

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {}
  }

  store.setChangeHook(() => sync.scheduleSync());
  const wake = () => {
    setClock();
    if (document.visibilityState === 'visible') sync.scheduleSync(200);
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', () => sync.syncNow());
  window.addEventListener('focus', wake);
  setInterval(setClock, 15000);
  setInterval(() => document.visibilityState === 'visible' && sync.syncNow(), 5 * 60000);
  if (sync.configured()) {
    sync.syncNow();
    sync.ensureSubscription();
  }
}

start();
