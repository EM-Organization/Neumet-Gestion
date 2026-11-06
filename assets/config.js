// Configuración pública del cliente (clave anon de Supabase: la seguridad es RLS, ver docs/02-auditoria-seguridad.md §1).
// Se carga como script clásico ANTES de assets/js/main.js. Cambiar de proyecto = editar solo este archivo (y la CSP).
window.NEUMET_CONFIG = {
  SUPABASE_URL: 'https://dqgrlflrjcarxlfetvoj.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZ3JsZmxyamNhcnhsZmV0dm9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzE4MzIsImV4cCI6MjA5Mzc0NzgzMn0.i9wnVq_OmBuGtzEEyi_ix-upDpFe4T1clO7mOUnp4_E'
};
