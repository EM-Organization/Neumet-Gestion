// Las mediciones siguen al NEUMÁTICO, no a la posición: flujos reales por la interfaz con el cliente demo.
//   1. Cambiar un neumático en desgaste límite (ingresando uno nuevo): la rueda pasa a "desconocido", desaparece su alerta
//      de desgaste límite y el contador de Inicio baja; cuando el nuevo se mide, la posición toma SU valor y su gráfico no
//      arrastra los puntos del viejo.
//   2. Rotar dos ruedas: los mm, el color, el neumático y su historial acompañan al neumático.
// Modifican la base de prueba: usan camiones que ninguna otra prueba toca para comprobar valores (DEMO006 y DEMO005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { json, cifrasInicio } from '../lib/verdad.mjs';
import { nombrePos, avisoRotacion } from '../../../assets/js/domain/cambio-neumatico.js';
import { etiquetaCoche } from '../../../assets/js/domain/coche.js';
import { INICIO_LISTO, LEER_INICIO } from './inicio.mjs';

const vehId = (env, patente) => Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
// `mm` es la huella MÍNIMA (la que la rueda muestra y decide, RN-01); `promedio` queda como dato informativo.
const fila = (env, id, pos) => json(env, `select posicion, idneumatico, estado, trunc(round(minimo, 2), 1)::text as mm, minimo, promedio, sin_medir, n_mediciones_90d, tasa_mm_semana
  from public.v_estado_neumaticos where vehiculo_id = ${id} and posicion = ${pos}`)[0];
const limiteAlerta = (env, id, pos) => Number(env.sql(`select count(*) from public.v_alertas where vehiculo_id = ${id} and posicion = ${pos} and tipo = 'limite'`));
const mmUi = mm => (mm === null ? '—' : mm.replace('.', ','));

// Lo que dibuja el diagrama para una rueda: texto de mm, relleno (color/patrón) y etiqueta accesible.
const rueda = (p, pos) => p.eval(`(() => { const g = document.querySelector('#vd-diagrama .vd-rueda[data-pos="${pos}"]');
  return g && { mm: g.querySelector('.vd-mm').textContent, fill: getComputedStyle(g.querySelector('rect.vd-goma')).fill, clase: g.getAttribute('class'), aria: g.getAttribute('aria-label') }; })()`);

// Neumáticos en desgaste límite que muestra Inicio (proporciones: nuevo, poco desgaste, mayor desgaste, desgaste límite, desconocido).
const limiteInicio = async p => {
  await p.esperar(INICIO_LISTO, { que: 'proporciones de Inicio' });
  return (await p.eval(LEER_INICIO)).cifras[3];
};

// Filas de la tabla de alertas de un camión: [{tipo, posicion}]. La posición sale del botón «Ver vehículo» (la celda muestra el nombre).
const alertasUi = async (p, patente) => {
  await irA(p, 'alertas');
  await p.esperar(`/\\d+ alertas?/.test(document.querySelector('#alert-count').textContent)`, { que: 'tabla de alertas' });
  return p.eval(`[...document.querySelectorAll('#alert-tbody tr')].filter(r => r.innerText.includes(${JSON.stringify(patente)}))
    .map(r => ({ tipo: r.dataset.tipo, posicion: String(JSON.parse(r.querySelector('[data-action="verVehiculo"]').dataset.args)[1] ?? '') }))`);
};

async function seleccionarRueda(p, pos) {
  await p.click(`#vd-diagrama .vd-rueda[data-pos="${pos}"]`);
  // Bajo el límite de retiro (RN-08) no hay botón Rotar: el panel se reconoce por sus botones de la rueda (data-posicion).
  await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && document.querySelector('#vd-panel [data-posicion="${pos}"]')`, { que: `panel de la rueda ${pos}` });
}

const veh = (env, id) => json(env, `select nombre, tipo_ruedas from public.vehiculos where id = ${id}`)[0];

export function registrar(env) {
  test('Cambio de un neumático en desgaste límite (global): la rueda nueva pasa a desconocido, cae la alerta y el contador de Inicio', async () => {
    const patente = 'DEMO006', pos = 2, id = vehId(env, patente);
    const antes = fila(env, id, pos);
    assert.equal(antes.estado, 'desgaste_limite', 'el demo trae P2 de DEMO006 en desgaste límite');
    assert.equal(limiteAlerta(env, id, pos), 1);
    const viejoIdn = antes.idneumatico;
    const nViejas = Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${viejoIdn}'`));
    assert.ok(nViejas >= 5, 'el viejo tiene historial');
    const limite0 = cifrasInicio(env, 'global').limite;

    await flujo(env, 'cambio-limite', 'global', async p => {
      assert.equal(await limiteInicio(p), limite0, 'Inicio cuenta el desgaste límite antes del cambio');
      await abrirDetallePorMatricula(p, patente);
      const r0 = await rueda(p, pos);
      assert.equal(r0.mm, mmUi(antes.mm), 'antes del cambio la rueda muestra los mm del viejo');
      assert.match(r0.aria, /desgaste límite/i);
      await seleccionarRueda(p, pos);
      await p.click('#vd-panel [data-action="neumatico-cambiar"]');
      await p.esperar(`document.querySelector('#modal-cambio').classList.contains('show') && document.querySelector('#cambio-actual').textContent.includes(${JSON.stringify('Neumático actual en ' + nombrePos(pos, veh(env, id).tipo_ruedas))})`, { que: 'modal de cambio' });
      await p.eval(`document.querySelector('input[name="cambio-origen"][value="nuevo"]').click()`);
      await p.eval(`document.querySelector('input[name="cambio-destino"][value="baja"]').click()`);
      await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('#cambio-motivo', 'Desgaste E2E'); set('#cambio-marca', 'MarcaMed'); set('#cambio-modelo', 'Modelo M'); })()`);
      await p.click('#cambio-confirmar');
      await p.esperar(`document.querySelector('#toast-msg').textContent === ${JSON.stringify('Cambio registrado en ' + etiquetaCoche(veh(env, id).nombre) + ', ' + nombrePos(pos, veh(env, id).tipo_ruedas) + ': el neumático nuevo ya figura montado')} && !document.querySelector('#modal-cambio').classList.contains('show')`, { que: 'cambio registrado' });
      // El detalle se recarga: la rueda nueva figura desconocida (no hereda los mm del viejo)
      await p.esperar(`(() => { const g = document.querySelector('#vd-diagrama .vd-rueda[data-pos="${pos}"]'); return g && g.querySelector('.vd-mm').textContent === '—'; })()`, { que: 'la rueda nueva desconocida' });
      const r1 = await rueda(p, pos);
      assert.match(r1.clase, /\best-sinDatos\b/);
      assert.match(r1.fill, /vd-sin-datos/);
      assert.match(r1.aria, /sin datos/i);
      // Panel: sin medición ni gráfico del viejo
      await seleccionarRueda(p, pos);
      await p.esperar(`/todavía no tiene mediciones/.test(document.querySelector('#vd-panel').textContent)`, { que: 'el panel dice que no tiene mediciones' });
      await p.esperar(`/Sin mediciones para graficar/.test(document.querySelector('#vd-chart-wrap').textContent)`, { que: 'sin gráfico heredado' });
    });

    const despues = fila(env, id, pos);
    assert.equal(despues.estado, 'desconocido');
    assert.equal(despues.promedio, null);
    assert.equal(despues.sin_medir, true);
    assert.equal(despues.n_mediciones_90d, 0, 'la tasa del nuevo no mezcla puntos del viejo');
    assert.notEqual(despues.idneumatico, viejoIdn);
    assert.equal(limiteAlerta(env, id, pos), 0);
    assert.equal(Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${viejoIdn}'`)), nViejas, 'el historial del viejo se conserva');
    assert.equal(cifrasInicio(env, 'global').limite, limite0 - 1);

    // Sesión nueva: Inicio y Alertas ya no cuentan la rueda
    await flujo(env, 'cambio-limite-verifica', 'global', async p => {
      assert.equal(await limiteInicio(p), limite0 - 1, 'el contador de desgaste límite de Inicio baja en uno');
      const al = await alertasUi(p, patente);
      assert.ok(!al.some(a => a.tipo === 'limite' && a.posicion === String(pos)), `ya no hay alerta de límite en P${pos}: ${JSON.stringify(al)}`);
      // «Sin medir» ya no es alerta (docs/15 B.2): queda como indicador de la vista de estado.
      assert.equal(fila(env, id, pos).sin_medir, true, 'figura como montado sin medir');
    });

    // El neumático nuevo se mide (como lo haría el proveedor): la posición toma SU valor
    env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, device_id, posicion, mm1, mm2, mm3, promedio, idneumatico)
      select ${id}, cliente_id, 'e2e', ${pos}, 11, 11, 11, 11, idneumatico from public.neumaticos where vehiculo_id = ${id} and posicion = ${pos}`);
    const medido = fila(env, id, pos);
    assert.equal(medido.estado, 'nuevo');
    assert.equal(medido.mm, '11.0');
    await flujo(env, 'cambio-limite-medido', 'global', async p => {
      await abrirDetallePorMatricula(p, patente);
      assert.equal((await rueda(p, pos)).mm, '11,0');
      assert.match((await rueda(p, pos)).aria, /buen estado/i);
      await seleccionarRueda(p, pos);
      await p.esperar(`/1 lectura(?!s)/.test(document.querySelector('#vd-chart-wrap').getAttribute('aria-label') || document.querySelector('#vd-chart-wrap .vd-chart')?.getAttribute('aria-label') || '')`, { que: 'gráfico con un solo punto (el del nuevo)' });
      const panel = await p.eval(`document.querySelector('#vd-panel').innerText.replace(/\\s+/g, ' ')`);
      assert.match(panel, /Montaje/, 'el historial del nuevo muestra su montaje');
      assert.doesNotMatch(panel, /Baja|Dado de baja/, 'el historial no muestra la baja del viejo');
      assert.match(panel, /MarcaMed|Modelo M/, 'el panel muestra la marca/modelo del nuevo neumático');
    });
  });

  test('Rotación (global): los mm, el color y el historial acompañan al neumático', async () => {
    const patente = 'DEMO005', a = 4, b = 1, id = vehId(env, patente);
    const antesA = fila(env, id, a), antesB = fila(env, id, b);
    assert.equal(antesA.estado, 'poco_desgaste');
    assert.notEqual(antesB.mm, antesA.mm, 'los dos neumáticos tienen mediciones distintas');
    const nMedA = Number(env.sql(`select count(*) from public.mediciones where idneumatico = '${antesA.idneumatico}'`));
    const rotaciones0 = Number(env.sql(`select count(*) from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'rotacion'`));

    await flujo(env, 'rotar-acompana', 'global', async p => {
      await abrirDetallePorMatricula(p, patente);
      const ra = await rueda(p, a), rb = await rueda(p, b);
      assert.equal(ra.mm, mmUi(antesA.mm));
      assert.equal(rb.mm, mmUi(antesB.mm));
      assert.notEqual(ra.fill, rb.fill, 'nuevo y poco desgaste tienen distinto color');
      await seleccionarRueda(p, a);
      await p.eval(`(() => { const s = document.querySelector('#vd-rotar-destino'); s.value = '${b}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await p.click('#vd-rotar-btn');
      await p.esperar(`/Rotación registrada/.test(document.querySelector('#toast-msg').textContent)`, { que: 'rotación registrada' });
      // Rotar es reversible: sin confirmación, y el aviso nombra el vehículo y las dos posiciones
      assert.equal(await p.eval(`document.querySelector('#toast-msg').textContent`), `Rotación registrada en ${etiquetaCoche(veh(env, id).nombre)}: ${avisoRotacion(a, b, veh(env, id).tipo_ruedas, true)}`);
      assert.equal(await p.eval(`document.querySelector('#modal-confirm').classList.contains('show')`), false, 'rotar no pide confirmación');
      // Tras recargar, cada medición viaja con su neumático: el color y los mm se intercambian
      await p.esperar(`(() => { const g = document.querySelector('#vd-diagrama .vd-rueda[data-pos="${b}"]'); return g && g.querySelector('.vd-mm').textContent === ${JSON.stringify(mmUi(antesA.mm))}; })()`, { que: `P${b} con los mm del neumático que vino de P${a}` });
      const ra2 = await rueda(p, a), rb2 = await rueda(p, b);
      assert.equal(rb2.mm, mmUi(antesA.mm));
      assert.equal(ra2.mm, mmUi(antesB.mm));
      assert.equal(rb2.fill, ra.fill, `P${b} toma el color que tenía el neumático de P${a}`);
      assert.equal(ra2.fill, rb.fill, `P${a} toma el color que tenía el neumático de P${b}`);
      assert.match(rb2.aria, /poco desgaste/i);
      // Panel de la posición nueva del neumático: su historial y su gráfico completo
      await seleccionarRueda(p, b);
      const panel = await p.eval(`document.querySelector('#vd-panel').innerText.replace(/\\s+/g, ' ')`);
      await p.esperar(`/${nMedA} lecturas/.test((document.querySelector('#vd-chart-wrap .vd-chart') || {getAttribute: () => ''}).getAttribute('aria-label') || '')`, { que: `gráfico con las ${nMedA} lecturas del neumático` });
      assert.match(panel, /Rotación/, 'el historial del neumático muestra la rotación');
    });

    const dA = fila(env, id, a), dB = fila(env, id, b);
    assert.deepEqual([dB.idneumatico, dB.mm, dB.estado], [antesA.idneumatico, antesA.mm, 'poco_desgaste']);
    assert.deepEqual([dA.idneumatico, dA.mm], [antesB.idneumatico, antesB.mm]);
    assert.equal(dB.tasa_mm_semana, antesA.tasa_mm_semana, 'la tasa de desgaste acompaña al neumático');
    assert.equal(Number(env.sql(`select count(*) from public.eventos_neumatico where vehiculo_id = ${id} and tipo = 'rotacion'`)), rotaciones0 + 2);

    // «Poco desgaste» ya no es alerta: el indicador acompaña al neumático en la vista de estado.
    assert.equal(fila(env, id, b).estado, 'poco_desgaste', `el poco desgaste se movió a P${b}`);
    assert.notEqual(fila(env, id, a).estado, 'poco_desgaste', `P${a} ya no tiene poco desgaste`);
  });
}
