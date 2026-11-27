// Ola 2 de F8 con base real: v_alertas expone color, severidad y umbral_km por tipo (RN-02, RN-05, RN-20); el servicio
// del vehículo se fija desde «Distribución y servicio» con la RPC vehiculo_fijar_servicio y el diálogo lo muestra al
// reabrirlo; el aviso de umbrales nombra Empresa > Umbrales y lo ve el administrador de empresa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, abrirDetallePorMatricula } from '../lib/flujo.mjs';

const AVISO_UMBRALES = 'Los umbrales de las alertas se ajustan en Empresa > Umbrales.';
const TIPOS = ['limite', 'direccion_aviso', 'direccion_limite', 'irregular', 'swap', 'km_por_mm'];

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
const rpcsDesde = (env, desde, nombre) => env.peticiones.slice(desde).filter(r => r.path.startsWith(`/rpc/${nombre}`));

// v_alertas por la API con el JWT del rol (no con SQL de dueño): es lo que recibe el panel.
async function alertasApi(env, rol) {
  const r = await fetch(`${env.rest.base}/v_alertas?select=tipo,patente,severidad,color,valor,umbral_km,km_actual&limit=1000`, {
    headers: { Authorization: `Bearer ${env.sesion(rol).jwt}`, apikey: 'x' } });
  assert.equal(r.status, 200, `v_alertas responde al rol ${rol}`);
  return r.json();
}

// El botón se ignora mientras el detalle se vuelve a dibujar tras guardar (`ocupado` en cambiar-distribucion.js): se reintenta.
async function abrirDistribucion(p) {
  for (let intento = 0; intento < 20; intento++) {
    try {
      await p.click('[data-action="vehiculo-cambiar-distribucion"]');
      await p.esperar(`document.querySelector('#modal-veh-dist').classList.contains('show')`, { ms: 500, que: 'diálogo Distribución y servicio' });
      return;
    } catch { /* ocupado o aún sin pintar: se reintenta */ }
  }
  throw new Error('el diálogo Distribución y servicio no se abrió');
}

export function registrar(env) {
  test('Ola 2 · Alertas (global): v_alertas expone color, severidad y umbral_km por tipo', async () => {
    const filas = await alertasApi(env, 'global');
    assert.ok(filas.some(f => f.tipo === 'limite'), 'el demo trae alertas de desgaste límite');
    assert.ok(filas.every(f => TIPOS.includes(f.tipo)), 'solo tipos del CHECK de alertas');
    for (const f of filas) {
      const limite = f.tipo === 'limite';
      assert.equal(f.color, limite ? 'rojo' : 'amarillo', `color de ${f.tipo} en ${f.patente}`);
      assert.equal(f.severidad, limite ? 3 : 2, `severidad de ${f.tipo} en ${f.patente}`);
      if (f.tipo === 'swap') {
        assert.ok(Number.isInteger(f.umbral_km) && f.umbral_km > 0, `swap de ${f.patente}: umbral en km`);
        assert.equal(f.valor, f.km_actual, `swap de ${f.patente}: el valor son los km del tramo`);
      } else {
        assert.equal(f.umbral_km, null, `${f.tipo} de ${f.patente}: sin umbral en km`);
        assert.equal(typeof f.valor, 'number', `${f.tipo} de ${f.patente}: el valor son los mm`);
      }
    }
  });

  test('Ola 2 · Vehículo (global): Distribución y servicio guarda el servicio con vehiculo_fijar_servicio y el diálogo lo lee al reabrir', async () => {
    const id = vehId(env, 'DEMO010');
    const original = env.sql(`select coalesce(servicio, '') from public.vehiculos where id = ${id}`);
    const desde = env.peticiones.length;
    try {
      await flujo(env, 'servicio-vehiculo', 'global', async p => {
        await abrirDetallePorMatricula(p, 'DEMO010');
        await abrirDistribucion(p);
        await p.eval(`(() => { const s = document.querySelector('#veh-dist-servicio'); s.value = 'bus'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#veh-dist-guardar');
        await p.esperar(`/Servicio guardado/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso Servicio guardado' });
        await p.esperar(`!document.querySelector('#modal-veh-dist').classList.contains('show')`, { que: 'diálogo cerrado tras guardar' });
        await abrirDistribucion(p);
        assert.equal(await p.eval(`document.querySelector('#veh-dist-servicio').value`), 'bus', 'el diálogo muestra el servicio guardado');
        await p.click('[data-action="vehiculo-cambiar-distribucion-cerrar"]');
      });
      assert.equal(rpcsDesde(env, desde, 'vehiculo_fijar_servicio').length, 1, 'el servicio pasa por la RPC, una sola vez');
      assert.equal(env.peticiones.slice(desde).filter(r => r.method === 'PATCH' && r.path.startsWith('/vehiculos')).length, 0, 'sin escritura directa a vehiculos');
      assert.equal(env.sql(`select servicio from public.vehiculos where id = ${id}`), 'bus', 'la base guarda el servicio');
    } finally {
      env.sql(`update public.vehiculos set servicio = ${original ? `'${original}'` : 'null'} where id = ${id}`);
    }
  });

  test('Ola 2 · Alertas (global): el aviso de umbrales dice dónde se ajustan', async () => {
    await flujo(env, 'aviso-umbrales', 'global', async p => {
      await irA(p, 'alertas');
      await p.esperar(`!document.querySelector('#alert-umbral-aviso').hidden`, { que: 'aviso de umbrales visible para el administrador de empresa' });
      assert.equal(await p.eval(`document.querySelector('#alert-umbral-aviso').textContent.trim()`), AVISO_UMBRALES, 'el aviso nombra Empresa > Umbrales');
    });
  });
}
