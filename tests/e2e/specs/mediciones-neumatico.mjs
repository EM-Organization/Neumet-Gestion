// Las mediciones siguen al NEUMÁTICO, no a la posición: flujos reales por la interfaz con el cliente demo.
//   1. Cambiar un neumático crítico (ingresando uno nuevo): la rueda pasa a "sin datos", desaparece su alerta
//      crítica y el contador de Inicio baja; cuando el nuevo se mide, la posición toma SU valor y su gráfico no
//      arrastra los puntos del viejo.
//   2. Rotar dos ruedas: los mm, el color, el neumático y su historial acompañan al neumático.
// Modifican la base de prueba: usan camiones que ninguna otra prueba toca para comprobar valores (DEMO006 y DEMO005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { json, cifrasInicio } from '../lib/verdad.mjs';
import { INICIO_LISTO, LEER_INICIO } from './inicio.mjs';

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
const fila = (env, id, pos) => json(env, `select posicion, idneumatico, estado, round(promedio, 1)::text as mm, promedio, sin_medir, n_mediciones_90d, tasa_mm_semana
  from public.v_estado_neumaticos where vehiculo_id = ${id} and posicion = ${pos}`)[0];
const criticosAlerta = (env, id, pos) => Number(env.sql(`select count(*) from public.v_alertas where vehiculo_id = ${id} and posicion = ${pos} and tipo = 'critico'`));
const mmUi = mm => (mm === null ? '—' : mm.replace('.', ','));

// Lo que dibuja el diagrama para una rueda: texto de mm, relleno (color/patrón) y etiqueta accesible.
const rueda = (p, pos) => p.eval(`(() => { const g = document.querySelector('#vd-diagrama .vd-rueda[data-pos="${pos}"]');
  return g && { mm: g.querySelector('.vd-mm').textContent, fill: g.querySelector('rect.vd-goma').getAttribute('fill'), aria: g.getAttribute('aria-label') }; })()`);

// Neumáticos críticos que muestra Inicio (proporciones: OK, bajo, críticos, sin datos).
const criticosInicio = async p => {
  await p.esperar(INICIO_LISTO, { que: 'proporciones de Inicio' });
  return (await p.eval(LEER_INICIO)).cifras[2];
};

// Filas de la tabla de alertas de un camión: [{tipo, posicion}]
const alertasUi = async (p, patente) => {
  await irA(p, 'alertas');
  await p.esperar(`/\\d+ alertas?/.test(document.querySelector('#alert-count').textContent)`, { que: 'tabla de alertas' });
  return p.eval(`[...document.querySelectorAll('#alert-tbody tr')].filter(r => r.innerText.includes(${JSON.stringify(patente)}))
    .map(r => ({ tipo: r.dataset.tipo, posicion: r.children[4].textContent.trim() }))`);
};

async function seleccionarRueda(p, pos) {
  await p.click(`#vd-diagrama .vd-rueda[data-pos="${pos}"]`);
  await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && document.querySelector('#vd-rotar-btn') && document.querySelector('#vd-rotar-btn').dataset.posicion === '${pos}'`, { que: `panel de la rueda ${pos}` });
}

export function registrar(env) {
  test('Cambio de un neumático crítico (global): la rueda nueva pasa a sin datos, cae la alerta crítica y el contador de Inicio', async () => {
    const patente = 'DEMO006', pos = 2, id = vehId(env, patente);
    const antes = fila(env, id, pos);
    assert.equal(antes.estado, 'critico', 'el demo trae P2 de DEMO006 crítica');
    assert.equal(criticosAlerta(env, id, pos), 1);
    const viejoIdn = antes.idneumatico;
    const nViejas = Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${viejoIdn}'`));
    assert.ok(nViejas >= 5, 'el viejo tiene historial');
    const criticos0 = cifrasInicio(env, 'global').criticos;

    await flujo(env, 'cambio-critico', 'global', async p => {
      assert.equal(await criticosInicio(p), criticos0, 'Inicio cuenta la rueda crítica antes del cambio');
      await abrirDetallePorMatricula(p, patente);
      const r0 = await rueda(p, pos);
      assert.equal(r0.mm, mmUi(antes.mm), 'antes del cambio la rueda muestra los mm del viejo');
      assert.match(r0.aria, /Crítico/);
      await seleccionarRueda(p, pos);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show') && /P${pos}/.test(document.querySelector('#cambio-actual').textContent)`, { que: 'modal de cambio' });
      await p.eval(`document.querySelector('input[name="cambio-origen"][value="nuevo"]').click()`);
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="baja"]').click()`);
      await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('#cambio-motivo', 'Desgaste E2E'); set('#cambio-marca', 'MarcaMed'); set('#cambio-modelo', 'Modelo M'); })()`);
      await p.click('#cambio-confirmar');
      await p.esperar(`/Cambio registrado en P${pos}/.test(document.querySelector('#toast-msg').textContent) && !document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'cambio registrado' });
      // El detalle se recarga: la rueda nueva figura sin datos (no hereda los mm del viejo)
      await p.esperar(`(() => { const g = document.querySelector('#vd-diagrama .vd-rueda[data-pos="${pos}"]'); return g && g.querySelector('.vd-mm').textContent === '—'; })()`, { que: 'la rueda nueva sin datos' });
      const r1 = await rueda(p, pos);
      assert.equal(r1.fill, 'url(#vd-sin-datos)');
      assert.match(r1.aria, /sin datos/);
      // Panel: sin medición ni gráfico del viejo
      await seleccionarRueda(p, pos);
      await p.esperar(`/todavía no tiene mediciones/.test(document.querySelector('#vd-panel').textContent)`, { que: 'el panel dice que no tiene mediciones' });
      await p.esperar(`/Sin mediciones para graficar/.test(document.querySelector('#vd-chart-wrap').textContent)`, { que: 'sin gráfico heredado' });
    });

    const despues = fila(env, id, pos);
    assert.equal(despues.estado, 'sin_datos');
    assert.equal(despues.promedio, null);
    assert.equal(despues.sin_medir, true);
    assert.equal(despues.n_mediciones_90d, 0, 'la tasa del nuevo no mezcla puntos del viejo');
    assert.notEqual(despues.idneumatico, viejoIdn);
    assert.equal(criticosAlerta(env, id, pos), 0);
    assert.equal(Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${viejoIdn}'`)), nViejas, 'el historial del viejo se conserva');
    assert.equal(cifrasInicio(env, 'global').criticos, criticos0 - 1);

    // Sesión nueva: Inicio y Alertas ya no cuentan la rueda
    await flujo(env, 'cambio-critico-verifica', 'global', async p => {
      assert.equal(await criticosInicio(p), criticos0 - 1, 'el contador de críticos de Inicio baja en uno');
      const al = await alertasUi(p, patente);
      assert.ok(!al.some(a => a.tipo === 'critico' && a.posicion === String(pos)), `ya no hay alerta crítica en P${pos}: ${JSON.stringify(al)}`);
      assert.ok(al.some(a => a.tipo === 'sin_medir' && a.posicion === String(pos)), 'figura como montado sin medir');
    });

    // El neumático nuevo se mide (como lo haría el proveedor): la posición toma SU valor
    env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, device_id, posicion, mm1, mm2, mm3, promedio, idneumatico)
      select ${id}, cliente_id, 'e2e', ${pos}, 11, 11, 11, 11, idneumatico from public.neumaticos where vehiculo_id = ${id} and posicion = ${pos}`);
    const medido = fila(env, id, pos);
    assert.equal(medido.estado, 'ok');
    assert.equal(medido.mm, '11.0');
    await flujo(env, 'cambio-critico-medido', 'global', async p => {
      await abrirDetallePorMatricula(p, patente);
      assert.equal((await rueda(p, pos)).mm, '11,0');
      assert.match((await rueda(p, pos)).aria, /OK/);
      await seleccionarRueda(p, pos);
      await p.esperar(`/1 medición/.test(document.querySelector('#vd-chart-wrap').getAttribute('aria-label') || document.querySelector('#vd-chart-wrap .vd-chart')?.getAttribute('aria-label') || '')`, { que: 'gráfico con un solo punto (el del nuevo)' });
      const panel = await p.eval(`document.querySelector('#vd-panel').innerText.replace(/\\s+/g, ' ')`);
      assert.match(panel, /Montaje/, 'el historial del nuevo muestra su montaje');
      assert.doesNotMatch(panel, /Baja|Dado de baja/, 'el historial no muestra la baja del viejo');
      assert.ok(panel.includes(medido.idneumatico), 'el panel muestra el idneumatico del nuevo');
    });
  });

  test('Rotación (global): los mm, el color y el historial acompañan al neumático', async () => {
    const patente = 'DEMO005', a = 4, b = 1, id = vehId(env, patente);
    const antesA = fila(env, id, a), antesB = fila(env, id, b);
    assert.equal(antesA.estado, 'bajo');
    assert.notEqual(antesB.mm, antesA.mm, 'los dos neumáticos tienen mediciones distintas');
    const nMedA = Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${antesA.idneumatico}'`));
    const rotaciones0 = Number(env.sql(`select count(*) from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'rotacion'`));

    await flujo(env, 'rotar-acompana', 'global', async p => {
      await abrirDetallePorMatricula(p, patente);
      const ra = await rueda(p, a), rb = await rueda(p, b);
      assert.equal(ra.mm, mmUi(antesA.mm));
      assert.equal(rb.mm, mmUi(antesB.mm));
      assert.notEqual(ra.fill, rb.fill, 'ok y bajo tienen distinto color');
      await seleccionarRueda(p, a);
      await p.eval(`(() => { const s = document.querySelector('#vd-rotar-destino'); s.value = '${b}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await p.click('#vd-rotar-btn');
      await p.esperar(`document.querySelector('#modal-confirm').classList.contains('show')`, { que: 'confirmación del intercambio' });
      await p.click('#confirm-ok');
      await p.esperar(`/Rotación registrada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'rotación registrada' });
      // Tras recargar, cada medición viaja con su neumático: el color y los mm se intercambian
      await p.esperar(`(() => { const g = document.querySelector('#vd-diagrama .vd-rueda[data-pos="${b}"]'); return g && g.querySelector('.vd-mm').textContent === ${JSON.stringify(mmUi(antesA.mm))}; })()`, { que: `P${b} con los mm del neumático que vino de P${a}` });
      const ra2 = await rueda(p, a), rb2 = await rueda(p, b);
      assert.equal(rb2.mm, mmUi(antesA.mm));
      assert.equal(ra2.mm, mmUi(antesB.mm));
      assert.equal(rb2.fill, ra.fill, `P${b} toma el color que tenía el neumático de P${a}`);
      assert.equal(ra2.fill, rb.fill, `P${a} toma el color que tenía el neumático de P${b}`);
      assert.match(rb2.aria, /Desgaste bajo/);
      // Panel de la posición nueva del neumático: su idneumatico y su gráfico completo
      await seleccionarRueda(p, b);
      const panel = await p.eval(`document.querySelector('#vd-panel').innerText.replace(/\\s+/g, ' ')`);
      assert.ok(panel.includes(antesA.idneumatico), 'el panel muestra el neumático que se movió');
      await p.esperar(`/${nMedA} mediciones/.test((document.querySelector('#vd-chart-wrap .vd-chart') || {getAttribute: () => ''}).getAttribute('aria-label') || '')`, { que: `gráfico con las ${nMedA} mediciones del neumático` });
      assert.match(panel, /Rotación/, 'el historial del neumático muestra la rotación');
    });

    const dA = fila(env, id, a), dB = fila(env, id, b);
    assert.deepEqual([dB.idneumatico, dB.mm, dB.estado], [antesA.idneumatico, antesA.mm, 'bajo']);
    assert.deepEqual([dA.idneumatico, dA.mm], [antesB.idneumatico, antesB.mm]);
    assert.equal(dB.tasa_mm_semana, antesA.tasa_mm_semana, 'la tasa de desgaste acompaña al neumático');
    assert.equal(Number(env.sql(`select count(*) from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'rotacion'`)), rotaciones0 + 2);

    await flujo(env, 'rotar-acompana-alertas', 'global', async p => {
      const al = await alertasUi(p, patente);
      assert.ok(al.some(x => x.tipo === 'bajo' && x.posicion === String(b)), `la alerta de desgaste bajo se movió a P${b}: ${JSON.stringify(al)}`);
      assert.ok(!al.some(x => x.tipo === 'bajo' && x.posicion === String(a)), `P${a} ya no tiene la alerta`);
    });
  });
}
