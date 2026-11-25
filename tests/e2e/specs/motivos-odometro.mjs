// Motivos y odómetro de los movimientos con base real (RN-12, RN-14): rotar con un motivo del catálogo y la lectura
// del odómetro, y cambiar a baja con motivo. La base guarda en el evento el código y la lectura que eligió el operario.
// Va al final de la suite: la prueba del odómetro obligatorio deja el cliente como estaba al salir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { json } from '../lib/verdad.mjs';
import { seleccionarRueda } from './taller.mjs';

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
const rpcsDesde = (env, desde, nombre) => env.peticiones.slice(desde).filter(r => r.path.startsWith(`/rpc/${nombre}`));
const maxEvento = (env, id) => Number(env.sql(`select coalesce(max(id), 0) from public.eventos_neumatico where vehiculo_id = ${id}`));

export function registrar(env) {
  test('Taller (global): rotar con motivo y odómetro guarda ambos en el evento; con el odómetro obligatorio, sin lectura no se envía', async () => {
    const id = vehId(env, 'DEMO010');
    const cliente = Number(env.sql(`select cliente_id from public.vehiculos where id = ${id}`));
    const lectura = Number(env.sql(`select odometro_km from public.vehiculos where id = ${id}`)) + 150;
    const maxAntes = maxEvento(env, id);
    const desde = env.peticiones.length;
    env.sql(`update public.clientes set odometro_obligatorio = true where id = ${cliente}`);
    try {
      await flujo(env, 'rotar-motivo-odometro', 'global', async p => {
        await abrirDetallePorMatricula(p, 'DEMO010');
        await seleccionarRueda(p, 1);
        await p.eval(`(() => { const s = document.querySelector('#vd-rotar-destino'); s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#vd-rotar-btn');
        await p.esperar(`document.querySelector('#modal-rotar').classList.contains('show')`, { que: 'diálogo de rotar' });
        await p.eval(`(() => { const m = document.querySelector('#rotar-motivo'); m.value = 'swap_20000'; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#rotar-confirmar');
        await p.esperar(`/Indicar la lectura del odómetro/.test(document.querySelector('#rotar-error').textContent)`, { que: 'error de odómetro obligatorio' });
        assert.equal(rpcsDesde(env, desde, 'neumatico_rotar').length, 0, 'sin lectura no se envía la rotación');
        assert.equal(await p.eval(`document.querySelector('#modal-rotar').classList.contains('show')`), true, 'el diálogo sigue abierto para corregirlo');
        await p.eval(`(() => { const o = document.querySelector('#rotar-odo'); o.value = '${lectura}'; o.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#rotar-confirmar');
        await p.esperar(`/Rotación registrada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'rotación registrada' });
      });
    } finally {
      env.sql(`update public.clientes set odometro_obligatorio = false where id = ${cliente}`);
    }
    assert.equal(rpcsDesde(env, desde, 'neumatico_rotar').length, 1, 'una sola llamada a la RPC, con la lectura');
    const filas = json(env, `select motivo_codigo, motivo_texto, odometro_km from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'rotacion' and id > ${maxAntes} order by id`);
    assert.ok(filas.length >= 1, 'hay eventos de la rotación');
    for (const f of filas) assert.deepEqual(f, { motivo_codigo: 'swap_20000', motivo_texto: null, odometro_km: lectura });
  });

  test('Taller (global): cambiar a baja con motivo del catálogo guarda el código en el evento de baja', async () => {
    const id = vehId(env, 'DEMO013');
    const pos = Number(env.sql(`select min(posicion) from public.neumaticos where vehiculo_id = ${id} and estado = 'montado'`));
    const maxAntes = maxEvento(env, id);
    await flujo(env, 'cambiar-baja-motivo', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO013');
      await seleccionarRueda(p, pos);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'modal de cambio' });
      await p.eval(`document.querySelector('input[name="cambio-origen"][value="nuevo"]').click()`);
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="baja"]').click()`);
      await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; set('#cambio-motivo', 'danio'); set('#cambio-marca', 'MarcaMotivo'); set('#cambio-modelo', 'Modelo M'); })()`);
      await p.click('#cambio-confirmar');
      await p.esperar(`/Cambio registrado/.test(document.querySelector('#toast-msg').textContent)`, { que: 'cambio registrado' });
    });
    const filas = json(env, `select motivo_codigo, motivo_texto from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'baja' and id > ${maxAntes} order by id`);
    assert.ok(filas.length >= 1, 'hay evento de baja');
    for (const f of filas) assert.deepEqual(f, { motivo_codigo: 'danio', motivo_texto: null });
  });
}
