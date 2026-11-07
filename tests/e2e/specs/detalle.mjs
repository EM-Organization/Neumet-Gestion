// Detalle de vehículo con datos reales: cada rueda dibujada coincide con lo que dicen las vistas SQL
// (posición, mm, estado, color) y el auxilio aparece solo en los camiones que lo tienen montado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula, texto } from '../lib/flujo.mjs';
import { json, vehiculosVisibles } from '../lib/verdad.mjs';

const ETIQUETA = { ok: 'OK', bajo: 'Desgaste bajo', critico: 'Crítico', retiro: 'Retirar' };

// Rueda esperada según la base: posición -> {mm, nivel}
function ruedasEsperadas(env, vehiculoId) {
  const filas = json(env, `select e.posicion, round(e.promedio, 1)::text as mm, e.promedio, e.estado, e.umbral_retiro_mm
    from public.v_estado_neumaticos e where e.vehiculo_id = ${vehiculoId}`);
  const aux = json(env, `select 1 from public.neumaticos where vehiculo_id = ${vehiculoId} and posicion = 99 and estado = 'montado'`).length > 0;
  const porPos = new Map(filas.map(f => [f.posicion, f]));
  const pos = [...Array(10)].map((_, i) => i + 1).concat(aux ? [99] : []);
  return pos.map(p => {
    const f = porPos.get(p);
    if (!f || f.promedio === null) return { pos: p, mm: null, nivel: 'sin_datos' };
    const nivel = f.estado === 'critico' && Number(f.promedio) <= Number(f.umbral_retiro_mm) ? 'retiro' : f.estado;
    return { pos: p, mm: f.mm.replace('.', ','), nivel };
  });
}

export function registrar(env) {
  for (const rol of ['global', 'salto']) {
    test(`Detalle (${rol}): las ruedas de cada camión coinciden con la base (mm, estado y color)`, async () => {
      const vehiculos = await vehiculosVisibles(env, rol);
      assert.ok(vehiculos.length >= 5);
      let conAuxilio = 0, sinDatos = 0, criticas = 0, verde = null; // verde: el color de "ok" (la paleta puede cambiar; debe ser uno solo)
      await flujo(env, 'detalle', rol, async p => {
        for (const v of vehiculos) {
          await abrirDetallePorMatricula(p, v.patente);
          assert.match(await texto(p, '#vd-cab'), new RegExp(v.patente), `cabecera de ${v.patente}`);
          const dibujadas = await p.eval(`[...document.querySelectorAll('#vd-diagrama .vd-rueda')].map(g => ({
            pos: Number(g.dataset.pos), fill: g.querySelector('rect.vd-goma').getAttribute('fill'),
            mm: g.querySelector('.vd-mm').textContent, aria: g.getAttribute('aria-label') }))`);
          const esperadas = ruedasEsperadas(env, v.id);
          assert.deepEqual(dibujadas.map(r => r.pos).sort((a, b) => a - b), esperadas.map(r => r.pos), `[${v.patente}] posiciones dibujadas`);
          for (const e of esperadas) {
            const d = dibujadas.find(r => r.pos === e.pos);
            const quien = `[${v.patente}] P${e.pos}`;
            if (e.nivel === 'sin_datos') {
              sinDatos++;
              assert.equal(d.fill, 'url(#vd-sin-datos)', `${quien} sin datos: patrón`);
              assert.equal(d.mm, '—', quien);
              assert.match(d.aria, /sin datos/, quien);
              continue;
            }
            assert.equal(d.mm, e.mm, `${quien} mm`);
            assert.ok(d.aria.includes(`${e.mm} milímetros, ${ETIQUETA[e.nivel]}.`), `${quien} etiqueta accesible: ${d.aria}`);
            if (e.nivel === 'ok') { verde ??= d.fill; assert.equal(d.fill, verde, `${quien} mismo color que las demás ruedas OK`); }
            else { assert.match(d.fill, /^#[0-9a-f]{6}$/, quien); assert.notEqual(d.fill, verde, `${quien} no es el color de OK`); }
            if (e.nivel === 'critico' || e.nivel === 'retiro') criticas++;
          }
          if (esperadas.some(r => r.pos === 99)) {
            conAuxilio++;
            assert.match(await texto(p, '#vd-diagrama'), /AUX/, `${v.patente}: falta el auxilio`);
          } else assert.doesNotMatch(await texto(p, '#vd-diagrama'), /AUX/, `${v.patente}: no debería dibujar auxilio`);
          await p.click('[data-action="detalleVolver"]');
          await p.esperar(`document.querySelector('#view-vehiculos').classList.contains('active')`);
        }
      });
      // El demo tiene camiones con auxilio, ruedas sin datos y neumáticos críticos: la prueba debe haberlos visto.
      assert.ok(criticas >= 1, 'no se vio ninguna rueda crítica');
      assert.ok(sinDatos >= 1, 'no se vio ninguna rueda sin datos');
      if (rol === 'global') assert.equal(conAuxilio, 4, 'camiones con auxilio del demo (DEMO001, 004, 009 y 012)');
    });
  }

  test('Detalle (global): DEMO010 dibuja 10 ruedas, sin auxilio, y la rueda 5 es la crítica', async () => {
    await flujo(env, 'detalle-demo010', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO010');
      const r = await p.eval(`[...document.querySelectorAll('#vd-diagrama .vd-rueda')].map(g => g.dataset.pos + ':' + g.getAttribute('aria-label'))`);
      assert.equal(r.length, 10);
      assert.ok(r.find(x => x.startsWith('5:')).includes('Crítico'));
      assert.equal(r.filter(x => x.includes('Crítico')).length, 1);
      // Panel de la rueda crítica con teclado: muestra posición, estado y acciones del taller.
      await p.click('#vd-diagrama .vd-rueda[data-pos="5"]');
      await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto')`);
      const panel = await texto(p, '#vd-panel');
      assert.match(panel, /Posición 5/);
      assert.match(panel, /Crítico/);
      assert.ok(await p.eval(`!!document.querySelector('#vd-panel [data-action="neumatico-cambiar"]') && !!document.querySelector('#vd-panel [data-action="neumatico-rotar-pos"]')`));
    });
  });
}
