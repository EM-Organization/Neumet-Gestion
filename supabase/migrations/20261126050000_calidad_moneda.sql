-- =============================================================================
-- NEUMET · Ola 4 (F8): caída brusca de desgaste, corrección de mediciones y moneda por defecto por cliente
-- =============================================================================
-- Requiere 20261126040000_disco_alineacion.sql (alerta_configurar de 11 argumentos y catálogo motivos_movimiento con
-- rotacion_disco y alineacion) y 20261120500000_cerrar_escrituras_neumet.sql (privilegios por columna de clientes y
-- costo_registrar con la moneda 'UYU' por defecto). Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente: el CI la aplica dos veces.
--
-- Qué hace (apéndice AD de docs/08):
--  1. Columnas: clientes.caida_brusca_mm (umbral de la caída, 5 mm por defecto) y clientes.moneda_default (USD por
--     defecto). Los clientes existentes quedan con esos valores y ningún costo ya registrado cambia de moneda.
--     mediciones.corregida_at marca las correcciones a mano.
--  2. Caída brusca: una medición cuyo mínimo baja al menos caida_brusca_mm respecto de la última medición VÁLIDA de la
--     misma cubierta pasa a 'sospechosa', salvo que haya habido recauchutado, reparación o montaje entre ambas (en la rama
--     de vehículo, también desmontaje, rotación o baja de esa posición).
--  3. medicion_corregir: el operario corrige los tres valores de una medición (p. ej. error de calibre). La medición queda
--     'valida' con el motivo del catálogo correccion_medicion y se audita. No vuelve a evaluar la calidad.
--  4. cliente_fijar_moneda: el administrador de empresa fija la moneda por defecto. costo_registrar y recauchutado_aceptar
--     la usan cuando no llega p_moneda.
--  5. alerta_configurar de 12 argumentos: el último es p_caida_brusca_mm (nulo = no cambia).
--
-- Concurrencia (AD de docs/08): medicion_corregir toma la fila con medicion_autorizar (for update). Un doble envío o dos
-- personas corrigiendo a la vez se serializan; el segundo ve corregida_at y los mismos valores y no escribe. Si otro
-- invalida la medición mientras se corrige, las dos se serializan y corregir falla con 22023.
-- Un error a mitad (motivo o valor inválido) aborta la RPC entera: la medición queda como estaba.
--
-- Las mediciones existentes no se recalculan: una caída ya registrada no cambia al cambiar el umbral.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas, restricciones y privilegios
-- -----------------------------------------------------------------------------
alter table public.clientes
  add column if not exists caida_brusca_mm numeric(4,1) not null default 5,
  add column if not exists moneda_default  text not null default 'USD';

alter table public.clientes drop constraint if exists clientes_caida_brusca_ck;
alter table public.clientes add constraint clientes_caida_brusca_ck
  check (caida_brusca_mm > 0 and caida_brusca_mm <= 30);
alter table public.clientes drop constraint if exists clientes_moneda_default_ck;
alter table public.clientes add constraint clientes_moneda_default_ck
  check (moneda_default ~ '^[A-Z]{3}$');

comment on column public.clientes.caida_brusca_mm is 'Caída del mínimo de una cubierta (mm) respecto de su última medición válida que la marca sospechosa. Un recauchutado, reparación o montaje entre ambas la anula.';
comment on column public.clientes.moneda_default is 'Código ISO de 3 letras con el que se registran los costos que no traen moneda. Solo se cambia con cliente_fijar_moneda; los costos existentes no cambian.';

-- Los privilegios de columna de clientes van con lista fija (cerrar_escrituras_neumet): las columnas nuevas se suman
-- aquí. Sin update: se cambian solo por RPC.
grant select (caida_brusca_mm, moneda_default) on public.clientes to authenticated;

alter table public.mediciones add column if not exists corregida_at timestamptz;
comment on column public.mediciones.corregida_at is 'Cuándo se corrigieron a mano los valores de la medición (medicion_corregir). Nula si nunca se corrigió.';

-- Default de la columna para un insert directo sin moneda. Las RPC siempre mandan la moneda.
alter table public.costos_neumatico alter column moneda set default 'USD';

-- -----------------------------------------------------------------------------
-- 2. Catálogo de motivos de corrección de mediciones
-- -----------------------------------------------------------------------------
-- El check de tipo de motivos_movimiento se creó inline y no tiene nombre fijo: se localiza por su definición, se quita y se
-- vuelve a crear con el tipo nuevo. Así corre igual en PG16 (CI) y PG17 (producción) y en una segunda aplicación.
do $$
declare
  r record;
begin
  for r in select c.conname from pg_constraint c
            where c.conrelid = 'public.motivos_movimiento'::regclass and c.contype = 'c'
              and pg_get_constraintdef(c.oid) ~ '\mtipo\M' loop
    execute format('alter table public.motivos_movimiento drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.motivos_movimiento add constraint motivos_movimiento_tipo_ck check (tipo in
  ('rotacion', 'rotacion_disco', 'alineacion', 'cambio', 'desmontaje', 'baja', 'correccion_medicion'));

insert into public.motivos_movimiento (cliente_id, tipo, codigo, etiqueta, orden) values
  (null, 'correccion_medicion', 'error_calibre', 'Error del calibre', 1),
  (null, 'correccion_medicion', 'huella_mal_tomada', 'Huella mal tomada', 2),
  (null, 'correccion_medicion', 'carga_manual', 'Error al cargar el valor', 3),
  (null, 'correccion_medicion', 'otro', 'Otro', 9)
on conflict (tipo, codigo) where cliente_id is null do update set etiqueta = excluded.etiqueta, orden = excluded.orden;

-- -----------------------------------------------------------------------------
-- 3. Evaluación pura de una medición, con la regla de caída brusca
-- -----------------------------------------------------------------------------
-- La firma de 11 argumentos no se cambia con create or replace: se quita y se crea con los dos nuevos al final.
drop function if exists public.medicion_evaluar_calidad(numeric, numeric, numeric, numeric, boolean, boolean, integer, integer, numeric, numeric, numeric);
create or replace function public.medicion_evaluar_calidad(
  p_mm1 numeric, p_mm2 numeric, p_mm3 numeric,
  p_prev_promedio    numeric default null,
  p_evento_entre     boolean default false,
  p_duplicada        boolean default false,
  p_odometro_km      integer default null,
  p_prev_odometro_km integer default null,
  p_huella_max_mm    numeric default 10,
  p_aumento_max_mm   numeric default 1.0,
  p_mm_max           numeric default 30,
  p_prev_minimo      numeric default null,
  p_caida_brusca_mm  numeric default 5
)
returns table (estado text, motivo text)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_m     text[] := '{}';
  v_dif   numeric;
  v_prom  numeric;
  v_caida numeric;
begin
  if p_mm1 is null or p_mm2 is null or p_mm3 is null
     or p_mm1 = 'NaN'::numeric or p_mm2 = 'NaN'::numeric or p_mm3 = 'NaN'::numeric then
    -- Dato no medido o no numérico: nunca se trata como cero; no se evalúan el resto de reglas de valores.
    v_m := v_m || 'Medición incompleta o con valores no numéricos'::text;
  else
    if least(p_mm1, p_mm2, p_mm3) < 0 or greatest(p_mm1, p_mm2, p_mm3) > p_mm_max then
      v_m := v_m || format('Valor fuera del rango físico (0 a %s mm)', replace(trim_scale(p_mm_max)::text, '.', ','));
    end if;
    v_dif := greatest(p_mm1, p_mm2, p_mm3) - least(p_mm1, p_mm2, p_mm3);
    if v_dif > p_huella_max_mm then
      v_m := v_m || format('Diferencia entre huellas de %s mm (máx. %s mm)',
                           replace(trim_scale(v_dif)::text, '.', ','), replace(trim_scale(p_huella_max_mm)::text, '.', ','));
    end if;
    v_prom := round((p_mm1 + p_mm2 + p_mm3) / 3.0, 2);
    if p_prev_promedio is not null and not coalesce(p_evento_entre, false)
       and v_prom - p_prev_promedio > p_aumento_max_mm then
      v_m := v_m || 'Aumento sin recauchutado'::text;
    end if;
    -- Caída brusca del mínimo respecto de la última medición válida. El redondeo a 1 decimal evita que 4,96 pase como 5
    -- y deja el texto con la coma del resto de los mensajes. Un evento entre ambas (p_evento_entre) la anula.
    if p_prev_minimo is not null and not coalesce(p_evento_entre, false) then
      v_caida := round(p_prev_minimo - least(p_mm1, p_mm2, p_mm3), 1);
      if v_caida >= p_caida_brusca_mm then
        v_m := v_m || format('Caída brusca de %s mm desde la medición anterior', replace(v_caida::text, '.', ','));
      end if;
    end if;
  end if;
  if coalesce(p_duplicada, false) then
    v_m := v_m || 'Lectura duplicada'::text;
  end if;
  if p_odometro_km is not null and p_prev_odometro_km is not null and p_odometro_km < p_prev_odometro_km then
    v_m := v_m || 'Odómetro menor al de la medición anterior'::text;
  end if;
  if cardinality(v_m) = 0 then
    return query select 'valida'::text, null::text;
  else
    return query select 'sospechosa'::text, array_to_string(v_m, '; ');
  end if;
end
$$;
revoke all on function public.medicion_evaluar_calidad(numeric, numeric, numeric, numeric, boolean, boolean, integer, integer, numeric, numeric, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.medicion_evaluar_calidad(numeric, numeric, numeric, numeric, boolean, boolean, integer, integer, numeric, numeric, numeric, numeric, numeric)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Trigger AFTER INSERT: como 20261116000000_calidad_datos.sql, más la referencia de la caída
-- -----------------------------------------------------------------------------
-- La caída compara con la última medición VÁLIDA de la cubierta, no con la previa de la regla de aumento: una sospechosa
-- no sirve de referencia, si no una caída sostenida pasaría a valer en la segunda medición. Si hubo evento entre esa
-- referencia y esta, p_prev_minimo va nulo y la caída no se evalúa. Las mediciones existentes no se recalculan.
create or replace function public.mediciones_registrar_calidad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_prom    numeric;
  v_prev_at      timestamptz;
  v_neum         bigint;
  v_evento       boolean := false;
  v_dup          boolean := false;
  v_prev_odo     integer;
  v_huella       numeric;
  v_caida        numeric;
  v_valida_min   numeric;
  v_valida_at    timestamptz;
  v_evento_valida boolean := false;
  v_estado       text;
  v_motivo       text;
begin
  begin
    select c.huella_absurda_mm, c.caida_brusca_mm into v_huella, v_caida
      from public.clientes c where c.id = new.cliente_id;

    -- Medición previa del mismo neumático (y lectura duplicada). Rama de cubierta.
    if new.idneumatico is not null then
      select m.promedio, m.created_at into v_prev_prom, v_prev_at
        from public.mediciones m
       where m.idneumatico = new.idneumatico and m.id <> new.id and m.calidad <> 'invalidada'
         and m.created_at <= new.created_at and (m.created_at < new.created_at or m.id < new.id)
       order by m.created_at desc, m.id desc limit 1;
      select exists (
        select 1 from public.mediciones m
         where m.idneumatico = new.idneumatico and m.id <> new.id
           and m.mm1 = new.mm1 and m.mm2 = new.mm2 and m.mm3 = new.mm3
           and m.created_at between new.created_at - interval '2 minutes' and new.created_at
           and (m.created_at < new.created_at or m.id < new.id)) into v_dup;
      select n.id into v_neum from public.neumaticos n where n.idneumatico = new.idneumatico;
      if v_prev_at is not null then
        select exists (
          select 1 from public.eventos_neumatico e
           where e.neumatico_id = v_neum and e.tipo in ('reencauche', 'reparacion', 'montaje')
             and e.created_at > v_prev_at and e.created_at <= new.created_at) into v_evento;
      end if;

      -- Referencia de la caída: última medición válida de la cubierta.
      select least(m.mm1, m.mm2, m.mm3), m.created_at into v_valida_min, v_valida_at
        from public.mediciones m
       where m.idneumatico = new.idneumatico and m.id <> new.id and m.calidad = 'valida'
         and m.created_at <= new.created_at and (m.created_at < new.created_at or m.id < new.id)
       order by m.created_at desc, m.id desc limit 1;
      if v_valida_at is not null then
        select exists (
          select 1 from public.eventos_neumatico e
           where e.neumatico_id = v_neum and e.tipo in ('reencauche', 'reparacion', 'montaje')
             and e.created_at > v_valida_at and e.created_at <= new.created_at) into v_evento_valida;
      end if;
    -- Rama de vehículo: medición por posición sin cubierta identificada.
    elsif new.vehiculo_id is not null then
      select m.promedio, m.created_at into v_prev_prom, v_prev_at
        from public.mediciones m
       where m.vehiculo_id = new.vehiculo_id and m.posicion = new.posicion and m.idneumatico is null
         and m.id <> new.id and m.calidad <> 'invalidada'
         and m.created_at <= new.created_at and (m.created_at < new.created_at or m.id < new.id)
       order by m.created_at desc, m.id desc limit 1;
      select exists (
        select 1 from public.mediciones m
         where m.vehiculo_id = new.vehiculo_id and m.posicion = new.posicion and m.idneumatico is null
           and m.id <> new.id and m.mm1 = new.mm1 and m.mm2 = new.mm2 and m.mm3 = new.mm3
           and m.created_at between new.created_at - interval '2 minutes' and new.created_at
           and (m.created_at < new.created_at or m.id < new.id)) into v_dup;
      if v_prev_at is not null then
        select exists (
          select 1 from public.eventos_neumatico e
           where e.vehiculo_id = new.vehiculo_id
             and e.tipo in ('reencauche', 'reparacion', 'montaje', 'desmontaje', 'rotacion', 'baja')
             and (e.posicion_origen = new.posicion or e.posicion_destino = new.posicion)
             and e.created_at > v_prev_at and e.created_at <= new.created_at) into v_evento;
      end if;

      select least(m.mm1, m.mm2, m.mm3), m.created_at into v_valida_min, v_valida_at
        from public.mediciones m
       where m.vehiculo_id = new.vehiculo_id and m.posicion = new.posicion and m.idneumatico is null
         and m.id <> new.id and m.calidad = 'valida'
         and m.created_at <= new.created_at and (m.created_at < new.created_at or m.id < new.id)
       order by m.created_at desc, m.id desc limit 1;
      if v_valida_at is not null then
        select exists (
          select 1 from public.eventos_neumatico e
           where e.vehiculo_id = new.vehiculo_id
             and e.tipo in ('reencauche', 'reparacion', 'montaje', 'desmontaje', 'rotacion', 'baja')
             and (e.posicion_origen = new.posicion or e.posicion_destino = new.posicion)
             and e.created_at > v_valida_at and e.created_at <= new.created_at) into v_evento_valida;
      end if;
    end if;

    -- Odómetro: la última lectura del vehículo anterior a esta medición.
    if new.odometro_km is not null and new.vehiculo_id is not null then
      select m.odometro_km into v_prev_odo
        from public.mediciones m
       where m.vehiculo_id = new.vehiculo_id and m.odometro_km is not null and m.id <> new.id
         and m.calidad <> 'invalidada'
         and m.created_at <= new.created_at and (m.created_at < new.created_at or m.id < new.id)
       order by m.created_at desc, m.id desc limit 1;
    end if;

    select e.estado, e.motivo into v_estado, v_motivo
      from public.medicion_evaluar_calidad(
             new.mm1, new.mm2, new.mm3, v_prev_prom, v_evento, v_dup,
             new.odometro_km, v_prev_odo, coalesce(v_huella, 10),
             p_prev_minimo     => case when v_evento_valida then null else v_valida_min end,
             p_caida_brusca_mm => coalesce(v_caida, 5)) e;

    if v_estado is not null and v_estado <> 'valida' then
      update public.mediciones
         set calidad = v_estado, calidad_motivo = v_motivo, calidad_at = now(), calidad_por = 'sistema'
       where id = new.id;
      insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
      values (null, 'sistema', 'CALIDAD_DETECTADA', 'mediciones', new.id::text,
              jsonb_build_object('calidad', 'valida'),
              jsonb_build_object('calidad', v_estado, 'motivo', v_motivo, 'cliente_id', new.cliente_id));
    end if;
  exception when others then
    -- Un fallo del control de calidad no debe impedir guardar la medición.
    raise warning 'mediciones_registrar_calidad: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end
$$;
revoke all on function public.mediciones_registrar_calidad() from public, anon, authenticated;

drop trigger if exists trg_mediciones_calidad on public.mediciones;
create trigger trg_mediciones_calidad after insert on public.mediciones
  for each row execute function public.mediciones_registrar_calidad();

-- -----------------------------------------------------------------------------
-- 5. medicion_corregir: corregir los tres valores de una medición
-- -----------------------------------------------------------------------------
-- Autorización: medicion_autorizar (cliente, y sucursal si la tiene). Lo corregido queda válido y es la referencia de la
-- siguiente caída. corregida_at marca la medición; audit_log guarda el antes y el después.
create or replace function public.medicion_corregir(
  p_medicion_id   bigint,
  p_mm1           numeric,
  p_mm2           numeric,
  p_mm3           numeric,
  p_motivo_codigo text,
  p_motivo_texto  text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m     public.mediciones%rowtype;
  v_txt   text;
  v_prom  numeric;
  v       numeric;
  v_rol   text;
  v_suc   bigint;
begin
  v_m := public.medicion_autorizar(p_medicion_id);
  -- Solo llegan perfiles cliente (lo garantiza medicion_autorizar). El rol sale de la sucursal: las RPC recortadas (t_96)
  -- no pueden citar el perfil administrador global ni en el cuerpo ni en comentarios.
  select p.sucursal_id into v_suc from public.perfiles p where p.user_id = auth.uid();
  v_rol := case when v_suc is null then 'admin_empresa' else 'sucursal' end;
  if p_mm1 is null or p_mm2 is null or p_mm3 is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  foreach v in array array[p_mm1, p_mm2, p_mm3] loop
    -- NaN compara como mayor que cualquier número: cae en el mismo control de rango.
    if v < 0 or v > 30 then
      raise exception 'los valores van de 0 a 30 mm' using errcode = '23514';
    end if;
    if v <> round(v, 1) then
      raise exception 'los valores admiten un decimal' using errcode = '22023';
    end if;
  end loop;
  if v_m.calidad = 'invalidada' then
    raise exception 'revalidar la medición antes de corregirla' using errcode = '22023';
  end if;
  v_txt := public.motivo_movimiento_validar(v_m.cliente_id, 'correccion_medicion', p_motivo_codigo, p_motivo_texto);

  -- Doble envío o reintento tras una respuesta perdida: los valores ya están guardados, no se escribe otra vez.
  if v_m.corregida_at is not null and v_m.mm1 = p_mm1 and v_m.mm2 = p_mm2 and v_m.mm3 = p_mm3 then
    return jsonb_build_object('id', v_m.id, 'mm1', v_m.mm1, 'mm2', v_m.mm2, 'mm3', v_m.mm3,
                              'promedio', v_m.promedio, 'cambiado', false);
  end if;

  update public.mediciones
     set mm1 = p_mm1, mm2 = p_mm2, mm3 = p_mm3,
         calidad = 'valida', calidad_motivo = 'Corregida: ' || v_txt,
         calidad_at = now(), calidad_por = auth.uid()::text, corregida_at = now()
   where id = v_m.id
  returning promedio into v_prom;

  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), v_rol, 'CORREGIR_MEDICION', 'mediciones', v_m.id::text,
          jsonb_build_object('mm1', v_m.mm1, 'mm2', v_m.mm2, 'mm3', v_m.mm3, 'promedio', v_m.promedio,
                             'calidad', v_m.calidad, 'calidad_motivo', v_m.calidad_motivo),
          jsonb_build_object('mm1', p_mm1, 'mm2', p_mm2, 'mm3', p_mm3, 'promedio', v_prom,
                             'calidad', 'valida', 'calidad_motivo', 'Corregida: ' || v_txt,
                             'motivo', v_txt, 'cliente_id', v_m.cliente_id));

  return jsonb_build_object('id', v_m.id, 'mm1', p_mm1, 'mm2', p_mm2, 'mm3', p_mm3,
                            'promedio', v_prom, 'cambiado', true);
end
$$;
revoke all on function public.medicion_corregir(bigint, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.medicion_corregir(bigint, numeric, numeric, numeric, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. cliente_fijar_moneda: moneda por defecto del cliente (solo el administrador de empresa)
-- -----------------------------------------------------------------------------
-- Misma autorización que alerta_configurar: admin_empresa_cliente_id(). No cambia los costos ya registrados.
create or replace function public.cliente_fijar_moneda(p_cliente_id bigint, p_moneda text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_cli_id bigint;
  v_c      public.clientes%rowtype;
  v        text := upper(btrim(p_moneda));
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli_id := public.admin_empresa_cliente_id();
  if v_cli_id is null or (p_cliente_id is not null and p_cliente_id <> v_cli_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_c from public.clientes c where c.id = v_cli_id and c.deleted_at is null for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v is null or v !~ '^[A-Z]{3}$' then
    raise exception 'moneda inválida: código de 3 letras' using errcode = '23514';
  end if;
  if v_c.moneda_default = v then
    return jsonb_build_object('cliente_id', v_c.id, 'moneda', v, 'cambiado', false);
  end if;
  update public.clientes c set moneda_default = v where c.id = v_c.id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (v_uid, 'admin_empresa', 'FIJAR_MONEDA', 'clientes', v_c.id::text,
          jsonb_build_object('moneda_default', v_c.moneda_default),
          jsonb_build_object('moneda_default', v, 'cliente_id', v_c.id));
  return jsonb_build_object('cliente_id', v_c.id, 'moneda', v, 'cambiado', true);
end
$$;
revoke all on function public.cliente_fijar_moneda(bigint, text) from public, anon;
grant execute on function public.cliente_fijar_moneda(bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. alerta_configurar con p_caida_brusca_mm (12 argumentos; el último, nulo = no cambia)
-- -----------------------------------------------------------------------------
-- Copia de 20261126040000_disco_alineacion.sql; solo cambia la caída brusca.
drop function if exists public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer);
create or replace function public.alerta_configurar(p_cliente_id bigint, p_umbral_critico_mm numeric DEFAULT NULL::numeric, p_histeresis_mm numeric DEFAULT NULL::numeric, p_umbral_bajo_mm numeric DEFAULT NULL::numeric, p_umbral_retiro_mm numeric DEFAULT NULL::numeric, p_dias_sin_medir integer DEFAULT NULL::integer, p_irregularidad_mm numeric DEFAULT NULL::numeric, p_huella_absurda_mm numeric DEFAULT NULL::numeric, p_direccion_aviso_mm numeric DEFAULT NULL::numeric, p_direccion_limite_mm numeric DEFAULT NULL::numeric, p_swap_km integer DEFAULT NULL::integer, p_caida_brusca_mm numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_uid      uuid := auth.uid();
  v_cli_id   bigint;
  v_c        public.clientes%rowtype;
  v_bajo     numeric;
  v_critico  numeric;
  v_retiro   numeric;
  v_abiertas bigint;
  v_da       numeric;
  v_dl       numeric;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli_id := public.admin_empresa_cliente_id();
  if v_cli_id is null or (p_cliente_id is not null and p_cliente_id <> v_cli_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select * into v_c from public.clientes c where c.id = v_cli_id and c.deleted_at is null for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  if p_umbral_critico_mm is null and p_histeresis_mm is null and p_umbral_bajo_mm is null and p_umbral_retiro_mm is null
     and p_dias_sin_medir is null and p_irregularidad_mm is null and p_huella_absurda_mm is null
     and p_direccion_aviso_mm is null and p_direccion_limite_mm is null and p_swap_km is null
     and p_caida_brusca_mm is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;

  -- Milímetros: un decimal, mayor que 0 y hasta 99,9 (igual que el panel, assets/js/domain/umbrales.js)
  if p_umbral_critico_mm is not null and (p_umbral_critico_mm <> round(p_umbral_critico_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_umbral_bajo_mm is not null and (p_umbral_bajo_mm <> round(p_umbral_bajo_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_umbral_retiro_mm is not null and (p_umbral_retiro_mm <> round(p_umbral_retiro_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_irregularidad_mm is not null and (p_irregularidad_mm <> round(p_irregularidad_mm, 1)) then
    raise exception 'la irregularidad admite un decimal' using errcode = '22023';
  end if;
  if p_huella_absurda_mm is not null and (p_huella_absurda_mm <> round(p_huella_absurda_mm, 1)) then
    raise exception 'la huella admite un decimal' using errcode = '22023';
  end if;
  if p_caida_brusca_mm is not null and (p_caida_brusca_mm <> round(p_caida_brusca_mm, 1)) then
    raise exception 'la caída brusca admite un decimal' using errcode = '22023';
  end if;
  if (p_umbral_bajo_mm is not null and (p_umbral_bajo_mm <= 0 or p_umbral_bajo_mm > 99.9))
     or (p_umbral_retiro_mm is not null and (p_umbral_retiro_mm <= 0 or p_umbral_retiro_mm > 99.9))
     or (p_umbral_critico_mm is not null and (p_umbral_critico_mm <= 0 or p_umbral_critico_mm > 99.9)) then
    raise exception 'los umbrales van de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_irregularidad_mm is not null and (p_irregularidad_mm <= 0 or p_irregularidad_mm > 99.9) then
    raise exception 'la irregularidad va de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_huella_absurda_mm is not null and (p_huella_absurda_mm <= 0 or p_huella_absurda_mm > 40) then
    raise exception 'la huella absurda va de 0,1 a 40 mm' using errcode = '23514';
  end if;
  if p_caida_brusca_mm is not null and (p_caida_brusca_mm <= 0 or p_caida_brusca_mm > 30) then
    raise exception 'la caída brusca va de 0,1 a 30 mm' using errcode = '23514';
  end if;
  if p_dias_sin_medir is not null and (p_dias_sin_medir < 1 or p_dias_sin_medir > 3650) then
    raise exception 'los días sin medir van de 1 a 3650' using errcode = '23514';
  end if;
  if p_histeresis_mm is not null then
    if p_histeresis_mm <> round(p_histeresis_mm, 1) or p_histeresis_mm < 0 or p_histeresis_mm > 3 then
      raise exception 'la histéresis va de 0 a 3 mm, con un decimal' using errcode = '23514';
    end if;
  end if;

  -- Dirección (D8) y swap (D1). El check de clientes es la última barrera; estos mensajes son los que ve el operario.
  if p_direccion_aviso_mm is not null and p_direccion_aviso_mm <> round(p_direccion_aviso_mm, 1)
     or p_direccion_limite_mm is not null and p_direccion_limite_mm <> round(p_direccion_limite_mm, 1) then
    raise exception 'los umbrales de dirección admiten un decimal' using errcode = '22023';
  end if;
  if (p_direccion_aviso_mm is not null and (p_direccion_aviso_mm <= 0 or p_direccion_aviso_mm > 99.9))
     or (p_direccion_limite_mm is not null and (p_direccion_limite_mm <= 0 or p_direccion_limite_mm > 99.9)) then
    raise exception 'los umbrales de dirección van de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_swap_km is not null and (p_swap_km < 1000 or p_swap_km > 200000) then
    raise exception 'el swap va de 1.000 a 200.000 km' using errcode = '23514';
  end if;
  v_bajo    := coalesce(p_umbral_bajo_mm,    v_c.umbral_bajo_mm);
  v_critico := coalesce(p_umbral_critico_mm, v_c.umbral_critico_mm);
  v_retiro  := coalesce(p_umbral_retiro_mm,  v_c.umbral_retiro_mm);
  if not (v_retiro < v_critico and v_critico < v_bajo) then
    raise exception 'el nivel crítico debe quedar entre el de retiro (% mm) y el de desgaste bajo (% mm)', v_retiro, v_bajo
      using errcode = '23514';
  end if;

  -- El límite de dirección debe quedar bajo el aviso (D8). No se cruza con el retiro.
  v_da := coalesce(p_direccion_aviso_mm, v_c.direccion_aviso_mm);
  v_dl := coalesce(p_direccion_limite_mm, v_c.direccion_limite_mm);
  if not (v_dl < v_da) then
    raise exception 'el límite de dirección (% mm) debe quedar bajo el aviso (% mm)', v_dl, v_da using errcode = '23514';
  end if;

  update public.clientes c
     set umbral_bajo_mm        = v_bajo,
         umbral_critico_mm     = v_critico,
         umbral_retiro_mm      = v_retiro,
         dias_sin_medir_alerta = coalesce(p_dias_sin_medir, c.dias_sin_medir_alerta),
         irregularidad_mm      = coalesce(p_irregularidad_mm, c.irregularidad_mm),
         alerta_histeresis_mm  = coalesce(p_histeresis_mm, c.alerta_histeresis_mm),
         huella_absurda_mm     = coalesce(p_huella_absurda_mm, c.huella_absurda_mm),
         direccion_aviso_mm    = v_da,
         direccion_limite_mm   = v_dl,
         swap_km               = coalesce(p_swap_km, c.swap_km),
         caida_brusca_mm       = coalesce(p_caida_brusca_mm, c.caida_brusca_mm)
   where c.id = v_c.id;

  select count(*) into v_abiertas from public.alertas a where a.cliente_id = v_c.id and a.estado <> 'resuelta';
  select * into v_c from public.clientes c where c.id = v_c.id;
  return jsonb_build_object('cliente_id', v_c.id, 'umbral_critico_mm', v_c.umbral_critico_mm,
                            'histeresis_mm', v_c.alerta_histeresis_mm, 'umbral_bajo_mm', v_c.umbral_bajo_mm,
                            'umbral_retiro_mm', v_c.umbral_retiro_mm, 'dias_sin_medir_alerta', v_c.dias_sin_medir_alerta,
                            'irregularidad_mm', v_c.irregularidad_mm, 'huella_absurda_mm', v_c.huella_absurda_mm,
                            'direccion_aviso_mm', v_c.direccion_aviso_mm, 'direccion_limite_mm', v_c.direccion_limite_mm,
                            'swap_km', v_c.swap_km, 'caida_brusca_mm', v_c.caida_brusca_mm,
                            'alertas_abiertas', v_abiertas);
end
$$;

revoke all on function public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) from public, anon;
grant execute on function public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Moneda por defecto: costo_registrar y recauchutado_aceptar sin p_moneda usan la del cliente
-- -----------------------------------------------------------------------------
-- El default de p_moneda pasa de 'UYU' a null. La moneda se lee del cliente después de la autorización (y de cargar la
-- cubierta). Se quita y se crea de nuevo porque cambia el default del argumento. Los costos ya registrados no cambian.
drop function if exists public.costo_registrar(bigint, text, numeric, date, text, text);
create function public.costo_registrar(p_neumatico_id bigint, p_concepto text, p_monto numeric, p_fecha date DEFAULT NULL::date, p_notas text DEFAULT NULL::text, p_moneda text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n        public.neumaticos%rowtype;
  v_aut      record;
  v_concepto text := lower(btrim(coalesce(p_concepto, '')));
  v_moneda   text;
  v_fecha    date := coalesce(p_fecha, current_date);
  v_notas    text := nullif(btrim(coalesce(p_notas, '')), '');
  v_monto    numeric;
  v_vida     smallint;
  v_id       bigint;
begin
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);
  v_moneda := upper(btrim(coalesce(p_moneda,
                (select c.moneda_default from public.clientes c where c.id = v_n.cliente_id), 'USD')));

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

drop function if exists public.recauchutado_aceptar(bigint, numeric, text, text, numeric, text, date, bigint, text);
create function public.recauchutado_aceptar(
  p_id            bigint,
  p_profundidad_mm numeric,
  p_banda_marca   text default null,
  p_banda_modelo  text default null,
  p_costo         numeric default null,
  p_moneda        text default null,
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
  v_moneda  text;
  v_costo   numeric;
  v_notas   text := nullif(btrim(coalesce(p_notas, '')), '');
  v_vida    smallint;
begin
  v_r := public.recauchutado_autorizar(p_id);
  select * into v_n from public.neumaticos n where n.id = v_r.neumatico_id;
  v_moneda := upper(btrim(coalesce(p_moneda,
                (select c.moneda_default from public.clientes c where c.id = v_n.cliente_id), 'USD')));
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
