-- =============================================================================
-- NEUMET · Precios y costos solo para el perfil global y el admin (privilegios por columna)
-- =============================================================================
-- Regla del producto: el perfil de sucursal no ve costos ni precios (stock_neumaticos ya los esconde).
-- Fallo corregido: la RLS filtra FILAS, no columnas, y `authenticated` tenía SELECT de tabla sobre neumaticos y
-- eventos_neumatico. Un perfil de sucursal leía por la API REST `neumaticos.precio_unidad` y `eventos_neumatico.costo`
-- de los vehículos de su sucursal.
--
-- Solución (defensa en el motor, no en la interfaz):
--   1. Se revoca el SELECT de tabla a `authenticated` sobre las dos tablas y se otorga SELECT columna por columna
--      SIN `precio_unidad` (neumaticos) ni `costo` (eventos_neumatico). Desde la API, pedir esas columnas, o `*`,
--      responde 42501 (permiso denegado para la columna) a TODO usuario autenticado, admin incluido.
--   2. El único camino de lectura de esos dos campos son dos funciones SECURITY DEFINER (search_path = '') que
--      aplican la regla de visibilidad `precios_visibles()` (admin o perfil global de un cliente) y el mismo alcance
--      que la RLS de cada tabla. Para otro perfil devuelven cero filas.
--   3. Las escrituras no cambian: INSERT y UPDATE siguen siendo privilegios de tabla (solo el admin tiene política);
--      los RPC SECURITY DEFINER (neumatico_cambiar, neumatico_montar, stock_cubierta_*) leen y escriben como su dueño.
--
-- Qué NO se toca: las vistas security_invoker (v_estado_neumaticos, v_alertas, v_mediciones_neumatico,
-- v_ultima_medicion, v_km_cubierta) y las funciones SECURITY INVOKER (ultimas_mediciones, odometro_anomalias,
-- posiciones_medidas_sin_neumatico) no leen precio_unidad ni costo: siguen igual, con sus mismos planes
-- (los privilegios por columna no alteran el plan; se comprueba en tests/sql/t_90_precios_solo_global.sql).
--
-- CONTRATO PARA MIGRACIONES FUTURAS
--   * Una columna nueva de neumaticos o eventos_neumatico NO es legible por `authenticated` hasta que se le otorgue
--     `grant select (columna) on ...`. El test t_90 falla si hay una columna sin otorgar (salvo precio_unidad/costo).
--   * Ninguna vista security_invoker ni función SECURITY INVOKER puede leer precio_unidad o costo: fallaría con
--     42501 para todos. Debe leerlos con `neumaticos_precios()` / `eventos_costos()` o ser SECURITY DEFINER con
--     `precios_visibles()` en su condición. F4 (costos y CPK) debe reutilizar `precios_visibles()` como su
--     `costos_visibles()` (misma regla) en lugar de definir otra.
--
-- Aplicación: `supabase db push --remote`. Esta migración debe aplicarse ANTES de fusionar el front que usa las
-- funciones nuevas; el front anterior (select('*') sobre neumaticos y eventos_neumatico) deja de funcionar al aplicarla.
-- Idempotente (create or replace + revoke/grant repetibles). No modifica datos. Sin begin/commit.
-- Orden de versión: entre 20261116000000 (calidad de datos) y 20261117000000 (costos y CPK).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Regla de visibilidad: admin o perfil global (rol cliente sin sucursal)
-- -----------------------------------------------------------------------------
-- Lee perfiles saltando su RLS. Un perfil de sucursal, el rol api, un usuario sin perfil y anon: false.
create or replace function public.precios_visibles()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.user_id = (select auth.uid())
      and (p.rol = 'admin'
           or (p.rol = 'cliente' and p.cliente_id is not null and p.sucursal_id is null))
  )
$$;
revoke all on function public.precios_visibles() from public, anon;
grant execute on function public.precios_visibles() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Lectura de precios y costos (único camino a los dos campos)
-- -----------------------------------------------------------------------------
-- Alcance idéntico a la RLS de lectura: admin = todo; perfil global = neumáticos de vehículos de su cliente y
-- cubiertas de stock de su cliente (neumaticos_cliente_select + neumaticos_stock_cliente_select);
-- eventos del propio cliente (eventos_cliente_select). Solo filas con valor (no nulo). Ordenadas por id para
-- paginar con .order('id').range() (PostgREST limita las respuestas a 1.000 filas).
--   p_vehiculo     solo los neumáticos de ese vehículo (NULL = sin filtro)
--   p_solo_stock   solo las cubiertas sin montar
create or replace function public.neumaticos_precios(p_vehiculo bigint default null, p_solo_stock boolean default false)
returns table (id bigint, precio_unidad numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.precio_unidad
  from public.neumaticos n
  where n.precio_unidad is not null
    and (select public.precios_visibles())
    and (p_vehiculo is null or n.vehiculo_id = p_vehiculo)
    and (not coalesce(p_solo_stock, false) or n.vehiculo_id is null)
    and ((select public.is_admin())
         or ((select public.current_cliente_id()) is not null
             and ((n.vehiculo_id is null and n.cliente_id = (select public.current_cliente_id()))
                  or exists (select 1 from public.vehiculos v
                             where v.id = n.vehiculo_id
                               and v.cliente_id = (select public.current_cliente_id())))))
  order by n.id
$$;
revoke all on function public.neumaticos_precios(bigint, boolean) from public, anon;
grant execute on function public.neumaticos_precios(bigint, boolean) to authenticated;

create or replace function public.eventos_costos(p_vehiculo bigint default null)
returns table (id bigint, costo numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.costo
  from public.eventos_neumatico e
  where e.costo is not null
    and (select public.precios_visibles())
    and (p_vehiculo is null or e.vehiculo_id = p_vehiculo)
    and ((select public.is_admin())
         or e.cliente_id = (select public.current_cliente_id()))
  order by e.id
$$;
revoke all on function public.eventos_costos(bigint) from public, anon;
grant execute on function public.eventos_costos(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Privilegios de columna
-- -----------------------------------------------------------------------------
-- Revocar el SELECT de tabla también revoca los de columna; se otorgan de nuevo todas menos la sensible.
-- (information_schema solo muestra lo que el rol puede ver: se lee pg_attribute.)
do $$
declare
  v_cols text;
begin
  revoke select on public.neumaticos        from authenticated;
  revoke select on public.eventos_neumatico from authenticated;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.neumaticos'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'precio_unidad';
  execute format('grant select (%s) on public.neumaticos to authenticated', v_cols);

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.eventos_neumatico'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'costo';
  execute format('grant select (%s) on public.eventos_neumatico to authenticated', v_cols);
end $$;

comment on column public.neumaticos.precio_unidad is
  'Sin SELECT para authenticated (privilegios por columna): se lee con neumaticos_precios() (admin o perfil global). docs/08 apéndice K.';
comment on column public.eventos_neumatico.costo is
  'Sin SELECT para authenticated (privilegios por columna): se lee con eventos_costos() (admin o perfil global). docs/08 apéndice K.';
