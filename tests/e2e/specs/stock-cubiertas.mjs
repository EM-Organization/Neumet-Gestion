// Stock de cubiertas individuales con base real: lista contra la base, alta/edición/traslado/eliminación por la interfaz
// (perfil global y admin), montar una cubierta y devolver el neumático retirado al stock conservando su historial,
// montajes simultáneos de la misma cubierta y aislamiento estricto: la sucursal no ve ni gestiona el stock y
// «Otra Empresa SA» no ve ni toca el de Demo Transportes.
// Estas pruebas MODIFICAN la base de prueba y corren después de las de solo lectura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, texto, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';

const OTRA = `(select id from public.clientes where nombre = 'Otra Empresa SA')`;
const RECHAZO = [{ ruta: /rpc\/(stock_cubierta_|neumatico_cambiar)/, status: [400, 403, 404, 409, 500] }];
const ETQ = { nuevo: 'Nuevo', usado: 'Usado', reparado: 'Reparado', recauchutado: 'Recauchutado' };

const cubiertas = (env, donde = 'true') => json(env, `select n.id, n.cliente_id, n.numero_quema, n.marca, n.modelo, n.condicion, n.estado, n.vehiculo_id, n.posicion, n.sucursal_id,
  n.idneumatico, coalesce(s.nombre, 'Sin sucursal') ubicacion from public.neumaticos n left join public.sucursales s on s.id = n.sucursal_id
  where n.vehiculo_id is null and ${donde} order by n.numero_quema`);
const unaCubierta = (env, quema, cliente = DEMO) => cubiertas(env, `n.cliente_id = ${cliente} and n.numero_quema = '${quema}'`)[0];
// Sucursal de «Otra Empresa SA» (la crea si todavía no tiene ninguna: sus pruebas de sucursales corren antes y pueden haberla creado).
const sucOtra = env => {
  const id = env.sql(`select id from public.sucursales where cliente_id = ${OTRA} order by id limit 1`);
  if (id) return { id: Number(id), nombre: env.sql(`select nombre from public.sucursales where id = ${id}`) };
  return { id: Number(env.sql(`insert into public.sucursales (cliente_id, nombre) values (${OTRA}, 'Norte Otra') returning id`)), nombre: 'Norte Otra' };
};
const sucId = (env, nombre, cliente = DEMO) => Number(env.sql(`select id from public.sucursales where cliente_id = ${cliente} and nombre = '${nombre}'`));
const nEventos = (env, id, tipo) => Number(env.sql(`select count(*) from public.eventos_neumatico where neumatico_id = ${id}${tipo ? ` and tipo = '${tipo}'` : ''}`));
// Foto de TODO el stock, sus eventos y su auditoría: un rechazo no debe cambiar nada.
const foto = env => env.sql(`select json_build_object(
  'cub', (select json_agg(n order by n.id) from public.neumaticos n where n.vehiculo_id is null),
  'eventos', (select count(*) from public.eventos_neumatico),
  'auditoria', (select count(*) from public.audit_log where accion like 'STOCK_CUBIERTA%' or (accion = 'MOVER_SUCURSAL' and entidad = 'neumaticos')),
  'neum', (select count(*) from public.neumaticos))`);

const rpc = (p, nombre, args) => p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.rpc(${JSON.stringify(nombre)}, ${JSON.stringify(args)})).then(r => ({ data: r.data, error: r.error && { code: r.error.code, message: r.error.message } }))`);
const leerApi = (p, ruta) => p.eval(`fetch('/rest/v1/${ruta}', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } }).then(r => r.json())`);
const elegir = (p, sel, valor) => p.eval(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(String(valor))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const poner = (p, sel, valor) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(String(valor))}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const toast = (p, re) => p.esperar(`${re}.test(document.querySelector('#toast-msg').textContent)`, { que: `aviso ${re}` });
const quemasUI = p => p.eval(`[...document.querySelectorAll('#stk-lista .stk-fila')].map(f => f.querySelector('.stk-quema').firstChild.textContent.trim())`);

async function abrirStock(p, n) {
  await irA(p, 'stock');
  await p.esperar(n === 0 ? `/Sin cubiertas en stock/.test(document.querySelector('#stk-lista').innerText)`
    : `document.querySelectorAll('#stk-lista .stk-fila').length === ${n}`, { que: `${n} cubiertas en la lista de Stock` });
}
async function seleccionarRueda(p, pos) {
  await p.click(`#vd-diagrama .vd-rueda[data-pos="${pos}"]`);
  await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && document.querySelector('#vd-rotar-btn') && document.querySelector('#vd-rotar-btn').dataset.posicion === '${pos}'`, { que: `panel de la rueda ${pos}` });
}

export function registrar(env) {
  // ---- Lectura: cada rol ve lo suyo --------------------------------------------------------------------------------
  test('Stock (global): la lista coincide con las cubiertas del cliente en la base y no incluye las de otro cliente', async () => {
    const esperadas = cubiertas(env, `n.cliente_id = ${DEMO}`);
    assert.equal(esperadas.length, 12, 'el demo trae 12 cubiertas individuales');
    await flujo(env, 'lista', 'global', async p => {
      await abrirStock(p, esperadas.length);
      const ui = await p.eval(`[...document.querySelectorAll('#stk-lista .stk-fila')].map(f => ({
        quema: f.querySelector('.stk-quema').firstChild.textContent.trim(), cond: f.querySelector('.badge').textContent.trim(),
        ubic: f.querySelector('.stk-loc').textContent.trim(), marca: f.querySelector('.stk-desc').firstChild.textContent.trim() }))`);
      assert.deepEqual(ui, esperadas.map(c => ({ quema: c.numero_quema, cond: ETQ[c.condicion], ubic: c.ubicacion, marca: c.marca })));
      const t = await texto(p, '#view-stock');
      assert.doesNotMatch(t, /MarcaAjena|OTRA-Q1|Modelo Z/);
      assert.match(t, /12 cubiertas · Nuevo 6 · Usado 2 · Reparado 2 · Recauchutado 2/);
      assert.equal(await p.eval(`!!document.querySelector('#btn-cubierta-nueva').offsetParent`), true, 'el perfil global puede agregar');
      assert.equal(await p.eval(`!!document.querySelector('#filter-cliente-stock').offsetParent`), false, 'sin filtro de cliente');
      assert.equal(await p.eval(`!!document.querySelector('#sec-selector').offsetParent`), false, 'el selector de vehículos no se muestra en Stock');
      // Filtros contra la base
      await elegir(p, '#filter-condicion-stock', 'reparado');
      assert.deepEqual(await quemasUI(p), esperadas.filter(c => c.condicion === 'reparado').map(c => c.numero_quema));
      await elegir(p, '#filter-condicion-stock', '');
      await elegir(p, '#filter-sucursal-stock', 'ninguna');
      assert.deepEqual(await quemasUI(p), esperadas.filter(c => c.sucursal_id === null).map(c => c.numero_quema));
      await elegir(p, '#filter-sucursal-stock', sucId(env, 'Salto'));
      assert.deepEqual(await quemasUI(p), esperadas.filter(c => c.ubicacion === 'Salto').map(c => c.numero_quema));
      await elegir(p, '#filter-sucursal-stock', '');
      await poner(p, '#search-stock', 's-00');
      assert.deepEqual(await quemasUI(p), esperadas.filter(c => /^S-00/i.test(c.numero_quema)).map(c => c.numero_quema));
      await poner(p, '#search-stock', 'Pirelli');
      assert.deepEqual(await quemasUI(p), esperadas.filter(c => c.marca === 'Pirelli').map(c => c.numero_quema));
    });
  });

  test('Stock (admin): ve las cubiertas de todos los clientes y filtra por cliente', async () => {
    const todas = cubiertas(env);
    const otras = cubiertas(env, `n.cliente_id = ${OTRA}`);
    assert.equal(otras.length, 2);
    await flujo(env, 'lista-admin', 'admin', async p => {
      await abrirStock(p, todas.length);
      assert.equal(await p.eval(`!!document.querySelector('#filter-cliente-stock').offsetParent`), true);
      await elegir(p, '#filter-cliente-stock', otras[0].cliente_id);
      await p.esperar(`document.querySelectorAll('#stk-lista .stk-fila').length === ${otras.length}`, { que: 'solo las del cliente ajeno' });
      assert.deepEqual((await quemasUI(p)).sort(), otras.map(c => c.numero_quema).sort());
      assert.match(await texto(p, '#stk-lista'), /Otra Empresa SA/);
    });
  });

  for (const rol of ['salto', 'montevideo']) {
    test(`Stock (${rol}): el perfil de sucursal no ve cubiertas ni puede gestionarlas`, async () => {
      const antes = foto(env);
      const cub = unaCubierta(env, 'S-005');
      await flujo(env, 'sucursal-sin-stock', rol, async p => {
        await abrirStock(p, 0);
        assert.equal(await p.eval(`!!document.querySelector('#btn-cubierta-nueva').offsetParent`), false, 'sin botón de alta');
        assert.equal(await p.eval(`document.querySelectorAll('#stk-lista [data-action^="cubierta"]').length`), 0);
        assert.equal(await p.eval(`!!document.querySelector('#stock-lotes').offsetParent`), false, 'sin lotes');
        // API directa: ninguna cubierta (neumáticos sin vehículo) ni sus eventos
        assert.deepEqual(await leerApi(p, 'neumaticos?select=id&vehiculo_id=is.null'), []);
        assert.deepEqual(await leerApi(p, 'eventos_neumatico?select=id&vehiculo_id=is.null'), []);
        // Escrituras: rechazadas con 42501
        const intentos = [
          rpc(p, 'stock_cubierta_agregar', { p_numero_quema: 'SUC-1', p_marca: 'X' }),
          rpc(p, 'stock_cubierta_editar', { p_id: cub.id, p_datos: { marca: 'Hack' } }),
          rpc(p, 'stock_cubierta_mover', { p_id: cub.id, p_sucursal_id: null }),
          rpc(p, 'stock_cubierta_eliminar', { p_id: cub.id })
        ];
        for (const r of await Promise.all(intentos)) assert.equal(r.error && r.error.code, '42501');
        // El buscador no revela quemas del stock
        await irA(p, 'alertas');
        await p.escribir('#busq-global-input', 'S-005');
        await p.enter();
        await p.esperar(`/Ningún vehículo coincide/.test(document.querySelector('#busq-global-res').innerText)`, { que: 'sin resultados para una quema de stock' });
      }, { http: RECHAZO });
      assert.equal(foto(env), antes, 'la base no cambió');
    });
  }

  test('Stock (otra): solo ve su stock; las RPC sobre cubiertas de Demo Transportes se rechazan y la base no cambia', async () => {
    const mias = cubiertas(env, `n.cliente_id = ${OTRA}`);
    const demo = unaCubierta(env, 'S-005');
    const sucDemo = sucId(env, 'Salto');
    const sucMia = sucOtra(env).id;
    const vehMio = Number(env.sql(`select id from public.vehiculos where patente = 'OTRA001'`));
    const antes = foto(env);
    await flujo(env, 'aislamiento-otra', 'otra', async p => {
      await abrirStock(p, mias.length);
      assert.deepEqual((await quemasUI(p)).sort(), mias.map(c => c.numero_quema).sort());
      assert.doesNotMatch(await texto(p, '#view-stock'), /Michelin|Pirelli|Montevideo|Salto/);
      const api = await leerApi(p, 'neumaticos?select=id,cliente_id&vehiculo_id=is.null');
      assert.deepEqual(api.map(c => c.id).sort(), mias.map(c => c.id).sort());
      assert.deepEqual(await leerApi(p, `neumaticos?select=id&id=eq.${demo.id}`), []);
      const r = await Promise.all([
        rpc(p, 'stock_cubierta_editar', { p_id: demo.id, p_datos: { marca: 'Hack' } }),
        rpc(p, 'stock_cubierta_mover', { p_id: demo.id, p_sucursal_id: sucMia }),
        rpc(p, 'stock_cubierta_eliminar', { p_id: demo.id }),
        rpc(p, 'stock_cubierta_agregar', { p_numero_quema: 'X-HACK', p_marca: 'X', p_cliente_id: Number(env.sql(`select ${DEMO}`)) }),
        rpc(p, 'stock_cubierta_agregar', { p_numero_quema: 'X-HACK2', p_marca: 'X', p_sucursal_id: sucDemo }),
        rpc(p, 'stock_cubierta_mover', { p_id: mias[0].id, p_sucursal_id: sucDemo })
      ]);
      for (const x of r) assert.equal(x.error && x.error.code, '42501', JSON.stringify(x));
      // Tampoco puede montar una cubierta de Demo ni en un vehículo de Demo
      const m1 = await rpc(p, 'neumatico_cambiar', { p_vehiculo_id: vehMio, p_posicion: 1, p_destino_viejo: 'baja', p_motivo: 'x', p_cubierta_id: demo.id });
      assert.equal(m1.error && m1.error.code, 'P0002');
      const m2 = await rpc(p, 'neumatico_cambiar', { p_vehiculo_id: Number(env.sql(`select id from public.vehiculos where patente = 'DEMO001'`)), p_posicion: 1, p_destino_viejo: 'baja', p_motivo: 'x', p_cubierta_id: mias[0].id });
      assert.equal(m2.error && m2.error.code, '42501');
    }, { http: RECHAZO });
    assert.equal(foto(env), antes, 'la base no cambió');
  });

  test('Buscador (global): una quema en stock abre Stock filtrado; una quema montada sigue abriendo su vehículo', async () => {
    await flujo(env, 'buscador-quema-stock', 'global', async p => {
      await irA(p, 'alertas');
      await p.escribir('#busq-global-input', 'S-005');
      await p.esperar(`[...document.querySelectorAll('#busq-global-res .busq-op')].some(b => /Quema S-005/.test(b.textContent) && /En stock/.test(b.textContent) && /Salto/.test(b.textContent))`, { que: 'resultado de la cubierta S-005' });
      await p.enter();
      await p.esperar(`document.querySelector('#view-stock').classList.contains('active') && document.querySelectorAll('#stk-lista .stk-fila').length === 1`, { que: 'Stock filtrado por la quema' });
      assert.equal(await p.eval(`document.querySelector('#search-stock').value`), 'S-005');
      assert.deepEqual(await quemasUI(p), ['S-005']);
      // Varias coincidencias: lista con las cubiertas, sin abrir nada
      await irA(p, 'alertas');
      await p.escribir('#busq-global-input', 's-01');
      await p.esperar(`document.querySelectorAll('#busq-global-res .busq-op').length === 3`, { que: 'S-010, S-011 y S-012' });
      assert.equal(await p.eval(`document.querySelector('#view-stock').classList.contains('active')`), false);
      // Una quema de un neumático montado: abre el vehículo (comportamiento anterior)
      await p.escribir('#busq-global-input', 'Q06-01');
      await p.enter();
      await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /DEMO006/.test(document.querySelector('#vd-cab').innerText)`, { que: 'detalle de DEMO006' });
    });
    await flujo(env, 'buscador-quema-otra', 'otra', async p => {
      await irA(p, 'alertas');
      // La misma quema S-001 existe en el demo: «otra» solo encuentra la suya
      await p.escribir('#busq-global-input', 'S-001');
      await p.enter();
      await p.esperar(`document.querySelector('#view-stock').classList.contains('active') && document.querySelectorAll('#stk-lista .stk-fila').length === 1`, { que: 'su propia S-001' });
      assert.match(await texto(p, '#stk-lista'), /MarcaAjena/);
      assert.doesNotMatch(await texto(p, '#stk-lista'), /Michelin|Pirelli/);
    });
  });

  // ---- Escritura por la interfaz (perfil global) ------------------------------------------------------------------
  test('Stock (global): agregar una cubierta por la interfaz queda en la base; quema repetida se rechaza; la quema de otro cliente es válida', async () => {
    const salto = sucId(env, 'Salto');
    const antesN = cubiertas(env, `n.cliente_id = ${DEMO}`).length;
    await flujo(env, 'alta', 'global', async p => {
      await abrirStock(p, antesN);
      await p.click('#btn-cubierta-nueva');
      await p.esperar(`document.querySelector('#modal-cubierta').classList.contains('show')`, { que: 'modal de alta' });
      assert.equal(await p.eval(`!!document.querySelector('#cb-cliente-wrap').offsetParent`), false, 'el global no elige cliente');
      assert.deepEqual(await p.eval(`[...document.querySelectorAll('#cb-sucursal option')].map(o => o.textContent)`), ['Sin sucursal', 'Montevideo', 'Salto']);
      // Quema repetida en el cliente (sin distinguir mayúsculas): mensaje claro y nada cambia
      await poner(p, '#cb-quema', 's-001'); await poner(p, '#cb-marca', 'Marca E2E');
      await p.click('#cb-guardar');
      await p.esperar(`/Ese número de quema ya está registrado/.test(document.querySelector('#cb-error').textContent)`, { que: 'aviso de quema repetida' });
      assert.equal(await p.eval(`document.querySelector('#modal-cubierta').classList.contains('show')`), true);
      assert.equal(cubiertas(env, `n.cliente_id = ${DEMO}`).length, antesN);
      // «OTRA-Q1» pertenece a otro cliente: para Demo es una quema libre (única por cliente)
      await poner(p, '#cb-quema', ' OTRA-Q1 '); await poner(p, '#cb-modelo', 'Modelo E2E');
      await poner(p, '#cb-fecha', '2026-02-03'); await poner(p, '#cb-precio', '123.45');
      await elegir(p, '#cb-sucursal', salto);
      await p.click('#cb-guardar');
      await toast(p, /Cubierta agregada/);
      await p.esperar(`document.querySelectorAll('#stk-lista .stk-fila').length === ${antesN + 1} && !document.querySelector('#modal-cubierta').classList.contains('show')`, { que: 'cubierta nueva en la lista' });
    }, { http: RECHAZO });
    const c = unaCubierta(env, 'OTRA-Q1');
    assert.deepEqual({ ...c, id: 0, idneumatico: /^CB-\d+-[0-9a-f]{8}$/.test(c.idneumatico) }, {
      id: 0, cliente_id: Number(env.sql(`select ${DEMO}`)), numero_quema: 'OTRA-Q1', marca: 'Marca E2E', modelo: 'Modelo E2E', condicion: 'nuevo', estado: 'almacenado',
      vehiculo_id: null, posicion: null, sucursal_id: salto, idneumatico: true, ubicacion: 'Salto' });
    assert.equal(env.sql(`select fecha_compra || '|' || precio_unidad from public.neumaticos where id = ${c.id}`), '2026-02-03|123.45');
    assert.equal(nEventos(env, c.id, 'alta_stock'), 1);
    assert.equal(env.sql(`select created_by from public.eventos_neumatico where neumatico_id = ${c.id} and tipo = 'alta_stock'`), 'e2e00000-0000-0000-0000-000000000002');
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where lower(numero_quema) = 'otra-q1'`)), 2, 'una por cliente');
  });

  test('Stock (global): editar condición y datos, mover y eliminar (si nunca se usó) por la interfaz', async () => {
    const c = unaCubierta(env, 'OTRA-Q1');
    const mvd = sucId(env, 'Montevideo'), salto = sucId(env, 'Salto');
    const uso = unaCubierta(env, 'S-007');
    assert.ok(nEventos(env, uso.id, 'montaje') > 0, 'S-007 estuvo montada');
    const fotoUso = env.sql(`select json_agg(n) from public.neumaticos n where id = ${uso.id}`);
    await flujo(env, 'edicion-traslado-baja', 'global', async p => {
      await abrirStock(p, cubiertas(env, `n.cliente_id = ${DEMO}`).length);
      // Editar: la quema no se edita; condición Reparado y marca nueva
      await p.click(`[data-cubierta="${c.id}"] [data-action="cubiertaEditar"]`);
      await p.esperar(`document.querySelector('#modal-cubierta').classList.contains('show') && document.querySelector('#cb-quema').disabled`, { que: 'modal de edición' });
      assert.deepEqual(await p.eval(`[...document.querySelectorAll('#cb-condicion option')].map(o => o.textContent)`), ['Nuevo (actual)', 'Reparado', 'Recauchutado']);
      await poner(p, '#cb-marca', 'Marca Editada'); await elegir(p, '#cb-condicion', 'reparado');
      await p.click('#cb-guardar');
      await toast(p, /Cubierta actualizada/);
      await p.esperar(`document.querySelector(\`[data-cubierta="${c.id}"] .badge\`).textContent.trim() === 'Reparado'`, { que: 'badge Reparado' });
      // Mover de Salto a Montevideo
      await p.click(`[data-cubierta="${c.id}"] [data-action="cubiertaMover"]`);
      await p.esperar(`document.querySelector('#modal-cubierta-mover').classList.contains('show')`, { que: 'modal de traslado' });
      assert.match(await texto(p, '#cubierta-mover-sub'), /OTRA-Q1 · ahora en Salto/);
      await elegir(p, '#cbm-sucursal', mvd);
      await p.click('#cbm-guardar');
      await toast(p, /Cubierta movida/);
      await p.esperar(`/Montevideo/.test(document.querySelector(\`[data-cubierta="${c.id}"] .stk-loc\`).textContent)`, { que: 'ubicación Montevideo' });
      // Una cubierta que tuvo uso no se elimina: mensaje claro y nada cambia
      await p.click(`[data-cubierta="${uso.id}"] [data-action="cubiertaEliminar"]`);
      await p.esperar(`document.querySelector('#modal-confirm').classList.contains('show')`, { que: 'confirmación' });
      await p.click('#confirm-ok');
      await toast(p, /ya tuvo uso/);
      // La nunca usada sí: cancelar no hace nada; confirmar la elimina
      await p.click(`[data-cubierta="${c.id}"] [data-action="cubiertaEliminar"]`);
      await p.esperar(`document.querySelector('#modal-confirm').classList.contains('show') && /OTRA-Q1/.test(document.querySelector('#confirm-msg').textContent)`, { que: 'confirmación de eliminar' });
      await p.click('#confirm-cancel');
      assert.equal(nEventos(env, c.id) > 0, true);
      await p.click(`[data-cubierta="${c.id}"] [data-action="cubiertaEliminar"]`);
      await p.esperar(`document.querySelector('#modal-confirm').classList.contains('show')`, { que: 'confirmación de eliminar' });
      await p.click('#confirm-ok');
      await toast(p, /Cubierta eliminada/);
      await p.esperar(`!document.querySelector('[data-cubierta="${c.id}"]')`, { que: 'cubierta fuera de la lista' });
    }, { http: RECHAZO });
    // Estado intermedio verificado en la base por los eventos y la auditoría
    assert.equal(env.sql(`select count(*) from public.neumaticos where id = ${c.id}`), '0');
    assert.equal(env.sql(`select count(*) from public.eventos_neumatico where idneumatico = '${c.idneumatico}'`), '0', 'sus eventos de stock se fueron con ella');
    const aud = json(env, `select accion, actor_rol, antes, despues from public.audit_log where entidad = 'neumaticos' and entidad_id = '${c.id}' and accion in ('STOCK_CUBIERTA_EDITAR', 'MOVER_SUCURSAL', 'STOCK_CUBIERTA_ELIMINAR') order by id`);
    assert.deepEqual(aud.map(a => a.accion), ['STOCK_CUBIERTA_EDITAR', 'MOVER_SUCURSAL', 'STOCK_CUBIERTA_ELIMINAR']);
    assert.ok(aud.every(a => a.actor_rol === 'cliente'));
    assert.deepEqual([aud[0].antes.marca, aud[0].despues.marca, aud[0].antes.condicion, aud[0].despues.condicion], ['Marca E2E', 'Marca Editada', 'nuevo', 'reparado']);
    assert.deepEqual([aud[1].antes.sucursal_id, aud[1].despues.sucursal_id], [salto, mvd]);
    assert.equal(env.sql(`select json_agg(n) from public.neumaticos n where id = ${uso.id}`), fotoUso, 'la cubierta usada quedó intacta');
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where lower(numero_quema) = 'otra-q1' and cliente_id = ${DEMO}`)), 0, 'la quema quedó libre');
  });

  test('Stock (admin): agrega una cubierta a nombre de Otra Empresa SA eligiendo el cliente', async () => {
    const otra = Number(env.sql(`select ${OTRA}`));
    const suc = sucOtra(env);
    const antes = cubiertas(env, `n.cliente_id = ${OTRA}`).length;
    await flujo(env, 'alta-admin', 'admin', async p => {
      await abrirStock(p, cubiertas(env).length);
      await p.click('#btn-cubierta-nueva');
      await p.esperar(`document.querySelector('#modal-cubierta').classList.contains('show') && !!document.querySelector('#cb-cliente-wrap').offsetParent`, { que: 'modal con selector de cliente' });
      await elegir(p, '#cb-cliente', otra);
      const opts = await p.eval(`[...document.querySelectorAll('#cb-sucursal option')].map(o => o.textContent)`);
      assert.ok(opts.includes(suc.nombre) && !opts.includes('Montevideo') && !opts.includes('Salto'), `solo las sucursales del cliente elegido: ${opts}`);
      await poner(p, '#cb-quema', 'ADM-1'); await poner(p, '#cb-marca', 'Marca Admin');
      await elegir(p, '#cb-sucursal', suc.id);
      await p.click('#cb-guardar');
      await toast(p, /Cubierta agregada/);
    });
    assert.equal(cubiertas(env, `n.cliente_id = ${OTRA}`).length, antes + 1);
    const c = unaCubierta(env, 'ADM-1', OTRA);
    assert.equal(c.ubicacion, suc.nombre);
    assert.equal(env.sql(`select actor_rol from public.audit_log where entidad = 'eventos_neumatico' and accion = 'INSERT' and despues->>'neumatico_id' = '${c.id}'`), 'admin');
  });

  // ---- Taller: montar una cubierta y devolver el neumático retirado al stock -------------------------------------
  test('Taller (global): montar una cubierta del stock y devolver el neumático retirado al stock conserva quema, mediciones y eventos', async () => {
    const veh = Number(env.sql(`select id from public.vehiculos where patente = 'DEMO004'`));
    const cub = unaCubierta(env, 'S-003');
    assert.equal(cub.condicion, 'nuevo');
    const viejo = json(env, `select id, idneumatico, numero_quema, auxilio from public.neumaticos where vehiculo_id = ${veh} and posicion = 5`)[0];
    assert.equal(viejo.numero_quema, 'Q04-05');
    const med = () => Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${viejo.idneumatico}'`));
    const medAntes = med();
    assert.ok(medAntes > 5);
    const montadosAntes = Number(env.sql(`select count(*) from public.neumaticos where vehiculo_id = ${veh} and estado = 'montado'`));
    const salto = sucId(env, 'Salto');
    await flujo(env, 'montar-cubierta', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO004');
      await seleccionarRueda(p, 5);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show') && /P5/.test(document.querySelector('#cambio-actual').textContent)`, { que: 'modal de cambio de P5' });
      assert.equal(await p.eval(`document.querySelector('input[name="cambio-origen"][value="cubierta"]').checked`), true, 'la cubierta del stock es la opción por defecto');
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="almacenado"]').click()`);
      await p.esperar(`!!document.querySelector('#cambio-retorno-wrap').offsetParent`, { que: 'sucursal donde queda en stock' });
      assert.equal(await p.eval(`!!document.querySelector('#cambio-quema-viejo-wrap').offsetParent`), false, 'el neumático retirado ya tiene quema');
      assert.equal(await p.eval(`[...document.querySelectorAll('#cambio-cubierta option')].some(o => /S-003 · .* · Nuevo · Sin sucursal/.test(o.textContent))`), true);
      assert.equal(await p.eval(`[...document.querySelectorAll('#cambio-cubierta option')].some(o => /MarcaAjena/.test(o.textContent))`), false, 'no ofrece cubiertas de otro cliente');
      await elegir(p, '#cambio-cubierta', cub.id);
      await elegir(p, '#cambio-retorno-suc', salto);
      await p.esperar(`/vuelve al stock, Salto/.test(document.querySelector('#cambio-resumen').textContent) && /cubierta S-003 del stock/.test(document.querySelector('#cambio-resumen').textContent)`, { que: 'resumen del cambio' });
      await p.click('#cambio-confirmar');
      await p.esperar(`/Cambio registrado en P5/.test(document.querySelector('#toast-msg').textContent) && !document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'cambio registrado' });
    });
    // La cubierta: misma fila, ocupa P5, Nuevo -> Usado, sin sucursal
    const m = json(env, `select id, idneumatico, numero_quema, vehiculo_id, posicion, estado, condicion, sucursal_id from public.neumaticos where id = ${cub.id}`)[0];
    assert.deepEqual(m, { id: cub.id, idneumatico: cub.idneumatico, numero_quema: 'S-003', vehiculo_id: veh, posicion: 5, estado: 'montado', condicion: 'usado', sucursal_id: null });
    // El neumático retirado: misma fila, vuelve al stock en Salto con su quema y todo su historial
    const v = json(env, `select id, numero_quema, vehiculo_id, posicion, estado, condicion, sucursal_id, auxilio from public.neumaticos where id = ${viejo.id}`)[0];
    assert.deepEqual(v, { id: viejo.id, numero_quema: 'Q04-05', vehiculo_id: null, posicion: null, estado: 'almacenado', condicion: 'usado', sucursal_id: salto, auxilio: false });
    assert.equal(med(), medAntes, 'las mediciones se conservan');
    assert.equal(Number(env.sql(`select count(*) from public.v_mediciones_neumatico where idneumatico = '${viejo.idneumatico}' and estado_montaje = 'almacenado'`)), medAntes, 'siguen en el historial por neumático');
    assert.equal(Number(env.sql(`select count(*) from public.v_estado_neumaticos where idneumatico = '${viejo.idneumatico}'`)), 0, 'ya no cuenta para el estado de la flota');
    assert.equal(env.sql(`select estado from public.v_estado_neumaticos where idneumatico = '${cub.idneumatico}'`), 'sin_datos', 'la cubierta nueva no hereda mediciones del viejo');
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where vehiculo_id = ${veh} and estado = 'montado'`)), montadosAntes, 'el vehículo conserva sus neumáticos montados');
    const ev = json(env, `select tipo, vehiculo_id, sucursal_origen_id, sucursal_destino_id from public.eventos_neumatico where neumatico_id in (${cub.id}, ${viejo.id}) and created_at > now() - interval '5 minutes' order by id`);
    assert.deepEqual(ev.map(e => e.tipo), ['desmontaje', 'montaje']);
    assert.equal(ev[0].sucursal_destino_id, salto);
    assert.equal(ev[1].vehiculo_id, veh);
    // Ya figura en la lista de Stock con su quema y ubicación; la montada ya no
    await flujo(env, 'stock-tras-cambio', 'global', async p => {
      await abrirStock(p, cubiertas(env, `n.cliente_id = ${DEMO}`).length);
      const q = await quemasUI(p);
      assert.ok(q.includes('Q04-05') && !q.includes('S-003'));
      assert.match(await p.eval(`document.querySelector('[data-cubierta="${viejo.id}"]').innerText`), /Usado[\s\S]*Salto/);
    });
    // No se puede eliminar: tuvo uso
    await flujo(env, 'baja-denegada', 'global', async p => {
      const r = await rpc(p, 'stock_cubierta_eliminar', { p_id: viejo.id });
      assert.equal(r.error && r.error.code, '55000');
    }, { http: RECHAZO });
  });

  test('Taller (global): dos montajes simultáneos de la misma cubierta: uno confirma y el otro falla sin duplicar stock', async () => {
    const cub = unaCubierta(env, 'S-004');
    const v1 = Number(env.sql(`select id from public.vehiculos where patente = 'DEMO007'`)), v2 = Number(env.sql(`select id from public.vehiculos where patente = 'DEMO008'`));
    const base = { p_posicion: 1, p_destino_viejo: 'baja', p_motivo: 'Concurrencia E2E', p_cubierta_id: cub.id };
    const nCub = Number(env.sql(`select count(*) from public.neumaticos where numero_quema = 'S-004' and cliente_id = ${DEMO}`));
    let r;
    await flujo(env, 'montaje-simultaneo', 'global', async p => {
      r = await p.eval(`import('/assets/js/core/supabase.js').then(m => Promise.all([${v1}, ${v2}].map(v => m.db.rpc('neumatico_cambiar', Object.assign({ p_vehiculo_id: v }, ${JSON.stringify(base)})))))
        .then(rs => rs.map(x => ({ ok: !x.error, code: x.error && x.error.code, message: x.error && x.error.message })))`);
    }, { http: RECHAZO });
    assert.equal(r.filter(x => x.ok).length, 1, JSON.stringify(r));
    const fallo = r.find(x => !x.ok);
    assert.equal(fallo.code, 'P0002');
    assert.match(fallo.message, /cubierta del stock inexistente o ya montada/);
    const m = json(env, `select vehiculo_id, posicion, estado, condicion from public.neumaticos where id = ${cub.id}`)[0];
    assert.ok([v1, v2].includes(m.vehiculo_id) && m.posicion === 1 && m.estado === 'montado' && m.condicion === 'usado');
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where numero_quema = 'S-004' and cliente_id = ${DEMO}`)), nCub, 'sin duplicar la cubierta');
    assert.equal(nEventos(env, cub.id, 'montaje'), 1, 'un solo montaje');
    // El vehículo que perdió la carrera quedó intacto: su neumático de P1 sigue montado
    const otro = m.vehiculo_id === v1 ? v2 : v1;
    assert.equal(env.sql(`select estado from public.neumaticos where vehiculo_id = ${otro} and posicion = 1`), 'montado');
  });

  test('Stock (global): el stock de Demo en la base quedó coherente tras las pruebas (sin vehículo ni posición, sucursal del mismo cliente)', () => {
    const malas = json(env, `select n.id from public.neumaticos n where n.vehiculo_id is null and (n.posicion is not null or n.estado <> 'almacenado' or n.auxilio
      or (n.sucursal_id is not null and not exists (select 1 from public.sucursales s where s.id = n.sucursal_id and s.cliente_id = n.cliente_id)))`);
    assert.deepEqual(malas, []);
    assert.equal(Number(env.sql(`select count(*) from public.neumaticos where vehiculo_id is not null and condicion = 'nuevo'`)), 0, 'ninguna cubierta montada figura Nuevo');
    assert.equal(Number(env.sql(`select count(*) - count(distinct (cliente_id, lower(numero_quema))) from public.neumaticos where numero_quema is not null`)), 0);
  });
}

