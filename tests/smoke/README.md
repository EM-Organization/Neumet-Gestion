# Arnés de humo del panel

Carga `adminpanel/index.html` en un iframe (`srcdoc`, mismo origen), sustituye `supabase-js` por `stub.js`
(datos de prueba: 2 clientes, vehículos, dispositivos, mediciones, neumáticos, stock, gastos y una sesión falsa)
y recorre las vistas y los modales principales. El resultado queda en `document.title`:
`SMOKE:OK` o `SMOKE:FAIL:<mensaje>` (captura `error`, `unhandledrejection` y `console.error`).

## Cómo correrlo

Requiere Google Chrome y `python3`:

```
tests/smoke/run.sh admin      # sesión de administrador (clientes, balance, vehículos, dispositivos, mediciones, ABM de seccionales)
tests/smoke/run.sh cliente    # sesión de cliente global (panel, vehículos, dispositivos, mediciones, selector de seccional)
tests/smoke/run.sh secuser    # sesión de cliente con perfil de SECCIONAL (sin selector; seccionales.fixture.js)
tests/smoke/run.sh detalle    # Vehículos como cliente: buscador (patente/número) y detalle con diagrama de ruedas (vehiculo.fixture.js)
tests/smoke/run.sh flota      # Flota con prioridades + Centro de alertas (vistas v_* simuladas en flota.fixture.js)
```

Todos los modos (admin y cliente) arrancan con `inicio.flow.js`: página de Inicio (contadores de atención y enlaces), menú por rol
(el cliente no ve Clientes/Balance ni elementos `data-admin-only`) y accesibilidad básica (botones de menú, `th scope`, labels, modal con foco atrapado y Esc).

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

## Notas (módulos ES)

El panel se carga como módulos ES (`assets/js/main.js`); el arnés sigue sustituyendo solo el `<script>` de supabase-js por `stub.js`.
El iframe congela `Date` (2026-06-15 12:00 UTC) para que las firmas de texto (`texto=<largo>:<hash>`) sean reproducibles, y con
`?end=<vista>` desactiva transiciones para capturas idénticas byte a byte. Conocido: la firma de `balance` alterna entre dos
valores (`649:…` / `716:…`) por una carrera con `requestAnimationFrame` del gráfico; ocurre igual en el monolito anterior.
