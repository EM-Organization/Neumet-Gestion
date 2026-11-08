// Gestión de sucursales con base real: crear, renombrar y eliminar sucursales; agregar vehículos y moverlos entre
// sucursales (con confirmación) desde la interfaz; historial intacto; auditoría; y aislamiento estricto:
// el perfil de sucursal no puede gestionar y «Otra Empresa SA» no ve ni mueve nada de Demo Transportes.
// Estas pruebas MODIFICAN la base de prueba y corren después de las de solo lectura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, texto } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';

const RPC_RECHAZADA = [{ ruta: /rpc\/(sucursal_|vehiculo_crear|vehiculo_mover)/, status: [400, 403, 404, 409] }];
const sucDemo = nombre => `(select id from public.sucursales where cliente_id = ${DEMO} and lower(nombre) = '${nombre.toLowerCase()}')`;
const filas = (env, sql) => json(env, sql);

// Llama a una RPC con el cliente REAL del panel (supabase-js + sesión de prueba).
const rpc = (p, nombre, args) => p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.rpc(${JSON.stringify(nombre)}, ${JSON.stringify(args)})).then(r => ({ data: r.data, error: r.error && { code: r.error.code, message: r.error.message } }))`);
const leerApi = (p, ruta) => p.eval(`fetch('/rest/v1/${ruta}', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } }).then(r => r.json())`);

// Foto del estado de gestión de TODA la base (para comprobar que un rechazo no cambió nada).
const foto = env => env.sql(`select json_build_object(
  'suc', (select json_agg(s order by s.id) from public.sucursales s),
  'veh', (select json_agg(json_build_object('id', v.id, 'suc', v.sucursal_id, 'cli', v.cliente_id, 'num', v.numero) order by v.id) from public.vehiculos v),
  'audit', (select count(*) from public.audit_log where accion = 'MOVER_SUCURSAL'))`);

async function abrirSucursales(p, { filasVeh } = {}) {
  await irA(p, 'sucursales');
  await p.esperar(`document.querySelectorAll('#suc-lista tr[data-sucursal], #suc-lista .salud-muted').length > 0 && ${filasVeh === undefined ? 'true' : `document.querySelectorAll('#suc-vehiculos tr[data-vehiculo]').length === ${filasVeh}`}`, { que: 'vista Sucursales cargada' });
}
const elegir = (p, sel, valor) => p.eval(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(String(valor))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const confirmar = async (p, titulo) => {
  await p.esperar(`document.querySelector('#modal-confirm').classList.contains('show') && document.querySelector('#confirm-title').textContent === ${JSON.stringify(titulo)}`, { que: `confirmación «${titulo}»` });
  return p;
};

export function registrar(env) {
  test('Sucursales (global): la vista lista solo las sucursales y vehículos del cliente, con sus cifras', async () => {
    const sucs = filas(env, `select s.nombre, (select count(*) from public.vehiculos v where v.sucursal_id = s.id)::int n from public.sucursales s where s.cliente_id = ${DEMO} order by s.nombre`);
    const nVeh = Number(env.sql(`select count(*) from public.vehiculos where cliente_id = ${DEMO}`));
    assert.ok(sucs.length >= 2 && nVeh > 0);
    await flujo(env, 'lista', 'global', async p => {
      await abrirSucursales(p, { filasVeh: nVeh });
      const ui = await p.eval(`[...document.querySelectorAll('#suc-lista tr[data-sucursal]')].map(r => ({ nombre: r.querySelector('input').value, n: Number(r.children[1].textContent) }))`);
      assert.deepEqual(ui, sucs);
      assert.equal(await p.eval(`!!document.querySelector('.nav-item[data-view="sucursales"]').offsetParent`), true);
      const todo = await texto(p, '#view-sucursales');
      assert.doesNotMatch(todo, /OTRA001|Camión Ajeno|Ñandú/);
    });
  });

  test('Sucursales (global): crear, renombrar y eliminar una sucursal queda en la base y en la auditoría', async () => {
    await flujo(env, 'crud', 'global', async p => {
      await abrirSucursales(p);
      await p.escribir('#suc-nombre', 'Rivera E2E');
      await p.click('[data-action="sucursalCrear"]');
      await p.esperar(`/Sucursal creada/.test(document.querySelector('#toast-msg').textContent) && [...document.querySelectorAll('#suc-lista input')].some(i => i.value === 'Rivera E2E')`, { que: 'sucursal creada' });
      const fila = filas(env, `select id, cliente_id from public.sucursales where nombre = 'Rivera E2E'`);
      assert.equal(fila.length, 1);
      assert.equal(Number(env.sql(`select ${DEMO}`)), fila[0].cliente_id, 'queda en el cliente del usuario');
      assert.equal(Number(env.sql(`select count(*) from public.audit_log where entidad = 'sucursales' and entidad_id = '${fila[0].id}' and accion = 'INSERT' and actor_rol = 'cliente'`)), 1);
      // El selector de la barra superior se actualiza sin recargar
      await p.esperar(`[...document.querySelectorAll('#sec-select option')].some(o => o.textContent === 'Rivera E2E')`, { que: 'selector actualizado' });

      // Duplicado (sin distinguir mayúsculas)
      await p.escribir('#suc-nombre', 'rivera e2e');
      await p.click('[data-action="sucursalCrear"]');
      await p.esperar(`/Ya existe una sucursal/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de nombre repetido' });

      // Renombrar
      await p.escribir(`#suc-n-${fila[0].id}`, 'Rivera Norte');
      await p.click(`#suc-lista tr[data-sucursal="${fila[0].id}"] [data-action="sucursalRenombrar"]`);
      await p.esperar(`/Sucursal actualizada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'sucursal renombrada' });
      assert.equal(env.sql(`select nombre from public.sucursales where id = ${fila[0].id}`), 'Rivera Norte');

      // Eliminar: cancelar no hace nada; confirmar elimina
      await p.click(`#suc-lista tr[data-sucursal="${fila[0].id}"] [data-action="sucursalEliminar"]`);
      await confirmar(p, 'Eliminar sucursal');
      await p.click('#confirm-cancel');
      assert.equal(Number(env.sql(`select count(*) from public.sucursales where id = ${fila[0].id}`)), 1);
      await p.click(`#suc-lista tr[data-sucursal="${fila[0].id}"] [data-action="sucursalEliminar"]`);
      await confirmar(p, 'Eliminar sucursal');
      await p.click('#confirm-ok');
      await p.esperar(`/Sucursal eliminada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'sucursal eliminada' });
      assert.equal(Number(env.sql(`select count(*) from public.sucursales where id = ${fila[0].id}`)), 0);
      await p.esperar(`![...document.querySelectorAll('#sec-select option')].some(o => o.textContent === 'Rivera Norte')`, { que: 'selector sin la sucursal eliminada' });
    }, { http: RPC_RECHAZADA });
  });

  test('Sucursales (global): una sucursal con vehículos no se elimina y se explica el motivo', async () => {
    const id = Number(env.sql(`select ${sucDemo('salto')}`));
    const antes = foto(env);
    await flujo(env, 'eliminar-con-datos', 'global', async p => {
      await abrirSucursales(p);
      // Desde la interfaz: se informa sin llamar a la base
      await p.click(`#suc-lista tr[data-sucursal="${id}"] [data-action="sucursalEliminar"]`);
      await p.esperar(`/Moverlos antes de eliminarla/.test(document.querySelector('#suc-error').textContent)`, { que: 'aviso de vehículos asociados' });
      // Directo a la RPC: la base la rechaza con un mensaje claro
      const r = await rpc(p, 'sucursal_eliminar', { p_sucursal_id: id });
      assert.equal(r.error && r.error.code, '23503');
      assert.match(r.error.message, /la sucursal tiene \d+ vehículo\(s\)/);
    }, { http: RPC_RECHAZADA });
    assert.equal(foto(env), antes);
  });

  test('Sucursales (global): agregar un vehículo con sucursal, matrícula y tipo de ruedas', async () => {
    await flujo(env, 'vehiculo-nuevo', 'global', async p => {
      await abrirSucursales(p);
      await p.escribir('#suc-veh-numero', '777');
      await p.escribir('#suc-veh-patente', 'e2e 0777');
      await elegir(p, '#suc-veh-ruedas', 16);
      await elegir(p, '#suc-veh-sucursal', Number(env.sql(`select ${sucDemo('salto')}`)));
      await p.click('[data-action="sucursalVehiculoCrear"]');
      await p.esperar(`/Vehículo agregado/.test(document.querySelector('#toast-msg').textContent)`, { que: 'vehículo agregado' });
      const v = filas(env, `select cliente_id, nombre, numero, patente, patente_norm, tipo_ruedas, activo, sucursal_id from public.vehiculos where numero = '777'`);
      assert.deepEqual(v, [{ cliente_id: Number(env.sql(`select ${DEMO}`)), nombre: 'Coche 777', numero: '777', patente: 'e2e 0777', patente_norm: 'E2E0777', tipo_ruedas: 16, activo: true, sucursal_id: Number(env.sql(`select ${sucDemo('salto')}`)) }]);
      await p.esperar(`!!document.querySelector('#suc-vehiculos tr[data-vehiculo]') && /Coche 777/.test(document.querySelector('#suc-vehiculos').textContent)`, { que: 'vehículo en el listado' });
      // Número repetido
      await p.escribir('#suc-veh-numero', '777');
      await p.click('[data-action="sucursalVehiculoCrear"]');
      await p.esperar(`/número de coche/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de número repetido' });
      assert.equal(Number(env.sql(`select count(*) from public.vehiculos where numero = '777'`)), 1);
    }, { http: RPC_RECHAZADA });
  });

  test('Sucursales (global): mover un vehículo pide confirmación, conserva su historial y deja auditoría', async () => {
    const veh = filas(env, `select v.id, v.patente, v.sucursal_id from public.vehiculos v where v.cliente_id = ${DEMO} and v.sucursal_id = ${sucDemo('montevideo')}
      and exists (select 1 from public.mediciones m where m.vehiculo_id = v.id) order by v.patente limit 1`)[0];
    assert.ok(veh, 'el demo debe traer un vehículo de Montevideo con mediciones');
    const huella = () => env.sql(`select json_build_object(
      'med', (select json_agg(m order by m.id) from public.mediciones m where m.vehiculo_id = ${veh.id}),
      'neum', (select json_agg(n order by n.id) from public.neumaticos n where n.vehiculo_id = ${veh.id}),
      'ev', (select count(*) from public.eventos_neumatico e where e.vehiculo_id = ${veh.id}),
      'estado', (select json_agg(e order by e.posicion) from public.v_estado_neumaticos e where e.vehiculo_id = ${veh.id}))`);
    const antes = huella();
    const salto = Number(env.sql(`select ${sucDemo('salto')}`));
    const montevideo = Number(env.sql(`select ${sucDemo('montevideo')}`));
    await flujo(env, 'mover', 'global', async p => {
      await abrirSucursales(p);
      // Cancelar: nada cambia y el select vuelve a su valor
      await elegir(p, `#suc-vehiculos tr[data-vehiculo="${veh.id}"] select`, salto);
      await confirmar(p, 'Mover vehículo');
      assert.match(await texto(p, '#confirm-msg'), /historial de mediciones se conserva/);
      await p.click('#confirm-cancel');
      await p.esperar(`document.querySelector('#suc-vehiculos tr[data-vehiculo="${veh.id}"] select').value === '${montevideo}'`, { que: 'select restablecido' });
      assert.equal(Number(env.sql(`select sucursal_id from public.vehiculos where id = ${veh.id}`)), montevideo);
      // Confirmar
      await elegir(p, `#suc-vehiculos tr[data-vehiculo="${veh.id}"] select`, salto);
      await confirmar(p, 'Mover vehículo');
      await p.click('#confirm-ok');
      await p.esperar(`/Vehículo movido/.test(document.querySelector('#toast-msg').textContent)`, { que: 'vehículo movido' });
    });
    assert.equal(Number(env.sql(`select sucursal_id from public.vehiculos where id = ${veh.id}`)), salto);
    assert.equal(huella(), antes, 'mediciones, neumáticos, eventos y estado se conservan');
    const aud = filas(env, `select actor_rol, antes->>'sucursal_id' a, despues->>'sucursal_id' d from public.audit_log where accion = 'MOVER_SUCURSAL' and entidad_id = '${veh.id}'`);
    assert.deepEqual(aud, [{ actor_rol: 'cliente', a: String(montevideo), d: String(salto) }]);

    // La RLS acompaña al movimiento: Salto lo ve ahora y Montevideo ya no.
    await flujo(env, 'mover-visto-por-salto', 'salto', async p => {
      const pats = await leerApi(p, 'vehiculos?select=patente');
      assert.ok(pats.some(x => x.patente === veh.patente));
    });
    await flujo(env, 'mover-visto-por-montevideo', 'montevideo', async p => {
      const pats = await leerApi(p, 'vehiculos?select=patente');
      assert.ok(!pats.some(x => x.patente === veh.patente));
    });

    // A «sin sucursal» y de vuelta
    await flujo(env, 'mover-sin-sucursal', 'global', async p => {
      await abrirSucursales(p);
      await elegir(p, `#suc-vehiculos tr[data-vehiculo="${veh.id}"] select`, '');
      await confirmar(p, 'Mover vehículo');
      await p.click('#confirm-ok');
      await p.esperar(`/Vehículo movido/.test(document.querySelector('#toast-msg').textContent)`, { que: 'vehículo movido a sin sucursal' });
    });
    assert.equal(env.sql(`select coalesce(sucursal_id::text, 'null') from public.vehiculos where id = ${veh.id}`), 'null');
    assert.equal(huella(), antes);
    // El perfil de Salto ya no lo ve (queda solo para el global)
    await flujo(env, 'sin-sucursal-no-visible', 'salto', async p => {
      assert.ok(!(await leerApi(p, 'vehiculos?select=patente')).some(x => x.patente === veh.patente));
    });
  });

  test('Sucursales (perfil de sucursal): sin entrada en el menú y las RPC de gestión se rechazan sin cambiar la base', async () => {
    const antes = foto(env);
    const propio = Number(env.sql(`select id from public.vehiculos where patente = 'DEMO011'`));
    const montevideo = Number(env.sql(`select ${sucDemo('montevideo')}`));
    await flujo(env, 'gestion-denegada', 'salto', async p => {
      assert.equal(await p.eval(`!!document.querySelector('.nav-item[data-view="sucursales"]').offsetParent`), false, 'sin entrada de menú');
      for (const [nombre, args] of [
        ['sucursal_crear', { p_nombre: 'Intruso' }],
        ['sucursal_renombrar', { p_sucursal_id: montevideo, p_nombre: 'Intruso' }],
        ['sucursal_eliminar', { p_sucursal_id: montevideo }],
        ['vehiculo_crear', { p_numero: '555', p_patente: 'IN5555', p_tipo_ruedas: 10, p_sucursal_id: null }],
        ['vehiculo_mover_sucursal', { p_vehiculo_id: propio, p_sucursal_id: montevideo }],
        ['vehiculo_mover_sucursal', { p_vehiculo_id: propio, p_sucursal_id: null }]
      ]) {
        const r = await rpc(p, nombre, args);
        assert.equal(r.error && r.error.code, '42501', `${nombre} debe rechazarse`);
      }
      // Directo a las tablas tampoco puede escribir
      const upd = await p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.from('vehiculos').update({ sucursal_id: null }).eq('id', ${propio}).select()).then(r => ({ filas: (r.data || []).length, error: !!r.error }))`);
      assert.equal(upd.filas, 0);
    }, { http: [...RPC_RECHAZADA, { ruta: /vehiculos/, status: [401, 403] }] });
    assert.equal(foto(env), antes);
  });

  test('Sucursales (Otra Empresa SA): no ve ni mueve nada de Demo Transportes, y su propia gestión funciona', async () => {
    const antes = foto(env);
    const otraVeh = Number(env.sql(`select id from public.vehiculos where patente = 'OTRA001'`));
    const demoVeh = Number(env.sql(`select id from public.vehiculos where patente = 'DEMO001'`));
    const salto = Number(env.sql(`select ${sucDemo('salto')}`));
    await flujo(env, 'otra-aislada', 'otra', async p => {
      // Ve solo lo suyo: sin sucursales, con sus propios vehículos
      const nOtra = Number(env.sql(`select count(*) from public.vehiculos where cliente_id = (select id from public.clientes where nombre = 'Otra Empresa SA')`));
      await abrirSucursales(p, { filasVeh: nOtra });
      assert.equal(await p.eval(`document.querySelectorAll('#suc-lista tr[data-sucursal]').length`), 0);
      const todo = await texto(p, '#view-sucursales');
      assert.doesNotMatch(todo, /DEMO0|Montevideo|Salto/);
      assert.deepEqual(await leerApi(p, 'sucursales?select=id'), []);
      assert.ok(!(await leerApi(p, 'vehiculos?select=patente')).some(v => /^DEMO/.test(v.patente)));

      // Intentos directos contra Demo: todos rechazados
      for (const [nombre, args] of [
        ['vehiculo_mover_sucursal', { p_vehiculo_id: demoVeh, p_sucursal_id: salto }],
        ['vehiculo_mover_sucursal', { p_vehiculo_id: demoVeh, p_sucursal_id: null }],
        ['vehiculo_mover_sucursal', { p_vehiculo_id: otraVeh, p_sucursal_id: salto }], // su vehículo a una sucursal ajena
        ['sucursal_renombrar', { p_sucursal_id: salto, p_nombre: 'Hackeada' }],
        ['sucursal_eliminar', { p_sucursal_id: salto }],
        ['sucursal_crear', { p_nombre: 'En Demo', p_cliente_id: Number(env.sql(`select ${DEMO}`)) }],
        ['vehiculo_crear', { p_numero: '808', p_patente: null, p_tipo_ruedas: 10, p_sucursal_id: salto }],
        ['vehiculo_crear', { p_numero: '809', p_patente: null, p_tipo_ruedas: 10, p_sucursal_id: null, p_cliente_id: Number(env.sql(`select ${DEMO}`)) }]
      ]) {
        const r = await rpc(p, nombre, args);
        assert.equal(r.error && r.error.code, '42501', `${nombre} contra Demo debe rechazarse`);
      }
    }, { http: RPC_RECHAZADA });
    assert.equal(foto(env), antes, 'la base no cambió');

    // Su propia gestión: crea una sucursal, agrega un vehículo y lo mueve; Demo queda intacto
    const demoAntes = env.sql(`select json_build_object('suc', (select json_agg(s order by s.id) from public.sucursales s where s.cliente_id = ${DEMO}),
      'veh', (select json_agg(json_build_object('id', v.id, 'suc', v.sucursal_id) order by v.id) from public.vehiculos v where v.cliente_id = ${DEMO}))`);
    await flujo(env, 'otra-propia', 'otra', async p => {
      await abrirSucursales(p);
      await p.escribir('#suc-nombre', 'Sucursal Ajena');
      await p.click('[data-action="sucursalCrear"]');
      await p.esperar(`[...document.querySelectorAll('#suc-lista input')].some(i => i.value === 'Sucursal Ajena')`, { que: 'sucursal propia' });
      const id = Number(env.sql(`select id from public.sucursales where nombre = 'Sucursal Ajena'`));
      await elegir(p, `#suc-vehiculos tr[data-vehiculo="${otraVeh}"] select`, id);
      await confirmar(p, 'Mover vehículo');
      await p.click('#confirm-ok');
      await p.esperar(`/Vehículo movido/.test(document.querySelector('#toast-msg').textContent)`, { que: 'vehículo propio movido' });
      assert.equal(Number(env.sql(`select sucursal_id from public.vehiculos where id = ${otraVeh}`)), id);
      assert.equal(Number(env.sql(`select cliente_id from public.sucursales where id = ${id}`)), Number(env.sql(`select id from public.clientes where nombre = 'Otra Empresa SA'`)));
    });
    assert.equal(env.sql(`select json_build_object('suc', (select json_agg(s order by s.id) from public.sucursales s where s.cliente_id = ${DEMO}),
      'veh', (select json_agg(json_build_object('id', v.id, 'suc', v.sucursal_id) order by v.id) from public.vehiculos v where v.cliente_id = ${DEMO}))`), demoAntes, 'Demo Transportes quedó intacto');
  });

  test('Sucursales (administrador): sin entrada en el panel del cliente y las RPC exigen indicar el cliente', async () => {
    await flujo(env, 'admin', 'admin', async p => {
      assert.equal(await p.eval(`!!document.querySelector('.nav-item[data-view="sucursales"]').offsetParent`), false);
      const sinCliente = await rpc(p, 'sucursal_crear', { p_nombre: 'Admin sin cliente' });
      assert.equal(sinCliente.error && sinCliente.error.code, '22004');
      const ok = await rpc(p, 'sucursal_crear', { p_nombre: 'Admin E2E', p_cliente_id: Number(env.sql(`select id from public.clientes where nombre = 'Otra Empresa SA'`)) });
      assert.equal(ok.error, null);
      assert.equal(ok.data.nombre, 'Admin E2E');
      const mover = await rpc(p, 'vehiculo_mover_sucursal', { p_vehiculo_id: Number(env.sql(`select id from public.vehiculos where patente = 'DEMO001'`)), p_sucursal_id: ok.data.id });
      assert.equal(mover.error && mover.error.code, '42501', 'el admin tampoco cruza clientes');
    }, { http: RPC_RECHAZADA });
  });
}
