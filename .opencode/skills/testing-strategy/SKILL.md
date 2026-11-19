---
name: testing-strategy
description: Estrategia de pruebas de NEUMET: niveles según el diff (unitarias, test:front, SQL por rol, smoke, e2e, visual), arreglo de bug con test que falla sin él, smoke simulado no basta para datos. Usar al escribir pruebas o decidir qué probar antes de abrir o aprobar un PR.
---

# Estrategia de pruebas en NEUMET

## Principios
1. Un arreglo de bug trae un test que **falla sin el arreglo**. Si no, el bug no está demostrado.
2. Toda lógica nueva tiene unitarias con casos límite, no solo el camino feliz.
3. Los smoke con datos simulados **no bastan**: pueden no coincidir con la base real. Lo que toca datos/backend se prueba también en e2e.
4. Toda política RLS o función SQL nueva tiene pruebas SQL para cada rol permitido y cada rol denegado (admin, cliente global, cliente de sucursal, sin perfil, `api`).
5. Cualquier `console.error` o «Acción desconocida» durante un flujo falla la prueba.
6. Las aserciones comprueban resultados concretos (filas, textos, permisos), no que "algo apareció".

## Niveles según el diff (base: skill `neumet-verificar`)
| Si el diff toca... | Correr |
|---|---|
| Siempre | `npm run lint && npm run check && npm test` |
| `src/**` | `npm run test:front` y `npm run test:lint` |
| `supabase/migrations/**`, `tests/sql/**`, `supabase/seed/**` | `tests/sql/run.sh` (aplica migraciones x2: idempotencia) |
| `supabase/functions/**` | `deno task --config supabase/functions/deno.json check` · `deno lint` · `deno task ... test` |
| `assets/**`, `adminpanel/**` | `tests/smoke/run.sh` para cada modo relevante (si hay duda, los 23) |
| Migración, vista, RPC o flujo que lea/escriba la base | `npm run e2e` (obligatorio, con datos de demo) |
| Interfaz visible | `tests/visual/run.sh <escenas>` y mirar los PNG (escritorio y móvil) |
| `vercel.json`, `.gitleaks.toml` | `python3 -m json.tool vercel.json` y `npm test` |
| Antes de empujar | `gitleaks git --no-banner --redact .` |

## Casos que no se olvidan
- Datos vacíos, `null`, un registro, muchos registros.
- Cada rol y una sesión sin perfil; pedir la columna directa, `select=*`, con filtro/orden y embebida.
- Doble envío, Enter mantenido (`e.repeat`), cambios superpuestos, fallo a mitad, respuesta que nunca llega, recarga que pisa texto (`docs/13` §1.b).

## Ejecución honesta
- Correr en el worktree de la rama, nunca en el repo principal. `npm run preparar` primero.
- `tests/sql/run.sh` y `npm run e2e` necesitan Postgres local (`brew install postgresql@17`) o `TEST_PG_URL`/`E2E_PG_URL`; el e2e en macOS además `libpq`.
- Un solo test e2e: `node --test --test-name-pattern="X" tests/e2e/e2e.test.mjs`.
- Reportar cada comando con su resultado real. Lo no ejecutado se declara **no ejecutado** con el motivo, nunca "pasó".
