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

  // Matrículas guardadas con guion o con espacios se encuentran escribiéndolas de cualquier forma (cliente "Otra Empresa SA").
  test('Buscador (otra): SAB-1234 se encuentra como SAB1234, sab 1234, sab-1234 y por número de coche', async () => {
    await flujo(env, 'buscador-guion', 'otra', async p => {
      await irA(p, 'vehiculos');
      await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length === 4`, { que: '4 vehículos de Otra Empresa' });
      for (const [q, esperado] of [['SAB-1234', ['SAB-1234']], ['SAB1234', ['SAB-1234']], ['sab 1234', ['SAB-1234']], ['sab-1234', ['SAB-1234']], ['1234', ['SAB-1234']], ['301', ['SAB-1234']],
        ['ab123cd', ['ab 123 cd']], ['AB-123-CD', ['ab 123 cd']], ['demo010', []]]) {
        await p.escribir('#search-vehiculos', q);
        await dormir(120);
        const halladas = (await filasVehiculos(p)).map(f => f.meta.split(' · ')[0]).sort();
        assert.deepEqual(halladas, esperado, `[otra] ${JSON.stringify(q)}`);
      }
    });
  });

  test('Buscador (admin): SAB-1234 y SAB1234 dan el mismo camión en la tabla', async () => {
    await flujo(env, 'buscador-guion-admin', 'admin', async p => {
      await irA(p, 'vehiculos');
      await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr .mono-cell').length >= 15`);
      for (const q of ['SAB-1234', 'SAB1234', 'sab 1234', '301']) {
        await p.escribir('#search-vehiculos', q);
        await dormir(120);
        assert.deepEqual(await p.eval(`[...document.querySelectorAll('#tbody-vehiculos tr .mono-cell')].map(e => e.textContent.trim())`), ['SAB-1234'], `[admin] ${q}`);
      }
    });
  });

  // Buscador global de la barra superior (se prueba desde Alertas) y el de Inicio: matrícula, número de coche y espacios.
  const ABRIR_GLOBAL = [['DEMO010', 'Camión 201'], ['demo 010', 'Camión 201'], ['110', 'Camión 201'], ['201', 'Camión 201']];
  for (const rol of ['global', 'salto']) {
    test(`Buscador global (${rol}): desde Alertas, Enter abre el detalle y Volver regresa a Alertas`, async () => {
      await flujo(env, 'buscador-global', rol, async p => {
        for (const [q, nombre] of ABRIR_GLOBAL) {
          await irA(p, 'alertas');
          await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/' });
          await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash' });
          assert.equal(await p.eval(`document.activeElement && document.activeElement.id`), 'busq-global-input', 'la tecla / enfoca el buscador');
          assert.equal(await p.eval(`document.querySelector('#busq-global-input').value`), '', 'la tecla / no escribe en el campo');
          await p.escribir('#busq-global-input', q);
          await p.enter();
          await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /DEMO010/.test(document.querySelector('#vd-cab').innerText)`, { que: `detalle tras buscar ${q}` });
          assert.match(await texto(p, '#vd-cab'), new RegExp(nombre));
          assert.equal(await p.eval(`document.querySelector('.nav-item.active').dataset.view`), 'vehiculos');
          assert.match(await texto(p, '#vd-volver'), /Volver a Alertas/);
          await p.click('#vd-volver');
          await p.esperar(`document.querySelector('#view-alertas').classList.contains('active')`);
        }
      });
    });

    test(`Buscador de Inicio (${rol}): varias coincidencias muestran lista; una abre el detalle`, async () => {
      await flujo(env, 'buscador-inicio', rol, async p => {
        await p.esperar(`document.querySelector('#busq-inicio-input') && document.querySelectorAll('#inicio-contenido .inicio-cifra').length === 4`);
        await p.escribir('#busq-inicio-input', 'demo01');
        await p.enter();
        await p.esperar(`document.querySelectorAll('#busq-inicio-res .busq-op').length > 1`, { que: 'lista de resultados' });
        assert.equal(await p.eval(`document.querySelector('#view-vehiculo-detalle').classList.contains('active')`), false, 'varias coincidencias no abren el detalle');
        await p.escribir('#busq-inicio-input', 'demo 010');
        await p.enter();
        await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /DEMO010/.test(document.querySelector('#vd-cab').innerText)`, { que: 'detalle de DEMO010' });
        assert.match(await texto(p, '#vd-volver'), /Volver a Inicio/);
      });
    });
  }

  test('Buscador global (salto): una matrícula de Montevideo o de otro cliente no se encuentra ni se abre', async () => {
    await flujo(env, 'buscador-global-ajeno', 'salto', async p => {
      await irA(p, 'alertas');
      for (const q of ['DEMO001', 'demo 005', '101', 'OTRA001', 'SAB-1234']) {
        await p.escribir('#busq-global-input', q);
        await p.enter();
        await p.esperar(`/Ningún vehículo coincide/.test(document.querySelector('#busq-global-res').innerText)`, { que: `sin resultados para ${q}` });
        assert.equal(await p.eval(`document.querySelector('#view-vehiculo-detalle').classList.contains('active')`), false, `${q} no debe abrir un detalle`);
      }
    });
  });

  test('Buscador global (otra): encuentra SAB-1234 como SAB1234 y abre su detalle', async () => {
    await flujo(env, 'buscador-global-otra', 'otra', async p => {
      await irA(p, 'stock');
      for (const q of ['SAB1234', 'sab-1234', '301']) {
        await irA(p, 'stock');
        await p.escribir('#busq-global-input', q);
        await p.enter();
        await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && /SAB-1234/.test(document.querySelector('#vd-cab').innerText)`, { que: `detalle tras buscar ${q}` });
      }
    });
  });
}
