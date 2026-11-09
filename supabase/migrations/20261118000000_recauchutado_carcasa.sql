-- =============================================================================
-- NEUMET · Recauchutado por carcasa (hoja de ruta F5)
-- =============================================================================
-- Requiere 20261106020000 (neumaticos.vida, eventos_neumatico), 20261113000000 (stock de cubiertas, tipos de evento),
-- 20261116500000 (precios_visibles, privilegios por columna) y 20261117000000 (costos_neumatico, v_costo_cubierta,
-- cpk_por_grupo).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve. Idempotente (reaplicable). No borra datos.
-- Diseño y reglas: docs/08-esquema-datos.md (apéndice L).
--
-- Modelo: la identidad de la carcasa es la fila de neumaticos (misma quema, mismo idneumatico). Cada recauchutado
-- exitoso suma una VIDA a esa misma fila (neumaticos.vida 0..3) sin reiniciar sus km. El proceso es una tabla propia:
--     enviado -> apto (dictamen del proveedor) -> recibido (aceptación: nueva banda)
--     enviado | apto -> rechazado (sin nueva vida: un rechazo no crea una vida ficticia)
--   * recauchutados: un proceso por envío (proveedor, fechas, dictamen, motivo, estado). Un solo proceso abierto
--     (enviado o apto) por cubierta. Mientras está abierto la cubierta no puede montarse, moverse ni cambiar de vida
--     (trigger neumaticos_guardia_recauchutado).
--   * neumatico_vidas: una fila por banda aplicada (vida 1..3): profundidad inicial, marca y modelo de la banda.
--     La vida 0 es la banda original y no tiene fila.
--   * RPC recauchutado_enviar / _dictaminar / _aceptar / _rechazar: SECURITY DEFINER, search_path = '', autorización
--     dentro (admin o perfil GLOBAL del cliente dueño; sucursal, api, sin perfil, anon y otro cliente: 42501 uniforme).
--   * costos_neumatico.vida: el costo de cada concepto pertenece a una vida. v_costo_vida y cpk_por_grupo('vida' |
--     'banda') dan el costo por km de cada vida y de cada banda. v_costo_cubierta (carcasa completa) no cambia.
--
-- Lo que sigue funcionando: «Cambiar neumático» con destino «Recauchutado» (neumatico_cambiar) suma la vida al retirar
-- el neumático, sin proceso ni banda registrada; sirve para un recauchutado ya hecho fuera de este flujo.
--
-- Vida de un evento (para asignar costos y km): vida_base + cantidad de eventos 'reencauche' hasta ese evento, donde
-- vida_base = neumaticos.vida - total de eventos 'reencauche' (cubiertas que ya entraron con vida > 0). Es válido
-- para el flujo nuevo y para el anterior: ambos dejan un evento 'reencauche'.
--
-- Costo de las consultas: sin CTE recursiva en vistas. costo_vida_items(neumatico_id) se llama una vez por cubierta
-- y solo toca eventos_neumatico_neum_idx y costos_neumatico_neum_idx.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos de evento nuevos
-- -----------------------------------------------------------------------------
alter table public.eventos_neumatico drop constraint if exists eventos_neumatico_tipo_check;
alter table public.eventos_neumatico drop constraint if exists eventos_neumatico_tipo_ck;
alter table public.eventos_neumatico add constraint eventos_neumatico_tipo_ck check (tipo in
  ('montaje','desmontaje','rotacion','reparacion','reencauche','baja','inspeccion',
   'alta_stock','traslado','cambio_condicion',
   'envio_recauchutado','dictamen_recauchutado','rechazo_recauchutado'));

-- -----------------------------------------------------------------------------
-- 2. costos_neumatico.vida
-- -----------------------------------------------------------------------------
-- Los costos ya cargados se asignan a la vida actual de su cubierta (los de concepto 'compra', a la vida base).
-- La asignación se hace solo al crear la columna: reaplicar la migración no la repite.
do $mig$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'costos_neumatico' and column_name = 'vida') then
    alter table public.costos_neumatico add column vida smallint;
    update public.costos_neumatico c
       set vida = case when c.concepto = 'compra'
                       then greatest(n.vida - (select count(*) from public.eventos_neumatico e
                                                where e.neumatico_id = n.id and e.tipo = 'reencauche'), 0)
                       else n.vida end
      from public.neumaticos n
     where n.id = c.neumatico_id;
    update public.costos_neumatico set vida = 0 where vida is null;
    alter table public.costos_neumatico alter column vida set not null;
    alter table public.costos_neumatico alter column vida set default 0;
    alter table public.costos_neumatico add constraint costos_neumatico_vida_ck check (vida between 0 and 3);
  end if;
end
$mig$;

-- -----------------------------------------------------------------------------
-- 3. Tablas recauchutados y neumatico_vidas
-- -----------------------------------------------------------------------------
create table if not exists public.recauchutados (
  id                 bigint generated by default as identity primary key,
  cliente_id         bigint not null references public.clientes (id) on delete restrict,
  neumatico_id       bigint not null,
  -- Copia de lo que identifica a la cubierta al enviarla (historial legible aunque cambie después).
  idneumatico        text,
  numero_quema       text,
  marca              text,
  modelo             text,
  vida_origen        smallint not null check (vida_origen between 0 and 2),
  vida_nueva         smallint check (vida_nueva between 1 and 3),
  proveedor          text not null check (length(proveedor) between 1 and 80),
  estado             text not null default 'enviado' check (estado in ('enviado', 'apto', 'recibido', 'rechazado')),
  fecha_envio        date not null default current_date,
  sucursal_origen_id bigint,
  fecha_dictamen     date,
  fecha_cierre       date,
  motivo             text check (motivo is null or length(motivo) <= 300),
  notas              text check (notas is null or length(notas) <= 500),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  constraint recauchutados_neumatico_fk foreign key (neumatico_id, cliente_id)
    references public.neumaticos (id, cliente_id) on delete restrict on update restrict,
  -- Una vida nueva solo existe si el proceso terminó en «recibido».
  constraint recauchutados_vida_nueva_ck check ((estado = 'recibido') = (vida_nueva is not null)),
  constraint recauchutados_cierre_ck check ((estado in ('recibido', 'rechazado')) = (fecha_cierre is not null))
);
create index if not exists recauchutados_neum_idx    on public.recauchutados (neumatico_id);
create index if not exists recauchutados_cliente_idx on public.recauchutados (cliente_id, fecha_envio desc);
-- Un solo proceso abierto por cubierta (también lo usa la guardia de abajo).
create unique index if not exists recauchutados_abierto_uk on public.recauchutados (neumatico_id)
  where estado in ('enviado', 'apto');

create table if not exists public.neumatico_vidas (
  id                     bigint generated by default as identity primary key,
  cliente_id             bigint not null references public.clientes (id) on delete restrict,
  neumatico_id           bigint not null,
  vida                   smallint not null check (vida between 1 and 3),
  proceso_id             bigint not null references public.recauchutados (id) on delete restrict,
  fecha                  date not null,
  profundidad_inicial_mm numeric(4,1) not null check (profundidad_inicial_mm > 0 and profundidad_inicial_mm <= 30),
  banda_marca            text check (banda_marca is null or length(banda_marca) between 1 and 60),
  banda_modelo           text check (banda_modelo is null or length(banda_modelo) between 1 and 60),
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  constraint neumatico_vidas_neumatico_fk foreign key (neumatico_id, cliente_id)
    references public.neumaticos (id, cliente_id) on delete restrict on update restrict,
  constraint neumatico_vidas_uk unique (neumatico_id, vida)
);
create index if not exists neumatico_vidas_proceso_idx on public.neumatico_vidas (proceso_id);

drop trigger if exists trg_audit_recauchutados on public.recauchutados;
create trigger trg_audit_recauchutados after insert or update or delete on public.recauchutados
  for each row execute function public.audit_row();
drop trigger if exists trg_audit_neumatico_vidas on public.neumatico_vidas;
create trigger trg_audit_neumatico_vidas after insert or update or delete on public.neumatico_vidas
  for each row execute function public.audit_row();

-- RLS: lectura para admin y el perfil GLOBAL del cliente (como el stock). Sin políticas ni privilegios de escritura:
-- solo escriben las RPC de abajo.
alter table public.recauchutados enable row level security;
alter table public.neumatico_vidas enable row level security;
revoke all on table public.recauchutados from public, anon, authenticated;
revoke all on table public.neumatico_vidas from public, anon, authenticated;
grant select on public.recauchutados to authenticated;
grant select on public.neumatico_vidas to authenticated;

drop policy if exists recauchutados_admin_select on public.recauchutados;
create policy recauchutados_admin_select on public.recauchutados for select to authenticated
  using ((select public.is_admin()));
drop policy if exists recauchutados_cliente_select on public.recauchutados;
create policy recauchutados_cliente_select on public.recauchutados for select to authenticated
  using (cliente_id = (select public.current_cliente_id()) and (select public.current_sucursal_id()) is null);
drop policy if exists neumatico_vidas_admin_select on public.neumatico_vidas;
create policy neumatico_vidas_admin_select on public.neumatico_vidas for select to authenticated
  using ((select public.is_admin()));
drop policy if exists neumatico_vidas_cliente_select on public.neumatico_vidas;
create policy neumatico_vidas_cliente_select on public.neumatico_vidas for select to authenticated
  using (cliente_id = (select public.current_cliente_id()) and (select public.current_sucursal_id()) is null);

-- -----------------------------------------------------------------------------
-- 4. Guardia: una cubierta con proceso abierto no se monta, no se mueve y no cambia de vida
-- -----------------------------------------------------------------------------
-- Cubre todos los caminos (neumatico_cambiar, neumatico_montar, stock_cubierta_mover, escritura directa de un rol
-- que omite la RLS). Las RPC de este archivo la omiten con una variable de transacción que apagan al terminar.
create or replace function public.neumaticos_guardia_recauchutado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('neumet.recauchutado', true), '') = 'on' then
    return new;
  end if;
  if (new.vehiculo_id is distinct from old.vehiculo_id or new.sucursal_id is distinct from old.sucursal_id
      or new.estado is distinct from old.estado or new.vida is distinct from old.vida)
     and exists (select 1 from public.recauchutados r
                  where r.neumatico_id = old.id and r.estado in ('enviado', 'apto')) then
    raise exception 'la cubierta está en recauchutado: cerrar el proceso antes' using errcode = '55000';
  end if;
  return new;
end
$$;
revoke all on function public.neumaticos_guardia_recauchutado() from public, anon, authenticated;
drop trigger if exists neumaticos_guardia_recauchutado on public.neumaticos;
create trigger neumaticos_guardia_recauchutado
  before update of vehiculo_id, sucursal_id, estado, vida on public.neumaticos
  for each row execute function public.neumaticos_guardia_recauchutado();

-- -----------------------------------------------------------------------------
-- 5. Auxiliares internos (sin grant)
-- -----------------------------------------------------------------------------
-- Proceso + autorización. Un no-admin no distingue «no existe», «es de otro cliente» y «es de una sucursal»: 42501.
-- Bloquea el proceso y la cubierta (serializa dictamen, aceptación y rechazo concurrentes).
create or replace function public.recauchutado_autorizar(p_id bigint)
returns public.recauchutados
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r   public.recauchutados%rowtype;
  v_aut record;
begin
  if p_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_r from public.recauchutados r where r.id = p_id;
  if not found then
    if auth.uid() is not null and public.is_admin() then
      raise exception 'recauchutado inexistente' using errcode = 'P0002';
    end if;
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_r.cliente_id);
  select * into v_r from public.recauchutados r where r.id = p_id for update;
  perform 1 from public.neumaticos n where n.id = v_r.neumatico_id for update;
  perform set_config('neumet.recauchutado', 'on', true);
  return v_r;
end
$$;
revoke all on function public.recauchutado_autorizar(bigint) from public, anon, authenticated;

create or replace function public.recauchutado_validar_fecha(p_fecha date, p_desde date default null)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_f date := coalesce(p_fecha, current_date);
begin
  if v_f > current_date + 1 or v_f < date '2000-01-01' or (p_desde is not null and v_f < p_desde) then
    raise exception 'fecha inválida' using errcode = '23514';
  end if;
  return v_f;
end
$$;
revoke all on function public.recauchutado_validar_fecha(date, date) from public, anon, authenticated;

-- Cierra un proceso sin nueva vida (rechazo). La cubierta vuelve al stock de la sucursal indicada.
create or replace function public.recauchutado_cerrar_rechazo(
  p_id bigint, p_motivo text, p_fecha date, p_sucursal_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.recauchutados%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_fecha  date;
  v_suc    text;
begin
  select * into v_r from public.recauchutados r where r.id = p_id;
  if v_motivo is null then
    raise exception 'indicar el motivo del rechazo' using errcode = '22023';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'motivo demasiado largo (máximo 300 caracteres)' using errcode = '23514';
  end if;
  v_fecha := public.recauchutado_validar_fecha(p_fecha, v_r.fecha_envio);
  v_suc := public.stock_cubierta_sucursal(v_r.cliente_id, p_sucursal_id);

  update public.recauchutados
     set estado = 'rechazado', motivo = v_motivo, fecha_cierre = v_fecha,
         fecha_dictamen = coalesce(fecha_dictamen, v_fecha)
   where id = v_r.id;
  update public.neumaticos set sucursal_id = p_sucursal_id where id = v_r.neumatico_id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_destino_id, notas, created_by)
  values (v_r.cliente_id, null, v_r.neumatico_id, v_r.idneumatico, 'rechazo_recauchutado', p_sucursal_id,
          'Recauchutado rechazado (' || v_r.proveedor || '): ' || v_motivo
            || '. Vuelve a ' || coalesce(v_suc, 'sin sucursal'), auth.uid());
  return jsonb_build_object('id', v_r.id, 'neumatico_id', v_r.neumatico_id, 'estado', 'rechazado');
end
$$;
revoke all on function public.recauchutado_cerrar_rechazo(bigint, text, date, bigint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPC del flujo
-- -----------------------------------------------------------------------------
-- 6.1 Enviar: la cubierta sale del stock (o del lugar donde quedó aparcada) hacia el proveedor.
create or replace function public.recauchutado_enviar(
  p_neumatico_id bigint,
  p_proveedor    text,
  p_fecha        date default null,
  p_notas        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n         public.neumaticos%rowtype;
  v_aut       record;
  v_proveedor text := nullif(btrim(coalesce(p_proveedor, '')), '');
  v_notas     text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fecha     date;
  v_id        bigint;
begin
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id;
  if not found then
    if auth.uid() is not null and public.is_admin() then
      raise exception 'neumático inexistente' using errcode = 'P0002';
    end if;
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id for update;

  if v_proveedor is null then
    raise exception 'indicar el proveedor' using errcode = '22023';
  end if;
  if length(v_proveedor) > 80 then
    raise exception 'proveedor demasiado largo (máximo 80 caracteres)' using errcode = '22023';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'notas demasiado largas (máximo 500 caracteres)' using errcode = '23514';
  end if;
  v_fecha := public.recauchutado_validar_fecha(p_fecha);
  if v_n.estado = 'montado' then
    raise exception 'la cubierta está montada: retirarla del vehículo antes de enviarla' using errcode = '55000';
  end if;
  if v_n.estado <> 'almacenado' then
    raise exception 'la cubierta no está disponible (estado %)', v_n.estado using errcode = '55000';
  end if;
  if v_n.vida >= 3 then
    raise exception 'la carcasa ya alcanzó la vida máxima (3 recauchutados)' using errcode = '23514';
  end if;
  if exists (select 1 from public.recauchutados r
              where r.neumatico_id = v_n.id and r.estado in ('enviado', 'apto')) then
    raise exception 'la cubierta ya está en recauchutado' using errcode = '55000';
  end if;

  perform set_config('neumet.recauchutado', 'on', true);
  -- Sale de donde estuviera (stock o posición de aparcamiento) y queda «en el proveedor»: sin vehículo ni sucursal.
  update public.neumaticos
     set vehiculo_id = null, posicion = null, auxilio = false, sucursal_id = null
   where id = v_n.id;
  insert into public.recauchutados
    (cliente_id, neumatico_id, idneumatico, numero_quema, marca, modelo, vida_origen, proveedor, fecha_envio,
     sucursal_origen_id, notas, created_by)
  values (v_n.cliente_id, v_n.id, v_n.idneumatico, v_n.numero_quema, v_n.marca, v_n.modelo, v_n.vida, v_proveedor,
          v_fecha, v_n.sucursal_id, v_notas, auth.uid())
  returning id into v_id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_origen_id, notas, created_by)
  values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'envio_recauchutado', v_n.sucursal_id,
          'Enviado a recauchutar: ' || v_proveedor, auth.uid());

  perform set_config('neumet.recauchutado', '', true);
  return jsonb_build_object('id', v_id, 'neumatico_id', v_n.id, 'estado', 'enviado', 'proveedor', v_proveedor,
                            'fecha_envio', v_fecha);
end
$$;
revoke all on function public.recauchutado_enviar(bigint, text, date, text) from public, anon;
grant execute on function public.recauchutado_enviar(bigint, text, date, text) to authenticated;

-- 6.2 Dictamen del proveedor: apto (sigue) o no apto (rechazo: vuelve sin nueva vida).
create or replace function public.recauchutado_dictaminar(
  p_id          bigint,
  p_apto        boolean,
  p_motivo      text default null,
  p_fecha       date default null,
  p_sucursal_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.recauchutados%rowtype;
  v_fecha  date;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_res    jsonb;
begin
  v_r := public.recauchutado_autorizar(p_id);
  if p_apto is null then
    raise exception 'indicar el dictamen' using errcode = '22004';
  end if;
  if v_r.estado <> 'enviado' then
    raise exception 'el recauchutado ya tiene dictamen o está cerrado' using errcode = '55000';
  end if;
  if p_apto = false then
    v_res := public.recauchutado_cerrar_rechazo(v_r.id, p_motivo, p_fecha, p_sucursal_id);
    perform set_config('neumet.recauchutado', '', true);
    return v_res;
  end if;
  if v_motivo is not null and length(v_motivo) > 300 then
    raise exception 'motivo demasiado largo (máximo 300 caracteres)' using errcode = '23514';
  end if;
  v_fecha := public.recauchutado_validar_fecha(p_fecha, v_r.fecha_envio);
  update public.recauchutados set estado = 'apto', fecha_dictamen = v_fecha, motivo = v_motivo where id = v_r.id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, notas, created_by)
  values (v_r.cliente_id, null, v_r.neumatico_id, v_r.idneumatico, 'dictamen_recauchutado',
          'Carcasa apta para recauchutar (' || v_r.proveedor || ')' || coalesce(': ' || v_motivo, ''), auth.uid());
  perform set_config('neumet.recauchutado', '', true);
  return jsonb_build_object('id', v_r.id, 'neumatico_id', v_r.neumatico_id, 'estado', 'apto');
end
$$;
revoke all on function public.recauchutado_dictaminar(bigint, boolean, text, date, bigint) from public, anon;
grant execute on function public.recauchutado_dictaminar(bigint, boolean, text, date, bigint) to authenticated;

-- 6.3 Aceptación: llega la cubierta con la banda nueva. Suma una vida a la misma carcasa.
create or replace function public.recauchutado_aceptar(
  p_id            bigint,
  p_profundidad_mm numeric,
  p_banda_marca   text default null,
  p_banda_modelo  text default null,
  p_costo         numeric default null,
  p_moneda        text default 'UYU',
  p_fecha         date default null,
  p_sucursal_id   bigint default null,
  p_notas         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       public.recauchutados%rowtype;
  v_n       public.neumaticos%rowtype;
  v_fecha   date;
  v_suc     text;
  v_prof    numeric;
  v_bmarca  text := nullif(btrim(coalesce(p_banda_marca, '')), '');
  v_bmodelo text := nullif(btrim(coalesce(p_banda_modelo, '')), '');
  v_moneda  text := upper(btrim(coalesce(p_moneda, 'UYU')));
  v_costo   numeric;
  v_notas   text := nullif(btrim(coalesce(p_notas, '')), '');
  v_vida    smallint;
begin
  v_r := public.recauchutado_autorizar(p_id);
  select * into v_n from public.neumaticos n where n.id = v_r.neumatico_id;
  if v_r.estado <> 'apto' then
    raise exception 'solo se acepta un recauchutado con dictamen apto' using errcode = '55000';
  end if;
  if p_profundidad_mm is null then
    raise exception 'indicar la profundidad inicial de la banda' using errcode = '22004';
  end if;
  if p_profundidad_mm = 'NaN'::numeric then
    raise exception 'profundidad inválida' using errcode = '23514';
  end if;
  v_prof := round(p_profundidad_mm, 1);
  if v_prof <= 0 or v_prof > 30 then
    raise exception 'profundidad fuera de rango (0 a 30 mm)' using errcode = '23514';
  end if;
  if v_bmarca is not null and length(v_bmarca) > 60 or v_bmodelo is not null and length(v_bmodelo) > 60 then
    raise exception 'marca o modelo de la banda demasiado largos (máximo 60 caracteres)' using errcode = '23514';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'notas demasiado largas (máximo 500 caracteres)' using errcode = '23514';
  end if;
  if p_costo is not null then
    if p_costo = 'NaN'::numeric or p_costo < 0 then
      raise exception 'monto inválido: debe ser mayor o igual a 0' using errcode = '23514';
    end if;
    v_costo := round(p_costo, 2);
    if v_costo > 9999999999.99 then
      raise exception 'monto fuera de rango' using errcode = '22003';
    end if;
    if v_moneda !~ '^[A-Z]{3}$' then
      raise exception 'moneda inválida: código de 3 letras' using errcode = '23514';
    end if;
  end if;
  v_fecha := public.recauchutado_validar_fecha(p_fecha, v_r.fecha_envio);
  v_suc := public.stock_cubierta_sucursal(v_r.cliente_id, p_sucursal_id);
  if v_n.vida >= 3 then
    raise exception 'la carcasa ya alcanzó la vida máxima (3 recauchutados)' using errcode = '23514';
  end if;
  v_vida := v_n.vida + 1;

  update public.neumaticos
     set vida = v_vida, condicion = 'recauchutado', sucursal_id = p_sucursal_id
   where id = v_n.id;
  insert into public.neumatico_vidas
    (cliente_id, neumatico_id, vida, proceso_id, fecha, profundidad_inicial_mm, banda_marca, banda_modelo, created_by)
  values (v_r.cliente_id, v_n.id, v_vida, v_r.id, v_fecha, v_prof, v_bmarca, v_bmodelo, auth.uid());
  if v_costo is not null then
    -- El costo es de la vida nueva. El evento no lleva costo: no se cuenta dos veces.
    insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda, fecha, notas, vida, created_by)
    values (v_r.cliente_id, v_n.id, 'recauchutado', v_costo, v_moneda, v_fecha,
            'Recauchutado nº ' || v_vida || ' (' || v_r.proveedor || ')', v_vida, auth.uid());
  end if;
  update public.recauchutados
     set estado = 'recibido', vida_nueva = v_vida, fecha_cierre = v_fecha,
         notas = coalesce(v_notas, notas)
   where id = v_r.id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_destino_id, notas, created_by)
  values (v_r.cliente_id, null, v_n.id, v_n.idneumatico, 'reencauche', p_sucursal_id,
          'Recauchutado nº ' || v_vida || ' (' || v_r.proveedor || '), banda de ' || v_prof || ' mm. En '
            || coalesce(v_suc, 'sin sucursal'), auth.uid());

  perform set_config('neumet.recauchutado', '', true);
  return jsonb_build_object('id', v_r.id, 'neumatico_id', v_n.id, 'estado', 'recibido', 'vida', v_vida,
                            'profundidad_inicial_mm', v_prof);
end
$$;
revoke all on function public.recauchutado_aceptar(bigint, numeric, text, text, numeric, text, date, bigint, text) from public, anon;
grant execute on function public.recauchutado_aceptar(bigint, numeric, text, text, numeric, text, date, bigint, text) to authenticated;

-- 6.4 Rechazo al recibir: la cubierta con dictamen apto llegó con defectos y no se acepta. Sin vida nueva.
create or replace function public.recauchutado_rechazar(
  p_id          bigint,
  p_motivo      text,
  p_fecha       date default null,
  p_sucursal_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r   public.recauchutados%rowtype;
  v_res jsonb;
begin
  v_r := public.recauchutado_autorizar(p_id);
  if v_r.estado <> 'apto' then
    raise exception 'solo se rechaza un recauchutado con dictamen apto (si no es apto, registrar el dictamen)'
      using errcode = '55000';
  end if;
  v_res := public.recauchutado_cerrar_rechazo(v_r.id, p_motivo, p_fecha, p_sucursal_id);
  perform set_config('neumet.recauchutado', '', true);
  return v_res;
end
$$;
revoke all on function public.recauchutado_rechazar(bigint, text, date, bigint) from public, anon;
grant execute on function public.recauchutado_rechazar(bigint, text, date, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. costo_registrar: el costo se asigna a una vida
-- -----------------------------------------------------------------------------
-- Misma firma que en 20261117000000. La vida es la actual de la cubierta; la compra pertenece a la vida base (la de la
-- compra de la carcasa), no a la actual. El costo de un recauchutado lo registra recauchutado_aceptar.
create or replace function public.costo_registrar(
  p_neumatico_id bigint,
  p_concepto     text,
  p_monto        numeric,
  p_fecha        date default null,
  p_notas        text default null,
  p_moneda       text default 'UYU'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n        public.neumaticos%rowtype;
  v_aut      record;
  v_concepto text := lower(btrim(coalesce(p_concepto, '')));
  v_moneda   text := upper(btrim(coalesce(p_moneda, 'UYU')));
  v_fecha    date := coalesce(p_fecha, current_date);
  v_notas    text := nullif(btrim(coalesce(p_notas, '')), '');
  v_monto    numeric;
  v_vida     smallint;
  v_id       bigint;
begin
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id;
  if not found then
    if auth.uid() is not null and public.is_admin() then
      raise exception 'neumático inexistente' using errcode = 'P0002';
    end if;
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);

  if v_concepto not in ('compra', 'reparacion', 'recauchutado', 'montaje', 'otro') then
    raise exception 'concepto inválido' using errcode = '23514';
  end if;
  if p_monto is null then
    raise exception 'monto obligatorio' using errcode = '22004';
  end if;
  if p_monto = 'NaN'::numeric or p_monto < 0 then
    raise exception 'monto inválido: debe ser mayor o igual a 0' using errcode = '23514';
  end if;
  v_monto := round(p_monto, 2);
  if v_monto > 9999999999.99 then
    raise exception 'monto fuera de rango' using errcode = '22003';
  end if;
  if v_moneda !~ '^[A-Z]{3}$' then
    raise exception 'moneda inválida: código de 3 letras' using errcode = '23514';
  end if;
  if v_fecha > current_date + 1 or v_fecha < date '2000-01-01' then
    raise exception 'fecha inválida' using errcode = '23514';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'notas demasiado largas (máximo 500 caracteres)' using errcode = '23514';
  end if;

  v_vida := case when v_concepto = 'compra'
                 then greatest(v_n.vida - (select count(*) from public.eventos_neumatico e
                                            where e.neumatico_id = v_n.id and e.tipo = 'reencauche'), 0)
                 else v_n.vida end;
  insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda, fecha, notas, vida, created_by)
  values (v_n.cliente_id, v_n.id, v_concepto, v_monto, v_moneda, v_fecha, v_notas, v_vida, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'neumatico_id', v_n.id, 'concepto', v_concepto, 'monto', v_monto,
                            'moneda', v_moneda, 'fecha', v_fecha);
end
$$;
revoke all on function public.costo_registrar(bigint, text, numeric, date, text, text) from public, anon;
grant execute on function public.costo_registrar(bigint, text, numeric, date, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. costo_vida_items(p_neumatico): costo y km de cada vida de una cubierta (interno de v_costo_vida)
-- -----------------------------------------------------------------------------
-- Mismo contrato de seguridad que costo_cubierta_items: precio_unidad y eventos_neumatico.costo no tienen SELECT para
-- authenticated, así que lo calcula esta función SECURITY DEFINER, y solo responde si precios_visibles() (admin o
-- perfil global) y la cubierta es visible para quien llama. Sucursal, api, sin perfil, otro cliente y anon: sin filas.
-- Una fila por vida existente (de la vida base a la actual).
--   Costo: las mismas tres fuentes y la misma regla de no doble conteo que costo_cubierta_items (la suma de las vidas
--   es el total de la carcasa), cada una asignada a su vida: entradas manuales por su columna vida; eventos con costo
--   por la vida vigente en ese evento; compra a la vida base.
--   Km: tramos de montaje de la cubierta (como km_tramos_cubierta) asignados a la vida vigente al montar. Un tramo sin
--   odómetro, decreciente o sin cierre es «sin dato»: no suma y deja km_confiable en false. NULL si todos los tramos
--   de la vida son sin dato. Los km_previos (de antes de entrar) no son de ninguna vida de esta tabla.
drop view if exists public.v_costo_vida;
drop function if exists public.costo_vida_items(bigint);
create or replace function public.costo_vida_items(p_neumatico bigint)
returns table (
  vida                   smallint,
  vida_actual            smallint,
  banda_marca            text,
  banda_modelo           text,
  profundidad_inicial_mm numeric,
  fecha_inicio           date,
  n_items                integer,
  n_monedas              integer,
  moneda                 text,
  total                  numeric,
  km_recorridos          bigint,
  tramos_con_dato        integer,
  tramos_sin_dato        integer
)
language plpgsql
stable
security definer
set search_path = ''
rows 2
as $$
declare
  v_precio numeric;
  v_vida   smallint;
  v_estado text;
  v_veh    bigint;
  v_odo    integer;
  v_nre    integer;
  v_base   integer;
  v_rol    text;
  v_cli    bigint;
begin
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') then
    if not public.precios_visibles() then
      return;
    end if;
    select p.rol, p.cliente_id into v_rol, v_cli from public.perfiles p where p.user_id = auth.uid();
    if v_rol is distinct from 'admin' then
      perform 1 from public.neumaticos n
        left join public.vehiculos v on v.id = n.vehiculo_id
       where n.id = p_neumatico
         and ((v.id is not null and v.cliente_id = v_cli) or (n.vehiculo_id is null and n.cliente_id = v_cli));
      if not found then
        return;
      end if;
    end if;
  end if;

  select n.precio_unidad, n.vida, n.estado, n.vehiculo_id, v.odometro_km
    into v_precio, v_vida, v_estado, v_veh, v_odo
    from public.neumaticos n
    left join public.vehiculos v on v.id = n.vehiculo_id
   where n.id = p_neumatico;
  if not found then
    return;
  end if;
  select count(*)::int into v_nre from public.eventos_neumatico e where e.neumatico_id = p_neumatico and e.tipo = 'reencauche';
  v_base := greatest(v_vida - v_nre, 0);

  return query
  with ev as (
    select e.id, e.created_at, e.tipo, e.vehiculo_id, e.odometro_km, e.costo,
           least(v_base + (count(*) filter (where e.tipo = 'reencauche') over (order by e.created_at, e.id))::int, 3)::smallint as vida_ev
      from public.eventos_neumatico e
     where e.neumatico_id = p_neumatico
  ),
  seq as (
    select s.vida_ev, s.tipo, s.vehiculo_id, s.odometro_km,
           lead(s.tipo)        over w as sig_tipo,
           lead(s.vehiculo_id) over w as sig_veh,
           lead(s.odometro_km) over w as sig_odo
      from ev s
     where s.vehiculo_id is not null and s.tipo in ('montaje', 'desmontaje', 'baja')
    window w as (order by s.created_at, s.id)
  ),
  tr as (
    select s.vida_ev as vida,
           case
             when s.sig_tipo in ('desmontaje', 'baja')
               then (s.sig_veh = s.vehiculo_id and s.odometro_km is not null and s.sig_odo is not null
                     and s.sig_odo >= s.odometro_km)
             when s.sig_tipo is null
               then (v_estado = 'montado' and v_veh = s.vehiculo_id and s.odometro_km is not null and v_odo is not null)
             else false end as conocido,
           case
             when s.sig_tipo in ('desmontaje', 'baja') then s.sig_odo - s.odometro_km
             when s.sig_tipo is null then greatest(v_odo - s.odometro_km, 0)
           end as km
      from seq s
     where s.tipo = 'montaje'
  ),
  kv as (
    select t.vida,
           coalesce(sum(t.km) filter (where t.conocido), 0)::bigint as km,
           (count(*) filter (where t.conocido))::int as con,
           (count(*) filter (where not t.conocido))::int as sin
      from tr t
     group by t.vida
  ),
  it as (
    select i.vida, i.concepto, i.moneda, sum(i.monto) as monto
      from (
        select m.vida, m.concepto, m.moneda, m.monto
          from public.costos_neumatico m
         where m.neumatico_id = p_neumatico
        union all
        select x.vida_ev, case x.tipo when 'reparacion' then 'reparacion' when 'reencauche' then 'recauchutado'
                                      else 'otro' end, 'UYU', x.costo
          from ev x
         where x.costo is not null and x.tipo <> 'montaje'
        union all
        select v_base::smallint, 'compra', 'UYU', v_precio
         where v_precio is not null
           and not exists (select 1 from public.costos_neumatico m
                            where m.neumatico_id = p_neumatico and m.concepto = 'compra')
        union all
        select v_base::smallint, 'compra', 'UYU', max(x.costo)
          from ev x
         where v_precio is null and x.tipo = 'montaje' and x.costo is not null
           and not exists (select 1 from public.costos_neumatico m
                            where m.neumatico_id = p_neumatico and m.concepto = 'compra')
        having max(x.costo) is not null
      ) i
     group by i.vida, i.concepto, i.moneda
  ),
  cv as (
    select g.vida,
           count(*)::int as n_items,
           count(distinct g.moneda)::int as n_monedas,
           min(g.moneda) as moneda,
           sum(g.monto) as total
      from it g
     group by g.vida
  )
  select gs.vida::smallint,
         v_vida,
         nv.banda_marca,
         nv.banda_modelo,
         nv.profundidad_inicial_mm,
         nv.fecha,
         coalesce(cv.n_items, 0),
         coalesce(cv.n_monedas, 0),
         cv.moneda,
         cv.total,
         case when coalesce(kv.con, 0) = 0 and coalesce(kv.sin, 0) > 0 then null else coalesce(kv.km, 0) end,
         coalesce(kv.con, 0),
         coalesce(kv.sin, 0)
    from generate_series(v_base, v_vida) gs(vida)
    left join cv on cv.vida = gs.vida
    left join kv on kv.vida = gs.vida
    left join public.neumatico_vidas nv on nv.neumatico_id = p_neumatico and nv.vida = gs.vida
   order by gs.vida;
end
$$;
revoke all on function public.costo_vida_items(bigint) from public, anon;
grant execute on function public.costo_vida_items(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. v_costo_vida
-- -----------------------------------------------------------------------------
-- Una fila por cubierta visible y vida, solo para quien puede ver costos (precios_visibles). security_invoker: la RLS de
-- neumaticos y vehiculos es la de quien consulta. Un rol que omite la RLS (service_role, dueño, superusuario) ve todo.
--   vida              0 = banda original; 1..3 = recauchutados.
--   vida_actual       true en la vida en curso de la cubierta.
--   banda_*           marca y modelo de la banda y profundidad inicial (NULL en la vida 0 y en recauchutados hechos
--                     por «Cambiar neumático», que no registran banda).
--   moneda_mixta      costos de la vida en más de una moneda: costo_total y CPK NULL.
--   km_recorridos     km en vehículos durante esa vida (sin km_previos); km_confiable false si hay tramos sin dato.
--   cpk               costo_total / km_recorridos con km_confiable y km_recorridos > 0.
--   cpk_provisional   el mismo cociente con km no confiables (estimación; la interfaz la rotula).
create view public.v_costo_vida
with (security_invoker = true) as
select
  n.id                                                            as neumatico_id,
  n.cliente_id,
  n.vehiculo_id,
  coalesce(v.sucursal_id, n.sucursal_id)                          as sucursal_id,
  n.idneumatico,
  n.numero_quema,
  n.marca,
  n.modelo,
  coalesce(n.fecha_compra, n.created_at::date)                    as fecha_alta,
  x.vida,
  (x.vida = x.vida_actual)                                        as vida_actual,
  x.banda_marca,
  x.banda_modelo,
  x.profundidad_inicial_mm,
  x.fecha_inicio,
  (x.n_items > 0)                                                 as tiene_costo,
  case when x.n_monedas = 1 then x.moneda end                     as moneda,
  (x.n_monedas > 1)                                               as moneda_mixta,
  case when x.n_monedas = 1 then x.total end                      as costo_total,
  x.km_recorridos,
  (x.tramos_sin_dato = 0)                                         as km_confiable,
  case when x.n_monedas = 1 and x.tramos_sin_dato = 0 and x.km_recorridos > 0
       then x.total / x.km_recorridos end                         as cpk,
  case when x.n_monedas = 1 and x.tramos_sin_dato > 0 and x.km_recorridos > 0
       then x.total / x.km_recorridos end                         as cpk_provisional
from public.neumaticos n
left join public.vehiculos v on v.id = n.vehiculo_id
join lateral public.costo_vida_items(n.id) x on true
where (coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') or (select public.precios_visibles()));

comment on view public.v_costo_vida is
  'Costo y CPK por cubierta y vida (0 = banda original, 1..3 = recauchutados): km recorridos en esa vida; moneda mixta -> NULL (docs/08 apéndice L).';

revoke all on public.v_costo_vida from public, anon;
grant select on public.v_costo_vida to authenticated;

-- -----------------------------------------------------------------------------
-- 10. cpk_por_grupo: grupos 'vida' y 'banda'
-- -----------------------------------------------------------------------------
-- Mismas reglas que en 20261117000000 (ponderado, muestra baja, una fila por grupo y moneda, cohorte por fecha de
-- alta). Grupos nuevos, sobre v_costo_vida:
--   'vida'   0 = «Banda original», 1..3 = «Recauchutado nº N».
--   'banda'  la banda original, o marca y modelo de la banda recauchutada («Sin dato de banda» si no se registró).
-- Un neumático cuenta una vez por vida: el CPK de una vida es costo de esa vida / km recorridos en esa vida.
drop function if exists public.cpk_por_grupo(text, date, date);
drop function if exists public.cpk_por_grupo(text, date, date, bigint);
create or replace function public.cpk_por_grupo(
  p_grupo      text,
  p_desde      date default null,
  p_hasta      date default null,
  p_cliente_id bigint default null
)
returns table (
  grupo         text,
  clave         text,
  cliente_id    bigint,
  moneda        text,
  n_neumaticos  bigint,
  n_sin_km      bigint,
  km_recorridos numeric,
  costo_total   numeric,
  cpk           numeric,
  muestra_baja  boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_grupo is null or p_grupo not in ('marca', 'modelo', 'sucursal', 'vida', 'banda') then
    raise exception 'grupo inválido: marca, modelo, sucursal, vida o banda' using errcode = '22023';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'rango de fechas inválido' using errcode = '22023';
  end if;

  if p_grupo in ('vida', 'banda') then
    return query
    select
      p_grupo,
      min(s.etiqueta),
      null::bigint,
      s.moneda,
      count(*) filter (where s.ok),
      count(*) filter (where not s.ok),
      coalesce(sum(s.km) filter (where s.ok), 0),
      sum(s.costo) filter (where s.ok),
      case when coalesce(sum(s.km) filter (where s.ok), 0) > 0
           then sum(s.costo) filter (where s.ok) / sum(s.km) filter (where s.ok) end,
      count(*) filter (where s.ok) < 5
    from (
      select
        case p_grupo
          when 'vida' then x.vida::text
          when 'banda' then case when x.vida = 0 then '0'
                                 else lower(btrim(coalesce(x.banda_marca, ''))) || '|' || lower(btrim(coalesce(x.banda_modelo, ''))) end
        end                                                                       as gk,
        case p_grupo
          when 'vida' then case when x.vida = 0 then 'Banda original' else 'Recauchutado nº ' || x.vida end
          when 'banda' then case when x.vida = 0 then 'Banda original'
                                 else coalesce(nullif(btrim(coalesce(x.banda_marca, '') || ' ' || coalesce(x.banda_modelo, '')), ''),
                                               'Sin dato de banda') end
        end                                                                       as etiqueta,
        x.moneda,
        x.costo_total                                                             as costo,
        x.km_recorridos                                                           as km,
        (x.km_confiable and x.km_recorridos > 0)                                  as ok
      from public.v_costo_vida x
      where x.tiene_costo and x.costo_total is not null
        and (p_cliente_id is null or x.cliente_id = p_cliente_id)
        and (p_desde is null or x.fecha_alta >= p_desde)
        and (p_hasta is null or x.fecha_alta <= p_hasta)
    ) s
    group by s.gk, s.moneda
    order by 2, s.moneda;
    return;
  end if;

  return query
  select
    p_grupo,
    case p_grupo
      when 'sucursal' then coalesce(min(s.nombre_suc), 'Sin sucursal')
      when 'marca'    then coalesce(nullif(btrim(min(s.etiqueta)), ''), 'Sin marca')
      else coalesce(nullif(btrim(min(s.etiqueta)), ''), 'Sin modelo') end,
    case when p_grupo = 'sucursal' then s.cli end,
    s.moneda,
    count(*) filter (where s.ok),
    count(*) filter (where not s.ok),
    coalesce(sum(s.km) filter (where s.ok), 0),
    sum(s.costo) filter (where s.ok),
    case when coalesce(sum(s.km) filter (where s.ok), 0) > 0
         then sum(s.costo) filter (where s.ok) / sum(s.km) filter (where s.ok) end,
    count(*) filter (where s.ok) < 5
  from (
    select
      case p_grupo
        when 'marca'    then lower(btrim(coalesce(x.marca, '')))
        when 'modelo'   then lower(btrim(coalesce(x.marca, ''))) || '|' || lower(btrim(coalesce(x.modelo, '')))
        else coalesce(x.sucursal_id::text, '-') end                                as gk,
      case p_grupo
        when 'marca'  then x.marca
        when 'modelo' then btrim(coalesce(x.marca, '') || ' ' || coalesce(x.modelo, ''))
      end                                                                           as etiqueta,
      case when p_grupo = 'sucursal' then su.nombre end            as nombre_suc,
      case when p_grupo = 'sucursal' then x.cliente_id end                         as cli,
      x.moneda,
      x.costo_total                                                                 as costo,
      x.km_recorridos                                                               as km,
      (x.km_confiable and x.km_recorridos > 0)                                         as ok
    from public.v_costo_cubierta x
    left join public.sucursales su on p_grupo = 'sucursal' and su.id = x.sucursal_id
    where x.tiene_costo and x.costo_total is not null
      and (p_cliente_id is null or x.cliente_id = p_cliente_id)
      and (p_desde is null or x.fecha_alta >= p_desde)
      and (p_hasta is null or x.fecha_alta <= p_hasta)
  ) s
  group by s.gk, s.moneda, case when p_grupo = 'sucursal' then s.cli end
  order by 2, s.moneda;
end
$$;
revoke all on function public.cpk_por_grupo(text, date, date, bigint) from public, anon;
grant execute on function public.cpk_por_grupo(text, date, date, bigint) to authenticated;
