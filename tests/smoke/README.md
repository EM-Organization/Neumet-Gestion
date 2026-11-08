# Arnés de humo del panel

Carga `adminpanel/index.html` en un iframe (`srcdoc`, mismo origen), sustituye `supabase-js` por `stub.js`
(datos de prueba: 2 clientes, vehículos, dispositivos, mediciones, neumáticos, stock, gastos y una sesión falsa)
y recorre las vistas y los modales principales. El resultado queda en `document.title`:
`SMOKE:OK` o `SMOKE:FAIL:<mensaje>` (captura `error`, `unhandledrejection` y `console.error`).

## Cómo correrlo

Requiere Google Chrome y `python3`:

```
tests/smoke/run.sh admin      # sesión de administrador (clientes, balance, vehículos, dispositivos, mediciones, ABM de sucursales)
tests/smoke/run.sh cliente    # sesión de cliente global (panel, vehículos, mediciones, selector de sucursal, vista Sucursales; Dispositivos no existe para el cliente)
tests/smoke/run.sh secuser    # sesión de cliente con perfil de SUCURSAL (sin selector; sucursales.fixture.js)
tests/smoke/run.sh detalle    # Vehículos como cliente: buscador (patente/número) y detalle con diagrama de ruedas (vehiculo.fixture.js)
tests/smoke/run.sh sinperfil  # sesión sin perfil: solo «Sin acceso», sin menú ni consultas de datos (sinacceso.flow.js)
tests/smoke/run.sh api        # perfil de rol 'api': igual que sinperfil
tests/smoke/run.sh flota      # Flota con prioridades + Centro de alertas (vistas v_* simuladas en flota.fixture.js)
```

Todos los modos (admin y cliente) arrancan con `inicio.flow.js`: página de Inicio (contadores de atención y enlaces; con vehículos pero sin
neumáticos medidos NO muestra «sin datos»), aviso de conexión oculto salvo problema real, menú por rol
(el cliente ve Inicio, Vehículos, Alertas, Stock y Reportes, y Sucursales si es global; sin elementos `data-admin-only` ni Dispositivos; Stock sin botones de editar/eliminar) y accesibilidad básica (botones de menú, `th scope`, labels, modal con foco atrapado y Esc).

El recorrido del stock de cubiertas (`stock.flow.js`, con `stock.fixture.js` y las cubiertas de `stub.js`) corre dentro de los modos `admin`, `cliente` y `secuser`: lista, filtros, alta con validación local y error de la base, edición, traslado, eliminación con confirmación, perfil de sucursal sin acciones y buscador global por quema. `cambio.flow.js` cubre además la cubierta del stock y la devolución del neumático retirado.

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

Cualquier `console.error` (incluido «Acción desconocida») o recurso que no cargue hace fallar el smoke. Capturas para revisión visual: `tests/visual/run.sh`.
