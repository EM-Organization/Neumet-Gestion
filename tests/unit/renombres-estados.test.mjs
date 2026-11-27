// Renombres de estado en todo el panel (decisión del dueño, docs/14 §3): una sola fuente de nombres y ningún nombre viejo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textoEstadoBase, ESTADOS, BANDERA } from '../../assets/js/domain/estado-desgaste.js';
import { NIVEL_INFO } from '../../assets/js/domain/vehiculo-diagrama.js';
import { estadoLabel } from '../../assets/js/domain/flota.js';

test('nombres de la base -> textos del producto, sin «Nuevo» ni «Desconocido»', () => {
  assert.deepEqual(['nuevo', 'poco_desgaste', 'mayor_desgaste', 'desgaste_limite', 'desconocido', 'raro'].map(textoEstadoBase),
    ['Buen estado', 'Poco desgaste', 'Mayor desgaste', 'Desgaste límite', 'Sin datos', 'Sin datos']);
  assert.equal(BANDERA.texto, 'Desgaste acelerado');
});

test('Flota y diagrama usan los mismos nombres que estado-desgaste.js', () => {
  for (const e of ['nuevo', 'poco_desgaste', 'mayor_desgaste', 'desgaste_limite', 'desconocido']) assert.equal(estadoLabel(e), textoEstadoBase(e));
  assert.deepEqual([NIVEL_INFO.ok.texto, NIVEL_INFO.bajo.texto, NIVEL_INFO.critico.texto, NIVEL_INFO.retiro.texto, NIVEL_INFO.sin_datos.texto],
    [ESTADOS.bueno.texto, ESTADOS.poco.texto, ESTADOS.mayor.texto, ESTADOS.limite.texto, ESTADOS.sinDatos.texto]);
  // El diagrama no puede importar ESTADOS (ciclo, ver nombres-estado-fuente): sus símbolos se comprueban aquí.
  assert.deepEqual([NIVEL_INFO.ok.simbolo, NIVEL_INFO.bajo.simbolo, NIVEL_INFO.critico.simbolo, NIVEL_INFO.retiro.simbolo],
    [ESTADOS.bueno.simbolo, ESTADOS.poco.simbolo, ESTADOS.mayor.simbolo, ESTADOS.limite.simbolo]);
});

test('el HTML y las vistas no muestran los nombres viejos como estado', () => {
  const archivos = ['adminpanel/index.html', 'assets/js/views/inicio.js', 'assets/js/views/flota.js', 'assets/js/views/reportes.js',
    'assets/js/views/report.js', 'assets/js/views/ficha-cliente.js', 'assets/js/views/mediciones.js', 'assets/js/core/componentes.js',
    'assets/js/domain/flota.js', 'assets/js/domain/inicio.js', 'assets/js/domain/umbrales.js', 'assets/js/domain/vehiculo-diagrama.js'];
  for (const a of archivos) {
    const s = readFileSync(new URL('../../' + a, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /lbl: 'Nuevo'|texto: 'Nuevo'|'Desconocido'|>Desconocido<|<option value="nuevo">Nuevo|mayor al normal|Nuevo \/ poco|\bNUEVO\b|DESCONOCIDO/, a);
  }
});
