import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { crearRegistro, ISLAS, API_ISLAS } from './registro.js';
import Hola from './componentes/Hola.svelte';

const svelte = { mount, unmount };
const componentes = { hola: Hola };
const contenedor = () => document.body.appendChild(document.createElement('div'));

// ctx mínimo: la lectura de v_alertas devuelve `count` filas, o un error si se pide.
const ctxDe = (rol, { count = 3, error = null } = {}) => ({
  api: API_ISLAS,
  rol,
  db: { from: () => ({ select: () => Promise.resolve({ count, error }) }) },
});
const espera = () => new Promise((ok) => setTimeout(ok, 0));

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('banderas', () => {
  it('por defecto la isla de humo está apagada para todo rol', () => {
    const reg = crearRegistro();
    for (const rol of ['admin', 'cliente', 'sin_acceso', null, undefined]) expect(reg.activa('hola', rol)).toBe(false);
    expect(ISLAS.hola.roles).toEqual([]);
  });

  it('apagada: montar no toca el DOM', () => {
    const el = contenedor();
    expect(crearRegistro().montar('hola', el, ctxDe('admin'), componentes, svelte)).toBe(false);
    expect(el.innerHTML).toBe('');
  });

  it('una isla desconocida o sin rol nunca se enciende', () => {
    const reg = crearRegistro({ hola: { roles: ['admin'] } });
    expect(reg.activa('otra', 'admin')).toBe(false);
    expect(reg.activa('hola', null)).toBe(false);
    expect(reg.activa('hola', 'cliente')).toBe(false);
  });
});

describe('override de soporte', () => {
  it('on:hola enciende la isla forzable para admin y cliente, no para sin_acceso ni sin sesión', () => {
    localStorage.setItem('neumet_islas', 'on:hola');
    const reg = crearRegistro();
    expect(reg.activa('hola', 'admin')).toBe(true);
    expect(reg.activa('hola', 'cliente')).toBe(true);
    expect(reg.activa('hola', 'sin_acceso')).toBe(false);
    expect(reg.activa('hola', null)).toBe(false);
  });

  it('on: solo enciende las islas nombradas', () => {
    localStorage.setItem('neumet_islas', 'on:otra');
    expect(crearRegistro().activa('hola', 'admin')).toBe(false);
  });

  it('una isla no forzable ignora on:', () => {
    localStorage.setItem('neumet_islas', 'on:real');
    expect(crearRegistro({ real: { roles: [] } }).activa('real', 'admin')).toBe(false);
  });

  it('off apaga aunque la bandera esté encendida', () => {
    localStorage.setItem('neumet_islas', 'off');
    expect(crearRegistro({ hola: { roles: ['admin'] } }).activa('hola', 'admin')).toBe(false);
  });
});

describe('montaje (bandera encendida para admin)', () => {
  const islas = { hola: { roles: ['admin'] } };

  it('monta con el dominio compartido (@domain) y desmonta sin dejar nada', () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    expect(reg.montar('hola', el, ctxDe('admin'), componentes, svelte)).toBe(true);
    expect(el.querySelector('[data-isla="hola"]').textContent).toMatch(/1\.234,5|1,234\.5|1234,5/);
    reg.desmontar('hola');
    expect(el.innerHTML).toBe('');
  });

  it('montar dos veces no duplica', () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    reg.montar('hola', el, ctxDe('admin'), componentes, svelte);
    reg.montar('hola', el, ctxDe('admin'), componentes, svelte);
    expect(el.querySelectorAll('[data-isla="hola"]')).toHaveLength(1);
  });

  it('desmontarTodas limpia todo lo montado', () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    reg.montar('hola', el, ctxDe('admin'), componentes, svelte);
    reg.desmontarTodas();
    expect(el.innerHTML).toBe('');
    expect(reg.montadas()).toEqual([]);
  });

  it('lee v_alertas por ctx.db y muestra el conteo', async () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    reg.montar('hola', el, ctxDe('admin', { count: 7 }), componentes, svelte);
    expect(el.querySelector('[data-alertas]').textContent).toContain('Cargando');
    await espera(); flushSync();
    expect(el.querySelector('[data-alertas]').textContent).toContain('Alertas visibles: 7');
  });

  it('un error de lectura se muestra sin romper (sin mensaje técnico)', async () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    reg.montar('hola', el, ctxDe('admin', { error: { code: '42501', message: 'permission denied for view v_alertas' } }), componentes, svelte);
    await espera(); flushSync();
    expect(el.querySelector('[data-alertas]').textContent).toContain('Sin lectura de alertas');
    expect(el.textContent).not.toContain('42501');
  });

  it('si se desmonta antes de que responda la consulta no falla ni escribe', async () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    reg.montar('hola', el, ctxDe('admin'), componentes, svelte);
    reg.desmontar('hola');
    await espera();
    expect(el.innerHTML).toBe('');
  });
});

it('API_ISLAS es 1', () => expect(API_ISLAS).toBe(1));
