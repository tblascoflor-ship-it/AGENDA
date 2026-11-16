# Agenda personal

Calendario, tareas y recordatorios con notificaciones reales en iPhone. Aplicación web instalable (PWA), privada y gratuita.

**Para instalarla, sigue [INSTALACION.md](INSTALACION.md).**

## Cómo está hecha

- **Sin paso de compilación.** La app son archivos estáticos (módulos JavaScript + [Preact](https://preactjs.com) incluido en `js/vendor/`). Lo que hay en el repositorio es lo que se ejecuta.
- **Datos en el dispositivo** (IndexedDB), con copia y sincronización en un servidor propio.
- **Servidor** en Cloudflare Workers + D1: programa los avisos, los envía por Web Push (VAPID) con un cron cada minuto y exige una clave privada para todo.

```
index.html, manifest.webmanifest, sw.js   Entrada, instalación y funcionamiento sin conexión
css/app.css                               Estilos (modo claro y oscuro)
js/app.js                                 Navegación y arranque
js/store.js                               Almacenamiento local (IndexedDB), copias de seguridad
js/sync.js                                Sincronización y suscripción a notificaciones
js/actions.js                             Acciones del usuario (completar, reprogramar, editar…)
js/ui/                                    Pantallas: Inicio, Calendario, Tareas, Ajustes, formularios
js/shared/                                Lógica pura, compartida por la app y el servidor:
  dates.js, tz.js                           fechas y zona horaria (Europe/Madrid)
  model.js                                  recurrencias, excepciones, estado de las tareas
  reminders.js                              cálculo del instante y el texto de cada aviso
  ics.js                                    exportación a calendario (.ics)
worker/src/                               Código del servidor
worker/dist/worker.js                     Servidor empaquetado en un archivo (el que se pega en Cloudflare)
tests/                                    Pruebas automáticas
```

## Decisiones de diseño

- Una serie recurrente es **un único registro** con su regla; las ocurrencias se calculan al mostrarlas. Editar o borrar una sola ocurrencia guarda una excepción dentro de la serie.
- Una tarea no completada **no se copia** de un día a otro: «atrasada» se calcula comparando su fecha con hoy. En las tareas recurrentes, cada repetición guarda su estado bajo su fecha original.
- El servidor calcula los avisos con el mismo código de recurrencias que la app, y los materializa con 72 horas de antelación. Cada aviso tiene un identificador único (elemento + ocurrencia + minuto) que impide enviarlo dos veces; al cambiar o completar un elemento se regeneran sus avisos pendientes.
- Conflictos de sincronización: gana la modificación más reciente de cada elemento.

## Desarrollo (opcional)

```
npm install
npm test               # pruebas de la lógica y del servidor
npm run build:worker   # regenera worker/dist/worker.js tras cambiar worker/src o js/shared
python -m http.server  # sirve la app en http://localhost:8000
```

Al publicar cambios en la app, sube el número `VERSION` de `sw.js`.
