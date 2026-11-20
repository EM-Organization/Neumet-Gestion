// Genera el script SQL de la carga a partir del plan. Una sola transacción: todo o nada. Se escribe directo en las
// tablas (no por RPC) porque las RPC autorizan con auth.uid() y la carga corre sin sesión de usuario; por eso este
// archivo replica lo que hacen neumatico_montar, stock_cubierta_agregar y neumatico_cambiar (docs/20, «Qué replica»).
import { MARCA_CARGA } from './carga-inicial.mjs';

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/\0/g, '').replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? 'null' : String(Number(v)));
const b = (v) => (v ? 'true' : 'false');
const lotes = (arr, tam = 400) => Array.from({ length: Math.ceil(arr.length / tam) }, (_, i) => arr.slice(i * tam, (i + 1) * tam));

/** Consulta de solo lectura que devuelve (como un JSON) lo ya existente del cliente: para no duplicar y detectar choques. */
export function sqlPreflight({ clienteId, sucursalId, nombreCliente }) {
  return `select json_build_object(
  'cliente', (select c.nombre from public.clientes c where c.id = ${n(clienteId)}),
  'sucursal_ok', exists (select 1 from public.sucursales s where s.id = ${n(sucursalId)} and s.cliente_id = ${n(clienteId)}),
  'nombre_ok', exists (select 1 from public.clientes c where c.id = ${n(clienteId)} and c.nombre = ${q(nombreCliente)}),
  'vehiculos', coalesce((select json_agg(json_build_object('id', v.id, 'numero', v.numero, 'patente_norm', v.patente_norm, 'notas', v.notas))
                          from public.vehiculos v where v.cliente_id = ${n(clienteId)} and (to_jsonb(v) ->> 'deleted_at') is null), '[]'::json),
  'neumaticos', coalesce((select json_agg(json_build_object('idneumatico', x.idneumatico))
                           from public.neumaticos x where x.cliente_id = ${n(clienteId)} and x.idneumatico like ${q(`CI-${clienteId}-%`)}), '[]'::json),
  'baja_sin_vehiculo', (select pg_get_constraintdef(c.oid) like '%''baja''%' from pg_constraint c
                         where c.conname = 'neumaticos_stock_ck' and c.conrelid = 'public.neumaticos'::regclass)
)::text;`;
}

/** Script de escritura (BEGIN..COMMIT). Idempotente: reejecutarlo no duplica vehículos, neumáticos ni eventos. */
export function sqlCarga(plan, { clienteId, sucursalId, nombreCliente, fechaCarga }) {
  const cli = n(clienteId); const suc = n(sucursalId);
  const marca = q(MARCA_CARGA);
  const salida = [];
  const p = (s) => salida.push(s);

  p('-- Carga inicial del listado de un cliente. Generado por supabase/seed/importar-carga-inicial.mjs; no editar a mano.');
  p('\\set ON_ERROR_STOP on');
  p('begin;');
  p("set local lock_timeout = '10s';");
  p("set local statement_timeout = '10min';");
  // Salvaguarda: no escribir si los ids no son la empresa y la sucursal esperadas.
  p(`do $chk$ begin
  if not exists (select 1 from public.clientes c join public.sucursales s on s.cliente_id = c.id
                  where c.id = ${cli} and s.id = ${suc} and c.nombre = ${q(nombreCliente)}) then
    raise exception 'El cliente % o la sucursal % no coinciden con "%"', ${cli}, ${suc}, ${q(nombreCliente)};
  end if;
end $chk$;`);

  p('create temp table _ci_veh (numero text, patente text, nombre text, tipo_ruedas smallint, notas text) on commit drop;');
  for (const l of lotes(plan.vehiculos)) {
    p(`insert into _ci_veh values\n${l.map((v) => `  (${q(v.numero)}, ${q(v.patente)}, ${q(v.nombre)}, ${n(v.tipo_ruedas)}, ${q(v.notas)})`).join(',\n')};`);
  }
  p(`create temp table _ci_neu (idneumatico text, veh_numero text, posicion smallint, auxilio boolean, estado text, marca text,
  modelo text, codigo text, vida smallint, condicion text, km_previos integer, notas text, sucursal_id bigint,
  fecha_baja date, motivo_baja text, fecha_montaje date) on commit drop;`);
  for (const l of lotes(plan.neumaticos)) {
    p(`insert into _ci_neu values\n${l.map((x) => `  (${q(x.idneumatico)}, ${q(x.veh_numero)}, ${n(x.posicion)}, ${b(x.auxilio)}, ${q(x.estado)}, ${q(x.marca)}, ${q(x.modelo)}, ${q(x.codigo)}, ${n(x.vida)}, ${q(x.condicion)}, ${n(x.km_previos)}, ${q(x.notas)}, ${n(x.sucursal_id)}, ${q(x.fecha_baja ?? null)}, ${q(x.motivo_baja ?? null)}, ${q(x.fecha_montaje)})`).join(',\n')};`);
  }

  // Vehículos. `deleted_at` se lee con to_jsonb para no depender de que la migración de eliminar vehículo esté aplicada.
  p(`insert into public.vehiculos (cliente_id, nombre, patente, numero, tipo_ruedas, sucursal_id, notas)
select ${cli}, t.nombre, t.patente, t.numero, t.tipo_ruedas, ${suc}, t.notas
  from _ci_veh t
 where not exists (select 1 from public.vehiculos v
                    where v.cliente_id = ${cli} and (to_jsonb(v) ->> 'deleted_at') is null
                      and (v.numero = t.numero or (t.patente is not null and v.patente_norm = public.normalizar_patente(t.patente))));`);
  p(`do $chk$ begin
  if (select count(*) from _ci_veh t join public.vehiculos v on v.cliente_id = ${cli} and v.numero = t.numero
                   and v.notas like ${marca} || '%' and (to_jsonb(v) ->> 'deleted_at') is null) <> (select count(*) from _ci_veh) then
    raise exception 'Algún vehículo no quedó creado por esta carga (choque con un vehículo existente)';
  end if;
end $chk$;`);

  // Neumáticos: la clave estable es idneumatico (único). Las columnas son las que escriben neumatico_montar (montado),
  // stock_cubierta_agregar (almacenado) y neumatico_cambiar (baja); el trigger de condición ya recibe «usado» al montar.
  p(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, modelo, idneumatico, codigo, auxilio, vida,
                              estado, condicion, km_previos, sucursal_id, notas, fecha_baja, motivo_baja)
select v.id, ${cli}, t.posicion, t.marca, t.modelo, t.idneumatico, t.codigo, t.auxilio, t.vida,
       t.estado, t.condicion, t.km_previos, t.sucursal_id, t.notas, t.fecha_baja, t.motivo_baja
  from _ci_neu t
  left join public.vehiculos v on v.cliente_id = ${cli} and v.numero = t.veh_numero and v.notas like ${marca} || '%'
                              and (to_jsonb(v) ->> 'deleted_at') is null
 where t.veh_numero is null or v.id is not null
on conflict (idneumatico) do nothing;`);
  p(`do $chk$ begin
  if (select count(*) from _ci_neu t join public.neumaticos x on x.idneumatico = t.idneumatico and x.cliente_id = ${cli})
     <> (select count(*) from _ci_neu) then
    raise exception 'Algún neumático no quedó cargado (vehículo no encontrado o idneumatico ajeno)';
  end if;
end $chk$;`);

  // Eventos de historial: uno por cubierta y solo si aún no tiene el de la carga (idempotente). Sin odómetro: no se conoce.
  p(`insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino,
                                    sucursal_destino_id, notas, created_at)
select ${cli}, x.vehiculo_id,  x.id, x.idneumatico,
       case t.estado when 'montado' then 'montaje' when 'almacenado' then 'alta_stock' else 'baja' end,
       null,
       case when t.estado = 'montado' then x.posicion end,
       case when t.estado = 'almacenado' then ${suc} end,
       ${marca} || case t.estado when 'montado' then ': montaje registrado'
                                 when 'almacenado' then ': alta en stock' else ': baja por descarte' end,
       case when t.estado = 'montado' and t.fecha_montaje is not null then (t.fecha_montaje::timestamp + interval '12 hours') at time zone 'UTC' else now() end
  from _ci_neu t
  join public.neumaticos x on x.idneumatico = t.idneumatico and x.cliente_id = ${cli}
 where not exists (select 1 from public.eventos_neumatico e where e.neumatico_id = x.id and e.notas like ${marca} || '%');`);

  p(`select 'cargados' as paso,
       (select count(*) from _ci_veh) as vehiculos,
       (select count(*) from _ci_neu where estado = 'montado') as montados,
       (select count(*) from _ci_neu where estado = 'almacenado') as stock,
       (select count(*) from _ci_neu where estado = 'baja') as bajas;`);
  p(`-- fecha de la carga: ${fechaCarga}`);
  p('commit;');
  return `${salida.join('\n')}\n`;
}
