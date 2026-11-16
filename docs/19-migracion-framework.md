# 19 · Plan de migración gradual del panel a un framework con build

Estado: **planificado**. Este documento es una propuesta: no cambia código, migraciones, `vercel.json` ni CI. Ninguna pantalla del front nuevo existe todavía; el build neutro (PR 0) y el andamiaje (PR 1) ya están en la rama o en `main`, el resto de lo descrito en las secciones 5 a 8 no. Lo vigente está en [`assets/js/README.md`](../assets/js/README.md), [03](03-despliegue-vercel-supabase.md) y [14](14-guia-de-textos.md). Es la fase **F11** de [16](16-hoja-de-ruta.md), sin prioridad asignada y sin cambiar el orden de F8 ni de F10; sí cambia quién construye la pantalla «Uso» de F10 PR 7 (sección 7.2.1).

Convenciones de este documento. Las afirmaciones sobre el repositorio llevan `archivo:línea` y se comprobaron sobre `main` el 2026-11-15. **[V]** = verificado leyendo el repositorio; **[S]** = suposición o hipótesis, sin verificar; **[a medir]** = se decide con la validación del piloto (sección 6). Las versiones de npm y los puntajes de la sección 4 provienen de una investigación hecha el 2026-11-15 por agentes: los puntajes son una opinión ponderada, no una medición, y las versiones deben reconfirmarse antes de fijarlas.

## 1. Resumen para el dueño

1. **Objetivo (decisión del dueño, 2026-11-15): un front mantenible, consistente y con buen diseño**, basado en componentes y un sistema de diseño. La experiencia móvil **no es prioridad**: queda como mejora secundaria. El CSS actual muestra inconsistencias que sí justifican el sistema de diseño (siete anchos de corte, seis variantes de botón [S], 91 `style=` en línea, tablas con ancho mínimo). Un sistema de diseño se puede hacer **sin** cambiar de framework; el framework ayuda a **sostenerlo**, porque permite componentes reutilizables (un solo botón, una sola tabla, un solo modal). Conviene decirlo con franqueza: si solo se quisiera uniformar el CSS, bastaría la sección 3 sin la 5.
2. **Recomendación de stack:** Svelte 5 con Vite (sin SvelteKit), Tailwind 4 y shadcn-svelte/bits-ui. Plan B: React 19 con Vite y shadcn/ui. Decisión del director (2026-11-16): se avanza con Svelte 5 **sin prueba de concepto previa aparte**; el piloto de la ola 1 hace de validación real (sección 6) y React 19 queda como plan B si el piloto la rechaza.
3. **Estrategia:** migración gradual («strangler»): el panel actual sigue vivo y cada pantalla nueva se monta como una «isla» dentro de él, detrás de una bandera por rol. Nada se reescribe de una vez. La producción se mantiene idéntica hasta que una bandera se enciende.
4. **Costo estimado:** 19 a 31 PR (central, unos 25; ±30 %, sin contar rondas de corrección), en seis olas (sección 7).
5. **Competencia con F8 y F10.** Hay tres lugares de autor en paralelo (CLAUDE.md). El dueño aceptó dedicar a la migración los que haga falta, incluso demorando F8 (decisión del 2026-11-15). Regla de reparto: **un autor A para F8 y F10 (en serie, una fase tras otra) y hasta 2 autores en migración (B y C) cuando haya pantallas libres**; F8 sigue siendo la prioridad fuerte del cliente y nunca queda sin lugar.
6. **Riesgo principal:** que dos sistemas convivan meses y que la migración quite capacidad a F8. Se mitiga con una regla escrita de «una pantalla, una sola pista a la vez» (sección 7.2).
7. Decisiones del dueño del 2026-11-15, ya incorporadas: sin proyecto de staging (no hay datos reales en la base); móvil secundario; lugares de autor según la regla anterior. Quedan tres preguntas abiertas, todas con valor por defecto razonable (sección 10). Svelte 5 va sin prueba de concepto previa; el piloto de la ola 1 lo valida (sección 6).

## 2. Situación actual

### 2.1 Panel

| Aspecto | Hecho | Evidencia |
|---|---|---|
| Arquitectura | SPA de módulos ES sin bundler ni framework | `assets/js/README.md`; `adminpanel/index.html` carga `assets/js/main.js` |
| HTML | 1.489 líneas, 15 `div.view`, unos 120 elementos con clase `modal`, 70 apariciones de `data-action` [V, conteo con `grep`; incluye variantes de clase] | `adminpanel/index.html` |
| Vistas | 26 archivos en `assets/js/views`, 5.737 líneas en total; los mayores: `vehiculo-detalle.js` 551, `stock.js` 455, `neumaticos.js` 297, `mediciones-camion.js` 288 | `wc -l assets/js/views/*.js` [V] |
| Núcleo acoplado al DOM | `core/actions.js` (delegación por `data-action` y `data-change`), `core/nav.js` (sin URL ni `history`; `registerView(nombre, etiqueta, load, {menu})`), `core/modal-a11y.js`, `core/ui.js`, `core/buscador.js`, `core/html.js` (único sumidero de `innerHTML`) | `assets/js/README.md:24` y `:43` [V] |
| Lógica pura | `assets/js/domain/`: 30 archivos puros (sin DOM ni supabase), con pruebas `node:test` en `tests/unit/`. Se reutilizan tal cual | [V] |
| Datos | Unas 144 llamadas `db.from(...)` o `db.rpc(...)` directas en `assets/js` (sin capa de datos); el cliente es un singleton `window.supabase.createClient` | `assets/js/core/supabase.js:4` [V] |
| Estado | Live bindings exportados desde `core/auth.js` y `core/seccional.js` | [V] |
| PWA | No hay service worker ni manifiesto | [V] |
| Landing | `index.html` de la raíz es independiente del panel: queda fuera de alcance | [V] |

### 2.2 Entrega y seguridad

| Aspecto | Hecho | Evidencia |
|---|---|---|
| CSP | `script-src 'self' https://cdn.jsdelivr.net` (sin `unsafe-inline` ni `unsafe-eval`); `style-src 'self' 'unsafe-inline'` y Google Fonts; `connect-src` solo a `kootszosdejmawanfxug` | `vercel.json:11` [V] |
| supabase-js | Por UMD de jsDelivr con SRI, versión 2.118.0 (la misma que `devDependency`) | `adminpanel/index.html:1485`, `package.json:15` [V] |
| Caché | `assets/**/*.js` y `*.css` con `must-revalidate`; imágenes y fuentes `immutable` | `vercel.json:21-33` [V] |
| Sitio estático | Vercel sirve el repositorio tal cual, sin build; `.vercelignore` excluye `package.json` y `package-lock.json` además de `docs/`, `tests/`, `supabase/` | `.vercelignore` [V] |
| CI | Jobs `secrets`, `static`, `lint`, `test`, `deno`, `sql`, `e2e`; `static` usa Node 20 y los demás Node 22 | `.github/workflows/ci.yml:38`, `:57`, `:69`, `:134` [V] |

### 2.3 Pruebas

| Tipo | Depende del DOM actual | Qué pasa con la migración |
|---|---|---|
| Unitarias de `domain/` (30 archivos) | No | No cambian |
| Smoke (`tests/smoke`: flujos `*.flow.js` con fixtures, iframe `srcdoc` y `stub.js`; selectores por id y `data-action`) | Sí | Se reescriben por pantalla migrada |
| Visuales (`tests/visual`, escenas) | Sí | Ídem |
| E2E (`tests/e2e`; `lib/web.mjs` sirve `dist/` con las cabeceras de `vercel.json` y reescribe `adminpanel/index.html`; la auth es la real de supabase-js con sesión precargada) | Sí, en la capa web | Se reescribe la capa web; `lib/postgres.mjs`, `lib/postgrest.mjs`, `tests/sql` y las pruebas Deno se conservan |
| CSP | Ninguna prueba la comprueba: el servidor e2e no envía las cabeceras de `vercel.json` | Se corrige en el PR 2 (sección 5.5; ver 7.1) |

### 2.4 Inconsistencias del CSS y comportamiento en móvil (hipótesis, sin capturas)

Es una **auditoría estática del CSS**. Se conserva como diagnóstico de hechos; el móvil no es prioridad (sección 1). Todo lo visual es hipótesis [S] hasta que existan capturas.

| Síntoma | Evidencia estática |
|---|---|
| Muchos anchos de corte | 19 bloques `@media` en total: 17 en `assets/css/styles.css` y 2 en `assets/css/tokens.css` (640 y 760 px), uno de ellos `prefers-reduced-motion` (no es de ancho); los de ancho usan 7 cortes distintos (640 px, 760, 860 con un `min-width: 861px`, 880, 900, 520, 480) [V, conteo con `grep`] |
| Scroll lateral en tablas | `.table-wrap table { min-width:560px }` (`assets/css/styles.css:498`); solo `.ciclo-tabla` y `.alert-tabla` pasan a tarjeta |
| Objetivos táctiles menores de 44 px | `.menu-toggle` de 34×34 px (`styles.css:339`); `sub-tab` y `quick-amount` [S, sin medir]; el piso de 40 px solo rige a 640 px o menos |
| Campos con letra menor de 16 px | `font-size: 15px` en el login (`styles.css:27`), 14 px en el buscador (`:119`), 12 px en el panel de neumático (`:198`): iOS hace zoom al enfocar [S, comportamiento conocido de iOS, no probado aquí] |
| Modal ancho | `.modal.modal-neum { width: 960px; max-width: 96vw }` sin apilar en móvil (`styles.css:184`); lo usa el flujo de montar |
| Seis implementaciones de botón | [S, hallazgo de la auditoría; no recontado] |
| Estilos en línea | 92 apariciones de `style="` en 91 líneas de `adminpanel/index.html`, y 78 `style=` en plantillas de `assets/js/views/` [V] |
| Alto de pantalla | `min-height: 100vh` sin `dvh` (`styles.css:11`, `:15`, `:38`) [V]; la barra del navegador móvil lo desajusta [S] |

## 3. Sistema de diseño (independiente del framework)

Esta sección define la consistencia visual y **no depende** de la sección 4. Puede hacerse sobre el panel actual como PR de CSS y, si se migra, se porta a componentes. Se diseña en pantalla de escritorio primero; lo móvil se añade como mejora secundaria.

### 3.1 Qué incluye

- Tokens únicos (`assets/css/tokens.css` ya existe: se amplía con espaciado, radios, alturas de control y puntos de corte).
- **Un solo punto de corte de ancho: 768 px**, cuando se aborde lo móvil. Hoy son siete.
- Tabla que pasa a tarjeta bajo 768 px (un componente, no una variante por pantalla).
- Modal que pasa a hoja inferior (bottom sheet) en móvil; apilado del flujo de montar.
- Barra de navegación inferior en móvil y cabecera fija compacta.
- Objetivos táctiles de 44×44 px y campos de 16 px.
- Un solo componente de botón, de badge con texto y de estado vacío.
- `dvh` en lugar de `vh`; sin `style=` en el HTML.

### 3.2 Objetivos posteriores (móvil)

Propuesta para cuando el móvil suba de prioridad. **No son criterio de salida de ninguna ola ni bloquean el CI**; las reglas 7 y 8 sí aplican desde ya porque no dependen del móvil. Una prueba automática a 360, 390, 768 y 1280 px (extensión de `tests/visual` o de e2e con CDP) se evalúa entonces.

| N.º | Regla | Cómo se verifica |
|---|---|---|
| 1 | Cero scroll horizontal de la página (`scrollWidth <= clientWidth` del documento) | Prueba por pantalla y ancho |
| 2 | Todo `button`, `a`, `input`, `select` y `[role=tab]` visible mide al menos 44×44 px | `getBoundingClientRect` en la prueba |
| 3 | Todo `input`, `select` y `textarea` tiene `font-size` de al menos 16 px | `getComputedStyle` |
| 4 | Ninguna tabla tiene scroll horizontal a 360 px, salvo excepciones listadas en el PR | Prueba por pantalla |
| 5 | Un solo `@media` de ancho (768 px) en el CSS | `grep` en el lint |
| 6 | Cabecera fija de 56 px o menos a 390 px | Prueba de medida |
| 7 | El PR declara los clics de cada tarea frecuente que toca y no los aumenta sin justificación | Revisión ([13](13-checklist-revision-prs.md), [14](14-guia-de-textos.md) §5) |
| 8 | Sin `style=` nuevo en HTML ni en plantillas | `grep` en el lint |

Las reglas 1 a 6 son **hipótesis de umbral**, ajustables. Propuesta aparte: añadir una **regla 9 a [14](14-guia-de-textos.md) §5** («táctil y punto de corte único»), como cambio de un PR posterior; este PR no toca `docs/14`.

## 4. Elección de stack

### 4.1 Criterios y resultado

Pesos (suman 100): inteligencia de los agentes que escriben el código (IA) 18, coexistencia con el panel actual 15, rendimiento (incl. gama baja) 15, accesibilidad 12, pruebas 10, madurez 10, CSP y Vercel 8, mantenimiento 7, PWA 3, integración con Supabase 2. Los puntajes son **opinión ponderada**, no medición.

| Opción | Total | Comentario |
|---|---|---|
| Svelte 5 + Vite | 90 (86 sin las mitigaciones de 4.3) | Recomendada |
| React 19 + Vite (con shadcn/ui) | 90 | Plan B; los modelos la conocen mejor |
| Vue 3.5 | 84 | La 3.6 (Vapor) sigue en candidata a versión |
| Preact 11 | 83 | |
| SvelteKit 3 | unos 81 | Descartado como base (4.4) |
| Lit / web components | 73 | Descartado (4.4) |

Versiones de npm consultadas el 2026-11-15 (**reconfirmar al fijar**): React 19.3.1, Vite 8.3.8, Svelte 5.57.3, SvelteKit 3.2.0, Vue 3.5.45, Preact 11.2.0, Tailwind 4.3.5, shadcn-svelte 1.8.1 con bits-ui 2.21.0, shadcn 4.23.0, Vitest 5.1.0, Playwright 1.65.1, vite-plugin-pwa 2.0.0, supabase-js 2.119.0 (la 3.0 está en `next`).

### 4.2 Recomendación y razones

**Svelte 5 + Vite (sin SvelteKit), Tailwind 4, shadcn-svelte/bits-ui; TypeScript opcional.**

- Menos JavaScript enviado, también a equipos de gama baja [a medir, sección 6]; es informativo y no decide el stack.
- `mount()` y `unmount()` permiten montar una pantalla dentro del shell viejo sin tocar el router, `domain/` ni las pruebas viejas.
- El HTML actual se porta casi literal.
- Los errores típicos se detectan en CI: `compilerOptions.runes = true` rechaza la sintaxis de Svelte 4, los avisos de accesibilidad del compilador se tratan como error y `svelte/no-at-html-tags` equivale a la regla del sumidero de `core/html.js`; además existe el autofixer del MCP de Svelte.

### 4.3 Riesgos del stack y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Los modelos derivan a la sintaxis de Svelte 4 | `runes: true` como error de compilación; ejemplos en el brief del autor; el experimento comparativo de la sección 6 lo mide |
| El preflight de Tailwind 4 resetea estilos del panel viejo dentro de la isla | Importar Tailwind sin preflight o acotado al contenedor de la isla; mapear `tokens.css` a `@theme` |
| Tailwind 4 exige navegadores modernos (Chrome 111+, Safari 16.4+, Firefox 128+) | Se usan los valores modernos por defecto de escritorio. Si el móvil sube de prioridad, se revisa el parque real de dispositivos antes de fijar `build.target` [compatibilidad sin verificar] |
| Ecosistema chico de bits-ui | shadcn copia el código al repositorio: no hay dependencia dura de un paquete de componentes |
| Versión de supabase-js | Fijarla igual al UMD (2.118.0) |

### 4.4 Descartados, con motivo

| Opción | Motivo |
|---|---|
| SvelteKit, Next, Nuxt | Emiten scripts en línea que chocan con la CSP de cabecera; el renderizado en servidor no aporta a un panel autenticado |
| Vue con plantillas en el navegador | Exige `unsafe-eval` |
| Preact con Radix vía capa de compatibilidad | Problemas de foco y portales |
| Web components a mano | ARIA no cruza el shadow DOM; terminaría siendo un framework casero |
| Tailwind o JavaScript por CDN | Rompe CSP y `script-src` |
| Reescritura de una vez | Riesgo y congelamiento de F8 y F10 |
| Vue Vapor (3.6) | Candidata a versión |

## 5. Estrategia técnica

### 5.1 PR 0: un build que no cambia nada

El primer paso es introducir el build **sin cambiar lo que se sirve**.

> Implementado en el PR 0 (rama `feat/f11-pr0-build-neutro`): `scripts/build.mjs`, `npm run build`, job `build` del CI y `tests/build/verificar-dist.mjs`. Pendiente de comprobar en un preview de Vercel (solo posible con el PR abierto): que `outputDirectory` sirva las mismas rutas y cabeceras. `.vercelignore` sigue excluyendo `docs/`, `tests/`, `supabase/` y demás, pero ya no `package*.json`; `scripts/` se sube porque el build lo necesita. `.gitignore` ignoraba `build/` y se agregó la excepción `!tests/build/`.

> Implementado en el PR 1 de la ola 0 (rama `feat/f11-pr1-scaffold`): `vite.config.mjs` (raíz `src/`, `base: '/panel/'`, salida `dist/panel/`, alias `@domain`), Svelte 5 con `runes: true` y toda advertencia del compilador como error, Tailwind 4 **sin preflight** (solo `theme.css` y `utilities.css`), Vitest con jsdom (`npm run test:front`), `scripts/build.mjs` que tras copiar lo viejo corre `vite build`, y `tests/build/verificar-dist.mjs` extendido (exactamente `dist/panel/**` además de la lista vieja; en `dist/panel/**` sin `<script>`, `<style>` ni `style=` en línea, sin manejadores `on*`, referencias solo a `/panel/`, sin `eval`/`new Function`, sin `sb_secret_`/`service_role`, tope de 1 MB). Isla de humo `hola` con bandera sin roles (apagada para todos) y `localStorage.neumet_islas = 'off'`; el lint prohíbe en `src/` importar `@supabase/*` (y `import()`), `createClient` (también con alias, desestructurado o por acceso computado), el global `window/globalThis/self.supabase` y `new SupabaseClient` (`tests/lint/`). **Sin TypeScript** por ahora (opcional según 4.2; se evalúa en el PR 2 con los contratos). **Fuera del PR 1, pasa al PR 2 de la ola 0 (decisión del director):** el servidor e2e con cabeceras de `vercel.json`, e2e sobre `dist/` y la auth sin shim (§5.5 y §5.6), `ctx`/`navegar` y `assets/js/core/islas.js`. **Estado de la CSP:** `vercel.json` no cambia; el build emite módulos y hoja de estilos externos en `/panel/`, así que `script-src 'self'` y `style-src 'self'` bastan para lo emitido. `style-src 'unsafe-inline'` sigue en `vercel.json` por los `style=` del panel viejo (§5.5), no por el front nuevo. Pendiente en un preview de Vercel: servir `/panel` (con `cleanUrls`) y confirmar cero violaciones de CSP.

- `vercel.json`: `installCommand` `npm ci`, `buildCommand` `npm run build`, `outputDirectory` `dist`.
- Un script copia tal cual a `dist/` solo `index.html`, `adminpanel/`, `assets/` (incluye `assets/config.js`) y `app-demo.mp4`: es lo que `.vercelignore` deja publicar. `vercel.json` no se copia (lo lee Vercel desde la raíz); verificar en el PR 0 que no haga falta otro archivo.
- `.vercelignore` deja de excluir `package.json` y `package-lock.json`. La garantía de no publicar `docs/`, `tests/` ni `supabase/` pasa a ser `outputDirectory` más una prueba que verifica que `dist/` no los contiene.
- Validación en un preview de Vercel: misma lista de archivos y mismas cabeceras (`curl -I`; hace falta el bypass de Deployment Protection).
- Reversa: Instant Rollback de Vercel o revert del PR. Un build fallido nunca se promueve.

### 5.2 Código nuevo e islas

- Código nuevo en `src/`; Vite con `base: '/panel/'` y salida en `dist/panel/`. Los archivos con hash se sirven `immutable`; la entrada fija, `must-revalidate`. Cuando exista el shell nuevo, un rewrite `/panel/(.*)` → `/panel/index.html`.
- **Islas dentro del shell viejo en las olas 1 a 4; shell nuevo recién en la ola 5.** `assets/js/core/islas.js` registra cada pantalla migrada con `registerView`; su `load` hace `import('/panel/islas.js')` y llama `montar(nombre, el, ctx)` sobre `div#view-x`; al salir de la vista, `desmontar`. `/panel/islas.js` existe solo tras el build: smoke y visuales, que sirven el repositorio sin build, darían 404 y `console.error` con la bandera encendida; su harness fuerza las banderas apagadas o sirve `dist/`.
- Contrato `ctx` versionado (`API_ISLAS = 1`): `db` (**el mismo cliente** del panel viejo: dos clientes dan el aviso «Multiple GoTrueClient» y se pisan los refrescos de sesión), `rol`, `clienteId`, `sucursalId`, `puedeVerPrecios`, `esAdmin`, `navegar(vista, ...args)`, `showToast` y `onCambioSucursal`. `ctx` no trae `esAdminEmpresa`: F10 PR 4 cambia los roles y obliga a subir `API_ISLAS` y a revisar el orden de banderas de 5.3. Si la versión no coincide, la isla pide recargar la página: cubre el desfase de caché del runbook ([11](11-runbook-operacion.md) §7, recarga forzada).
- Sesión: mismo origen, misma clave `sb-<ref>-auth-token`, misma versión de supabase-js. Un solo cliente: el lint prohíbe `createClient` en `src/`; supabase-js entra como `dependency` fijada en 2.118.0 (como el UMD) solo para tipos si las islas usan `ctx.db`.
- Configuración: sigue `assets/config.js`. No se usan `VITE_*` ni variables de entorno de Vercel; si algún día se usan `VITE_*`, son públicas por construcción.

### 5.3 Banderas por rol

- En código: `ISLAS = { uso: { roles: ['admin'] } }`. Orden de encendido: `admin`, luego perfil global, luego sucursal. Apagada significa vista vieja, que se conserva hasta la ola 5.
- Override de soporte: `localStorage.neumet_islas = 'off'`.
- Sin servicio remoto de banderas: cambiar una bandera es un PR de una línea.

### 5.4 Previews contra producción

No hay staging: los previews de Vercel apuntan a producción (riesgo G4 de [03](03-despliegue-vercel-supabase.md)). Decisión del dueño (2026-11-15): **riesgo aceptado**, porque hoy no hay datos reales de clientes en la base; no se crea un proyecto de staging. Aun así, las escrituras se prueban en e2e local y los previews deben estar protegidos (pregunta 3). **Disparador de revisión:** si entran datos reales de clientes, reevaluar el staging antes de las olas de escritura (ola 4).

### 5.5 CI

| Cambio | Detalle |
|---|---|
| Job `build` | `npm ci && npm run build` y `tests/build/verificar-dist.mjs`: el panel viejo idéntico byte a byte, ningún `<script>` sin `src` en `dist/**/*.html`, sin `eval` ni `new Function` en el bundle, sin `sb_secret_` ni `service_role`, tope de tamaño |
| Lint | `eslint` extendido a `src/` con la regla equivalente al sumidero (`svelte/no-at-html-tags`, o `react/no-danger` si gana el plan B) y `no-unsanitized` |
| Pruebas | Vitest además de `npm test` |
| Node | 22 en todos los jobs (ya lo cumple: `static` pasó a 22 en el PR 1) |
| CSP | La de `vercel.json` sirve tal cual para un build Vite de producción, sin nonces ni hashes [S, a confirmar en el preview]. `cdn.jsdelivr.net` de `script-src` y `unsafe-inline` de `style-src` se quitan **en el mismo PR que borra el panel viejo**, no durante la reversa de N semanas; quitar `unsafe-inline` exige antes eliminar los 91 `style=` del HTML y los 78 de las plantillas, y [S] que el framework no inyecte `<style>` en tiempo de ejecución (depende de bits-ui, sonner y los toasts; a medir en el piloto) |
| E2E | El servidor e2e pasa a enviar las cabeceras de `vercel.json`; un evento `securitypolicyviolation` o un `console.error` falla la prueba. El e2e corre el build y sirve `dist/`: `lib/web.mjs` usa un `ROOT` estático distinto del de `lib/postgres.mjs` (que sigue sirviendo para `node_modules` y el shim) |
| Secretos | gitleaks igual; agregar `dist/`, `.vite/` y `coverage/` a `.gitignore`; nunca ampliar el allowlist |

### 5.6 Pruebas

- `domain/` se comparte con un alias `@domain` (una sola copia; `server.fs.allow`).
- Auth del e2e (**hecho en el PR 2a**): `auth-shim.js` se borró; `tests/e2e/lib/chrome.mjs` precarga la sesión en `localStorage` (clave `sb-127-auth-token`, JWT HS256 de 24 h) y `lib/web.mjs` atiende `/auth/v1/user` y `/auth/v1/logout`; `/auth/v1/token` responde 400 a propósito (si algo intentara refrescar, el test falla). Verificado: con la sesión vigente supabase-js no refresca. El servidor sirve `dist/` (el e2e corre `scripts/build.mjs` antes; `E2E_SIN_BUILD=1` reutiliza el `dist/` existente) con las cabeceras de `vercel.json`.
- Los flujos de smoke y las escenas visuales pasan a pruebas de componente (Vitest con Testing Library y un `ctx.db` simulado): roles, vacíos y errores.
- Capturas de pantallas nuevas desde e2e (CDP, escritorio y móvil).
- Smoke y escenas de una pantalla vieja se borran **en el mismo PR** que borra la vista vieja.
- Specs e2e con selectores por rol y texto; corren con la isla encendida y apagada mientras convivan. Las aserciones contra la base no cambian.

## 6. Validación del stack en el piloto (antes: prueba de concepto)

Decisión del director (2026-11-16): no hay prueba de concepto previa aparte; el PR 1 de la ola 0 fija Svelte 5, la opción recomendada por la evaluación. **El piloto de la ola 1 hace de validación real**: se evalúan con la tabla siguiente sobre una pantalla de verdad. **Criterios de rechazo (pendientes de fijar antes de abrir el piloto, los fija el director):** se proponen como rechazo del stack el incumplimiento de los chequeos 1, 2, 4 o 5 (coexistencia, CSP, preflight, accesibilidad) sin arreglo razonable, o bloqueantes recurrentes del revisor atribuibles a Svelte. Si el piloto rechaza Svelte, se pasa al plan B (React 19 con Vite y shadcn/ui) y se rehace solo lo ya construido en `src/`, que en ese punto es la ola 0 más el piloto. El chequeo 7 (experimento comparativo entre dos autores) queda descartado salvo que el director pida comparar.

| N.º | Chequeo | Criterio |
|---|---|---|
| 1 | Coexistencia: `mount` y `unmount` sin fugas; sesión compartida | Una sola instancia de GoTrue; sin avisos |
| 2 | CSP en un preview de Vercel | Cero violaciones; `dist` sin código en línea |
| 3 | Peso y rendimiento (informativo, no decide el stack) | KB comprimidos por pantalla y Lighthouse con CPU 4x, frente a `main` [a medir] |
| 4 | Tailwind sin preflight | Las capturas del panel viejo no cambian |
| 5 | Accesibilidad | axe, foco y teclado y lector de pantalla en escritorio (móvil, informativo) |
| 6 | Pruebas | Smoke, e2e y visuales viejos pasan sin cambios; una prueba de componente en Vitest en modo navegador |
| 7 | Experimento comparativo | El mismo ticket a dos autores `sonnet`, uno con Svelte y otro con React: bloqueantes del revisor, sintaxis vieja, líneas |
| 8 | Clics | Declarados sin aumentar; auditados con `neumet-ux` |
| 9 | Operación | Rollback del preview, caché de módulos y tiempo de build |

## 7. Olas, reparto de agentes y estimación

### 7.1 Olas

| Ola | Contenido | Entrada | Salida | PR |
|---|---|---|---|---|
| 0 (un solo autor, en serie) | **PR 0** build neutro; **PR 1** andamiaje: Vite 8, Svelte 5, Tailwind 4 sin preflight, Vitest, salida `dist/panel/`, `verificar-dist` extendido, lint de un solo cliente de Supabase, CI e isla de humo apagada; **PR 2** hereda del PR 1 el servidor e2e con las cabeceras de `vercel.json` (CSP), el e2e sobre `dist/`, la auth sin shim, `ctx` y `navegar`, `assets/js/core/islas.js` y los pendientes de 7.1.1, y además los contratos: sistema de diseño base (botón, tabla a tarjeta, modal accesible equivalente a `modal-a11y.js`, toast, estado vacío, badge con texto), capa de datos sobre `ctx.db` con manejo uniforme de `userError` y 42501, contrato `ctx` y `navegar` | Svelte 5 fijado en el PR 1 (sin prueba de concepto previa; lo valida el piloto, sección 6). No se exige F10 PR 3 fusionado: ese PR toca solo `supabase/functions/` ([17](17-plan-roles-admin.md) §9, PR 3), no el build ni `package.json` [V]; el solapamiento posible con F10 PR 4 en `main.js` y `adminpanel/index.html` se resuelve al fusionar (7.3) | Producción idéntica; CI verde con los jobs nuevos; una isla «hola» oculta tras una bandera sin roles | 3 a 4 |
| 1 piloto | Pantalla «Uso»: nueva, solo lectura, solo equipo Neumet, construida directo en el stack nuevo por la pista de migración (regla 7.2.1; ya no es un PR de F10); si no se puede, ver Entrada | Ola 0 terminada. Piloto = «Uso» solo si la migración B (F10 PR 6) ya está aplicada; si no, o si F10 se atrasa, el piloto es Flota, pantalla libre de solo lectura, sin esperar (7.2.1) | E2E por rol, capturas revisadas, una semana de uso interno sin errores | 0 a 1 |
| 2 administración | Mediciones (libre); «Uso» si no pudo ser el piloto (entra aquí cuando la migración B esté aplicada, 7.2.1); Dispositivos (solo con F10 PR 4 fusionado: el router pasa a `soloAdmin` y nace Empresa con Dispositivos de solo lectura); Balance, Clientes y Ficha (solo con F10 PR 4 y F10 PR 9 a 11 fusionados: PR 4 cierra con `soloAdmin` la ficha, Balance y Clientes; PR 9 reescribe Balance y la ficha; la ficha de F10 PR 9 usa la RPC de F10 PR 6, no la pantalla «Uso») | Ola 0 y piloto en uso (el que sea). Las pantallas libres no esperan a «Uso» ni a F10 | Banderas encendidas por rol | 3 a 5 |
| 3 lectura del cliente | Calidad y Flota (libres; Flota es el piloto de reserva y, si lo fue, ya está hecha); Reportes, Recauchutado e Inicio con buscador (solo con F10 PR 4 fusionado: reemplaza la regla «global» en `recauchutado.js:18` y `core/buscador.js:60`, y `reportes.js` evalúa `puedeVerCostos`, que usa `domain/costos.js:43-44`); Alertas (solo con F8 PR 2 y F10 PR 4 fusionados, con el formulario de parámetros trasladado a Empresa, [18](18-rotacion-vehiculos-pesados.md) §9.1, y `alertas.js:101` reemplazado). «Costos» no es una vista: ver 7.2 | Ola 0 y piloto en uso (el que sea); las pantallas libres no esperan a la ola 2 | Idem | 5 a 8 |
| 4 escritura del operario | Vehículos y detalle (551 líneas, en 2 a 3 PR), ficha del neumático, cambio, montar, ciclo de vida con registro de costos, Stock, Sucursales | Cada pantalla según la tabla de 7.2: detalle, tras F8 PR 3, 4, 6 y, si el dueño lo confirma, 5; cambio y montar, tras F10 PR 4 (regla «global») y, el cambio, F8 PR 4; ficha del neumático (`neumaticos.js`), tras F8 PR 3 y F10 PR 9; Stock, tras F10 PR 4 y 9 y F8 PR 7 si la sugerencia de compra se ubica ahí; vehículos, ciclo de vida (incluye el registro de costos) y sucursales, tras F10 PR 4, 9 y 11 (C2); revisar el disparador de staging de 5.4 | Cada PR declara los clics de las tareas que toca y no los aumenta | 6 a 10 |
| 5 cierre | Shell nuevo en `/panel` con rutas por URL; `/adminpanel` redirige; el panel viejo queda N semanas de reversa y luego se borra junto con el harness smoke, `check-modules` y el CDN de la CSP | Olas 1 a 4 | Un solo sistema | 2 a 3 |

#### 7.1.1 Pendientes del PR 2 hallados al corregir el PR 1

Estado tras el PR 2a de la ola 0 (rama `feat/f11-pr2-contratos`):

- **El CSS viaja con `islas.js` (hecho).** `scripts/vite-css-islas.mjs` sustituye en el bundle el marcador de `src/estilos-isla.js` por la lista real de hojas; el módulo las enlaza con `<link rel="stylesheet">` externo (sin `<style>` en línea) y `montar()` espera su carga (tope 4 s). `vite.config.mjs` fija `preserveEntrySignatures: 'strict'`: sin eso Vite recortaba `islas.js` a lo que usa `index.html` y el panel viejo no veía `desmontar` ni `API_ISLAS`; ahora `/panel/islas.js` es un re-export del chunk con hash. `verificar-dist` falla si queda el marcador, si no hay enlace a la hoja o si la hoja no existe.
- **Montajes de una misma isla en serie (hecho).** Como `montar()` espera las hojas y desmonta por nombre la instancia anterior, dos montajes en vuelo (recarga de la vista o cambio de sucursal mientras cargan las hojas) se pisaban y dejaban la pantalla en blanco. `core/islas.js` los encadena por nombre: el superado limpia lo suyo y devuelve `null` (no cae a la vista vieja) antes de que arranque el siguiente; `montadas` solo guarda instancias reales. Probado en `tests/e2e/specs/islas.mjs`.
- **Cascada con el panel viejo (hallazgo).** `assets/css/styles.css` tiene `* { margin: 0; padding: 0 }` sin capa, y una regla sin capa gana a cualquier regla en `@layer`: las utilidades de Tailwind en capa no aplicaban dentro del panel viejo. Decisión: utilidades **sin capa y con prefijo `tw:`** (`tw:p-4`), que además evita colisiones con clases del panel viejo (`.hidden`, `.flex`...); el tema (variables, también con prefijo) queda en su capa. Lo cubre el e2e (`padding` calculado de la isla).
- **`verificar-dist` corre al final de `scripts/build.mjs` (hecho).** Un `dist/` fuera de lo permitido hace fallar el build y Vercel no lo promueve. Como `.vercelignore` excluía `tests/`, ahora es `tests/*` y `!tests/build/`; si el archivo faltara en Vercel, el build avisa y sigue (CI lo corre siempre aparte). **No verificado:** que Vercel respete la negación del `.vercelignore` (se ve en el primer preview; si no, el aviso queda en el log y nada se rompe).
- **Caché de `/panel/assets/*` (hecho).** Nuevo bloque en `vercel.json`: `Cache-Control: public, max-age=31536000, immutable` solo para `/panel/assets/(.*)` (archivos con hash). `/panel/islas.js` (nombre fijo) y lo viejo no cambian de cabeceras. Un 404 bajo esa ruta también saldría `immutable`; es inocuo porque una URL con hash que no existe no vuelve a pedirse.
- **`/panel` devuelve 404 (descartado).** Ya no ocurre: con `cleanUrls` responde 200 (comprobado con `curl -I` contra producción). No se agrega rewrite: ningún flujo navega a `/panel` hasta la ola 5.
- **Elusiones del lint de un solo cliente sin cubrir (pasa al PR 2b):** `import()` desde una URL externa (p. ej. jsdelivr, que la CSP permite y `verificar-dist` no mira) y `window['supabase'][clave dinámica]`.

**Piloto.** La pantalla «Uso» es el piloto solo si la migración B ya está aplicada al terminar la ola 0; si no, el piloto es Flota (libre, de solo lectura; regla 7.2.1). Un inventario previo propuso `alertas` por ser pequeña y de solo lectura; se descarta porque F8 PR 2 la toca (`alertas.js` hospeda hoy la edición de `alerta_configurar`, ver [18](18-rotacion-vehiculos-pesados.md) §9.1) y regiría la regla de conflicto de 7.2.

**Reversa por ola:** apagar la bandera o Instant Rollback. **Ningún PR de migración de pantallas lleva migración SQL.**

### 7.2 Regla de encaje con F8 y F10

- Una pantalla está en **una sola pista a la vez**. Las que toca un PR de roadmap en curso se quedan en el panel viejo hasta que ese PR se fusione.
- Pantallas nuevas de roadmap posteriores a la ola 0 nacen en el stack nuevo; las que la secuencia de F10 o F8 escribe antes de que termine la ola 0 (por ejemplo Empresa, F10 PR 4) nacen en el panel viejo y se migran como cualquier otra.
- Tabla «pantalla → PR de roadmap que la toca», reconstruida de [17](17-plan-roles-admin.md) §4.3 y §9 y de [18](18-rotacion-vehiculos-pesados.md) §9 (a 2026-11-15). Cada pantalla de 7.1 entra solo cuando los PR de su fila están fusionados; al empezar cada ola se vuelve a contrastar con los planes vigentes.

| Pantalla (archivo) | PR de roadmap que la toca | Fuente |
|---|---|---|
| Router y menú (`core/nav.js`, `main.js`) | F10 PR 4: `esAdminEmpresa()`, `soloEmpresa` y `soloAdmin` en la ficha, Balance y Clientes | 17 §4.3 y §9 (PR 4) |
| Empresa (nueva: Usuarios, Umbrales, Dispositivos de solo lectura) | F10 PR 4 | 17 §4.3 y §9 (PR 4) |
| Dispositivos (`dispositivos.js`) | Ningún PR edita el archivo; F10 PR 4 cambia el acceso en el router y añade aparte la vista de solo lectura; F10 PR 9 conserva la asignación de dispositivos en la tarjeta de sucursales | 17 §4.3 y §9 (PR 4 y 9) |
| Uso (nueva) | F10 PR 7: los datos (RPC) llegan en la migración B (F10 PR 6); la pantalla la entrega la pista de migración (7.2.1) | 17 §9 (PR 6 y 7) |
| Ficha de cliente (`ficha-cliente.js`), umbrales y tarjeta de sucursales y usuarios (`seccionales-admin.js`) | F10 PR 4 (`soloAdmin`; los umbrales de la empresa pasan a Empresa) y F10 PR 9 (solo lectura para Neumet) | 17 §4.3 y §9 (PR 4 y 9) |
| Balance (`balance.js`) | F10 PR 4 (`soloAdmin`) y F10 PR 9 (front sobre la RPC de C1) | 17 §9 (PR 4 y 9) |
| Clientes (`clientes.js`) | F10 PR 4 solo vía router; el archivo no figura en el plan [S] | 17 §9 (PR 4) |
| Sucursales (`sucursales.js`) | F10 PR 9 (el plan dice «sucursales» sin precisar si es la vista o la tarjeta: se trata como tocada) | 17 §9 (PR 9) |
| Vehículos (`vehiculos.js`), Stock (`stock.js`), neumáticos (`neumaticos.js`) | F10 PR 9 (retiro de formularios de escritura de Neumet) | 17 §9 (PR 9) |
| Ciclo de vida (`ciclo-vida.js`) | F10 PR 4 (`vehiculo_corregir_odometro`) y F10 PR 9 (retiro de la escritura directa del odómetro) | 17 §9 (PR 4 y 9) |
| Reemplazo de la regla «global» por `esAdminEmpresa()` ([17](17-plan-roles-admin.md) §4.3, inventario de §2.2) | F10 PR 4: `recauchutado.js:18`, `core/buscador.js:60` (buscador de Inicio), `montar-neumatico.js:26`, `cambio-neumatico.js:107`, `alertas.js:101`, y también `stock.js:39`, `sucursales.js:61` y `:144`, `domain/costos.js:43-44` (lo usa `costos.js`), `domain/rol.js:12-13` (`puedeVerPrecios`; lo usan `core/precios.js`, `stock.js` y `neumaticos.js`), `core/seccional.js:33` y la etiqueta de `core/auth.js:34`. El núcleo (`core/`) no se migra en las islas: se actualiza en el panel viejo y la isla recibe el resultado por `ctx` | 17 §4.3 (:258) y §2.2 (:34-39) |
| Reportes (`reportes.js`) | F10 PR 4 de forma indirecta: importa `puedeVerCostos` de `costos.js` (`reportes.js:6`, evaluada en `:63`), que llama a `puedeGestionarCostos` (`domain/costos.js:43-44`), reemplazada por F10 PR 4. Una isla de Reportes podría tomar la visibilidad de `ctx.puedeVerPrecios`, pero eso cambia la fuente de la regla: se decide después de F10 PR 4 | `reportes.js:6`, `costos.js:15` |
| Costos (`costos.js`) | No es una vista registrada con `registerView`: es el modal de registro de costos. Lo abren `ciclo-vida.js:172` y `vehiculo-detalle.js:517` (import en `:23`); `reportes.js` solo importa `puedeVerCostos`. Se migra una sola vez, con el primero de los dos que se migre, y el segundo lo importa de la isla; si Ciclo de vida se migra antes que el detalle (que espera a F8 PR 3 a 6), el modal queda en la isla y el detalle viejo lo sigue abriendo mediante un puente que expone la isla. Hereda los PR de ambos (F10 PR 4 y 9, F8 PR 3 a 6) | `assets/js/main.js`, `ciclo-vida.js:15` |
| Alertas (`alertas.js`) | F8 PR 2 (formulario «Parámetros de rotación»); el formulario se traslada a Empresa cuando exista F10 PR 4: si F8 PR 2 llega primero, lo traslada el autor A dentro de F10 PR 4, en el panel viejo, antes de que la pista de migración tome Alertas | 18 §9 (PR 2) y §9.1 |
| Detalle del vehículo (`vehiculo-detalle.js`) | F8 PR 3 (formulario de datos del vehículo), F8 PR 4 (tarjeta de sugerencias y «Registrar rotación»), F8 PR 5 (si el dueño lo confirma) y F8 PR 6 (acción de rotación múltiple) | 18 §9 (PR 3 a 6) |
| Ficha del neumático (`neumaticos.js` [S]) | F8 PR 3 (formulario de datos del neumático) y F10 PR 9 | 18 §9 (PR 3), 17 §9 (PR 9) |
| Cambio de neumático (`cambio-neumatico.js`) | F8 PR 4 (formulario prellenado con cubierta apta) | 18 §9 (PR 4) |
| Sugerencia de compra (vista nueva; ubicación sin fijar, posiblemente `stock.js` [S]) | F8 PR 7 | 18 §9 (PR 7) |
| Libres desde ya [S, contrastar al empezar cada ola] | Flota, Calidad y Mediciones (comprobado con grep de importaciones: no importan `costos.js`, `core/precios.js`, `domain/rol.js` ni `domain/costos.js`; solo `core/seccional.js` e `isClienteMode`, que quedan en el núcleo) | sin mención en 17 §4.3, §9 ni 18 §9 |

#### 7.2.1 Quién construye «Uso» (decisión del director, 2026-11-15)

- La pantalla «Uso» **pertenece a la pista de migración**: la construye en el stack nuevo, como piloto, el autor B, una vez terminada la ola 0 **y solo si la migración B ya está aplicada**.
- F10 PR 7 se redefine como «la RPC y los datos de Uso ya están en la migración B (PR 6); la pantalla la entrega la pista de migración». F10 no escribe esa pantalla.
- F10 va en serie (PR 4, 5 y 6 antes del 7) y la ola 0 son 3 a 4 PR, por lo que se prevé que la ola 0 termine antes. Si F10 llegara al PR 7 antes: el autor A **no** construye la pantalla; sigue con los PR siguientes que no dependen de ella (PR 8, 9, 10, 11 y 12 de [17](17-plan-roles-admin.md) §9: ninguno la requiere) y «Uso» espera a la ola 0.
- **Piloto de reserva, también si F10 se atrasa.** Si al terminar la ola 0 la migración B no está aplicada (porque B se atrasó o porque F10 aún no llegó al PR 6), la pista de migración no espera: el piloto es Flota (libre, de solo lectura) y las olas 2 y 3 avanzan sobre pantallas libres. «Uso» se construye después, cuando B esté aplicada, como una pantalla más de la ola 2.
- Solo si la falta de «Uso» bloqueara a todo lo demás de F10, se hace una versión mínima en el panel viejo y se avisa al dueño; esa versión se reemplaza después por la del stack nuevo.
- Lo mismo vale para la alternativa «Dispositivos de la empresa» (F10 PR 4): queda descartada como piloto de reserva mientras F10 PR 4 no esté fusionado. Si el piloto de reserva se activa, se elige entre las pantallas libres de la tabla (Flota; si ya se usó, Calidad), nunca una pantalla en conflicto, y nunca Reportes mientras F10 PR 4 no esté fusionado.

### 7.3 Reparto de agentes

| Pista | Quién | Alcance |
|---|---|---|
| Ola 0 | Un solo autor, en serie | Plataforma completa |
| A | Autor A | Roadmap F8 y F10 en el panel viejo |
| B y C | Autores B y C | Pantallas **distintas** en el stack nuevo; cada uno es dueño de `src/pantallas/<pantalla>/`, sus pruebas y su spec |

- **Archivos ajenos** (solo un PR de plataforma aparte): `src/compartido/**`, `package.json` y su lock, `vercel.json`, `eslint.config.js`, `vite.config.*`, `.github/workflows/ci.yml`.
- **Conflictos seguros** (se esperan y se resuelven al fusionar): `islas.js`, `main.js`, `adminpanel/index.html`, `docs/10`, la lista `ALL` de `tests/visual/run.sh` y `harness.html`.
- Reparto de lugares: el autor A cubre F8 y F10 en serie (nunca F8 sin lugar); B y C solo cuando haya pantallas libres en la tabla de 7.2, y con una sola pantalla libre trabaja uno; la pista de migración no espera a F10: si la migración B no está aplicada, empieza por pantallas libres (7.2.1); nunca dos ramas sobre la misma pantalla; revisor distinto del autor; máximo tres autores a la vez (CLAUDE.md).

### 7.4 Estimación

| Ola | PR |
|---|---|
| 0 | 3 a 4 |
| 1 | 0 a 1 |
| 2 | 3 a 5 |
| 3 | 5 a 8 (incluye el piloto de reserva si se activa: Flota sale de esta cuenta y no se suma dos veces) |
| 4 | 6 a 10 |
| 5 | 2 a 3 |
| **Total** | **19 a 31 (central, unos 25; ±30 %)**, sin rondas de corrección |

Lo que más la mueve: el tamaño de `vehiculo-detalle.js` y `mediciones-*`, el framework elegido, los cambios de F8 en el detalle y la decisión sobre rutas por URL (pregunta abierta 1).

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Desfase de caché entre el panel viejo y la isla | `API_ISLAS` versionado; la isla pide recargar |
| Dos clientes GoTrue | El `ctx.db` es el cliente del panel viejo; chequeo 1 de la validación del piloto (sección 6) |
| CSP rota solo en Vercel | El e2e envía las cabeceras; chequeo 2 en un preview; `verificar-dist` |
| Previews contra producción | Riesgo aceptado mientras no haya datos reales; previews protegidos; reevaluar staging si entran clientes reales |
| Regresión de clics del operario | Cada PR declara clics y se audita con `neumet-ux`; el principio de [14](14-guia-de-textos.md) §5 rige |
| La migración quita capacidad a F8 | Regla de encaje 7.2 y regla de reparto (el autor A siempre cubre F8) |
| La pista de migración queda esperando a F10 (migración B, «Uso») | Piloto de reserva sobre una pantalla libre de solo lectura y olas 2 y 3 sobre pantallas libres, sin depender de «Uso» (7.2.1) |
| Dos sistemas conviviendo meses | Regla escrita de cuál usar, banderas por rol y ola 5 con fecha de retiro |
| Un build fallido en Vercel | Nunca se promueve; Instant Rollback |
| Compatibilidad de Tailwind 4 con móviles antiguos | Aceptado por ahora (móvil secundario); se revisa si el móvil sube de prioridad |

## 9. Qué NO incluye este plan

- Código de producto, migraciones, cambios en `vercel.json` ni en CI: llegan en los PR 0 a 2.
- La landing de la raíz.
- Cambios de la API de proveedor o de las Edge Functions.
- Service worker y PWA (se evalúan después de la ola 5; `vite-plugin-pwa` queda como opción).
- La regla 9 de [14](14-guia-de-textos.md): propuesta de un PR posterior.

## 10. Decisiones del dueño y preguntas abiertas

### 10.1 Resueltas (2026-11-15)

| Tema | Decisión |
|---|---|
| Lugares de autor frente a F8 | Se dedican a la migración los que haga falta, incluso demorando F8; regla: un autor A para F8 y F10 en serie y hasta 2 en migración (B y C) cuando haya pantallas libres |
| Piloto interno | Ola 1 solo para el equipo Neumet (recomendación del autor, sin objeción) |
| Staging de Supabase | No hace falta: no hay datos reales. Se reevalúa si entran (5.4) |
| Dispositivos y navegadores del operario | Ya no bloquea: el móvil es secundario; valores modernos por defecto |
| Stack | Svelte 5 (decisión del director, 2026-11-16), sin prueba de concepto previa; el piloto de la ola 1 lo valida y React 19 con shadcn/ui queda como plan B si lo rechaza (sección 6) |

### 10.2 Abiertas (todas con valor por defecto razonable; ninguna bloquea)

| N.º | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Se quieren enlaces por URL compartibles (por ejemplo a un vehículo)? | Sí, desde la ola 5; antes no hay rutas por URL |
| 2 | ¿Se avisa a los clientes antes de cambiar pantallas de escritura? | Sí, un aviso breve antes de cada pantalla de la ola 4 |
| 3 | ¿El plan de Vercel incluye protección de previews (Deployment Protection)? | Confirmar; si no, los previews no se usan con sesión real **[confirmar]** |

## 11. Fuentes y límites de la verificación

- Repositorio: archivos citados en cada sección, sobre `main` al 2026-11-15.
- Versiones y puntajes de la sección 4: síntesis de una investigación por agentes; no se volvió a consultar el registro de npm al redactar este documento.
- **No verificado:** capturas en móvil (todo lo visual es hipótesis), peso en KB y Lighthouse de cualquier stack, comportamiento de refresco de supabase-js con sesión precargada, CSP de un build Vite en Vercel, el conteo de seis implementaciones de botón y los objetivos táctiles de `sub-tab` y `quick-amount`.
