---
name: neumet-operar
description: Tareas operativas de NEUMET sobre producción y el entorno local: desplegar Edge Functions, regenerar el demo, ver el estado de migraciones y limpiar worktrees y ramas ya fusionados. Lo usa el director sin pedir confirmación cuando la compuerta de calidad está cumplida; afecta producción o borra ramas locales. Apto para un subagente haiku.
---

# Operación

Argumento: la tarea (`funcion <nombre>`, `demo`, `estado`, `limpiar`). Procedimientos de fondo en `docs/11-runbook-operacion.md`.
Mostrar qué se va a tocar (en el informe) y seguir; con la compuerta cumplida no se espera confirmación.

## `estado`: solo lectura
```
supabase migration list --remote
supabase functions list --project-ref kootszosdejmawanfxug
gh pr list --state open
git worktree list && git branch -vv
```

## `funcion <nombre>`: desplegar una Edge Function
Funciones: `api-proveedor`, `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional`, `contacto`.
1. La migración de la que depende (si la hay) ya está aplicada y verificada. Si no, parar.
2. `deno task --config supabase/functions/deno.json check` y `... test` (o `deno test --config supabase/functions/deno.json supabase/functions/<nombre>`).
3. `supabase functions deploy <nombre> --project-ref kootszosdejmawanfxug`. El `verify_jwt = false` sale de `supabase/config.toml`; no pasar `--verify-jwt`.
   Desplegar con JWT activo rompe el preflight CORS y el login de la app de medición.
4. Comprobar con `supabase functions list` y una llamada de humo (p. ej. sin token debe dar 401/405, no 500). Revisar logs si algo raro.
5. Secretos: nunca pedirlos ni mostrarlos. Si faltan (`ALLOWED_ORIGINS`, `RESEND_API_KEY`...), indicar cuál y que lo carga el dueño (`supabase secrets set`).

## `demo`: regenerar `supabase/seed/demo.sql`
**Borra y regenera** todo lo regenerable de `Demo Transportes` (eventos, mediciones, neumáticos, stock), incluido lo hecho a mano en pruebas. No toca otros clientes.
1. Todas las migraciones aplicadas y el cliente `Demo Transportes` existe (creado desde el panel).
2. Ejecutar el archivo completo con un rol que no esté sujeto a RLS. El método con el CLI (`supabase db query --remote -f supabase/seed/demo.sql`) no está
   verificado para este script: probarlo primero y, si el rol no alcanza, usar el SQL Editor de Supabase o `psql`. Nunca contra un cliente real.
3. Verificar en el panel que Inicio, Alertas y Stock muestran datos con fechas actuales (recarga forzada).

## `limpiar`: worktrees y ramas fusionados
Solo lo que ya está fusionado. Nunca ramas con PR abierto ni sin fusionar.
```
git fetch origin --prune
git worktree list
git branch --merged origin/main
gh pr list --state open --json headRefName
```
Para cada worktree/rama candidata, mostrar la lista y seguir (solo ramas con PR fusionado); luego:
```
git worktree remove .claude/worktrees/<nombre>      # sin --force; si se queja, hay cambios sin guardar: parar y avisar
git branch -d <rama>                                # -d, nunca -D
```
Una rama `[origin/...: gone]` en `git branch -vv` suele ser una fusionada cuyo remoto se borró; confirmar con `gh pr list --state merged --head <rama>` antes de borrarla.
