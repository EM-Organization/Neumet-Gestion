# 10 · Tablero del proyecto

> Actualizado: 2026-11-13. Fuente de verdad del estado; los PR en GitHub tienen el detalle.
> Flujo: un agente por área en su rama y worktree → PR con tests → revisor distinto del autor (checklist en [13-checklist-revision-prs.md](13-checklist-revision-prs.md)) → el director aplica migraciones y despliega.
> Procedimientos de operación: [11-runbook-operacion.md](11-runbook-operacion.md). Lo que no pudo verificarse desde el repositorio va marcado **[confirmar]**.

## Infraestructura
| Pieza | Estado |
|---|---|
| Proyecto Supabase `kootszosdejmawanfxug` | Proyecto vigente. Migraciones en `supabase/migrations/`, todas aplicadas en el proyecto; comparar con `supabase migration list --remote` antes de cada despliegue |
| Proyecto Supabase anterior `dqgrlflrjcarxlfetvoj` | **Cutover realizado**: sin referencias en código, CSP ni formulario de contacto. Solo queda su payload anon en `.gitleaks.toml` porque sigue en el historial |
| Edge Function `api-proveedor` | Desplegada (`verify_jwt = false`; el Bearer se valida dentro del handler). Devuelve el motivo `sin_neumaticos` (migración `20261112000000`) |
| Edge Function `contacto` | Desplegada en el proyecto vigente con `RESEND_API_KEY`, `FROM_EMAIL`, `TO_EMAIL` y `ALLOWED_ORIGINS` cargados |
| Edge Functions `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional` | En el repositorio; despliegue y `ALLOWED_ORIGINS` **[confirmar]** |
| Vercel `neumet-gestion-theta.vercel.app` | Desplegado desde `main`; CSP sin `unsafe-inline` en scripts |
| CI (`.github/workflows/ci.yml`) | Jobs `secrets`, `static`, `lint`, `test`, `deno`, `sql` y `e2e` |

## Hecho
- Auditoría, plan de despliegue, identidad visual, endurecimiento del panel (XSS, SRI), CSP, `.vercelignore`.
- Esquema SQL con RLS, roles y auditoría; API de proveedor (contrato, función, migración); vistas, odómetro, ciclo de vida y umbrales por cliente.
- Panel en módulos ES con tests unitarios, smoke, visuales, SQL y E2E contra base real local.
- Funcionalidades: Inicio con buscador y «Últimas mediciones», Vehículos y detalle con diagrama y gráfico, cambio de neumático, rotación, número de quema, km previos, Sucursales (crear, mover vehículos), Stock, Alertas, Reportes, Dispositivos (solo administrador), ficha de cliente con umbrales y cuentas de API, baja lógica de clientes.
- Cutover del frontend al proyecto vigente, incluido el formulario de contacto de la landing.
- Stock individual de cubiertas (migración `20261113000000`): quema, condición, sucursal, traslados y devolución al stock desde el cambio de neumático; demo con las cubiertas `S-001` a `S-012`.
- Tasa de desgaste robusta (al menos 3 mediciones y 14 días, ventana reiniciada por evento) y `v_estado_neumaticos` por neumático (migración `20261111000000`, función `posiciones_medidas_sin_neumatico`); referencia de flota con `MIN_MUESTRAS` = 5 (ver [15](15-rotacion-alertas-rendimiento.md), C.6 y C.7).
- Mini vehículos con posiciones legibles en Alertas y en el ciclo de vida del neumático.
- Motivo `sin_neumaticos` en la API de proveedor (migración `20261112000000`).
- Pantalla «Sin acceso» para sesiones sin perfil o con perfil `api` (sin menú ni consultas de datos).
- Montar y retirar neumáticos sin reemplazo, para un coche sin neumáticos (migración `20261114500000`; `docs/08` apéndice G).
- Km por cubierta: `v_km_cubierta` y diagnóstico de odómetro (migración `20261115000000`; apéndice H, F2).
- Calidad de datos de las mediciones: control al ingresar, invalidación auditada, valor original y unidad (migración `20261116000000`; apéndice I, F3).
- Precios y costos solo para admin y perfil global, con privilegios por columna (migración `20261116500000`; apéndice K).
- Costos por cubierta y costo por km (migración `20261117000000`; apéndice J, F4).
- Recauchutado por carcasa: vista Recauchutado, grupos Vida y Banda en el costo por km (migración `20261118000000`; apéndice L, F5).
- Alerta única «crítico» con estado, histéresis y umbral por cliente (migración `20261118500000`; apéndice M, F7).
- Administración de empresa, base de datos (F10 PR 2): `accesos_quitados`, RPC de usuarios, kilometraje y alerta ampliada; migración `20261119000000` aplicada en producción (apéndice N).
- Edge Functions de acceso de empresa (F10 PR 3, sin desplegar): `quitar-acceso-usuario` y `reponer-acceso-usuario` con convergencia con Auth, y `crear-usuario-seccional` abierta al administrador de empresa con el 409 orientado a reponer (docs/17 §4.1 y §4.2).
- `api-proveedor` (F10 PR 5, sin migración; la función se despliega tras la fusión): registra cada login exitoso en `ingesta_log` (`endpoint = 'login'`) y rechaza con el mismo 401 a las cuentas `api` de clientes con `deleted_at`, tanto en el login como en cada llamada (corta tokens ya emitidos).
- Panel Empresa y regla única `esAdminEmpresa()` (F10 PR 4): Usuarios (alta, quitar y reponer con los 502 de las funciones), Umbrales (`alerta_configurar`) y Dispositivos de solo lectura; `soloAdmin` en ficha, Balance y Clientes; el administrador de empresa baja el kilometraje con `vehiculo_corregir_odometro`. Solo front, sin migración.
- F10 PR 9a (solo front, sin migración): el equipo Neumet queda en solo lectura dentro de una empresa. Ficha de cliente (umbrales, sucursales, vehículos, usuarios por `usuarios_empresa_listar`), Vehículos (sin alta, edición ni baja), Stock (sin alta de cubiertas ni de lotes; los lotes anteriores quedan de solo lectura) y Ciclo de vida (sin registrar eventos ni corregir kilometraje) ya no ofrecen escritura; se retiró `views/neumaticos.js`. Conserva la asignación de dispositivos a sucursal. La escritura directa se retira de la base en C2 (PR 11). **Pendiente 9b:** Balance sobre C1 (bloqueado por el PR 8). **Pendientes menores:** el administrador de empresa no tiene entrada al modal de ciclo de vida (hoy solo se abre desde la tabla de vehículos del equipo Neumet; habría que agregarla en `vehiculo-detalle.js`); CSS `.neum-*` y código de dominio `planEvento`/`planRotacion` sin uso en vistas; la tarjeta de umbral crítico de Alertas (solo administrador de empresa) duplicaba Empresa > Umbrales: decisión cerrada por el PR 9c (se retiró de Alertas). **Ronda 1 del PR 86:** el modal de ciclo de vida y el detalle del vehículo ya no ofrecen al equipo Neumet «Cambiar neumático», «Rotar», «Retirar», «Montar» ni «Registrar costo» (siguen para administrador de empresa y usuario de sucursal, salvo «Registrar costo»: el usuario de sucursal no ve costos y esa acción es solo del administrador de empresa; smoke `tests/smoke/run.sh admin` y `detalle-admin`). **Pendiente antes de la migración C2 (PR 11):** el equipo Neumet aún escribe por RPC desde `recauchutado.js`, `montar-neumatico.js`, `cambio-neumatico.js`, Alertas y Calidad de datos (invalidar y revalidar mediciones); cerrarlas con el PR 10 o antes. **Pulido (sugerencias del revisor, no bloqueantes):** `colspan` de la fila de nota en Stock, CSS huérfano `.neum-*`, `planEvento`/`planRotacion` sin uso en vistas y la escena visual `stock-alta`, que ya no existe para el equipo Neumet.
- Uso mensual por cliente (F10 PR 6, migración B `20261119500000`, aplicada): tabla `uso_cliente_mensual`, función de cierre `uso_cerrar_mes` (sin programar) y RPC `uso_clientes_listar` solo para el equipo Neumet (apéndice O). Pendiente tras aplicar: programar el cierre con pg_cron (runbook §3.2.1; la extensión está disponible pero no instalada). La pantalla «Uso» llega con el piloto de la ola 1 de F11 (ver Desarrollo).
- Retiro del nivel crítico de Alertas (F10 PR 9c, solo front, sin migración): la edición de umbrales y de la histéresis vive solo en Empresa > Umbrales (la histéresis se agregó como sexto campo del formulario); Alertas conserva lista, reconocer, silenciar y resolver, y muestra un aviso al administrador de empresa. El formulario de parámetros de rotación de `docs/18` ya no puede ir «junto al nivel crítico en Alertas»: va en Empresa.
- Documentación del producto: README raíz, índice de `docs/` y guías de revisión y de textos.
- Configuración de Claude Code versionada: `CLAUDE.md`, skills y subagentes (`.claude/`).

## Pendientes
### Acciones del dueño (dashboard de Supabase) **[confirmar]**
1. Existencia del usuario administrador con su fila en `perfiles` y **Allow new users to sign up** desactivado (runbook §1).
2. Secretos de `crear-cliente`, `crear-cuenta-api` y `crear-usuario-seccional` (`ALLOWED_ORIGINS`; opcional `INVITE_REDIRECT_TO`).
3. (Opcional) MFA para administradores.

### Desarrollo
- Pulido de la ola 0 de F11 (PR 85): hecho en `chore/pulido-f10-f11`: el `TypeError` de red se distingue de otros `TypeError` (`src/compartido/datos.js`) y `desmontarIsla` en `assets/js/core/islas.js` desmonta también si `mod.montar` lanza y atrapa los errores de `mod.desmontar` (`console.warn`, la limpieza del DOM siempre corre; pruebas en `src/core-islas.test.js` con `/panel/islas.js` como alias solo en Vitest). **Sigue pendiente:** otras elusiones del lint de un solo cliente en `src/`; revisar `Avisos`, `Boton` y `Modal`; `tests/e2e/lib/web.mjs`: `finally` al detener el servidor.
- Pulido del PR 87 (piloto «Uso»): hecho en `chore/pulido-f10-f11`. Etiquetas «Inicios de sesión de API» y «Último ingreso al panel»; un solo selector «Mes» con «Últimos 12 meses» (valor por defecto) y los meses calendario. **Clics:** ver un mes de los últimos 12 = 2 (menú «Uso» + «Mes»), antes 2; un mes antiguo = 3 (menú + «Mes» + opción), antes 4; el rango por defecto, 0 clics extra. `import()` dinámico por isla (`src/registro.js`, `src/islas.js`): `Uso` sale a su propio chunk (13 kB); `islas` queda en 48 kB; `dist/panel` 73.439 bytes. Pruebas nuevas: 404 y tope de espera de la hoja, desmontaje de la isla (`src/islas.test.js`), `matchMedia` en `Tabla`. `SelectorRango` queda sin uso en `Uso` (sigue en el sistema de diseño). **Guardas propias contra el equipo Neumet** (`esAdmin()`) en `neumatico-cambiar`, `neumatico-montar`, `neumatico-retirar` y `cicloRegistrarCosto`; la de `cicloRegistrarCosto` no se puede distinguir por prueba porque `costos.js` ya la rechaza (defensa en profundidad).

| Ítem | Notas |
|---|---|
| Cuenta con rol `api` para la app | Crearla desde la ficha del cliente (runbook §2) |
| Confirmar con DAC el orden físico de `mm1..mm4` | Resuelto en el mapeo (mm1 interno, mm2 centro, mm3 externo); falta la prueba con la app real |
| Prueba de punta a punta con sesión y datos reales | Los E2E cubren una base local con datos de demo; falta el entorno real |
| **Sugerencia de rotación para camiones y buses (prioridad fuerte)** | Decisión del 2026-11-13, confirmada con un cliente: siguiente fase de producto (F8 de [16](16-hoja-de-ruta.md)). Investigar la lógica real de rotación y cambio para vehículos pesados (entre otros temas: patrones por eje y posición, direccional, tracción y arrastre, desgaste irregular, criterios de retiro, cruce de ejes y lados) y llevarla a reglas interpretables sin machine learning. Diseño base en [15](15-rotacion-alertas-rendimiento.md) sección A; propuesta de investigación en [18](18-rotacion-vehiculos-pesados.md) |
| Separar el admin del equipo Neumet del admin de empresa (F10 de [16](16-hoja-de-ruta.md)) | Decisión del 2026-11-13, confirmada con un cliente: `admin` pasa a ser interno del equipo Neumet; cada cliente tendrá su administrador de empresa. Estado: planificado. Plan en [17](17-plan-roles-admin.md): roles, RLS, vistas, interfaz, migración de usuarios y riesgo de lockout; sin migraciones ni código todavía |
| Migración gradual del panel a un framework con build (F11 de [16](16-hoja-de-ruta.md)) | Plan en [19](19-migracion-framework.md) (documento fusionado en el PR 78). Decisiones del dueño del 2026-11-15: sin staging (sin datos reales), móvil secundario, autores según la regla de reparto (F8 siempre con un lugar). Stack: Svelte 5 sin prueba de concepto previa (decisión del director, 2026-11-16); el piloto de la ola 1 lo valida y React 19 queda como plan B. Ola 0, PR 0 (build neutro: Vercel sirve `dist/`, copia idéntica de lo publicable) fusionado; PR 1 (andamiaje: Vite 8 + Svelte 5 + Tailwind 4 + Vitest en `src/`, salida `dist/panel/`, isla de humo con bandera apagada, lint de un solo cliente supabase) fusionado. PR 2 dividido: **2a** en revisión (`assets/js/core/islas.js` con `ctx` versionado `API_ISLAS=1`, `navegar` y desmontaje al cambiar de vista; bandera por rol más `neumet_islas=on:hola|off`; el CSS viaja con `islas.js`; e2e sobre `dist/` con las cabeceras de `vercel.json` y auth real sin shim; `verificar-dist` al final del build; caché inmutable de `/panel/assets/*`); **2b** en revisión (sistema de diseño base en `src/compartido/`, capa de datos sobre `ctx.db`, elusiones del lint de `docs/19` 7.1.1 y pendientes del revisor del PR 83: vista vieja oculta con `[data-isla-oculto]`, oyentes y montajes robustos, build que falla en Vercel sin `verificar-dist`). Sin cambio de comportamiento ni de clics; falta comprobar en un preview de Vercel que `/panel` se sirva con la CSP |
| F11 ola 1: piloto «Uso» (primera isla Svelte real) | **En revisión.** Pantalla «Uso» solo para `admin` sobre `uso_clientes_listar` (migración B ya aplicada): tabla por cliente y mes, rango Desde/Hasta, filtro por cliente, vacío, «Sin permiso» ante 42501, tarjetas en móvil; sin vista vieja (con la bandera apagada, aviso «Uso no disponible»). **Clics:** ver el uso de un cliente en un mes de los últimos 12 = 2 (menú «Uso» + elegir cliente); un mes más antiguo = 3 (menú + «Mes» + opción; el pulido unificó Desde y Hasta en un solo selector). Solo se muestran meses cerrados: el mes en curso no tiene fila y se avisa con una insignia. **Decisiones abiertas (valor por defecto, pendiente de confirmar):** meses calendario UTC; si el administrador de empresa verá su propio uso (hoy no: la base responde 42501); retención de `ingesta_log` en 13 meses; programar `uso_cerrar_mes` con pg_cron (sin eso, la pantalla solo muestra los meses que alguien cerró a mano) |
| Principio de simplicidad para el operario | Decisión del 2026-11-13: se revisa en cada cambio de interfaz (reglas en [14](14-guia-de-textos.md), sección 5). Auditar las tareas frecuentes actuales (medir, cambiar, rotar, montar) contra esas reglas |
| Etapas posteriores de alertas | La alerta «crítico» (etapa 1) está hecha; faltan destinatarios, correo y reglas por marca y modelo. Diseño en [15-rotacion-alertas-rendimiento.md](15-rotacion-alertas-rendimiento.md) (sección B) |
| Referencia de flota en el servidor y tabla de estado por neumático | Medidas 2 a 4 de la sección C de [15](15-rotacion-alertas-rendimiento.md); se aplican según el tamaño de la flota |
| Destino «reparación» del neumático retirado | F1 y F5 cubren «almacenar» y el flujo de recauchutado; **[confirmar]** que «reparación» devuelve la cubierta al stock como «Reparado» |

### Sugerencias del revisor (sin resolver)
- Límite de altas de `crear-usuario-seccional` (20 por hora por llamante) es en memoria de la instancia; un contador durable por llamante, que cuente también los 409, necesita una tabla (migración futura).
- `x-forwarded-for` es falseable en el límite de intentos de login.
- Las RPC no comprueban `clientes.deleted_at`.
- Paginación por offset en los exportes.
- `mapErr` de `crear-cliente` trata 422 como «email ya existe».
- `tests/sql/run.sh` no aplica `20261108010000_comentarios_mm.sql` (sugerencia del revisor del PR 72; fuera de su alcance).

## Fuera de alcance de la primera versión
Presión/temperatura (TPMS) y machine learning: dependen de datos que todavía no existen. CPK y recauchutado ya están implementados (F4 y F5).

## Riesgos abiertos
- Avisos del linter de Supabase: 4 WARN `SECURITY DEFINER` ejecutables por `authenticated` (intencionales; mover helpers a un esquema privado más adelante).
- Sin probar con sesión real y datos reales de punta a punta.
