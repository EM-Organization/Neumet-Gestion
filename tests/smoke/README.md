# Arnés de humo del panel

Carga `adminpanel/index.html` en un iframe (`srcdoc`, mismo origen), sustituye `supabase-js` por `stub.js`
(datos de prueba: 2 clientes, vehículos, dispositivos, mediciones, neumáticos, stock, gastos y una sesión falsa)
y recorre las vistas y los modales principales. El resultado queda en `document.title`:
`SMOKE:OK` o `SMOKE:FAIL:<mensaje>` (captura `error`, `unhandledrejection` y `console.error`).

## Cómo correrlo

Requiere Google Chrome y `python3`:

```
tests/smoke/run.sh admin      # sesión de administrador (clientes, balance, vehículos, dispositivos, mediciones)
tests/smoke/run.sh cliente    # sesión de cliente (panel, vehículos, dispositivos, mediciones)
```

Equivale a servir el repo con `python3 -m http.server <puerto>` y ejecutar:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=15000 --dump-dom http://localhost:<puerto>/tests/smoke/harness.html
```

Variables: `PORT` (por defecto 8791), `CHROME` (ruta del binario). Capturas: añadir
`--window-size=1400,900 --screenshot=out.png` y `?end=<vista>` a la URL para terminar en esa vista.

## Qué NO cubre

Sólo el cliente Supabase simulado: no prueba RLS, auth real, ni datos reales. Los botones se pulsan con
`data-action` (o `onclick` en versiones anteriores del panel).
