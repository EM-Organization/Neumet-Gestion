// Sesión autenticada sin acceso al panel: sin perfil, o con rol 'api'. La interfaz muestra «Sin acceso» (no la UI de
// administración) y la RLS real devuelve 0 filas en todas las tablas y vistas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, texto } from '../lib/flujo.mjs';

const TABLAS = ['vehiculos', 'neumaticos', 'mediciones', 'dispositivos', 'clientes', 'perfiles', 'stock_neumaticos', 'gastos',
  'sucursales', 'eventos_neumatico', 'v_estado_neumaticos', 'v_alertas', 'v_salud_dispositivos', 'v_resumen_flota_cliente'];

// Cuenta las filas que la API devuelve a la sesión (JWT del panel) para una tabla o vista.
// neumaticos y eventos_neumatico: sin `*` (precio_unidad y costo no tienen SELECT para nadie; la prueba de eso está en precios-solo-global.mjs).
const CONTAR = `async tabla => {
  const cols = tabla === 'neumaticos' || tabla === 'eventos_neumatico' ? 'id' : '*';
  const r = await fetch('/rest/v1/' + tabla + '?select=' + cols + '&limit=1000', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } });
  const f = r.ok ? await r.json() : null;
  return { status: r.status, filas: Array.isArray(f) ? f.length : null };
}`;

export function registrar(env) {
  for (const rol of ['sinperfil', 'api']) {
    test(`Sin acceso (${rol}): el panel muestra «Sin acceso» y la API no devuelve filas`, async () => {
      const desde = env.peticiones.length;
      await flujo(env, 'sin-acceso', rol, async p => {
        const visto = await p.eval(`({
          sinAcceso: !document.querySelector('#sin-acceso-screen').classList.contains('hidden'),
          app: !document.querySelector('#app').classList.contains('hidden'),
          login: !document.querySelector('#login-screen').classList.contains('hidden'),
          menu: [...document.querySelectorAll('.nav-item')].filter(e => e.getClientRects().length > 0).length,
          todo: document.body.innerText })`);
        assert.equal(visto.sinAcceso, true);
        assert.equal(visto.app, false, 'el panel no debe mostrarse');
        assert.equal(visto.login, false);
        assert.equal(visto.menu, 0, 'sin ítems de menú');
        assert.doesNotMatch(visto.todo, /Administrador/);
        assert.match(await texto(p, '#sin-acceso-screen'), /^Sin acceso\b.*Esta cuenta aún no tiene un perfil asignado\. Contactar a la administración\. Cerrar sesión$/);
        assert.equal(await p.eval(`document.querySelector('#contenido').dataset.vista || ''`), '', 'no se cargó ninguna vista');

        // Solo se consultó lo necesario para resolver el rol.
        const recursos = env.peticiones.slice(desde).filter(r => r.tag === `${rol}/sin-acceso`).map(r => r.path.split('?')[0]);
        assert.ok(recursos.length > 0);
        for (const r of recursos) assert.ok(['/perfiles', '/clientes'].includes(r), `consulta inesperada de la pantalla Sin acceso: ${r}`);

        // Defensa en profundidad: navegar por código no carga nada.
        const antes = env.peticiones.length;
        await p.eval(`import('/assets/js/core/nav.js').then(m => { ['inicio', 'clientes', 'vehiculos', 'dispositivos', 'balance'].forEach(v => m.switchView(v)); m.reloadActiveView(); })`);
        await new Promise(r => setTimeout(r, 400));
        assert.equal(env.peticiones.length, antes, 'switchView no debe consultar datos');

        // La RLS real: 0 filas (o rechazo) en todo.
        for (const t of TABLAS) {
          const r = await p.eval(`(${CONTAR})(${JSON.stringify(t)})`);
          assert.ok(r.filas === 0 || r.status === 401 || r.status === 403, `${t}: ${JSON.stringify(r)}`);
        }

        // Cerrar sesión vuelve al login.
        await p.click('#sin-acceso-cerrar');
        await p.esperar(`!document.querySelector('#login-screen').classList.contains('hidden') && document.querySelector('#sin-acceso-screen').classList.contains('hidden')`, { que: 'login tras cerrar sesión' });
      }, { sinAcceso: true });
    });
  }
}
