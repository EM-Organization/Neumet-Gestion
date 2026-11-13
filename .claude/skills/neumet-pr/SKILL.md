---
name: neumet-pr
description: Flujo de autor para una funcionalidad o arreglo de NEUMET, de la rama al PR abierto. Cubre worktree y rama, implementación con pruebas, documentación y apertura del PR. Usar al empezar una fase de docs/16 (F1..F9), un fix o cualquier cambio que deba entrar a main.
---

# Flujo de autor: de la idea al PR

Argumento: descripción del cambio o la fase (p. ej. «F8 rotación y reposición»).

## 1. Entender antes de escribir
1. Leer `docs/10-tablero.md` (estado) y, si es una fase, su sección en `docs/16-hoja-de-ruta.md` y el diseño en `docs/15-...` si existe.
2. `git fetch origin && git log --oneline origin/main -10` para ver qué entró desde que se planeó.
3. Revisar `gh pr list --state open`: si otro PR toca los mismos archivos (p. ej. `tests/smoke/run.sh`, `tests/e2e/e2e.test.mjs`, `docs/08`), coordinar el orden o prever el conflicto.

## 2. Rama y aislamiento
- Rama desde `origin/main`: `feat/<tema>` o `fix/<tema>`. Un PR por área.
- Si hay otros agentes o PR en curso, trabajar en un worktree (`.claude/worktrees/`, ignorado por git) en lugar del repo principal.

## 3. Implementar con las pruebas
- Lógica de dominio nueva → `assets/js/domain/` (pura) + `tests/unit/<tema>.test.mjs` con casos límite (vacío, `null`, un registro, muchos).
- SQL (tabla, vista, RPC, política) → skill `neumet-migracion` + `tests/sql/t_NN_<tema>.sql` con un caso por rol permitido y por rol denegado.
- Vista o flujo del panel → smoke (`tests/smoke/*.flow.js` + fixture) **y** spec e2e (`tests/e2e/specs/<tema>.mjs`) si toca la base.
  Registrar la escena nueva en `tests/visual/run.sh` si es pantalla nueva.
- Un arreglo de bug incluye un test que falla sin el arreglo: escribirlo primero, verlo fallar, arreglar.
- Textos según `docs/14-guia-de-textos.md`.

## 4. Documentación en el mismo PR
- Apéndice de la migración en `docs/08-esquema-datos.md` (siguiente letra libre: `grep -n '^## [A-Z]\.1' docs/08-esquema-datos.md | tail -3`).
- `docs/10-tablero.md` (hecho/pendiente) y, si cambia un contrato, `docs/07` / `docs/api/openapi.yaml`.
- Correr el skill `neumet-docs-sync` para no dejar conteos viejos.

## 5. Verificar y abrir el PR
1. Skill `neumet-verificar` hasta que todo lo aplicable esté en verde.
2. `git status` y `git add <rutas explícitas>`; nunca `-A` ni `.`. Revisar `git diff --cached --stat`: nada de `tests/visual/out/`, capturas, `.env` ni archivos fuera del alcance.
3. Commit con prefijo de fase si aplica (`F7: ...`) y push de la rama.
4. `gh pr create` con cuerpo: qué cambia y por qué, qué migración trae (si trae, **sin aplicar**), qué se probó y qué no, y qué debe mirar el revisor.
5. Si hay migración, decirlo explícitamente: el orden de fusión es migración aplicada → fusionar front.

## 6. Cierre
El autor no fusiona su propio PR: lo revisa otro agente o persona con `neumet-revisar-pr`. Tras la fusión, la rama remota se borra sola
(`--delete-branch`); limpiar el worktree local con `neumet-operar`.
