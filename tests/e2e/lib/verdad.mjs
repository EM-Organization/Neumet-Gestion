// "Verdad" de la base: consultas SQL como superusuario (sin RLS) con el alcance esperado de cada rol,
// para comparar con lo que muestra el panel. No usan la lógica del panel: son la referencia independiente.
export const DEMO = `(select id from public.clientes where nombre = 'Demo Transportes')`;
const SUC = n => `(select s.id from public.sucursales s where s.cliente_id = ${DEMO} and lower(s.nombre) = '${n}')`;

// Condición sobre un alias `v` de public.vehiculos (y `d` de public.dispositivos) visible para cada rol.
export const ALCANCE = {
  admin: { veh: 'true', dis: 'true' },
  global: { veh: `v.cliente_id = ${DEMO}`, dis: `d.cliente_id = ${DEMO}` },
  salto: { veh: `v.cliente_id = ${DEMO} and v.sucursal_id = ${SUC('salto')}`, dis: `d.cliente_id = ${DEMO} and d.sucursal_id = ${SUC('salto')}` },
  montevideo: { veh: `v.cliente_id = ${DEMO} and v.sucursal_id = ${SUC('montevideo')}`, dis: `d.cliente_id = ${DEMO} and d.sucursal_id = ${SUC('montevideo')}` }
};

export const json = (env, sql) => JSON.parse(env.sql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));

export const vehiculosVisibles = (env, rol) =>
  json(env, `select v.id, v.nombre, v.patente, v.numero, v.tipo_ruedas, v.sucursal_id from public.vehiculos v where v.activo and ${ALCANCE[rol].veh} order by v.nombre`);

// Cifras que debe mostrar Inicio, calculadas desde las vistas SQL con el alcance del rol (referencia independiente del panel).
export function cifrasInicio(env, rol) {
  const a = ALCANCE[rol];
  const n = sql => Number(env.sql(sql));
  const porEstado = e => n(`select count(*) from public.v_estado_neumaticos e join public.vehiculos v on v.id = e.vehiculo_id where ${e} and ${a.veh}`);
  return {
    total: porEstado('true'),
    ok: porEstado(`e.estado = 'ok'`),
    bajo: porEstado(`e.estado = 'bajo'`),
    criticos: porEstado(`e.estado = 'critico'`),
    sinDatos: porEstado(`e.estado not in ('ok','bajo','critico')`),
    vehCriticos: n(`select count(distinct e.vehiculo_id) from public.v_estado_neumaticos e join public.vehiculos v on v.id = e.vehiculo_id where e.estado = 'critico' and ${a.veh}`),
    proximos: porEstado(`e.estado in ('ok','bajo') and e.semanas_hasta_critico is not null and e.semanas_hasta_critico <= 12`),
    alertas: n(`select count(*) from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where ${a.veh}`),
    dispTotal: n(`select count(*) from public.v_salud_dispositivos s join public.dispositivos d on d.id = s.dispositivo_id where ${a.dis}`),
    dispActivos: n(`select count(*) from public.v_salud_dispositivos s join public.dispositivos d on d.id = s.dispositivo_id where s.estado = 'activo' and ${a.dis}`)
  };
}
