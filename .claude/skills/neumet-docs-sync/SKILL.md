---
name: neumet-docs-sync
description: Detectar y corregir desfases entre la documentación de NEUMET (README, docs/10 tablero, docs/11 runbook, docs/08, docs/README) y el código real: conteo y última migración, funciones, scripts, estado de fases. Usar al cerrar un PR que cambia comportamiento o cuando la documentación parezca vieja.
---

# Sincronizar documentación con el código

La documentación vigente es parte del producto (el revisor la lee). Los desfases más comunes son números copiados a mano en varios lugares.

## 1. Hechos reales (fuente de verdad: el código)
```
ls supabase/migrations | wc -l
ls supabase/migrations | tail -3
ls supabase/functions | grep -v -E 'deno\.(json|lock)'
cat package.json | grep -A8 '"scripts"'
ls tests/sql | wc -l && ls tests/e2e/specs | wc -l
grep -n '^## [A-Z]\.1' docs/08-esquema-datos.md | tail -2
supabase migration list --remote 2>/dev/null | tail -3      # opcional: ¿lo aplicado coincide?
```

## 2. Dónde buscar menciones a corregir
```
git grep -nE '([0-9]+) (migraciones|archivos)|hasta `?2026[0-9]{10}' -- README.md docs/*.md tests/*/README.md
git grep -nE 'apply_migration' -- README.md docs/*.md CLAUDE.md
git grep -nE 'Actualizado: 20' -- docs/10-tablero.md
```
Comparar cada número y cada «aplicadas hasta» con lo del paso 1. Revisar también:
- `README.md` §7 (scripts y pruebas), §8 (despliegue), §10 (estructura), §11 (pendientes) y §9 (procesos).
- `docs/10-tablero.md`: infraestructura, hecho, pendientes y fecha de «Actualizado».
- `docs/11-runbook-operacion.md` §3.2 (lista de migraciones) y §4 (requisitos del demo).
- `docs/README.md`: tabla de vigentes/histórico y la descripción de cada documento.
- `tests/e2e/README.md`, `tests/smoke/README.md`: lista de specs y modos.

## 3. Contradicciones conocidas a resolver
- **MCP vs CLI**: `README.md` §8 y `docs/11` §3.2–3.3 todavía ofrecen `apply_migration`/`deploy_edge_function` por MCP. La regla vigente (ver `CLAUDE.md`) es el CLI,
  porque el MCP desalinea el historial. Dejar el CLI como método y, si se conserva el MCP, marcarlo como no recomendado y explicar por qué.
- Evitar que la lista de migraciones del runbook se vuelva a desactualizar: preferir referirse a `supabase/migrations/` y a `supabase migration list` en lugar de enumerarlas.

## 4. Corregir
- Editar solo lo que está desfasado; no reescribir documentos que están bien. Respetar `docs/14-guia-de-textos.md` (infinitivo, sin segunda persona, sin emojis).
- Un hecho que cambia seguido (conteos, «hasta X») se menciona en el menor número de lugares posible; en los demás, enlazar.
- Las fechas de «Actualizado» se ponen con la fecha real del cambio.
- Terminar con `git diff --stat` y un resumen de qué número cambió de cuánto a cuánto, para que el revisor lo verifique rápido.
