---
name: neumet-operar
description: Tareas operativas de NEUMET sobre producción y el entorno local: desplegar Edge Functions, regenerar el demo, ver el estado de migraciones, poner al día con main las ramas de los PR abiertos (`ramas`: push sin force, nunca a main) y limpiar worktrees y ramas ya fusionados. Lo usa el director sin pedir confirmación cuando la compuerta de calidad está cumplida; afecta producción o borra ramas locales. Apto para un subagente haiku.
---

# Operación

Argumento: la tarea (`funcion <nombre>`, `demo`, `estado`, `limpiar`, `ramas`). Procedimientos de fondo en `docs/11-runbook-operacion.md`.
Mostrar qué se va a tocar (en el informe) y seguir; con la compuerta cumplida no se espera confirmación.

## `estado`: solo lectura
```
supabase migration list --remote
supabase functions list
gh pr list --state open
git worktree list && git branch -vv
```

## `funcion <nombre>`: desplegar una Edge Function
Funciones: `api-proveedor`, `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional`, `contacto`.
1. La migración de la que depende (si la hay) ya está aplicada y verificada. Si no, parar.
2. `deno task --config supabase/functions/deno.json check` y `... test` (o `deno test --config supabase/functions/deno.json supabase/functions/<nombre>`).
3. `supabase functions deploy <nombre>` (proyecto enlazado). El `verify_jwt = false` sale de `supabase/config.toml`; si hiciera falta forzarlo, `--no-verify-jwt`.
   Desplegar con JWT activo rompe el preflight CORS y el login de la app de medición.
4. Comprobar con `supabase functions list` y una llamada de humo (p. ej. sin token debe dar 401/405, no 500). Revisar logs si algo raro.
5. Secretos: nunca pedirlos ni mostrarlos. Si faltan (`ALLOWED_ORIGINS`, `RESEND_API_KEY`...), indicar cuál y que lo carga el dueño (`supabase secrets set`).

## `demo`: regenerar `supabase/seed/demo.sql` (solo a pedido del dueño)
**Borra y regenera** todo lo regenerable de `Demo Transportes` (eventos, mediciones, neumáticos, stock), incluido lo hecho a mano en pruebas. No toca otros clientes.
1. Todas las migraciones aplicadas y el cliente `Demo Transportes` existe (creado desde el panel).
2. Ejecutar el archivo completo con un rol que no esté sujeto a RLS. El método con el CLI (`supabase db query --remote -f supabase/seed/demo.sql`) no está
   verificado para este script: probarlo primero y, si el rol no alcanza, usar el SQL Editor de Supabase o `psql`. Nunca contra un cliente real.
3. Verificar en el panel que Inicio, Alertas y Stock muestran datos con fechas actuales (recarga forzada).

## `ramas`: poner al día los PR abiertos tras una fusión
Empuja a ramas de PR ajenas (sin `--force`, nunca a `main`). El brief del director debe listar las ramas con autor, corrector o revisor activo: esas se saltan.
1. `gh pr list --state open --json number,headRefName,baseRefName,isCrossRepository`. Saltar y reportar: `headRefName == main`, PR de forks (`isCrossRepository`), PR apilados (`baseRefName` distinto de `main`),
   las ramas que el director indicó con agente activo y las que tengan un worktree `agent-*` o `corregir-*` de esa rama (`git worktree list`): riesgo de pisar un push en curso.
2. Por cada rama restante: `git fetch origin`, worktree propio (`git worktree add .claude/worktrees/ramas-<n> origin/<rama>`; queda en HEAD desacoplado), `git merge --no-edit origin/main` y,
   si queda limpio, `git push origin HEAD:<rama>` (un `git push` a secas falla con «not currently on a branch»; nunca `--force`). Quitar el worktree.
3. Si el push es rechazado (alguien empujó en medio): reportar y no reintentar ni forzar.
4. Si hay conflicto: `git merge --abort`, no tocar la rama y reportar al director PR y archivos en conflicto; los resuelve el corrector.
5. Informar tabla: PR, al día / conflicto / saltado (motivo) / sin cambios. Aviso: tras el merge el SHA cambia, así que el CI debe volver a pasar antes de fusionar un PR ya aprobado.

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
