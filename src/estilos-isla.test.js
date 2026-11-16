import { describe, it, expect, afterEach } from 'vitest';
import { hojasDelBuild, cargarHojas } from './estilos-isla.js';

afterEach(() => { document.head.innerHTML = ''; });

describe('hojasDelBuild', () => {
  it('sin build (marcador intacto) no hay hojas', () => expect(hojasDelBuild()).toEqual([]));
  it('con build, separa la lista', () => expect(hojasDelBuild('assets/a.css,assets/b.css')).toEqual(['assets/a.css', 'assets/b.css']));
  it('lista vacía', () => expect(hojasDelBuild('')).toEqual([]));
});

describe('cargarHojas', () => {
  it('enlaza la hoja relativa a islas.js, como <link> externo (sin <style> en línea)', async () => {
    const p = cargarHojas({ hojas: ['assets/x-1.css'], base: 'https://h.test/panel/islas.js' });
    const link = document.head.querySelector('link[data-neumet-hoja]');
    expect(link.rel).toBe('stylesheet');
    expect(link.href).toBe('https://h.test/panel/assets/x-1.css');
    expect(document.head.querySelector('style')).toBeNull();
    link.dispatchEvent(new Event('load'));
    await p;
  });

  it('no duplica la hoja al montar dos veces', async () => {
    const opciones = { hojas: ['assets/x-1.css'], base: 'https://h.test/panel/islas.js' };
    const a = cargarHojas(opciones);
    const b = cargarHojas(opciones);
    expect(document.head.querySelectorAll('link[data-neumet-hoja]')).toHaveLength(1);
    document.head.querySelector('link').dispatchEvent(new Event('error'));
    await Promise.all([a, b]); // un error de carga no deja colgado el montaje
  });

  it('sin hojas resuelve de inmediato', async () => {
    await cargarHojas({ hojas: [] });
    expect(document.head.querySelector('link')).toBeNull();
  });
});
