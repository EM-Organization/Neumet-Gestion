---
name: neumet-proyecto
description: Mapa del repo NEUMET, comandos de verificación (lint, unitarias, SQL, smoke, e2e, Edge Functions) y reglas de despliegue. Cargar al empezar a trabajar en cualquier parte del repo o cuando haya que saber qué comando correr.
---

# Proyecto NEUMET

## Mapa
- **Panel**: SPA de módulos ES sin bundler. `adminpanel/index.html` + `assets/js/` (estructura en `assets/js/README.md`). `core/html.js` es el único sumidero de `innerHTML`; no hay scripts inline (la CSP los bloquea). `domain/` es lógica pura, sin DOM ni supabase.
- **Front nuevo**: Svelte 5 + Vite en `src/`.
- **Backend**: Supabase `kootszosdejmawanfxug`, producción y única base (no hay staging). Migraciones en `supabase/migrations/`, Edge Functions en `supabase/functions/` (todas `verify_jwt = false`; cada handler valida JWT y rol). El proyecto `dqgrlflrjcarxlfetvoj` es obsoleto: no tocar.
- **Front**: Vercel, sitio estático servido desde `main`, sin build.
- **Docs**: índice `docs/README.md`. Tablero `10`, runbook `11`, checklist de PR `13`, textos `14`, hoja de ruta `16`, esquema `08`.

## Comandos
| Qué | Comando |
|---|---|
| Lint / sintaxis / unitarias | `npm run lint` · `npm run check` · `npm test` |
| Front nuevo / reglas de `src/` | `npm run test:front` · `npm run test:lint` |
| SQL (migraciones x2 + pruebas por rol) | `tests/sql/run.sh` |
| Smoke con Supabase simulado | `tests/smoke/run.sh <modo>` (lista en `scripts/smoke-modos.sh`) |
| E2E contra Postgres + PostgREST reales | `npm run e2e` (un test: `node --test --test-name-pattern="X" tests/e2e/e2e.test.mjs`) |
| Capturas visuales | `tests/visual/run.sh [escena ...]` → `tests/visual/out/` |
| Edge Functions | `deno task --config supabase/functions/deno.json check\|test` |
| Worktree listo (deps + lint + check) | `npm run preparar` |

CI corre Postgres 16; producción es 17. Ambos deben pasar. Un PR no se fusiona con CI rojo.

## Salida acotada
Pruebas y build con `2>&1 | tail -40`. Archivos por rango, `grep` antes que leer enteros.

## Después de desplegar
El navegador cachea módulos ES: ante vistas vacías, recarga forzada (Cmd+Shift+R) antes de investigar.
