import { describe, it, expect, vi, afterEach } from 'vitest';
import { mensajeDeError, userError, ejecutar, crearDatos, MENSAJE_GENERICO, MENSAJE_SIN_PERMISO, MENSAJE_SIN_CONEXION, MENSAJE_SESION } from './datos.js';

afterEach(() => vi.restoreAllMocks());

// Un detalle como el que devuelve PostgREST: nombra tabla, política y columna. Nada de esto puede llegar al usuario.
const rls = { code: '42501', message: 'new row violates row-level security policy "neumaticos_ins" for table "neumaticos"', details: 'columna costo_unitario', hint: 'revisar GRANT' };

describe('mensajeDeError', () => {
  it('42501 es «Sin permiso» y no filtra nada del servidor', () => {
    const m = mensajeDeError(rls);
    expect(m).toBe(MENSAJE_SIN_PERMISO);
    for (const filtrado of ['neumaticos', 'policy', 'costo_unitario', 'GRANT', '42501']) expect(m).not.toContain(filtrado);
  });
  it('sin error no hay mensaje', () => { expect(mensajeDeError(null)).toBe(''); expect(mensajeDeError(undefined)).toBe(''); });
  it('sesión vencida (PGRST301 o JWT expired)', () => {
    expect(mensajeDeError({ code: 'PGRST301', message: 'x' })).toBe(MENSAJE_SESION);
    expect(mensajeDeError({ message: 'JWT expired' })).toBe(MENSAJE_SESION);
  });
  it('falla de red', () => {
    expect(mensajeDeError(new TypeError('Failed to fetch'))).toBe(MENSAJE_SIN_CONEXION);
    expect(mensajeDeError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(MENSAJE_SIN_CONEXION);
  });
  it('lo desconocido es genérico y no repite el mensaje del servidor', () => {
    const m = mensajeDeError({ code: 'XX000', message: 'relation "secreta" does not exist' });
    expect(m).toBe(MENSAJE_GENERICO);
    expect(m).not.toContain('secreta');
  });
  it('los textos cumplen docs/14: sin segunda persona, sin emojis ni exclamaciones', () => {
    for (const t of [MENSAJE_GENERICO, MENSAJE_SIN_PERMISO, MENSAJE_SIN_CONEXION, MENSAJE_SESION]) {
      expect(t).not.toMatch(/[!¡]/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(t).not.toMatch(/\b(vos|tú|usted|tenés|podés)\b/i);
    }
  });
});

describe('userError no ensucia la consola en flujos normales', () => {
  it('sin permiso y sin conexión no registran nada', () => {
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    userError(rls); userError(new TypeError('Failed to fetch'));
    expect(e).not.toHaveBeenCalled();
    expect(w).not.toHaveBeenCalled();
  });
  it('lo inesperado se anota con console.warn (solo el código), nunca con console.error', () => {
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    userError({ code: 'XX000', message: 'detalle interno' });
    expect(e).not.toHaveBeenCalled();
    expect(w).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(w.mock.calls)).not.toContain('detalle interno');
  });
});

describe('ejecutar', () => {
  it('devuelve los datos', async () => {
    expect(await ejecutar(Promise.resolve({ data: [1, 2], error: null }))).toEqual({ datos: [1, 2], error: null, codigo: null });
  });
  it('un error de la base llega como mensaje de usuario con el código aparte', async () => {
    const r = await ejecutar(Promise.resolve({ data: null, error: rls }));
    expect(r).toEqual({ datos: null, error: MENSAJE_SIN_PERMISO, codigo: '42501' });
  });
  it('una promesa rechazada (red) no lanza', async () => {
    const r = await ejecutar(Promise.reject(new TypeError('Failed to fetch')));
    expect(r.error).toBe(MENSAJE_SIN_CONEXION);
    expect(r.datos).toBeNull();
  });
  it('sin permiso no hace console.error', async () => {
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ejecutar(Promise.resolve({ data: null, error: rls }));
    expect(e).not.toHaveBeenCalled();
  });
});

describe('crearDatos sobre ctx.db', () => {
  const db = { from: (t) => ({ select: () => Promise.resolve({ data: [{ t }], error: null }) }), rpc: (n, a) => Promise.resolve({ data: { n, a }, error: null }) };
  it('leer y rpc usan el cliente recibido', async () => {
    const datos = crearDatos(db);
    expect((await datos.leer((c) => c.from('v_alertas').select('*'))).datos).toEqual([{ t: 'v_alertas' }]);
    expect((await datos.rpc('f', { x: 1 })).datos).toEqual({ n: 'f', a: { x: 1 } });
  });
  it('una excepción síncrona al armar la consulta termina en `error`, no en una excepción', async () => {
    const r = await crearDatos(db).leer(() => { throw new TypeError('Failed to fetch'); });
    expect(r.error).toBe(MENSAJE_SIN_CONEXION);
  });
});
