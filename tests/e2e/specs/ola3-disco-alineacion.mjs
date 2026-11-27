// Ola 3 de F8 con base real (RN-15, RN-16, RN-17, R1; CA-15 a CA-17): rotar en disco y registrar alineación desde el panel
// cierran las alertas de desgaste que les corresponden (lateral con su motivo; en alineación, solo lateral), y la base
// rechaza el alta de disco en la 99 y las llamadas de los roles sin permiso. Las mediciones de prueba se siembran aquí y
// se borran al salir, para que las pruebas posteriores de la suite vean el demo como estaba.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { json } from '../lib/verdad.mjs';
import { confirmarRotacionEnDialogo } from '../lib/rotacion.mjs';
import { seleccionarRueda } from './taller.mjs';

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
const clienteDe = (env, id) => Number(env.sql(`select cliente_id from public.vehiculos where id = ${id}`));
const maxEvento = (env, id) => Number(env.sql(`select coalesce(max(id), 0) from public.eventos_neumatico where vehiculo_id = ${id}`));
const maxMedicion = (env) => Number(env.sql(`select coalesce(max(id), 0) from public.mediciones`));
// Posiciones de ruta con cubierta montada (1..98), en orden.
const enRuta = (env, id) => env.sql(`select posicion from public.neumaticos where vehiculo_id = ${id} and estado = 'montado' and posicion between 1 and 98 order by posicion`).split('\n').filter(Boolean).map(Number);
const alertasDe = (env, neumatico) => json(env, `select tipo, estado, resuelta_motivo from public.alertas where neumatico_id = ${neumatico} order by id`);
const abierta = (env, neumatico, tipo) => alertasDe(env, neumatico).some(a => a.tipo === tipo && a.estado !== 'resuelta');
const rpcsDesde = (env, desde, nombre) => env.peticiones.slice(desde).filter(r => r.path.startsWith(`/rpc/${nombre}`));

// Medición de prueba como la del proveedor (mismo INSERT que mediciones-neumatico.mjs) y sincronización de alertas.
function medir(env, id, pos, mm1, mm2, mm3) {
  const promedio = ((mm1 + mm2 + mm3) / 3).toFixed(2);
  env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, device_id, posicion, mm1, mm2, mm3, promedio, idneumatico)
    select ${id}, cliente_id, 'e2e', ${pos}, ${mm1}, ${mm2}, ${mm3}, ${promedio}, idneumatico from public.neumaticos where vehiculo_id = ${id} and posicion = ${pos} and estado = 'montado'`);
  env.sql(`select public.alerta_sincronizar(${clienteDe(env, id)})`);
}

// La API directa con el JWT del rol, como la llama el panel (PostgREST): devuelve el estado y el cuerpo del error.
async function rpcApi(env, rol, nombre, cuerpo) {
  const r = await fetch(`${env.rest.base}/rpc/${nombre}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.sesion(rol).jwt}`, apikey: 'x', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export function registrar(env) {
  test('Ola 3 · Disco (global): rotar en disco cierra la alerta lateral con motivo «rotacion» y guarda el evento con su motivo', async () => {
    const id = vehId(env, 'DEMO010');
    const pos = enRuta(env, id)[0];
    const n = Number(env.sql(`select id from public.neumaticos where vehiculo_id = ${id} and posicion = ${pos} and estado = 'montado'`));
    const medAntes = maxMedicion(env);
    medir(env, id, pos, 9, 8, 6.5);   // T04: asimetría 2,5 mm (≥ 2 mm por defecto) → lateral
    assert.equal(abierta(env, n, 'lateral'), true, 'la medición T04 abre la alerta lateral');
    const maxAntes = maxEvento(env, id);
    const desde = env.peticiones.length;
    try {
      await flujo(env, 'rotar-disco', 'global', async p => {
        await abrirDetallePorMatricula(p, 'DEMO010');
        await seleccionarRueda(p, pos);
        await p.eval(`(() => { const s = document.querySelector('#vd-rotar-destino'); s.value = 'disco'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await confirmarRotacionEnDialogo(p, { motivo: 'desgaste_lateral' });
        await p.esperar(`/rotada en disco/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de rotación en disco' });
      });
    } finally {
      env.sql(`delete from public.mediciones where id > ${medAntes}`);
    }
    assert.equal(rpcsDesde(env, desde, 'neumatico_rotar_disco').length, 1, 'una sola llamada a neumatico_rotar_disco');
    const alerta = alertasDe(env, n).find(a => a.tipo === 'lateral');
    assert.deepEqual(alerta, { tipo: 'lateral', estado: 'resuelta', resuelta_motivo: 'rotacion' }, 'la rotación en disco cierra la lateral con «rotacion»');
    const eventos = json(env, `select motivo_codigo, posicion_origen, posicion_destino from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'rotacion_disco' and id > ${maxAntes} order by id`);
    assert.deepEqual(eventos, [{ motivo_codigo: 'desgaste_lateral', posicion_origen: pos, posicion_destino: pos }], 'un evento rotacion_disco con su motivo, en la misma posición');
  });

  test('Ola 3 · Alineación (global): registrar alineación cierra la lateral con «alineacion», deja la irregular abierta y guarda un evento por cubierta en ruta', async () => {
    const id = vehId(env, 'DEMO010');
    const [lat, irr] = enRuta(env, id).slice(1, 3);
    const nLat = Number(env.sql(`select id from public.neumaticos where vehiculo_id = ${id} and posicion = ${lat} and estado = 'montado'`));
    const nIrr = Number(env.sql(`select id from public.neumaticos where vehiculo_id = ${id} and posicion = ${irr} and estado = 'montado'`));
    const medAntes = maxMedicion(env);
    medir(env, id, lat, 9, 8, 6.5);   // lateral: 2,5 mm entre bordes
    medir(env, id, irr, 9, 6.5, 9);   // irregular: rango 2,5 mm en las tres huellas, sin asimetría de bordes
    const cantidad = enRuta(env, id).length;
    const maxAntes = maxEvento(env, id);
    const desde = env.peticiones.length;
    try {
      await flujo(env, 'registrar-alineacion', 'global', async p => {
        await abrirDetallePorMatricula(p, 'DEMO010');
        await p.click('#vd-alinear-btn');
        await p.esperar(`document.querySelector('#modal-rotar').classList.contains('show')`, { que: 'diálogo de registrar alineación' });
        await p.esperar(`document.querySelector('#rotar-title').textContent === 'Registrar alineación'`, { que: 'título Registrar alineación' });
        await p.eval(`(() => { const m = document.querySelector('#rotar-motivo'); m.value = 'control'; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#rotar-confirmar');
        await p.esperar(`/Alineación registrada en ${cantidad} neumáticos/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de alineación' });
      });
    } finally {
      env.sql(`delete from public.mediciones where id > ${medAntes}`);
    }
    assert.equal(rpcsDesde(env, desde, 'vehiculo_alinear').length, 1, 'una sola llamada a vehiculo_alinear');
    assert.deepEqual(alertasDe(env, nLat).find(a => a.tipo === 'lateral'), { tipo: 'lateral', estado: 'resuelta', resuelta_motivo: 'alineacion' }, 'la alineación cierra la lateral con «alineacion»');
    assert.equal(abierta(env, nIrr, 'irregular'), true, 'la alineación no cierra la irregular (presión, no alineación)');
    const eventos = json(env, `select motivo_codigo from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'alineacion' and id > ${maxAntes} order by id`);
    assert.equal(eventos.length, cantidad, 'un evento alineacion por cubierta montada en ruta');
    for (const e of eventos) assert.equal(e.motivo_codigo, 'control');
  });

  test('Ola 3 · Base: rotar en disco y alinear sin permiso o con el auxilio responden 42501 o 22023 (API con el JWT de cada rol)', async () => {
    const id = vehId(env, 'DEMO010');
    const pos = enRuta(env, id)[0];
    const deDisco = { p_vehiculo_id: id, p_posicion: pos, p_odometro_km: null, p_motivo_codigo: 'desgaste_lateral', p_motivo_texto: null };
    const deAlinear = { p_vehiculo_id: id, p_odometro_km: null, p_motivo_codigo: 'control', p_motivo_texto: null };
    const montevideo = Number(env.sql(`select v.id from public.vehiculos v join public.sucursales s on s.id = v.sucursal_id where s.nombre ilike '%montevideo%' limit 1`));
    // Auxilio (99): la base lo rechaza aunque el panel no lo ofrezca (RN-15).
    const aux = await rpcApi(env, 'global', 'neumatico_rotar_disco', { ...deDisco, p_posicion: 99 });
    assert.equal(aux.body && aux.body.code, '22023', 'el auxilio no se rota en disco: 22023');
    // Roles sin permiso sobre el vehículo DEMO010 (admin interno, API, sin perfil, otra empresa) y sucursal ajena (salto sobre Montevideo).
    for (const rol of ['admin', 'api', 'sinperfil', 'otra']) {
      const d = await rpcApi(env, rol, 'neumatico_rotar_disco', deDisco);
      assert.equal(d.body && d.body.code, '42501', `neumatico_rotar_disco para ${rol}: 42501`);
      const a = await rpcApi(env, rol, 'vehiculo_alinear', deAlinear);
      assert.equal(a.body && a.body.code, '42501', `vehiculo_alinear para ${rol}: 42501`);
    }
    const sj = { ...deDisco, p_vehiculo_id: montevideo, p_posicion: Number(env.sql(`select min(posicion) from public.neumaticos where vehiculo_id = ${montevideo} and estado = 'montado' and posicion between 1 and 98`)) };
    const salto = await rpcApi(env, 'salto', 'neumatico_rotar_disco', sj);
    assert.equal(salto.body && salto.body.code, '42501', 'salto sobre un vehículo de Montevideo: 42501');
  });
}
