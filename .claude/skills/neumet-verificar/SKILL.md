---
name: neumet-verificar
description: Correr localmente las comprobaciones que ejecutaría el CI de NEUMET, escalonadas según los archivos que cambió la rama (lint, unitarias, SQL, smoke, e2e, Edge Functions, secretos). Usar antes de abrir o aprobar un PR, o cuando se pida "verificar", "correr las pruebas" o "ver si pasa el CI".
---

# Verificar la rama como lo haría el CI

Elegir el nivel según el diff, no correr todo siempre (e2e y SQL son lentas).

## 1. Qué cambió
```
git diff --name-only origin/main...HEAD
git status --short
```

## 2. Niveles
| Si el diff toca... | Correr |
|---|---|
| Siempre | `npm run lint && npm run check && npm test` |
| `supabase/migrations/**`, `tests/sql/**`, `supabase/seed/**` | `tests/sql/run.sh` |
| `supabase/functions/**` | `deno task --config supabase/functions/deno.json check`, `deno lint --config supabase/functions/deno.json supabase/functions`, `deno task --config supabase/functions/deno.json test` |
| `assets/**`, `adminpanel/**` | `tests/smoke/run.sh` para cada modo relevante: `admin cliente secuser detalle flota sinperfil api montar` (si hay duda, los ocho) |
| Migración, vista, RPC, o cualquier flujo que lea/escriba la base | `npm run e2e` (el smoke simulado no alcanza) |
| Interfaz visible | `tests/visual/run.sh <escenas>` y mirar los PNG de `tests/visual/out/` en escritorio y móvil |
| `vercel.json`, `.gitleaks.toml` | `python3 -m json.tool vercel.json >/dev/null` y `npm test` (incluye `despliegue.test.mjs`) |
| Antes de empujar | `gitleaks git --no-banner --redact .` si el binario existe |

Además: buscar marcadores de conflicto sin resolver, que ya costaron un PR (#51):
```
git grep -nE '^(<<<<<<<|>>>>>>>) ' -- . ':!node_modules' ':!*.md' || echo "sin marcadores"
```

## 3. Reglas de ejecución
- Correr en el directorio del worktree de la rama, no en el repo principal, para no mezclar estados.
- `tests/sql/run.sh` y `npm run e2e` necesitan binarios de Postgres (`brew install postgresql@17`) o `TEST_PG_URL` / `E2E_PG_URL`.
  El e2e en macOS necesita además `libpq`. Si falta algo, el script sale con código 2 explicándolo.
- Un solo test e2e: `node --test --test-name-pattern="X" tests/e2e/e2e.test.mjs`.

## 4. Informar
Reportar cada comando con su resultado real. Lo que no se pudo correr (herramienta ausente, entorno) se dice como **no ejecutado**, con el motivo;
nunca como "pasó". Si algo falla, mostrar la salida relevante y no continuar con los niveles siguientes hasta entender la causa.
