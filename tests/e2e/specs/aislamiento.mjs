// Aislamiento con RLS real: cada sesión ve solo lo suyo, en la interfaz y en las consultas directas a la API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, filasVehiculos, irA, dormir, texto } from '../lib/flujo.mjs';
import { ALCANCE, cifrasInicio, json, vehiculosVisibles } from '../lib/verdad.mjs';
import { LEER_INICIO, INICIO_LISTO } from './inicio.mjs';
import { etiquetaCoche } from '../../../assets/js/domain/coche.js';

// Pide a la API con el JWT de la sesión (el mismo que usa el panel). Devuelve las filas de todas las páginas.
const LEER_API = `async (tabla, cols) => {
  const filas = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch('/rest/v1/' + tabla + '?select=' + cols + '&limit=1000&offset=' + off, { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } });
    if (!r.ok) throw new Error(tabla + ': HTTP ' + r.status);
    const f = await r.json(); filas.push(...f);
    if (f.length < 1000) return filas;
  }
}`;

export function registrar(env) {
  test('Aislamiento: cada rol ve en Vehículos exactamente los camiones de su alcance', async () => {
    const cuentas = { admin: 18, global: 14, salto: 5, montevideo: 9, otra: 4 };
    for (const [rol, n] of Object.entries(cuentas)) {
      const esperados = await vehiculosVisibles(env, rol === 'otra' ? 'admin' : rol);
      const propios = rol === 'otra' ? json(env, `select nombre, patente from public.vehiculos v where v.cliente_id = (select id from public.clientes where nombre = 'Otra Empresa SA')`) : esperados;
      assert.equal(propios.length, n, `la base de prueba debe tener ${n} vehículos para ${rol}`);
      await flujo(env, 'lista-vehiculos', rol, async p => {
        await irA(p, 'vehiculos');
        if (rol === 'admin') {
          await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr .mono-cell').length === ${n}`, { que: `${n} filas` });
          const pat = await p.eval(`[...document.querySelectorAll('#tbody-vehiculos tr .mono-cell')].map(e => e.textContent.trim())`);
          assert.ok(pat.includes('OTRA001') && pat.includes('DEMO001'), 'el admin ve camiones de todos los clientes');
          return;
        }
        await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length === ${n}`, { que: `${n} filas` });
        const nombres = (await filasVehiculos(p)).map(f => f.nombre).sort();
        assert.deepEqual(nombres, propios.map(v => etiquetaCoche(v.nombre)).sort());
        const todo = await texto(p, '#view-vehiculos');
        if (rol !== 'otra') assert.doesNotMatch(todo, /OTRA001|Camión Ajeno|Ñandú/);
        else assert.doesNotMatch(todo, /DEMO0/);
      });
    }
  });

  test('Aislamiento (salto): no encuentra camiones de Montevideo ni de otro cliente por búsqueda', async () => {
    await flujo(env, 'busqueda-ajena', 'salto', async p => {
      await irA(p, 'vehiculos');
      await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length === 5`);
      for (const q of ['DEMO001', 'DEMO005', 'demo009', 'Camión 101', '101', 'OTRA001', 'ab123cd']) {
        await p.escribir('#search-vehiculos', q);
        await dormir(120);
        assert.deepEqual(await filasVehiculos(p), [], `salto no debe ver resultados para ${q}`);
        assert.match(await texto(p, '#veh-lista'), /Ningún vehículo coincide/);
      }
      // Enter con una matrícula ajena no abre nada.
      await p.escribir('#search-vehiculos', 'DEMO001');
      await p.enter();
      await dormir(400);
      assert.equal(await p.eval(`document.querySelector('#view-vehiculos').classList.contains('active')`), true);
    });
  });

  for (const [rol, ajena] of [['salto', 'DEMO001'], ['montevideo', 'DEMO010'], ['global', 'OTRA001']]) {
    test(`Aislamiento (${rol}): abrir por estado un camión ajeno (${ajena}) no muestra nada`, async () => {
      const id = Number(env.sql(`select id from public.vehiculos where patente = '${ajena}'`));
      await flujo(env, 'detalle-ajeno', rol, async p => {
        await p.eval(`import('/assets/js/views/vehiculo-detalle.js').then(m => m.abrirDetalle(${id}))`);
        await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /Vehículo no encontrado/.test(document.querySelector('#vd-cab').innerText)`, { que: 'aviso de vehículo no encontrado' });
        assert.equal(await p.eval(`document.querySelectorAll('#vd-diagrama .vd-rueda').length`), 0, 'no debe dibujar ruedas');
        const vista = await texto(p, '#view-vehiculo-detalle');
        assert.doesNotMatch(vista, new RegExp(ajena));
        assert.doesNotMatch(vista, /Camión (1|2)\d\d|Ajeno/);
      });
    });
  }

  for (const rol of ['global', 'salto', 'montevideo', 'otra']) {
    test(`Aislamiento (${rol}): la API solo devuelve filas de su alcance en cada tabla y vista`, async () => {
      const a = rol === 'otra' ? null : ALCANCE[rol];
      const mios = rol === 'otra'
        ? json(env, `select v.id from public.vehiculos v where v.cliente_id = (select id from public.clientes where nombre = 'Otra Empresa SA')`)
        : json(env, `select v.id from public.vehiculos v where ${a.veh}`);
      const ids = new Set(mios.map(v => v.id));
      await flujo(env, 'api-directa', rol, async p => {
        const leer = (t, c) => p.eval(`(${LEER_API})(${JSON.stringify(t)}, ${JSON.stringify(c)})`);
        const veh = await leer('vehiculos', 'id,cliente_id,sucursal_id');
        assert.deepEqual(veh.map(v => v.id).sort((x, y) => x - y), [...ids].sort((x, y) => x - y), 'vehiculos');
        for (const t of ['neumaticos', 'v_estado_neumaticos', 'v_alertas', 'eventos_neumatico']) {
          const f = await leer(t, 'vehiculo_id');
          assert.ok(f.length > 0 || t === 'eventos_neumatico', `${t}: sin filas`);
          for (const r of f) assert.ok(ids.has(r.vehiculo_id), `${t}: fila de un vehículo ajeno (${r.vehiculo_id})`);
        }
        const med = await leer('mediciones', 'vehiculo_id,device_id');
        if (rol !== 'otra') assert.ok(med.length > 0, 'mediciones'); // el cliente ajeno no tiene mediciones
        if (rol === 'global') assert.ok(med.length > 1000, 'mediciones (más de una página)');
        for (const r of med) if (r.vehiculo_id !== null) assert.ok(ids.has(r.vehiculo_id), `mediciones: vehículo ajeno ${r.vehiculo_id}`);
        const macs = new Set(json(env, rol === 'otra' ? `select mac_address from public.dispositivos where false` : `select d.mac_address from public.dispositivos d where ${a.dis}`).map(d => d.mac_address));
        for (const r of med) if (r.device_id !== null && r.vehiculo_id === null) assert.ok(macs.has(r.device_id), `mediciones: dispositivo ajeno ${r.device_id}`);
        const dis = await leer('dispositivos', 'mac_address');
        assert.deepEqual(dis.map(d => d.mac_address).sort(), [...macs].sort(), 'dispositivos');
        const cli = await leer('clientes', 'nombre');
        assert.deepEqual(cli.map(c => c.nombre), [rol === 'otra' ? 'Otra Empresa SA' : 'Demo Transportes'], 'clientes');
        const perf = await leer('perfiles', 'user_id,rol');
        assert.equal(perf.length, 1, 'cada sesión solo ve su propio perfil');
        assert.equal((await leer('gastos', 'id')).length, 0, 'gastos: solo admin');
        const stock = await leer('stock_neumaticos', 'cliente_id,cantidad');
        if (rol === 'salto' || rol === 'montevideo') assert.equal(stock.length, 0, 'la sucursal no ve el stock (lo gestiona el perfil global)');
        if (rol === 'global') assert.ok(stock.length > 0 && stock.every(s => s.cliente_id === veh[0].cliente_id));
      });
    });
  }

  test('Aislamiento (global): el selector de sucursal filtra Vehículos e Inicio', async () => {
    await flujo(env, 'selector-seccional', 'global', async p => {
      await p.esperar(`document.querySelector('#sec-select') && document.querySelectorAll('#sec-select option').length === 3`, { que: 'selector con las 2 sucursales' });
      for (const [valor, rol, n] of [['Salto', 'salto', 5], ['Montevideo', 'montevideo', 9], ['', 'global', 14]]) {
        const id = valor ? env.sql(`select id from public.sucursales where nombre = '${valor}'`) : '';
        await p.eval(`(() => { const s = document.querySelector('#sec-select'); s.value = '${id}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await irA(p, 'inicio');
        const e = cifrasInicio(env, rol);
        await p.esperar(`${INICIO_LISTO} && (() => { const c = document.querySelectorAll('#inicio-contenido .inicio-cifra strong'); const a = document.querySelector('#inicio-contenido [data-args=\\'["alertas"]\\']'); return Number(c[2].textContent) === ${e.criticos} && a && Number(a.textContent.replace(/\\D/g, '')) === ${e.alertas}; })()`, { que: `Inicio de ${valor || 'todas'} con ${e.alertas} alertas` });
        const l = await p.eval(LEER_INICIO);
        assert.deepEqual(l.cifras, [e.ok, e.bajo, e.criticos, e.sinDatos], `proporciones de Inicio (${valor || 'todas'})`);
        await irA(p, 'vehiculos');
        await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length === ${n}`, { que: `${n} vehículos (${valor || 'todas'})` });
      }
    });
  });
}
