---
name: code-review-checklist
description: Checklist de revisión de PR de NEUMET para el revisor: ejecutar caminos nuevos, probar por rol, leer migraciones enteras, separar bloqueantes de sugerencias, veredicto APROBADO o CAMBIOS SOLICITADOS. Usar al revisar un PR o al verificar el propio antes de abrirlo.
---

# Revisión de PR en NEUMET

Fuente de verdad: `docs/13-checklist-revision-prs.md` (completo). Esto es el resumen operativo; el revisor lee el doc entero.

## Bloqueante vs. sugerencia
- **Bloqueante**: todo incumplimiento de una regla de `AGENTS.md` o de `docs/13` — p. ej. bug sin test que falle sin el arreglo, `SECURITY DEFINER` sin `search_path` vacío, RLS nueva sin pruebas por rol, clics aumentados sin justificación, texto en segunda persona, cambio de comportamiento sin actualizar docs — además de pérdida de datos, elección del usuario perdida, fuga entre roles, afirmación falsa en documentación.
- **Sugerencia**: lo opinable o de estilo que no viola una regla. Desde la ronda 1 van separadas.

## Rigor (ejecutar, no solo leer)
- Correr los caminos nuevos; confirmar que los tests nuevos fallan sin el cambio.
- Probar con datos vacíos, `null`, un registro, muchos; con cada rol y sesión sin perfil.
- Buscar el caso negativo: consulta que falla, campo que no existe, usuario sin permiso.
- Concurrencia (`docs/13` §1.b): doble envío, Enter mantenido, cambios superpuestos, fallo a mitad, respuesta que nunca llega, recarga.
- Visibilidad: probar contra la API real con el JWT de cada rol, pidiendo la columna directa, con `select=*`, filtro/orden y embebida. La interfaz no es la que hace cumplir.
- No repetir lo que ya validó el CI (lint, sintaxis, unitarias básicas): el valor está en lo que el CI no ve.

## Migraciones (si el PR trae una)
- Leerla entera: idempotencia, permisos, `search_path` vacío en `SECURITY DEFINER`, RLS, privilegios por columna, efecto sobre datos existentes en producción.
- Pruebas SQL por rol presentes y reales. Migración aplicada a producción no se edita: se agrega otra posterior.

## Interfaz (si el PR toca UI)
- `tests/visual/run.sh` y mirar los PNG en escritorio y móvil: texto cortado, superposición, tablas desbordadas, contraste, solo-color.
- Clics de las tareas frecuentes declarados y justificados; pregunta fija del menú (`docs/12` §4).

## Formato del veredicto
**Veredicto**: APROBADO / CAMBIOS SOLICITADOS · **Migración**: estado · **Ejecutado**: comandos y resultados reales · **Bloqueantes**: severidad + escenario que lo reproduce (rol, entrada, esperado vs. real) + `archivo:línea` · **Sugerencias**: aparte, sin bloquear.
- Ronda 2: solo bloqueantes pendientes y diff nuevo.
- Sin hallazgos: listar qué se probó (la ausencia de hallazgos debe ser verificable).
- Lo no ejecutado va como **no ejecutado** con el motivo. Nunca "pasó".
