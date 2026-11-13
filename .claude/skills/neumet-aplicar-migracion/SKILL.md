---
name: neumet-aplicar-migracion
description: Aplicar a producción (Supabase kootszosdejmawanfxug) las migraciones pendientes de NEUMET con el CLI, con dry-run previo y verificación posterior. Lo ejecuta el director (o `neumet-operativo`) en cuanto la compuerta de calidad está cumplida; modifica la base de producción.
---

# Aplicar migraciones a producción

Esto escribe en la única base de datos real. Pasos en orden; revisar el resultado de cada paso antes de seguir y detenerse solo si algo no es lo esperado.
Usar el **CLI**, nunca el MCP `apply_migration`: registra la versión por fecha y desalinea el historial de migraciones.

## 0. Precondiciones
- El PR de la migración fue **aprobado** por un revisor (`neumet-revisar-pr`) y el CI está en verde.
- Repo principal en `main` limpio. `supabase` CLI logueado y linkeado a `kootszosdejmawanfxug`: `supabase migration list --remote` debe responder sin error.
- Autorización duradera del dueño (no se pide confirmación por cada migración). Un front viejo puede romperse entre la aplicación y la fusión si la migración no es compatible hacia atrás; en ese caso, fusionar de inmediato después.

## 1. Estado actual
```
supabase migration list --remote     # desde la raíz del repo
```
Cada versión local debe tener su par remoto. Si hay una remota sin archivo local o viceversa **que no sea la nueva**, parar y reparar el historial antes de seguir.

## 2. Traer el archivo (si la migración aún está solo en la rama del PR)
```
git fetch origin <rama>
git show origin/<rama>:supabase/migrations/<archivo>.sql > supabase/migrations/<archivo>.sql
```
Leer el archivo completo una vez más. Que sea el mismo que aprobó el revisor (`git diff origin/<rama> -- supabase/migrations/<archivo>.sql` vacío).

## 3. Dry-run
```
supabase db push --remote --dry-run
```
Debe listar **exactamente** las migraciones esperadas y ninguna más. Si lista otras, parar.

## 4. Aplicar
```
supabase db push --remote --yes
```

## 5. Verificar
```
supabase migration list --remote          # la nueva figura en local y remoto
```
- Advisors de seguridad y rendimiento (MCP `get_advisors`) sin errores nuevos.
- `supabase db query --remote --read-only -f supabase/audit/rls_audit.sql` (solo lectura). No consultar vistas que usen funciones sin `execute` para el rol del CLI.
- Una consulta de humo propia de la migración (existe la tabla/función/vista, política esperada).

## 6. Limpiar el archivo traído de la rama
Si el archivo se copió desde el PR, quitarlo del working tree de `main` para que la fusión del PR no choque:
```
git rm --cached supabase/migrations/<archivo>.sql 2>/dev/null; rm supabase/migrations/<archivo>.sql
git status --short    # debe quedar limpio
```

## 7. Siguiente
Avisar que ya se puede fusionar el front (`gh pr merge <n> --merge --delete-branch`) y, si hay función que depende de la migración, desplegarla **después**
(`neumet-operar`). Anotar la migración aplicada en `docs/10-tablero.md` y correr `neumet-docs-sync`.

## Si algo falla
No reintentar a ciegas. `supabase db push` es transaccional por migración: si falló, la base queda como estaba. Mostrar el error completo y diagnosticar
(orden de timestamps, dependencia no aplicada, dato existente que viola una restricción).
