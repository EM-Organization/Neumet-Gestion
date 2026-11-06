-- =============================================================================
-- NEUMET · Listado de cuentas de API por cliente (panel de admin)
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql (perfiles, is_admin()).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant repetibles).
--
-- perfiles solo es legible por su propio usuario / admin vía RLS, y el email vive
-- en auth.users (inaccesible al rol authenticated). Esta RPC, solo admin, une ambos.
-- =============================================================================

create or replace function public.cuentas_api_listar(p_cliente_id bigint)
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query
    select p.user_id, u.email::text, p.created_at
      from public.perfiles p
      join auth.users u on u.id = p.user_id
     where p.rol = 'api' and p.cliente_id = p_cliente_id
     order by p.created_at desc;
end
$$;

revoke all on function public.cuentas_api_listar(bigint) from public, anon;
grant execute on function public.cuentas_api_listar(bigint) to authenticated;
