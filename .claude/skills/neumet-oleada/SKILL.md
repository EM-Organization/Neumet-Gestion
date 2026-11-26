---
name: neumet-oleada
description: Procedimiento del Project Manager de NEUMET para planificar, ejecutar, integrar en dev y cerrar una oleada (PR dev → main, migración, despliegue y auditoría del flujo). Usar al empezar o retomar una oleada, al integrar una tarea o al cerrarla, o cuando se pida "lanzar agentes", "en paralelo" u "orquestar".
---

# Oleada (procedimiento del PM)

`R=/Users/felipe/Developer/Neumet-Gestion`. Carpeta de la oleada: `$R/.claude/oleadas/<AAAA-MM-DD>-<nombre>/` (ignorada por git).
El PM no implementa: planifica, lanza, integra y habla con el usuario. Los agentes corren en segundo plano; no hacer polling.

## 0. Rama dev
Al empezar la oleada, `dev` tiene que estar al día con `main`:
```bash
git -C $R fetch origin
git -C $R branch -f dev origin/main 2>/dev/null || true   # solo si dev no tiene trabajo sin fusionar
git -C $R push origin dev                                  # sin --force; si lo rechaza, dev tiene trabajo: revisar antes
```

## 1. Planificar
- Fijá el objetivo con el usuario o tomalo de `docs/10` y `docs/16`.
- Lanzá un `neumet-technical-leader` nuevo, en segundo plano y sin worktree, con el encargo «PLANIFICAR»: objetivo, tope de tareas (pocas, máximo 3 por ronda) y carpeta de la oleada. Escribe `plan.md` y un `<X>.md` por tarea, y te devuelve solo el índice.
- No copies el plan en tu contexto ni en las instrucciones de los developers: pasales la ruta.
- Si una tarea pide diseño previo (concurrencia), el developer lo devuelve primero; contrastalo vos o un TL nuevo y reanudá al developer con `SendMessage`.

## 2. Ejecutar
- Un `neumet-developer` nuevo por tarea, con `isolation: "worktree"` y en segundo plano. Instrucción corta: «Tu tarea está en `<ruta absoluta>/<X>.md`. Leela y seguila.»
- Las tareas de una misma ronda se lanzan juntas. Las de la ronda siguiente, cuando sus dependencias estén en `dev`.

## 3. Integrar en dev (cuando el developer informa sus pruebas rápidas en verde)
```bash
W=<worktree del developer>; B=<rama de la tarea>
git -C $W log --oneline origin/dev..HEAD && git -C $W diff --stat origin/dev...HEAD
git -C $R checkout dev && git -C $R pull --ff-only origin dev
git -C $R merge --no-ff $B -m "<qué entra>"   # conflicto: lo resuelve el developer de esa tarea o un TL
git -C $R push origin dev
```
- **Revisión, sin frenar:**
  - Docs, tests o interfaz sencilla: la revisás vos leyendo el diff.
  - SQL, RLS, Edge Functions, datos sensibles o lógica de dominio: un `neumet-technical-leader` **nuevo**, con worktree, con el encargo «REVISAR <commits>» y las dudas del developer. Podés juntar varias tareas en una revisión.
  - Lo que corrija el TL se integra igual que una tarea.
- **Pendientes:** lo menor va a la sección «Pendientes» de `plan.md`. No se reabre la tarea.
- **Pruebas:** no repitas las del developer. Repetilas solo si al integrar hubo conflictos.

## 4. Cerrar: dev → main → producción
1. **Revisión hecha:** las migraciones, RLS, Edge Functions y datos sensibles de la oleada tienen que estar revisados.
2. **PR y CI:** `gh pr create --base main --head dev` con qué entra, la migración (si hay, sin aplicar) y los clics de las tareas frecuentes que cambian. Después, `gh pr checks <n> --watch`. Es la única corrida completa de la oleada. Si sale rojo, lo arregla un developer o el TL en `dev`.
3. **Migración**, si la hay: `neumet-aplicar-migracion` (CLI con dry-run, nunca `apply_migration`), **antes** de fusionar.
4. **Fusión:** `gh pr merge <n> --merge`, **sin** `--delete-branch`.
5. **Despliegue:** si hay una Edge Function, `neumet-operar funcion <nombre>`.
6. **Verificación sobre `main`:** `neumet-verificar` en el nivel rápido y humo en producción, con recarga forzada de la vista tocada.
7. **Docs:** `neumet-docs-sync` y `docs/10`, con lo hecho y los pendientes de `plan.md`. Van en un PR `chore/` o en la oleada siguiente.
8. **Limpieza:** `neumet-operar limpiar` con `neumet-operativo`.
9. **Frená** y presentá la auditoría al usuario:
   - una tabla por agente con tokens (`subagent_tokens`) y duración;
   - las rondas reabiertas y los fallos que encontró la revisión;
   - qué cambiarías del flujo.

Se frena y se consulta al usuario solo ante una migración destructiva, datos de clientes reales en juego, un dry-run inesperado o una decisión de negocio.

## Reglas para gastar poco
- No leas transcripciones de agentes ni archivos enteros que no vayas a usar.
- `neumet-ux` y `neumet-dba` se lanzan solo cuando aportan: al cerrar una fase con interfaz (auditoría de clics de `docs/13` §6) o con vistas o RLS pesadas.
- Si un agente corta por un tope de uso, reanudalo con `SendMessage`. Relanzarlo repite el contexto.
