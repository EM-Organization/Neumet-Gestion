-- Simulación mínima de Supabase: roles, esquema auth y auth.uid().
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Como en Supabase: privilegios por defecto amplios en public para el dueño.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Helpers de aserción
create schema if not exists test;
grant usage on schema test to public;

create or replace function test.eq(p_name text, p_actual anycompatible, p_expected anycompatible)
returns void language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then
    raise notice 'ok   - %', p_name;
  else
    raise exception 'FALLO - %: obtenido=% esperado=%', p_name, p_actual, p_expected;
  end if;
end $$;

-- Ejecuta sql con el rol actual y exige que falle con el SQLSTATE dado.
create or replace function test.denied(p_name text, p_sql text, p_state text default '42501')
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      raise notice 'ok   - % (%)', p_name, sqlstate;
      return;
    end if;
    raise exception 'FALLO - %: SQLSTATE % (%), se esperaba %', p_name, sqlstate, sqlerrm, p_state;
  end;
  raise exception 'FALLO - %: la sentencia no falló', p_name;
end $$;

-- Cambia de identidad dentro de la transacción actual.
create or replace function test.become(p_role text, p_uid uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;

-- Identidades de prueba
create or replace function test.u_admin()     returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000001'::uuid $$;
create or replace function test.u_cli_a()     returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-00000000000a'::uuid $$;
create or replace function test.u_cli_b()     returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-00000000000b'::uuid $$;
create or replace function test.u_api()       returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000a1'::uuid $$;
create or replace function test.u_sinperfil() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000ff'::uuid $$;
grant execute on all functions in schema test to public;
