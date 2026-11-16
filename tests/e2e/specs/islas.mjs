// Islas (F11 PR 2): el panel viejo CONSTRUIDO monta la isla de humo de /panel/islas.js con la bandera encendida para un rol,
// la lee con el JWT de ese rol (v_alertas, sin escribir), la desmonta al cambiar de vista y, con la bandera apagada, queda igual.
// El servidor aplica las cabeceras de vercel.json: una violación de la CSP rompe el flujo (error del navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo } from '../lib/flujo.mjs';
import { cifrasInicio } from '../lib/verdad.mjs';

const irA = (p, vista) => p.eval(`import('/assets/js/core/nav.js').then(m => { m.switchView(${JSON.stringify(vista)}); return true; })`);
const forzar = (p, valor) => p.eval(`localStorage.setItem('neumet_islas', ${JSON.stringify(valor)})`);
const estado = p => p.eval(`({
  isla: document.querySelectorAll('[data-isla="hola"]').length,
  vista: !!document.getElementById('view-hola'),
  hojas: document.querySelectorAll('link[data-neumet-hoja]').length,
  relleno: (document.querySelector('[data-isla="hola"]') ? getComputedStyle(document.querySelector('[data-isla="hola"]')).paddingTop : null),
  inicioActivo: document.getElementById('view-inicio').classList.contains('active'),
  alertas: (document.querySelector('[data-alertas]') || {}).textContent || ''
})`);

export function registrar(env) {
  test('islas: bandera apagada, el panel viejo queda igual y no se monta nada', async () => {
    await flujo(env, 'islas-apagada', 'admin', async (p) => {
      await irA(p, 'hola');
      await p.esperar(`document.querySelector('#contenido').dataset.vista === 'hola'`, { que: 'vista hola activa' });
      await p.eval(`new Promise(ok => setTimeout(ok, 600))`); // deja resolver el import() y la decisión de la bandera
      const e = await estado(p);
      assert.equal(e.isla, 0);
      assert.equal(e.vista, false, 'con la bandera apagada no se crea ni siquiera el contenedor de la vista');
      assert.equal(e.hojas, 0, 'sin montar no se enlaza ninguna hoja de estilo');
    });
  });

  test('islas: el soporte puede apagar todo con neumet_islas=off aunque pida on', async () => {
    await flujo(env, 'islas-off', 'admin', async (p) => {
      await forzar(p, 'off');
      await irA(p, 'hola');
      await p.eval(`new Promise(ok => setTimeout(ok, 600))`);
      assert.equal((await estado(p)).isla, 0);
    });
  });

  for (const rol of ['admin', 'global', 'salto']) {
    test(`islas: ${rol} monta, lee v_alertas con su JWT, con el CSS del build y desmonta al cambiar de vista`, async () => {
      const esperadas = cifrasInicio(env, rol).alertas;
      await flujo(env, 'islas-montar', rol, async (p) => {
        await forzar(p, 'on:hola');
        const desde = env.peticiones.length;
        await irA(p, 'hola');
        await p.esperar(`document.querySelector('[data-isla="hola"]')`, { que: 'la isla montada' });
        await p.esperar(`/Alertas visibles: \\d+/.test(document.querySelector('[data-alertas]').textContent)`, { que: 'la lectura de v_alertas' });
        let e = await estado(p);
        assert.equal(e.isla, 1);
        assert.equal(e.alertas.trim(), `Alertas visibles: ${esperadas}`, 'el conteo es el que la base deja ver a este rol');
        assert.equal(e.hojas, 1, 'el CSS viaja con islas.js: una hoja enlazada');
        assert.equal(e.relleno, '16px', 'la hoja cargó: p-4 de Tailwind aplica');
        const lecturas = env.peticiones.slice(desde).filter((r) => r.path.startsWith('/v_alertas'));
        assert.ok(lecturas.length >= 1 && lecturas.every((r) => r.method === 'HEAD' || r.method === 'GET'), 'la isla solo lee');
        assert.equal(env.peticiones.slice(desde).filter((r) => r.method !== 'GET' && r.method !== 'HEAD').length, 0, 'la isla no escribe');

        // Cambiar de vista desmonta la isla y devuelve el panel viejo.
        await irA(p, 'inicio');
        await p.esperar(`!document.querySelector('[data-isla="hola"]')`, { que: 'la isla desmontada' });
        e = await estado(p);
        assert.equal(e.vista, false, 'el contenedor creado para la isla se retira');
        assert.equal(e.inicioActivo, true);

        // Volver a montar no duplica nada (ni isla ni hojas).
        await irA(p, 'hola');
        await p.esperar(`document.querySelector('[data-isla="hola"]')`, { que: 'la isla vuelve a montarse' });
        e = await estado(p);
        assert.equal(e.isla, 1);
        assert.equal(e.hojas, 1);
        await irA(p, 'inicio');
        await p.esperar(`!document.querySelector('[data-isla="hola"]')`, { que: 'la isla desmontada otra vez' });
      });
    });
  }

  test('islas: salir de la vista antes de que cargue cancela el montaje', async () => {
    await flujo(env, 'islas-cancelar', 'admin', async (p) => {
      await forzar(p, 'on:hola');
      await p.eval(`import('/assets/js/core/nav.js').then(m => { m.switchView('hola'); m.switchView('inicio'); return true; })`);
      await p.eval(`new Promise(ok => setTimeout(ok, 800))`);
      const e = await estado(p);
      assert.equal(e.isla, 0, 'una isla que ya no es la vista activa no queda montada');
      assert.equal(e.vista, false);
    });
  });

  // Una recarga de la vista (reloadActiveView) o el cambio de sucursal mientras la isla espera sus hojas no puede dejar la pantalla en
  // blanco: el montaje superado no desmonta ni retira nada de la vigente, y `montadas` no guarda entradas muertas.
  for (const disparador of ['reloadActiveView', 'seccionalCambiar']) {
    test(`islas: ${disparador} mientras cargan las hojas deja la isla visible exactamente una vez`, async () => {
      await flujo(env, 'islas-recarga', 'global', async (p) => {
        await forzar(p, 'on:hola');
        await p.eval(`(async () => {
          const nav = await import('/assets/js/core/nav.js');
          const act = await import('/assets/js/core/actions.js');
          const disparar = () => ${disparador === 'reloadActiveView' ? 'nav.reloadActiveView()' : "act.ACTIONS.seccionalCambiar('')"};
          let hecho = false;
          new MutationObserver(() => {
            if (hecho || !document.querySelector('link[data-neumet-hoja]')) return;
            hecho = true; disparar();
          }).observe(document.head, { childList: true });
          nav.switchView('hola');
          return true;
        })()`);
        await p.esperar(`document.querySelector('[data-isla="hola"]')`, { que: 'la isla montada tras la recarga' });
        await p.eval(`new Promise(ok => setTimeout(ok, 800))`);
        const e = await p.eval(`(async () => {
          const isl = await import('/assets/js/core/islas.js');
          return { isla: document.querySelectorAll('[data-isla="hola"]').length, vistas: document.querySelectorAll('#view-hola').length,
                   hosts: document.querySelectorAll('[data-isla-host="hola"]').length, registrada: isl.islaMontada('hola') };
        })()`);
        assert.deepEqual(e, { isla: 1, vistas: 1, hosts: 1, registrada: true });
        // Otra recarga posterior sigue dejándola una sola vez (antes quedaba en 0 con islaMontada verdadero).
        await p.eval(`import('/assets/js/core/nav.js').then(m => { m.reloadActiveView(); return true; })`);
        await p.eval(`new Promise(ok => setTimeout(ok, 300))`);
        assert.equal((await estado(p)).isla, 1);
        // Salir desmonta de verdad y islaMontada lo refleja.
        await irA(p, 'inicio');
        const f = await p.eval(`import('/assets/js/core/islas.js').then(m => ({ isla: document.querySelectorAll('[data-isla="hola"]').length, registrada: m.islaMontada('hola') }))`);
        assert.deepEqual(f, { isla: 0, registrada: false });
      });
    });
  }

  test('islas: el servidor entrega /panel/ con la CSP de vercel.json y las hojas con caché inmutable', async () => {
    await flujo(env, 'islas-cabeceras', 'admin', async (p) => {
      const r = await p.eval(`(async () => {
        const js = await fetch('/panel/islas.js');
        // islas.js re-exporta un chunk con hash; la hoja (assets/islas-<hash>.css) la nombra ese chunk.
        const chunk = (await js.text()).match(/\\.\\/(assets\\/islas-[\\w-]+\\.js)/)[1];
        const hoja = 'assets/' + (await (await fetch('/panel/' + chunk)).text()).match(/islas-[\\w-]+\\.css/)[0].replace(/^assets\\//, '');
        const css = await fetch('/panel/' + hoja);
        const viejo = await fetch('/assets/js/main.js');
        return { csp: js.headers.get('content-security-policy'), cssCache: css.headers.get('cache-control'), jsCache: js.headers.get('cache-control'), viejoCache: viejo.headers.get('cache-control') };
      })()`);
      assert.match(r.csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
      assert.match(r.cssCache, /immutable/);
      assert.doesNotMatch(r.jsCache, /immutable/, '/panel/islas.js tiene nombre fijo: no puede ser inmutable');
      assert.doesNotMatch(r.viejoCache, /immutable/);
    });
  });
}
