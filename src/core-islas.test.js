// Montaje y desmontaje de islas desde el panel viejo (assets/js/core/islas.js) con el paquete /panel/islas.js simulado.
// Cubre los caminos de falla: que `mod.montar` o `mod.desmontar` lancen no debe dejar la isla a medias, el DOM sin limpiar
// ni un rechazo sin atender.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const estado = vi.hoisted(() => ({ activa: 'hola', salida: null, load: null }));
// /panel/islas.js es un alias (vite.config.mjs) de src/pruebas/panel-islas-simulado.js, que delega en globalThis.__panelIslas.
const simular = (mod) => { globalThis.__panelIslas = { API_ISLAS: 1, ...mod }; };

vi.mock('../assets/js/core/supabase.js', () => ({ db: {} }));
vi.mock('../assets/js/core/seccional.js', () => ({ onCambioSucursal: () => () => {}, sucursalSeleccionada: () => null }));
vi.mock('../assets/js/core/ui.js', () => ({ showToast: () => {} }));
vi.mock('../assets/js/core/auth.js', () => ({
  currentRol: 'admin', currentClienteId: null, currentSucursalId: null,
  esAdmin: () => true, esAdminEmpresa: () => false, puedeVerPrecios: () => true, onLogin: () => {}, onLogout: () => {},
}));
vi.mock('../assets/js/core/nav.js', () => ({
  registerView: (_n, _e, load) => { estado.load = load; return load; },
  switchView: () => {}, hayVista: () => true,
  onSalirVista: (fn) => { estado.salida = fn; },
  vistaActiva: () => estado.activa,
}));

const { registrarIsla, islaMontada } = await import('../assets/js/core/islas.js');
registrarIsla('hola', 'Hola');

const espera = () => new Promise((ok) => setTimeout(ok, 0));
let avisos;
beforeEach(() => {
  estado.activa = 'hola';
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.body.innerHTML = '<div id="view-hola" class="view active"><p id="vieja">vista vieja</p></div>';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('core/islas.js: fallas de la isla', () => {
  it('si mod.montar lanza después de montar el componente, se llama a mod.desmontar y no queda host ni vista oculta', async () => {
    const desmontar = vi.fn();
    simular({ montar: async () => { throw new Error('falló al final del montaje'); }, desmontar });
    await estado.load();
    expect(desmontar).toHaveBeenCalledWith('hola');
    expect(document.querySelector('[data-isla-host]')).toBeNull();
    expect(document.getElementById('vieja').hidden).toBe(false);
    expect(islaMontada('hola')).toBe(false);
    expect(avisos).toHaveBeenCalled();
  });

  it('si además mod.desmontar lanza en ese camino, no hay rechazo y el DOM queda limpio', async () => {
    simular({ montar: async () => { throw new Error('montar'); }, desmontar: () => { throw new Error('desmontar'); } });
    await expect(estado.load()).resolves.toBeUndefined();
    expect(document.querySelector('[data-isla-host]')).toBeNull();
  });

  it('si mod.desmontar lanza al salir de la vista, la limpieza igual corre y no sale una excepción', async () => {
    simular({ montar: async () => true, desmontar: () => { throw new Error('desmontar roto'); } });
    await estado.load();
    expect(islaMontada('hola')).toBe(true);
    expect(document.getElementById('vieja').hidden).toBe(true); // oculta mientras la isla está montada
    expect(() => estado.salida('hola', 'inicio')).not.toThrow();
    expect(islaMontada('hola')).toBe(false);
    expect(document.querySelector('[data-isla-host]')).toBeNull();
    expect(document.getElementById('vieja').hidden).toBe(false); // la vista vieja se restaura aunque desmontar haya fallado
    expect(avisos).toHaveBeenCalled();
  });

  it('un montaje superado cuyo mod.desmontar lanza no rechaza la promesa ni deja el host', async () => {
    simular({
      montar: async () => { estado.activa = 'inicio'; return true; }, // el usuario salió mientras se cargaba
      desmontar: () => { throw new Error('desmontar roto'); },
    });
    await expect(estado.load()).resolves.toBeUndefined();
    await espera();
    expect(document.querySelector('[data-isla-host]')).toBeNull();
    expect(islaMontada('hola')).toBe(false);
  });
});
