# Panel (adminpanel) · módulos ES

Módulos ES nativos, sin bundler ni framework. `adminpanel/index.html` carga, en este orden:

1. `supabase-js` (UMD, con SRI) -> `window.supabase`
2. `assets/config.js` (script clásico) -> `window.NEUMET_CONFIG = {SUPABASE_URL, SUPABASE_KEY}`
3. `assets/js/main.js` (`<script type="module">`)

La CSP exige `script-src 'self' https://cdn.jsdelivr.net`: los módulos son del mismo origen y **no hay scripts inline**.
`landing.js` es un script clásico independiente (landing), no forma parte de esto.

## Estructura

```
main.js                 entrada: initActions/initAuth/initNav, init() de cada vista, checkAuth()
core/
  config.js             lee window.NEUMET_CONFIG (SUPABASE_URL, SUPABASE_KEY)
  supabase.js           cliente `db`
  html.js               esc, html``, SafeHtml, raw, joinHtml, setHtml, safeCls  (ÚNICO sumidero de innerHTML)
  ui.js                 showToast, setStatus (aviso de conexión: oculto salvo problema real), confirmDialog, relDate, userError, avatarFor
  conexion.js           eventos online/offline + acción «Reintentar» del aviso de conexión
  actions.js            ACTIONS + registerActions + listener delegado (data-action / data-change / data-backdrop-close)
  auth.js               checkAuth, login/logout, rol de la sesión (currentRol: admin | cliente | sin_acceso; pantalla «Sin acceso»), modo cliente (currentClienteId, isClienteMode), hooks onLogin/onLogout
  nav.js                registerView(nombre, etiqueta, load, {menu}), switchView, setTitulo (migas), sidebar móvil
  buscador.js           buscador de vehículos por matrícula o número (barra superior, Inicio; atajo «/»)
  brand.js              BRAND (paleta para SVG generados por JS)
  svg.js                svgEl(tag, attrs)
domain/
  desgaste.js           PURO (sin DOM ni supabase): WEAR, wearStatus, avgMm, wearRate, daysUntil, analyzeTire, ...
  flota.js              PURO: agrupar/ordenar vehículos por severidad, KPIs, filtros de alertas
  inicio.js             PURO: estadoInicio, proporciones, requierenAtencion, proximosCambios, resumen de dispositivos
  rol.js                PURO: decidirRol (admin solo con perfil admin; sin perfil reconocido o rol api: sin acceso)
  salud.js              PURO: estados de dispositivos (los usa la vista Dispositivos)
  camion.js             disposición de ruedas por tipo de vehículo (datos)
views/
  inicio.js  clientes.js  vehiculos.js  dispositivos.js (estado + actividad, solo administración)  balance.js (+ balance-chart.js)
  mediciones.js (+ mediciones-camion.js, mediciones-dispositivo.js, mediciones-state.js, report.js)
  neumaticos.js  stock.js  reportes.js
  flota.js (flota con prioridades)  alertas.js (centro de alertas)
```

Dependencias permitidas: `views/*` -> `core/*` y `domain/*`; `core/*` nunca importa `views/*` (usa los hooks
`registerView`, `onLogin`, `onLogout`, `ACTIONS`); `domain/*` no importa nada del DOM. Entre vistas solo se importa lo
estrictamente compartido (p. ej. `neumaticos.js` -> `getVehiculos()` de `vehiculos.js`);
para el resto se usa `ACTIONS.<nombre>` (evita ciclos).

## Contrato de una vista

Cada `views/<vista>.js` exporta:

- `init()`: cablea listeners del DOM propios (búsquedas, filtros, teclas). Se llama una vez desde `main.js`.
- `load()`: carga/refresca datos y renderiza (la usa la navegación y el botón "actualizar").

y, al importarse, **registra** (efectos de módulo, no dentro de `init`):

- sus acciones: `ACTIONS.miAccion = fn` o `registerActions({...})`;
- su entrada de navegación: `registerView('mivista', 'Etiqueta', load)`;
- opcional: `onLogin(({cliente,user})=>...)` / `onLogout(()=>...)`.

El estado de la vista es privado del módulo (`let items=[]`). Si varias partes de una vista lo comparten, usar un objeto
exportado (ver `views/mediciones-state.js`).

## Añadir una vista nueva

1. HTML: en `adminpanel/index.html` añadir `<div class="view" id="view-mivista">…</div>` y un
   `<div class="nav-item" data-view="mivista">…</div>` en el sidebar. Botones con `data-action="nombre"`
   (+ `data-args='[1,2]'`), selects/inputs con `data-change="nombre"`, fondo de modal con `data-backdrop-close="cerrar"`.
   **Nunca** `onclick=` ni `<script>` inline.
2. Crear `views/mivista.js` (plantilla):

   ```js
   import { db } from '../core/supabase.js';
   import { html, setHtml, joinHtml } from '../core/html.js';
   import { showToast, userError } from '../core/ui.js';
   import { isClienteMode, currentClienteId } from '../core/auth.js';
   import { registerView } from '../core/nav.js';
   import { ACTIONS } from '../core/actions.js';

   let items = [];

   export async function load() {
     let q = db.from('mi_tabla').select('*');
     if (isClienteMode()) q = q.eq('cliente_id', currentClienteId);
     const { data, error } = await q;
     if (error) { showToast(userError(error), true); return; }
     items = data || [];
     render();
   }

   function render() {
     setHtml(document.getElementById('tbody-mivista'),
       joinHtml(items.map(i => html`<tr><td>${i.nombre}</td></tr>`)));   // html`` escapa cada ${}
   }

   ACTIONS.miAccion = function (id) { /* ... */ };
   registerView('mivista', 'Mi vista', load);

   export function init() { /* listeners propios */ }
   ```
3. En `main.js`: `import * as mivista from './views/mivista.js';` y añadirla al array de `init()`.
4. Reglas de cálculo (umbrales, promedios, predicciones) van en `domain/` con tests en `tests/unit/`, no en la vista.
5. Verificar: `npm run lint && npm run check && npm test` y `tests/smoke/run.sh admin|cliente` (añadir la vista a la lista
   `views` del arnés si es navegable).

## Reglas

- HTML solo con `html\`…\`` + `setHtml()`; `no-unsanitized` está en `error`. No `innerHTML`/`insertAdjacentHTML` directos.
- Nada nuevo en `window` (la configuración es la única excepción: `window.NEUMET_CONFIG`).
- Módulos de ~600 líneas como máximo; si crece, dividir como `mediciones-*.js`.
- Cambio de proyecto Supabase: editar `assets/config.js` (y `connect-src` de la CSP en `vercel.json`).

## Comprobaciones

```
npm run lint     # ESLint (sourceType module en assets/js; no-unsanitized en error)
npm run check    # sintaxis de todos los módulos
npm test         # node:test de domain/ (tests/unit)
tests/smoke/run.sh admin    # arnés headless con supabase simulado (admin y cliente)
```

## Reglas de UX del panel (cliente = gestor de flota)
- **Aviso de conexión**: no se muestra nada mientras todo funciona. Solo aparece «Sin conexión» + «Reintentar» ante un error
  de carga o al perder la red (`setStatus(false)` / evento `offline`). Nunca «Conectando…».
- **Copy**: si un texto no ayuda a decidir o actuar, se elimina. Títulos cortos, sin subtítulos de relleno; los vacíos dicen
  qué pasa y, si existe, ofrecen la acción concreta.
- **Menú del cliente**: Inicio, Vehículos, Alertas, Stock (solo lectura), Reportes. Dispositivos es solo de administración (sin ítem para el cliente y rechazada por el router). Se quitan «Mi panel» (duplicaba Inicio),
  «Mi resumen» (la ficha es de administración), «Mediciones» (el detalle por vehículo y el export viven en Vehículos y Reportes)
  y «Estado de la flota» (Inicio y Vehículos cubren la prioridad). El administrador conserva Estado de la flota, Mediciones,
  Clientes (la ficha se abre desde la lista) y Balance bajo «Administración». Mapa completo: `docs/12-mapa-navegacion.md`.
- **Solo lectura para el cliente**: Stock sin alta/edición/baja (UI oculta + guardas en las acciones; la RLS lo impide igual).
