// Ola 4 de F8 con base real (T4): una medición con caída brusca de 5 mm aparece en revisión en Calidad; el perfil global la
// corrige desde el panel y la base la deja válida con corregida_at y auditada; una sucursal que no es la del vehículo
// recibe 42501 por API; la moneda de Empresa llega al alta de costos sin tocarla; y el administrador de Neumet no ve
// botones de corregir ni de moneda. Las mediciones y costos de prueba se borran al salir, y la moneda se restaura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { json, DEMO } from '../lib/verdad.mjs';
import { seleccionarRueda } from './taller.mjs';

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
// Posiciones de ruta con cubierta montada (1..98), en orden.
const enRuta = (env, id) => env.sql(`select posicion from public.neumaticos where vehiculo_id = ${id} and estado = 'montado' and posicion between 1 and 98 order by posicion`).split('\n').filter(Boolean).map(Number);
const maxMedicion = env => Number(env.sql(`select coalesce(max(id), 0) from public.mediciones`));
const maxCosto = env => Number(env.sql(`select coalesce(max(id), 0) from public.costos_neumatico`));
const medicion = (env, id) => json(env, `select calidad, corregida_at is not null as corregida from public.mediciones where id = ${id}`)[0];
const SEL_REVISAR = `.inicio-enlace[data-args='["calidad"]']`;

// Dos mediciones del mismo neumático: la base (10 mm en las tres huellas) y una que baja el mínimo 5 mm (5 → 5,5 → 6).
// El trigger de calidad compara con la última medición válida, así que la segunda queda sospechosa.
function sembrarCaida(env, id, pos) {
  const insertar = (mm1, mm2, mm3) => {
    const promedio = ((mm1 + mm2 + mm3) / 3).toFixed(2);
    env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, device_id, posicion, mm1, mm2, mm3, promedio, idneumatico)
      select ${id}, cliente_id, 'e2e', ${pos}, ${mm1}, ${mm2}, ${mm3}, ${promedio}, idneumatico from public.neumaticos
      where vehiculo_id = ${id} and posicion = ${pos} and estado = 'montado'`);
    return Number(env.sql(`select max(id) from public.mediciones`));
  };
  insertar(10, 10, 10);
  return insertar(5, 5.5, 6);
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

// Calidad se llega desde el aviso «Revisar ›» de Inicio: no hay entrada propia en el menú.
async function abrirCalidad(p) {
  await p.esperar(`!!document.querySelector(${JSON.stringify(SEL_REVISAR)})`, { que: 'aviso de mediciones por revisar en Inicio' });
  await p.click(SEL_REVISAR);
  await p.esperar(`document.querySelector('#view-calidad').classList.contains('active')`, { que: 'vista Calidad activa' });
}

export function registrar(env) {
  test('Ola 4 · Calidad y Empresa (admin): la lista no ofrece corregir y la moneda no se ve', async () => {
    const id = vehId(env, 'DEMO010');
    const pos = enRuta(env, id)[0];
    const maxMed = maxMedicion(env);
    try {
      sembrarCaida(env, id, pos);
      await flujo(env, 'calidad-admin', 'admin', async p => {
        await abrirCalidad(p);
        await p.esperar(`document.querySelectorAll('#cal-contenido .cal-fila').length > 0`, { que: 'filas de Calidad' });
        assert.equal(await p.eval(`document.querySelectorAll('#cal-contenido [data-action="calidad-corregir"]').length`), 0, 'el administrador no corrige');
        assert.equal(await p.eval(`document.querySelector('.nav-item[data-view="empresa-umbrales"]').offsetParent === null`), true, 'Empresa no está en el menú del administrador');
        assert.equal(await p.eval(`document.querySelector('#emp-moneda-form').offsetParent === null`), true, 'la moneda no se ve al administrador');
      });
    } finally {
      env.sql(`delete from public.mediciones where id > ${maxMed}`);
    }
  });

  test('Ola 4 · Calidad (global): una caída de 5 mm queda en revisión y la corrección la deja válida y auditada', async () => {
    const id = vehId(env, 'DEMO010');
    const pos = enRuta(env, id)[0];
    const maxMed = maxMedicion(env);
    try {
      const med = sembrarCaida(env, id, pos);
      assert.equal(medicion(env, med).calidad, 'sospechosa', 'la caída de 5 mm marca la medición como sospechosa');
      await flujo(env, 'calidad-corregir', 'global', async p => {
        await abrirCalidad(p);
        const boton = `#cal-contenido [data-action="calidad-corregir"][data-args="[${med}]"]`;
        await p.esperar(`!!document.querySelector(${JSON.stringify(boton)})`, { que: 'Corregir en la medición sospechosa' });
        await p.click(boton);
        await p.esperar(`document.querySelector('#modal-corregir').classList.contains('show')`, { que: 'modal de corrección' });
        await p.escribir('#corr-mm1', '9.5');
        await p.escribir('#corr-mm2', '9');
        await p.escribir('#corr-mm3', '8.8');
        await p.eval(`(() => { const s = document.querySelector('#corr-motivo'); s.value = 'error_calibre'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#corr-confirmar');
        await p.esperar(`/Medición corregida/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de medición corregida' });
      });
      const m = medicion(env, med);
      assert.equal(m.calidad, 'valida', 'la corrección deja la medición válida');
      assert.equal(m.corregida, true, 'la base guarda corregida_at');
      const aud = json(env, `select count(*)::int as n from public.audit_log where accion = 'CORREGIR_MEDICION' and entidad = 'mediciones' and entidad_id = '${med}'`)[0].n;
      assert.equal(aud, 1, 'la corrección queda en audit_log');
    } finally {
      env.sql(`delete from public.mediciones where id > ${maxMed}`);
    }
  });

  test('Ola 4 · Calidad (API): una sucursal que no es la del vehículo no corrige la medición (403 / 42501)', async () => {
    const id = vehId(env, 'DEMO010');
    const pos = enRuta(env, id)[0];
    const suc = json(env, `select lower(s.nombre) as n from public.vehiculos v join public.sucursales s on s.id = v.sucursal_id where v.id = ${id}`)[0].n;
    const otra = suc === 'salto' ? 'montevideo' : 'salto';
    const maxMed = maxMedicion(env);
    try {
      const med = sembrarCaida(env, id, pos);
      const r = await rpcApi(env, otra, 'medicion_corregir', { p_medicion_id: med, p_mm1: 9.5, p_mm2: 9, p_mm3: 8.8, p_motivo_codigo: 'error_calibre', p_motivo_texto: null });
      assert.equal(r.status, 403, `${otra} recibe 403`);
      assert.equal(r.body && r.body.code, '42501', `${otra} recibe 42501`);
      assert.equal(medicion(env, med).calidad, 'sospechosa', 'la medición sigue en revisión');
    } finally {
      env.sql(`delete from public.mediciones where id > ${maxMed}`);
    }
  });

  test('Ola 4 · Empresa (global): la moneda elegida llega al alta de costos sin tocarla (costos_neumatico.moneda = UYU)', async () => {
    const id = vehId(env, 'DEMO010');
    const pos = enRuta(env, id)[0];
    const n = Number(env.sql(`select id from public.neumaticos where vehiculo_id = ${id} and posicion = ${pos} and estado = 'montado'`));
    const previa = env.sql(`select moneda_default from public.clientes where id = ${DEMO}`).trim();
    const maxCos = maxCosto(env);
    try {
      await flujo(env, 'moneda-costo', 'global', async p => {
        await irA(p, 'empresa-umbrales');
        await p.esperar(`document.querySelector('#emp-moneda option[value="UYU"]') !== null`, { que: 'selector de moneda con UYU' });
        await p.eval(`(() => { const s = document.querySelector('#emp-moneda'); s.value = 'UYU'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#emp-moneda-guardar');
        await p.esperar(`/Moneda actualizada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de moneda actualizada' });
        await abrirDetallePorMatricula(p, 'DEMO010');
        await seleccionarRueda(p, pos);
        await p.esperar(`!!document.querySelector('.vd-costo-btn')`, { que: 'botón Registrar costo' });
        await p.click('.vd-costo-btn');
        await p.esperar(`document.querySelector('#modal-costo').classList.contains('show') && document.querySelector('#costo-moneda').value === 'UYU'`, { que: 'moneda UYU precargada en el alta de costo' });
        await p.escribir('#costo-monto', '12');
        await p.eval(`(() => { const s = document.querySelector('#costo-concepto'); s.value = 'reparacion'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#costo-guardar');
        await p.esperar(`/Costo registrado/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de costo registrado' });
      });
      const moneda = json(env, `select moneda from public.costos_neumatico where neumatico_id = ${n} and id > ${maxCos} order by id desc limit 1`)[0];
      assert.equal(moneda && moneda.moneda, 'UYU', 'el costo se guarda en la moneda de Empresa');
    } finally {
      env.sql(`delete from public.costos_neumatico where id > ${maxCos}`);
      env.sql(`update public.clientes set moneda_default = '${previa}' where id = ${DEMO}`);
    }
  });

}
