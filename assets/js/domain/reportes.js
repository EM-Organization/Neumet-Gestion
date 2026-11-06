// Dominio: reportes exportables. Funciones PURAS (sin DOM, sin supabase) para testear con node:test.
import { wearStatus, avgMm } from './desgaste.js';

export const PAGE_SIZE = 1000;
export const MAX_ROWS = 50000;
export const BOM = '﻿';
export const CSV_HEADER = ['fecha', 'vehiculo', 'patente', 'posicion', 'idneumatico', 'mm1', 'mm2', 'mm3', 'promedio', 'estado'];

// Texto que una hoja de cálculo interpretaría como fórmula: = + - @ tab CR (y LF, por prudencia).
const FORMULA = /^[=+\-@\t\r\n]/;

// Celda CSV (RFC 4180). Números finitos van tal cual; texto con inicio de fórmula se prefija con '.
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = v instanceof Date ? (isNaN(v) ? '' : v.toISOString()) : String(v);
  if (FORMULA.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Filas (arrays) -> texto CSV con BOM UTF-8, separador ',' y fin de línea CRLF.
export function buildCsv(header, rows) {
  return BOM + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const r2 = v => v === null ? null : Math.round(v * 100) / 100;
const iso = s => { const d = new Date(s); return s && !isNaN(d) ? d.toISOString() : ''; };

// Promedio de una fila: usa `promedio` si existe, si no calcula desde mm1..mm3.
export function rowAvg(r) {
  const p = num(r.promedio);
  if (p !== null) return p;
  return avgMm({ mm1: num(r.mm1), mm2: num(r.mm2), mm3: num(r.mm3) });
}

// Filas de medición (con r.vehiculos={nombre,patente} opcional) -> filas CSV.
export function medicionesToCsvRows(rows) {
  return (rows || []).map(r => {
    const avg = rowAvg(r);
    const v = r.vehiculos || {};
    return [iso(r.created_at), v.nombre ?? '', v.patente ?? '', num(r.posicion), r.idneumatico ?? '',
      num(r.mm1), num(r.mm2), num(r.mm3), r2(avg), wearStatus(avg) ?? ''];
  });
}

export function medicionesCsv(rows) { return buildCsv(CSV_HEADER, medicionesToCsvRows(rows)); }

// Nombre de archivo seguro: solo [A-Za-z0-9_-], sin acentos, sin tramos vacíos.
export function safeFilename(parts, ext = 'csv') {
  const base = (Array.isArray(parts) ? parts : [parts])
    .map(p => String(p ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean).join('_').slice(0, 80) || 'reporte';
  return `${base}.${String(ext).replace(/[^a-z0-9]/gi, '') || 'csv'}`;
}

// Última medición por vehículo+posición (no depende del orden de entrada).
export function latestByTire(rows) {
  const best = new Map();
  (rows || []).forEach(r => {
    const k = `${r.vehiculo_id}|${r.posicion}`;
    const cur = best.get(k);
    if (!cur || new Date(r.created_at) > new Date(cur.created_at)) best.set(k, r);
  });
  return [...best.values()];
}

// Resumen de flota: conteos por estado (wearStatus) sobre la última medición de cada neumático.
export function resumenFlota(rows) {
  const total = { neumaticos: 0, ok: 0, bajo: 0, critico: 0, sinDatos: 0 };
  const porVehiculo = new Map();
  const neumaticos = latestByTire(rows).map(r => {
    const avg = rowAvg(r);
    return { vehiculo_id: r.vehiculo_id, nombre: r.vehiculos?.nombre ?? '', patente: r.vehiculos?.patente ?? '',
      posicion: num(r.posicion), idneumatico: r.idneumatico ?? null, promedio: r2(avg),
      estado: wearStatus(avg), created_at: r.created_at };
  }).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '') || (a.posicion ?? 0) - (b.posicion ?? 0));
  neumaticos.forEach(n => {
    const key = n.estado ?? 'sinDatos';
    let v = porVehiculo.get(n.vehiculo_id);
    if (!v) porVehiculo.set(n.vehiculo_id, v = { vehiculo_id: n.vehiculo_id, nombre: n.nombre, patente: n.patente, neumaticos: 0, ok: 0, bajo: 0, critico: 0, sinDatos: 0 });
    total.neumaticos++; total[key]++; v.neumaticos++; v[key]++;
  });
  return { ...total, vehiculos: [...porVehiculo.values()], neumaticos };
}

// Rango de fechas (YYYY-MM-DD, zona local) -> {desde, hasta} ISO; hasta es exclusivo (día siguiente). {error} si es inválido.
export function rangoFechas(desde, hasta) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T00:00:00'));
  const out = { desde: null, hasta: null };
  if (ok(desde)) out.desde = new Date(desde + 'T00:00:00').toISOString();
  if (ok(hasta)) { const d = new Date(hasta + 'T00:00:00'); d.setDate(d.getDate() + 1); out.hasta = d.toISOString(); }
  if (out.desde && out.hasta && out.desde >= out.hasta) return { error: 'La fecha "desde" debe ser anterior o igual a "hasta"' };
  return out;
}

// Lee todo por lotes: fetchPage(from,to) -> {data,error}. Sigue hasta que un lote venga incompleto o se alcance `max`.
// Devuelve {rows, truncated, error}. onProgress(n) tras cada lote.
export async function fetchAll(fetchPage, { pageSize = PAGE_SIZE, max = MAX_ROWS, onProgress } = {}) {
  const rows = [];
  for (;;) {
    const from = rows.length;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { rows, truncated: false, error };
    const got = data || [];
    rows.push(...got);
    if (onProgress) onProgress(Math.min(rows.length, max));
    if (rows.length >= max) return { rows: rows.slice(0, max), truncated: got.length === pageSize || rows.length > max, error: null };
    if (got.length < pageSize) return { rows, truncated: false, error: null };
  }
}
