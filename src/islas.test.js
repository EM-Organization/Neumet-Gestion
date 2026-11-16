// Punto de entrada real (src/islas.js): carga perezosa por isla y desmontaje, con un ctx.db simulado.
import { describe, it, expect, afterEach } from 'vitest';
import { montar, desmontar, desmontarTodas, activa, API_ISLAS } from './islas.js';

const espera = () => new Promise((ok) => setTimeout(ok, 0));
const REGISTRO = { cliente_id: 7, cliente_nombre: 'Alfa', mes: '2026-10-01', api_llamadas: 1, logins: 0, mediciones: 0, vehiculos_activos: 1, dispositivos_activos: 1, usuarios: 1, ultimo_ingreso_at: null };
function ctxDe(rol, rpc = () => Promise.resolve({ data: [REGISTRO], error: null })) {
  return { api: API_ISLAS, rol, db: { rpc, from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) } };
}
const contenedor = () => document.body.appendChild(document.createElement('div'));

afterEach(() => { desmontarTodas(); document.body.innerHTML = ''; });

describe('islas.js', () => {
  it('monta «uso» para admin, carga su componente al pedirlo y desmontar deja el contenedor vacío', async () => {
    const el = contenedor();
    expect(await montar('uso', el, ctxDe('admin'))).toBe(true);
    await espera();
    expect(el.querySelector('[data-isla="uso"]')).not.toBeNull();
    desmontar('uso');
    expect(el.innerHTML).toBe('');
  });

  it('desmontar con la consulta pendiente no lanza ni escribe después', async () => {
    const el = contenedor();
    let resolver;
    await montar('uso', el, ctxDe('admin', () => new Promise((ok) => { resolver = ok; })));
    desmontar('uso');
    resolver({ data: [REGISTRO], error: null });
    await espera();
    expect(el.innerHTML).toBe('');
  });

  it('desmontar una isla que no está montada no lanza; desmontarTodas limpia', async () => {
    expect(() => desmontar('uso')).not.toThrow();
    const el = contenedor();
    await montar('uso', el, ctxDe('admin'));
    desmontarTodas();
    expect(el.innerHTML).toBe('');
  });

  it('con la bandera apagada (cliente) o un ctx de otra versión no monta nada', async () => {
    const el = contenedor();
    expect(await montar('uso', el, ctxDe('cliente'))).toBe(false);
    expect(await montar('uso', el, { ...ctxDe('admin'), api: API_ISLAS + 1 })).toBe(false);
    expect(await montar('inexistente', el, ctxDe('admin'))).toBe(false);
    expect(el.innerHTML).toBe('');
    expect(activa('uso', 'cliente')).toBe(false);
  });
});
