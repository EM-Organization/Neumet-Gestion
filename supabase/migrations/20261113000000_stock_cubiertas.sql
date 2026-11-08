-- =============================================================================
-- NEUMET · Stock de cubiertas individuales (condición, sucursal) gestionado por el cliente
-- =============================================================================
-- Requiere 20261106000000 (init), 20261106020000 (eventos_neumatico), 20261107020000 (sucursales),
-- 20261108000000 (neumatico_autorizar_vehiculo), 20261109000000 (v_mediciones_neumatico),
-- 20261110000000 (numero_quema, km_previos) y 20261110010000 (sucursal_autorizar_gestion).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (se puede reaplicar). Diseño y alternativas: docs/08-esquema-datos.md (apéndice «Stock individual»).
--
-- DISEÑO: una cubierta de stock es una fila de `neumaticos` SIN montar
--   (vehiculo_id NULL, posicion NULL, estado 'almacenado', sucursal_id = ubicación). Así la misma fila (misma
--   quema, mismo idneumatico) conserva mediciones y eventos durante toda su vida: stock -> vehículo -> stock.
--   * neumaticos.vehiculo_id y .posicion pasan a admitir NULL; un CHECK mantiene la coherencia
--     (sin vehículo <=> sin posición; sin vehículo => 'almacenado' y sin auxilio; sucursal solo si no está montada).
--   * neumaticos.condicion: nuevo | usado | reparado | recauchutado. «Nuevo» pasa solo a «Usado» al montarse
--     (trigger); «reparado» y «recauchutado» los marca el cliente (stock_cubierta_editar) o el taller.
--   * neumaticos.sucursal_id con FK compuesta (sucursal_id, cliente_id) -> sucursales (id, cliente_id): la ubicación
--     siempre es una sucursal del MISMO cliente. NULL = «sin sucursal».
--   * Lectura: política nueva para el perfil GLOBAL (el de sucursal no ve el stock, igual que los lotes).
--   * Escritura: SOLO por las RPC de abajo (SECURITY DEFINER, search_path = '', autorización dentro con
--     sucursal_autorizar_gestion). No se abre ninguna política de escritura directa.
--   * Los lotes antiguos (stock_neumaticos con cantidad) NO se tocan: conviven. neumatico_cambiar acepta
--     un lote o una cubierta individual.
--   * Las vistas v_estado_neumaticos, v_alertas, v_ultima_medicion y las RPC de la API filtran estado = 'montado'
--     o parten de vehículos: una cubierta sin vehículo no entra en ellas. Solo v_mediciones_neumatico se ajusta
--     para que el historial de una cubierta devuelta a stock no desaparezca (ver sección 4).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas, restricciones, índices, trigger
-- -----------------------------------------------------------------------------
do $mig$
begin
  -- Relleno de condición solo la primera vez (al crear la columna): todo neumático existente ya estuvo montado.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'neumaticos' and column_name = 'condicion') then
    alter table public.neumaticos add column condicion text not null default 'usado';
    update public.neumaticos set condicion = 'recauchutado' where vida > 0;
  end if;
end
$mig$;

alter table public.neumaticos add column if not exists sucursal_id bigint;
alter table public.neumaticos alter column vehiculo_id drop not null;
alter table public.neumaticos alter column posicion drop not null;

alter table public.neumaticos drop constraint if exists neumaticos_condicion_ck;
alter table public.neumaticos add constraint neumaticos_condicion_ck
  check (condicion in ('nuevo', 'usado', 'reparado', 'recauchutado'));

-- Coherencia de una cubierta sin montar. Un neumático montado conserva todas las reglas anteriores.
alter table public.neumaticos drop constraint if exists neumaticos_stock_ck;
alter table public.neumaticos add constraint neumaticos_stock_ck check (
  ((vehiculo_id is null) = (posicion is null))
  and (vehiculo_id is not null or (estado = 'almacenado' and not auxilio))
  and (sucursal_id is null or vehiculo_id is null)
  and (condicion <> 'nuevo' or vehiculo_id is null)
);

alter table public.neumaticos drop constraint if exists neumaticos_sucursal_fk;
alter table public.neumaticos add constraint neumaticos_sucursal_fk
  foreign key (sucursal_id, cliente_id) references public.sucursales (id, cliente_id)
  on delete restrict on update restrict;

create index if not exists neumaticos_stock_idx
  on public.neumaticos (cliente_id, sucursal_id) where vehiculo_id is null;

-- «Nuevo» pasa a «Usado» al montarse por primera vez (incluida una escritura directa del admin).
create or replace function public.neumaticos_condicion_auto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vehiculo_id is not null and new.condicion = 'nuevo' then
    new.condicion := 'usado';
  end if;
  return new;
end
$$;
revoke all on function public.neumaticos_condicion_auto() from public, anon, authenticated;

drop trigger if exists neumaticos_condicion_auto on public.neumaticos;
create trigger neumaticos_condicion_auto
  before insert or update of vehiculo_id, condicion on public.neumaticos
  for each row execute function public.neumaticos_condicion_auto();

-- Eventos de stock: tipos nuevos y sucursal de origen/destino (sin FK: es historial y sobrevive a la sucursal).
alter table public.eventos_neumatico add column if not exists sucursal_origen_id  bigint;
alter table public.eventos_neumatico add column if not exists sucursal_destino_id bigint;
alter table public.eventos_neumatico drop constraint if exists eventos_neumatico_tipo_check;
alter table public.eventos_neumatico drop constraint if exists eventos_neumatico_tipo_ck;
alter table public.eventos_neumatico add constraint eventos_neumatico_tipo_ck check (tipo in
  ('montaje','desmontaje','rotacion','reparacion','reencauche','baja','inspeccion',
   'alta_stock','traslado','cambio_condicion'));

-- -----------------------------------------------------------------------------
-- 2. RLS: lectura de las cubiertas sin montar (solo perfil GLOBAL del cliente; admin ya lo ve todo)
-- -----------------------------------------------------------------------------
drop policy if exists neumaticos_stock_cliente_select on public.neumaticos;
create policy neumaticos_stock_cliente_select on public.neumaticos for select to authenticated
  using (vehiculo_id is null
         and cliente_id = (select public.current_cliente_id())
         and (select public.current_sucursal_id()) is null);

-- -----------------------------------------------------------------------------
-- 3. Autorización común (interna) y RPC
-- -----------------------------------------------------------------------------
-- Cubierta del stock + autorización. Para un no-admin, «no existe», «es de otro cliente» y «es de un perfil de
-- sucursal» son indistinguibles (42501). Bloquea la fila (serializa edición, traslado, eliminación y montaje).
create or replace function public.stock_cubierta_autorizar_por_id(p_id bigint)
returns setof public.neumaticos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n    public.neumaticos%rowtype;
  v_aut  record;
begin
  if p_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_n from public.neumaticos n where n.id = p_id;
  if not found then
    if auth.uid() is not null and public.is_admin() then
      raise exception 'cubierta inexistente' using errcode = 'P0002';
    end if;
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);
  select * into v_n from public.neumaticos n where n.id = p_id for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_n.vehiculo_id is not null then
    raise exception 'la cubierta está montada en un vehículo: no se gestiona desde el stock' using errcode = '55000';
  end if;
  return next v_n;
end
$$;
revoke all on function public.stock_cubierta_autorizar_por_id(bigint) from public, anon, authenticated;

-- Valida que la sucursal sea del cliente (o null) y la bloquea contra borrado; devuelve su nombre.
create or replace function public.stock_cubierta_sucursal(p_cliente_id bigint, p_sucursal_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
begin
  if p_sucursal_id is null then
    return null;
  end if;
  select s.nombre into v_nombre from public.sucursales s
   where s.id = p_sucursal_id and s.cliente_id = p_cliente_id for share;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';   -- inexistente o de otro cliente: igual
  end if;
  return v_nombre;
end
$$;
revoke all on function public.stock_cubierta_sucursal(bigint, bigint) from public, anon, authenticated;

-- 3.1 stock_cubierta_agregar ---------------------------------------------------
create or replace function public.stock_cubierta_agregar(
  p_numero_quema text,
  p_marca        text,
  p_modelo       text    default null,
  p_fecha_compra date    default null,
  p_precio       numeric default null,
  p_sucursal_id  bigint  default null,
  p_cliente_id   bigint  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut    record;
  v_quema  text := nullif(btrim(coalesce(p_numero_quema, '')), '');
  v_marca  text := nullif(btrim(coalesce(p_marca, '')), '');
  v_modelo text := nullif(btrim(coalesce(p_modelo, '')), '');
  v_suc    text;
  v_idn    text;
  v_id     bigint;
begin
  select * into v_aut from public.sucursal_autorizar_gestion(p_cliente_id);
  if v_quema is null then
    raise exception 'indicar el número de quema' using errcode = '22023';
  end if;
  if length(v_quema) > 40 then
    raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
  end if;
  if v_marca is null then
    raise exception 'indicar la marca' using errcode = '22023';
  end if;
  if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 then
    raise exception 'marca o modelo demasiado largos (máx. 60)' using errcode = '22023';
  end if;
  if p_precio is not null and (p_precio < 0 or p_precio >= 10000000000) then
    raise exception 'precio fuera de rango' using errcode = '23514';
  end if;
  if p_fecha_compra is not null and p_fecha_compra > current_date + 1 then
    raise exception 'la fecha de compra no puede ser futura' using errcode = '23514';
  end if;
  v_suc := public.stock_cubierta_sucursal(v_aut.cliente_id, p_sucursal_id);

  -- Único por cliente sin distinguir mayúsculas (todos los estados: la quema identifica a la cubierta física).
  if exists (select 1 from public.neumaticos n
              where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema)) then
    raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
  end if;

  loop
    v_idn := 'CB-' || v_aut.cliente_id || '-' || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
    exit when not exists (select 1 from public.neumaticos n where n.idneumatico = v_idn);
  end loop;

  insert into public.neumaticos
    (vehiculo_id, cliente_id, posicion, marca, modelo, fecha_compra, precio_unidad, idneumatico,
     estado, condicion, sucursal_id, numero_quema, vida, km_previos, auxilio)
  values
    (null, v_aut.cliente_id, null, v_marca, v_modelo, p_fecha_compra, round(p_precio, 2), v_idn,
     'almacenado', 'nuevo', p_sucursal_id, v_quema, 0, 0, false)
  returning id into v_id;

  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_destino_id, notas, created_by)
  values (v_aut.cliente_id, null, v_id, v_idn, 'alta_stock', p_sucursal_id,
          'Alta en stock · quema ' || v_quema || ' · ' || coalesce(v_suc, 'sin sucursal'), auth.uid());

  return jsonb_build_object('id', v_id, 'cliente_id', v_aut.cliente_id, 'idneumatico', v_idn,
                            'numero_quema', v_quema, 'condicion', 'nuevo', 'sucursal_id', p_sucursal_id);
end
$$;
revoke all on function public.stock_cubierta_agregar(text, text, text, date, numeric, bigint, bigint) from public, anon;
grant execute on function public.stock_cubierta_agregar(text, text, text, date, numeric, bigint, bigint) to authenticated;

-- 3.2 stock_cubierta_editar ----------------------------------------------------
-- p_datos admite: marca, modelo, fecha_compra, precio, condicion. Una clave presente se aplica (null borra modelo,
-- fecha o precio); una ausente no se toca. La condición solo puede pasar a 'reparado' o 'recauchutado'
-- («nuevo» y «usado» los fija el sistema). La quema y la sucursal NO se editan aquí (la sucursal, con mover).
create or replace function public.stock_cubierta_editar(p_id bigint, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n      public.neumaticos%rowtype;
  v_marca  text;
  v_modelo text;
  v_fecha  date;
  v_precio numeric(12,2);
  v_cond   text;
  v_k      text;
  v_txt    text;
  v_es_adm boolean;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  v_es_adm := public.is_admin();
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('marca', 'modelo', 'fecha_compra', 'precio', 'condicion') then
      raise exception 'campo no editable: %', v_k using errcode = '22023';
    end if;
  end loop;

  v_marca := v_n.marca; v_modelo := v_n.modelo; v_fecha := v_n.fecha_compra;
  v_precio := v_n.precio_unidad; v_cond := v_n.condicion;

  if p_datos ? 'marca' then
    if jsonb_typeof(p_datos -> 'marca') <> 'string' then
      raise exception 'marca inválida' using errcode = '22023';
    end if;
    v_marca := nullif(btrim(p_datos ->> 'marca'), '');
    if v_marca is null then
      raise exception 'indicar la marca' using errcode = '22023';
    end if;
  end if;
  if p_datos ? 'modelo' then
    if jsonb_typeof(p_datos -> 'modelo') not in ('string', 'null') then
      raise exception 'modelo inválido' using errcode = '22023';
    end if;
    v_modelo := nullif(btrim(coalesce(p_datos ->> 'modelo', '')), '');
  end if;
  if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 then
    raise exception 'marca o modelo demasiado largos (máx. 60)' using errcode = '22023';
  end if;
  if p_datos ? 'fecha_compra' then
    if jsonb_typeof(p_datos -> 'fecha_compra') not in ('string', 'null') then
      raise exception 'fecha de compra inválida' using errcode = '22023';
    end if;
    v_fecha := nullif(btrim(coalesce(p_datos ->> 'fecha_compra', '')), '')::date;
    if v_fecha > current_date + 1 then
      raise exception 'la fecha de compra no puede ser futura' using errcode = '23514';
    end if;
  end if;
  if p_datos ? 'precio' then
    if jsonb_typeof(p_datos -> 'precio') not in ('number', 'null') then
      raise exception 'precio inválido' using errcode = '22023';
    end if;
    v_txt := p_datos ->> 'precio';
    if v_txt is null then
      v_precio := null;
    else
      if v_txt::numeric < 0 or v_txt::numeric >= 10000000000 then
        raise exception 'precio fuera de rango' using errcode = '23514';
      end if;
      v_precio := round(v_txt::numeric, 2);
    end if;
  end if;
  if p_datos ? 'condicion' then
    if jsonb_typeof(p_datos -> 'condicion') <> 'string'
       or (p_datos ->> 'condicion') not in ('reparado', 'recauchutado') then
      raise exception 'condición inválida: solo reparado o recauchutado' using errcode = '22023';
    end if;
    v_cond := p_datos ->> 'condicion';
  end if;

  update public.neumaticos
     set marca = v_marca, modelo = v_modelo, fecha_compra = v_fecha, precio_unidad = v_precio, condicion = v_cond
   where id = p_id;

  if v_cond is distinct from v_n.condicion then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, notas, created_by)
    values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'cambio_condicion',
            'Condición: ' || v_n.condicion || ' → ' || v_cond, auth.uid());
  end if;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), case when v_es_adm then 'admin' else 'cliente' end,
          'STOCK_CUBIERTA_EDITAR', 'neumaticos', p_id::text,
          jsonb_build_object('marca', v_n.marca, 'modelo', v_n.modelo, 'fecha_compra', v_n.fecha_compra,
                             'precio_unidad', v_n.precio_unidad, 'condicion', v_n.condicion),
          jsonb_build_object('marca', v_marca, 'modelo', v_modelo, 'fecha_compra', v_fecha,
                             'precio_unidad', v_precio, 'condicion', v_cond, 'cliente_id', v_n.cliente_id));
  return jsonb_build_object('id', p_id, 'cliente_id', v_n.cliente_id, 'condicion', v_cond);
end
$$;
revoke all on function public.stock_cubierta_editar(bigint, jsonb) from public, anon;
grant execute on function public.stock_cubierta_editar(bigint, jsonb) to authenticated;

-- 3.3 stock_cubierta_mover -----------------------------------------------------
create or replace function public.stock_cubierta_mover(p_id bigint, p_sucursal_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n      public.neumaticos%rowtype;
  v_orig   text;
  v_dest   text;
  v_es_adm boolean;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  v_es_adm := public.is_admin();
  v_dest := public.stock_cubierta_sucursal(v_n.cliente_id, p_sucursal_id);
  if v_n.sucursal_id is not distinct from p_sucursal_id then
    return jsonb_build_object('id', p_id, 'anterior', v_n.sucursal_id, 'nueva', p_sucursal_id, 'movido', false);
  end if;
  select s.nombre into v_orig from public.sucursales s where s.id = v_n.sucursal_id;

  update public.neumaticos set sucursal_id = p_sucursal_id where id = p_id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_origen_id, sucursal_destino_id, notas, created_by)
  values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'traslado', v_n.sucursal_id, p_sucursal_id,
          'Traslado: ' || coalesce(v_orig, 'sin sucursal') || ' → ' || coalesce(v_dest, 'sin sucursal'), auth.uid());
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), case when v_es_adm then 'admin' else 'cliente' end,
          'MOVER_SUCURSAL', 'neumaticos', p_id::text,
          jsonb_build_object('sucursal_id', v_n.sucursal_id),
          jsonb_build_object('sucursal_id', p_sucursal_id, 'cliente_id', v_n.cliente_id));
  return jsonb_build_object('id', p_id, 'anterior', v_n.sucursal_id, 'nueva', p_sucursal_id, 'movido', true);
end
$$;
revoke all on function public.stock_cubierta_mover(bigint, bigint) from public, anon;
grant execute on function public.stock_cubierta_mover(bigint, bigint) to authenticated;

-- 3.4 stock_cubierta_eliminar --------------------------------------------------
-- Solo si nunca se usó: sin mediciones y sin más eventos que los propios del stock (alta, traslado, condición).
-- Si tuvo uso, su historial se conserva (no hay forma de borrarla desde aquí).
create or replace function public.stock_cubierta_eliminar(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n      public.neumaticos%rowtype;
  v_es_adm boolean;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  v_es_adm := public.is_admin();
  if exists (select 1 from public.mediciones m where m.idneumatico = v_n.idneumatico)
     or exists (select 1 from public.eventos_neumatico e
                 where e.neumatico_id = v_n.id
                   and e.tipo not in ('alta_stock', 'traslado', 'cambio_condicion')) then
    raise exception 'la cubierta ya tuvo uso (montajes, mediciones o eventos): no se puede eliminar' using errcode = '55000';
  end if;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), case when v_es_adm then 'admin' else 'cliente' end,
          'STOCK_CUBIERTA_ELIMINAR', 'neumaticos', p_id::text, to_jsonb(v_n), null);
  delete from public.eventos_neumatico where neumatico_id = v_n.id;
  delete from public.neumaticos where id = v_n.id;
  return jsonb_build_object('id', p_id, 'cliente_id', v_n.cliente_id, 'numero_quema', v_n.numero_quema);
end
$$;
revoke all on function public.stock_cubierta_eliminar(bigint) from public, anon;
grant execute on function public.stock_cubierta_eliminar(bigint) to authenticated;

-- 3.5 sucursal_eliminar: las cubiertas en stock también cuentan (la FK compuesta es RESTRICT) ---------------------
create or replace function public.sucursal_eliminar(p_sucursal_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut record;
  v_veh bigint;
  v_dis bigint;
  v_usu bigint;
  v_cub bigint;
begin
  select * into v_aut from public.sucursal_autorizar_por_id(p_sucursal_id);
  select count(*) into v_veh from public.vehiculos    v where v.sucursal_id = p_sucursal_id;
  select count(*) into v_dis from public.dispositivos d where d.sucursal_id = p_sucursal_id;
  select count(*) into v_usu from public.perfiles     p where p.sucursal_id = p_sucursal_id;
  select count(*) into v_cub from public.neumaticos   n where n.sucursal_id = p_sucursal_id;
  if v_veh + v_dis + v_usu + v_cub > 0 then
    raise exception 'la sucursal tiene % vehículo(s), % dispositivo(s), % usuario(s) y % cubierta(s) en stock: reasignarlos antes de eliminarla',
      v_veh, v_dis, v_usu, v_cub using errcode = '23503';
  end if;
  delete from public.sucursales where id = p_sucursal_id;
  return jsonb_build_object('id', p_sucursal_id, 'cliente_id', v_aut.cliente_id, 'nombre', v_aut.nombre);
end
$$;
revoke all on function public.sucursal_eliminar(bigint) from public, anon;
grant execute on function public.sucursal_eliminar(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. v_mediciones_neumatico: el historial sigue a la cubierta aunque esté en stock
-- -----------------------------------------------------------------------------
-- Única diferencia con 20261109000000: la regla 1 ya no exige un vehículo (join eliminado): el cliente sale de
-- neumaticos.cliente_id y el vehículo es el actual o, si la cubierta está en stock, aquel donde se midió.
-- Reglas 2 y 3, columnas, security_invoker y permisos: sin cambios. La RLS de neumaticos y mediciones sigue
-- decidiendo qué ve cada perfil.
create or replace view public.v_mediciones_neumatico
with (security_invoker = true) as
-- Regla 1: por idneumatico
select n.cliente_id, coalesce(n.vehiculo_id, m.vehiculo_id) as vehiculo_id, n.id as neumatico_id, n.idneumatico,
       n.estado as estado_montaje, n.posicion as posicion_actual,
       m.posicion as posicion_medicion, m.id as medicion_id,
       m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.device_id, m.created_at,
       'idneumatico'::text as atribucion
from public.mediciones m
join public.neumaticos n on n.idneumatico = m.idneumatico
union all
-- Regla 2: histórico sin idneumatico -> neumático montado en esa posición.
select v.cliente_id, n.vehiculo_id, n.id, n.idneumatico,
       n.estado, n.posicion,
       m.posicion, m.id,
       m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.device_id, m.created_at,
       'posicion'::text
from public.neumaticos n
join public.vehiculos v on v.id = n.vehiculo_id
left join lateral (
  select max(e.created_at) as ultimo
  from public.eventos_neumatico e
  where e.vehiculo_id = n.vehiculo_id
    and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
    and (e.posicion_origen = n.posicion or e.posicion_destino = n.posicion)
) ev on true
join public.mediciones m on m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion
where n.estado = 'montado'
  and m.idneumatico is null
  and (ev.ultimo is null or m.created_at >= ev.ultimo)
  and (n.idneumatico is null
       or not exists (select 1 from public.mediciones t where t.idneumatico = n.idneumatico))
union all
-- Regla 3: posición sin ninguna fila en neumaticos
select v.cliente_id, m.vehiculo_id, null::bigint, m.idneumatico,
       'montado'::text, m.posicion,
       m.posicion, m.id,
       m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.device_id, m.created_at,
       'posicion'::text
from public.mediciones m
join public.vehiculos v on v.id = m.vehiculo_id
where not exists (select 1 from public.neumaticos np
                   where np.vehiculo_id = m.vehiculo_id and np.posicion = m.posicion)
  and (m.idneumatico is null
       or not exists (select 1 from public.neumaticos nt where nt.idneumatico = m.idneumatico))
  and not exists (select 1 from public.eventos_neumatico e
                   where e.vehiculo_id = m.vehiculo_id
                     and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
                     and (e.posicion_origen = m.posicion or e.posicion_destino = m.posicion)
                     and e.created_at > m.created_at);

revoke all on public.v_mediciones_neumatico from public, anon;
grant select on public.v_mediciones_neumatico to authenticated;

-- -----------------------------------------------------------------------------
-- 5. neumatico_cambiar con cubierta individual del stock y devolución a stock
-- -----------------------------------------------------------------------------
-- Cambiar la firma crearía una sobrecarga y las llamadas con los 9 argumentos anteriores serían ambiguas: se elimina
-- la firma vieja. Los argumentos nuevos tienen valor por defecto: las llamadas anteriores siguen valiendo.
--   p_cubierta_id    : cubierta individual del stock (alternativa a p_stock_id y p_nuevo; exactamente una de las tres).
--                      Sale del stock, ocupa la posición (misma fila: conserva quema, mediciones y eventos) y su
--                      condición «nuevo» pasa a «usado» (trigger). Solo admin o perfil global.
--   p_devolver_stock : con destino 'almacenado', el neumático retirado vuelve al stock (sin vehículo ni posición)
--                      en la sucursal p_sucursal_stock (null = sin sucursal). Exige número de quema (el propio o
--                      p_quema_viejo). Sin este argumento se conserva el comportamiento anterior (queda «aparcado»
--                      en el vehículo). Solo admin o perfil global.
-- Además, el destino 'reencauche' marca la condición «recauchutado» y 'reparacion' «reparado».
drop function if exists public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb, text, integer);

create or replace function public.neumatico_cambiar(
  p_vehiculo_id    bigint,
  p_posicion       smallint,
  p_destino_viejo  text,
  p_motivo         text,
  p_odometro_km    integer default null,
  p_stock_id       bigint default null,
  p_nuevo          jsonb default null,
  p_numero_quema   text default null,
  p_km_previos     integer default 0,
  p_cubierta_id    bigint default null,
  p_devolver_stock boolean default false,
  p_sucursal_stock bigint default null,
  p_quema_viejo    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut      record;
  v_viejo    public.neumaticos%rowtype;
  v_stock    public.stock_neumaticos%rowtype;
  v_cub      public.neumaticos%rowtype;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_quema    text := nullif(btrim(coalesce(p_numero_quema, '')), '');
  v_quema_v  text;
  v_km_prev  integer := coalesce(p_km_previos, 0);
  v_marca    text;
  v_modelo   text;
  v_codigo   text;
  v_precio   numeric(12,2);
  v_vida_n   smallint := 0;
  v_fecha_c  date;
  v_park     smallint;
  v_idn      text;
  v_nuevo_id bigint;
  v_estado_v text;
  v_ev_ids   bigint[] := '{}';
  v_ev       bigint;
  v_odo_act  integer;
  v_odo_veh  integer;
  v_txt      text;
  v_suc_dest text;
  v_suc_orig text;
  v_a_stock  boolean := coalesce(p_devolver_stock, false);
  v_cond_nv  text;
begin
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);

  if p_posicion is null or p_destino_viejo is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_posicion not between 1 and 99 then
    raise exception 'posición fuera de rango (1-99)' using errcode = '23514';
  end if;
  if p_destino_viejo not in ('baja', 'reencauche', 'reparacion', 'almacenado') then
    raise exception 'destino del neumático viejo inválido' using errcode = '22023';
  end if;
  if p_destino_viejo = 'baja' and v_motivo is null then
    raise exception 'indicar el motivo de la baja' using errcode = '22023';
  end if;
  if v_motivo is not null and length(v_motivo) > 200 then
    raise exception 'motivo demasiado largo (máx. 200)' using errcode = '22023';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  -- El odómetro del vehículo es un dato aparte (opcional): si se informa, no puede bajar.
  -- El vehículo ya quedó bloqueado por neumatico_autorizar_vehiculo.
  if p_odometro_km is not null then
    select v.odometro_km into v_odo_act from public.vehiculos v where v.id = p_vehiculo_id;
    if v_odo_act is not null and p_odometro_km < v_odo_act then
      raise exception 'el odómetro del vehículo no puede ser menor al actual (% km)', v_odo_act
        using errcode = '23514';
    end if;
  end if;
  if v_km_prev < 0 or v_km_prev > 999999999 then
    raise exception 'km previos fuera de rango (0 a 999999999)' using errcode = '23514';
  end if;
  if v_quema is not null and length(v_quema) > 40 then
    raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
  end if;
  if (p_stock_id is not null)::int + (p_nuevo is not null)::int + (p_cubierta_id is not null)::int <> 1 then
    raise exception 'indicar el neumático nuevo: cubierta del stock, lote del stock o ingresado (uno solo)'
      using errcode = '22023';
  end if;
  if v_a_stock and p_destino_viejo <> 'almacenado' then
    raise exception 'solo un neumático almacenado puede volver al stock' using errcode = '22023';
  end if;

  -- Neumático actual de la posición (bloqueado)
  select * into v_viejo from public.neumaticos n
   where n.vehiculo_id = p_vehiculo_id and n.posicion = p_posicion for update;
  if not found then
    raise exception 'no hay neumático en la posición % del vehículo', p_posicion using errcode = 'P0002';
  end if;
  if v_viejo.estado = 'baja' then
    raise exception 'el neumático de la posición % está dado de baja', p_posicion using errcode = '23514';
  end if;
  if p_destino_viejo = 'reencauche' and v_viejo.vida >= 3 then
    raise exception 'el neumático ya alcanzó la vida máxima (3 reencauches)' using errcode = '23514';
  end if;

  -- Número de quema del nuevo: único por cliente, sin distinguir mayúsculas (el índice único lo respalda).
  if p_cubierta_id is null and v_quema is not null and exists (
       select 1 from public.neumaticos n
        where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema)) then
    raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
  end if;

  -- Destino del viejo = volver al stock: quema y sucursal
  if v_a_stock then
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: dejar el neumático retirado en el vehículo'
        using errcode = '42501';
    end if;
    v_quema_v := coalesce(v_viejo.numero_quema, nullif(btrim(coalesce(p_quema_viejo, '')), ''));
    if v_quema_v is null then
      raise exception 'el neumático retirado necesita número de quema para volver al stock' using errcode = '22023';
    end if;
    if length(v_quema_v) > 40 then
      raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
    end if;
    if v_viejo.numero_quema is null and exists (
         select 1 from public.neumaticos n
          where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema_v)) then
      raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
    end if;
    v_suc_dest := public.stock_cubierta_sucursal(v_aut.cliente_id, p_sucursal_stock);
  end if;

  -- Neumático nuevo: cubierta individual, lote del MISMO cliente o ingresado a mano
  if p_cubierta_id is not null then
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: ingresar el neumático nuevo a mano'
        using errcode = '42501';
    end if;
    if v_quema is not null or v_km_prev <> 0 then
      raise exception 'la cubierta del stock ya tiene quema y km propios' using errcode = '22023';
    end if;
    select * into v_cub from public.neumaticos n
     where n.id = p_cubierta_id and n.cliente_id = v_aut.cliente_id
       and n.vehiculo_id is null and n.estado = 'almacenado' for update;
    if not found then
      raise exception 'cubierta del stock inexistente o ya montada' using errcode = 'P0002';
    end if;
    v_marca := v_cub.marca; v_modelo := v_cub.modelo; v_codigo := v_cub.codigo;
    v_precio := v_cub.precio_unidad; v_fecha_c := v_cub.fecha_compra;
    v_vida_n := v_cub.vida; v_quema := v_cub.numero_quema; v_km_prev := v_cub.km_previos;
    v_idn := v_cub.idneumatico;
    if v_cub.sucursal_id is not null then
      select s.nombre into v_suc_orig from public.sucursales s where s.id = v_cub.sucursal_id;
    end if;
  elsif p_stock_id is not null then
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: ingresar el neumático nuevo a mano'
        using errcode = '42501';
    end if;
    select * into v_stock from public.stock_neumaticos s
     where s.id = p_stock_id and s.cliente_id = v_aut.cliente_id for update;
    if not found then
      raise exception 'stock inexistente' using errcode = 'P0002';
    end if;
    if v_stock.cantidad <= 0 then
      raise exception 'sin unidades en el stock seleccionado' using errcode = '55000';
    end if;
    v_marca := v_stock.marca; v_modelo := v_stock.modelo;
    v_precio := v_stock.precio_unidad; v_fecha_c := v_stock.fecha_compra;
  else
    if jsonb_typeof(p_nuevo) <> 'object' then
      raise exception 'datos del neumático nuevo inválidos' using errcode = '22023';
    end if;
    -- marca / modelo / codigo: texto; precio: número >= 0; vida: 0..3
    v_marca := nullif(btrim(coalesce(p_nuevo ->> 'marca', '')), '');
    v_modelo := nullif(btrim(coalesce(p_nuevo ->> 'modelo', '')), '');
    v_codigo := nullif(btrim(coalesce(p_nuevo ->> 'codigo', '')), '');
    if v_marca is null then
      raise exception 'indicar la marca del neumático nuevo' using errcode = '22023';
    end if;
    if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 or length(coalesce(v_codigo, '')) > 60 then
      raise exception 'marca, modelo o código demasiado largos (máx. 60)' using errcode = '22023';
    end if;
    if p_nuevo ? 'precio' and jsonb_typeof(p_nuevo -> 'precio') not in ('number', 'null') then
      raise exception 'precio inválido' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'precio') = 'number' then
      v_txt := p_nuevo ->> 'precio';
      if (v_txt)::numeric < 0 or (v_txt)::numeric >= 10000000000 then
        raise exception 'precio fuera de rango' using errcode = '23514';
      end if;
      v_precio := round((v_txt)::numeric, 2);
    end if;
    if p_nuevo ? 'vida' and jsonb_typeof(p_nuevo -> 'vida') not in ('number', 'null') then
      raise exception 'vida inválida' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'vida') = 'number' then
      v_txt := p_nuevo ->> 'vida';
      if (v_txt)::numeric not between 0 and 3 or (v_txt)::numeric <> trunc((v_txt)::numeric) then
        raise exception 'vida fuera de rango (0-3)' using errcode = '23514';
      end if;
      v_vida_n := (v_txt)::smallint;
    end if;
  end if;

  -- 1) El viejo sale de la posición
  v_estado_v := case p_destino_viejo
                  when 'baja' then 'baja'
                  when 'reparacion' then 'reparacion'
                  else 'almacenado' end;
  if v_a_stock then
    -- Vuelve al stock: misma fila (conserva quema, mediciones y eventos), sin vehículo ni posición.
    update public.neumaticos
       set vehiculo_id  = null,
           posicion     = null,
           auxilio      = false,
           estado       = 'almacenado',
           sucursal_id  = p_sucursal_stock,
           numero_quema = v_quema_v
     where id = v_viejo.id;
  else
    -- El viejo no puede quedar en la posición (unique vehiculo_id+posicion): se "aparca" en una posición libre
    -- (de 98 hacia abajo; 99 solo si no queda otra) con su nuevo estado.
    select g into v_park
      from generate_series(99, 1, -1) g
     where g <> p_posicion
       and not exists (select 1 from public.neumaticos n
                        where n.vehiculo_id = p_vehiculo_id and n.posicion = g)
     order by (g = 99), g desc
     limit 1;
    if v_park is null then
      raise exception 'no hay posición libre para guardar el neumático retirado' using errcode = '53400';
    end if;
    update public.neumaticos
       set posicion    = v_park,
           auxilio     = false,
           estado      = v_estado_v,
           vida        = case when p_destino_viejo = 'reencauche' then vida + 1 else vida end,
           condicion   = case p_destino_viejo when 'reencauche' then 'recauchutado'
                                              when 'reparacion' then 'reparado' else condicion end,
           fecha_baja  = case when p_destino_viejo = 'baja' then current_date else fecha_baja end,
           motivo_baja = case when p_destino_viejo = 'baja' then v_motivo else motivo_baja end
     where id = v_viejo.id;
  end if;

  -- 2) El nuevo entra
  if p_cubierta_id is not null then
    update public.neumaticos
       set vehiculo_id = p_vehiculo_id,
           posicion    = p_posicion,
           sucursal_id = null,
           estado      = 'montado',
           auxilio     = v_viejo.auxilio
     where id = v_cub.id
    returning id, condicion into v_nuevo_id, v_cond_nv;   -- el trigger pasó «nuevo» a «usado»
  else
    loop
      v_idn := 'CN-' || p_vehiculo_id || '-' || p_posicion || '-'
               || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
      exit when not exists (select 1 from public.neumaticos n where n.idneumatico = v_idn);
    end loop;
    insert into public.neumaticos
      (vehiculo_id, cliente_id, posicion, stock_id, marca, modelo, fecha_compra, precio_unidad,
       idneumatico, codigo, auxilio, vida, estado, numero_quema, km_previos, condicion)
    values
      (p_vehiculo_id, v_aut.cliente_id, p_posicion, p_stock_id, v_marca, v_modelo, v_fecha_c, v_precio,
       v_idn, v_codigo, v_viejo.auxilio, v_vida_n, 'montado', v_quema, v_km_prev,
       case when v_vida_n > 0 then 'recauchutado' else 'usado' end)
    returning id, condicion into v_nuevo_id, v_cond_nv;

    if p_stock_id is not null then
      update public.stock_neumaticos set cantidad = cantidad - 1 where id = p_stock_id;
    end if;
  end if;

  -- 3) Eventos
  if p_destino_viejo = 'baja' then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
    values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'baja', p_posicion,
            p_odometro_km, 'Cambio de neumático: ' || v_motivo, auth.uid())
    returning id into v_ev;
    v_ev_ids := v_ev_ids || v_ev;
  else
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km,
       sucursal_destino_id, notas, created_by)
    values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'desmontaje', p_posicion,
            p_odometro_km, case when v_a_stock then p_sucursal_stock end,
            'Cambio de neumático (' || p_destino_viejo || ')' || coalesce(': ' || v_motivo, '')
              || case when v_a_stock then ' · vuelve al stock: ' || coalesce(v_suc_dest, 'sin sucursal') else '' end,
            auth.uid())
    returning id into v_ev;
    v_ev_ids := v_ev_ids || v_ev;
    if p_destino_viejo = 'reencauche' then
      insert into public.eventos_neumatico
        (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
      values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'reencauche', p_posicion,
              p_odometro_km, 'Reencauche nº ' || (v_viejo.vida + 1), auth.uid())
      returning id into v_ev;
      v_ev_ids := v_ev_ids || v_ev;
    end if;
  end if;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_destino, odometro_km, costo,
     sucursal_origen_id, notas, created_by)
  values (v_aut.cliente_id, p_vehiculo_id, v_nuevo_id, v_idn, 'montaje', p_posicion,
          p_odometro_km,
          -- El costo de compra se imputa una sola vez: en el primer montaje de la cubierta («nuevo»).
          case when p_cubierta_id is null or v_cub.condicion = 'nuevo' then v_precio end,
          case when p_cubierta_id is not null then v_cub.sucursal_id end,
          'Cambio de neumático: reemplaza a ' || coalesce(v_viejo.idneumatico, '#' || v_viejo.id)
            || coalesce(' · quema ' || v_quema, '')
            || case when v_km_prev > 0 then ' · ' || v_km_prev || ' km previos' else '' end
            || case when p_cubierta_id is not null
                    then ' · cubierta del stock (' || coalesce(v_suc_orig, 'sin sucursal') || ')' else '' end,
          auth.uid())
  returning id into v_ev;
  v_ev_ids := v_ev_ids || v_ev;

  -- 4) Odómetro del vehículo: solo sube (ya se comprobó que no es menor al actual)
  if p_odometro_km is not null then
    update public.vehiculos
       set odometro_km = p_odometro_km, odometro_actualizado_at = now()
     where id = p_vehiculo_id and (odometro_km is null or odometro_km < p_odometro_km);
  end if;
  select odometro_km into v_odo_veh from public.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'vehiculo_id', p_vehiculo_id,
    'posicion', p_posicion,
    'neumatico_viejo_id', v_viejo.id,
    'neumatico_viejo_posicion', case when v_a_stock then null else v_park end,
    'neumatico_viejo_en_stock', v_a_stock,
    'destino_viejo', p_destino_viejo,
    'neumatico_nuevo_id', v_nuevo_id,
    'idneumatico_nuevo', v_idn,
    'numero_quema', v_quema,
    'km_previos', v_km_prev,
    'condicion_nuevo', v_cond_nv,
    'stock_id', p_stock_id,
    'cubierta_id', p_cubierta_id,
    'stock_restante', case when p_stock_id is not null then v_stock.cantidad - 1 end,
    'odometro_km', v_odo_veh,
    'eventos', to_jsonb(v_ev_ids));
end
$$;

revoke all on function public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb, text, integer,
  bigint, boolean, bigint, text) from public, anon;
grant execute on function public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb, text, integer,
  bigint, boolean, bigint, text) to authenticated;
