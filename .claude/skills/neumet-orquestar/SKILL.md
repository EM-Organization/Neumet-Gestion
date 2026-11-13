---
name: neumet-orquestar
description: Modo director para tareas complejas de NEUMET. El agente principal queda libre y delega en subagentes: autores en worktrees paralelos, revisor opus independiente, corrector y operativo haiku, con una compuerta final antes de producción. Usar cuando una tarea tenga varias áreas separables (una fase de docs/16, varios PR a la vez) o cuando se pida "lanzar agentes", "en paralelo" o "orquestar".
---

# Director: delegar, no ejecutar

El agente principal **no implementa**: planifica, lanza, decide y habla con el usuario. Todo trabajo largo va a un subagente
(`Agent`), que corre en segundo plano y avisa al terminar. No hacer polling ni dormir esperando: seguir con otra cosa o con el usuario, y reaccionar a la notificación.

## 1. Descomponer
1. Leer `docs/10-tablero.md` y la fase en `docs/16-hoja-de-ruta.md`. Partir el trabajo en **áreas que no compartan archivos**: una migración + su front + sus pruebas es una sola área.
2. Antes de lanzar, resolver desde el director lo que choca entre ramas paralelas (ya costó conflictos en #51, #53 y #63/#65):
   - **Timestamps de migración**: asignar uno distinto y creciente a cada área.
   - **Letra del apéndice de `docs/08`**: asignar una distinta por área.
   - **Archivos compartidos** (`tests/visual/run.sh`, `tests/e2e/e2e.test.mjs`, `tests/smoke/run.sh`, `docs/10`): decir quién los toca y que cada autor haga `git merge origin/main` antes de abrir el PR.
   - **Orden de fusión** (las que dependen de una migración van en serie; las independientes, en cualquier orden).
3. Tope de **3 autores en paralelo**. Más agentes no aceleran si se agota el límite de uso (ya pasó el 2026-11-08 y 11-09); con límite cerca, lanzar menos y avisar.

## 2. Lanzar autores (uno por área, cada uno en su worktree)
Roles definidos en `.claude/agents/` (cargan al iniciar la sesión; si no aparecen, reiniciar Claude Code o usar `/agents`):
`neumet-autor` (sonnet), `neumet-revisor` (opus, sin herramientas de edición), `neumet-corrector` (sonnet), `neumet-operativo` (haiku, sin edición).
Lanzar con `Agent` y `subagent_type: "<rol>"`, `effort: "medium"`; el autor además con `isolation: "worktree"`.
Si el rol no está disponible, usar `general-purpose` pasando `model` explícito y las instrucciones del archivo del rol en el brief.
El brief debe ser **autocontenido** (el subagente no ve esta conversación):
```
Rol: autor. Seguir el skill neumet-pr (leer .claude/skills/neumet-pr/SKILL.md y CLAUDE.md).
Tarea: <qué y por qué, con criterios de aceptación concretos>
Rama: feat/<tema>. Migración: timestamp <X>. Apéndice docs/08: letra <Y>.
Archivos que SÍ son tuyos: <lista>. Que NO debes tocar: <lista>.
Hecho = neumet-verificar en verde, PR abierto con el cuerpo de neumet-pr, migración SIN aplicar.
Entregable al terminar: número de PR, qué se probó, qué NO se pudo probar.
No fusionar. No aplicar migraciones. No tocar producción.
```
Tareas independientes se lanzan **en la misma respuesta** (varias llamadas `Agent` juntas) para que corran a la vez.

## 3. Compuerta de calidad (por PR, en este orden)
1. **Revisor** (`subagent_type: "neumet-revisor"`, agente nuevo, distinto del autor, con worktree propio): skill `neumet-revisar-pr`. Devuelve veredicto; **no corrige ni fusiona** (no tiene herramientas de edición).
2. Si hay bloqueantes → **Corrector** (`subagent_type: "neumet-corrector"`): skill `neumet-corregir-pr` sobre la rama del PR, con la lista de bloqueantes copiada tal cual. Luego **vuelve al paso 1** con un revisor nuevo que re-ejecute lo que falló.
   Máximo **2 rondas**. Si en la segunda siguen los bloqueantes, parar y escalar al usuario con el resumen; no seguir iterando a ciegas.
3. Aprobado con el CI verde y la rama al día con `main` → pasar a producción (sección 4).

## 4. Hacia producción (lo hace el director, uno a la vez)
Nunca dos PR con migración a la vez: serializar.
1. Si trae migración: `neumet-aplicar-migracion` (`neumet-operativo` para lo mecánico, o el director). Pedir confirmación al usuario antes de tocar producción
   salvo que haya dado autorización duradera para ese tipo de acción (la del 2026-11-08 fue para ese momento; ante la duda, preguntar).
2. `gh pr merge <n> --merge --delete-branch`.
3. Si hay Edge Function que depende de la migración: `neumet-operar funcion <nombre>` **después** de la migración.
4. **Verificación posterior** sobre `main` actualizado: `git pull`, `neumet-verificar` nivel rápido, y humo en producción (recarga forzada, la vista tocada con datos reales del demo).
5. `neumet-docs-sync` y actualizar `docs/10-tablero.md` (puede ir en un PR `chore/`).
6. Limpiar: `neumet-operar limpiar` con `neumet-operativo`.

## 5. Informe al usuario
Al lanzar: tabla corta con área, rama, agente y qué sigue. Al cerrar cada PR: veredicto, qué se probó y qué no, qué quedó en producción.
Lo no ejecutado o no verificado se dice como tal. Si un agente reporta "listo", comprobarlo (`gh pr view`, `gh pr checks`, `git log`) antes de repetirlo.

## Reglas de convivencia
- Un agente por rama; nunca dos agentes escribiendo en el mismo worktree.
- Los agentes no sobreviven a un reinicio: su trabajo queda en `.claude/worktrees/agent-*`. Para retomar, lanzar uno nuevo apuntando a la rama/worktree, o `SendMessage` si sigue vivo.
- El director tampoco hace `git add -A` ni empuja a `main`.
