import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import { crearRegistro, ISLAS, API_ISLAS } from './registro.js';
import Hola from './componentes/Hola.svelte';

const svelte = { mount, unmount };
const componentes = { hola: Hola };
const contenedor = () => document.body.appendChild(document.createElement('div'));

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('banderas', () => {
  it('por defecto la isla de humo está apagada para todo rol', () => {
    const reg = crearRegistro();
    for (const rol of ['admin', 'cliente', 'sin_acceso', null, undefined]) expect(reg.activa('hola', rol)).toBe(false);
    expect(ISLAS.hola.roles).toEqual([]);
  });

  it('apagada: montar no toca el DOM', () => {
    const el = contenedor();
    expect(crearRegistro().montar('hola', el, { rol: 'admin' }, componentes, svelte)).toBe(false);
    expect(el.innerHTML).toBe('');
  });

  it('una isla desconocida o sin rol nunca se enciende', () => {
    const reg = crearRegistro({ hola: { roles: ['admin'] } });
    expect(reg.activa('otra', 'admin')).toBe(false);
    expect(reg.activa('hola', null)).toBe(false);
    expect(reg.activa('hola', 'cliente')).toBe(false);
  });
});

describe('montaje (bandera encendida para admin)', () => {
  const islas = { hola: { roles: ['admin'] } };

  it('monta con el dominio compartido (@domain) y desmonta sin dejar nada', () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    expect(reg.montar('hola', el, { rol: 'admin' }, componentes, svelte)).toBe(true);
    expect(el.querySelector('[data-isla="hola"]').textContent).toMatch(/1\.234,5|1,234\.5|1234,5/);
    reg.desmontar('hola');
    expect(el.innerHTML).toBe('');
  });

  it('montar dos veces no duplica', () => {
    const reg = crearRegistro(islas);
    const el = contenedor();
    reg.montar('hola', el, { rol: 'admin' }, componentes, svelte);
    reg.montar('hola', el, { rol: 'admin' }, componentes, svelte);
    expect(el.querySelectorAll('[data-isla="hola"]')).toHaveLength(1);
  });

  it('localStorage.neumet_islas = off apaga aunque la bandera esté encendida', () => {
    localStorage.setItem('neumet_islas', 'off');
    expect(crearRegistro(islas).activa('hola', 'admin')).toBe(false);
  });
});

it('API_ISLAS es 1', () => expect(API_ISLAS).toBe(1));
