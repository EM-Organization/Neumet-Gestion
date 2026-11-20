#!/usr/bin/env node
// Carga inicial del listado de neumáticos de Agencia Central (docs/20). Por defecto NO escribe: lee el .xlsx, arma el
// plan y muestra conteos y advertencias (dry-run). Con --ejecutar corre una sola transacción contra la base.
//
//   node supabase/seed/importar-agencia-central.mjs --archivo ruta.xlsx                      # dry-run sin base
//   NEUMET_DB_URL=... node supabase/seed/importar-agencia-central.mjs --archivo ruta.xlsx    # dry-run + choques con la base
//   NEUMET_DB_URL=... node supabase/seed/importar-agencia-central.mjs --archivo ruta.xlsx --ejecutar
//   ... --emitir-sql salida.sql                                                              # solo genera el SQL
//
// Credencial: NEUMET_DB_URL (cadena de conexión Postgres con un rol que omita RLS: postgres). Se lee del entorno y no se
// imprime ni se guarda. Requiere `psql` en el PATH (o PSQL_BIN). El listado trae datos del cliente: no va al repositorio.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { leerXlsx } from './lib/xlsx.mjs';
import { filasDesdeTabla, armarPlan } from './lib/agencia-central.mjs';
import { sqlPreflight, sqlCarga } from './lib/sql.mjs';

const AYUDA = `Uso: importar-agencia-central.mjs --archivo <listado.xlsx> [opciones]
  --cliente-id N          cliente destino (por defecto 1)
  --sucursal-id N         sucursal destino (por defecto 1)
  --nombre-cliente TXT    nombre que debe tener el cliente (por defecto "Agencia Central"); si no coincide no se escribe
  --fecha-carga AAAA-MM-DD  fecha de baja de los descartes y de las notas (por defecto hoy)
  --descarte baja|omitir  baja: los DESCARTE entran con estado baja (necesita que la base lo admita); omitir: no se cargan
  --ejecutar              escribe en la base (sin esto es un dry-run)
  --emitir-sql ARCHIVO    escribe el SQL de la carga en ARCHIVO y termina (no se conecta)
  --detalle               lista todas las advertencias (por defecto, solo conteos por tipo)`;

function leerArgs(argv) {
  const o = { clienteId: 1, sucursalId: 1, nombreCliente: 'Agencia Central', descarte: 'baja', ejecutar: false, detalle: false,
    fechaCarga: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`Falta el valor de ${a}`); return argv[++i]; };
    if (a === '--archivo') o.archivo = val();
    else if (a === '--cliente-id') o.clienteId = Number(val());
    else if (a === '--sucursal-id') o.sucursalId = Number(val());
    else if (a === '--nombre-cliente') o.nombreCliente = val();
    else if (a === '--fecha-carga') o.fechaCarga = val();
    else if (a === '--descarte') o.descarte = val();
    else if (a === '--ejecutar') o.ejecutar = true;
    else if (a === '--dry-run') o.ejecutar = false;
    else if (a === '--emitir-sql') o.emitirSql = val();
    else if (a === '--detalle') o.detalle = true;
    else if (a === '--ayuda' || a === '-h') o.ayuda = true;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (!Number.isInteger(o.clienteId) || !Number.isInteger(o.sucursalId)) throw new Error('--cliente-id y --sucursal-id deben ser enteros');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.fechaCarga)) throw new Error('--fecha-carga debe ser AAAA-MM-DD');
  if (!['baja', 'omitir'].includes(o.descarte)) throw new Error('--descarte debe ser baja u omitir');
  return o;
}

function psql(url, sql, { solido = true } = {}) {
  const bin = process.env.PSQL_BIN || 'psql';
  const r = spawnSync(bin, [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw new Error(`No se pudo ejecutar psql (${r.error.message}). Instalarlo o definir PSQL_BIN.`);
  if (r.status !== 0 && solido) throw new Error(`psql terminó con error:\n${(r.stderr || '').split(url).join('<NEUMET_DB_URL>')}`);
  return r;
}

function imprimirResumen(plan, o, pre) {
  const r = plan.resumen;
  const out = [];
  out.push(`Filas del listado: ${r.filas}`);
  out.push(`Vehículos a cargar: ${r.vehiculos} (ya cargados antes: ${r.vehiculosYaCargados})`);
  out.push(`Neumáticos montados: ${r.montados} (de ellos, auxilio en posición 99: ${r.auxilios})`);
  out.push(`Neumáticos a stock (sucursal ${o.sucursalId}, estado almacenado): ${r.stock}`);
  out.push(`Neumáticos en baja (DESCARTE): ${r.bajas}${o.descarte === 'omitir' ? ` — omitidos por --descarte omitir: ${r.descartesOmitidos}` : ''}`);
  out.push(`Códigos repetidos cargados sin código: ${r.codigosRepetidos}`);
  out.push(`Neumáticos que ya estaban cargados (no se duplican): ${r.neumaticosYaCargados}`);
  out.push(`Filas omitidas: ${r.omitidas} · Avisos: ${r.avisos}`);
  const porTexto = new Map();
  for (const a of plan.advertencias) {
    const clave = `${a.nivel === 'omitida' ? 'OMITIDA' : 'aviso'}: ${a.texto.replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#')}`;
    porTexto.set(clave, (porTexto.get(clave) ?? 0) + 1);
  }
  out.push('Advertencias por tipo:');
  for (const [k, v] of [...porTexto].sort((x, y) => y[1] - x[1])) out.push(`  ${String(v).padStart(5)}  ${k}`);
  if (o.detalle) {
    out.push('Detalle:');
    for (const a of plan.advertencias) out.push(`  [${a.nivel}] ${a.fila ? `fila ${a.fila}: ` : ''}${a.texto}`);
  }
  if (pre) {
    out.push(`Base: cliente «${pre.cliente}», sucursal del cliente: ${pre.sucursal_ok ? 'sí' : 'NO'}, nombre coincide: ${pre.nombre_ok ? 'sí' : 'NO'}`);
    out.push(`Base: vehículos existentes del cliente: ${pre.vehiculos.length}; neumáticos de cargas anteriores: ${pre.neumaticos.length}`);
    out.push(`Base: admite baja sin vehículo: ${pre.baja_sin_vehiculo ? 'sí' : 'NO'}`);
  } else {
    out.push('Sin NEUMET_DB_URL: no se comprobaron choques con vehículos existentes ni la restricción de baja.');
  }
  console.log(out.join('\n'));
}

function principal() {
  const o = leerArgs(process.argv.slice(2));
  if (o.ayuda || !o.archivo) { console.log(AYUDA); return o.ayuda ? 0 : 1; }
  const filas = filasDesdeTabla(leerXlsx(readFileSync(o.archivo)));
  const url = process.env.NEUMET_DB_URL;
  const emitir = Boolean(o.emitirSql);

  let pre = null;
  if (url && !emitir) {
    const r = psql(url, sqlPreflight(o));
    pre = JSON.parse(r.stdout.trim());
    if (!pre.sucursal_ok || !pre.nombre_ok) {
      console.error(`El cliente ${o.clienteId} no se llama «${o.nombreCliente}» o la sucursal ${o.sucursalId} no es suya. Nada se escribió.`);
      return 1;
    }
  }
  const plan = armarPlan(filas, o, pre ? { vehiculos: pre.vehiculos, neumaticos: pre.neumaticos } : undefined);
  imprimirResumen(plan, o, pre);

  if (emitir) {
    writeFileSync(o.emitirSql, sqlCarga(plan, o), { mode: 0o600 });
    console.log(`SQL escrito en ${o.emitirSql} (contiene datos del cliente: no versionar).`);
    return 0;
  }
  if (!o.ejecutar) { console.log('Dry-run: no se escribió nada. Para cargar, repetir con --ejecutar.'); return 0; }

  if (!url) { console.error('Falta NEUMET_DB_URL en el entorno para --ejecutar.'); return 1; }
  if (pre && o.descarte === 'baja' && plan.resumen.bajas > 0 && !pre.baja_sin_vehiculo) {
    console.error('La base no admite neumáticos en baja sin vehículo (neumaticos_stock_ck exige almacenado). Nada se escribió.\n'
      + 'Opciones: aplicar antes una migración que lo permita, o repetir con --descarte omitir para cargar el resto.');
    return 1;
  }
  if (plan.resumen.omitidas > 0) console.log(`Atención: ${plan.resumen.omitidas} filas omitidas (ver advertencias); el resto se carga.`);
  const r = psql(url, sqlCarga(plan, o));
  console.log(`Carga confirmada (una transacción). Resultado: ${r.stdout.trim().split('\n').pop()}`);
  return 0;
}

try {
  process.exitCode = principal();
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
}
