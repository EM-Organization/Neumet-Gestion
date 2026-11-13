---
name: neumet-corregir-pr
description: Corregir en la rama de un PR de NEUMET los bloqueantes que reportó el revisor, con un test por cada uno, sin ampliar el alcance. Usar después de un veredicto CAMBIOS SOLICITADOS de neumet-revisar-pr, o cuando se pida "corregir el PR N".
---

# Corrector

Argumento: número de PR y la lista de bloqueantes del revisor (copiada tal cual; si no se pasa, leer el último comentario/veredicto del PR).
El corrector **no es el revisor**: arregla lo señalado y no emite veredicto.

## 1. Preparar
```
gh pr view <n> --json headRefName,baseRefName
git fetch origin
git worktree add .claude/worktrees/corregir-<n> origin/<rama>   # o usar el worktree de la rama si ya existe
```
Trabajar en ese worktree, en la rama del PR. `git merge origin/main` primero si la rama está atrás o en conflicto.

## 2. Por cada bloqueante, en orden
1. **Reproducir** el escenario concreto que describió el revisor. Si no se reproduce, no inventar un arreglo: anotarlo para devolverlo al revisor con lo que se intentó.
2. Escribir el test que falla (SQL, unitario, smoke o e2e según el caso) y verlo fallar.
3. Arreglar lo mínimo. Sin refactors, sin mejoras de paso, sin tocar archivos ajenos al bloqueante.
4. Ver el test pasar y correr `neumet-verificar` en el nivel que corresponda al archivo tocado.
5. Un commit por bloqueante, con mensaje que lo nombre. `git add` con rutas explícitas.

## 3. Migración
- Si el bloqueante está en una migración **aún no aplicada**: se edita el archivo y se re-corre `tests/sql/run.sh` (aplica dos veces).
- Si la migración **ya se aplicó a producción**: no se edita. Se agrega una migración nueva que corrige, con timestamp posterior, y se avisa al director.

## 4. Entregar
`git push` de la rama (nunca `--force` sobre una rama con PR sin avisar). Comentar en el PR, o responder al director, con esta forma:
```
Bloqueante 1: <resumen> → corregido en <commit>; test: <archivo>, falla sin el arreglo, pasa con él
Bloqueante 2: ...  (o: no reproducible; intenté <X>)
Ejecutado: <comandos y resultado real>
No ejecutado: <qué y por qué>
```
Después **vuelve al revisor** (agente distinto del corrector) para que re-ejecute lo que falló. El corrector nunca aprueba ni fusiona su propia corrección.
