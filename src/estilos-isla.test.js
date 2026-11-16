import { describe, it, expect, afterEach, vi } from 'vitest';
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

  it('una hoja que da 404 no impide montar: resuelve, no lanza, no reintenta ni deja <style> en línea', async () => {
    const opciones = { hojas: ['assets/falta-1.css', 'assets/ok-1.css'], base: 'https://h.test/panel/islas.js' };
    const p = cargarHojas(opciones);
    const [rota, buena] = document.head.querySelectorAll('link[data-neumet-hoja]');
    rota.dispatchEvent(new Event('error')); // el navegador dispara «error» en un <link> con respuesta 404
    buena.dispatchEvent(new Event('load'));
    await expect(p).resolves.toBeUndefined();
    await expect(cargarHojas(opciones)).resolves.toBeUndefined(); // el segundo montaje no vuelve a pedirla
    expect(document.head.querySelectorAll('link[data-neumet-hoja]')).toHaveLength(2);
    expect(document.head.querySelector('style')).toBeNull();
  });

  it('una hoja que nunca responde no cuelga el montaje (tope de espera)', async () => {
    vi.useFakeTimers();
    try {
      const p = cargarHojas({ hojas: ['assets/lenta-1.css'], base: 'https://h.test/panel/islas.js' });
      await vi.advanceTimersByTimeAsync(4000);
      await expect(p).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('sin hojas resuelve de inmediato', async () => {
    await cargarHojas({ hojas: [] });
    expect(document.head.querySelector('link')).toBeNull();
  });
});
