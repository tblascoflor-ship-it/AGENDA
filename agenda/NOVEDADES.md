# Versión 1.1 — novedades y cómo actualizar

## Qué hay nuevo

1. **Avisos insistentes.** En una tarea, *Insistir hasta completarla*: cada 30 minutos, cada hora, cada 2 o 4 horas, o cada día. Empiezan al pasar la hora límite (las 9:00 si la tarea no tiene hora) y paran al completarla, cancelarla o reprogramarla. Solo suenan entre las 8:00 y las 22:00, y durante 14 días como máximo.
2. **Escribir rápido.** Botón **+ › Escribir rápido**: escribes «Entregar estadística jueves 23:59 urgente» y la app rellena fecha, hora y prioridad. Entiende fechas (mañana, el jueves, 19/11, en 3 días), franjas (de 17 a 19), repeticiones (cada día, todos los lunes), prioridad (urgente, importante) y avisos (avísame 1 hora antes). Antes de guardar ves lo que ha entendido y puedes abrir *Más opciones*.
3. **Buscar hueco.** En la ficha de una tarea pendiente, *Buscar hueco en el calendario*: eliges la duración y la app propone franjas libres entre tus actividades (de 8:00 a 22:00). Al tocar una, queda reservada como actividad.
4. **Revisión semanal.** En *Ajustes › Notificaciones*: un aviso el día y la hora que elijas (por defecto, domingo a las 19:00) con las actividades y tareas de los 7 días siguientes, lo pendiente de antes y el día más cargado.
5. **Subtareas.** Lista de pasos dentro de una tarea, con su progreso (por ejemplo 2/5) en las listas. En una tarea que se repite, los pasos se marcan por separado en cada repetición.
6. **Importar calendario (.ics).** En *Ajustes › Copia de seguridad*: carga el horario de la universidad o un calendario de Google, Outlook o Apple, con sus repeticiones. Puedes asignarle una categoría y un aviso. Volver a importar el mismo archivo actualiza, no duplica.
7. **Estadísticas.** En *Tareas*, el botón de las barras: racha de días sin dejar tareas pendientes, completadas esta semana, porcentaje hechas a tiempo y horas por categoría.

También: el mensaje «fetch is aborted» ahora dice en español que el servidor no ha respondido.

## Cómo actualizar (unos 5 minutos)

Tus datos, tu clave, la base de datos y el cron no se tocan.

### 1. Servidor (Cloudflare)

Necesario para los avisos insistentes y la revisión semanal.

1. Cloudflare › **Compute › Workers & Pages › agenda-push › Edit code**.
2. Borra todo el código, pega el contenido del nuevo `worker/dist/worker.js` y pulsa **Deploy**.

### 2. App (GitHub)

1. Descomprime el zip nuevo.
2. En GitHub abre tu repositorio y **entra en la carpeta donde están ahora los archivos** (en tu caso, la carpeta `agenda` dentro de `AGENDA`).
3. **Add file › Upload files**, arrastra todo el contenido de la carpeta descomprimida y pulsa **Commit changes**. Los archivos con el mismo nombre se sustituyen.

### 3. iPhone

Abre la agenda › **Ajustes › Buscar actualización**. En *Acerca de* debe poner **Versión 1.1.0**. Si sigue en 1.0.0, espera un minuto (GitHub tarda en publicar) y repite.

## Límites de estas funciones

- Los avisos insistentes y la revisión semanal los envía el servidor: sin el paso 1 no funcionan (el resto sí).
- *Escribir rápido* funciona con reglas, no con IA: si una frase es ambigua, revisa el resumen antes de guardar o usa *Más opciones*.
- Al importar un .ics, las reglas de repetición poco comunes (por ejemplo «el segundo martes de cada mes») se importan como actividad única, y la app te lo indica.
- *Buscar hueco* solo tiene en cuenta las actividades con hora; no las tareas ni las actividades de todo el día.
