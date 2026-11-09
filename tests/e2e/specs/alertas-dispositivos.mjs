// Alertas y Dispositivos coherentes con las vistas SQL del demo, por rol (incluye filtros de la interfaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, dormir } from '../lib/flujo.mjs';
import { ALCANCE, json } from '../lib/verdad.mjs';

export function registrar(env) {
  for (const rol of ['admin', 'global', 'salto', 'montevideo']) {
    test(`Alertas (${rol}): conteos, estados y vehículos coinciden con v_alertas`, async () => {
      const a = ALCANCE[rol];
      const filas = json(env, `select x.estado, x.silenciada_hasta, x.tipo, v.patente, x.posicion from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where ${a.veh}`);
      assert.ok(filas.length > 0, 'el demo debe generar alertas críticas');
      assert.ok(filas.every(f => f.tipo === 'critico'), 'una sola categoría de alerta: crítico');
      const porEstado = e => filas.filter(f => f.estado === e && !f.silenciada_hasta).length;
      await flujo(env, 'alertas', rol, async p => {
        await irA(p, 'alertas');
        await p.esperar(`/${filas.length} alertas?/.test(document.querySelector('#alert-count').textContent)`, { que: `${filas.length} alertas` });
        const chips = await p.eval(`[...document.querySelectorAll('#alert-chips > *')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())`);
        assert.deepEqual(chips.map(c => Number(c.replace(/\D/g, ''))), [porEstado('abierta'), porEstado('reconocida'), filas.filter(f => f.silenciada_hasta).length], `chips de estado: ${chips}`);
        const tabla = await p.eval(`[...document.querySelectorAll('#alert-tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())`);
        assert.equal(tabla.length, filas.length, 'una fila por alerta');
        // Cada alerta aparece con su matrícula; ninguna de otro alcance.
        const vistas = tabla.join('\n');
        for (const f of filas) assert.ok(vistas.includes(f.patente), `falta una alerta de ${f.patente}`);
        for (const pat of new Set(json(env, `select patente from public.vehiculos`).map(v => v.patente).filter(Boolean))) {
          if (!filas.some(f => f.patente === pat)) assert.ok(!vistas.includes(pat), `${pat} no debería aparecer en las alertas de ${rol}`);
        }
        assert.ok(tabla.every(t => /Neumático crítico/.test(t)), 'solo críticas');
        // Cada alerta lleva al vehículo (acción) y ofrece resolver.
        assert.equal(await p.eval(`document.querySelectorAll('#alert-tbody tr [data-action="verVehiculo"]').length`), filas.length);
        assert.equal(await p.eval(`document.querySelectorAll('#alert-tbody tr [data-action="alertasResolver"]').length`), filas.length);
        // El bloque del nivel crítico solo lo ve el cliente global.
        assert.equal(await p.eval(`!document.querySelector('#alert-config').hidden`), rol === 'global', 'nivel crítico editable solo para el cliente global');
      });
    });

    if (rol === 'global' || rol === 'salto') {
      test(`Alertas (${rol}): reconocer desde la tabla queda en la base con el usuario`, async () => {
        const a = ALCANCE[rol];
        const alerta = json(env, `select x.alerta_id as id, x.estado from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where x.estado = 'abierta' and ${a.veh} order by x.alerta_id limit 1`)[0];
        assert.ok(alerta, 'el demo debe traer una alerta abierta');
        try {
          await flujo(env, 'alertas', rol, async p => {
            await irA(p, 'alertas');
            await p.esperar(`document.querySelector('[data-action="alertasReconocer"][data-args="[${alerta.id}]"]')`, { que: 'botón Reconocer' });
            await p.click(`[data-action="alertasReconocer"][data-args="[${alerta.id}]"]`);
            await p.esperar(`!document.querySelector('[data-action="alertasReconocer"][data-args="[${alerta.id}]"]')`, { que: 'alerta reconocida' });
          });
          assert.equal(env.sql(`select estado || '|' || (reconocida_por is not null)::text from public.alertas where id = ${alerta.id}`), 'reconocida|true');
        } finally {
          env.sql(`update public.alertas set estado = 'abierta', reconocida_at = null, reconocida_por = null, nota_reconocida = null where id = ${alerta.id}`);
        }
      });
    }

    if (rol === 'global') {
      test('Alertas (global): editar el nivel crítico reevalúa las alertas del cliente', async () => {
        const cli = env.sql(`select id from public.clientes where nombre = 'Demo Transportes'`);
        const orig = json(env, `select umbral_critico_mm, umbral_bajo_mm, umbral_retiro_mm from public.clientes where id = ${cli}`)[0];
        const nuevo = Number(orig.umbral_bajo_mm) - 0.5;
        try {
          await flujo(env, 'alertas', rol, async p => {
            await irA(p, 'alertas');
            await p.esperar(`!document.querySelector('#alert-config').hidden && document.querySelector('#alert-umbral').value`, { que: 'nivel crítico cargado' });
            await p.eval(`(() => { const i = document.querySelector('#alert-umbral'); i.value = '${String(nuevo).replace('.', ',')}'; })()`);
            await p.click('#alert-config-guardar');
            await p.esperar(`/${String(nuevo).replace('.', ',')}/.test(document.querySelector('#alert-umbral').value)`, { que: 'nivel guardado' });
          });
          assert.equal(Number(env.sql(`select umbral_critico_mm from public.clientes where id = ${cli}`)), nuevo);
          assert.equal(
            Number(env.sql(`select count(*) from public.v_estado_neumaticos e where e.cliente_id = ${cli} and e.estado = 'critico' and not exists (select 1 from public.alertas a where a.neumatico_id = e.neumatico_id and a.estado <> 'resuelta')`)), 0,
            'todo neumático crítico con el nivel nuevo tiene su alerta');
          // Valor inválido: el panel lo rechaza sin llamar a la base.
          await flujo(env, 'alertas', rol, async p => {
            await irA(p, 'alertas');
            await p.esperar(`!document.querySelector('#alert-config').hidden && document.querySelector('#alert-umbral').value`);
            await p.eval(`(() => { document.querySelector('#alert-umbral').value = '99'; })()`);
            await p.click('#alert-config-guardar');
            await p.esperar(`/debe quedar entre/.test(document.querySelector('#alert-config-error').textContent)`, { que: 'error de rango' });
          });
        } finally {
          env.sql(`update public.clientes set umbral_critico_mm = ${orig.umbral_critico_mm} where id = ${cli}`);
        }
      });
    }

    if (rol !== 'admin') continue;
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

  // El cliente no gestiona hardware: ni el menú ni el router ni una acción forzada le abren Dispositivos.
  for (const rol of ['global', 'salto', 'montevideo', 'otra']) {
    test(`Dispositivos (${rol}): el cliente no accede a la vista`, async () => {
      await flujo(env, 'dispositivos-cliente', rol, async p => {
        assert.equal(await p.eval(`[...document.querySelectorAll('.nav-item[data-view="dispositivos"]')].filter(n => n.getClientRects().length).length`), 0, 'entrada de menú visible');
        await p.eval(`document.querySelector('.nav-item[data-view="dispositivos"]').click()`);
        await dormir(400);
        assert.equal(await p.eval(`document.querySelector('#view-dispositivos').classList.contains('active')`), false, 'el menú abrió la vista');
        await p.eval(`(() => { const b = document.createElement('button'); b.dataset.action = 'irA'; b.dataset.args = '["dispositivos"]'; document.body.appendChild(b); b.click(); b.remove(); })()`);
        await dormir(400);
        assert.equal(await p.eval(`document.querySelector('#view-dispositivos').classList.contains('active')`), false, 'irA abrió la vista');
        assert.equal(await p.eval(`document.querySelector('#view-inicio').classList.contains('active') && document.querySelector('.nav-item.active').dataset.view`), 'inicio');
        // Cargar la vista directamente tampoco pide la lista de dispositivos.
        const antes = env.peticiones.length;
        await p.eval(`(() => { const b = document.createElement('button'); b.dataset.action = 'loadDispositivos'; document.body.appendChild(b); b.click(); b.remove(); })()`);
        await dormir(500);
        assert.deepEqual(env.peticiones.slice(antes).filter(r => /v_salud_dispositivos|get_unregistered_devices/.test(r.path)), [], 'cargó datos de dispositivos');
      });
    });
  }
}
