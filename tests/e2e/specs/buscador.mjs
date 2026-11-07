// Buscador de vehículos con datos reales: matrícula completa, parcial, con espacios/minúsculas y número de coche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, filasVehiculos, irA, dormir, texto } from '../lib/flujo.mjs';
import { vehiculosVisibles } from '../lib/verdad.mjs';

// Consultas y matrículas que deben aparecer (las DEMO0xx son las del seed; se recorta al alcance de cada rol).
// 'DEMO010' es el "Camión 201" (coche 110): "201" coincide con el nombre y "110" con el número de coche.
const CASOS = [
  ['DEMO010', ['DEMO010']],
  ['demo010', ['DEMO010']],
  ['  demo 010  ', ['DEMO010']],
  ['d e m o 0 1 0', ['DEMO010']],
  ['demo01', ['DEMO010', 'DEMO011', 'DEMO012', 'DEMO013', 'DEMO014']],
  ['DEMO00', ['DEMO001', 'DEMO002', 'DEMO003', 'DEMO004', 'DEMO005', 'DEMO006', 'DEMO007', 'DEMO008', 'DEMO009']],
  ['201', ['DEMO010']],
  ['110', ['DEMO010']],
  ['camion 205', ['DEMO014']],
  ['Camión 101', ['DEMO001']],
  ['101', ['DEMO001']],
  ['OTRA001', []], // vehículo de otro cliente: no existe para ninguna sesión de Demo
  ['zzz', []]
];

export function registrar(env) {
  for (const rol of ['global', 'salto', 'montevideo']) {
    test(`Buscador (${rol}): encuentra por matrícula, parcial, espacios/minúsculas y número de coche`, async () => {
      const visibles = new Set((await vehiculosVisibles(env, rol)).map(v => v.patente));
      await flujo(env, 'buscador', rol, async p => {
        await irA(p, 'vehiculos');
        await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length === ${visibles.size}`, { que: `${visibles.size} vehículos en la lista` });
        for (const [q, patentes] of CASOS) {
          const esperadas = patentes.filter(x => visibles.has(x)).sort();
          await p.escribir('#search-vehiculos', q);
          await dormir(120);
          const filas = await filasVehiculos(p);
          const halladas = filas.map(f => f.meta.split(' · ')[0]).sort();
          assert.deepEqual(halladas, esperadas, `[${rol}] búsqueda ${JSON.stringify(q)}`);
          if (!esperadas.length) assert.match(await texto(p, '#veh-lista'), /Ningún vehículo coincide/, `[${rol}] ${JSON.stringify(q)} sin resultado debe explicarlo`);
        }
      });
    });
  }

  for (const rol of ['global', 'salto']) {
    test(`Buscador (${rol}): Enter con una coincidencia exacta abre el detalle del camión`, async () => {
      await flujo(env, 'buscador-enter', rol, async p => {
        await irA(p, 'vehiculos');
        await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length > 0`);
        for (const q of ['DEMO010', 'demo 010', '110']) {
          await p.escribir('#search-vehiculos', q);
          await p.enter();
          await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && document.querySelector('#vd-cab')`, { que: `detalle tras buscar ${q}` });
          await p.esperar(`/DEMO010/.test(document.querySelector('#vd-cab').innerText)`, { que: 'cabecera del Camión 201' });
          assert.match(await texto(p, '#vd-cab'), /Camión 201/);
          await p.click('[data-action="detalleVolver"]');
          await p.esperar(`document.querySelector('#view-vehiculos').classList.contains('active')`);
        }
        // Tecla Enter con una búsqueda parcial que da varios resultados: no abre nada.
        await p.escribir('#search-vehiculos', 'demo01');
        await p.enter();
        await dormir(400);
        assert.equal(await p.eval(`document.querySelector('#view-vehiculos').classList.contains('active')`), true);
      });
    });
  }

  test('Buscador (admin): la tabla de administración filtra por matrícula y número de coche', async () => {
    await flujo(env, 'buscador', 'admin', async p => {
      await irA(p, 'vehiculos');
      await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr').length >= 15`, { que: 'todos los vehículos en la tabla' });
      const nombres = () => p.eval(`[...document.querySelectorAll('#tbody-vehiculos tr .name-cell')].map(e => e.textContent.trim().slice(1))`);
      const patentes = () => p.eval(`[...document.querySelectorAll('#tbody-vehiculos tr .mono-cell')].map(e => e.textContent.trim())`);
      for (const [q, esperado] of [['DEMO010', ['DEMO010']], ['demo 010', ['DEMO010']], ['110', ['DEMO010']], ['OTRA001', ['OTRA001']], ['demo01', ['DEMO010', 'DEMO011', 'DEMO012', 'DEMO013', 'DEMO014']]]) {
        await p.escribir('#search-vehiculos', q);
        await dormir(120);
        assert.deepEqual((await patentes()).sort(), esperado, `[admin] ${q}`);
      }
      await p.escribir('#search-vehiculos', '201');
      await dormir(120);
      assert.deepEqual(await nombres(), ['Camión 201'].map(n => n.slice(0)));
    });
  });
}
