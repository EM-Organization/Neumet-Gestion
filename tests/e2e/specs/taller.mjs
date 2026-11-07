// Operaciones de taller con RPC reales: rotar y cambiar neumático (con cada rol permitido), rechazo del rol o
// sucursal no autorizado (comprobando el estado de la base después) y odómetro que no baja.
// Estas pruebas MODIFICAN la base de prueba: cada una usa un camión distinto y corren después de las de solo lectura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula, irA, dormir, texto } from '../lib/flujo.mjs';
import { json } from '../lib/verdad.mjs';

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
const neumaticos = (env, id) => json(env, `select posicion, id, idneumatico, estado, marca from public.neumaticos where vehiculo_id = ${id} order by posicion`);
const nEventos = (env, id, tipo) => Number(env.sql(`select count(*) from public.eventos_neumatico where vehiculo_id = ${id}${tipo ? ` and tipo = '${tipo}'` : ''}`));
// Estado completo del vehículo, del stock y de los eventos: para comprobar que un rechazo no cambió NADA.
const foto = (env, id) => env.sql(`select json_build_object(
  'neum', (select json_agg(n order by n.id) from public.neumaticos n where n.vehiculo_id = ${id}),
  'eventos', (select count(*) from public.eventos_neumatico where vehiculo_id = ${id}),
  'odo', (select odometro_km from public.vehiculos where id = ${id}),
  'stock', (select json_agg(s order by s.id) from public.stock_neumaticos s))`);
const rpcsDesde = (env, desde, nombre) => env.peticiones.slice(desde).filter(r => r.path.startsWith(`/rpc/${nombre}`));

// Llama a una RPC con el cliente REAL del panel (supabase-js + sesión de prueba) y devuelve {data, error}.
const rpc = (p, nombre, args) => p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.rpc(${JSON.stringify(nombre)}, ${JSON.stringify(args)})).then(r => ({ data: r.data, error: r.error && { code: r.error.code, message: r.error.message } }))`);

async function seleccionarRueda(p, pos) {
  await p.click(`#vd-diagrama .vd-rueda[data-pos="${pos}"]`);
  await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && document.querySelector('#vd-rotar-btn') && document.querySelector('#vd-rotar-btn').dataset.posicion === '${pos}'`, { que: `panel de la rueda ${pos}` });
}

async function rotarPorUI(p, posA, posB, { confirmar }) {
  await seleccionarRueda(p, posA);
  await p.eval(`(() => { const s = document.querySelector('#vd-rotar-destino'); s.value = '${posB}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await p.click('#vd-rotar-btn');
  if (confirmar) {
    await p.esperar(`document.querySelector('#modal-confirm').classList.contains('show')`, { que: 'confirmación del intercambio' });
    await p.click('#confirm-ok');
  }
  await p.esperar(`/Rotación registrada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de rotación registrada' });
}

export function registrar(env) {
  // ---- Rotar: cada rol permitido, sobre un camión de su alcance --------------------------------------------------
  for (const [rol, patente, a, b, intercambio] of [
    ['global', 'DEMO010', 5, 1, true], ['salto', 'DEMO011', 1, 2, true], ['montevideo', 'DEMO002', 1, 4, true],
    ['admin', 'DEMO001', 3, 9, true], ['global', 'DEMO003', 1, 9, false] // P9 está libre en el camión de 6 neumáticos: mueve sin intercambiar
  ]) {
    test(`Taller (${rol}): rotar P${a} con P${b} de ${patente} por la interfaz queda en la base`, async () => {
      const id = vehId(env, patente);
      const antes = neumaticos(env, id);
      const na = antes.find(n => n.posicion === a), nb = antes.find(n => n.posicion === b);
      assert.ok(na, `${patente} debe tener neumático en P${a}`);
      assert.equal(!!nb, intercambio, `${patente}: P${b} ${intercambio ? 'ocupada' : 'libre'}`);
      const ev0 = nEventos(env, id, 'rotacion');
      await flujo(env, `rotar-${patente}`, rol, async p => {
        await abrirDetallePorMatricula(p, patente);
        await rotarPorUI(p, a, b, { confirmar: intercambio });
      });
      const despues = neumaticos(env, id);
      assert.equal(despues.find(n => n.id === na.id).posicion, b, 'el neumático A quedó en el destino');
      if (nb) assert.equal(despues.find(n => n.id === nb.id).posicion, a, 'el neumático B quedó en el origen');
      else assert.equal(despues.some(n => n.posicion === a), false, 'el origen quedó libre');
      assert.equal(nEventos(env, id, 'rotacion'), ev0 + (intercambio ? 2 : 1), 'eventos de rotación registrados');
    });
  }

  test('Taller (global): tras rotar, el historial muestra la rotación y la rueda crítica sigue al neumático a su nueva posición', async () => {
    // Las mediciones son del NEUMÁTICO: el crítico de DEMO010 estaba en P5 y la rotación 5<->1 lo llevó a P1.
    const id = vehId(env, 'DEMO010');
    const critico = json(env, `select posicion from public.v_estado_neumaticos where vehiculo_id = ${id} and estado = 'critico'`);
    assert.deepEqual(critico, [{ posicion: 1 }]);
    await flujo(env, 'historial-tras-rotar', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO010');
      await seleccionarRueda(p, 1);
      assert.match(await texto(p, '#vd-panel'), /Rotación/);
      assert.match(await p.eval(`document.querySelector('#vd-diagrama .vd-rueda[data-pos="1"]').getAttribute('aria-label')`), /Crítico/);
      assert.doesNotMatch(await p.eval(`document.querySelector('#vd-diagrama .vd-rueda[data-pos="5"]').getAttribute('aria-label')`), /Crítico/);
      assert.equal(await p.eval(`document.querySelectorAll('#vd-diagrama .vd-rueda').length`), 10);
    });
  });

  // ---- Rotar: rechazos -------------------------------------------------------------------------------------------
  for (const [rol, patente] of [['salto', 'DEMO001'], ['montevideo', 'DEMO012'], ['global', 'OTRA001']]) {
    test(`Taller (${rol}): la RPC rechaza rotar ${patente} (fuera de su alcance) y la base no cambia`, async () => {
      const id = vehId(env, patente);
      const antes = foto(env, id);
      const desde = env.peticiones.length;
      await flujo(env, `rotar-denegado-${patente}`, rol, async p => {
        const r = await rpc(p, 'neumatico_rotar', { p_vehiculo_id: id, p_pos_a: 1, p_pos_b: 2, p_odometro_km: null });
        assert.equal(r.error && r.error.code, '42501', 'permiso denegado');
        assert.equal(r.data, null);
      }, { http: [{ ruta: /rpc\/neumatico_rotar/, status: 403 }] });
      assert.equal(foto(env, id), antes, 'la base no debe cambiar');
      assert.equal(rpcsDesde(env, desde, 'neumatico_rotar').length, 1);
    });
  }

  test('Taller (salto): rotar desde la interfaz un camión ajeno no llega a la RPC ni cambia la base', async () => {
    const id = vehId(env, 'DEMO004');
    const antes = foto(env, id);
    const desde = env.peticiones.length;
    await flujo(env, 'rotar-ui-ajeno', 'salto', async p => {
      await p.eval(`import('/assets/js/core/actions.js').then(m => m.ACTIONS['neumatico-rotar-pos'](${id}, 1, 2))`);
      await p.esperar(`/No hay neumático en P1/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de que no hay neumático (la RLS lo oculta)' });
    });
    assert.equal(rpcsDesde(env, desde, 'neumatico_rotar').length, 0);
    assert.equal(foto(env, id), antes);
  });

  test('Taller (sin perfil): un usuario autenticado sin perfil no puede rotar, cambiar ni ver datos', async () => {
    const id = vehId(env, 'DEMO005');
    const antes = foto(env, id);
    await flujo(env, 'sin-perfil', 'sinperfil', async p => {
      const r = await rpc(p, 'neumatico_rotar', { p_vehiculo_id: id, p_pos_a: 1, p_pos_b: 2, p_odometro_km: null });
      assert.equal(r.error && r.error.code, '42501');
      const c = await rpc(p, 'neumatico_cambiar', { p_vehiculo_id: id, p_posicion: 1, p_destino_viejo: 'baja', p_motivo: 'x', p_odometro_km: null, p_stock_id: null, p_nuevo: { marca: 'X' } });
      assert.equal(c.error && c.error.code, '42501');
      const o = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: 1 });
      assert.equal(o.error && o.error.code, '42501');
      assert.equal(await p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.from('vehiculos').select('id')).then(r => r.data.length)`), 0);
    }, { http: [{ ruta: /rpc\/(neumatico_rotar|neumatico_cambiar|vehiculo_registrar_odometro|get_unregistered_devices)/, status: 403 }] });
    assert.equal(foto(env, id), antes);
  });

  // ---- Cambiar neumático -----------------------------------------------------------------------------------------
  test('Taller (global): cambiar P3 de DEMO013 con un neumático del stock deja la base consistente', async () => {
    const id = vehId(env, 'DEMO013');
    const viejo = neumaticos(env, id).find(n => n.posicion === 3);
    const stock = json(env, `select id, marca, modelo, cantidad from public.stock_neumaticos where cantidad > 0 and cliente_id = (select cliente_id from public.vehiculos where id = ${id}) order by id limit 1`)[0];
    assert.ok(viejo && stock, 'el demo debe traer neumático en P3 y stock');
    await flujo(env, 'cambiar-con-stock', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO013');
      await seleccionarRueda(p, 3);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show') && /P3/.test(document.querySelector('#cambio-actual').textContent)`, { que: 'modal de cambio de P3' });
      assert.ok(await p.eval(`!!document.querySelector('input[name="cambio-origen"][value="stock"]')`), 'el perfil global puede elegir del stock');
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="baja"]').click()`);
      await p.eval(`(() => { const m = document.querySelector('#cambio-motivo'); m.value = 'Desgaste E2E'; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await p.eval(`(() => { const s = document.querySelector('#cambio-stock'); s.value = '${stock.id}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await p.esperar(`/sale .* y entra/.test(document.querySelector('#cambio-resumen').textContent)`, { que: 'resumen del cambio' });
      await p.click('#cambio-confirmar');
      await p.esperar(`/Cambio registrado en P3/.test(document.querySelector('#toast-msg').textContent) && !document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'cambio registrado' });
    });
    const despues = neumaticos(env, id);
    const nuevo = despues.find(n => n.posicion === 3);
    assert.equal(nuevo.estado, 'montado');
    assert.equal(nuevo.marca, stock.marca, 'el neumático nuevo sale del lote del stock');
    assert.notEqual(nuevo.id, viejo.id);
    const aparcado = despues.find(n => n.id === viejo.id);
    assert.equal(aparcado.estado, 'baja', 'el viejo quedó dado de baja');
    assert.notEqual(aparcado.posicion, 3);
    assert.equal(Number(env.sql(`select cantidad from public.stock_neumaticos where id = ${stock.id}`)), stock.cantidad - 1, 'el stock bajó una unidad');
    assert.ok(nEventos(env, id, 'baja') >= 1 && nEventos(env, id, 'montaje') >= 1, 'eventos de baja y montaje');
  });

  test('Taller (salto): cambiar P2 de DEMO014 ingresando un neumático nuevo; sin stock en el formulario', async () => {
    const id = vehId(env, 'DEMO014');
    const viejo = neumaticos(env, id).find(n => n.posicion === 2);
    assert.ok(viejo);
    const stockAntes = env.sql(`select json_agg(s order by id) from public.stock_neumaticos s`);
    await flujo(env, 'cambiar-seccional', 'salto', async p => {
      await abrirDetallePorMatricula(p, 'DEMO014');
      await seleccionarRueda(p, 2);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'modal de cambio' });
      assert.equal(await p.eval(`!!document.querySelector('input[name="cambio-origen"][value="stock"]')`), false, 'la sucursal no ve el stock');
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="baja"]').click()`);
      await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; set('#cambio-motivo', 'Pinchazo'); set('#cambio-marca', 'MarcaE2E'); set('#cambio-modelo', 'Modelo X'); })()`);
      await p.click('#cambio-confirmar');
      await p.esperar(`/Cambio registrado en P2/.test(document.querySelector('#toast-msg').textContent)`, { que: 'cambio registrado' });
    });
    const despues = neumaticos(env, id);
    assert.equal(despues.find(n => n.posicion === 2).marca, 'MarcaE2E');
    assert.equal(despues.find(n => n.posicion === 2).estado, 'montado');
    assert.equal(despues.find(n => n.id === viejo.id).estado, 'baja');
    assert.equal(env.sql(`select json_agg(s order by id) from public.stock_neumaticos s`), stockAntes, 'el stock no se toca');
  });

  test('Taller (salto): la RPC rechaza cambiar un camión de Montevideo y que una sucursal use el stock', async () => {
    const ajeno = vehId(env, 'DEMO006'), propio = vehId(env, 'DEMO012');
    const stockId = Number(env.sql(`select id from public.stock_neumaticos where cantidad > 0 order by id limit 1`));
    const antesA = foto(env, ajeno), antesP = foto(env, propio);
    await flujo(env, 'cambiar-denegado', 'salto', async p => {
      const base = { p_destino_viejo: 'baja', p_motivo: 'x', p_odometro_km: null };
      const a = await rpc(p, 'neumatico_cambiar', { ...base, p_vehiculo_id: ajeno, p_posicion: 1, p_stock_id: null, p_nuevo: { marca: 'X' } });
      assert.equal(a.error && a.error.code, '42501');
      const b = await rpc(p, 'neumatico_cambiar', { ...base, p_vehiculo_id: propio, p_posicion: 1, p_stock_id: stockId, p_nuevo: null });
      assert.equal(b.error && b.error.code, '42501');
      assert.match(b.error.message, /stock/);
    }, { http: [{ ruta: /rpc\/neumatico_cambiar/, status: 403 }] });
    assert.equal(foto(env, ajeno), antesA);
    assert.equal(foto(env, propio), antesP);
  });

  test('Taller (montevideo): el modal rechaza un odómetro del vehículo menor al actual sin llamar a la RPC', async () => {
    const id = vehId(env, 'DEMO005');
    const odo = Number(env.sql(`select odometro_km from public.vehiculos where id = ${id}`));
    assert.ok(odo > 1000);
    const antes = foto(env, id);
    const desde = env.peticiones.length;
    await flujo(env, 'cambiar-odometro-menor', 'montevideo', async p => {
      await abrirDetallePorMatricula(p, 'DEMO005');
      await seleccionarRueda(p, 1);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show')`);
      await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; set('#cambio-marca', 'MarcaE2E'); set('#cambio-odo', '${odo - 1}'); })()`);
      await p.click('#cambio-confirmar');
      await p.esperar(`/El odómetro del vehículo no puede ser menor al actual/.test(document.querySelector('#cambio-error').textContent)`, { que: 'error de odómetro menor' });
    });
    assert.equal(rpcsDesde(env, desde, 'neumatico_cambiar').length, 0);
    assert.equal(foto(env, id), antes);
  });

  // ---- Número de quema y km que ya traía el neumático ------------------------------------------------------------
  test('Taller (global): cambio con 0 km previos, quema y sin odómetro; la quema se busca y abre el vehículo', async () => {
    const id = vehId(env, 'DEMO013');
    const odoAntes = env.sql(`select odometro_km from public.vehiculos where id = ${id}`);
    await flujo(env, 'cambiar-con-quema', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO013');
      await seleccionarRueda(p, 4);
      assert.match(await texto(p, '#vd-panel'), /Número de quema Q13-04/, 'el panel muestra la quema del neumático montado');
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show') && /P4/.test(document.querySelector('#cambio-actual').textContent)`, { que: 'modal de cambio de P4' });
      assert.equal(await p.eval(`document.querySelector('#cambio-km-previos').value`), '0', 'los km previos empiezan en 0');
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="baja"]').click()`);
      await p.eval(`document.querySelector('input[name="cambio-origen"][value="nuevo"]').click()`);
      await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; set('#cambio-motivo', 'Desgaste'); set('#cambio-marca', 'MarcaQuema'); set('#cambio-quema', '  E2E-001 '); set('#cambio-km-previos', '0'); })()`);
      await p.esperar(`/quema E2E-001/.test(document.querySelector('#cambio-resumen').textContent)`, { que: 'resumen con la quema' });
      await p.click('#cambio-confirmar');
      await p.esperar(`/Cambio registrado en P4/.test(document.querySelector('#toast-msg').textContent) && !document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'cambio registrado' });
      // El panel de la rueda muestra la quema nueva y 0 km previos
      await seleccionarRueda(p, 4);
      await p.esperar(`/Número de quema\\s+E2E-001/.test(document.querySelector('#vd-panel').innerText)`, { que: 'quema nueva en el panel' });
      assert.match(await texto(p, '#vd-panel'), /Km que ya traía 0 km/);
      // Buscador global: la quema abre el vehículo donde está montado (sin distinguir mayúsculas ni guion)
      await irA(p, 'alertas');
      await p.escribir('#busq-global-input', 'e2e001');
      await p.enter();
      await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /DEMO013/.test(document.querySelector('#vd-cab').innerText)`, { que: 'detalle abierto por quema' });
    });
    assert.deepEqual(json(env, `select numero_quema, km_previos, estado from public.neumaticos where vehiculo_id = ${id} and posicion = 4`), [{ numero_quema: 'E2E-001', km_previos: 0, estado: 'montado' }]);
    assert.equal(env.sql(`select odometro_km from public.vehiculos where id = ${id}`), odoAntes, 'sin odómetro informado, el del vehículo no cambia');
  });

  test('Taller (montevideo): quema repetida y odómetro menor se rechazan en la base sin cambiar nada; 0 km previos es válido', async () => {
    const id = vehId(env, 'DEMO004');
    const odo = Number(env.sql(`select odometro_km from public.vehiculos where id = ${id}`));
    const antes = foto(env, id);
    await flujo(env, 'quema-rechazos', 'montevideo', async p => {
      const base = { p_vehiculo_id: id, p_posicion: 2, p_destino_viejo: 'baja', p_motivo: 'x', p_stock_id: null, p_nuevo: { marca: 'X' } };
      const dup = await rpc(p, 'neumatico_cambiar', { ...base, p_odometro_km: null, p_numero_quema: 'q04-01', p_km_previos: 0 });
      assert.equal(dup.error && dup.error.code, '23505', 'la quema de otro neumático del cliente (otra caja) se rechaza');
      assert.match(dup.error.message, /número de quema ya está registrado/);
      const menor = await rpc(p, 'neumatico_cambiar', { ...base, p_odometro_km: odo - 1, p_numero_quema: null, p_km_previos: 0 });
      assert.equal(menor.error && menor.error.code, '23514');
      assert.match(menor.error.message, /odómetro del vehículo no puede ser menor al actual/);
      const neg = await rpc(p, 'neumatico_cambiar', { ...base, p_odometro_km: null, p_numero_quema: null, p_km_previos: -1 });
      assert.equal(neg.error && neg.error.code, '23514');
    }, { http: [{ ruta: /rpc\/neumatico_cambiar/, status: [400, 409] }] });
    assert.equal(foto(env, id), antes, 'los rechazos no cambiaron nada');
    await flujo(env, 'quema-ok', 'montevideo', async p => {
      const ok = await rpc(p, 'neumatico_cambiar', { p_vehiculo_id: id, p_posicion: 2, p_destino_viejo: 'baja', p_motivo: 'x', p_stock_id: null, p_nuevo: { marca: 'X' }, p_odometro_km: odo, p_numero_quema: 'E2E-002', p_km_previos: 0 });
      assert.equal(ok.error, null);
      assert.equal(ok.data.numero_quema, 'E2E-002');
      assert.equal(ok.data.km_previos, 0);
    });
    assert.deepEqual(json(env, `select numero_quema, km_previos from public.neumaticos where vehiculo_id = ${id} and posicion = 2`), [{ numero_quema: 'E2E-002', km_previos: 0 }]);
  });

  test('Taller (salto): la quema de un neumático de Montevideo no es visible ni buscable', async () => {
    await flujo(env, 'quema-ajena', 'salto', async p => {
      const n = await p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.from('neumaticos').select('numero_quema').like('numero_quema', 'Q04-%')).then(r => r.data.length)`);
      assert.equal(n, 0, 'la RLS oculta los neumáticos de otra sucursal');
    });
  });

  // ---- Odómetro --------------------------------------------------------------------------------------------------
  test('Odómetro: el cliente no puede bajarlo (la base lo rechaza); sí subirlo; el admin puede corregirlo', async () => {
    const id = vehId(env, 'DEMO007');
    const odo = () => Number(env.sql(`select odometro_km from public.vehiculos where id = ${id}`));
    const inicial = odo();
    assert.ok(inicial > 1000);
    await flujo(env, 'odometro-cliente', 'montevideo', async p => {
      const baja = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: inicial - 500 });
      assert.equal(baja.error && baja.error.code, '23514');
      assert.match(baja.error.message, /no puede ser menor/);
      assert.equal(odo(), inicial, 'bajar el odómetro no debe cambiar nada');
      const igual = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: inicial });
      assert.equal(igual.error, null, 'repetir el valor es válido');
      const sube = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: inicial + 700 });
      assert.equal(sube.error, null);
      assert.equal(odo(), inicial + 700);
      const negativo = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: -5 });
      assert.equal(negativo.error && negativo.error.code, '23514');
    }, { http: [{ ruta: /rpc\/vehiculo_registrar_odometro/, status: 400 }] });
    await flujo(env, 'odometro-admin', 'admin', async p => {
      const r = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: inicial - 100 });
      assert.equal(r.error, null, 'el admin puede corregir a la baja (cambio de tablero)');
      assert.equal(odo(), inicial - 100);
    });
    await flujo(env, 'odometro-ajeno', 'salto', async p => {
      const r = await rpc(p, 'vehiculo_registrar_odometro', { p_vehiculo_id: id, p_odometro_km: inicial + 5000 });
      assert.equal(r.error && r.error.code, '42501', 'una sucursal no toca el odómetro de otra');
      assert.equal(odo(), inicial - 100);
    }, { http: [{ ruta: /rpc\/vehiculo_registrar_odometro/, status: 403 }] });
  });

  test('Taller (global): tras los cambios, la interfaz sigue sin errores en Inicio y Alertas', async () => {
    await flujo(env, 'post-taller', 'global', async p => {
      await p.esperar(`document.querySelectorAll('#inicio-contenido .inicio-cifra').length === 4`);
      await p.click('.nav-item[data-view="alertas"]');
      await p.esperar(`/\\d+ alertas?/.test(document.querySelector('#alert-count').textContent)`);
      assert.ok((await texto(p, '#alert-count')).length > 0);
      await dormir(100);
    });
  });
}
