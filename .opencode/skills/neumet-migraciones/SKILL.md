---
name: neumet-migraciones
description: Reglas para migraciones SQL de NEUMET: aplicar solo con el CLI, idempotencia, sin begin/commit, search_path vacío en SECURITY DEFINER, orden migración-antes-de-front, nunca dos migraciones en paralelo. Cargar cuando un cambio trae SQL o toca la base.
---

# Migraciones en NEUMET

Procedimiento completo: skills `neumet-migracion` (escribir y revisar) y `neumet-aplicar-migracion` (aplicar). Esto es lo que no se negocia.

## Escribir
- Idempotentes: el CI las aplica dos veces. `create ... if not exists`, `drop policy if exists` antes de `create policy`, etc.
- Sin `begin` / `commit`: el CLI maneja la transacción.
- `SECURITY DEFINER` siempre con `set search_path = ''` y nombres calificados (`public.tabla`).
- Timestamp y letra de apéndice que asigne el technical-leader; no se eligen solos.
- Una migración ya aplicada en producción no se edita: se agrega otra posterior.
- Si toca RLS o privilegios por columna, cargar también `neumet-seguridad-datos`.

## Aplicar
- Solo con el **CLI** (`supabase db push`). Nunca con el MCP `apply_migration`: registra la versión por fecha y desalinea el historial.
- Antes: `supabase db push --dry-run` limpio.
- Orden obligatorio: migración aplicada y verificada → recién entonces se fusiona el front o se despliega la función que la usa.
- Nunca dos PR con migración en producción al mismo tiempo.
- Una migración que borra datos o toca datos reales de clientes se consulta al usuario antes de aplicar.
