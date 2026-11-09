-- =============================================================================
-- NEUMET · Calidad de datos de las mediciones (F3): control al ingresar, invalidación auditada, valor original y unidad
-- =============================================================================
-- Requiere 20261109000000 (v_mediciones_neumatico, índices), 20261110020000 (ultimas_mediciones), 20261111000000
-- (v_estado_neumaticos) y 20261113000000 (v_mediciones_neumatico vigente); usa is_admin() y perfiles (20261106000000, 20261107020000).
-- Independiente de 20261115000000 (km por cubierta): no toca sus objetos.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (add column if not exists, drop/add constraint, create or replace, drop trigger if exists, revoke/grant).
-- Solo añade columnas con valor por defecto constante (sin reescribir la tabla) y no cambia datos existentes: toda
-- medición previa queda 'valida'. No borra ni modifica nunca mm1/mm2/mm3.
--
-- MODELO (decisión de diseño)
--   Columnas en public.mediciones, no una tabla aparte: las vistas y consultas ya leen cada medición; con una tabla
--   de calidad cada sonda por índice (última medición, ventana de 90 días, regresión) necesitaría un anti-join extra.
--   Con la columna el filtro «m.calidad <> 'invalidada'» se evalúa sobre la fila que ya se leyó. El historial de
--   cambios (quién, cuándo, motivo, estado anterior) vive en audit_log, que es inmutable.
--     calidad         'valida' | 'sospechosa' | 'invalidada' (defecto 'valida')
--     calidad_motivo  texto: el hallazgo del sistema o el motivo del usuario
--     calidad_at      cuándo se fijó el estado actual
--     calidad_por     'sistema' o el uuid del usuario que lo fijó
--     unidad_origen   'mm' (defecto) | '32avos': unidad en que informó el origen
--     valor_original  jsonb opcional con el valor crudo, p. ej. {"mm1": 12, "mm2": 11, "mm3": 12} en la unidad de origen.
--                     mm1..mm3 siempre quedan normalizados a mm (1/32" = 0,79375 mm; ver convertir_32avos_a_mm).
--   Semántica: 'sospechosa' sigue contando en tasas, estados y alertas hasta que una persona decide; 'invalidada'
--   NO cuenta (se excluye en v_mediciones_neumatico, v_estado_neumaticos, v_ultima_medicion, v_alertas,
--   ultimas_mediciones y api_obtener_montaje) pero la fila se conserva y se muestra atenuada en el historial.
--   El sistema nunca invalida por sí solo: solo marca 'sospechosa'.
--
-- DETECCIÓN
--   medicion_evaluar_calidad(...) es una función PURA (sin tablas) y probable por sí sola. El trigger AFTER INSERT
--   mediciones_registrar_calidad reúne el contexto (medición previa del mismo neumático, eventos, duplicado, odómetro
--   del vehículo) y registra el hallazgo. NUNCA rechaza la inserción: cualquier error interno se convierte en un
--   aviso y la medición queda 'valida'. La API de proveedor y el contrato de DAC no cambian.
--   Reglas (todas -> 'sospechosa'):
--     1. Medición incompleta o con valores no numéricos (dato no medido = NULL, nunca 0). La tabla exige las tres
--        huellas (NOT NULL) y la API ya rechaza lecturas parciales; la regla protege la función y futuras cargas.
--     2. Rango físico: alguna huella fuera de 0..30 mm (la restricción de la tabla admite hasta 40).
--     3. Diferencia entre huellas mayor a clientes.huella_absurda_mm (defecto 10 mm).
--     4. Aumento de más de 1,0 mm del promedio respecto a la medición previa válida del mismo neumático sin un evento
--        de recauchutado, reparación o montaje entre ambas: «Aumento sin recauchutado».
--     5. Lectura duplicada: mismo neumático, mismos tres valores, a ±2 minutos de otra (se marca la posterior).
--     6. Odómetro menor al de la medición anterior del mismo vehículo (solo si la medición trae odómetro).
--   «Mismo neumático» = mismo idneumatico; sin idneumatico, misma posición del mismo vehículo entre mediciones sin él.
--
-- ACCIÓN MANUAL
--   medicion_invalidar(p_medicion_id, p_motivo) y medicion_revalidar(p_medicion_id): SECURITY DEFINER,
--   search_path = '', autorización dentro (nunca por parámetros):
--     admin -> cualquier medición; perfil 'cliente' GLOBAL -> mediciones de su cliente; perfil de SUCURSAL -> solo las de
--     vehículos de su sucursal; rol 'api', sin perfil, anon u otro cliente -> 42501 uniforme (no revela existencia).
--   El motivo de invalidar es obligatorio (3 a 300 caracteres). Ambas dejan registro en audit_log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas, restricciones e índices
-- -----------------------------------------------------------------------------
alter table public.mediciones
  add column if not exists calidad        text not null default 'valida',
  add column if not exists calidad_motivo text,
  add column if not exists calidad_at     timestamptz,
  add column if not exists calidad_por    text,
  add column if not exists unidad_origen  text not null default 'mm',
  add column if not exists valor_original jsonb;

alter table public.mediciones drop constraint if exists mediciones_calidad_ck;
alter table public.mediciones add constraint mediciones_calidad_ck
  check (calidad in ('valida', 'sospechosa', 'invalidada'));
alter table public.mediciones drop constraint if exists mediciones_calidad_motivo_ck;
alter table public.mediciones add constraint mediciones_calidad_motivo_ck
  check (calidad = 'valida' or length(btrim(coalesce(calidad_motivo, ''))) > 0);
alter table public.mediciones drop constraint if exists mediciones_unidad_origen_ck;
alter table public.mediciones add constraint mediciones_unidad_origen_ck
  check (unidad_origen in ('mm', '32avos'));

comment on column public.mediciones.calidad is 'valida | sospechosa | invalidada. Solo las invalidadas se excluyen de tasas, estados y alertas.';
comment on column public.mediciones.calidad_motivo is 'Hallazgo del sistema o motivo del usuario que invalidó.';
comment on column public.mediciones.calidad_por is '''sistema'' o uuid del usuario que fijó el estado actual.';
comment on column public.mediciones.unidad_origen is 'Unidad en que informó el origen: mm o 32avos (1/32 de pulgada). mm1..mm3 siempre en mm.';
comment on column public.mediciones.valor_original is 'Valor crudo del origen (jsonb, en unidad_origen), p. ej. {"mm1":12,"mm2":11,"mm3":12}.';

-- Umbral configurable por cliente de la diferencia entre huellas que se considera absurda.
alter table public.clientes add column if not exists huella_absurda_mm numeric(4,1) not null default 10;
alter table public.clientes drop constraint if exists clientes_huella_absurda_ck;
alter table public.clientes add constraint clientes_huella_absurda_ck check (huella_absurda_mm > 0 and huella_absurda_mm <= 40);
comment on column public.clientes.huella_absurda_mm is 'Diferencia entre huellas (mm) a partir de la cual una medición se marca sospechosa (control de calidad).';

-- Parciales: solo contienen las mediciones con observaciones (pocas); sirven a la lista de revisión y al detalle del vehículo.
create index if not exists mediciones_calidad_cliente_idx
  on public.mediciones (cliente_id, created_at desc) where calidad <> 'valida';
create index if not exists mediciones_calidad_vehiculo_idx
  on public.mediciones (vehiculo_id, created_at desc) where calidad <> 'valida' and vehiculo_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Conversión de unidades (1/32 de pulgada = 0,79375 mm)
-- -----------------------------------------------------------------------------
-- Valor exacto (sin redondear): el redondeo a 2 decimales lo aplica la columna numeric(5,2). Espejo de
-- convertir32avos en supabase/functions/api-proveedor/mapping.ts; ambos tienen pruebas con los mismos casos.
create or replace function public.convertir_32avos_a_mm(p_32avos numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$ select p_32avos * 0.79375 $$;
revoke all on function public.convertir_32avos_a_mm(numeric) from public, anon;
grant execute on function public.convertir_32avos_a_mm(numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Evaluación pura de una medición
-- -----------------------------------------------------------------------------
-- Devuelve una fila: ('valida', NULL) o ('sospechosa', 'motivo 1; motivo 2'). El contexto lo aporta quien llama:
--   p_prev_promedio   promedio de la medición previa válida del mismo neumático (NULL: no hay)
--   p_evento_entre    hubo recauchutado, reparación o montaje entre la medición previa y esta
--   p_duplicada       existe otra lectura igual del mismo neumático a ±2 minutos
--   p_prev_odometro_km última lectura de odómetro del vehículo anterior a esta medición
create or replace function public.medicion_evaluar_calidad(
  p_mm1 numeric, p_mm2 numeric, p_mm3 numeric,
  p_prev_promedio    numeric default null,
  p_evento_entre     boolean default false,
  p_duplicada        boolean default false,
  p_odometro_km      integer default null,
  p_prev_odometro_km integer default null,
  p_huella_max_mm    numeric default 10,
  p_aumento_max_mm   numeric default 1.0,
  p_mm_max           numeric default 30
)
returns table (estado text, motivo text)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_m    text[] := '{}';
  v_dif  numeric;
  v_prom numeric;
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
revoke all on function public.medicion_evaluar_calidad(numeric, numeric, numeric, numeric, boolean, boolean, integer, integer, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.medicion_evaluar_calidad(numeric, numeric, numeric, numeric, boolean, boolean, integer, integer, numeric, numeric, numeric)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Trigger AFTER INSERT: registra el hallazgo; jamás rechaza la inserción
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: la API inserta como service_role y la función escribe en mediciones y audit_log (inmutable).
-- Las sondas van por índices: mediciones_idneumatico_idx, mediciones_veh_pos_fecha_idx, mediciones_vehiculo_fecha_idx y
-- eventos_neumatico_neum_idx / eventos_neumatico_vehiculo_idx. El odómetro solo se consulta si la medición lo trae.
create or replace function public.mediciones_registrar_calidad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_prom numeric;
  v_prev_at  timestamptz;
  v_neum     bigint;
  v_evento   boolean := false;
  v_dup      boolean := false;
  v_prev_odo integer;
  v_huella   numeric;
  v_estado   text;
  v_motivo   text;
begin
  begin
    select c.huella_absurda_mm into v_huella from public.clientes c where c.id = new.cliente_id;

    -- Medición previa válida del mismo neumático y lectura duplicada.
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
      if v_prev_at is not null then
        select n.id into v_neum from public.neumaticos n where n.idneumatico = new.idneumatico;
        select exists (
          select 1 from public.eventos_neumatico e
           where e.neumatico_id = v_neum and e.tipo in ('reencauche', 'reparacion', 'montaje')
             and e.created_at > v_prev_at and e.created_at <= new.created_at) into v_evento;
      end if;
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
    end if;

    -- Odómetro decreciente respecto al vehículo (solo si esta medición trae odómetro).
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
             new.odometro_km, v_prev_odo, coalesce(v_huella, 10)) e;

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
-- 5. Invalidar y revalidar con autorización y registro
-- -----------------------------------------------------------------------------
-- Devuelve la medición bloqueada si quien llama puede actuar sobre ella. Mismo error (42501) para rol api, sin
-- perfil, otro cliente, otra sucursal o medición inexistente (un no-admin no puede saber si existe).
create or replace function public.medicion_autorizar(p_medicion_id bigint)
returns public.mediciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_m    public.mediciones%rowtype;
  v_perf public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_medicion_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if public.is_admin() then
    select * into v_m from public.mediciones m where m.id = p_medicion_id for update;
    if not found then
      raise exception 'medición inexistente' using errcode = 'P0002';
    end if;
    return v_m;
  end if;
  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  if not found or v_perf.cliente_id is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_m from public.mediciones m
   where m.id = p_medicion_id and m.cliente_id = v_perf.cliente_id
     and exists (select 1 from public.clientes c where c.id = m.cliente_id and c.deleted_at is null)
     and (v_perf.sucursal_id is null
          or exists (select 1 from public.vehiculos v
                      where v.id = m.vehiculo_id and v.cliente_id = m.cliente_id and v.sucursal_id = v_perf.sucursal_id))
   for update of m;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return v_m;
end
$$;
revoke all on function public.medicion_autorizar(bigint) from public, anon, authenticated;

create or replace function public.medicion_invalidar(p_medicion_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m      public.mediciones%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_rol    text;
begin
  v_m := public.medicion_autorizar(p_medicion_id);
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'el motivo es obligatorio' using errcode = '22023';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'motivo demasiado largo (máx. 300)' using errcode = '22023';
  end if;
  if v_m.calidad = 'invalidada' then
    return jsonb_build_object('id', v_m.id, 'calidad', 'invalidada', 'cambiado', false);
  end if;
  v_rol := case when public.is_admin() then 'admin' else 'cliente' end;
  update public.mediciones
     set calidad = 'invalidada', calidad_motivo = v_motivo, calidad_at = now(), calidad_por = auth.uid()::text
   where id = v_m.id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), v_rol, 'INVALIDAR_MEDICION', 'mediciones', v_m.id::text,
          jsonb_build_object('calidad', v_m.calidad, 'motivo', v_m.calidad_motivo, 'por', v_m.calidad_por),
          jsonb_build_object('calidad', 'invalidada', 'motivo', v_motivo, 'cliente_id', v_m.cliente_id));
  return jsonb_build_object('id', v_m.id, 'calidad', 'invalidada', 'cambiado', true);
end
$$;
revoke all on function public.medicion_invalidar(bigint, text) from public, anon;
grant execute on function public.medicion_invalidar(bigint, text) to authenticated;

create or replace function public.medicion_revalidar(p_medicion_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m   public.mediciones%rowtype;
  v_rol text;
begin
  v_m := public.medicion_autorizar(p_medicion_id);
  if v_m.calidad = 'valida' then
    return jsonb_build_object('id', v_m.id, 'calidad', 'valida', 'cambiado', false);
  end if;
  v_rol := case when public.is_admin() then 'admin' else 'cliente' end;
  update public.mediciones
     set calidad = 'valida', calidad_motivo = null, calidad_at = now(), calidad_por = auth.uid()::text
   where id = v_m.id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), v_rol, 'REVALIDAR_MEDICION', 'mediciones', v_m.id::text,
          jsonb_build_object('calidad', v_m.calidad, 'motivo', v_m.calidad_motivo, 'por', v_m.calidad_por),
          jsonb_build_object('calidad', 'valida', 'cliente_id', v_m.cliente_id));
  return jsonb_build_object('id', v_m.id, 'calidad', 'valida', 'cambiado', true);
end
$$;
revoke all on function public.medicion_revalidar(bigint) from public, anon;
grant execute on function public.medicion_revalidar(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Las mediciones invalidadas no cuentan: cambio mínimo en las consultas que leen mediciones
-- -----------------------------------------------------------------------------
-- Solo se añade «calidad <> 'invalidada'» a las sondas existentes. Mismas columnas, tipos, security_invoker y
-- permisos; sin CTE recursivas nuevas ni joins adicionales (el costo medido está en el PR y en docs/15).
-- v_ultima_medicion y v_alertas leen estas vistas y no cambian; api_obtener_montaje lee v_mediciones_neumatico.
-- Una medición etiquetada invalidada sigue impidiendo la atribución por posición (regla 2 de 20261109000000): un neumático
-- identificado cuyas mediciones están todas invalidadas figura «sin datos», no con mm de otro neumático.

-- 6.1 v_mediciones_neumatico
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
where m.calidad <> 'invalidada'
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
  and m.calidad <> 'invalidada'
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
where m.calidad <> 'invalidada'
  and not exists (select 1 from public.neumaticos np
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

-- 6.2 v_estado_neumaticos
create or replace view public.v_estado_neumaticos
with (security_invoker = true) as
with s as (
  -- ---- Neumáticos montados (reglas 1 y 2) ----------------------------------------------------------------------
  select
    v.cliente_id, n.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, n.posicion,
    n.id as neumatico_id,
    coalesce(t.idneumatico, p.idneumatico, n.idneumatico) as idneumatico,
    n.marca, n.modelo, n.vida,
    n.estado as estado_montaje,
    coalesce(t.mm1, p.mm1) as mm1, coalesce(t.mm2, p.mm2) as mm2, coalesce(t.mm3, p.mm3) as mm3,
    coalesce(t.promedio, p.promedio) as promedio, coalesce(t.odometro_km, p.odometro_km) as odometro_km,
    coalesce(t.created_at, p.created_at) as ultima_at,
    case when t.id is not null then t.n90   else p.n90   end as n90,
    case when t.id is not null then t.n_v   else p.n_v   end as n_v,
    case when t.id is not null then t.t0    else p.t0    end as t0,
    case when t.id is not null then t.t1    else p.t1    end as t1,
    case when t.id is not null then t.slope else p.slope end as slope,
    c.umbral_bajo_mm, c.umbral_critico_mm, c.umbral_retiro_mm, c.dias_sin_medir_alerta, c.irregularidad_mm
  from public.neumaticos n
  join public.vehiculos v on v.id = n.vehiculo_id and v.activo
  join public.clientes  c on c.id = v.cliente_id and c.deleted_at is null
  -- Último evento que reinicia la ventana de la tasa (reencauche, reparación o montaje de ESTE neumático).
  left join lateral (
    select max(e.created_at) as reinicio
      from public.eventos_neumatico e
     where e.neumatico_id = n.id and e.tipo in ('reencauche', 'reparacion', 'montaje')
  ) r on true
  -- Regla 1: mediciones etiquetadas con el idneumatico del neumático (esté donde esté).
  left join lateral (
    select l.*, a.*
      from (select m.id, m.idneumatico, m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.created_at
              from public.mediciones m
             where n.idneumatico is not null and m.idneumatico = n.idneumatico and m.calidad <> 'invalidada'
             order by m.created_at desc, m.id desc limit 1) l
     cross join lateral (
       select count(*) as n90,
              count(*) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as n_v,
              min(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t0,
              max(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t1,
              regr_slope(m.promedio::float8, extract(epoch from m.created_at))
                filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as slope
         from public.mediciones m
        where m.idneumatico = n.idneumatico and m.calidad <> 'invalidada' and m.created_at >= now() - interval '90 days'
     ) a
  ) t on true
  -- Regla 2 (solo si el neumático no tiene mediciones etiquetadas): corte = último evento de
  -- montaje/desmontaje/rotación/baja que tocó la posición (origen o destino).
  left join lateral (
    select max(e.created_at) as cut
      from public.eventos_neumatico e
     where t.id is null and e.vehiculo_id = n.vehiculo_id
       and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
       and (e.posicion_origen = n.posicion or e.posicion_destino = n.posicion)
  ) z on true
  left join lateral (
    select l.*, a.*
      from (select m.id, m.idneumatico, m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.created_at
              from public.mediciones m
             where t.id is null and m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion
               and m.idneumatico is null and m.calidad <> 'invalidada'
               and (n.idneumatico is null or not exists (select 1 from public.mediciones x where x.idneumatico = n.idneumatico)) and (z.cut is null or m.created_at >= z.cut)
             order by m.created_at desc, m.id desc limit 1) l
     cross join lateral (
       select count(*) as n90,
              count(*) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as n_v,
              min(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t0,
              max(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t1,
              regr_slope(m.promedio::float8, extract(epoch from m.created_at))
                filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as slope
         from public.mediciones m
        where m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion and m.idneumatico is null and m.calidad <> 'invalidada'
          and (n.idneumatico is null or not exists (select 1 from public.mediciones x where x.idneumatico = n.idneumatico))
          and (z.cut is null or m.created_at >= z.cut) and m.created_at >= now() - interval '90 days'
     ) a
  ) p on true
  where n.estado = 'montado'
  union all
  -- ---- Regla 3: posiciones medidas sin fila en neumaticos -------------------------------------------------------
  select
    v.cliente_id, v.id, v.nombre, v.patente, q.posicion,
    null::bigint, l.idneumatico,
    null::text, null::text, null::smallint,
    'montado'::text,
    l.mm1, l.mm2, l.mm3, l.promedio, l.odometro_km, l.created_at,
    a.n90, a.n_v, a.t0, a.t1, a.slope,
    c.umbral_bajo_mm, c.umbral_critico_mm, c.umbral_retiro_mm, c.dias_sin_medir_alerta, c.irregularidad_mm
  from public.vehiculos v
  join public.clientes c on c.id = v.cliente_id and c.deleted_at is null
  -- Posiciones medidas del vehículo sin fila en neumaticos (función con ROWS bajo: ver arriba).
  cross join lateral public.posiciones_medidas_sin_neumatico(v.id) as q(posicion)
  cross join lateral (
    select max(e.created_at) as cut
      from public.eventos_neumatico e
     where e.vehiculo_id = v.id and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
       and (e.posicion_origen = q.posicion or e.posicion_destino = q.posicion)
  ) z
  cross join lateral (
    select m.id, m.idneumatico, m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.created_at
      from public.mediciones m
     where m.vehiculo_id = v.id and m.posicion = q.posicion
       and m.calidad <> 'invalidada'
       and (m.idneumatico is null
            or not exists (select 1 from public.neumaticos nt where nt.idneumatico = m.idneumatico))
       and (z.cut is null or m.created_at >= z.cut)
     order by m.created_at desc, m.id desc limit 1
  ) l
  cross join lateral (
    select count(*) as n90, count(*) as n_v, min(m.created_at) as t0, max(m.created_at) as t1,
           regr_slope(m.promedio::float8, extract(epoch from m.created_at)) as slope
      from public.mediciones m
     where m.vehiculo_id = v.id and m.posicion = q.posicion
       and m.calidad <> 'invalidada'
       and (m.idneumatico is null
            or not exists (select 1 from public.neumaticos nt where nt.idneumatico = m.idneumatico))
       and (z.cut is null or m.created_at >= z.cut) and m.created_at >= now() - interval '90 days'
  ) a
  where v.activo
),
b as (
  select
    s.cliente_id, s.vehiculo_id, s.vehiculo_nombre, s.patente, s.posicion,
    s.neumatico_id, s.idneumatico, s.marca, s.modelo, s.vida, s.estado_montaje,
    s.mm1, s.mm2, s.mm3, s.promedio, s.odometro_km,
    s.ultima_at as ultima_medicion_at,
    case when s.ultima_at is null then null
         else floor(extract(epoch from now() - s.ultima_at) / 86400)::integer end as dias_desde_medicion,
    case when s.promedio is null                 then 'sin_datos'
         when s.promedio < s.umbral_critico_mm   then 'critico'
         when s.promedio < s.umbral_bajo_mm      then 'bajo'
         else 'ok' end as estado,
    case when s.ultima_at is null then s.neumatico_id is not null
         else s.ultima_at < now() - make_interval(days => s.dias_sin_medir_alerta) end as sin_medir,
    case when s.promedio is null then null
         else greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3) end as diferencia_huellas_mm,
    coalesce(greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3) > s.irregularidad_mm, false)
      as desgaste_irregular,
    coalesce(s.n90, 0) as n_mediciones_90d,
    -- Tasa: al menos 3 mediciones y 14 días reales entre la primera y la última de la ventana
    -- (reiniciada en reencauche/reparación/montaje); pendiente negativa = sin tasa.
    case when s.n_v >= 3
          and extract(epoch from s.t1 - s.t0) >= 14 * 86400
          and s.slope < 0
         then round((-s.slope * 604800)::numeric, 3) end as tasa_mm_semana,
    s.umbral_bajo_mm, s.umbral_critico_mm, s.umbral_retiro_mm, s.dias_sin_medir_alerta
  from s
)
select b.*,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_critico_mm, 0) / b.tasa_mm_semana, 2) end as semanas_hasta_critico,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end  as semanas_hasta_retiro
from b;

revoke all on public.v_estado_neumaticos from public, anon;
grant select on public.v_estado_neumaticos to authenticated;

-- 6.3 ultimas_mediciones (Inicio)
create or replace function public.ultimas_mediciones(p_limite integer default 8, p_sucursal bigint default null)
returns table (
  vehiculo_id  bigint,
  nombre       text,
  patente      text,
  numero       text,
  medido_at    timestamptz,   -- última medición de la visita
  posicion     smallint,
  idneumatico  text,
  mm_ahora     numeric,
  mm_antes     numeric,       -- NULL: sin medición previa de ese neumático
  antes_at     timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with veh as (
    select v.id, v.nombre, v.patente, v.numero, ult.created_at as ultima,
           (date_trunc('day', ult.created_at at time zone 'America/Montevideo') at time zone 'America/Montevideo') as desde
      from public.vehiculos v
      cross join lateral (
        select m.created_at from public.mediciones m
         where m.vehiculo_id = v.id and m.calidad <> 'invalidada' order by m.created_at desc limit 1
      ) ult
     where v.activo and (p_sucursal is null or v.sucursal_id = p_sucursal)
     order by ult.created_at desc, v.id
     limit least(greatest(coalesce(p_limite, 8), 1), 50)
  )
  select veh.id, veh.nombre, veh.patente, veh.numero, veh.ultima,
         a.posicion, a.idneumatico, a.promedio, pr.promedio, pr.created_at
    from veh
    cross join lateral (
      select distinct on (m.posicion) m.posicion, m.idneumatico, m.promedio
        from public.mediciones m
       where m.vehiculo_id = veh.id and m.calidad <> 'invalidada' and m.created_at >= veh.desde
       order by m.posicion, m.created_at desc
    ) a
    left join lateral (
      select p.promedio, p.created_at from public.mediciones p
       where a.idneumatico is not null and p.idneumatico = a.idneumatico and p.calidad <> 'invalidada' and p.created_at < veh.desde
       order by p.created_at desc limit 1
    ) pr on true
   order by veh.ultima desc, veh.id, a.posicion;
$$;

revoke all on function public.ultimas_mediciones(integer, bigint) from public, anon;
grant execute on function public.ultimas_mediciones(integer, bigint) to authenticated;
