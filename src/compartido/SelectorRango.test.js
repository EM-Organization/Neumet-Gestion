import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { SelectorRango } from './index.js';

const montados = [];
afterEach(() => { while (montados.length) unmount(montados.pop()); document.body.innerHTML = ''; });

function montar(props) {
  const target = document.body.appendChild(document.createElement('div'));
  montados.push(mount(SelectorRango, { target, props }));
  flushSync();
  return target;
}
const opciones = ['2026-03-01', '2026-01-01', '2026-02-01']; // desordenadas a propósito
const sel = (t, texto) => [...t.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(texto)).querySelector('select');
const elegir = (select, valor) => { select.value = valor; select.dispatchEvent(new Event('change', { bubbles: true })); };

describe('SelectorRango', () => {
  it('dos selects con etiqueta dentro de un grupo con nombre, ordenados de menor a mayor y con la selección actual', () => {
    const t = montar({ opciones, desde: '2026-01-01', hasta: '2026-03-01', etiqueta: (k) => `mes ${k.slice(5, 7)}` });
    expect(t.querySelector('[role="group"]').getAttribute('aria-label')).toBe('Rango de meses');
    expect([...sel(t, 'Desde').options].map((o) => o.textContent)).toEqual(['mes 01', 'mes 02', 'mes 03']);
    expect(sel(t, 'Desde').value).toBe('2026-01-01');
    expect(sel(t, 'Hasta').value).toBe('2026-03-01');
  });

  it('avisa el rango nuevo al cambiar un extremo', () => {
    const alCambiar = vi.fn();
    const t = montar({ opciones, desde: '2026-01-01', hasta: '2026-03-01', alCambiar });
    elegir(sel(t, 'Hasta'), '2026-02-01');
    expect(alCambiar).toHaveBeenCalledWith({ desde: '2026-01-01', hasta: '2026-02-01' });
  });

  it('nunca entrega un rango invertido: el extremo elegido arrastra al otro', () => {
    const alCambiar = vi.fn();
    const t = montar({ opciones, desde: '2026-01-01', hasta: '2026-02-01', alCambiar });
    elegir(sel(t, 'Desde'), '2026-03-01');
    expect(alCambiar).toHaveBeenLastCalledWith({ desde: '2026-03-01', hasta: '2026-03-01' });
  });

  it('«Hasta» anterior a «Desde» arrastra a «Desde»', () => {
    const alCambiar = vi.fn();
    const t = montar({ opciones, desde: '2026-02-01', hasta: '2026-03-01', alCambiar });
    elegir(sel(t, 'Hasta'), '2026-01-01');
    expect(alCambiar).toHaveBeenLastCalledWith({ desde: '2026-01-01', hasta: '2026-01-01' });
  });

  it('deshabilitado bloquea ambos selects', () => {
    const t = montar({ opciones, desde: '2026-01-01', hasta: '2026-03-01', deshabilitado: true });
    expect(sel(t, 'Desde').disabled).toBe(true);
    expect(sel(t, 'Hasta').disabled).toBe(true);
  });
});
