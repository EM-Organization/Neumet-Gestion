// Pantalla «Uso» (isla Svelte, F11 piloto de la ola 1) en el panel CONSTRUIDO, con la base y PostgREST reales y el JWT de cada rol.
// Los datos salen de uso_cerrar_mes sobre un ingesta_log sembrado en el mes anterior (relativo a hoy, UTC: el rango por defecto de la
// pantalla son los últimos 12 meses cerrados, así la prueba no caduca). La referencia es una consulta SQL independiente de la pantalla.
// La RPC por rol (42501 para el resto) la cubre uso-cliente.mjs; aquí se prueba lo que ve el navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';

const INICIO_ANTERIOR = `((date_trunc('month', now() at time zone 'UTC') - interval '1 month') at time zone 'UTC')`;
const num = (n) => Number(n).toLocaleString('es-AR');
const mesEtiqueta = (mes) => { const [a, m] = mes.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 1))); };
const fecha = (iso) => (iso ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso)) : 'Sin ingresos');

const filaEsperada = (r) => [mesEtiqueta(r.mes), r.cliente_nombre, num(r.api_llamadas), num(r.logins), num(r.mediciones), num(r.vehiculos_activos),
  num(r.dispositivos_activos), num(r.usuarios), fecha(r.ultimo_ingreso_at)];
const filasPantalla = (p) => p.eval(`[...document.querySelectorAll('[data-isla="uso"] tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()))`);
const rpcsDeUso = (env, desde) => env.peticiones.slice(desde).filter((r) => r.path.startsWith('/rpc/uso_clientes_listar'));
const pausa = (p, ms) => p.eval(`new Promise(ok => setTimeout(ok, ${ms}))`);

export function registrar(env) {
  test('Uso (navegador): el equipo Neumet entra por el menú, ve las filas de la base y filtra, sin escribir ni errores', async () => {
    const demo = Number(env.sql(`select ${DEMO}`));
    const creado = env.sql(`select created_at from public.clientes where id = ${demo}`).trim();
    try {
      env.sql(`insert into public.ingesta_log (recibido_at, endpoint, status, cliente_id) values
        (${INICIO_ANTERIOR} + interval '2 days', 'guardar_montaje_mm', 'ok', ${demo}),
        (${INICIO_ANTERIOR} + interval '3 days', 'guardar_montaje_mm', 'ok', ${demo}),
        (${INICIO_ANTERIOR} + interval '4 days', 'login', 'ok', ${demo})`);
      env.sql(`update public.clientes set created_at = '2020-01-01+00' where id = ${demo}`);
      env.sql(`select public.uso_cerrar_mes()`);
      const verdad = json(env, `select u.cliente_id, c.nombre as cliente_nombre, u.mes::text as mes, u.api_llamadas, u.logins, u.mediciones, u.vehiculos_activos,
        u.dispositivos_activos, u.usuarios, u.ultimo_ingreso_at from public.uso_cliente_mensual u join public.clientes c on c.id = u.cliente_id
        order by u.mes desc, c.nombre, u.cliente_id`);
      const delDemo = verdad.filter((r) => r.cliente_id === demo);
      assert.equal(delDemo.length, 1);
      assert.equal(delDemo[0].api_llamadas, 2, 'el login no cuenta como llamada');
      assert.equal(delDemo[0].logins, 1);

      await flujo(env, 'uso-admin', 'admin', async (p) => {
        const desde = env.peticiones.length;
        // Clic 1: el ítem «Uso» del menú, visible para el equipo Neumet.
        assert.equal(await p.eval(`getComputedStyle(document.querySelector('.nav-item[data-view="uso"]')).display !== 'none'`), true);
        await irA(p, 'uso');
        await p.esperar(`document.querySelector('[data-isla="uso"] table tbody tr')`, { que: 'la tabla de uso' });

        assert.deepEqual(await filasPantalla(p), verdad.map(filaEsperada), 'la tabla muestra exactamente lo que dice la base');
        assert.equal(await p.eval(`document.querySelectorAll('link[data-neumet-hoja]').length`), 1, 'el CSS del build viaja con la isla');
        assert.equal(await p.eval(`getComputedStyle(document.querySelector('[data-isla="uso"]')).display`), 'flex', 'la hoja cargó: las utilidades aplican');
        assert.equal(await p.eval(`!!document.querySelector('#uso-no-disponible') && document.querySelector('#uso-no-disponible').hidden`), true, 'el aviso de «no disponible» no se ve con la isla montada');
        assert.match(await p.eval(`document.querySelector('[data-isla="uso"]').textContent`), /En curso: .* sin cerrar/);

        const llamadas = rpcsDeUso(env, desde);
        assert.equal(llamadas.length, 1, 'una sola lectura al entrar');
        const cuerpo = JSON.parse(llamadas[0].body);
        assert.match(cuerpo.p_desde, /^\d{4}-\d{2}-01$/);
        assert.match(cuerpo.p_hasta, /^\d{4}-\d{2}-01$/);
        assert.equal(cuerpo.p_cliente_id, null);
        assert.equal(cuerpo.p_hasta, delDemo[0].mes, 'termina en el último mes cerrado: el mes en curso no se pide');

        // Clic 2: elegir el cliente. Una sola pantalla, sin botón de aplicar.
        await p.eval(`(() => { const s = [...document.querySelectorAll('[data-isla="uso"] label')].find(l => l.textContent.trim().startsWith('Cliente')).querySelector('select');
          s.value = String(${demo}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await p.esperar(`document.querySelectorAll('[data-isla="uso"] tbody tr').length === ${delDemo.length}`, { que: 'filtrado por cliente' });
        assert.deepEqual(await filasPantalla(p), delDemo.map(filaEsperada));
        assert.equal(JSON.parse(rpcsDeUso(env, desde).at(-1).body).p_cliente_id, demo);

        // Un cliente sin cierre en el rango: estado vacío con instrucción, sin tabla.
        await p.eval(`(() => { const s = [...document.querySelectorAll('[data-isla="uso"] label')].find(l => l.textContent.trim().startsWith('Cliente')).querySelector('select');
          const otra = [...s.options].find(o => o.textContent === 'Otra Empresa SA'); s.value = otra.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await p.esperar(`document.querySelector('[data-isla="uso"] [role="status"]') && /Sin meses cerrados/.test(document.querySelector('[data-isla="uso"]').textContent)`, { que: 'estado vacío' });
        assert.equal(await p.eval(`document.querySelector('[data-isla="uso"] table')`), null);

        // Móvil: la tabla pasa a tarjetas (mismo contenido, marcado de lista).
        await p.eval(`(() => { const s = [...document.querySelectorAll('[data-isla="uso"] label')].find(l => l.textContent.trim().startsWith('Cliente')).querySelector('select');
          s.value = String(${demo}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await p.esperar(`document.querySelector('[data-isla="uso"] table tbody tr')`, { que: 'tabla de vuelta' });
        await p.captura('uso-escritorio');
        await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
        await p.esperar(`!document.querySelector('[data-isla="uso"] table') && document.querySelectorAll('[data-isla="uso"] ul li').length === ${delDemo.length}`, { que: 'tarjetas en móvil' });
        assert.equal(await p.eval(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'sin desborde horizontal de la página en móvil');
        await p.captura('uso-movil');

        assert.deepEqual(env.peticiones.slice(desde).filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !r.path.startsWith('/rpc/uso_clientes_listar')
          && !r.path.startsWith('/rpc/ultimas_mediciones')).map((r) => `${r.method} ${r.path}`), [], 'la pantalla solo lee');

        // Salir desmonta la isla y restaura el panel.
        await irA(p, 'inicio');
        await p.esperar(`!document.querySelector('[data-isla="uso"]')`, { que: 'isla desmontada' });
      });
    } finally {
      env.sql(`update public.clientes set created_at = '${creado}' where id = ${demo}`);
      env.sql(`delete from public.uso_cliente_mensual where mes = (date_trunc('month', now() at time zone 'UTC') - interval '1 month')::date`);
      env.sql(`delete from public.ingesta_log where recibido_at >= ${INICIO_ANTERIOR} and recibido_at < ${INICIO_ANTERIOR} + interval '1 month'`);
    }
  });

  for (const rol of ['global', 'salto']) {
    test(`Uso (navegador): ${rol} no ve el menú ni llega a la pantalla, y no se consulta nada de uso`, async () => {
      await flujo(env, 'uso-cliente', rol, async (p) => {
        const desde = env.peticiones.length;
        assert.equal(await p.eval(`getComputedStyle(document.querySelector('.nav-item[data-view="uso"]')).display`), 'none');
        await p.eval(`import('/assets/js/core/nav.js').then(m => { m.switchView('uso'); return true; })`);
        await pausa(p, 700);
        assert.equal(await p.eval(`document.querySelector('#contenido').dataset.vista`), 'inicio', 'el router lo devuelve a Inicio');
        assert.equal(await p.eval(`document.querySelectorAll('[data-isla="uso"]').length`), 0);
        assert.deepEqual(rpcsDeUso(env, desde), []);
      });
    });
  }

  // No existe vista vieja de Uso: con la bandera apagada se muestra el aviso estático en lugar de una pantalla en blanco.
  test('Uso (navegador): con neumet_islas=off el equipo Neumet ve «Uso no disponible», sin consultar datos; al volver a encenderla, la isla', async () => {
    await flujo(env, 'uso-bandera-off', 'admin', async (p) => {
      const desde = env.peticiones.length;
      await p.eval(`localStorage.setItem('neumet_islas', 'off')`);
      await irA(p, 'uso');
      await p.esperar(`!document.getElementById('uso-no-disponible').hidden`, { que: 'aviso de no disponible' });
      assert.match(await p.eval(`document.getElementById('uso-no-disponible').textContent`), /Uso no disponible/);
      assert.equal(await p.eval(`document.querySelectorAll('[data-isla="uso"]').length`), 0);
      assert.deepEqual(rpcsDeUso(env, desde), [], 'apagada: no se consulta nada');

      await irA(p, 'inicio');
      assert.equal(await p.eval(`document.getElementById('uso-no-disponible').hidden`), true, 'el aviso se oculta al salir');

      await p.eval(`localStorage.removeItem('neumet_islas')`);
      await irA(p, 'uso');
      await p.esperar(`document.querySelector('[data-isla="uso"]')`, { que: 'la isla montada tras encender la bandera' });
      assert.equal(await p.eval(`document.getElementById('uso-no-disponible').hidden`), true, 'el aviso no queda al lado de la isla');
      await irA(p, 'inicio');
      await p.esperar(`!document.querySelector('[data-isla="uso"]')`, { que: 'isla desmontada' });
      assert.equal(await p.eval(`document.getElementById('uso-no-disponible').hidden`), true, 'tras desmontar no reaparece el aviso');
    });
  });
}
