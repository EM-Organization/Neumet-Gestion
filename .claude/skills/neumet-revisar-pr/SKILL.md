---
name: neumet-revisar-pr
description: Revisar un PR de NEUMET con el checklist de docs/13: ejecutar los caminos nuevos, probar por rol, leer migraciones enteras, revisión visual y de textos. Usar cuando se pida revisar, aprobar o fusionar un PR. Idealmente lo corre un subagente opus distinto del autor.
---

# Revisión de PR

Argumento: número de PR. El rigor completo está en `docs/13-checklist-revision-prs.md`; esto es el procedimiento.
**Revisar no es fusionar**: este skill termina en un veredicto. Fusionar es un paso aparte, después de aplicar la migración si la hay.

## 1. Contexto
```
gh pr view <n> --json title,body,headRefName,baseRefName,mergeable,statusCheckRollup,files
gh pr diff <n> --name-only
gh pr checks <n>
```
- Si el CI está rojo: veredicto «cambios solicitados» sin más (salvo que el rojo sea de infraestructura y se pueda demostrar).
- Si `mergeable` es `CONFLICTING`: pedir merge de `origin/main` antes de seguir.
- Buscar marcadores de conflicto olvidados en los archivos del diff.

## 2. Traer la rama sin pisar el repo principal
```
git fetch origin pull/<n>/head:revisar-<n>
git worktree add .claude/worktrees/revisar-<n> revisar-<n>
```
Trabajar ahí. Al terminar, quitar el worktree y la rama local `revisar-<n>`.

## 3. Ejecutar, no solo leer
1. Skill `neumet-verificar` en el worktree. Un test que "pasa" porque nunca corrió el camino nuevo no cuenta: confirmar que los tests nuevos fallan sin el cambio
   (`git stash`/checkout del archivo de producción y re-correr el test).
2. Probar los casos de `docs/13` §1: datos vacíos, `null`, un registro, muchos; cada rol (admin, global, sucursal, sin perfil, `api`); consulta que falla; campo inexistente; sin permiso.
3. Datos ocultos por rol (precios, costos): pedir la columna directa, `select=*`, con filtro/orden y embebida, con el JWT de cada rol. La RLS no filtra columnas.
4. Si cambia algo servido por Vercel, pensar en la caché de módulos ES.

## 4. Migración (si hay)
Leerla **entera**, no el diff por encima:
- `SECURITY DEFINER` con `set search_path = ''` y autorización interna (42501 uniforme al denegar).
- `grant`/`revoke` explícitos; ningún grant a `anon`; privilegios por columna donde corresponda.
- RLS habilitada en tablas nuevas, políticas para cada rol, sin `using (true)` por descuido.
- Idempotente (el CI la aplica dos veces), sin `begin/commit`, orden coherente con las migraciones previas (el timestamp es único y posterior a la última de `main`).
- Qué pasa con datos existentes en producción (`not null` sin default, `unique` sobre datos viejos, backfill).
- Verificar contra Postgres 16 (CI) y 17 (producción) si usa algo sensible a la versión.
Avisar al director: la migración se aplica **antes** de fusionar (`neumet-aplicar-migracion`).

## 5. Interfaz y textos
- `tests/visual/run.sh` y **mirar** las capturas (Read sobre el PNG), escritorio y móvil. Rechazar texto cortado, superposiciones, tablas desbordadas, contraste insuficiente, estado solo por color.
- Textos contra `docs/14-guia-de-textos.md`: sin segunda persona, sin emojis, frases cortas, estados vacíos accionables, rojo solo crítico.

## 6. Seguridad general
Secretos o valores de alta entropía en el diff (gitleaks), `innerHTML` fuera de `core/html.js`, scripts inline, `console.error` nuevos, cambios a `vercel.json`/CSP, ampliaciones del allowlist de `.gitleaks.toml` (rechazar).

## 7. Veredicto
Responder con esta forma:
```
Veredicto: APROBADO | CAMBIOS SOLICITADOS
Migración: ninguna | <archivo> — leída entera; aplicar antes de fusionar
Ejecutado: <comandos y resultado real; lo no ejecutado, marcado como tal>
Bloqueantes: <lista con archivo:línea y escenario concreto que falla>
Sugerencias (no bloqueantes): <lista>
```
Cada bloqueante lleva el caso concreto que lo reproduce, no una opinión. Si no se encontró nada, decirlo y listar qué se probó para que la ausencia de hallazgos sea verificable.
