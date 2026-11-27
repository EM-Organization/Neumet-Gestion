// Inicio con datos reales: no vacío y con las cifras que dicen las vistas SQL para cada rol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo } from '../lib/flujo.mjs';
import { ALCANCE, cifrasInicio, json, vehiculosVisibles } from '../lib/verdad.mjs';
import { nombrePosicion } from '../../../assets/js/domain/posicion.js';
import { ESTADOS } from '../../../assets/js/domain/estado-desgaste.js';

// Lee de la pantalla de Inicio las proporciones, el contador de alertas, los dispositivos y las listas.
export const LEER_INICIO = `(() => {
  const c = document.querySelector('#inicio-contenido');
  const num = e => Number(e.textContent.replace(/\\D/g, ''));
  // Las cifras que valen 0 no se dibujan: se devuelven en orden fijo (nuevo, poco, mayor, límite, desconocido) y las ausentes valen 0.
  const cifras = ['ok', 'bajo', 'mayor', 'limite', 'neutral'].map(k => { const s = c.querySelector('.inicio-cifra .inicio-punto.' + k); return s ? num(s.parentElement.querySelector('strong')) : 0; });
  const frase = (c.querySelector('#inicio-h-resumen') || {}).textContent || '';
  const alertas = c.querySelector('[data-action="alertasVerAbiertas"]');
  // Hay dos líneas con esa clase: el recuadro de alertas (en «Requieren atención») y la de dispositivos. Se separan por el texto.
  const lineas = [...c.querySelectorAll('.inicio-linea')].map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  const recuadro = lineas.find(t => /cambiar|revisar/.test(t)) || '';
  const linea = lineas.find(t => !/cambiar|revisar/.test(t)) || '';
  const atencion = [...c.querySelectorAll('#inicio-h-atencion ~ ul .inicio-fila')].map(f => ({
    patente: (f.querySelector('.dash-fleet-pat') || {}).textContent || '', limite: !!f.querySelector('.inicio-punto.limite'), mini: !!f.querySelector('.mini-veh .mv-dest'), ver: (f.querySelector('.inicio-ver') || {}).textContent || '' }));
  const proximos = [...c.querySelectorAll('#inicio-h-proximos ~ ul .inicio-fila')].map(f => ({ patente: (f.querySelector('.dash-fleet-pat') || {}).textContent || '', mini: !!f.querySelector('.mini-veh .mv-dest'), ver: (f.querySelector('.inicio-ver') || {}).textContent || '' }));
  return { cifras, dibujadas: c.querySelectorAll('.inicio-cifra').length, frase: frase.replace(/\\s+/g, ' ').trim(), alertas: alertas ? alertas.textContent : '', linea, recuadro,
           atencion, proximos, texto: c.innerText, titulo: document.querySelector('#inicio-title').textContent,
           segmentos: c.querySelectorAll('.inicio-seg').length, cardsRojas: c.querySelectorAll('.badge.red').length,
           rojosFueraRecuadro: [...c.querySelectorAll('.badge.red')].filter(b => !b.closest('.inicio-linea')).length };
})()`;

// Últimas mediciones tal como se ven: una fila por vehículo con su peor cambio, el «(informativo)» del pie y el botón «Ver».
export const LEER_ULTIMAS = `(() => {
  const sec = document.querySelector('#inicio-contenido #inicio-h-ultimas');
  const caja = sec ? sec.closest('section') : null;
  const filas = caja ? [...caja.querySelectorAll('ul.inicio-lista > li')] : [];
  return {
    filas: filas.map(li => ({
      patente: (li.querySelector('.dash-fleet-pat') || {}).textContent || '',
      detalle: ((li.querySelector('.inicio-fila-causa') || {}).textContent || '').replace(/\\s+/g, ' ').trim(),
      destacadas: li.querySelectorAll('.mini-veh .mv-dest').length })),
    informativos: caja ? (caja.innerText.match(/\\(informativo\\)/g) || []).length : -1 };
})()`;

// Referencia independiente de la función SQL: compara por fecha de Montevideo en vez de por instante y no usa la función.
// Devuelve una fila por neumático de la última visita de cada vehículo, con su estado de v_estado_neumaticos (auxilio incluido).
export function ultimasEsperadas(env, rol) {
  return json(env, `
    with ult as (
      select v.id, v.patente, max(m.created_at) as u from public.vehiculos v join public.mediciones m on m.vehiculo_id = v.id
       where v.activo and ${ALCANCE[rol].veh} group by v.id, v.patente order by u desc, v.id limit 8),
    ses as (
      select distinct on (m.vehiculo_id, m.posicion) ult.id, ult.patente, ult.u, m.posicion, m.idneumatico, m.promedio
        from public.mediciones m join ult on ult.id = m.vehiculo_id
       where (m.created_at at time zone 'America/Montevideo')::date = (ult.u at time zone 'America/Montevideo')::date
       order by m.vehiculo_id, m.posicion, m.created_at desc)
    select ses.patente, ses.posicion, ses.promedio::float as ahora,
           (select p.promedio::float from public.mediciones p where p.idneumatico = ses.idneumatico
               and (p.created_at at time zone 'America/Montevideo')::date < (ses.u at time zone 'America/Montevideo')::date
             order by p.created_at desc limit 1) as antes,
           (select case when e.posicion = 99 and e.estado in ('mayor_desgaste', 'desgaste_limite') then 'poco_desgaste' else e.estado end
              from public.v_estado_neumaticos e where e.vehiculo_id = ses.id and e.posicion = ses.posicion limit 1) as estado
      from ses order by ses.u desc, ses.id, ses.posicion`);
}

// Peor cambio de un vehículo con el criterio de la vista: peor estado, luego mayor caída en mm, luego la primera posición.
const RANGO = ['desgaste_limite', 'mayor_desgaste', 'poco_desgaste', 'nuevo', 'desconocido'];
const CLAVE_BASE = { desgaste_limite: 'limite', mayor_desgaste: 'mayor', poco_desgaste: 'poco', nuevo: 'bueno', desconocido: 'sinDatos' };
const f1 = n => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const redondeo = (ahora, antes) => Math.round((ahora - antes) * 100) / 100;
export function textoPeorEsperado(filas) {
  const estado = f => RANGO.indexOf(f.estado ?? 'desconocido');
  const caida = f => (f.antes === null ? 0 : Math.max(0, -redondeo(f.ahora, f.antes)));
  const peor = [...filas].sort((a, b) => estado(a) - estado(b) || caida(b) - caida(a) || a.posicion - b.posicion)[0];
  const dif = peor.antes === null ? null : redondeo(peor.ahora, peor.antes);
  const cambio = dif === null ? 'Sin medición previa' : `${dif > 0 ? '+' : dif < 0 ? '−' : ''}${f1(Math.abs(dif))} mm`;
  return [nombrePosicion(peor.posicion), ESTADOS[CLAVE_BASE[peor.estado ?? 'desconocido']].texto, cambio].join(' · ');
}

// Espera a que Inicio esté pintado entero (el resumen se dibuja junto con el resto), sin contar cifras: las que valen 0 no se dibujan.
export const INICIO_LISTO = `!!document.querySelector('#inicio-h-resumen')`;

export function registrar(env) {
  for (const rol of ['admin', 'global', 'salto', 'montevideo']) {
    test(`Inicio (${rol}): muestra datos y cifras coherentes con la base`, async () => {
      await flujo(env, 'inicio', rol, async p => {
        await p.esperar(INICIO_LISTO, { que: 'proporciones de Inicio' });
        const l = await p.eval(LEER_INICIO);
        const e = cifrasInicio(env, rol);
        const buenos = e.nuevo + e.pocoDesgaste;
        assert.ok(e.alertas > 0 && e.limite > 0, 'el demo debe tener alertas y desgaste límite (si no, la prueba no prueba nada)');
        // Proporciones: nuevo, poco desgaste, mayor desgaste, desgaste límite, desconocido (los ceros valen 0 en la lectura).
        const porEstado = [e.nuevo, e.pocoDesgaste, e.mayorDesgaste, e.limite, e.desconocido];
        assert.deepEqual(l.cifras, porEstado, `proporciones de Inicio (${rol})`);
        // Las cifras que valen 0 no se dibujan (RN de Inicio): solo se dibujan las no cero.
        assert.equal(l.dibujadas, porEstado.filter(n => n > 0).length, `cifras dibujadas de Inicio (${rol}): solo las no cero`);
        const m = l.frase.match(/^(?:(\d[\d.]*) de )?(\d[\d.]*) neumáticos? están en buen estado o con poco desgaste$|^Los (\d[\d.]*) neumáticos están en buen estado o con poco desgaste$/);
        assert.ok(m, `frase de resumen inesperada: ${l.frase}`);
        const total = Number((m[2] || m[3]).replace(/\D/g, ''));
        assert.equal(total, e.total, 'total de neumáticos');
        if (m[1]) assert.equal(Number(m[1].replace(/\D/g, '')), buenos, 'neumáticos en buen estado');
        assert.ok(l.segmentos >= 3, 'barra segmentada');
        // Alertas y dispositivos.
        // Enlace «Ver alertas abiertas (N)»: N son las abiertas y no silenciadas, lo que cuenta Inicio.
        const abiertas = json(env, `select count(*)::int as n from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where ${ALCANCE[rol].veh} and x.estado = 'abierta' and (x.silenciada_hasta is null or x.silenciada_hasta <= now())`)[0].n;
        assert.equal(Number(l.alertas.replace(/\D/g, '')), abiertas, 'enlace «Ver alertas abiertas (N)»');
        // Recuadro de RN-20: «cambiar» es el desgaste límite (color rojo de la base) y «revisar» el resto; las silenciadas no cuentan.
        const r = json(env, `select count(*) filter (where x.color = 'rojo')::int as cambiar, count(*) filter (where x.color <> 'rojo')::int as revisar from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where ${ALCANCE[rol].veh} and (x.silenciada_hasta is null or x.silenciada_hasta <= now())`)[0];
        // Sin ceros: «× 2 cambiar» si no hay nada por revisar (RN-20).
        const esperadoRecuadro = [r.cambiar && `× ${r.cambiar} cambiar`, r.revisar && `◆ ${r.revisar} revisar`].filter(Boolean).join(' · ');
        assert.equal(l.recuadro, esperadoRecuadro, `recuadro de alertas (${rol}): ${l.recuadro}`);
        assert.equal(l.linea.startsWith(`Dispositivos: ${e.dispActivos} de ${e.dispTotal} activos`), true, `línea de dispositivos: ${l.linea}`);
        if (e.dispTotal > e.dispActivos) assert.match(l.linea, new RegExp(`${e.dispTotal - e.dispActivos} sin actividad`));
        // Requieren atención: solo vehículos del alcance; primero los que tienen desgaste límite, hasta el máximo de 6.
        const visibles = new Set((await vehiculosVisibles(env, rol)).map(v => v.patente));
        assert.ok(l.atencion.length > 0, 'lista de vehículos que requieren atención vacía');
        for (const f of l.atencion) assert.ok(visibles.has(f.patente), `${f.patente} no pertenece al alcance de ${rol}`);
        // Cada fila lleva su mini vehículo con ruedas resaltadas y el botón «Ver coche N» (nada de «P<n>»).
        for (const f of [...l.atencion, ...l.proximos]) assert.ok(f.mini && /^Ver (coche \d+|vehículo)$/.test(f.ver), `fila sin mini vehículo o sin botón: ${JSON.stringify(f)}`);
        assert.doesNotMatch(l.texto.replace(/[A-Z]{2,3}\d{3,4}|DEMO\d+/g, ''), /(^|\s)P\d/, 'quedan etiquetas «P<n>» en Inicio');
        const limiteListados = Math.min(6, e.vehLimite);
        assert.equal(l.atencion.filter(f => f.limite).length, limiteListados, 'vehículos con desgaste límite en la lista');
        assert.deepEqual(l.atencion.slice(0, limiteListados).map(f => f.limite), Array(limiteListados).fill(true), 'los de desgaste límite van primero');
        // Próximos cambios: acotado a 5 y dentro del alcance.
        assert.equal(l.proximos.length, Math.min(5, e.proximos), 'próximos cambios');
        for (const f of l.proximos) assert.ok(visibles.has(f.patente), `${f.patente} (próximos cambios) fuera del alcance de ${rol}`);
        assert.ok(!/Sin vehículos registrados/.test(l.texto), 'no debe decir "sin datos" teniendo datos');
        // Rojo solo para lo que hay que cambiar (RN-20): el chip «cambiar» del recuadro, y solo si hay desgaste límite.
        assert.equal(l.cardsRojas, r.cambiar ? 1 : 0, 'rojo solo para el recuadro «cambiar»');
        assert.equal(l.rojosFueraRecuadro, 0, 'ningún chip rojo fuera del recuadro');
        if (rol === 'admin') {
          // Solo figuran los clientes con neumáticos críticos o alertas críticas (según v_resumen_flota_cliente).
          const conUrgencias = json(env, `select nombre from public.v_resumen_flota_cliente where n_critico + n_alertas_sev3 > 0 order by nombre`).map(c => c.nombre);
          assert.ok(conUrgencias.includes('Demo Transportes'), 'el demo debe tener urgencias');
          const bloque = l.texto.split('Clientes con más urgencias')[1] || '';
          for (const n of ['Demo Transportes', 'Otra Empresa SA']) assert.equal(bloque.includes(n), conUrgencias.includes(n), `cliente ${n} en "Clientes con más urgencias"`);
        }
        else assert.doesNotMatch(l.texto, /Clientes con más urgencias/);
        assert.equal(l.titulo, 'Inicio');
        // Últimas mediciones: los 8 vehículos medidos más recientemente del alcance del rol, una fila por vehículo con su peor cambio.
        const esp = ultimasEsperadas(env, rol);
        const vehEsp = [...new Set(esp.map(f => f.patente))];
        assert.equal(vehEsp.length, Math.min(8, (await vehiculosVisibles(env, rol)).length), 'el demo debe tener al menos 8 vehículos medidos (o todos los del alcance)');
        assert.ok(esp.some(f => f.antes !== null) && esp.some(f => f.antes === null), 'el demo debe traer neumáticos con y sin medición previa');
        const ult = await p.eval(LEER_ULTIMAS);
        assert.deepEqual(ult.filas.map(f => f.patente), vehEsp, `últimas mediciones (${rol}): vehículos y orden`);
        for (const f of ult.filas) {
          assert.equal(f.detalle, textoPeorEsperado(esp.filter(e => e.patente === f.patente)), `últimas mediciones (${rol}): peor cambio de ${f.patente}`);
          assert.ok(f.destacadas >= 1, `últimas mediciones (${rol}): ${f.patente} sin rueda resaltada`);
        }
        // «(informativo)» va una sola vez, en el pie de la lista, y no en cada fila.
        assert.equal(ult.informativos, 1, `últimas mediciones (${rol}): «(informativo)» una sola vez`);
        const visiblesU = new Set((await vehiculosVisibles(env, rol)).map(v => v.patente));
        for (const f of ult.filas) assert.ok(visiblesU.has(f.patente), `${f.patente} (últimas mediciones) fuera del alcance de ${rol}`);
        // Click abre el detalle del vehículo.
        await p.click('#inicio-contenido #inicio-h-ultimas ~ ul > li:first-child .inicio-ver');
        await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && document.querySelector('#vd-cab').innerText.includes(${JSON.stringify(vehEsp[0])})`, { que: 'detalle del primer vehículo medido' });
      });
    });
  }
}
