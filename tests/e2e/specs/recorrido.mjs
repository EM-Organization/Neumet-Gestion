// Recorrido de todas las vistas de cada rol contra la base real: sin console.error, sin excepciones y sin 4xx/5xx.
// Además ejercita Reportes (CSV paginado contra PostgREST con tope de 1000 filas), Mediciones, Flota, Clientes y Ficha.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, dormir, texto } from '../lib/flujo.mjs';
import { json, ALCANCE } from '../lib/verdad.mjs';

const CLIENTE = ['inicio', 'vehiculos', 'alertas', 'stock', 'reportes'];
// Recauchutado: admin y perfil global (el de sucursal no gestiona stock).
const GLOBAL = ['inicio', 'vehiculos', 'alertas', 'stock', 'recauchutado', 'reportes'];  // Dispositivos es solo de administración
const VISTAS = {
  admin: ['inicio', 'vehiculos', 'alertas', 'stock', 'recauchutado', 'reportes', 'dispositivos', 'flota', 'mediciones', 'clientes', 'balance'],
  global: [...GLOBAL, 'sucursales'], salto: CLIENTE, montevideo: CLIENTE, otra: [...GLOBAL, 'sucursales']
};

// Intercepta las descargas y ventanas de impresión del panel para poder leer el CSV generado.
const CAPTURAR_DESCARGAS = `(() => {
  window.__blobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => { window.__blobs.push(b); return orig(b); };
  HTMLAnchorElement.prototype.click = function () { window.__descargas = (window.__descargas || []).concat(this.download); };
  window.open = () => ({ document: { write: h => { window.__impreso = h; }, close() {} }, focus() {}, print() {} });
})()`;

export function registrar(env) {
  for (const rol of Object.keys(VISTAS)) {
    test(`Recorrido (${rol}): todas las vistas cargan sin errores`, async () => {
      await flujo(env, 'recorrido', rol, async p => {
        const visibles = await p.eval(`[...document.querySelectorAll('.nav-item[data-view]')].filter(n => n.getClientRects().length).map(n => n.dataset.view)`);
        assert.deepEqual(visibles, VISTAS[rol], `menú visible para ${rol}`);
        for (const v of VISTAS[rol]) {
          await irA(p, v);
          await dormir(500); // deja terminar las consultas de la vista
          assert.equal(await p.eval(`document.querySelectorAll('.nav-item.active').length`), 1);
          assert.doesNotMatch(await texto(p, `#view-${v}`), /Error de conexión|No se pudo cargar|Algo salió mal/i, `vista ${v}`);
        }
        if (rol !== 'admin') {
          // El cliente no ve controles de administración.
          assert.equal(await p.eval(`[...document.querySelectorAll('[data-admin-only]')].filter(e => e.getClientRects().length).length`), 0);
        }
      });
    });
  }

  for (const rol of ['global', 'salto', 'admin']) {
    test(`Reportes (${rol}): el CSV de un camión trae todas sus mediciones (paginado contra PostgREST)`, async () => {
      // Camión con más mediciones del alcance: más de una página si es posible.
      const a = ALCANCE[rol];
      const v = json(env, `select v.id, v.patente, count(m.id) as n from public.vehiculos v join public.mediciones m on m.vehiculo_id = v.id where ${a.veh} group by 1, 2 order by 3 desc, 1 limit 1`)[0];
      assert.ok(v && Number(v.n) > 100);
      await flujo(env, 'reportes-csv', rol, async p => {
        await irA(p, 'reportes');
        await p.eval(CAPTURAR_DESCARGAS);
        await p.esperar(`document.querySelector('#rep-vehiculo option[value="${v.id}"]')`, { que: 'opciones de vehículo' });
        await p.eval(`(() => { const s = document.querySelector('#rep-vehiculo'); s.value = '${v.id}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await p.click('#rep-csv-btn');
        await p.esperar(`window.__blobs.length === 1 && !document.querySelector('#rep-csv-btn').disabled`, { que: 'CSV generado', ms: 30000 });
        const filas = await p.eval(`window.__blobs[0].text().then(t => t.replace(/^\\uFEFF/, '').split(/\\r?\\n/).filter(Boolean).length - 1)`);
        assert.equal(filas, Number(v.n), `filas del CSV de ${v.patente}`);
        assert.match(await texto(p, '#rep-progress'), new RegExp(`^${Number(v.n).toLocaleString('es-UY')} filas|${v.n} filas`));
      });
    });
  }

  test('Mediciones / Flota / Clientes / Ficha (admin): muestran los datos de la base', async () => {
    const nVeh = Number(env.sql(`select count(*) from public.vehiculos where activo`));
    const nCri = Number(env.sql(`select count(*) from public.v_estado_neumaticos where estado = 'critico'`));
    await flujo(env, 'vistas-admin', 'admin', async p => {
      await irA(p, 'flota');
      await p.esperar(`/${nVeh}\\s*Vehículos activos/.test(document.querySelector('#view-flota').innerText.replace(/\\n+/g, ' '))`, { que: `Flota con ${nVeh} vehículos` });
      assert.match((await texto(p, '#view-flota')), new RegExp(`${nCri} Neumáticos críticos`));
      await irA(p, 'clientes');
      await p.esperar(`document.querySelectorAll('#view-clientes tbody tr').length === 2`, { que: '2 clientes' });
      const t = await texto(p, '#view-clientes');
      assert.match(t, /Demo Transportes/); assert.match(t, /Otra Empresa SA/);
      // La ficha se abre desde el nombre del cliente (no hay entrada propia en el menú).
      assert.equal(await p.eval(`document.querySelectorAll('.nav-item[data-view="ficha"]').length`), 0, 'Ficha no es una entrada del menú');
      await p.click('#view-clientes [data-action="abrirFichaCliente"]');
      await p.esperar(`document.querySelector('#view-ficha').classList.contains('active') && document.querySelector('#ficha-nombre').textContent !== 'Cliente'`, { que: 'ficha del cliente' });
      assert.equal(await p.eval(`document.querySelector('.nav-item.active').dataset.view`), 'clientes', 'la ficha resalta Clientes');
      assert.match(await texto(p, '#breadcrumb-current'), /\S/);
      await p.click('#ficha-volver');
      await p.esperar(`document.querySelector('#view-clientes').classList.contains('active')`, { que: 'volver a Clientes' });
      await irA(p, 'mediciones');
      await p.esperar(`document.querySelectorAll('#med-cliente-select option').length >= 3`, { que: 'clientes en Mediciones' });
      const demo = env.sql(`select id from public.clientes where nombre = 'Demo Transportes'`);
      await p.eval(`(() => { const s = document.querySelector('#med-cliente-select'); s.value = '${demo}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const veh = env.sql(`select id from public.vehiculos where patente = 'DEMO010'`);
      await p.esperar(`document.querySelector('#med-vehiculo-select option[value="${veh}"]')`, { que: 'DEMO010 en el selector' });
      await p.eval(`(() => { const s = document.querySelector('#med-vehiculo-select'); s.value = '${veh}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await p.esperar(`document.querySelector('#med-truck-card') && document.querySelector('#med-truck-card').getClientRects().length && document.querySelectorAll('#med-truck-card svg *').length > 10`, { que: 'camión dibujado en Mediciones' });
    });
  });

  test('Stock (global): los lotes anteriores se listan sin edición y las cubiertas con sus acciones; la sucursal no ve nada', async () => {
    const lotes = json(env, `select marca, cantidad from public.stock_neumaticos where cliente_id = (select id from public.clientes where nombre = 'Demo Transportes') order by marca`);
    assert.ok(lotes.length >= 3);
    const marcas = () => `[...document.querySelectorAll('#tbody-stock tr:not(.stock-asig-detail)')].map(r => r.cells[0] && r.cells[0].textContent.trim()).filter(Boolean).sort()`;
    await flujo(env, 'stock-global', 'global', async p => {
      await irA(p, 'stock');
      await p.esperar(`${marcas()}.length === ${lotes.length}`, { que: `${lotes.length} lotes de stock` });
      assert.deepEqual(await p.eval(marcas()), lotes.map(l => l.marca));
      assert.match(await texto(p, '#tbody-stock'), new RegExp(`0 / ${lotes[0].cantidad} ud\\.`));
      assert.equal(await p.eval(`document.querySelectorAll('#tbody-stock button[data-sa]').length`), 0, 'el cliente no edita ni elimina lotes');
      assert.equal(await p.eval(`!!document.querySelector('#stock-lotes [data-action="openStockModal"]').offsetParent`), false, 'el cliente no agrega lotes');
      await p.esperar(`document.querySelectorAll('#stk-lista .stk-fila').length > 0`, { que: 'cubiertas del cliente' });
    });
    await flujo(env, 'stock-seccional', 'salto', async p => {
      await irA(p, 'stock');
      await p.esperar(`/Sin cubiertas en stock/.test(document.querySelector('#stk-lista').innerText)`, { que: 'sin cubiertas para la sucursal' });
      assert.equal(await p.eval(`!!document.querySelector('#stock-lotes').offsetParent`), false, 'la sucursal no ve lotes de stock');
      assert.equal(await p.eval(`document.querySelectorAll('#stk-lista .stk-fila').length`), 0);
    });
  });
}
