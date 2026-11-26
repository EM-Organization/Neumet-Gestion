# NEUMET · Gestión

Plataforma de gestión del desgaste de neumáticos: calibre → app móvil → API → panel web. Todo en español (interfaz, docs, commits, PR).
El estado cambiante del trabajo vive en `docs/10-tablero.md`, no aquí.

## Mapa
- **Panel**: SPA de módulos ES sin bundler ni framework. `adminpanel/index.html` + `assets/js/` (estructura en `assets/js/README.md`).
  `core/html.js` es el único sumidero de `innerHTML`; no hay scripts inline (la CSP de `vercel.json` los bloquea). `domain/` es lógica pura, sin DOM ni supabase.
- **Backend**: Supabase `kootszosdejmawanfxug`. Es producción y la única base: no hay staging. Migraciones en `supabase/migrations/`,
  Edge Functions en `supabase/functions/` (todas `verify_jwt = false`; cada handler valida JWT y rol por su cuenta).
  El proyecto `dqgrlflrjcarxlfetvoj` es el anterior: obsoleto, no tocar.
- **Front**: Vercel, sitio estático servido desde `main`, sin build.
- **Docs**: índice en `docs/README.md`. Tablero `10`, runbook `11`, checklist de PR `13`, guía de textos `14`, hoja de ruta `16`, esquema `08`.

## Comandos
| Qué | Comando |
|---|---|
| Lint / sintaxis / unitarias | `npm run lint` · `npm run check` · `npm test` |
| Front nuevo (Vitest) / reglas de lint de `src/` | `npm run test:front` · `npm run test:lint` |
| SQL (migraciones x2 + pruebas por rol, Postgres desechable) | `tests/sql/run.sh` |
| Smoke con Supabase simulado (33 modos; el CI los corre todos; lista en `scripts/smoke-modos.sh`) | `scripts/smoke-modos.sh [modo ...]` o `tests/smoke/run.sh <modo>` |
| E2E contra Postgres + PostgREST reales | `npm run e2e` (un test: `node --test --test-name-pattern="X" tests/e2e/e2e.test.mjs`) |
| Capturas para revisión visual | `tests/visual/run.sh [escena ...]` → `tests/visual/out/` |
| Edge Functions | `deno task --config supabase/functions/deno.json check\|test` |
| Servir local | `npm run serve` y abrir `/adminpanel` (no `file://`) |

CI corre Postgres 16; producción es 17. Ambos deben pasar. Un PR no se fusiona con CI rojo.

## Reglas
- **Ramas**: nunca se empuja a `main`. El trabajo de una oleada se acumula en la rama `dev` y entra a `main` en un solo PR `dev → main` al cerrarla (`gh pr merge --merge`, sin `--delete-branch`: `dev` no se borra). Un cambio suelto fuera de una oleada puede ir en rama propia con su PR.
  Nunca borrar una rama con PR abierto o sin fusionar.
- **Git**: `git add` con rutas explícitas, nunca `-A` ni `.`; mirar `git status` antes. Mensajes de commit con prefijo de fase (`F7: ...`) cuando aplique.
- **Secretos**: gitleaks escanea todas las ramas y el historial. Sin claves ni contraseñas de ejemplo de alta entropía en ningún commit,
  y nunca ampliar el allowlist de `.gitleaks.toml` para acomodar un valor. No pedir ni pegar claves secretas en la conversación.
- **Migraciones**: se aplican con el **CLI**, nunca con el MCP `apply_migration` (registra la versión por fecha y desalinea el historial).
  Orden obligatorio: migración aplicada y verificada → recién entonces se fusiona el front o se despliega la función que la usa.
  Deben ser idempotentes (el CI las aplica dos veces), sin `begin/commit`, con `search_path` vacío en `SECURITY DEFINER`. Procedimiento: skills `neumet-migracion` y `neumet-aplicar-migracion`.
- **Seguridad de datos**: la visibilidad se hace cumplir en la base, no en la interfaz. La RLS filtra filas, no columnas: para ocultar
  una columna (precios, costos) se usan privilegios por columna. Se prueba con la API real y el JWT de cada rol (admin, global, sucursal, sin perfil, `api`).
- **Pruebas**: un arreglo de bug trae un test que falla sin el arreglo. Todo `console.error` o «Acción desconocida» en un flujo falla la prueba.
  Los smoke con datos simulados no bastan: lo que toque la base se prueba también en `e2e`.
- **Textos de la interfaz**: `docs/14-guia-de-textos.md`. Sin segunda persona (infinitivo: «Elegir posición»), sin emojis ni exclamaciones,
  rojo solo para lo crítico, nunca solo color para comunicar estado. Comentarios de código: el porqué, no lo obvio.
- **Simplicidad para el operario** (decisión del 2026-11-13, confirmada con un cliente): el operario tiene pocos conocimientos de tecnología; plataforma intuitiva, pocos clics y «enter», sin pasos innecesarios ni confusos.
  Todo cambio de interfaz se revisa contra este principio (reglas verificables en `docs/14`, sección 5); el PR declara los clics de las tareas frecuentes que toca y no los aumenta sin justificación (referencia: auditoría pendiente de `docs/10` o, sin ella, el conteo sobre `main`).
- **Norte del producto**: la sugerencia de rotación para camiones y buses es la prioridad fuerte (F8); el perfil `admin` pasa a ser interno del equipo Neumet y cada cliente tendrá su administrador de empresa (F10, plan pendiente). Ver `docs/16`.
- **Docs**: el PR que cambia comportamiento actualiza en el mismo PR lo que corresponda (apéndice de `docs/08`, `docs/10`, README si cambian conteos). Skill `neumet-docs-sync`.
- **Tras desplegar**: el navegador cachea módulos ES; ante vistas vacías, recarga forzada (Cmd+Shift+R) antes de investigar.

## Roles y oleadas
| Rol | Quién | Modelo | Esfuerzo | Para qué |
|---|---|---|---|---|
| Project Manager | sesión principal (`.claude/agents/neumet-project-manager.md`) | opus | medium | Habla con el usuario, coordina la oleada, lanza agentes, integra en `dev` y hace el PR a `main` |
| Technical Leader | `.claude/agents/neumet-technical-leader.md` | opus | medium | Planifica la oleada en archivos de tarea, revisa sin frenar y corrige en el sitio los fallos claros |
| Developer | `.claude/agents/neumet-developer.md` | haiku | high | Implementa una tarea en su worktree con sus pruebas rápidas en verde |

Especialistas, a pedido del PM: `neumet-operativo` (haiku, sin edición: aplicar migraciones, desplegar, limpiar worktrees), `neumet-dba` (opus, solo lectura y MCP de lectura de Supabase: rendimiento, RLS e índices) y `neumet-ux` (opus, navegador con datos simulados: clics, textos y capturas; necesita la extensión de Chrome conectada con `/chrome`, de preferencia un perfil sin sesiones reales).

**El usuario solo decide lo de alto nivel**: negocio, alcance, prioridades, una migración que borre datos o riesgo sobre datos reales. Todo lo técnico lo resuelven el PM y el TL. Nunca se le pide revisar ni fusionar un PR.

Se trabaja en **oleadas cortas**, y al cerrar cada una se frena para que el usuario audite el flujo. El PM sigue la skill `neumet-oleada`. Lo que vale para todos:
- El plan de cada oleada vive en `.claude/oleadas/<oleada>/`, sin versionar: un `plan.md` con el índice y un archivo por tarea. Cada developer lee solo el suyo.
- Cada tarea es un área que no comparte archivos con las otras de su ronda; como máximo una con migración por oleada. Sin tope de líneas (decisión del usuario, 2026-11-26).
- Las tareas se integran en `dev` a medida que terminan. Durante la oleada, cada una pasa solo las pruebas rápidas de lo que toca (`npm run verificar:rapido` y, si toca SQL, `tests/sql/run.sh`). Lo caro (CI completo, `e2e`, todos los smoke) corre una vez, en el PR `dev → main`.
- **La revisión no frena el trabajo en `dev`**: una sola ronda del TL, solo fallos graves; lo claro y pequeño lo corrige él en el sitio y lo menor queda en `docs/10` (pendientes). Antes del PR a `main` tienen que estar revisadas las migraciones, RLS, Edge Functions y datos sensibles de la oleada.
- **Hacia producción, al cerrar**: CI verde en el PR `dev → main` → migración aplicada con el CLI → fusión → función desplegada → verificación sobre `main`. Con eso cumplido el PM lo hace sin pedir permiso.
- Los subagentes no lanzan otros subagentes: solo el PM. Los agentes en segundo plano no sobreviven a un reinicio: su trabajo queda en `.claude/worktrees/agent-*`.

## Skills del proyecto (`.claude/skills/`)
| Skill | Para qué |
|---|---|
| `neumet-oleada` | Procedimiento del PM: planificar, lanzar, integrar en `dev`, cerrar con el PR a `main` y auditar |
| `neumet-verificar` | Correr localmente lo que correría el CI, escalonado según lo que cambió |
| `neumet-migracion` | Escribir y revisar una migración (no la aplica) |
| `neumet-aplicar-migracion` | `db push` con dry-run y verificación, al cerrar la oleada |
| `neumet-operar` | Desplegar funciones, regenerar demo, limpiar worktrees y ramas (`demo` solo a pedido) |
| `neumet-docs-sync` | Detectar y corregir desfases entre docs y código |
| `neumet-auditoria-db` | Auditoría de BD solo lectura (advisors, RLS, planes, índices); la usa `neumet-dba`, nunca aplica |
| `neumet-auditoria-ux` | Auditoría de UX/UI navegando el panel simulado (`tests/visual/navegar.sh`): clics, textos, móvil; la usa `neumet-ux` |
