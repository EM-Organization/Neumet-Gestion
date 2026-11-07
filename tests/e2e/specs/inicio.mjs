// Inicio con datos reales: no vacío y con las cifras que dicen las vistas SQL para cada rol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo } from '../lib/flujo.mjs';
import { cifrasInicio, vehiculosVisibles } from '../lib/verdad.mjs';

export function registrar(env) {
  for (const rol of ['admin', 'global', 'salto', 'montevideo']) {
    test(`Inicio (${rol}): muestra datos y cifras coherentes con la base`, async () => {
      await flujo(env, 'inicio', rol, async p => {
        await p.esperar(`document.querySelectorAll('#inicio-contenido .atencion-card').length === 4`, { que: 'las 4 tarjetas de Inicio' });
        const lectura = await p.eval(`(() => {
          const t = {};
          document.querySelectorAll('#inicio-contenido .atencion-card').forEach(c => { t[c.querySelector('.atencion-titulo').textContent.trim()] = Number(c.querySelector('.atencion-n').textContent.replace(/\\D/g, '')); });
          return { t, filas: [...document.querySelectorAll('#inicio-contenido .atencion-veh .dash-fleet-pat')].map(e => e.textContent.trim()),
                   texto: document.querySelector('#inicio-contenido').innerText, titulo: document.querySelector('#inicio-title').textContent };
        })()`);
        const esperado = cifrasInicio(env, rol);
        assert.deepEqual(lectura.t, {
          'Neumáticos críticos': esperado.criticos, 'Alertas activas': esperado.alertas,
          'Dispositivos sin actividad': esperado.dispositivos, 'Vehículos sin medir': esperado.sinMedir
        }, `cifras de Inicio (${rol})`);
        assert.ok(esperado.alertas > 0, 'el demo debe tener alertas (si no, la prueba no prueba nada)');
        assert.ok(!/Todavía no hay/.test(lectura.texto), 'no debe decir "sin datos" teniendo datos');
        // "Vehículos que más urgen": solo vehículos de su alcance, ordenados con críticos antes que bajos.
        const visibles = new Set((await vehiculosVisibles(env, rol)).map(v => v.patente));
        assert.ok(lectura.filas.length > 0, 'lista de vehículos que urgen vacía');
        for (const pat of lectura.filas) assert.ok(visibles.has(pat), `${pat} no pertenece al alcance de ${rol}`);
        if (rol === 'admin') assert.match(lectura.texto, /Clientes con más urgencias[\s\S]*Demo Transportes[\s\S]*Otra Empresa SA|Clientes con más urgencias[\s\S]*Otra Empresa SA[\s\S]*Demo Transportes/);
        else assert.doesNotMatch(lectura.texto, /Clientes con más urgencias/);
        assert.equal(lectura.titulo, rol === 'admin' ? 'Inicio' : 'Hola, Demo Transportes');
      });
    });
  }
}
