# Instalación de la agenda en tu iPhone 13

Todo se hace gratis desde un ordenador con Windows y el iPhone. No hace falta Mac, Xcode, App Store ni instalar ningún programa.

Hay dos piezas:

| Pieza | Dónde vive | Para qué sirve |
|---|---|---|
| **La app** (esta carpeta) | GitHub Pages | Lo que abres en el iPhone. Funciona sola y sin conexión. |
| **El servidor** (`worker/dist/worker.js`) | Cloudflare, plan gratuito | Envía las notificaciones con la app cerrada y guarda una copia remota de tus datos. |

Puedes hacer solo la parte A y usar la agenda sin avisos, y añadir la parte B más tarde. Tiempo total: unos 20–30 minutos.

---

## Parte A — Publicar la app en GitHub Pages

### 1. Crear el repositorio

1. Entra en <https://github.com> con tu cuenta y pulsa **New** (repositorio nuevo).
2. Nombre: `agenda`. Visibilidad: **Public**. (GitHub Pages solo es gratis en repositorios públicos. No pasa nada: el código no contiene ningún dato tuyo ni ninguna clave.)
3. Pulsa **Create repository**.

### 2. Subir los archivos

1. Descomprime `agenda.zip` en tu ordenador.
2. En la página del repositorio recién creado, pulsa el enlace **uploading an existing file**.
3. Abre la carpeta descomprimida, **selecciona todo su contenido** (Ctrl + E) y arrástralo a la página. Tienen que quedar en la raíz del repositorio `index.html`, `sw.js`, `manifest.webmanifest` y las carpetas `css`, `js`, `icons`, `worker` y `tests`. Arrastra el contenido, no la carpeta que lo contiene.
4. Pulsa **Commit changes**.

### 3. Activar GitHub Pages

1. En el repositorio: **Settings › Pages**.
2. En *Build and deployment*: **Source = Deploy from a branch**, **Branch = main**, carpeta **/ (root)**. Pulsa **Save**.
3. Espera uno o dos minutos y recarga. Aparecerá la dirección de tu agenda:
   `https://TU-USUARIO.github.io/agenda/`

### 4. Rutas, manifiesto y service worker

No hay que configurar nada: todas las rutas son relativas, así que la app funciona en `/agenda/` o con cualquier otro nombre de repositorio. Ábrela en el navegador del ordenador para comprobar que carga.

---

## Parte B — Servidor de notificaciones (Cloudflare)

Cloudflare pide una cuenta gratuita. Todo lo que se usa aquí (Workers, Cron Triggers y D1) entra en el plan Free; si en algún paso te pidiera elegir un plan de pago, no lo aceptes y dímelo. Los nombres de los menús pueden variar ligeramente si Cloudflare cambia su panel.

### 5.1 Crear la base de datos

1. Entra en <https://dash.cloudflare.com> y crea la cuenta.
2. Menú lateral: **Storage & Databases › D1 SQL Database › Create Database**.
3. Nombre: `agenda`. Pulsa **Create**. (Las tablas las crea el servidor solo la primera vez.)

### 5.2 Crear el Worker

1. Menú lateral: **Workers & Pages › Create › Start with Hello World!**
2. Nombre: `agenda-push`. Pulsa **Deploy**.
3. Pulsa **Edit code**. Borra todo el código de ejemplo.
4. Abre en tu ordenador el archivo `worker/dist/worker.js` con el Bloc de notas, copia **todo** su contenido y pégalo en el editor de Cloudflare.
5. Pulsa **Deploy**.

### 5.3 Enlazar la base de datos

1. En la página del Worker, pestaña **Bindings › Add binding › D1 database**.
2. **Variable name:** `DB` (en mayúsculas, exactamente así). Base de datos: `agenda`.
3. Pulsa **Add binding**.

### 5.4 Crear tu clave privada

1. Inventa una clave larga: al menos 12 caracteres; mejor 20 o más, con letras y números. Apúntala: la escribirás una vez en el iPhone.
2. En el Worker: **Settings › Variables and Secrets › Add**.
3. **Type: Secret**. **Variable name:** `AUTH_TOKEN`. **Value:** tu clave. Pulsa **Deploy**.

Sin esa clave nadie puede leer ni modificar tus datos, aunque conozca la dirección del servidor.

### 5.5 Programar la ejecución cada minuto

1. En el Worker: **Settings › Trigger Events** (en algunas versiones del panel, *Triggers*) **› Add › Cron Triggers**.
2. Expresión: `* * * * *` (cinco asteriscos separados por espacios). Pulsa **Add**.

Cloudflare puede tardar unos minutos en empezar a ejecutar un cron recién creado.

### 5.6 Comprobar

Abre la dirección del Worker (aparece arriba en su página, del tipo `https://agenda-push.TU-CUENTA.workers.dev`). Debe mostrar: **«Servidor de la agenda en marcha.»**

---

## Parte C — En el iPhone

### 6. Abrir la app en Safari

Abre **Safari** (tiene que ser Safari) y escribe `https://TU-USUARIO.github.io/agenda/`.

### 7. Añadirla a la pantalla de inicio

Pulsa **Compartir** (el cuadrado con la flecha) › **Añadir a pantalla de inicio** › **Añadir**. A partir de ahora ábrela **siempre desde su icono**: en iOS las notificaciones solo funcionan en la app instalada, no en una pestaña de Safari.

### 8. Conectar el servidor y permitir notificaciones

1. Abre la agenda desde el icono › **Ajustes**.
2. En *Servidor y sincronización* escribe la dirección del Worker y tu clave › **Conectar**. Debe poner «Sincronizado».
3. Arriba, en *Notificaciones*, pulsa **Activar notificaciones** › **Permitir**.

### 9. Comprobar que los avisos llegan con la app cerrada

Haz las tres pruebas, en este orden:

1. **Enviar notificación de prueba.** Debe aparecer en pocos segundos. Si falla, la app muestra el código de error que devolvió Apple.
2. **Programar aviso de prueba (≈1 minuto).** Cierra la app del todo (deslízala hacia arriba en el selector de apps), bloquea el teléfono y espera hasta dos minutos. Esta prueba recorre el camino real: base de datos › cron › Apple › iPhone.
3. **Un recordatorio real.** Crea un recordatorio para dentro de 5 minutos con el aviso «En el momento», comprueba en Ajustes que aparece en «Próximos avisos programados», cierra la app y espera.

Si la segunda prueba no llega pero la primera sí, el problema es el cron: Ajustes te avisará de que el servidor no está ejecutando su tarea programada (revisa el paso 5.5 y espera unos minutos).

### 10. Actualizar la app sin perder datos

Tus datos no están en los archivos de la app, sino en el almacenamiento del iPhone y en tu base de datos de Cloudflare. Para actualizar:

1. Sube los archivos nuevos al repositorio (**Add file › Upload files**; sobrescribe los existentes).
2. En el iPhone: **Ajustes › Buscar actualización** (o simplemente abre la app dos veces).

Si un día cambia `worker/dist/worker.js`, repite el paso 5.2 (Edit code › pegar › Deploy). La base de datos, la clave y el cron se conservan.

---

## Copias de seguridad y cambio de dispositivo

- **Automática:** con el servidor conectado, cada cambio se copia a tu base de datos. En un iPhone nuevo, instala la app, conecta el servidor con la misma clave y todo se descarga.
- **Manual:** *Ajustes › Exportar todos mis datos (JSON)* y guárdalo en Archivos o iCloud. *Importar una copia* la restaura sin duplicar nada. Conviene hacer una de vez en cuando.
- No desinstales la app sin tener el servidor conectado o una copia exportada: al borrar el icono, iOS borra los datos locales.

## Widget y accesos rápidos

Una app web no puede crear un widget propio en iOS. Estas son las alternativas gratuitas que sí funcionan:

- **Número en el icono:** muestra las tareas de hoy más las atrasadas. Se actualiza al abrir la app.
- **Widget del Calendario de Apple:** en la agenda, *Ajustes › Copiar enlace de suscripción*. En el iPhone: *Ajustes › Apps › Calendario › Cuentas de calendario › Añadir cuenta › Otra › Añadir calendario suscrito*, y pega el enlace (también puedes pegarlo en la barra de direcciones de Safari y aceptar la suscripción). Tus actividades y tareas pendientes aparecerán en el Calendario y en su widget. Apple refresca las suscripciones cada cierto tiempo, no al instante, y por defecto les quita las alarmas. Ese enlace da acceso de lectura a tu agenda: no lo compartas.
- **Atajo «Mi día»:** en la app Atajos, crea un atajo con la acción *Obtener contenido de URL*: URL `https://…workers.dev/api/hoy`, método GET, y en *Cabeceras* añade `Authorization` con el valor `Bearer TU-CLAVE`. Después añade *Mostrar resultado*. Puedes ponerlo en un widget de Atajos o pedírselo a Siri.
- **Atajo «Nueva tarea»:** *Solicitar entrada* (texto) › *Obtener contenido de URL*: URL `https://…workers.dev/api/tarea`, método POST, la misma cabecera, cuerpo JSON con el campo `titulo` = la entrada. Admite además `fecha` (`AAAA-MM-DD`), `hora` (`HH:MM`) y `prioridad` (`urgente`, `alta`, `media`, `baja`).

## Limitaciones reales que conviene conocer

- **Instalación obligatoria.** Sin el icono en la pantalla de inicio, iOS no entrega notificaciones web.
- **Puntualidad.** El servidor revisa los avisos una vez por minuto, así que un aviso sale dentro del minuto indicado, no al segundo. La entrega final depende de Apple: normalmente es inmediata, pero puede retrasarse sin cobertura, con el modo de bajo consumo o con un modo de concentración activo. Si el teléfono está apagado, el aviso se conserva hasta 6 horas.
- **Suscripciones que caducan.** iOS a veces invalida la suscripción de una app web tras mucho tiempo sin abrirla. La agenda la renueva sola cada vez que la abres. Si dejas de recibir avisos, ábrela y pulsa *Enviar notificación de prueba*.
- **Avisos creados sin conexión.** Se guardan en el teléfono, pero no se programan en el servidor hasta que vuelve Internet y se sincronizan.
- **Zona horaria.** Los avisos se calculan en hora de Madrid (Europe/Madrid), con los cambios de hora de verano e invierno.
- **Tareas sin hora.** Sus avisos «antes» toman como referencia las 09:00 del día límite.
- **Límites del plan gratuito.** El cron hace 1.440 ejecuciones al día de las 100.000 permitidas. Cada ejecución dispone de 10 ms de procesador; el cifrado de un aviso consume en torno a 1 ms en las mediciones hechas fuera de Cloudflare. Si alguna vez vieras «Exceeded CPU Time Limits» en *Workers › agenda-push › Metrics*, avísame.

## Qué se ha probado y qué no

Probado antes de entregarte el proyecto (puedes repetirlo con `npm install` y `npm test` si instalas Node.js; no es necesario para usar la app):

- Recurrencias, excepciones, tareas acumuladas, cambios de hora y exportación de calendario: 14 pruebas automáticas.
- Servidor: autenticación, sincronización, programación, envío sin duplicados, reintentos, cancelación de avisos al cambiar o completar, y cifrado del mensaje verificado descifrándolo con una biblioteca independiente: 7 pruebas automáticas contra un servicio push simulado. Además se ejecutó en el motor real de Cloudflare en local para probar la sincronización con la app.
- La app en un navegador con tamaño de iPhone 13: los criterios de aceptación uno por uno, incluido el arranque sin conexión: 14 pruebas.

No se ha podido probar sin tu iPhone y tu cuenta, y por eso existe el paso 9: la entrega real a través de Apple, el aspecto exacto en Safari de iOS y el consumo de procesador dentro de Cloudflare.

## Si algo falla

| Síntoma | Causa habitual |
|---|---|
| «Clave incorrecta» al conectar | La clave no coincide con el secreto `AUTH_TOKEN`, o tiene un espacio de más. |
| «Falta enlazar la base de datos D1» | El binding no se llama exactamente `DB` (paso 5.3). |
| «Falta configurar el secreto AUTH_TOKEN» | No existe el secreto o tiene menos de 12 caracteres (paso 5.4). |
| No aparece «Activar notificaciones» o dice que no es compatible | La app está abierta en Safari y no desde el icono; o el iPhone tiene una versión anterior a iOS 16.4. |
| La prueba inmediata llega, la programada no | El cron no está creado o aún no se ha propagado (paso 5.5). |
| Dejan de llegar avisos tras semanas | Abre la app (renueva la suscripción) y revisa *Ajustes del iPhone › Notificaciones › Agenda*. |
