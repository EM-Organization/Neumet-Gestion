---
name: neumet-auditoria-db
description: Auditar la base de datos de NEUMET (Supabase/Postgres 17) en rendimiento, RLS, índices, planes de ejecución, paginación, conexiones y seguridad de datos, citando la documentación vigente de Supabase. Solo lectura. Lo usa el agente neumet-dba antes de escalar clientes o cuando una migración toca vistas o RLS pesadas.
---

# Auditoría de base de datos (solo lectura)

Lo ejecuta `neumet-dba`. **Los skills de producción (`neumet-aplicar-migracion`, `neumet-operar`) NO aplican acá: el DBA nunca aplica, despliega ni escribe.** Si algo requiere un cambio, se informa y un autor lo convierte en migración con `neumet-migracion`.

## Reglas de ejecución
- `execute_sql` solo `SELECT` / `EXPLAIN`; `EXPLAIN ANALYZE` solo sobre consultas sin efectos.
- Única excepción, dentro de la misma llamada a `execute_sql`: `set local role authenticated` y `select set_config('request.jwt.claims', '<json>', true)`. Cualquier otro `SET` está prohibido. Forma verificada (sonda `select current_user`, devuelve `authenticated`): cadena de sentencias en una sola llamada, con el `EXPLAIN` como **última** sentencia para que su plan sea lo que se devuelve; el `set local` se descarta al terminar la transacción implícita. Envolver en `begin; ...; rollback;` también devolvió el resultado de la sonda, pero es innecesario y con `rollback` al final no se probó que el plan de un `EXPLAIN` se devuelva: usar la forma sin `begin`/`rollback`. El `EXPLAIN` bajo ese rol no se probó contra producción.
- Bash solo lectura (`grep`, `ls`, `git diff/log`, `supabase migration list --remote`); prohibido `supabase db push`, `supabase functions deploy`, `psql` y `git`/`gh` de escritura.
- Antes de cada recomendación, `mcp__supabase__search_docs` y se anota la fuente. Sin fuente, se marca "sin respaldo en docs".
- Leer `CLAUDE.md` y `docs/08` antes de empezar. Volumen: el del demo; extrapolar explicitando el supuesto de crecimiento.

## Procedimiento
**a) Advisors.** `get_advisors` de tipo `security` y de tipo `performance`. Cada alerta se clasifica: real, falso positivo documentado o aceptado por diseño (con motivo).

**b) RLS.** Revisar políticas (`pg_policies`):
- `auth.uid()` / `auth.jwt()` envueltos como `(select auth.uid())` para que se evalúen una vez por consulta (initplan) y no por fila.
- Índices en las columnas que usan las políticas (tenant, usuario, FK).
- Funciones helper `STABLE` (no `VOLATILE`), con `search_path` vacío si son `SECURITY DEFINER`.
- Evitar subconsultas correlacionadas por fila; preferir `IN (select ...)` sobre un helper estable.
- Roles explícitos en `TO` para no evaluar la política con roles que no aplican.

**c) Planes de ejecución.** `EXPLAIN (ANALYZE, BUFFERS)` solo si no tiene efectos; si no, `EXPLAIN`. Cubrir las vistas y consultas más usadas del panel: `v_estado_neumaticos`, `v_alertas` (la leen `inicio`, `flota`, `alertas` y `vehiculo-detalle`), `v_km_cubierta`, últimas mediciones por cubierta, reportes (`cpk_por_grupo`). Verificar con `grep` en `assets/js` y `adminpanel` que cada una se usa antes de llamarla "usada por el panel". Ejecutar bajo el rol real (`set local role authenticated` y `select set_config('request.jwt.claims', '<json>', true)`, la única excepción a la regla de solo lectura, en la misma llamada a `execute_sql` que el `EXPLAIN`) para que RLS cuente en el plan; `v_alertas` es `security_invoker = true`, así que bajo `authenticated` aplica RLS. Buscar Seq Scan sobre tablas que crecen, Sort en disco, estimaciones de filas muy desviadas, funciones por fila. Extrapolar a 10x y 100x el volumen del demo.

`alerta_cargar` y `alerta_sincronizar` (de `20261118500000_alerta_critica.sql`) **no** son RPC del panel: la migración les hace `revoke all ... from public, anon, authenticated`, solo las invocan los triggers y `alerta_reconocer`/`alerta_silenciar`/`alerta_resolver`. Bajo `authenticated` dan 42501. Son SECURITY DEFINER (RLS no aplica): se analizan, como dueño y sin cambiar de rol, solo las consultas `SELECT` de su cuerpo, por separado. **Prohibido `EXPLAIN ANALYZE` de ambas**: `alerta_sincronizar` escribe en `alertas` y `alerta_cargar` toma bloqueos (`neumatico_autorizar_vehiculo`, `select ... for update`). Las RPC que sí ejecuta `authenticated` son `alerta_reconocer`, `alerta_silenciar`, `alerta_resolver` y `alerta_configurar`; escriben, así que tampoco se les hace `EXPLAIN ANALYZE`.

**d) Índices.** Faltantes (filtros, joins, orden frecuentes), duplicados o redundantes (prefijo de otro), sin uso (`pg_stat_user_indexes.idx_scan = 0`, con cautela si las estadísticas son recientes), **FK sin índice** (cruzar `pg_constraint` con `pg_index`). Considerar índices parciales y de cobertura donde aplique.

**e) Estadísticas y mantenimiento.** `pg_stat_statements` si está en `list_extensions` (top por tiempo total, medio y llamadas); `query_logs` para errores y consultas lentas; bloat y dead tuples (`pg_stat_user_tables`), `last_autovacuum` / `last_autoanalyze`, tablas con estadísticas viejas.

**f) Paginación y acceso desde el front.** El `offset` en exportes es **deuda conocida**: cuantificarla y proponer keyset. Buscar N+1 en el front (`Grep` sobre `.from(` / `.rpc(` dentro de bucles y `Promise.all` por fila), selects con `*` innecesarios y consultas que podrían ser una vista o RPC.

**g) Conexiones y API.** Pooling (modo transacción vs. sesión, límite de conexiones según el plan), `max rows` de PostgREST y consultas que lo rozan, estrategia de caché, uso de `count` exacto vs. estimado.

**h) Seguridad de datos.** Privilegios por columna (`GRANT` por columna; recordar que RLS filtra filas, no columnas), `SECURITY DEFINER` con `search_path` vacío y sin escalada, tablas sin RLS en `public`, vistas que evitan RLS (`security_invoker`), grants a `anon`.

## Informe
Tabla ordenada por prioridad (impacto/esfuerzo):

| Hallazgo | Evidencia | Impacto | Esfuerzo | Fuente (doc de Supabase) | Acción propuesta |
|---|---|---|---|---|---|

Más dos secciones:
- **Qué NO se encontró**: lo revisado sin problemas, para que la ausencia sea verificable.
- **No se pudo verificar**: lo que no se ejecutó o no hay datos para probar, con el motivo.

Nunca incluir datos personales ni secretos en el informe. Lo de `pg_stat_statements` y `query_logs` (literales, emails, IPs) va normalizado o redactado.
