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
| SQL (migraciones x2 + pruebas por rol, Postgres desechable) | `tests/sql/run.sh` |
| Smoke con Supabase simulado | `tests/smoke/run.sh admin\|cliente\|secuser\|detalle\|flota\|sinperfil\|api\|montar` |
| E2E contra Postgres + PostgREST reales | `npm run e2e` (un test: `node --test --test-name-pattern="X" tests/e2e/e2e.test.mjs`) |
| Capturas para revisión visual | `tests/visual/run.sh [escena ...]` → `tests/visual/out/` |
| Edge Functions | `deno task --config supabase/functions/deno.json check\|test` |
| Servir local | `npm run serve` y abrir `/adminpanel` (no `file://`) |

CI corre Postgres 16; producción es 17. Ambos deben pasar. Un PR no se fusiona con CI rojo.

## Reglas
- **Ramas**: nunca se empuja a `main`; cada cambio va en rama propia y entra por PR. Fusionar con `gh pr merge --merge --delete-branch`.
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
- **Docs**: el PR que cambia comportamiento actualiza en el mismo PR lo que corresponda (apéndice de `docs/08`, `docs/10`, README si cambian conteos). Skill `neumet-docs-sync`.
- **Tras desplegar**: el navegador cachea módulos ES; ante vistas vacías, recarga forzada (Cmd+Shift+R) antes de investigar.

## Subagentes y trabajo en paralelo
Para tareas complejas el agente principal actúa de **director**: planifica y delega con `Agent` (en segundo plano, sin polling), y queda libre para el usuario.
Cada autor trabaja en su propia rama y worktree (`isolation: "worktree"`); un agente por rama, máximo 3 autores a la vez. Flujo completo en `neumet-orquestar`.

Los roles están definidos en `.claude/agents/` y se lanzan con `subagent_type`:

| Agente | Modelo | Herramientas | Qué hace |
|---|---|---|---|
| `neumet-autor` | `sonnet` | todas | Implementa un área en su rama, con pruebas, y abre el PR |
| `neumet-revisor` | `opus` | solo lectura y Bash | Encuentra bloqueantes y emite veredicto; no puede editar ni fusionar |
| `neumet-corrector` | `sonnet` | todas | Arregla en la rama los bloqueantes del revisor, con un test por cada uno |
| `neumet-operativo` | `haiku` | solo lectura y Bash | Aplicar migraciones, regenerar demo, redesplegar, limpiar worktrees |

Siempre `effort: "medium"`. **Compuerta antes de producción**: autor → revisor → (corrector → revisor, máx. 2 rondas) → migración aplicada → fusión → función desplegada → verificación sobre `main`.
Autor, revisor y corrector de un PR son agentes distintos. Nunca dos PR con migración al mismo tiempo en producción. Los agentes en segundo plano no sobreviven a un reinicio: su trabajo queda en `.claude/worktrees/agent-*`.

## Skills del proyecto (`.claude/skills/`)
| Skill | Para qué |
|---|---|
| `neumet-orquestar` | Modo director: delegar en autores paralelos, revisor, corrector y operativo; compuerta a producción |
| `neumet-verificar` | Correr localmente lo que correría el CI, escalonado según lo que cambió |
| `neumet-pr` | Flujo de autor: rama/worktree, implementación, pruebas, docs, PR |
| `neumet-revisar-pr` | Flujo de revisor con el checklist de `docs/13` |
| `neumet-corregir-pr` | Flujo de corrector: arreglar los bloqueantes del revisor, un test por cada uno |
| `neumet-migracion` | Escribir y revisar una migración (no la aplica) |
| `neumet-aplicar-migracion` | `db push` con dry-run y verificación; solo a pedido |
| `neumet-operar` | Desplegar funciones, regenerar demo, limpiar worktrees y ramas; solo a pedido |
| `neumet-docs-sync` | Detectar y corregir desfases entre docs y código |
