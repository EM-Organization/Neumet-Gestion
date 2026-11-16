-- =============================================================================
-- NEUMET · Migración C1 del plan de roles (docs/17 §4.1 y §9, PR 8): RPC del precio mensual
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql (clientes.precio_mensual, is_admin, audit_row).
-- Sin begin/commit; idempotente (el CI la aplica dos veces).
--
-- Qué agrega: dos RPC para leer y fijar clientes.precio_mensual, ambas SOLO para el equipo Neumet (is_admin()),
-- con 42501 para el resto (global, sucursal, api, sin perfil, anon). Mismo patrón que neumaticos_precios()
-- (20261116500000_privilegios_precios.sql).
--
-- Retrocompatible: NO revoca nada. El front vigente (Balance, balance.js:18 y :116) sigue leyendo y escribiendo
-- clientes.precio_mensual directo, y la columna sigue legible para el cliente. Cerrar esa fuga es la migración C2,
-- que solo se aplica cuando Balance ya use estas RPC (PR 9b).
-- =============================================================================

-- Lectura: una fila por cliente, mismo alcance que ve hoy el admin sobre `clientes` (incluye dados de baja).
create or replace function public.cliente_precios_mensuales()
returns table (cliente_id bigint, precio_mensual numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  return query
    select c.id, c.precio_mensual from public.clientes c order by c.id;
end
$$;
revoke all on function public.cliente_precios_mensuales() from public, anon;
grant execute on function public.cliente_precios_mensuales() to authenticated;

-- Escritura: fija el precio de un cliente y devuelve el valor guardado (numeric(12,2), ya redondeado).
-- El UPDATE dispara trg_audit_clientes, así que el cambio queda en la auditoría con el usuario real.
create or replace function public.cliente_precio_mensual_fijar(p_cliente_id bigint, p_precio numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_precio numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  -- Se valida el valor ya redondeado: 9999999999.999 pasaría `< 1e10` y desbordaría numeric(12,2) (22003) al guardarse.
  if p_precio is null or p_precio < 0 or round(p_precio, 2) >= 10000000000 then
    raise exception 'precio inválido' using errcode = '22023';
  end if;
  update public.clientes set precio_mensual = p_precio
  where id = p_cliente_id
  returning precio_mensual into v_precio;
  if not found then
    raise exception 'cliente inexistente' using errcode = 'P0002';
  end if;
  return v_precio;
end
$$;
revoke all on function public.cliente_precio_mensual_fijar(bigint, numeric) from public, anon;
grant execute on function public.cliente_precio_mensual_fijar(bigint, numeric) to authenticated;
