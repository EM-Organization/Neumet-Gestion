// Detalle de vehículo con datos reales: cada rueda dibujada coincide con lo que dicen las vistas SQL
// (posición, mm, estado, color) y el auxilio aparece solo en los camiones que lo tienen montado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula, texto, irA } from '../lib/flujo.mjs';
import { json, vehiculosVisibles } from '../lib/verdad.mjs';
import { nombrePos } from '../../../assets/js/domain/cambio-neumatico.js';
import { ESTADOS, estadoDeBase } from '../../../assets/js/domain/estado-desgaste.js';

const tipoDe = (env, patente) => Number(env.sql(`select tipo_ruedas from public.vehiculos where patente = '${patente}'`));

// Estado de la spec (docs/21) que corresponde al estado de la base: el estado se decide con el valor CRUDO de la base y el
// número se muestra TRUNCADO a un decimal (7,97 -> «7,9», pero «poco desgaste»). Color por tokens `--est-*`, no por atributo.
const estadoUi = estadoBase => ESTADOS[estadoDeBase(estadoBase)];

// Rueda esperada según la base: posición -> {mm, nivel}
function ruedasEsperadas(env, vehiculoId) {
  const filas = json(env, `select e.posicion, trunc(round(e.promedio, 2), 1)::text as mm, e.promedio, e.estado
    from public.v_estado_neumaticos e where e.vehiculo_id = ${vehiculoId}`);
  const aux = json(env, `select 1 from public.neumaticos where vehiculo_id = ${vehiculoId} and posicion = 99 and estado = 'montado'`).length > 0;
  const porPos = new Map(filas.map(f => [f.posicion, f]));
  const pos = [...Array(10)].map((_, i) => i + 1).concat(aux ? [99] : []);
  return pos.map(p => {
    const f = porPos.get(p);
    if (!f) return { pos: p, mm: null, nivel: 'vacia' }; // posición sin neumático montado: rueda punteada «vacía»
    if (f.promedio === null) return { pos: p, mm: null, nivel: 'desconocido' };
    return { pos: p, mm: f.mm.replace('.', ','), nivel: f.estado };
  });
}

// '#E4EAD3' -> 'rgb(228,234,211)' (lo que devuelve getComputedStyle)
const hexARgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h); return m ? `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})` : h; };

export function registrar(env) {
  for (const rol of ['global', 'salto']) {
    test(`Detalle (${rol}): las ruedas de cada camión coinciden con la base (mm, estado y color)`, async () => {
      const vehiculos = await vehiculosVisibles(env, rol);
      assert.ok(vehiculos.length >= 5);
      let conAuxilio = 0, sinDatos = 0, vacias = 0, criticas = 0;
      await flujo(env, 'detalle', rol, async p => {
        for (const v of vehiculos) {
          await abrirDetallePorMatricula(p, v.patente);
          assert.match(await texto(p, '#vd-cab'), new RegExp(v.patente), `cabecera de ${v.patente}`);
          const dibujadas = await p.eval(`[...document.querySelectorAll('#vd-diagrama .vd-rueda')].map(g => ({
            pos: Number(g.dataset.pos), clase: g.getAttribute('class'), vacia: g.classList.contains('vd-vacia'),
            fill: getComputedStyle(g.querySelector('rect.vd-goma')).fill,
            token: ['bueno', 'poco', 'mayor', 'sinDatos'].reduce((o, k) => ({ ...o, [k]: getComputedStyle(document.documentElement).getPropertyValue('--est-' + k + '-fill').trim() }), {}),
            mm: (g.querySelector('.vd-mm') || {}).textContent, aria: g.getAttribute('aria-label') }))`);
          const esperadas = ruedasEsperadas(env, v.id);
          assert.deepEqual(dibujadas.map(r => r.pos).sort((a, b) => a - b), esperadas.map(r => r.pos), `[${v.patente}] posiciones dibujadas`);
          for (const e of esperadas) {
            const d = dibujadas.find(r => r.pos === e.pos);
            const quien = `[${v.patente}] P${e.pos}`;
            if (e.nivel === 'vacia') {
              vacias++;
              assert.equal(d.vacia, true, `${quien} vacía: rueda punteada`);
              assert.doesNotMatch(d.clase, /\best-/, `${quien} vacía: sin estilo de desgaste`);
              assert.equal(d.mm, undefined, quien);
              assert.match(d.aria, /vacía/, quien);
              continue;
            }
            assert.equal(d.vacia, false, `${quien} tiene neumático: no es una rueda vacía`);
            if (e.nivel === 'desconocido') {
              sinDatos++;
              assert.match(d.clase, /\best-sinDatos\b/, `${quien} sin datos: estilo propio`);
              assert.match(d.fill, /vd-sin-datos/, `${quien} sin datos: patrón`);
              assert.equal(d.mm, '—', quien);
              assert.match(d.aria, /sin datos/, quien);
              continue;
            }
            const est = estadoUi(e.nivel);
            assert.equal(d.mm, e.mm, `${quien} mm (truncado a 1 decimal)`);
            assert.ok(d.aria.includes(`${e.mm} milímetros, ${est.texto.toLowerCase()}`), `${quien} etiqueta accesible: ${d.aria}`);
            // «Desgaste límite» tiene nombre propio pero usa el estilo (tokens) de «Mayor desgaste»
            assert.match(d.clase, new RegExp(`\\best-${est.estilo}\\b`), `${quien} clase de estado`);
            assert.equal(d.fill.replace(/\s/g, '').toLowerCase(), hexARgb(d.token[est.estilo]), `${quien} color = token --est-${est.estilo}-fill`);
            if (e.nivel === 'desgaste_limite') criticas++;
          }
          if (esperadas.some(r => r.pos === 99)) {
            conAuxilio++;
            assert.match(await texto(p, '#vd-diagrama'), /AUX/, `${v.patente}: falta el auxilio`);
          } else assert.doesNotMatch(await texto(p, '#vd-diagrama'), /AUX/, `${v.patente}: no debería dibujar auxilio`);
          await p.click('#breadcrumb-parent');
          await p.esperar(`document.querySelector('#view-vehiculos').classList.contains('active')`);
        }
      });
      // El demo tiene camiones con auxilio, ruedas sin datos y neumáticos críticos: la prueba debe haberlos visto.
      assert.ok(criticas >= 1, 'no se vio ninguna rueda crítica');
      assert.ok(sinDatos + vacias >= 1, 'no se vio ninguna rueda sin datos ni posición vacía');
      if (rol === 'global') assert.ok(sinDatos >= 1 && vacias >= 1, 'el demo trae ruedas sin datos y posiciones sin neumático');
      if (rol === 'global') assert.equal(conAuxilio, 4, 'camiones con auxilio del demo (DEMO001, 004, 009 y 012)');
    });
  }

  test('Detalle (global): DEMO010 dibuja 10 ruedas, sin auxilio, y la rueda 5 está en desgaste límite', async () => {
    await flujo(env, 'detalle-demo010', 'global', async p => {
      await abrirDetallePorMatricula(p, 'DEMO010');
      const r = await p.eval(`[...document.querySelectorAll('#vd-diagrama .vd-rueda')].map(g => g.dataset.pos + ':' + g.getAttribute('aria-label'))`);
      assert.equal(r.length, 10);
      assert.ok(r.find(x => x.startsWith('5:')).includes('desgaste límite'));
      assert.equal(r.filter(x => x.includes('desgaste límite')).length, 1);
      // Panel de la rueda en desgaste límite con teclado: muestra posición, estado y acciones del taller.
      await p.click('#vd-diagrama .vd-rueda[data-pos="5"]');
      await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto')`);
      const panel = await texto(p, '#vd-panel');
      // El título nombra la posición (el operario no maneja «P5»); el código queda como apoyo en el subtítulo
      assert.match(panel, new RegExp(nombrePos(5, tipoDe(env, 'DEMO010'))));
      assert.match(panel, /\bP5\b/);
      assert.doesNotMatch(panel, /Posición 5/);
      assert.match(panel, /Desgaste límite/);
      assert.ok(await p.eval(`!!document.querySelector('#vd-panel [data-action="neumatico-cambiar"]') && !!document.querySelector('#vd-panel [data-action="neumatico-rotar-pos"]')`));
    });
  });

  test('Detalle (global): ?vehiculo=ID&pos=N abre el detalle con la rueda preseleccionada', async () => {
    const vehiculos = await vehiculosVisibles(env, 'global');
    const v = vehiculos[0];
    const posiciones = json(env, `select e.posicion from public.v_estado_neumaticos e where e.vehiculo_id = ${v.id} order by e.posicion`);
    assert.ok(posiciones.length > 0, 'el vehículo de prueba tiene al menos una posición');
    const pos = posiciones[0].posicion;
    await flujo(env, 'detalle-url', 'global', async p => {
      await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && document.querySelectorAll('#vd-diagrama .vd-rueda').length > 0`, { que: 'detalle activo' });
      assert.match(await texto(p, '#vd-cab'), new RegExp(v.patente));
      const sel = await p.eval(`const g = document.querySelector('#vd-diagrama .vd-rueda.sel'); g ? Number(g.dataset.pos) : null`);
      assert.equal(sel, pos, 'la rueda de la URL queda seleccionada');
      await p.click('.nav-item[data-view="inicio"]');
      await p.esperar(`document.querySelector('#view-inicio').classList.contains('active')`, { que: 'vuelta a Inicio' });
      assert.equal(await p.eval('location.search'), '', 'se limpia el query al salir del detalle');
    }, { ruta: `/adminpanel/index.html?vehiculo=${v.id}&pos=${pos}` });
  });

  test('Detalle (global): URL con vehículo inexistente cae a Inicio limpiando el query', async () => {
    await flujo(env, 'detalle-url-inexistente', 'global', async p => {
      await p.esperar(`document.querySelector('#view-inicio').classList.contains('active')`, { que: 'Inicio activo tras URL inválida' });
      assert.equal(await p.eval('location.search'), '', 'se limpia el query huérfano');
    }, { ruta: '/adminpanel/index.html?vehiculo=999999&pos=1' });
  });

  test('Detalle (global): la miga desde Alertas dice Alertas y regresa en 1 clic', async () => {
    await flujo(env, 'detalle-miga-alertas', 'global', async p => {
      await irA(p, 'alertas');
      await p.esperar(`document.querySelectorAll('#alert-tbody tr[data-severidad]').length > 0`, { que: 'lista de alertas' });
      await p.click('#alert-tbody tr[data-severidad="3"] [data-action="verVehiculo"]');
      await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active')`, { que: 'detalle desde Alertas' });
      assert.match(await texto(p, '#breadcrumb-parent'), /Alertas/, 'la miga nombra Alertas');
      await p.click('#breadcrumb-parent');
      await p.esperar(`document.querySelector('#view-alertas').classList.contains('active')`, { que: 'vuelta a Alertas por la miga' });
    });
  });
}
