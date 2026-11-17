---
name: git-pr-workflow
description: Flujo de git y PR de NEUMET: ramas feat/fix/chore desde main, worktree propio, git add con rutas explícitas, commits convencionales, PR pequeño con qué/por qué/cómo probar, merge --merge --delete-branch solo tras la compuerta. Usar al crear ramas, commitear o abrir PR.
---

# Git y PR en NEUMET

## Rama y worktree
1. `git fetch origin`; rama nueva desde `origin/main`: `feat/<slug>`, `fix/<slug>` o `chore/<slug>`.
2. Worktree propio por rama: `tools.opencode.worktree_create` (vía `execute`) + `tools.opencode.session_move`, o `git worktree add <dir> -b <rama> origin/main`.
3. `npm run preparar` dentro del worktree (dependencias + lint + check).
4. Un agente por rama. Nunca dos ramas con migración en producción al mismo tiempo.

## Commits
- `git status` antes de cada add. `git add` con **rutas explícitas**; nunca `git add .` ni `-A`.
- Mensajes convencionales: `feat:`, `fix:`, `chore:`, con ámbito si ayuda (`fix(montar): ...`). Prefijo de fase (`F7: ...`) cuando aplique.
- Sin secretos ni valores de alta entropía en el diff (gitleaks escanea el historial completo). Nunca ampliar `.gitleaks.toml` para acomodar un valor.

## PR
- Pequeño: un área, un propósito. Descripción con tres cosas: **qué** cambia, **por qué**, **cómo probarlo** (comandos exactos).
- El PR declara los clics de las tareas frecuentes que toca y no los aumenta sin justificación.
- PR que cambia comportamiento actualiza docs en el mismo PR (apéndice de `docs/08`, `docs/10`, README si cambian conteos).
- `gh pr create` desde la rama; el CI corre solo en PRs hacia `main`.

## Fusión (solo con la compuerta cumplida)
- Veredicto APROBADO + CI verde + rama al día con `main` (+ dry-run de migración limpio si aplica).
- `gh pr merge <n> --merge --delete-branch`. Nunca rebase/squash sin pedido explícito.
- Tras fusionar: ramas de PRs abiertos al día con `main` (merge de `main` y push sin force) y limpieza de worktrees/ramas fusionadas.

## Prohibido siempre
- Push a `main` (directo o por refspec), force-push (incluido `--force-with-lease` y `+rama`), borrar ramas con PR abierto o sin fusionar, `git add -A`/`.`, reescribir historia.
