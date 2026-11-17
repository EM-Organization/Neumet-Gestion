# NEUMET · Gestión

Plataforma de gestión del desgaste de neumáticos: calibre → app móvil → API → panel web. Todo en español (interfaz, docs, commits, PR).
El estado cambiante del trabajo vive en `docs/10-tablero.md`, no aquí.

> Este archivo guía al **equipo de agentes de OpenCode** (`.opencode/agents/`). `CLAUDE.md` es su equivalente para Claude Code; las reglas de proyecto son las mismas en ambos.

## Mapa
- **Panel**: SPA de módulos ES sin bundler ni framework. `adminpanel/index.html` + `assets/js/` (estructura en `assets/js/README.md`).
  `core/html.js` es el único sumidero de `innerHTML`; no hay scripts inline (la CSP de `vercel.json` los bloquea). `domain/` es lógica pura, sin DOM ni supabase.
- **Front nuevo**: Svelte 5 + Vite en `src/` (Vitest en `npm run test:front`).
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
| Smoke con Supabase simulado | `tests/smoke/run.sh admin\|cliente\|secuser\|detalle\|flota\|sinperfil\|api\|montar\|empresa\|empresa-sucursal\|empresa-admin` |
| E2E contra Postgres + PostgREST reales | `npm run e2e` (un test: `node --test --test-name-pattern="X" tests/e2e/e2e.test.mjs`) |
| Capturas para revisión visual | `tests/visual/run.sh [escena ...]` → `tests/visual/out/` |
| Edge Functions | `deno task --config supabase/functions/deno.json check\|test` |
| Servir local | `npm run serve` y abrir `/adminpanel` (no `file://`) |
| Worktree listo (deps + lint + check) | `npm run preparar` |

CI corre Postgres 16; producción es 17. Ambos deben pasar. Un PR no se fusiona con CI rojo.

## Reglas del proyecto
- **Ramas**: nunca se empuja a `main`; cada cambio va en rama propia (`feat/`, `fix/`, `chore/`) y entra por PR. Fusionar con `gh pr merge --merge --delete-branch`.
  Nunca borrar una rama con PR abierto o sin fusionar.
- **Git**: `git add` con rutas explícitas, nunca `-A` ni `.`; mirar `git status` antes. Commits convencionales (`feat:`, `fix:`, `chore:`) con prefijo de fase (`F7: ...`) cuando aplique. Sin force-push.
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
  Todo cambio de interfaz se revisa contra este principio (reglas verificables en `docs/14`, sección 5); el PR declara los clics de las tareas frecuentes que toca y no los aumenta sin justificación.
- **Norte del producto**: la sugerencia de rotación para camiones y buses es la prioridad fuerte (F8); el perfil `admin` pasa a ser interno del equipo Neumet y cada cliente tendrá su administrador de empresa (F10, plan pendiente). Ver `docs/16`.
- **Docs**: el PR que cambia comportamiento actualiza en el mismo PR lo que corresponda (apéndice de `docs/08`, `docs/10`, README si cambian conteos). Skill `neumet-docs-sync`.
- **Tras desplegar**: el navegador cachea módulos ES; ante vistas vacías, recarga forzada (Cmd+Shift+R) antes de investigar.

## Equipo de agentes (OpenCode, `.opencode/agents/`)
| Agente | Modo | Modelo | Qué hace |
|---|---|---|---|
| `director` | primario | `opencode-go/glm-5.3` | habla con el usuario, planifica y delega; no programa; controla la compuerta |
| `autor` | subagente | `opencode-go/kimi-k2.7-code` | implementa un área en su rama/worktree, con pruebas, y abre el PR |
| `revisor` | subagente | `opencode-go/glm-5.3` | solo lectura + bash: ejecuta caminos nuevos, veredicto APROBADO/CAMBIOS SOLICITADOS |
| `corrector` | subagente | `opencode-go/kimi-k2.7-code` | arregla solo los bloqueantes del revisor, un test por cada uno |
| `operativo` | subagente | `opencode-go/glm-5.3-flash` | tareas mecánicas: ramas al día, migración ya aprobada, despliegue, limpieza |
| `tester` | subagente | `opencode-go/kimi-k2.7-code` | reproduce bugs y escribe e2e/integración; solo edita `tests/**` |
| `dba` | subagente | `opencode-go/glm-5.3` | auditoría de BD solo lectura: rendimiento, RLS, índices, migraciones |
| `ux` | subagente | `opencode-go/glm-5.3` | auditoría UX/UI: clics, textos, revisión visual con `tests/visual/run.sh` |

Configuración en `opencode.json`: `default_agent: "director"` y permisos de shell (git/gh/tests/lint permitidos; push a `main` y force-push denegados; operaciones destructivas con `ask`). GitHub se usa con `gh`, ya autenticado; no hay MCP de GitHub configurado.

## Flujo de trabajo
- **Paralelismo**: máximo 3 autores a la vez; un agente por rama; esfuerzo de razonamiento medio.
- **Independencia**: autor, revisor y corrector de un mismo PR son agentes distintos.
- **Compuerta a producción**: autor → revisores en paralelo, cada uno con un foco distinto (código y seguridad; `ux` si toca interfaz; `dba` si toca migración o RLS pesada) → (corrector → revisor, máximo 2 rondas) → [si aplica: migración aplicada y verificada] → merge → despliegue (si aplica) → verificación sobre `main`.
- **Rondas acotadas**: en la ronda 2 el revisor solo mira los bloqueantes pendientes y el diff nuevo.
- **Migraciones**: nunca dos PR con migración en producción al mismo tiempo. Dry-run limpio antes de aplicar; el orden obligatorio está en las reglas del proyecto.
- **e2e obligatorio**: todo cambio que toque datos/backend se prueba también en `npm run e2e`.
- Tras cada fusión: ramas de PRs abiertos al día con `main` y limpieza de worktrees/ramas fusionadas (`operativo`).

## Autonomía
- Con la compuerta cumplida (veredicto consolidado APROBADO, CI verde, rama al día con `main`, `db push --dry-run` limpio si aplica), el director fusiona, despliega y verifica **sin pedir permiso**.
- Al humano solo se le consulta por: lógica de negocio, dudas críticas (p. ej. una migración que borra datos o riesgo sobre datos reales de clientes) o si tras 2 rondas siguen los bloqueantes.
- Nunca se le pide revisar ni fusionar un PR rutinario.

## Git y GitHub
- Ramas `feat/`, `fix/`, `chore/`; commits convencionales; PR pequeños con descripción (qué / por qué / cómo probar).
- GitHub: el flujo de PR se hace con `gh` (crear, ver, checks, merge), ya autenticado. Nunca se escriben tokens en archivos.
- El director responde al usuario en español, conciso y en bullets, con tres secciones: **Listo** · **Falta** · **Siguiente paso**.

## Skills
- **Dominio** (`.claude/skills/`, compartidos con Claude Code): `neumet-orquestar`, `neumet-pr`, `neumet-revisar-pr`, `neumet-corregir-pr`, `neumet-migracion`, `neumet-aplicar-migracion`, `neumet-operar`, `neumet-verificar`, `neumet-docs-sync`, `neumet-auditoria-db`, `neumet-auditoria-ux`.
- **Genéricos** (`.opencode/skills/`): `clean-code`, `clean-architecture`, `testing-strategy`, `git-pr-workflow`, `code-review-checklist`.
