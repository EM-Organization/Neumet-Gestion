// Inicio con datos reales: no vacío y con las cifras que dicen las vistas SQL para cada rol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo } from '../lib/flujo.mjs';
import { cifrasInicio, json, vehiculosVisibles } from '../lib/verdad.mjs';

// Lee de la pantalla de Inicio las proporciones, el contador de alertas, los dispositivos y las listas.
export const LEER_INICIO = `(() => {
  const c = document.querySelector('#inicio-contenido');
  const num = e => Number(e.textContent.replace(/\\D/g, ''));
  const cifras = [...c.querySelectorAll('.inicio-cifra strong')].map(num);
  const frase = (c.querySelector('#inicio-h-resumen') || {}).textContent || '';
  const alertas = c.querySelector('[data-action="irA"][data-args=\\'["alertas"]\\']');
  const linea = (c.querySelector('.inicio-linea') || {}).textContent || '';
  const atencion = [...c.querySelectorAll('#inicio-h-atencion ~ ul .inicio-fila')].map(f => ({
    patente: (f.querySelector('.dash-fleet-pat') || {}).textContent || '', critico: !!f.querySelector('.inicio-punto.critico') }));
  const proximos = [...c.querySelectorAll('#inicio-h-proximos ~ ul .inicio-fila')].map(f => ({ patente: (f.querySelector('.dash-fleet-pat') || {}).textContent || '' }));
  return { cifras, frase: frase.replace(/\\s+/g, ' ').trim(), alertas: alertas ? alertas.textContent : '', linea: linea.replace(/\\s+/g, ' ').trim(),
           atencion, proximos, texto: c.innerText, titulo: document.querySelector('#inicio-title').textContent,
           segmentos: c.querySelectorAll('.inicio-seg').length, cardsRojas: c.querySelectorAll('.badge.red').length };
})()`;

export const INICIO_LISTO = `document.querySelectorAll('#inicio-contenido .inicio-cifra').length === 4`;

export function registrar(env) {
  for (const rol of ['admin', 'global', 'salto', 'montevideo']) {
    test(`Inicio (${rol}): muestra datos y cifras coherentes con la base`, async () => {
      await flujo(env, 'inicio', rol, async p => {
        await p.esperar(INICIO_LISTO, { que: 'proporciones de Inicio' });
        const l = await p.eval(LEER_INICIO);
        const e = cifrasInicio(env, rol);
        assert.ok(e.alertas > 0 && e.criticos > 0, 'el demo debe tener alertas y críticos (si no, la prueba no prueba nada)');
        // Proporciones: OK, desgaste bajo, críticos, sin datos y total de neumáticos (misma definición que las vistas SQL).
        assert.deepEqual(l.cifras, [e.ok, e.bajo, e.criticos, e.sinDatos], `proporciones de Inicio (${rol})`);
        const m = l.frase.match(/^(?:(\d[\d.]*) de )?(\d[\d.]*) neumáticos? en buen estado$|^Los (\d[\d.]*) neumáticos están en buen estado$/);
        assert.ok(m, `frase de resumen inesperada: ${l.frase}`);
        const total = Number((m[2] || m[3]).replace(/\D/g, ''));
        assert.equal(total, e.total, 'total de neumáticos');
        if (m[1]) assert.equal(Number(m[1].replace(/\D/g, '')), e.ok, 'neumáticos en buen estado');
        assert.ok(l.segmentos >= 3, 'barra segmentada');
        // Alertas y dispositivos.
        assert.equal(Number(l.alertas.replace(/\D/g, '')), e.alertas, 'alertas activas en "Ver todas las alertas"');
        assert.equal(l.linea.startsWith(`Dispositivos: ${e.dispActivos} de ${e.dispTotal} activos`), true, `línea de dispositivos: ${l.linea}`);
        if (e.dispTotal > e.dispActivos) assert.match(l.linea, new RegExp(`${e.dispTotal - e.dispActivos} sin actividad`));
        // Requieren atención: solo vehículos del alcance; primero los que tienen neumáticos críticos, hasta el máximo de 6.
        const visibles = new Set((await vehiculosVisibles(env, rol)).map(v => v.patente));
        assert.ok(l.atencion.length > 0, 'lista de vehículos que requieren atención vacía');
        for (const f of l.atencion) assert.ok(visibles.has(f.patente), `${f.patente} no pertenece al alcance de ${rol}`);
        const criticosListados = Math.min(6, e.vehCriticos);
        assert.equal(l.atencion.filter(f => f.critico).length, criticosListados, 'vehículos críticos en la lista');
        assert.deepEqual(l.atencion.slice(0, criticosListados).map(f => f.critico), Array(criticosListados).fill(true), 'los críticos van primero');
        // Próximos cambios: acotado a 5 y dentro del alcance.
        assert.equal(l.proximos.length, Math.min(5, e.proximos), 'próximos cambios');
        for (const f of l.proximos) assert.ok(visibles.has(f.patente), `${f.patente} (próximos cambios) fuera del alcance de ${rol}`);
        assert.ok(!/Sin vehículos registrados/.test(l.texto), 'no debe decir "sin datos" teniendo datos');
        assert.equal(l.cardsRojas, 0, 'sin chips rojos en Inicio');
        if (rol === 'admin') {
          // Solo figuran los clientes con neumáticos críticos o alertas críticas (según v_resumen_flota_cliente).
          const conUrgencias = json(env, `select nombre from public.v_resumen_flota_cliente where n_critico + n_alertas_sev3 > 0 order by nombre`).map(c => c.nombre);
          assert.ok(conUrgencias.includes('Demo Transportes'), 'el demo debe tener urgencias');
          const bloque = l.texto.split('Clientes con más urgencias')[1] || '';
          for (const n of ['Demo Transportes', 'Otra Empresa SA']) assert.equal(bloque.includes(n), conUrgencias.includes(n), `cliente ${n} en "Clientes con más urgencias"`);
        }
        else assert.doesNotMatch(l.texto, /Clientes con más urgencias/);
        assert.equal(l.titulo, 'Inicio');
      });
    });
  }
}
