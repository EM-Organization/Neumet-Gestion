// Alertas y Dispositivos coherentes con las vistas SQL del demo, por rol (incluye filtros de la interfaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, dormir } from '../lib/flujo.mjs';
import { ALCANCE, json } from '../lib/verdad.mjs';

export function registrar(env) {
  for (const rol of ['admin', 'global', 'salto', 'montevideo']) {
    test(`Alertas (${rol}): conteos, tipos y vehículos coinciden con v_alertas`, async () => {
      const a = ALCANCE[rol];
      const filas = json(env, `select x.severidad, x.tipo, v.patente, x.posicion from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where ${a.veh}`);
      assert.ok(filas.length > 5, 'el demo debe generar alertas');
      const porSev = s => filas.filter(f => f.severidad === s).length;
      await flujo(env, 'alertas', rol, async p => {
        await irA(p, 'alertas');
        await p.esperar(`/${filas.length} alertas/.test(document.querySelector('#alert-count').textContent)`, { que: `${filas.length} alertas` });
        const chips = await p.eval(`[...document.querySelectorAll('#alert-chips > *')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())`);
        assert.deepEqual(chips.map(c => Number(c.replace(/\D/g, ''))), [porSev(3), porSev(2), porSev(1)], `chips de severidad: ${chips}`);
        const tabla = await p.eval(`[...document.querySelectorAll('#alert-tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())`);
        assert.equal(tabla.length, filas.length, 'una fila por alerta');
        // Cada alerta aparece con su matrícula y posición; ninguna de otro alcance.
        const vistas = tabla.join('\n');
        for (const f of filas) assert.ok(vistas.includes(f.patente), `falta una alerta de ${f.patente}`);
        for (const pat of new Set(json(env, `select patente from public.vehiculos`).map(v => v.patente).filter(Boolean))) {
          if (!filas.some(f => f.patente === pat)) assert.ok(!vistas.includes(pat), `${pat} no debería aparecer en las alertas de ${rol}`);
        }
        // Filtro por severidad crítica
        await p.eval(`(() => { const s = document.querySelector('#alert-severidad'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await dormir(150);
        assert.equal(await p.eval(`document.querySelectorAll('#alert-tbody tr').length`), porSev(3), 'filtro de severidad crítica');
        const criticas = await p.eval(`[...document.querySelectorAll('#alert-tbody tr')].map(r => r.innerText)`);
        assert.ok(criticas.every(t => /Neumático crítico/.test(t)), 'solo críticas');
      });
    });

    test(`Dispositivos (${rol}): estados y MAC coinciden con v_salud_dispositivos`, async () => {
      const a = ALCANCE[rol];
      const filas = json(env, `select d.mac_address, s.estado from public.v_salud_dispositivos s join public.dispositivos d on d.id = s.dispositivo_id where ${a.dis} order by 1`);
      assert.ok(filas.length > 0);
      const cuenta = e => filas.filter(f => f.estado === e).length;
      await flujo(env, 'dispositivos', rol, async p => {
        await irA(p, 'dispositivos');
        await p.esperar(`document.querySelectorAll('#tbody-dispositivos tr').length === ${filas.length}`, { que: `${filas.length} dispositivos` });
        const macs = await p.eval(`[...document.querySelectorAll('#tbody-dispositivos tr')].map(r => (r.innerText.match(/[0-9A-F]{2}(:[0-9A-F]{2}){5}/i) || [''])[0].toUpperCase())`);
        assert.deepEqual(macs.sort(), filas.map(f => f.mac_address.toUpperCase()).sort());
        const chips = await p.eval(`[...document.querySelectorAll('#disp-chips > *')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())`);
        const n = t => Number((chips.find(c => c.includes(t)) || '').replace(/\D/g, ''));
        assert.equal(n('Todos'), filas.length, `chips: ${chips}`);
        assert.equal(n('Caído'), cuenta('caido'));
        assert.equal(n('Sin actividad'), cuenta('sin_actividad'));
        assert.equal(n('Activo'), cuenta('activo'));
        // El demo trae 1 caído (MAC ...06, Salto) y 1 sin actividad (MAC ...04, Montevideo); 4 activos.
        if (rol === 'global' || rol === 'admin') assert.deepEqual([cuenta('caido'), cuenta('sin_actividad'), cuenta('activo')], [1, 1, 4]);
        if (rol === 'salto') assert.deepEqual([cuenta('caido'), cuenta('sin_actividad'), cuenta('activo')], [1, 0, 1]);
        if (rol === 'montevideo') assert.deepEqual([cuenta('caido'), cuenta('sin_actividad'), cuenta('activo')], [0, 1, 3]);
      });
    });
  }
}
