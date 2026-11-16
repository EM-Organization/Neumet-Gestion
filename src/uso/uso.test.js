import { describe, it, expect } from 'vitest';
import { mesEnCurso, sumarMeses, ultimoMesCerrado, mesesElegibles, rangoPorDefecto, etiquetaMes, rangoDeSeleccion, SELECCION_ULTIMOS, ETIQUETA_ULTIMOS, COLUMNAS, filasDeUso } from './uso.js';

describe('meses UTC', () => {
  it('el mes en curso se lee en UTC, no en la zona local', () => {
    // 31 de octubre 23:30 UTC sigue siendo octubre aunque en Chile ya sea noviembre
    expect(mesEnCurso(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10-01');
    expect(mesEnCurso(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
  });
  it('el último mes cerrado es el anterior, también al cruzar el año', () => {
    expect(ultimoMesCerrado(new Date('2026-11-16T10:00:00Z'))).toBe('2026-10-01');
    expect(ultimoMesCerrado(new Date('2027-01-05T10:00:00Z'))).toBe('2026-12-01');
  });
  it('sumarMeses cruza años en ambos sentidos', () => {
    expect(sumarMeses('2026-01-01', -1)).toBe('2025-12-01');
    expect(sumarMeses('2026-12-01', 1)).toBe('2027-01-01');
    expect(sumarMeses('2026-03-01', -14)).toBe('2025-01-01');
  });
  it('mesesElegibles nunca incluye el mes en curso y baja de a uno', () => {
    expect(mesesElegibles(new Date('2026-11-16T00:00:00Z'), 3)).toEqual(['2026-10-01', '2026-09-01', '2026-08-01']);
  });
  it('rango por defecto: 12 meses terminando en el último cerrado', () => {
    expect(rangoPorDefecto(new Date('2026-11-16T00:00:00Z'))).toEqual({ desde: '2025-11-01', hasta: '2026-10-01' });
  });
  it('etiquetaMes', () => {
    expect(etiquetaMes('2026-03-01')).toBe('marzo de 2026');
    expect(etiquetaMes(null)).toBe('—');
  });
});

describe('rangoDeSeleccion', () => {
  const AHORA = new Date('2026-11-16T00:00:00Z');
  it('«Últimos 12 meses» es el rango por defecto', () => {
    expect(rangoDeSeleccion(SELECCION_ULTIMOS, AHORA)).toEqual({ desde: '2025-11-01', hasta: '2026-10-01' });
    expect(ETIQUETA_ULTIMOS).toBe('Últimos 12 meses');
  });
  it('un mes puntual es desde = hasta', () => {
    expect(rangoDeSeleccion('2026-03-01', AHORA)).toEqual({ desde: '2026-03-01', hasta: '2026-03-01' });
  });
  it('un valor que no es un mes (vacío, basura, mes 13) cae al rango por defecto', () => {
    for (const v of ['', null, undefined, 'x', '2026-13-01', '2026-03-15']) expect(rangoDeSeleccion(v, AHORA)).toEqual(rangoPorDefecto(AHORA));
  });
});

describe('filasDeUso', () => {
  it('null o vacío no rompen', () => {
    expect(filasDeUso(null)).toEqual([]);
    expect(filasDeUso([])).toEqual([]);
  });
  it('formatea y no mezcla logins con llamadas', () => {
    const [f] = filasDeUso([{ cliente_id: 7, cliente_nombre: 'Transportes Alfa', mes: '2026-03-01', api_llamadas: 1234, logins: 5, mediciones: 0,
      vehiculos_activos: 10, dispositivos_activos: 2, usuarios: 3, ultimo_ingreso_at: '2026-03-31T23:59:00Z' }]);
    expect(f).toMatchObject({ id: '7-2026-03-01', mes: 'marzo de 2026', cliente: 'Transportes Alfa', api: '1.234', logins: '5', mediciones: '0', ultimoIngreso: '31/03/2026' });
  });
  it('una métrica null o ausente se muestra «—», no 0', () => {
    const [f] = filasDeUso([{ cliente_id: 1, cliente_nombre: 'A', mes: '2026-03-01', api_llamadas: null, logins: undefined, mediciones: 0 }]);
    expect(f).toMatchObject({ api: '—', logins: '—', mediciones: '0', vehiculos: '—', dispositivos: '—', usuarios: '—' });
  });
  it('el último ingreso se muestra en UTC y sin dato dice «Sin ingresos»', () => {
    const base = { cliente_id: 1, cliente_nombre: 'A', mes: '2026-03-01' };
    expect(filasDeUso([{ ...base, ultimo_ingreso_at: '2026-04-01T00:30:00Z' }])[0].ultimoIngreso).toBe('01/04/2026');
    expect(filasDeUso([{ ...base, ultimo_ingreso_at: null }])[0].ultimoIngreso).toBe('Sin ingresos');
  });
});

describe('columnas', () => {
  it('las etiquetas dicen qué se cuenta: los logins son de la cuenta de API y el ingreso es al panel', () => {
    const etiquetas = Object.fromEntries(COLUMNAS.map((c) => [c.clave, c.etiqueta]));
    expect(etiquetas.logins).toBe('Inicios de sesión de API');
    expect(etiquetas.ultimoIngreso).toBe('Último ingreso al panel');
    expect(COLUMNAS.map((c) => c.etiqueta).join(' ')).not.toContain('Logins');
  });
});
