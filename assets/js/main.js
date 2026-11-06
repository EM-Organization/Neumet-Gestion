// Punto de entrada del panel (<script type="module">). Cada vista registra sus acciones y su carga al importarse;
// aquí solo se inicializa el cableado de DOM de cada una y se arranca la sesión.
import { initActions } from './core/actions.js';
import { initNav } from './core/nav.js';
import { initAuth, checkAuth } from './core/auth.js';
import './core/seccional.js'; // sus hooks de login deben registrarse antes que los de las vistas
import { initModales } from './core/modal-a11y.js';
import * as inicio from './views/inicio.js';
import * as dashboard from './views/dashboard.js';
import * as clientes from './views/clientes.js';
import * as balance from './views/balance.js';
import * as vehiculos from './views/vehiculos.js';
import * as vehiculoDetalle from './views/vehiculo-detalle.js';
import * as dispositivos from './views/dispositivos.js';
import * as mediciones from './views/mediciones.js';
import * as stock from './views/stock.js';
import * as neumaticos from './views/neumaticos.js';
import * as reportes from './views/reportes.js';
import * as salud from './views/salud-dispositivos.js';
import * as ficha from './views/ficha-cliente.js';
import * as seccionalesAdmin from './views/seccionales-admin.js';
import * as flota from './views/flota.js';
import * as alertas from './views/alertas.js';
import * as cicloVida from './views/ciclo-vida.js';

initActions();
initAuth();
initNav();
initModales();
[inicio,dashboard,clientes,balance,vehiculos,vehiculoDetalle,dispositivos,mediciones,stock,neumaticos,reportes,cicloVida,flota,alertas,salud,ficha,seccionalesAdmin].forEach(v=>v.init());
checkAuth();
