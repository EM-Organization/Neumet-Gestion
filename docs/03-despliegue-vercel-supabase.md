## Decisiones de la CSP (vercel.json)

Nota: `docs/02-auditoria-seguridad.md` y este archivo no existian en este worktree; este archivo se creo solo con esta seccion y debe fusionarse con el original.

- `'unsafe-inline'` en `script-src` y `style-src` es temporal: `index.html` y `adminpanel/index.html` contienen scripts, estilos y atributos `style`/`onclick` en linea. Bloquearlos hoy romperia el sitio.
- Como endurecer: (1) mover scripts y estilos en linea a archivos en `assets/`; (2) sustituir handlers `onclick=` por `addEventListener`; (3) quitar `'unsafe-inline'` de `script-src` y probar antes con `Content-Security-Policy-Report-Only`; (4) para estilos, usar clases en lugar de `style=`; (5) si hiciera falta algun inline, usar nonces o hashes.
- `https://cdn.jsdelivr.net` se permite para librerias (p. ej. supabase-js); idealmente fijar version y anadir SRI, o servirlas desde `/assets`.
- `connect-src` limita las llamadas al proyecto Supabase `dqgrlflrjcarxlfetvoj` (REST, Auth, Functions, Realtime por wss).
- `frame-ancestors 'none'` y `X-Frame-Options: DENY` evitan clickjacking.
- Cache: imagenes y fuentes en `/assets` son `immutable` (1 ano); CSS/JS sin hash usan `max-age=3600, must-revalidate`. Si se cambia una imagen, cambiar tambien su nombre de archivo.
