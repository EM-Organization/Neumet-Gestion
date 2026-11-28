-- =============================================================================
-- NEUMET · Ola 5 (F8): compra por lote, vida sin tope y semanas con la huella mínima
-- =============================================================================
-- Requiere 20261113000000 (stock_cubierta_agregar, base del lote), 20261120500000 (sucursal_autorizar_gestion,
-- stock_cubierta_editar y recauchutado_enviar vigentes), 20261126020000 (neumatico_montar y neumatico_cambiar
-- vigentes), 20261126040000 (v_estado_neumaticos y v_alertas vigentes) y 20261126050000 (recauchutado_aceptar vigente).
-- Decisiones de producto (dueño, 2026-11-28):
--   * La vida es un contador de renovaciones sin tope: no hay máximo de negocio ni por marca. Cada cliente
--     decide cuántas veces renueva, así que se quitan los bloqueos en 3 y los checks de rango 0..3.
--   * Las semanas hasta el crítico y el retiro salen de la huella mínima: una cubierta se retira por su punto
--     más gastado, y con el promedio la proyección quedaba optimista.
--   * Compra por lote: varias cubiertas con la misma factura, todo o nada.
-- Las columnas de compra no son montos: las ve todo perfil que ve la fila. El precio sigue cerrado por columna.
-- Idempotente: add column if not exists, checks con drop/add, create or replace y un catálogo con where.

-- 1. Columnas de compra. Los checks van con nombre para poder reemplazarlos en una migración posterior.
alter table public.neumaticos
  add column if not exists dot                    text,
  add column if not exists medida                 text,
  add column if not exists profundidad_inicial_mm numeric(4,1),
  add column if not exists proveedor              text,
  add column if not exists factura                text,
  add column if not exists soporte                text;

alter table public.neumaticos drop constraint if exists neumaticos_dot_ck;
alter table public.neumaticos add constraint neumaticos_dot_ck
  check (dot is null or dot ~ '^(0[1-9]|[1-4][0-9]|5[0-3])[0-9]{2}$');
alter table public.neumaticos drop constraint if exists neumaticos_medida_ck;
alter table public.neumaticos add constraint neumaticos_medida_ck
  check (medida is null or length(medida) between 1 and 30);
alter table public.neumaticos drop constraint if exists neumaticos_profundidad_inicial_ck;
alter table public.neumaticos add constraint neumaticos_profundidad_inicial_ck
  check (profundidad_inicial_mm is null or (profundidad_inicial_mm > 0 and profundidad_inicial_mm <= 30));
alter table public.neumaticos drop constraint if exists neumaticos_proveedor_ck;
alter table public.neumaticos add constraint neumaticos_proveedor_ck
  check (proveedor is null or length(proveedor) between 1 and 80);
alter table public.neumaticos drop constraint if exists neumaticos_factura_ck;
alter table public.neumaticos add constraint neumaticos_factura_ck
  check (factura is null or length(factura) between 1 and 60);
alter table public.neumaticos drop constraint if exists neumaticos_soporte_ck;
alter table public.neumaticos add constraint neumaticos_soporte_ck
  check (soporte is null or length(soporte) between 1 and 200);

-- Solo lectura por columna: la escritura va por RPC (stock_cubierta_editar y el lote).
grant select (dot, medida, profundidad_inicial_mm, proveedor, factura, soporte) on public.neumaticos to authenticated;

-- 2. Validación de los datos de compra. Una sola fuente para el lote y la edición; solo la llaman funciones definer.
-- Recibe un objeto con las claves que traiga; las ausentes o nulas no se validan. Los textos en blanco no pasan.
create or replace function public.stock_compra_validar(p_datos jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dot    text := nullif(btrim(p_datos ->> 'dot'), '');
  v_medida text := nullif(btrim(p_datos ->> 'medida'), '');
  v_prov   text := nullif(btrim(p_datos ->> 'proveedor'), '');
  v_fact   text := nullif(btrim(p_datos ->> 'factura'), '');
  v_sop    text := nullif(btrim(p_datos ->> 'soporte'), '');
  v_mm     text := nullif(btrim(p_datos ->> 'profundidad_inicial_mm'), '');
begin
  -- El DOT es semana y año (ww yy). Se compara como aaaaww para que el año no empate con la semana.
  if v_dot is not null then
    if v_dot !~ '^(0[1-9]|[1-4][0-9]|5[0-3])[0-9]{2}$' then
      raise exception 'DOT inválido: deben ser 4 dígitos, semana y año (por ejemplo 0825)' using errcode = '22023';
    end if;
    if ('20' || substr(v_dot, 3, 2))::int * 100 + substr(v_dot, 1, 2)::int
       > extract(isoyear from current_date)::int * 100 + extract(week from current_date)::int then
      raise exception 'El DOT no puede ser posterior a la semana actual' using errcode = '22023';
    end if;
  end if;
  if v_medida is not null and length(v_medida) > 30 then
    raise exception 'la medida no puede superar 30 caracteres' using errcode = '22023';
  end if;
  if v_prov is not null and length(v_prov) > 80 then
    raise exception 'el proveedor no puede superar 80 caracteres' using errcode = '22023';
  end if;
  if v_fact is not null and length(v_fact) > 60 then
    raise exception 'la factura no puede superar 60 caracteres' using errcode = '22023';
  end if;
  if v_sop is not null and length(v_sop) > 200 then
    raise exception 'el soporte no puede superar 200 caracteres' using errcode = '22023';
  end if;
  -- Se revisa el formato antes de convertir: el orden de los or no está garantizado en plpgsql.
  if v_mm is not null then
    if v_mm !~ '^[0-9]{1,3}([.][0-9]+)?$' then
      raise exception 'Los mm iniciales deben estar entre 0,1 y 30' using errcode = '22023';
    end if;
    if v_mm::numeric not between 0.1 and 30 then
      raise exception 'Los mm iniciales deben estar entre 0,1 y 30' using errcode = '22023';
    end if;
  end if;
end
$$;
revoke execute on function public.stock_compra_validar(jsonb) from public, anon, authenticated;

-- 3. Alta de un lote: varias cubiertas con la misma factura y datos comunes. Todo o nada: cualquier error deshace el lote.
-- Autoriza antes de mirar el contenido: quien no puede gestionar no recibe mensajes de validación.
create or replace function public.stock_cubiertas_agregar_lote(p_comun jsonb, p_cubiertas jsonb, p_cliente_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut    record;
  v_clave  text;
  v_marca  text;
  v_modelo text;
  v_medida text;
  v_precio numeric;
  v_fecha  date;
  v_mm     numeric(4,1);
  v_prov   text;
  v_fact   text;
  v_sop    text;
  v_sucid  bigint;
  v_n      integer;
  v_i      integer;
  v_e      jsonb;
  v_q      text;
  v_dup    text;
  v_idn    text;
  v_id     bigint;
  v_ids    bigint[] := '{}';
begin
  select * into v_aut from public.sucursal_autorizar_gestion(p_cliente_id);

  if p_comun is null or jsonb_typeof(p_comun) <> 'object' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  for v_clave in select jsonb_object_keys(p_comun) loop
    if v_clave not in ('marca', 'modelo', 'medida', 'profundidad_inicial_mm', 'fecha_compra', 'precio',
                       'proveedor', 'factura', 'soporte', 'sucursal_id') then
      raise exception 'Dato desconocido: %', v_clave using errcode = '22023';
    end if;
  end loop;

  v_marca  := nullif(btrim(coalesce(p_comun ->> 'marca', '')), '');
  v_modelo := nullif(btrim(coalesce(p_comun ->> 'modelo', '')), '');
  v_medida := nullif(btrim(coalesce(p_comun ->> 'medida', '')), '');
  v_prov   := nullif(btrim(coalesce(p_comun ->> 'proveedor', '')), '');
  v_fact   := nullif(btrim(coalesce(p_comun ->> 'factura', '')), '');
  v_sop    := nullif(btrim(coalesce(p_comun ->> 'soporte', '')), '');
  if v_marca is null then
    raise exception 'indicar la marca' using errcode = '22023';
  end if;
  if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 then
    raise exception 'marca o modelo demasiado largos (máx. 60)' using errcode = '22023';
  end if;
  -- Los mm iniciales son obligatorios en la compra: la vida útil del desgaste se mide desde ahí.
  if nullif(btrim(p_comun ->> 'profundidad_inicial_mm'), '') is null then
    raise exception 'Los mm iniciales deben estar entre 0,1 y 30' using errcode = '22023';
  end if;
  perform public.stock_compra_validar(p_comun);
  v_mm := round((p_comun ->> 'profundidad_inicial_mm')::numeric, 1);

  v_fecha := nullif(btrim(coalesce(p_comun ->> 'fecha_compra', '')), '')::date;
  if v_fecha > current_date + 1 then
    raise exception 'la fecha de compra no puede ser futura' using errcode = '23514';
  end if;
  v_precio := nullif(btrim(coalesce(p_comun ->> 'precio', '')), '')::numeric;
  if v_precio is not null and (v_precio < 0 or v_precio >= 10000000000) then
    raise exception 'precio fuera de rango' using errcode = '23514';
  end if;
  v_precio := round(v_precio, 2);

  v_sucid := nullif(btrim(coalesce(p_comun ->> 'sucursal_id', '')), '')::bigint;
  perform public.stock_cubierta_sucursal(v_aut.cliente_id, v_sucid);

  if p_cubiertas is null or jsonb_typeof(p_cubiertas) <> 'array' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_cubiertas);
  if v_n < 1 or v_n > 200 then
    raise exception 'El lote debe tener entre 1 y 200 cubiertas' using errcode = '22023';
  end if;
  for v_i in 0 .. v_n - 1 loop
    v_e := p_cubiertas -> v_i;
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'datos inválidos' using errcode = '22023';
    end if;
    v_q := nullif(btrim(coalesce(v_e ->> 'numero_quema', '')), '');
    if v_q is null then
      raise exception 'indicar el número de quema' using errcode = '22023';
    end if;
    if length(v_q) > 40 then
      raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
    end if;
    perform public.stock_compra_validar(v_e);
  end loop;

  -- Sin distinguir mayúsculas, como el índice único. El mensaje muestra la primera aparición.
  select (array_agg(s.q order by s.o))[1] into v_dup
    from (select btrim(t.e ->> 'numero_quema') as q, lower(btrim(t.e ->> 'numero_quema')) as lq, t.o
            from jsonb_array_elements(p_cubiertas) with ordinality as t(e, o)) s
   group by s.lq
  having count(*) > 1
   limit 1;
  if v_dup is not null then
    raise exception 'Quema repetida en el lote: %', v_dup using errcode = '23505';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_e := p_cubiertas -> v_i;
    v_q := btrim(v_e ->> 'numero_quema');
    loop
      v_idn := 'CB-' || v_aut.cliente_id || '-' || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
      exit when not exists (select 1 from public.neumaticos n where n.idneumatico = v_idn);
    end loop;

    -- La quema ya existe en el cliente: el índice único lo corta y el lote entero se deshace.
    begin
      insert into public.neumaticos
        (vehiculo_id, cliente_id, posicion, marca, modelo, medida, fecha_compra, precio_unidad, idneumatico,
         estado, condicion, sucursal_id, numero_quema, vida, km_previos, auxilio,
         dot, profundidad_inicial_mm, proveedor, factura, soporte)
      values
        (null, v_aut.cliente_id, null, v_marca, v_modelo, v_medida, v_fecha, v_precio, v_idn,
         'almacenado', 'nuevo', v_sucid, v_q, 0, 0, false,
         nullif(btrim(v_e ->> 'dot'), ''), v_mm, v_prov, v_fact, v_sop)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Ya existe una cubierta con la quema %', v_q using errcode = '23505';
    end;

    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_destino_id, notas, created_by)
    values (v_aut.cliente_id, null, v_id, v_idn, 'alta_stock', v_sucid,
            'Alta en stock por lote · quema ' || v_q
              || case when v_fact is not null then ' · factura ' || v_fact else '' end,
            auth.uid());
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('cantidad', v_n, 'ids', to_jsonb(v_ids));
end
$$;
revoke all on function public.stock_cubiertas_agregar_lote(jsonb, jsonb, bigint) from public, anon;
grant execute on function public.stock_cubiertas_agregar_lote(jsonb, jsonb, bigint) to authenticated;


-- 4. stock_cubierta_editar: copia vigente (20261120500000, L485-582) con los seis datos de compra.
-- Misma firma y mismos permisos; el alta de compra no cambia lo que ya registra el resto de la función.
create or replace function public.stock_cubierta_editar(p_id bigint, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n      public.neumaticos%rowtype;
  v_marca  text;
  v_modelo text;
  v_fecha  date;
  v_precio numeric(12,2);
  v_cond   text;
  v_k      text;
  v_txt    text;
  v_compra jsonb;
  v_dot    text;
  v_medida text;
  v_mm     numeric(4,1);
  v_prov   text;
  v_fact   text;
  v_sop    text;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('marca', 'modelo', 'fecha_compra', 'precio', 'condicion',
                   'dot', 'medida', 'profundidad_inicial_mm', 'proveedor', 'factura', 'soporte') then
      raise exception 'campo no editable: %', v_k using errcode = '22023';
    end if;
  end loop;

  v_marca := v_n.marca; v_modelo := v_n.modelo; v_fecha := v_n.fecha_compra;
  v_precio := v_n.precio_unidad; v_cond := v_n.condicion;
  v_dot := v_n.dot; v_medida := v_n.medida; v_mm := v_n.profundidad_inicial_mm;
  v_prov := v_n.proveedor; v_fact := v_n.factura; v_sop := v_n.soporte;

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

  -- Datos de compra: los que no vienen en p_datos no se tocan; null o texto vacío borran el dato.
  -- El helper valida las claves presentes antes de asignarlas.
  v_compra := (select coalesce(jsonb_object_agg(k.clave, p_datos -> k.clave), '{}'::jsonb)
                 from unnest(array['dot', 'medida', 'profundidad_inicial_mm', 'proveedor', 'factura', 'soporte'])
                      as k(clave)
                where p_datos ? k.clave);
  perform public.stock_compra_validar(v_compra);
  if p_datos ? 'dot' then v_dot := nullif(btrim(p_datos ->> 'dot'), ''); end if;
  if p_datos ? 'medida' then v_medida := nullif(btrim(p_datos ->> 'medida'), ''); end if;
  if p_datos ? 'profundidad_inicial_mm' then
    v_mm := round(nullif(btrim(p_datos ->> 'profundidad_inicial_mm'), '')::numeric, 1);
  end if;
  if p_datos ? 'proveedor' then v_prov := nullif(btrim(p_datos ->> 'proveedor'), ''); end if;
  if p_datos ? 'factura' then v_fact := nullif(btrim(p_datos ->> 'factura'), ''); end if;
  if p_datos ? 'soporte' then v_sop := nullif(btrim(p_datos ->> 'soporte'), ''); end if;

  update public.neumaticos
     set marca = v_marca, modelo = v_modelo, fecha_compra = v_fecha, precio_unidad = v_precio, condicion = v_cond,
         dot = v_dot, medida = v_medida, profundidad_inicial_mm = v_mm, proveedor = v_prov,
         factura = v_fact, soporte = v_sop
   where id = p_id;

  if v_cond is distinct from v_n.condicion then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, notas, created_by)
    values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'cambio_condicion',
            'Condición: ' || v_n.condicion || ' → ' || v_cond, auth.uid());
  end if;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), 'cliente',
          'STOCK_CUBIERTA_EDITAR', 'neumaticos', p_id::text,
          jsonb_build_object('marca', v_n.marca, 'modelo', v_n.modelo, 'fecha_compra', v_n.fecha_compra,
                             'precio_unidad', v_n.precio_unidad, 'condicion', v_n.condicion),
          jsonb_build_object('marca', v_marca, 'modelo', v_modelo, 'fecha_compra', v_fecha,
                             'precio_unidad', v_precio, 'condicion', v_cond, 'cliente_id', v_n.cliente_id));
  return jsonb_build_object('id', p_id, 'cliente_id', v_n.cliente_id, 'condicion', v_cond);
end
$$;


-- 5. Vida sin tope. Se quitan los checks de rango 0..3 de las cuatro tablas que guardan vida (todos los que
-- mencionen la columna, con nombre automático o no). recauchutados_vida_nueva_ck no es de vida: es la regla
-- de estado recibido, y se deja.
do $$
declare
  v_c record;
begin
  for v_c in
    select n.nspname, t.relname, c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname in ('neumaticos', 'costos_neumatico', 'recauchutados', 'neumatico_vidas')
       and c.contype = 'c'
       and c.conname <> 'recauchutados_vida_nueva_ck'
       and pg_get_constraintdef(c.oid) ~ '\mvida'
  loop
    execute format('alter table %I.%I drop constraint %I', v_c.nspname, v_c.relname, v_c.conname);
  end loop;
end
$$;

alter table public.neumaticos add constraint neumaticos_vida_ck check (vida >= 0);
alter table public.costos_neumatico add constraint costos_neumatico_vida_ck check (vida >= 0);
alter table public.recauchutados add constraint recauchutados_vida_origen_ck check (vida_origen >= 0);
alter table public.recauchutados add constraint recauchutados_vida_nueva_rango_ck
  check (vida_nueva is null or vida_nueva >= 1);
alter table public.neumatico_vidas add constraint neumatico_vidas_vida_ck check (vida >= 1);


-- 5b. recauchutado_enviar: copia vigente (20261120500000, L418-483) sin el tope de vida 3.
create or replace function public.recauchutado_enviar(p_neumatico_id bigint, p_proveedor text, p_fecha date DEFAULT NULL::date, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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


-- 5c. recauchutado_aceptar: copia vigente (20261126050000, L628-725) sin el tope de vida 3.
create or replace function public.recauchutado_aceptar(
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


-- 5d. neumatico_montar: copia vigente (20261126020000, L236-464); la vida inicial no tiene tope superior.
create or replace function public.neumatico_montar(
  p_vehiculo_id  bigint,
  p_posicion     smallint,
  p_cubierta_id  bigint  default null,
  p_nuevo        jsonb   default null,
  p_odometro_km  integer default null,
  p_notas        text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut     record;
  v_veh     public.vehiculos%rowtype;
  v_cub     public.neumaticos%rowtype;
  v_notas   text := nullif(btrim(coalesce(p_notas, '')), '');
  v_max     smallint;
  v_marca   text;
  v_modelo  text;
  v_codigo  text;
  v_quema   text;
  v_km_prev integer := 0;
  v_fecha_c date;
  v_precio  numeric(12,2);
  v_vida    smallint := 0;
  v_idn     text;
  v_id      bigint;
  v_cond    text;
  v_suc_org text;
  v_ev      bigint;
  v_odo_veh integer;
  v_aux     boolean := (p_posicion = 99);
  v_txt     text;
  v_k       text;
begin
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);
  -- Odómetro obligatorio por cliente (RN-12): la base decide, no solo el handler de la API.
  perform public.odometro_obligatorio_validar(v_aut.cliente_id, p_odometro_km);

  if p_posicion is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_posicion not between 1 and 99 then
    raise exception 'posición fuera de rango (1-99)' using errcode = '23514';
  end if;
  if (p_cubierta_id is not null)::int + (p_nuevo is not null)::int <> 1 then
    raise exception 'indicar el neumático a montar: cubierta del stock o ingresado (uno solo)' using errcode = '22023';
  end if;
  if v_notas is not null and length(v_notas) > 200 then
    raise exception 'notas demasiado largas (máx. 200)' using errcode = '22023';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;

  -- El vehículo ya está bloqueado: la lectura de su odómetro y de sus neumáticos es estable.
  select * into v_veh from public.vehiculos v where v.id = p_vehiculo_id;
  if p_odometro_km is not null and v_veh.odometro_km is not null and p_odometro_km < v_veh.odometro_km then
    raise exception 'el odómetro del vehículo no puede ser menor al actual (% km)', v_veh.odometro_km
      using errcode = '23514';
  end if;

  -- Posición esperada: igual que el diagrama del panel (tipo 10 pasa a 16 si hay un neumático montado en 11..98).
  if p_posicion < 99 then
    v_max := case when v_veh.tipo_ruedas = 16 or exists (
                       select 1 from public.neumaticos n
                        where n.vehiculo_id = p_vehiculo_id and n.estado = 'montado' and n.posicion between 11 and 98)
                  then 16 else 10 end;
    if p_posicion > v_max then
      raise exception 'la posición % no existe en un vehículo de % ruedas (posiciones 1-% y auxilio 99)',
        p_posicion, v_max, v_max using errcode = '23514';
    end if;
  end if;

  -- Posición libre (cualquier fila ocupa la posición: unique vehiculo_id+posicion).
  if exists (select 1 from public.neumaticos n where n.vehiculo_id = p_vehiculo_id and n.posicion = p_posicion) then
    raise exception 'la posición % ya tiene un neumático', p_posicion using errcode = '55000';
  end if;
  if v_aux and exists (select 1 from public.neumaticos n where n.vehiculo_id = p_vehiculo_id and n.auxilio) then
    raise exception 'el vehículo ya tiene un neumático de auxilio' using errcode = '55000';
  end if;

  if p_cubierta_id is not null then
    -- Cubierta individual del stock: solo admin o perfil global, y del MISMO cliente que el vehículo.
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: ingresar el neumático a mano' using errcode = '42501';
    end if;
    select * into v_cub from public.neumaticos n
     where n.id = p_cubierta_id and n.cliente_id = v_aut.cliente_id
       and n.vehiculo_id is null and n.estado = 'almacenado' for update;
    if not found then
      -- Inexistente, de otro cliente o ya montada: el mismo mensaje.
      raise exception 'cubierta del stock inexistente o ya montada' using errcode = 'P0002';
    end if;
    v_marca := v_cub.marca; v_modelo := v_cub.modelo; v_quema := v_cub.numero_quema;
    v_km_prev := v_cub.km_previos; v_precio := v_cub.precio_unidad; v_idn := v_cub.idneumatico;
    v_id := v_cub.id;
    if v_cub.sucursal_id is not null then
      select s.nombre into v_suc_org from public.sucursales s where s.id = v_cub.sucursal_id;
    end if;
  else
    if jsonb_typeof(p_nuevo) <> 'object' then
      raise exception 'datos del neumático inválidos' using errcode = '22023';
    end if;
    for v_k in select jsonb_object_keys(p_nuevo) loop
      if v_k not in ('marca', 'modelo', 'codigo', 'numero_quema', 'km_previos', 'fecha_compra', 'precio', 'vida') then
        raise exception 'campo desconocido: %', v_k using errcode = '22023';
      end if;
    end loop;
    v_marca  := nullif(btrim(coalesce(p_nuevo ->> 'marca', '')), '');
    v_modelo := nullif(btrim(coalesce(p_nuevo ->> 'modelo', '')), '');
    v_codigo := nullif(btrim(coalesce(p_nuevo ->> 'codigo', '')), '');
    v_quema  := nullif(btrim(coalesce(p_nuevo ->> 'numero_quema', '')), '');
    if v_marca is null then
      raise exception 'indicar la marca del neumático' using errcode = '22023';
    end if;
    if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 or length(coalesce(v_codigo, '')) > 60 then
      raise exception 'marca, modelo o código demasiado largos (máx. 60)' using errcode = '22023';
    end if;
    if v_quema is not null and length(v_quema) > 40 then
      raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
    end if;
    if v_quema is not null and exists (
         select 1 from public.neumaticos n
          where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema)) then
      raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
    end if;
    if p_nuevo ? 'km_previos' and jsonb_typeof(p_nuevo -> 'km_previos') not in ('number', 'null') then
      raise exception 'km previos inválidos' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'km_previos') = 'number' then
      v_txt := p_nuevo ->> 'km_previos';
      if v_txt::numeric < 0 or v_txt::numeric > 999999999 or v_txt::numeric <> trunc(v_txt::numeric) then
        raise exception 'km previos fuera de rango (0 a 999999999)' using errcode = '23514';
      end if;
      v_km_prev := v_txt::integer;
    end if;
    if p_nuevo ? 'fecha_compra' and jsonb_typeof(p_nuevo -> 'fecha_compra') not in ('string', 'null') then
      raise exception 'fecha de compra inválida' using errcode = '22023';
    end if;
    v_fecha_c := nullif(btrim(coalesce(p_nuevo ->> 'fecha_compra', '')), '')::date;
    if v_fecha_c > current_date + 1 then
      raise exception 'la fecha de compra no puede ser futura' using errcode = '23514';
    end if;
    if p_nuevo ? 'precio' and jsonb_typeof(p_nuevo -> 'precio') not in ('number', 'null') then
      raise exception 'precio inválido' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'precio') = 'number' then
      v_txt := p_nuevo ->> 'precio';
      if v_txt::numeric < 0 or v_txt::numeric >= 10000000000 then
        raise exception 'precio fuera de rango' using errcode = '23514';
      end if;
      v_precio := round(v_txt::numeric, 2);
    end if;
    if p_nuevo ? 'vida' and jsonb_typeof(p_nuevo -> 'vida') not in ('number', 'null') then
      raise exception 'vida inválida' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'vida') = 'number' then
      v_txt := p_nuevo ->> 'vida';
      if v_txt::numeric < 0 or v_txt::numeric <> trunc(v_txt::numeric) then
        raise exception 'vida inválida: entero no negativo' using errcode = '23514';
      end if;
      v_vida := v_txt::smallint;
    end if;
  end if;

  -- Monta
  if p_cubierta_id is not null then
    update public.neumaticos
       set vehiculo_id = p_vehiculo_id, posicion = p_posicion, sucursal_id = null,
           estado = 'montado', auxilio = v_aux
     where id = v_cub.id
    returning condicion into v_cond;                 -- el trigger pasó «nuevo» a «usado»
  else
    loop
      v_idn := 'CN-' || p_vehiculo_id || '-' || p_posicion || '-'
               || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
      exit when not exists (select 1 from public.neumaticos n where n.idneumatico = v_idn);
    end loop;
    insert into public.neumaticos
      (vehiculo_id, cliente_id, posicion, marca, modelo, fecha_compra, precio_unidad,
       idneumatico, codigo, auxilio, vida, estado, numero_quema, km_previos, condicion)
    values
      (p_vehiculo_id, v_aut.cliente_id, p_posicion, v_marca, v_modelo, v_fecha_c, v_precio,
       v_idn, v_codigo, v_aux, v_vida, 'montado', v_quema, v_km_prev,
       case when v_vida > 0 then 'recauchutado' else 'usado' end)
    returning id, condicion into v_id, v_cond;
  end if;

  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_destino, odometro_km, costo,
     sucursal_origen_id, notas, created_by)
  values (v_aut.cliente_id, p_vehiculo_id, v_id, v_idn, 'montaje', p_posicion, p_odometro_km,
          -- El costo de compra se imputa una sola vez: al ingresarlo o en el primer montaje de la cubierta («nuevo»).
          case when p_cubierta_id is null or v_cub.condicion = 'nuevo' then v_precio end,
          case when p_cubierta_id is not null then v_cub.sucursal_id end,
          'Montaje en posición libre'
            || coalesce(' · quema ' || v_quema, '')
            || case when v_km_prev > 0 then ' · ' || v_km_prev || ' km previos' else '' end
            || case when p_cubierta_id is not null
                    then ' · cubierta del stock (' || coalesce(v_suc_org, 'sin sucursal') || ')' else '' end
            || coalesce(': ' || v_notas, ''),
          auth.uid())
  returning id into v_ev;

  -- Odómetro del vehículo: solo sube
  if p_odometro_km is not null then
    update public.vehiculos
       set odometro_km = p_odometro_km, odometro_actualizado_at = now()
     where id = p_vehiculo_id and (odometro_km is null or odometro_km < p_odometro_km);
  end if;
  select odometro_km into v_odo_veh from public.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'vehiculo_id', p_vehiculo_id,
    'posicion', p_posicion,
    'auxilio', v_aux,
    'neumatico_id', v_id,
    'idneumatico', v_idn,
    'numero_quema', v_quema,
    'km_previos', v_km_prev,
    'condicion', v_cond,
    'cubierta_id', p_cubierta_id,
    'odometro_km', v_odo_veh,
    'evento_id', v_ev);
end
$$;


-- 5e. neumatico_cambiar: copia vigente (20261126020000, L636-986) sin el tope del reencauche.
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
  p_quema_viejo    text default null,
  p_motivo_codigo  text default null,
  p_motivo_texto   text default null
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
  v_motivo   text;   -- etiqueta o texto del catálogo (historial y reporte de bajas)
  v_mcod     text := nullif(btrim(coalesce(p_motivo_codigo, '')), '');
  v_mtxt     text := nullif(btrim(coalesce(p_motivo_texto, '')), '');
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
  -- Motivo obligatorio (RN-14, CA-14): la baja usa el catálogo de baja; el resto, solo «otro» (sin taxonomía confirmada).
  v_motivo := public.motivo_movimiento_validar(v_aut.cliente_id,
    case when p_destino_viejo = 'baja' then 'baja' else 'cambio' end, v_mcod, v_mtxt);
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  -- Odómetro obligatorio por cliente (RN-12): la base decide, no solo el handler.
  perform public.odometro_obligatorio_validar(v_aut.cliente_id, p_odometro_km);
  -- El odómetro del vehículo: si se informa, no puede bajar.
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
      if (v_txt)::numeric < 0 or (v_txt)::numeric <> trunc((v_txt)::numeric) then
        raise exception 'vida inválida: entero no negativo' using errcode = '23514';
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
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by, motivo_codigo, motivo_texto)
    values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'baja', p_posicion,
            p_odometro_km, 'Cambio de neumático: ' || v_motivo, auth.uid(), v_mcod, v_mtxt)
    returning id into v_ev;
    v_ev_ids := v_ev_ids || v_ev;
  else
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km,
       sucursal_destino_id, notas, created_by, motivo_codigo, motivo_texto)
    values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'desmontaje', p_posicion,
            p_odometro_km, case when v_a_stock then p_sucursal_stock end,
            'Cambio de neumático (' || p_destino_viejo || ')' || coalesce(': ' || v_motivo, '')
              || case when v_a_stock then ' · vuelve al stock: ' || coalesce(v_suc_dest, 'sin sucursal') else '' end,
            auth.uid(), v_mcod, v_mtxt)
    returning id into v_ev;
    v_ev_ids := v_ev_ids || v_ev;
    if p_destino_viejo = 'reencauche' then
      insert into public.eventos_neumatico
        (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by, motivo_codigo, motivo_texto)
      values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'reencauche', p_posicion,
              p_odometro_km, 'Reencauche nº ' || (v_viejo.vida + 1), auth.uid(), v_mcod, v_mtxt)
      returning id into v_ev;
      v_ev_ids := v_ev_ids || v_ev;
    end if;
  end if;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_destino, odometro_km, costo,
     sucursal_origen_id, notas, created_by, motivo_codigo, motivo_texto)
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
          auth.uid(), v_mcod, v_mtxt)
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


-- 6. v_estado_neumaticos: copia vigente (20261126040000, L198-386). Cambia solo las semanas hasta el crítico
-- y el retiro, que salen de la huella mínima. Mismas columnas, mismo orden y mismos permisos.
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
    -- RN-01/RN-08: el estado sale de la huella mínima. Con una huella sin medir no hay estado (sin fabricarlo).
    case when s.mm1 is null or s.mm2 is null or s.mm3 is null then 'desconocido'
         when least(s.mm1, s.mm2, s.mm3) < s.umbral_retiro_mm    then 'desgaste_limite'
         when least(s.mm1, s.mm2, s.mm3) < s.umbral_critico_mm   then 'mayor_desgaste'
         when least(s.mm1, s.mm2, s.mm3) < s.umbral_bajo_mm      then 'poco_desgaste'
         else 'nuevo' end as estado,
    -- RN-13: el auxilio (99) no tiene plazo de medición vencida; sin_medir no aplica. Sin plazo propio inventado.
    case when s.posicion = 99 then false
         when s.ultima_at is null then s.neumatico_id is not null
         else s.ultima_at < now() - make_interval(days => s.dias_sin_medir_alerta) end as sin_medir,
    case when s.promedio is null then null
         else greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3) end as diferencia_huellas_mm,
    -- RN-06 y D7: la diferencia se redondea a 0,1 mm, como en el panel, y el umbral incluye el valor (>=).
    -- Sin mm1 o mm3 no hay diferencia, como unevenWear del panel: la guarda evita el falso positivo con null.
    coalesce(s.mm1 is not null and s.mm3 is not null
      and round(greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3), 1) >= s.irregularidad_mm, false)
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
-- Dirección (D3): solo en el eje de dirección, con huella medida y no bajo el retiro (RN-08: bajo el retiro
-- manda la roja). El límite se mira antes que el aviso, porque el rango del aviso incluye al límite.
select y.*,
  case when y.rol_eje = 'direccion' and y.minimo >= y.umbral_retiro_mm then
         case when y.minimo < y.direccion_limite_mm then 'direccion_limite'
              when y.minimo <= y.direccion_aviso_mm then 'direccion_aviso' end
  end as estado_direccion,
  -- Ola 3 (R1, RN-16): asimetría lateral |mm1 − mm3| a 0,1 mm, separada del rango de las tres huellas (RN-06).
  -- Sin mm1 o mm3 no hay asimetría (null), como en el rango. El umbral es el de la irregularidad del cliente.
  a.lat as asimetria_lateral_mm,
  coalesce(a.lat >= cl2.irregularidad_mm, false) as desgaste_lateral
from (
  select b.*,
    -- Huella mínima (RN-01), no promedio: la cubierta se retira por su punto más gastado. Sin una de las tres, nulas.
    case when b.tasa_mm_semana > 0 and b.mm1 is not null and b.mm2 is not null and b.mm3 is not null
         then round(greatest(least(b.mm1, b.mm2, b.mm3) - b.umbral_critico_mm, 0) / b.tasa_mm_semana, 2) end
      as semanas_hasta_critico,
    case when b.tasa_mm_semana > 0 and b.mm1 is not null and b.mm2 is not null and b.mm3 is not null
         then round(greatest(least(b.mm1, b.mm2, b.mm3) - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end
      as semanas_hasta_retiro,
    -- Huella mínima (RN-01). NULL si falta cualquiera de las tres: least() ignora nulos y daría un mínimo falso.
    case when b.mm1 is null or b.mm2 is null or b.mm3 is null then null
         else least(b.mm1, b.mm2, b.mm3) end as minimo,
    -- Columnas nuevas al final: distribución y servicio del vehículo, rol del eje y umbrales de dirección del cliente.
    vh.distribucion, vh.servicio,
    public.rol_eje_posicion(vh.distribucion, b.posicion) as rol_eje,
    cl.direccion_aviso_mm, cl.direccion_limite_mm
  from b
  left join public.vehiculos vh on vh.id = b.vehiculo_id
  left join public.clientes cl on cl.id = b.cliente_id
) y
cross join lateral (
  select case when y.mm1 is null or y.mm3 is null then null else round(abs(y.mm1 - y.mm3), 1) end as lat
) a
left join public.clientes cl2 on cl2.id = y.cliente_id;

revoke all on public.v_estado_neumaticos from public, anon;
grant select on public.v_estado_neumaticos to authenticated;


-- 7. v_alertas: copia vigente (20261126040000, L1122-fin). Ningún mensaje lleva el umbral entre paréntesis:
-- el aviso y el límite ya están en la pantalla de umbrales. El código swap no cambia.
create or replace view public.v_alertas
with (security_invoker = true) as
select a.cliente_id, a.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, a.posicion, a.neumatico_id, a.idneumatico,
       a.tipo,
       case when a.tipo = 'limite' then 3 else 2 end as severidad,
       case when a.tipo = 'swap' then a.km_actual::numeric else a.mm_actual::numeric end as valor,
       case a.tipo
         when 'limite' then format('Desgaste límite: %s mm',
              replace(trim_scale(a.mm_actual)::text, '.', ','))
         when 'direccion_aviso' then format('Pasar a tracción o eje loco: %s mm',
              replace(trim_scale(a.mm_actual)::text, '.', ','))
         when 'direccion_limite' then format('Pasar a tracción o eje loco: %s mm',
              replace(trim_scale(a.mm_actual)::text, '.', ','))
         -- Ola 3 (RN-16): el lateral lo mide la asimetría interna y externa, no el rango de las tres huellas.
         when 'lateral' then format('Revisar alineación: %s mm de diferencia entre la huella interna y la externa',
              replace(trim_scale(a.mm_actual)::text, '.', ','))
         when 'irregular' then format('Revisar la cubierta: %s mm de diferencia entre huellas',
              replace(trim_scale(a.mm_actual)::text, '.', ','))
         when 'swap' then format('Primera rotación: %s km desde el montaje',
              replace(to_char(a.km_actual::numeric, 'FM999,999,999'), ',', '.'))
       end as mensaje,
       a.ultima_medicion_at,
       a.id as alerta_id, a.estado, a.umbral_mm, a.mm_apertura, a.mm_minimo, a.abierta_at, a.reconocida_at,
       a.silenciada_hasta, a.veces_reabierta,
       case when a.tipo = 'limite' then 'rojo' else 'amarillo' end as color,
       a.km_actual, a.umbral_km
from public.alertas a
join public.vehiculos v on v.id = a.vehiculo_id
left join public.neumaticos n on n.id = a.neumatico_id
join public.clientes c on c.id = a.cliente_id and c.deleted_at is null
where a.estado <> 'resuelta'
  -- El auxilio (la rueda en la posición 99) no genera advertencias; manda la posición actual del neumático.
  and coalesce(n.posicion, a.posicion) is distinct from 99;

revoke all on public.v_alertas from public, anon;
grant select on public.v_alertas to authenticated;


-- 8. Catálogo: el swap a 20.000 km pasa a llamarse «Primera rotación» (el km lo fija cada empresa). Solo el
-- catálogo base; las migraciones anteriores no se editan.
update public.motivos_movimiento
   set etiqueta = 'Primera rotación'
 where cliente_id is null and codigo = 'swap_20000' and etiqueta = 'Swap a 20.000 km';
