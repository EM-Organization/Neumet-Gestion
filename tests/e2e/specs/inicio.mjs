// Inicio con datos reales: no vacío y con las cifras que dicen las vistas SQL para cada rol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo } from '../lib/flujo.mjs';
import { ALCANCE, cifrasInicio, json, vehiculosVisibles } from '../lib/verdad.mjs';
import { nombrePosicion } from '../../../assets/js/domain/posicion.js';

// Lee de la pantalla de Inicio las proporciones, el contador de alertas, los dispositivos y las listas.
export const LEER_INICIO = `(() => {
  const c = document.querySelector('#inicio-contenido');
  const num = e => Number(e.textContent.replace(/\\D/g, ''));
  const cifras = [...c.querySelectorAll('.inicio-cifra strong')].map(num);
  const frase = (c.querySelector('#inicio-h-resumen') || {}).textContent || '';
  const alertas = c.querySelector('[data-action="irA"][data-args=\\'["alertas"]\\']');
  // Hay dos líneas con esa clase: el recuadro de alertas (en «Requieren atención») y la de dispositivos. Se separan por el texto.
  const lineas = [...c.querySelectorAll('.inicio-linea')].map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  const recuadro = lineas.find(t => /cambiar|revisar/.test(t)) || '';
  const linea = lineas.find(t => !/cambiar|revisar/.test(t)) || '';
  const atencion = [...c.querySelectorAll('#inicio-h-atencion ~ ul .inicio-fila')].map(f => ({
    patente: (f.querySelector('.dash-fleet-pat') || {}).textContent || '', limite: !!f.querySelector('.inicio-punto.limite'), mini: !!f.querySelector('.mini-veh .mv-dest'), ver: (f.querySelector('.inicio-ver') || {}).textContent || '' }));
  const proximos = [...c.querySelectorAll('#inicio-h-proximos ~ ul .inicio-fila')].map(f => ({ patente: (f.querySelector('.dash-fleet-pat') || {}).textContent || '', mini: !!f.querySelector('.mini-veh .mv-dest'), ver: (f.querySelector('.inicio-ver') || {}).textContent || '' }));
  return { cifras, frase: frase.replace(/\\s+/g, ' ').trim(), alertas: alertas ? alertas.textContent : '', linea, recuadro,
           atencion, proximos, texto: c.innerText, titulo: document.querySelector('#inicio-title').textContent,
           segmentos: c.querySelectorAll('.inicio-seg').length, cardsRojas: c.querySelectorAll('.badge.red').length,
           rojosFueraRecuadro: [...c.querySelectorAll('.badge.red')].filter(b => !b.closest('.inicio-linea')).length };
})()`;

// Últimas mediciones tal como se ven: una entrada por vehículo con sus neumáticos.
export const LEER_ULTIMAS = `[...document.querySelectorAll('#inicio-contenido #inicio-h-ultimas ~ ul > li')].map(li => ({
  patente: (li.querySelector('.dash-fleet-pat') || {}).textContent || '',
  neus: [...li.querySelectorAll('.um-neu')].map(n => ({ pos: n.querySelector('.um-pos').textContent,
    mm: n.querySelector('.um-mm').textContent, dif: (n.querySelector('.um-dif') || n.querySelector('.um-sin')).textContent.replace(/\\s+/g, ' ').trim(),
    destacado: !!n.querySelector('.um-dif.alto') })) }))`;

// Referencia independiente de la función SQL: compara por fecha de Montevideo en vez de por instante y no usa la función.
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
             order by p.created_at desc limit 1) as antes
      from ses order by ses.u desc, ses.id, ses.posicion`);
}

const f1 = n => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function textoNeumatico(f) {
  // El valor de la visita es un promedio (ultimas_mediciones.mm_ahora): se rotula como informativo (RN-01).
  if (f.antes === null) return { pos: nombrePosicion(f.posicion), mm: `Promedio ${f1(f.ahora)} mm (informativo)`, dif: 'Sin previa', destacado: false };
  const dif = Math.round((f.ahora - f.antes) * 100) / 100;
  return { pos: nombrePosicion(f.posicion), mm: `Promedio ${f1(f.antes)} → ${f1(f.ahora)} mm (informativo)`, dif: `${dif > 0 ? '+' : dif < 0 ? '\u2212' : ''}${f1(Math.abs(dif))}`, destacado: dif <= 0 && -dif > 1 };
}

export const INICIO_LISTO = `document.querySelectorAll('#inicio-contenido .inicio-cifra').length === 5`;

export function registrar(env) {
  for (const rol of ['admin', 'global', 'salto', 'montevideo']) {
    test(`Inicio (${rol}): muestra datos y cifras coherentes con la base`, async () => {
      await flujo(env, 'inicio', rol, async p => {
        await p.esperar(INICIO_LISTO, { que: 'proporciones de Inicio' });
        const l = await p.eval(LEER_INICIO);
        const e = cifrasInicio(env, rol);
        const buenos = e.nuevo + e.pocoDesgaste;
        assert.ok(e.alertas > 0 && e.limite > 0, 'el demo debe tener alertas y desgaste límite (si no, la prueba no prueba nada)');
        // Proporciones: nuevo, poco desgaste, mayor desgaste, desgaste límite, desconocido y total de neumáticos.
        assert.deepEqual(l.cifras, [e.nuevo, e.pocoDesgaste, e.mayorDesgaste, e.limite, e.desconocido], `proporciones de Inicio (${rol})`);
        const m = l.frase.match(/^(?:(\d[\d.]*) de )?(\d[\d.]*) neumáticos? están en buen estado o con poco desgaste$|^Los (\d[\d.]*) neumáticos están en buen estado o con poco desgaste$/);
        assert.ok(m, `frase de resumen inesperada: ${l.frase}`);
        const total = Number((m[2] || m[3]).replace(/\D/g, ''));
        assert.equal(total, e.total, 'total de neumáticos');
        if (m[1]) assert.equal(Number(m[1].replace(/\D/g, '')), buenos, 'neumáticos en buen estado');
        assert.ok(l.segmentos >= 3, 'barra segmentada');
        // Alertas y dispositivos.
        assert.equal(Number(l.alertas.replace(/\D/g, '')), e.alertas, 'alertas activas en "Ver todas las alertas"');
        // Recuadro de RN-20: «cambiar» es el desgaste límite (color rojo de la base) y «revisar» el resto; las silenciadas no cuentan.
        const r = json(env, `select count(*) filter (where x.color = 'rojo')::int as cambiar, count(*) filter (where x.color <> 'rojo')::int as revisar from public.v_alertas x join public.vehiculos v on v.id = x.vehiculo_id where ${ALCANCE[rol].veh} and (x.silenciada_hasta is null or x.silenciada_hasta <= now())`)[0];
        const esperadoRecuadro = r.cambiar + r.revisar ? `× ${r.cambiar} cambiar · ◆ ${r.revisar} revisar` : '';
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
        // Últimas mediciones: los 8 vehículos medidos más recientemente del alcance del rol, con la comparativa de cada neumático.
        const esp = ultimasEsperadas(env, rol);
        const vehEsp = [...new Set(esp.map(f => f.patente))];
        assert.equal(vehEsp.length, Math.min(8, (await vehiculosVisibles(env, rol)).length), 'el demo debe tener al menos 8 vehículos medidos (o todos los del alcance)');
        assert.ok(esp.some(f => f.antes !== null) && esp.some(f => f.antes === null), 'el demo debe traer neumáticos con y sin medición previa');
        const ult = await p.eval(LEER_ULTIMAS);
        assert.deepEqual(ult.map(v => v.patente), vehEsp, `últimas mediciones (${rol}): vehículos y orden`);
        for (const v of ult) {
          assert.deepEqual(v.neus.map(({ pos, mm, dif, destacado }) => ({ pos, mm, dif: dif.replace('Desgaste alto: ', ''), destacado })),
            esp.filter(f => f.patente === v.patente).map(textoNeumatico), `últimas mediciones (${rol}): neumáticos de ${v.patente}`);
        }
        const visiblesU = new Set((await vehiculosVisibles(env, rol)).map(v => v.patente));
        for (const v of ult) assert.ok(visiblesU.has(v.patente), `${v.patente} (últimas mediciones) fuera del alcance de ${rol}`);
        // Click abre el detalle del vehículo.
        await p.click('#inicio-contenido #inicio-h-ultimas ~ ul > li:first-child .inicio-ver');
        await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && document.querySelector('#vd-cab').innerText.includes(${JSON.stringify(vehEsp[0])})`, { que: 'detalle del primer vehículo medido' });
      });
    });
  }
}
