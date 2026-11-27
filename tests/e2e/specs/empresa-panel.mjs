// Pantalla Empresa del panel (F10 PR 4, docs/17 §4.3) en Chrome contra Postgres + RLS + PostgREST reales.
//   * Administrador de empresa (perfil global): Usuarios (lista real de usuarios_empresa_listar, sin «Quitar» para sí mismo),
//     Umbrales (alerta_configurar con Enter; cambia la base y no hay UPDATE directo sobre clientes). Sin Dispositivos de la empresa: se retiró, y forzar la ruta deja en Inicio.
//   * Equipo Neumet (admin) y usuario de sucursal: sin sección Empresa y, si fuerzan la vista, el router los devuelve a Inicio
//     sin pedir nada a la base.
// Las Edge Functions (quitar, reponer, crear usuario) no corren en este entorno: sus respuestas se cubren en tests/smoke/empresa.flow.js
// y tests/unit/empresa.test.mjs. Modifica los umbrales de Demo temporalmente y los restaura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, texto } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';
import { CAMPOS_UMBRAL } from '../../../assets/js/domain/umbrales.js';

const SECCION = ['empresa-usuarios', 'empresa-umbrales'];

export function registrar(env) {
  test('Empresa (panel): el administrador de empresa ve usuarios, edita umbrales y no tiene Dispositivos', async () => {
    const previo = json(env, `select umbral_bajo_mm, umbral_critico_mm, umbral_retiro_mm, dias_sin_medir_alerta, irregularidad_mm, alerta_histeresis_mm from public.clientes where id = ${DEMO}`)[0];
    const desde = env.peticiones.length;
    try {
      await flujo(env, 'empresa', 'global', async p => {
        // Usuarios
        await irA(p, 'empresa-usuarios');
        const esperados = json(env, `select count(*)::int as n from public.perfiles where cliente_id = ${DEMO} and rol = 'cliente'`)[0].n;
        await p.esperar(`document.querySelectorAll('#tbody-empresa-usuarios tr[data-user]').length === ${esperados}`, { que: 'lista de usuarios' });
        const yo = env.sesion('global');
        const propia = await p.eval(`(() => { const f = document.querySelector('#tbody-empresa-usuarios tr[data-user="${yo.sub}"]'); return f ? { quitar: !!f.querySelector('[data-action="empresaQuitar"]'), texto: f.innerText } : null; })()`);
        assert.ok(propia, 'la fila propia está en la lista');
        assert.equal(propia.quitar, false, 'el usuario de la sesión no se quita a sí mismo');
        assert.ok(propia.texto.includes(yo.email), 'el email viene de la base');
        const otros = await p.eval(`document.querySelectorAll('#tbody-empresa-usuarios [data-action="empresaQuitar"]').length`);
        assert.equal(otros, esperados - 1, 'Quitar en cada usuario vigente salvo el propio');
        assert.match(await texto(p, '#emp-user-sucursal'), /Toda la empresa/);
        assert.equal(await p.eval(`document.querySelector('#emp-user-sucursal').value`), '', 'el campo Sucursal empieza sin elegir (no da acceso amplio por omisión)');

        // Umbrales: editar y guardar con Enter
        await irA(p, 'empresa-umbrales');
        await p.esperar(`document.querySelectorAll('#emp-umb-campos [data-umbral]').length === ${CAMPOS_UMBRAL.length} && document.querySelector('#eu-umbral_bajo_mm').value !== ''`, { que: 'umbrales cargados' });
        // El campo muestra el decimal con coma (es-AR), no con el punto de la base.
        assert.equal(await p.eval(`document.querySelector('#eu-alerta_histeresis_mm').value`), String(Number(previo.alerta_histeresis_mm)).replace('.', ','), 'la histéresis actual viene de la base');
        const nuevo = Number(previo.umbral_bajo_mm) + 0.5;
        const nuevaHist = Number(previo.alerta_histeresis_mm) === 1.2 ? 1.4 : 1.2;
        await p.escribir('#eu-umbral_bajo_mm', String(nuevo));
        await p.escribir('#eu-alerta_histeresis_mm', String(nuevaHist).replace('.', ','));
        await p.enter();
        await p.esperar(`/Umbrales actualizados/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de guardado' });
        assert.equal(Number(env.sql(`select umbral_bajo_mm from public.clientes where id = ${DEMO}`)), nuevo, 'la base guardó el umbral');
        assert.equal(Number(env.sql(`select alerta_histeresis_mm from public.clientes where id = ${DEMO}`)), nuevaHist, 'la base guardó la histéresis');
        // Valores inválidos: el panel avisa y no cambia nada
        await p.escribir('#eu-umbral_bajo_mm', '1');
        await p.enter();
        await p.esperar(`document.querySelector('#emp-umb-error').classList.contains('show')`, { que: 'error de validación' });
        assert.equal(Number(env.sql(`select umbral_bajo_mm from public.clientes where id = ${DEMO}`)), nuevo);
        // Histéresis fuera de rango: el panel avisa de la histéresis y la base conserva el valor
        await p.escribir('#eu-umbral_bajo_mm', String(nuevo));
        await p.escribir('#eu-alerta_histeresis_mm', '3,5');
        await p.enter();
        await p.esperar(`/margen para resolver la alerta/i.test(document.querySelector('#emp-umb-error').textContent)`, { que: 'error del margen de la alerta' });
        assert.equal(Number(env.sql(`select alerta_histeresis_mm from public.clientes where id = ${DEMO}`)), nuevaHist, 'la histéresis inválida no llegó a la base');

        // Dispositivos de la empresa se retiró: sin ítem ni vista, y forzar la ruta deja en Inicio
        assert.equal(await p.eval(`document.querySelectorAll('.nav-item[data-view="empresa-dispositivos"], #view-empresa-dispositivos').length`), 0, 'sin vista de dispositivos de la empresa');
        await p.eval(`(() => { const b = document.createElement('button'); b.dataset.action = 'irA'; b.dataset.args = '["empresa-dispositivos"]'; document.body.appendChild(b); b.click(); b.remove(); })()`);
        await new Promise(r => setTimeout(r, 300));
        assert.equal(await p.eval(`document.querySelector('#view-inicio').classList.contains('active') && document.querySelectorAll('.view.active').length === 1`), true, 'forzar la ruta cae a Inicio');
      });
      const mias = env.peticiones.slice(desde).filter(r => r.tag === 'global/empresa');
      assert.ok(mias.some(r => /rpc\/usuarios_empresa_listar/.test(r.path)), 'la lista sale de usuarios_empresa_listar');
      assert.ok(mias.some(r => /rpc\/alerta_configurar/.test(r.path)), 'los umbrales se guardan con alerta_configurar');
      assert.ok(mias.every(r => !(r.method === 'PATCH' && /\/clientes/.test(r.path))), 'ningún UPDATE directo sobre clientes');
    } finally {
      env.sql(`update public.clientes set umbral_bajo_mm = ${previo.umbral_bajo_mm}, umbral_critico_mm = ${previo.umbral_critico_mm}, umbral_retiro_mm = ${previo.umbral_retiro_mm}, dias_sin_medir_alerta = ${previo.dias_sin_medir_alerta}, irregularidad_mm = ${previo.irregularidad_mm}, alerta_histeresis_mm = ${previo.alerta_histeresis_mm} where id = ${DEMO}`);
    }
  });

  for (const rol of ['admin', 'salto']) {
    test(`Empresa (panel): ${rol} no ve la sección ni entra forzando la vista`, async () => {
      const desde = env.peticiones.length;
      await flujo(env, 'empresa-bloqueada', rol, async p => {
        for (const v of SECCION) {
          assert.equal(await p.eval(`(() => { const b = document.querySelector('.nav-item[data-view="${v}"]'); return !b || b.getClientRects().length === 0; })()`), true, `${rol}: el menú muestra ${v}`);
          await p.eval(`(() => { const b = document.querySelector('.nav-item[data-view="${v}"]'); if (b) b.click(); })()`);
          await new Promise(r => setTimeout(r, 300));
          assert.equal(await p.eval(`document.querySelector('#view-${v}').classList.contains('active')`), false, `${rol}: entró a ${v}`);
        }
        await irA(p, 'inicio');
      });
      const mias = env.peticiones.slice(desde).filter(r => r.tag === `${rol}/empresa-bloqueada`);
      assert.ok(mias.every(r => !/usuarios_empresa_listar|alerta_configurar/.test(r.path)), `${rol}: no debe llamar a las RPC de empresa`);
    });
  }
}
