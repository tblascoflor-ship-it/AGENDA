// Ajustes: notificaciones, servidor, apariencia, categorías y copias de seguridad.

import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import * as D from '../shared/dates.js';
import { buildICS } from '../shared/ics.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import { Sheet, Icon, Segmented, openLayer, closeLayer, toast, confirmDanger, ui } from './common.js';

export const APP_VERSION = '1.0.0';

async function deliver(name, text, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && sync.isIOS()) {
      await navigator.share({ files: [file] }); // en iPhone: «Guardar en Archivos»
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (e) {
    window.prompt('Copia este texto:', text);
  }
}

function Notifications({ info, subscribed, refresh }) {
  const st = sync.pushStatus();
  const [busy, setBusy] = useState('');
  const run = async (name, fn) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(e.message || 'No se pudo completar');
    }
    setBusy('');
    refresh();
  };
  let status;
  let tone = '';
  if (!sync.configured()) status = 'Conecta primero el servidor (más abajo). Sin él, la agenda funciona pero no puede avisarte con la app cerrada.';
  else if (st.ios && !st.standalone) status = 'En iPhone los avisos solo funcionan con la agenda instalada: en Safari pulsa Compartir › Añadir a pantalla de inicio y ábrela desde su icono.';
  else if (!st.supported) status = 'Este navegador no admite notificaciones push.';
  else if (st.permission === 'denied') status = 'Las notificaciones están bloqueadas. Actívalas en Ajustes del iPhone › Notificaciones › Agenda.';
  else if (subscribed && st.permission === 'granted') {
    status = 'Activadas en este dispositivo.';
    tone = 'ok';
  } else status = 'Todavía no están activadas en este dispositivo.';
  const canEnable = sync.configured() && st.supported && st.permission !== 'denied';
  const stale = info && info.lastTick && info.now - info.lastTick > 4 * 60000;
  const never = info && !info.lastTick;

  const test = () =>
    run('test', async () => {
      const r = await sync.sendTest(0);
      if (r.ok) toast('Enviada. Debería aparecer en unos segundos.');
      else if (!r.subs) toast('No hay ningún dispositivo suscrito. Activa primero las notificaciones.');
      else toast(`El servicio push respondió ${r.results.map((x) => x.status || 'sin conexión').join(', ')}. ${r.results[0].detail || ''}`);
    });
  const later = () =>
    run('later', async () => {
      const r = await sync.sendTest(60);
      const t = new Date(r.scheduledFor);
      toast(`Programado para las ${D.nowHM(t)}. Cierra la app y espera.`);
    });

  return html`
    <section class="block">
      <h2>Notificaciones</h2>
      <div class="card">
        <p class=${'status ' + tone}>${status}</p>
        ${canEnable &&
        !(subscribed && st.permission === 'granted') &&
        html`<button class="cell-btn primary" disabled=${busy === 'on'} onClick=${() => run('on', sync.enablePush)}><${Icon} name="bell" size=${18} /> Activar notificaciones</button>`}
        ${subscribed &&
        st.permission === 'granted' &&
        html`
          <button class="cell-btn" disabled=${busy === 'test'} onClick=${test}>Enviar notificación de prueba</button>
          <button class="cell-btn" disabled=${busy === 'later'} onClick=${later}>Programar aviso de prueba (≈1 minuto)</button>
          <button class="cell-btn" onClick=${() => confirmDanger('¿Desactivar los avisos en este dispositivo?', 'Desactivar', () => run('off', sync.disablePush))}>Desactivar en este dispositivo</button>
        `}
        ${(stale || never) &&
        html`<p class="status warn">${never ? 'El servidor aún no ha ejecutado su tarea programada.' : 'El servidor lleva varios minutos sin ejecutar su tarea programada.'} Revisa que el Worker tenga el Cron Trigger «* * * * *».</p>`}
      </div>
      ${sync.configured() &&
      html`<div class="card">
        <label class="cell"><span>Resumen diario</span><input type="checkbox" class="switch" checked=${!!store.state.settings.digestOn} onChange=${(e) => store.save([{ ...store.state.settings, digestOn: e.target.checked }])} /></label>
        ${store.state.settings.digestOn &&
        html`<label class="cell"><span>Hora</span><input type="time" value=${store.state.settings.digestTime || '07:30'} onChange=${(e) => e.target.value && store.save([{ ...store.state.settings, digestTime: e.target.value }])} /></label>`}
        <p class="note">Un aviso cada mañana con tus actividades, las tareas del día y las atrasadas.</p>
      </div>`}
      ${info &&
      info.next &&
      info.next.length > 0 &&
      html`<div class="card">
        <div class="cell stack">
          <span>Próximos avisos programados</span>
          <ul class="history">${info.next.map((n) => html`<li><b>${n.title}</b><span>${D.fmtStamp(new Date(n.fireAt).toISOString(), ui.today)}</span></li>`)}</ul>
        </div>
      </div>`}
    </section>
  `;
}

function Server({ info, refresh }) {
  const meta = store.state.meta;
  const [url, setUrl] = useState(meta.serverUrl);
  const [token, setToken] = useState(meta.token);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => sync.onNet(() => tick((x) => x + 1)), []);
  const connected = sync.configured();
  const connect = async () => {
    setBusy(true);
    try {
      await sync.connect(url, token);
      toast('Servidor conectado');
      sync.ensureSubscription();
    } catch (e) {
      toast(e.status === 401 ? 'Clave incorrecta' : e.name === 'TypeError' ? 'No se pudo contactar con esa dirección' : e.message);
    }
    setBusy(false);
    refresh();
  };
  const st = store.stats();
  const label = { off: 'Sin servidor', idle: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Sin conexión: los cambios se enviarán al volver Internet', error: `Error: ${sync.net.error}` }[sync.net.status];
  return html`
    <section class="block">
      <h2>Servidor y sincronización</h2>
      <div class="card">
        ${connected
          ? html`
              <p class=${'status ' + (sync.net.status === 'idle' ? 'ok' : sync.net.status === 'error' ? 'warn' : '')}>
                ${label}${meta.lastSync ? ` · última vez ${D.fmtStamp(new Date(meta.lastSync).toISOString(), ui.today)}` : ''}${st.dirty ? ` · ${st.dirty} ${st.dirty === 1 ? 'cambio pendiente' : 'cambios pendientes'}` : ''}
              </p>
              <div class="cell info"><span class="mono">${meta.serverUrl.replace(/^https:\/\//, '')}</span></div>
              <button class="cell-btn" onClick=${() => sync.syncNow().then(refresh)}>Sincronizar ahora</button>
              <button class="cell-btn" onClick=${() => confirmDanger('¿Desconectar el servidor?', 'Desconectar', () => sync.disconnect().then(refresh), 'Tus datos siguen en este dispositivo, pero dejarán de copiarse y no recibirás avisos.')}>Desconectar</button>
            `
          : html`
              <p class="status">Tus datos se guardan en este dispositivo. Conecta tu servidor privado para tener copia remota y recibir avisos.</p>
              <input class="field" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck=${false} placeholder="https://agenda-push.tu-cuenta.workers.dev" value=${url} onInput=${(e) => setUrl(e.target.value)} />
              <input class="field" type="password" autocapitalize="off" autocorrect="off" placeholder="Clave privada" value=${token} onInput=${(e) => setToken(e.target.value)} />
              <button class="cell-btn primary" disabled=${busy || !url.trim() || !token.trim()} onClick=${connect}>${busy ? 'Conectando…' : 'Conectar'}</button>
            `}
      </div>
    </section>
  `;
}

function Backup({ info }) {
  const fileRef = useRef(null);
  const today = ui.today;
  const exportJson = () => deliver(`agenda-copia-${today}.json`, JSON.stringify(store.exportData()), 'application/json');
  const exportIcs = () => deliver(`agenda-${today}.ics`, buildICS(store.state.items), 'text/calendar');
  const importJson = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await store.importData(JSON.parse(await file.text()));
      toast(`Copia importada: ${r.added} nuevos, ${r.updated} actualizados, ${r.skipped} ya existían`);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'El archivo no es un JSON válido.' : err.message);
    }
  };
  return html`
    <section class="block">
      <h2>Copia de seguridad</h2>
      <div class="card">
        <button class="cell-btn" onClick=${exportJson}>Exportar todos mis datos (JSON)</button>
        <button class="cell-btn" onClick=${() => fileRef.current.click()}>Importar una copia</button>
        <input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${importJson} />
        <p class="note">Al importar no se duplica nada: cada elemento se reconoce por su identificador y solo se sustituye si la copia es más reciente.</p>
      </div>
      <div class="card">
        <button class="cell-btn" onClick=${exportIcs}>Exportar calendario (.ics)</button>
        ${info && info.feedUrl && html`<button class="cell-btn" onClick=${() => copy(info.feedUrl.replace(/^https:/, 'webcal:'), 'Enlace copiado')}>Copiar enlace de suscripción</button>`}
        <p class="note">${info && info.feedUrl ? 'Con el enlace de suscripción, el Calendario de Apple muestra tu agenda (también en su widget) y se actualiza solo. Trátalo como una contraseña.' : 'El archivo .ics se puede abrir con el Calendario de Apple.'}</p>
      </div>
      ${info &&
      html`<div class="card">
        <button class="cell-btn" onClick=${() => copy(store.state.meta.serverUrl + '/api/hoy', 'Dirección copiada')}>Copiar dirección para Atajos</button>
        <p class="note">Para un atajo de iOS que lea tu resumen del día. Los pasos están en la guía de instalación.</p>
      </div>`}
    </section>
  `;
}

export function CategoryEditor({ layer }) {
  const existing = layer.id ? store.category(layer.id) : null;
  const [name, setName] = useState(existing ? existing.name : '');
  const [color, setColor] = useState(existing ? existing.color : store.CATEGORY_COLORS[store.state.categories.length % store.CATEGORY_COLORS.length]);
  const save = async () => {
    if (!name.trim()) return;
    await store.save([{ ...(existing || { id: store.uid(), kind: 'category', order: store.state.categories.length }), name: name.trim().slice(0, 40), color }]);
    closeLayer();
  };
  return html`
    <${Sheet} title=${existing ? 'Editar categoría' : 'Nueva categoría'} left="Cancelar" right="Guardar" rightDisabled=${!name.trim()} onLeft=${() => closeLayer()} onRight=${save}>
      <div class="group"><input class="field title-field" type="text" placeholder="Nombre" value=${name} onInput=${(e) => setName(e.target.value)} maxlength="40" /></div>
      <div class="group">
        <div class="cell stack">
          <span>Color</span>
          <div class="swatches">${store.CATEGORY_COLORS.map((c) => html`<button key=${c} class=${c === color ? 'on' : ''} style=${`background:${c}`} aria-label=${`Color ${c}`} aria-pressed=${c === color} onClick=${() => setColor(c)}></button>`)}</div>
        </div>
      </div>
      ${existing &&
      html`<div class="group">
        <button class="cell-btn danger" onClick=${() => confirmDanger('¿Eliminar esta categoría?', 'Eliminar', () => store.remove([existing.id]).then(() => closeLayer()), 'Las actividades y tareas que la usan no se borran; quedan sin categoría.')}>
          <${Icon} name="trash" size=${18} /> Eliminar categoría
        </button>
      </div>`}
    <//>
  `;
}

export function Settings({ onTheme }) {
  const [info, setInfo] = useState(sync.net.info);
  const [subscribed, setSubscribed] = useState(false);
  const [n, setN] = useState(0);
  const refresh = () => setN((x) => x + 1);
  useEffect(() => {
    let live = true;
    sync.hasSubscription().then((v) => live && setSubscribed(v));
    sync.loadInfo().then((i) => live && setInfo(i));
    return () => (live = false);
  }, [n, store.state.meta.serverUrl]);
  const st = store.stats();
  const theme = store.state.meta.theme || 'auto';
  const update = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) {}
    location.reload();
  };
  return html`
    <div class="view settings">
      <header class="top"><div><h1>Ajustes</h1></div></header>
      <${Notifications} info=${info} subscribed=${subscribed} refresh=${refresh} />
      <${Server} info=${info} refresh=${refresh} />
      <section class="block">
        <h2>Apariencia</h2>
        <div class="card pad">
          <${Segmented} value=${theme} onChange=${onTheme} options=${[{ id: 'auto', label: 'Automática' }, { id: 'light', label: 'Clara' }, { id: 'dark', label: 'Oscura' }]} />
        </div>
      </section>
      <section class="block">
        <h2>Categorías</h2>
        <div class="card">
          ${store.state.categories.map((c) => html`<button key=${c.id} class="cell-btn between" onClick=${() => openLayer({ type: 'category', id: c.id })}><span><i class="dot" style=${`background:${c.color}`}></i>${c.name}</span><${Icon} name="chevron" size=${16} /></button>`)}
          <button class="cell-btn" onClick=${() => openLayer({ type: 'category' })}><${Icon} name="plus" size=${18} /> Añadir categoría</button>
        </div>
      </section>
      <${Backup} info=${info} />
      <section class="block">
        <h2>Acerca de</h2>
        <div class="card">
          <div class="cell info between"><span>Elementos guardados</span><em>${st.total}</em></div>
          <div class="cell info between"><span>Almacenamiento protegido</span><em>${store.state.persisted === true ? 'Sí' : store.state.persisted === false ? 'No concedido' : 'Desconocido'}</em></div>
          <div class="cell info between"><span>Versión</span><em>${APP_VERSION}</em></div>
          <button class="cell-btn" onClick=${update}>Buscar actualización</button>
        </div>
        <p class="note out">Tus datos están en este dispositivo${sync.configured() ? ' y en tu servidor privado' : ''}. Actualizar la app no los borra.</p>
      </section>
    </div>
  `;
}
