// Configuración del cliente. Los valores viven en assets/config.js (script clásico cargado antes de los módulos).
const cfg = window.NEUMET_CONFIG;
if(!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) throw new Error('Falta assets/config.js (window.NEUMET_CONFIG)');
export const SUPABASE_URL = cfg.SUPABASE_URL;
export const SUPABASE_KEY = cfg.SUPABASE_KEY;
