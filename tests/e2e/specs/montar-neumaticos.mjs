// Montar y retirar neumáticos con base real (neumatico_montar / neumatico_desmontar): un coche creado sin neumáticos se
// carga desde el detalle (cubierta del stock y cubierta nueva, posición por posición), se retira un neumático para
// corregir un montaje, la API de proveedor deja de responder «sin_neumaticos», el perfil de sucursal solo opera en su
// sucursal y sin stock, «Otra Empresa SA» no puede tocar nada de Demo Transportes y los montajes simultáneos en la
// misma posición se serializan (uno confirma y el otro falla con error claro).
// Estas pruebas MODIFICAN la base de prueba: usan vehículos y cubiertas propios y corren después de las de solo lectura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { flujo, irA, texto, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';

const RECHAZO = [{ ruta: /rpc\/neumatico_(montar|desmontar)/, status: [400, 403, 404, 409, 500] }];
const sucDemo = (env, nombre) => Number(env.sql(`select id from public.sucursales where cliente_id = ${DEMO} and lower(nombre) = '${nombre.toLowerCase()}'`));

const rpc = (p, nombre, args) => p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.rpc(${JSON.stringify(nombre)}, ${JSON.stringify(args)})).then(r => ({ data: r.data, error: r.error && { code: r.error.code, message: r.error.message } }))`);
const elegir = (p, sel, valor) => p.eval(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(String(valor))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const visible = (p, sel) => p.eval(`!!document.querySelector(${JSON.stringify(sel)}) && document.querySelector(${JSON.stringify(sel)}).getClientRects().length > 0`);

const nuevoVehiculo = (env, patente, { cliente = DEMO, sucursal = null, tipo = 10, odometro = 'null' } = {}) =>
  Number(env.sql(`insert into public.vehiculos (cliente_id, nombre, patente, numero, tipo_ruedas, activo, sucursal_id, odometro_km)
    values (${cliente}, '${patente}', '${patente}', '${patente}', ${tipo}, true, ${sucursal ?? 'null'}, ${odometro}) returning id`).split('\n')[0]);
const nuevaCubierta = (env, quema, { cliente = DEMO, sucursal = null, marca = 'E2EMarca', condicion = 'nuevo' } = {}) =>
  Number(env.sql(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, sucursal_id, numero_quema, marca, modelo, precio_unidad)
    values (null, ${cliente}, null, 'CB-E2EM-${quema}', 'almacenado', '${condicion}', ${sucursal ?? 'null'}, '${quema}', '${marca}', 'Mod', 100) returning id`).split('\n')[0]);
const montados = (env, vid) => json(env, `select posicion, id, idneumatico, estado, condicion, numero_quema, marca, vida, km_previos, auxilio, vehiculo_id, sucursal_id from public.neumaticos where vehiculo_id = ${vid} order by posicion`);
const eventos = (env, vid, tipo) => json(env, `select tipo, posicion_origen, posicion_destino, odometro_km, sucursal_destino_id, notas from public.eventos_neumatico where vehiculo_id = ${vid}${tipo ? ` and tipo = '${tipo}'` : ''} order by id`);
// Foto de lo que un rechazo no debe tocar: neumáticos (con y sin vehículo), eventos y odómetros.
const foto = env => env.sql(`select json_build_object(
  'neum', (select json_agg(n order by n.id) from public.neumaticos n),
  'eventos', (select count(*) from public.eventos_neumatico),
  'odo', (select json_agg(v.odometro_km order by v.id) from public.vehiculos v))`);

const guardarApi = (env, patente, items) => {
  const cli = Number(env.sql(`select ${DEMO}`));
  return JSON.parse(env.sql(`select public.api_guardar_montaje(${cli}, '${randomUUID()}', '${patente}', '${JSON.stringify(items)}'::jsonb, '${randomUUID()}', '${randomUUID()}', 'h-${randomUUID()}')`));
};
const motivos = r => r.resultados.map(x => `${x.posicion}:${x.guardado}:${x.motivo ?? '-'}`).join(',');

async function abrirDetalleDe(p, patente) {
  await abrirDetallePorMatricula(p, patente);
  await p.esperar(`document.querySelector('#vd-cab').textContent.length > 0`, { que: 'cabecera del detalle' });
}
const enEstado = (p, re) => p.esperar(`${re}.test(document.querySelector('#mont-aviso').textContent)`, { que: `aviso ${re}` });
const toast = (p, re) => p.esperar(`${re}.test(document.querySelector('#toast-msg').textContent)`, { que: `aviso ${re}` });

export function registrar(env) {
  test('Montar (global): coche sin neumáticos, estado vacío, montar del stock y cubierta nueva seguidas, retirar y API', async () => {
    const vid = nuevoVehiculo(env, 'E2EM001', { odometro: 1000 });
    const salto = sucDemo(env, 'Salto');
    const s1 = nuevaCubierta(env, 'E2EM-S1', { sucursal: salto }), s2 = nuevaCubierta(env, 'E2EM-S2', { condicion: 'reparado' });
    const items = [1, 2, 3, 4].map(posicion => ({ posicion, mm1: 9, mm2: 9, mm3: 9 }));
    // Antes: la API responde sin_neumaticos
    assert.equal(motivos(guardarApi(env, 'E2EM001', items)), '1:false:sin_neumaticos,2:false:sin_neumaticos,3:false:sin_neumaticos,4:false:sin_neumaticos');

    await flujo(env, 'cargar', 'global', async p => {
      await abrirDetalleDe(p, 'E2EM001');
      // Estado vacío claro con «Cargar neumáticos» y diagrama con las 10 posiciones punteadas
      await p.esperar(`!!document.querySelector('#vd-resumen .vd-vacio')`, { que: 'estado vacío' });
      assert.match(await texto(p, '#vd-resumen'), /Sin neumáticos montados.*Cargar neumáticos/);
      assert.equal(await p.eval(`document.querySelectorAll('#vd-diagrama .vd-vacia').length`), 10);
      assert.equal(await p.eval(`document.querySelectorAll('#vd-diagrama .vd-mm').length`), 0);
      await p.click('#vd-resumen [data-action="neumatico-montar"]');
      await p.esperar(`document.querySelector('#modal-montar').classList.contains('show')`, { que: 'modal de montar' });
      assert.equal(await p.eval(`document.querySelector('#mont-pos').value`), '1', 'empieza en la primera posición libre');
      assert.equal(await p.eval(`document.querySelectorAll('#mont-pos option').length`), 11, '10 ruedas + auxilio');
      assert.equal(await visible(p, '#mont-tab-stock'), true);
      // La lista del stock trae solo cubiertas del cliente (no las de Otra Empresa SA); el buscador filtra por quema
      const lista = () => p.eval(`[...document.querySelectorAll('#mont-lista .mont-fila .mont-quema')].map(e => e.textContent.trim())`);
      const todas = await lista();
      assert.ok(todas.includes('E2EM-S1') && todas.includes('E2EM-S2'));
      assert.equal(todas.includes('OTRA-Q1'), false);
      assert.equal(await p.eval(`/MarcaAjena/.test(document.querySelector('#mont-lista').textContent)`), false);
      await p.escribir('#mont-buscar', 'e2em s1');
      await p.esperar(`document.querySelectorAll('#mont-lista .mont-fila').length === 1`, { que: 'una cubierta filtrada' });
      assert.deepEqual(await lista(), ['E2EM-S1']);
      await p.click('#mont-lista input[name="mont-cubierta"]');
      await p.esperar(`/^P1: entra cubierta E2EM-S1/.test(document.querySelector('#mont-resumen').textContent)`, { que: 'resumen' });
      await p.click('#mont-confirmar');
      await enEstado(p, /Montado en P1\. Siguiente posición libre: P2/);
      assert.equal(await p.eval(`document.querySelector('#mont-pos').value`), '2', 'ofrece la siguiente libre sin cerrar el flujo');
      assert.equal(await p.eval(`document.querySelector('#modal-montar').classList.contains('show')`), true);
      // Cubierta nueva en P2 (con quema, km previos, vida y odómetro)
      await p.click('#mont-tab-nuevo');
      await p.escribir('#mont-marca', 'Goodyear'); await p.escribir('#mont-modelo', 'G661'); await p.escribir('#mont-quema', 'E2EM-N1');
      await p.escribir('#mont-km-previos', '1500'); await elegir(p, '#mont-vida', 1); await p.escribir('#mont-odo', '2500');
      await p.click('#mont-confirmar');
      await enEstado(p, /Montado en P2\. Siguiente posición libre: P3/);
      // Otra del stock en P3 (reparada) y terminar
      await p.click('#mont-tab-stock');
      await p.escribir('#mont-buscar', 'E2EM-S2');
      await p.esperar(`document.querySelectorAll('#mont-lista .mont-fila').length === 1`, { que: 'S2 filtrada' });
      await p.click('#mont-lista input[name="mont-cubierta"]');
      await p.click('#mont-confirmar');
      await enEstado(p, /Montado en P3\. Siguiente posición libre: P4/);
      await p.click('#mont-cerrar');
      await p.esperar(`!document.querySelector('#modal-montar').classList.contains('show') && /3 neumáticos/.test(document.querySelector('#vd-resumen').textContent)`, { que: 'detalle con 3 neumáticos' });
      assert.equal(await p.eval(`document.querySelectorAll('#vd-diagrama .vd-vacia').length`), 7);
      assert.equal(await p.eval(`!!document.querySelector('#vd-resumen .vd-vacio')`), false, 'ya no hay estado vacío');
    }, { http: RECHAZO });

    const m = montados(env, vid);
    assert.deepEqual(m.map(x => [x.posicion, x.estado, x.condicion, x.numero_quema]), [[1, 'montado', 'usado', 'E2EM-S1'], [2, 'montado', 'recauchutado', 'E2EM-N1'], [3, 'montado', 'reparado', 'E2EM-S2']]);
    assert.equal(m[0].id, s1, 'la cubierta del stock es la misma fila (Nuevo -> Usado)');
    assert.equal(m[0].idneumatico, 'CB-E2EM-E2EM-S1');
    assert.equal(m[2].id, s2);
    assert.match(m[1].idneumatico, /^CN-\d+-2-[0-9a-f]{8}$/, 'la cubierta nueva recibe un idneumatico único');
    assert.deepEqual([m[1].marca, m[1].vida, m[1].km_previos, m[1].auxilio], ['Goodyear', 1, 1500, false]);
    const ev = eventos(env, vid, 'montaje');
    assert.deepEqual(ev.map(e => [e.posicion_destino, e.odometro_km]), [[1, null], [2, 2500], [3, null]]);
    assert.equal(Number(env.sql(`select odometro_km from public.vehiculos where id = ${vid}`)), 2500, 'el odómetro sube con el montaje');
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where numero_quema = 'E2EM-S1'`)), 1, 'sin duplicar la cubierta');

    // Después: la API deja de responder sin_neumaticos para las posiciones montadas
    const med = () => Number(env.sql('select count(*) from public.mediciones'));
    const m0 = med();
    assert.equal(motivos(guardarApi(env, 'E2EM001', items)), '1:true:-,2:true:-,3:true:-,4:false:posicion');
    assert.equal(med(), m0 + 3, 'las 3 mediciones quedaron guardadas');
    assert.equal(Number(env.sql(`select count(*) from public.mediciones where idneumatico = 'CB-E2EM-E2EM-S1'`)), 1, 'la medición es de la cubierta (misma quema)');

    // Retirar: S1 vuelve al stock (Salto) y el neumático nuevo sale de baja, desde el panel de cada rueda
    await flujo(env, 'retirar', 'global', async p => {
      await abrirDetalleDe(p, 'E2EM001');
      await p.click('#vd-diagrama .vd-rueda[data-pos="1"]');
      await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && !!document.querySelector('#vd-panel [data-action="neumatico-retirar"]')`, { que: 'panel con «Retirar neumático»' });
      await p.click('#vd-panel [data-action="neumatico-retirar"]');
      await p.esperar(`document.querySelector('#modal-retirar').classList.contains('show') && /E2EM-S1/.test(document.querySelector('#ret-actual').textContent)`, { que: 'modal de retirar P1' });
      assert.equal(await p.eval(`[...document.querySelectorAll('input[name="ret-destino"]')].map(i => i.value).join()`), 'almacenado,reparacion,baja');
      assert.equal(await visible(p, '#ret-quema-wrap'), false, 'tiene quema: no la pide');
      await elegir(p, '#ret-suc', salto);
      await p.click('#ret-confirmar');
      await toast(p, /Neumático retirado de P1/);
      await p.esperar(`!!document.querySelector('#vd-diagrama .vd-vacia[data-pos="1"]') && !document.querySelector('#vd-panel').classList.contains('abierto')`, { que: 'P1 vacía y panel cerrado' });
      // P2 (cubierta nueva): baja con motivo obligatorio
      await p.click('#vd-diagrama .vd-rueda[data-pos="2"]');
      await p.esperar(`!!document.querySelector('#vd-panel [data-action="neumatico-retirar"]')`, { que: 'panel de P2' });
      await p.click('#vd-panel [data-action="neumatico-retirar"]');
      await p.esperar(`document.querySelector('#modal-retirar').classList.contains('show')`, { que: 'modal de retirar P2' });
      await p.eval(`document.querySelector('input[name="ret-destino"][value="baja"]').click()`);
      await p.click('#ret-confirmar');
      await p.esperar(`/Falta el motivo de la baja/.test(document.querySelector('#ret-error').textContent)`, { que: 'motivo obligatorio' });
      await p.escribir('#ret-motivo', 'Montaje equivocado');
      await p.click('#ret-confirmar');
      await toast(p, /Neumático retirado de P2/);
      await p.esperar(`!!document.querySelector('#vd-diagrama .vd-vacia[data-pos="2"]')`, { que: 'P2 vacía' });
    }, { http: RECHAZO });

    const v = json(env, `select vehiculo_id, posicion, estado, condicion, sucursal_id, numero_quema, idneumatico from public.neumaticos where id = ${s1}`)[0];
    assert.deepEqual(v, { vehiculo_id: null, posicion: null, estado: 'almacenado', condicion: 'usado', sucursal_id: salto, numero_quema: 'E2EM-S1', idneumatico: 'CB-E2EM-E2EM-S1' });
    assert.equal(Number(env.sql(`select count(*) from public.mediciones where idneumatico = 'CB-E2EM-E2EM-S1'`)), 1, 'el historial de mediciones se conserva');
    assert.deepEqual(json(env, `select tipo from public.eventos_neumatico where neumatico_id = ${s1} order by id`).map(e => e.tipo), ['montaje', 'desmontaje']);
    const baja = json(env, `select estado, motivo_baja, posicion, auxilio from public.neumaticos where vehiculo_id = ${vid} and numero_quema = 'E2EM-N1'`)[0];
    assert.deepEqual(baja, { estado: 'baja', motivo_baja: 'Montaje equivocado', posicion: 98, auxilio: false });
    assert.deepEqual(eventos(env, vid, 'baja').map(e => [e.posicion_origen, e.notas]), [[2, 'Retiro sin reemplazo: Montaje equivocado']]);
    assert.deepEqual(montados(env, vid).filter(x => x.estado === 'montado').map(x => x.posicion), [3]);
  });

  test('Montar (global): alta de vehículo con «Cargar neumáticos ahora» lleva al detalle vacío', async () => {
    await flujo(env, 'alta-cargar', 'global', async p => {
      await irA(p, 'sucursales');
      await p.esperar(`document.querySelectorAll('#suc-vehiculos tr[data-vehiculo]').length > 0`, { que: 'vista Sucursales cargada' });
      assert.equal(await p.eval(`document.querySelector('#suc-veh-cargar').checked`), false, 'la opción empieza desmarcada');
      await p.escribir('#suc-veh-numero', '8801');
      await p.escribir('#suc-veh-patente', 'e2e 8801');
      await p.eval(`document.querySelector('#suc-veh-cargar').click()`);
      await p.click('[data-action="sucursalVehiculoCrear"]');
      await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /Coche 8801/.test(document.querySelector('#vd-cab').textContent) && !!document.querySelector('#vd-resumen .vd-vacio')`, { que: 'detalle del vehículo nuevo, vacío' });
      assert.match(await texto(p, '#vd-volver'), /Volver a Sucursales/);
      assert.match(await texto(p, '#vd-resumen'), /Cargar neumáticos/);
    }, { http: RECHAZO });
    const v = json(env, `select id, nombre, tipo_ruedas, cliente_id from public.vehiculos where patente = 'e2e 8801'`)[0];
    assert.deepEqual([v.nombre, v.tipo_ruedas], ['Coche 8801', 10]);
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where vehiculo_id = ${v.id}`)), 0);
    // Sin marcar la opción, el alta no navega
    await flujo(env, 'alta-sin-cargar', 'global', async p => {
      await irA(p, 'sucursales');
      await p.esperar(`document.querySelectorAll('#suc-vehiculos tr[data-vehiculo]').length > 0`, { que: 'vista Sucursales cargada' });
      await p.escribir('#suc-veh-numero', '8802');
      await p.click('[data-action="sucursalVehiculoCrear"]');
      await p.esperar(`/Coche 8802/.test(document.querySelector('#suc-vehiculos').textContent)`, { que: 'vehículo en el listado' });
      assert.equal(await p.eval(`document.querySelector('#view-sucursales').classList.contains('active')`), true);
    });
  });

  for (const rol of ['salto', 'montevideo']) {
    test(`Montar (${rol}): el perfil de sucursal monta ingresando a mano en su sucursal, sin stock, y no toca otras`, async () => {
      const propia = sucDemo(env, rol), otra = sucDemo(env, rol === 'salto' ? 'montevideo' : 'salto');
      const patente = `E2EM-${rol.slice(0, 3).toUpperCase()}1`.replace('-', '');
      const mia = nuevoVehiculo(env, patente, { sucursal: propia }), ajena = nuevoVehiculo(env, `E2EA${rol.slice(0, 3).toUpperCase()}`, { sucursal: otra });
      const cub = nuevaCubierta(env, `E2EM-${rol}-S`, { sucursal: propia });
      nuevoVehiculo(env, `E2ET${rol.slice(0, 3).toUpperCase()}`, { sucursal: propia }); // para el montaje por interfaz
      const antes = foto(env);
      await flujo(env, 'sin-stock', rol, async p => {
        // RPC directas: cubierta del stock y vehículo de otra sucursal -> 42501; la base no cambia
        const r = await Promise.all([
          rpc(p, 'neumatico_montar', { p_vehiculo_id: mia, p_posicion: 1, p_cubierta_id: cub }),
          rpc(p, 'neumatico_montar', { p_vehiculo_id: ajena, p_posicion: 1, p_nuevo: { marca: 'Hack' } }),
          rpc(p, 'neumatico_desmontar', { p_vehiculo_id: ajena, p_posicion: 1, p_destino: 'baja', p_motivo: 'x' }),
        ]);
        for (const x of r) assert.equal(x.error && x.error.code, '42501', JSON.stringify(x));
      }, { http: RECHAZO });
      assert.equal(foto(env), antes, 'los rechazos no cambiaron nada');
      // Por interfaz: sin pestaña «Del stock»; monta una cubierta nueva y la retira a baja
      const pat = `E2ET${rol.slice(0, 3).toUpperCase()}`;
      await flujo(env, 'montar-nueva', rol, async p => {
        await abrirDetalleDe(p, pat);
        await p.esperar(`!!document.querySelector('#vd-resumen .vd-vacio')`, { que: 'estado vacío' });
        await p.click('#vd-resumen [data-action="neumatico-montar"]');
        await p.esperar(`document.querySelector('#modal-montar').classList.contains('show')`, { que: 'modal de montar' });
        assert.equal(await visible(p, '#mont-tab-stock'), false, 'el perfil de sucursal no usa el stock');
        assert.equal(await visible(p, '#mont-panel-nuevo'), true, 'empieza en «Cubierta nueva»');
        await p.escribir('#mont-marca', 'Pirelli');
        await p.click('#mont-confirmar');
        await enEstado(p, /Montado en P1\. Siguiente posición libre: P2/);
        await p.click('#mont-cerrar');
        await p.esperar(`/1 neumático/.test(document.querySelector('#vd-resumen').textContent) && !document.querySelector('#modal-montar').classList.contains('show')`, { que: 'detalle con 1 neumático' });
        // Retirar: sin «Stock» entre los destinos
        await p.click('#vd-diagrama .vd-rueda[data-pos="1"]');
        await p.esperar(`!!document.querySelector('#vd-panel [data-action="neumatico-retirar"]')`, { que: 'panel de P1' });
        await p.click('#vd-panel [data-action="neumatico-retirar"]');
        await p.esperar(`document.querySelector('#modal-retirar').classList.contains('show')`, { que: 'modal de retirar' });
        assert.equal(await p.eval(`[...document.querySelectorAll('input[name="ret-destino"]')].map(i => i.value).join()`), 'reparacion,baja');
        await p.eval(`document.querySelector('input[name="ret-destino"][value="reparacion"]').click()`);
        await p.click('#ret-confirmar');
        await toast(p, /Neumático retirado de P1/);
      }, { http: RECHAZO });
      const vid = Number(env.sql(`select id from public.vehiculos where patente = '${pat}'`));
      const filas = montados(env, vid);
      assert.deepEqual(filas.map(x => [x.estado, x.condicion, x.marca]), [['reparacion', 'reparado', 'Pirelli']]);
      assert.equal(filas[0].posicion, 98);
      assert.equal(Number(env.sql(`select count(*) from public.neumaticos where id = ${cub} and vehiculo_id is null and estado = 'almacenado'`)), 1, 'la cubierta del stock sigue en stock');
    });
  }

  test('Montar (Otra Empresa SA): no monta, retira ni usa nada de Demo Transportes; la quema es única por cliente', async () => {
    const vid = Number(env.sql(`select id from public.vehiculos where patente = 'E2EM001'`));
    const cubDemo = Number(env.sql(`select id from public.neumaticos where numero_quema = 'E2EM-S1'`));
    const propio = Number(env.sql(`select id from public.vehiculos where patente = 'OTRA001'`));
    const antes = foto(env);
    await flujo(env, 'ajeno', 'otra', async p => {
      const r = await Promise.all([
        rpc(p, 'neumatico_montar', { p_vehiculo_id: vid, p_posicion: 5, p_nuevo: { marca: 'Hack' } }),
        rpc(p, 'neumatico_montar', { p_vehiculo_id: vid, p_posicion: 6, p_cubierta_id: cubDemo }),
        rpc(p, 'neumatico_desmontar', { p_vehiculo_id: vid, p_posicion: 3, p_destino: 'baja', p_motivo: 'x' }),
        rpc(p, 'neumatico_desmontar', { p_vehiculo_id: 99999999, p_posicion: 3, p_destino: 'baja', p_motivo: 'x' }),
      ]);
      for (const x of r) assert.equal(x.error && x.error.code, '42501', JSON.stringify(x));
      // En su propio vehículo: la cubierta de Demo no existe para ella y su quema 'S-001' ya está en su stock
      const c = await rpc(p, 'neumatico_montar', { p_vehiculo_id: propio, p_posicion: 5, p_cubierta_id: cubDemo });
      assert.equal(c.error && c.error.code, 'P0002');
      assert.match(c.error.message, /cubierta del stock inexistente o ya montada/);
      const q = await rpc(p, 'neumatico_montar', { p_vehiculo_id: propio, p_posicion: 5, p_nuevo: { marca: 'X', numero_quema: 's-001' } });
      assert.equal(q.error && q.error.code, '23505');
      // El detalle de un vehículo de Demo no existe para ella
      const ver = await p.eval(`fetch('/rest/v1/neumaticos?select=id&vehiculo_id=eq.${vid}', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } }).then(r => r.json())`);
      assert.deepEqual(ver, []);
    }, { http: RECHAZO });
    assert.equal(foto(env), antes, 'ninguna escritura de Otra Empresa SA cambió la base');
  });

  test('Montar (global): dos montajes simultáneos en la misma posición: uno confirma y el otro falla con error claro', async () => {
    const vid = nuevoVehiculo(env, 'E2EM005');
    let r;
    await flujo(env, 'misma-posicion', 'global', async p => {
      r = await p.eval(`import('/assets/js/core/supabase.js').then(m => Promise.all(['Primero', 'Segundo', 'Tercero'].map(marca => m.db.rpc('neumatico_montar', { p_vehiculo_id: ${vid}, p_posicion: 1, p_nuevo: { marca } }))))
        .then(rs => rs.map(x => ({ ok: !x.error, code: x.error && x.error.code, message: x.error && x.error.message })))`);
    }, { http: RECHAZO });
    assert.equal(r.filter(x => x.ok).length, 1, JSON.stringify(r));
    for (const f of r.filter(x => !x.ok)) { assert.equal(f.code, '55000'); assert.match(f.message, /la posición 1 ya tiene un neumático/); }
    assert.equal(montados(env, vid).length, 1, 'un solo neumático en la posición');
    assert.equal(eventos(env, vid, 'montaje').length, 1, 'un solo evento de montaje');
  });

  test('Montar (global): la misma cubierta del stock en dos vehículos a la vez: uno confirma y el otro falla sin duplicar stock', async () => {
    const v1 = nuevoVehiculo(env, 'E2EM006'), v2 = nuevoVehiculo(env, 'E2EM007');
    const cub = nuevaCubierta(env, 'E2EM-S3');
    let r;
    await flujo(env, 'misma-cubierta', 'global', async p => {
      r = await p.eval(`import('/assets/js/core/supabase.js').then(m => Promise.all([${v1}, ${v2}].map(v => m.db.rpc('neumatico_montar', { p_vehiculo_id: v, p_posicion: 1, p_cubierta_id: ${cub} }))))
        .then(rs => rs.map(x => ({ ok: !x.error, code: x.error && x.error.code, message: x.error && x.error.message })))`);
    }, { http: RECHAZO });
    assert.equal(r.filter(x => x.ok).length, 1, JSON.stringify(r));
    const fallo = r.find(x => !x.ok);
    assert.equal(fallo.code, 'P0002');
    assert.match(fallo.message, /cubierta del stock inexistente o ya montada/);
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where numero_quema = 'E2EM-S3' and cliente_id = ${DEMO}`)), 1, 'sin duplicar la cubierta');
    assert.equal(Number(env.sql(`select count(*) from public.eventos_neumatico where neumatico_id = ${cub} and tipo = 'montaje'`)), 1);
    assert.equal(montados(env, v1).length + montados(env, v2).length, 1);
  });

  test('Montar (admin): puede montar y retirar en cualquier vehículo; las posiciones inexistentes se rechazan', async () => {
    const vid = nuevoVehiculo(env, 'E2EM008', { tipo: 16 });
    await flujo(env, 'admin', 'admin', async p => {
      const ok = await rpc(p, 'neumatico_montar', { p_vehiculo_id: vid, p_posicion: 16, p_nuevo: { marca: 'Adm' } });
      assert.equal(ok.error, null, JSON.stringify(ok));
      const aux = await rpc(p, 'neumatico_montar', { p_vehiculo_id: vid, p_posicion: 99, p_nuevo: { marca: 'Aux' } });
      assert.equal(aux.error, null);
      const fuera = await rpc(p, 'neumatico_montar', { p_vehiculo_id: vid, p_posicion: 17, p_nuevo: { marca: 'X' } });
      assert.equal(fuera.error && fuera.error.code, '23514');
      const ocupada = await rpc(p, 'neumatico_montar', { p_vehiculo_id: vid, p_posicion: 16, p_nuevo: { marca: 'X' } });
      assert.equal(ocupada.error && ocupada.error.code, '55000');
      const out = await rpc(p, 'neumatico_desmontar', { p_vehiculo_id: vid, p_posicion: 99, p_destino: 'reparacion' });
      assert.equal(out.error, null);
    }, { http: RECHAZO });
    assert.deepEqual(montados(env, vid).map(x => [x.posicion, x.estado, x.auxilio]), [[16, 'montado', false], [98, 'reparacion', false]]);
  });
}
