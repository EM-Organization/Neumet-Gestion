// Ejecuta un flujo de usuario en el panel real con una sesión de un rol y FALLA ante cualquier problema:
// console.error (incluye "Acción desconocida"), excepción no capturada, error de registro del navegador o
// respuesta HTTP 4xx/5xx de PostgREST que el flujo no haya declarado como esperada.
import assert from 'node:assert/strict';

export const dormir = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param env        entorno de iniciarEntorno()
 * @param nombre     nombre del flujo (etiqueta las peticiones registradas y la captura de fallo)
 * @param rol        'admin' | 'global' | 'salto' | 'montevideo'
 * @param fn         async (pagina) => {...}
 * @param opciones.http     [{ ruta: RegExp, status: number|number[] }] respuestas 4xx/5xx esperadas
 * @param opciones.consola  [RegExp] mensajes de console.error esperados (p. ej. el panel registra el error de una RPC denegada)
 */
export async function flujo(env, nombre, rol, fn, { http = [], consola = [] } = {}) {
  env.web.setTag(`${rol}/${nombre}`);
  const desde = env.peticiones.length;
  const p = await env.abrirPanel(rol);
  try {
    await fn(p);
    await dormir(250); // deja terminar peticiones y renders en vuelo antes de revisar
    const mias = env.peticiones.slice(desde);
    const esperada = r => http.some(h => h.ruta.test(`${r.path}${r.search}`) && [].concat(h.status).includes(r.status));
    for (const r of mias) if (r.status >= 400 && esperada(r)) r.esperada = true;
    const inesperadas = mias.filter(r => r.status >= 400 && !r.esperada);
    assert.deepEqual(inesperadas.map(r => `${r.status} ${r.method} ${r.path}${r.search} ${JSON.stringify(r.error)}`), [], `[${rol}/${nombre}] respuestas HTTP inesperadas`);
    const problemas = p.problemas.filter(x => {
      if (x.tipo === 'http') return !http.some(h => x.url && h.ruta.test(decodeURI(x.url).replace(/^https?:\/\/[^/]+\/rest\/v1/, '')));
      return !consola.some(re => re.test(x.texto));
    });
    assert.deepEqual(problemas.map(x => `${x.tipo}: ${x.texto}`), [], `[${rol}/${nombre}] errores en el navegador`);
  } catch (e) {
    await p.captura(`${rol}-${nombre}`).catch(() => {});
    throw e;
  } finally {
    await p.cerrar();
  }
}

// Texto visible normalizado de un selector.
export const texto = (p, sel) => p.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`).then(t => t.replace(/\s+/g, ' ').trim());

// Filas de la lista de vehículos del cliente: [{nombre, meta}] en el orden en que se ven.
export const filasVehiculos = p => p.eval(`[...document.querySelectorAll('#veh-lista .veh-fila')].map(f => ({
  nombre: f.querySelector('.veh-fila-nombre').textContent.trim(), meta: f.querySelector('.veh-fila-meta').textContent.trim() }))`);

export async function irA(p, vista) {
  await p.click(`.nav-item[data-view="${vista}"]`);
  await p.esperar(`document.querySelector('#view-${vista}').classList.contains('active')`, { que: `vista ${vista} activa` });
}

// Abre el detalle de un vehículo escribiendo su matrícula, como lo haría una persona: el cliente pulsa Enter sobre la
// lista; el admin usa el botón "Ver detalle" de la tabla de administración.
export async function abrirDetallePorMatricula(p, matricula) {
  await irA(p, 'vehiculos');
  const admin = await p.eval(`document.querySelector('#veh-lista-wrap').offsetParent === null`);
  if (admin) {
    await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr .mono-cell').length > 0`, { que: 'tabla de vehículos' });
    await p.escribir('#search-vehiculos', matricula);
    await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr .mono-cell').length === 1`, { que: `una fila para ${matricula}` });
    await p.click('#tbody-vehiculos [data-va="detalle"]');
  } else {
    await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length > 0`, { que: 'lista de vehículos' });
    await p.escribir('#search-vehiculos', matricula);
    await p.enter();
  }
  await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && document.querySelectorAll('#vd-diagrama .vd-rueda').length > 0`, { que: `detalle de ${matricula}` });
}
