---
name: neumet-migracion
description: Escribir o revisar una migración SQL de NEUMET (convenciones de nombre, idempotencia, RLS, SECURITY DEFINER, privilegios por columna, pruebas SQL y apéndice de docs/08). No la aplica; para aplicarla usar neumet-aplicar-migracion. Usar al crear tablas, vistas, RPC o políticas.
---

# Escribir una migración

Producción es la única base de datos: una migración mala no se prueba "en staging", se prueba en `tests/sql/run.sh` y `npm run e2e`.

## 1. Archivo
- `supabase/migrations/<timestamp>_<tema>.sql`, timestamp de 14 dígitos **posterior** al último existente (`ls supabase/migrations | tail -3`).
  Un timestamp anterior a uno ya aplicado hace que `db push` lo rechace o lo salte.
- Cabecera como las existentes: qué hace, de qué migraciones depende, decisión de producto y límites.
- **Idempotente** (`create ... if not exists`, `create or replace`, `drop ... if exists`, bloques `do $$`): el job `sql` del CI la aplica dos veces.
- **Sin `begin`/`commit`**: la herramienta que aplica ya envuelve en transacción.

## 2. Seguridad (lo que más se rompe)
- Tabla nueva: `alter table ... enable row level security` y políticas explícitas por rol. Sin política = nadie ve nada, y eso es lo correcto por defecto.
- Ningún grant a `anon`. Revisar con `supabase/audit/rls_audit.sql`.
- Funciones `SECURITY DEFINER`: `set search_path = ''`, nombres calificados (`public.tabla`), autorización **dentro** de la función
  (ver `neumatico_autorizar_vehiculo`), y rechazo uniforme con `42501`. `revoke ... from public` y `grant execute` solo a los roles previstos.
- Dato que un rol no debe ver (precios, costos): privilegios por columna (`revoke select ... from authenticated; grant select (cols) ...`) más helper de visibilidad,
  como en `20261116500000_privilegios_precios.sql`. La RLS por sí sola **no** oculta columnas, y `select=*` o un embed lo demuestran.
- Vistas: tener en cuenta con qué rol se evalúan (`security_invoker`) y que no expongan columnas de otro cliente.
- Escrituras por RPC, no por `insert` directo desde el cliente, cuando haya reglas de negocio o auditoría (`audit_row`).

## 3. Datos existentes
Producción puede tener filas. Antes de `not null`, `unique`, `check` o un cambio de tipo: ¿hay backfill? ¿qué pasa con filas que hoy violan la regla?
Un cambio que rompe la vista o RPC que usa el front desplegado exige coordinar el orden (migración compatible hacia atrás primero).

## 4. Pruebas
- `tests/sql/t_NN_<tema>.sql` (el número sigue el orden de `ls tests/sql`): un caso por rol **permitido** y uno por rol **denegado**
  (admin, global, sucursal, otro cliente, sin perfil, `api`, anon), con `01_fixtures.sql` como base.
- Si el panel la usa: spec en `tests/e2e/specs/<tema>.mjs` con la API real y JWT por rol, incluyendo la consulta que no debería funcionar.
- Correr `tests/sql/run.sh` (aplica todo dos veces) y `npm run e2e`.

## 5. Documentación
Apéndice en `docs/08-esquema-datos.md` con la siguiente letra libre (`grep -n '^## [A-Z]\.1' docs/08-esquema-datos.md | tail -3`):
tablas/columnas, RPC con su autorización, pruebas, límites. Actualizar `docs/10-tablero.md`.

## 6. Entrega
La migración viaja en el PR **sin aplicar**. Decirlo en el cuerpo del PR. El orden es: revisor aprueba → `neumet-aplicar-migracion` → fusionar el front.
