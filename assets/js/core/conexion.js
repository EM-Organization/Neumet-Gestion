// Aviso de conexión: solo aparece ante un problema real (el navegador pierde la red o una carga falla).
// Mientras todo funciona no se muestra nada. "Reintentar" vuelve a cargar la vista activa.
import { setStatus } from './ui.js';
import { reloadActiveView } from './nav.js';
import { registerActions } from './actions.js';
import { onLogout } from './auth.js';

registerActions({
  reintentarConexion() {
    if (navigator.onLine === false) return; // sigue sin red: el aviso permanece
    setStatus(true);
    reloadActiveView();
  },
});

export function initConexion() {
  window.addEventListener('offline', () => setStatus(false));
  window.addEventListener('online', () => { setStatus(true); reloadActiveView(); });
  onLogout(() => setStatus(true));
  if (navigator.onLine === false) setStatus(false);
}
