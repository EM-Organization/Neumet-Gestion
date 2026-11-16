// Uso mensual por cliente (F11, piloto de la ola 1): la pantalla vive en src/componentes/Uso.svelte y se monta como isla.
// Solo el equipo Neumet (`soloAdmin`); la base lo hace cumplir (uso_clientes_listar da 42501 al resto).
// No existe una vista vieja: si la bandera está apagada (localStorage.neumet_islas = 'off') o el panel nuevo no carga,
// `viejo` muestra el aviso estático de index.html en lugar de dejar la pantalla en blanco.
import { registrarIsla } from '../core/islas.js';
import { onSalirVista } from '../core/nav.js';

const aviso = () => document.getElementById('uso-no-disponible');

registrarIsla('uso', 'Uso', {
  soloAdmin: true,
  viejo: async () => { const el = aviso(); if (el) el.hidden = false; },
});

// El aviso se oculta al salir: si la isla se monta en la visita siguiente no debe quedar visible a su lado.
onSalirVista((anterior) => { if (anterior === 'uso') { const el = aviso(); if (el) el.hidden = true; } });

export function init() {}
