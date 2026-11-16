// Accesibilidad del sistema de diseño base: roles, nombres accesibles, foco y teclado (docs/19 §6, chequeo 5).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount, createRawSnippet, tick } from 'svelte';
import { Boton, Insignia, EstadoVacio, Tabla, Modal, Avisos, crearAvisos } from './index.js';

const montados = [];
function montar(Comp, props = {}) {
  const target = document.body.appendChild(document.createElement('div'));
  const inst = mount(Comp, { target, props });
  montados.push(inst);
  flushSync();
  return target;
}
const texto = (html) => createRawSnippet(() => ({ render: () => html }));
const tecla = (key, opciones = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opciones }));

afterEach(() => {
  while (montados.length) unmount(montados.pop());
  document.body.innerHTML = '';
});

describe('Boton', () => {
  it('es un button con tipo button por defecto y atiende el clic', () => {
    const alClic = vi.fn();
    const t = montar(Boton, { children: texto('<span>Guardar</span>'), onclick: alClic });
    const b = t.querySelector('button');
    expect(b.type).toBe('button');
    expect(b.textContent).toContain('Guardar');
    b.click();
    expect(alClic).toHaveBeenCalledTimes(1);
  });
  it('cargando: deshabilitado, aria-busy y lo dice con texto', () => {
    const alClic = vi.fn();
    const t = montar(Boton, { cargando: true, children: texto('<span>Guardar</span>'), onclick: alClic });
    const b = t.querySelector('button');
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.textContent.trim()).toBe('Procesando…');
    b.click();
    expect(alClic).not.toHaveBeenCalled();
  });
  it('sin cargar no declara aria-busy', () => {
    expect(montar(Boton, { children: texto('<span>Ok</span>') }).querySelector('button').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Insignia', () => {
  it('el estado va en texto y el símbolo queda fuera del árbol de accesibilidad', () => {
    const t = montar(Insignia, { tono: 'critico', texto: 'Crítico' });
    expect(t.textContent).toContain('Crítico');
    expect(t.querySelector('[aria-hidden="true"]').textContent).toBe('▲');
  });
  it('cada tono lleva un símbolo distinto, no solo un color', () => {
    const simbolos = ['ok', 'atencion', 'critico', 'info', 'neutro'].map((tono) => montar(Insignia, { tono, texto: 'x' }).querySelector('[aria-hidden]').textContent);
    expect(new Set(simbolos).size).toBe(5);
  });
  it('el rojo solo aparece en el tono crítico', () => {
    for (const tono of ['ok', 'atencion', 'info', 'neutro']) {
      expect(montar(Insignia, { tono, texto: 'x' }).querySelector('[data-tono]').className).not.toContain('danger');
    }
    expect(montar(Insignia, { tono: 'critico', texto: 'x' }).querySelector('[data-tono]').className).toContain('danger');
  });
});

describe('EstadoVacio', () => {
  it('es una región status con título, detalle y acción opcional', () => {
    const t = montar(EstadoVacio, { titulo: 'Sin vehículos registrados', detalle: 'Usar «Nuevo vehículo» para crear el primero', accion: texto('<button>Nuevo vehículo</button>') });
    const r = t.querySelector('[role="status"]');
    expect(r.textContent).toContain('Sin vehículos registrados');
    expect(r.textContent).toContain('Usar «Nuevo vehículo»');
    expect(r.querySelector('button')).not.toBeNull();
  });
});

describe('Tabla', () => {
  const columnas = [{ clave: 'm', etiqueta: 'Matrícula' }, { clave: 'n', etiqueta: 'Neumáticos', alinear: 'der' }];
  const filas = [{ id: 1, m: 'AB123', n: 6 }, { id: 2, m: 'CD456', n: 10 }];

  afterEach(() => { delete globalThis.matchMedia; });

  it('en escritorio es una tabla con leyenda y encabezados de columna', () => {
    const t = montar(Tabla, { columnas, filas, leyenda: 'Vehículos' });
    expect(t.querySelector('table caption').textContent).toBe('Vehículos');
    expect([...t.querySelectorAll('th[scope="col"]')].map((x) => x.textContent)).toEqual(['Matrícula', 'Neumáticos']);
    expect(t.querySelectorAll('tbody tr')).toHaveLength(2);
  });
  it('bajo 768 px pasa a tarjetas: lista con pares etiqueta y valor, sin tabla', async () => {
    globalThis.matchMedia = (q) => ({ matches: q === '(max-width: 767px)', addEventListener() {}, removeEventListener() {} });
    const t = montar(Tabla, { columnas, filas, leyenda: 'Vehículos' });
    await tick();
    expect(t.querySelector('table')).toBeNull();
    const lista = t.querySelector('ul[aria-label="Vehículos"]');
    expect(lista.className).toContain('tw:list-none'); // sin esto el reinicio de estilos no alcanza y cada tarjeta lleva una viñeta suelta
    expect(lista.querySelectorAll('li')).toHaveLength(2);
    expect([...lista.querySelector('li').querySelectorAll('dt')].map((x) => x.textContent)).toEqual(['Matrícula', 'Neumáticos']);
    expect([...lista.querySelector('li').querySelectorAll('dd')].map((x) => x.textContent)).toEqual(['AB123', '6']);
  });
  it('reacciona al cambio de ancho sin recargar', async () => {
    let alCambiar;
    globalThis.matchMedia = () => ({ matches: false, addEventListener: (_, fn) => { alCambiar = fn; }, removeEventListener() {} });
    const t = montar(Tabla, { columnas, filas });
    expect(t.querySelector('table')).not.toBeNull();
    alCambiar({ matches: true });
    await tick();
    expect(t.querySelector('table')).toBeNull();
    expect(t.querySelectorAll('li')).toHaveLength(2);
  });
  it('vuelve a la tabla al ensancharse y consulta el punto de corte de 768 px', async () => {
    let alCambiar;
    const consultas = [];
    globalThis.matchMedia = (q) => { consultas.push(q); return { matches: true, addEventListener: (_, fn) => { alCambiar = fn; }, removeEventListener() {} }; };
    const t = montar(Tabla, { columnas, filas });
    await tick();
    expect(consultas).toEqual(['(max-width: 767px)']);
    expect(t.querySelector('table')).toBeNull();
    alCambiar({ matches: false });
    await tick();
    expect(t.querySelector('table')).not.toBeNull();
  });
  it('al desmontar suelta el oyente de matchMedia que registró (no queda uno por montaje)', async () => {
    const alta = [], baja = [];
    globalThis.matchMedia = () => ({ matches: false, addEventListener: (e, fn) => alta.push([e, fn]), removeEventListener: (e, fn) => baja.push([e, fn]) });
    const inst = mount(Tabla, { target: document.body.appendChild(document.createElement('div')), props: { columnas, filas } });
    flushSync();
    expect(alta).toHaveLength(1);
    expect(baja).toHaveLength(0);
    unmount(inst);
    expect(baja).toEqual(alta);
  });
  it('sin matchMedia (entorno sin la API) queda la tabla y no lanza', () => {
    const t = montar(Tabla, { columnas, filas });
    expect(globalThis.matchMedia).toBeUndefined();
    expect(t.querySelector('table')).not.toBeNull();
  });
  it('sin filas muestra el estado vacío, no una tabla de encabezados sueltos', () => {
    const t = montar(Tabla, { columnas, filas: [], vacio: { titulo: 'Sin vehículos registrados' } });
    expect(t.querySelector('table')).toBeNull();
    expect(t.querySelector('[role="status"]').textContent).toContain('Sin vehículos registrados');
  });
  it('filas null (ejecutar devuelve datos null ante un error) muestra el estado vacío y no lanza', () => {
    const t = montar(Tabla, { columnas, filas: null, vacio: { titulo: 'Sin vehículos registrados' } });
    expect(t.querySelector('[role="status"]').textContent).toContain('Sin vehículos registrados');
  });
  it('escapa el contenido: un valor con HTML se muestra como texto', () => {
    const t = montar(Tabla, { columnas, filas: [{ id: 1, m: '<img src=x onerror=alert(1)>', n: 1 }] });
    expect(t.querySelector('img')).toBeNull();
    expect(t.querySelector('tbody td').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('Modal', () => {
  const contenido = '<label>Nombre <input id="nombre"></label><input id="otro">';
  const pie = '<button id="cancelar">Cancelar</button><button id="guardar">Guardar</button>';
  const abrir = (extra = {}) => {
    const alCerrar = vi.fn();
    const t = montar(Modal, { abierto: true, titulo: 'Nuevo vehículo', children: texto(`<div>${contenido}</div>`), pie: texto(`<span>${pie}</span>`), alCerrar, ...extra });
    return { t, alCerrar, dlg: () => document.querySelector('[role="dialog"],[role="alertdialog"]') };
  };

  it('role dialog, aria-modal y nombre accesible tomado del título', () => {
    const { dlg } = abrir();
    expect(dlg().getAttribute('aria-modal')).toBe('true');
    const titulo = document.getElementById(dlg().getAttribute('aria-labelledby'));
    expect(titulo.tagName).toBe('H2');
    expect(titulo.textContent).toBe('Nuevo vehículo');
  });
  it('una confirmación (alerta) es alertdialog', () => {
    expect(abrir({ alerta: true }).dlg().getAttribute('role')).toBe('alertdialog');
  });
  it('cerrado no pinta nada', () => {
    montar(Modal, { abierto: false, titulo: 'x' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('el foco inicial va al primer control fuera del pie', async () => {
    abrir();
    await tick(); await tick();
    expect(document.activeElement.id).toBe('nombre');
  });
  it('Tab desde el último control vuelve al primero y Shift+Tab desde el primero va al último (foco atrapado)', async () => {
    abrir();
    await tick(); await tick();
    document.getElementById('guardar').focus();
    tecla('Tab');
    expect(document.activeElement.id).toBe('nombre');
    tecla('Tab', { shiftKey: true });
    expect(document.activeElement.id).toBe('guardar');
  });
  it('si el foco quedó fuera del modal, Tab lo devuelve adentro', async () => {
    abrir();
    await tick(); await tick();
    const fuera = document.body.appendChild(document.createElement('button'));
    fuera.focus();
    tecla('Tab');
    expect(document.querySelector('[role="dialog"]').contains(document.activeElement)).toBe(true);
  });
  it('Escape cierra y avisa', async () => {
    const { alCerrar } = abrir();
    tecla('Escape');
    await tick();
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('al cerrar devuelve el foco al elemento que lo abrió', async () => {
    const origen = document.body.appendChild(document.createElement('button'));
    origen.focus();
    abrir();
    await tick(); await tick();
    expect(document.activeElement).not.toBe(origen);
    tecla('Escape');
    await tick();
    expect(document.activeElement).toBe(origen);
  });
  it('clic en el fondo cierra; clic dentro no', async () => {
    const { alCerrar } = abrir();
    document.getElementById('nombre').click();
    document.querySelector('[role="dialog"]').click();
    expect(alCerrar).not.toHaveBeenCalled();
    document.querySelector('[role="dialog"]').parentElement.click();
    await tick();
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });
  it('una alerta no se cierra con el fondo (obliga a elegir una opción) pero sí con Escape', async () => {
    const { alCerrar } = abrir({ alerta: true });
    document.querySelector('[role="alertdialog"]').parentElement.click();
    expect(alCerrar).not.toHaveBeenCalled();
    tecla('Escape');
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });
  it('con dos apilados, Escape cierra solo el de arriba', async () => {
    const a = vi.fn(), b = vi.fn();
    montar(Modal, { abierto: true, titulo: 'Abajo', children: texto('<button>a</button>'), alCerrar: a });
    montar(Modal, { abierto: true, titulo: 'Arriba', children: texto('<button>b</button>'), alCerrar: b });
    tecla('Escape');
    await tick();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    tecla('Escape');
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe('Avisos', () => {
  it('las regiones status y alert existen desde el principio (un lector solo anuncia regiones ya presentes)', () => {
    const t = montar(Avisos, { avisos: crearAvisos() });
    expect(t.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(t.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('un aviso normal va a la región cortés y uno de error a la asertiva, con texto «Error:»', async () => {
    const cola = crearAvisos();
    const t = montar(Avisos, { avisos: cola });
    cola.avisar('Vehículo guardado');
    cola.avisar('No se pudo guardar. Reintentar.', { error: true });
    await tick();
    expect(t.querySelector('[role="status"]').textContent).toContain('Vehículo guardado');
    expect(t.querySelector('[role="status"]').textContent).not.toContain('Error:');
    const alerta = t.querySelector('[role="alert"]');
    expect(alerta.textContent).toContain('Error:');
    expect(alerta.textContent).toContain('No se pudo guardar');
    cola.limpiar();
  });
  it('se puede cerrar con el botón (teclado) y se retira solo tras su duración', async () => {
    vi.useFakeTimers();
    try {
      const cola = crearAvisos({ duracion: 100 });
      const t = montar(Avisos, { avisos: cola });
      cola.avisar('Uno');
      cola.avisar('Dos');
      await tick();
      const cerrar = t.querySelector('button');
      expect(cerrar.textContent).toBe('Cerrar aviso');
      cerrar.click();
      await tick();
      expect(t.querySelectorAll('[data-aviso]')).toHaveLength(1);
      vi.advanceTimersByTime(150);
      await tick();
      expect(t.querySelectorAll('[data-aviso]')).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
});
