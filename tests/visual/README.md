# QA visual

Capturas de pantalla de las vistas clave del panel para revisarlas a ojo (textos cortados, desbordes, diagramas rotos,
jerarquía, contraste, estados vacíos). Reutiliza el arnés y el stub de `tests/smoke` (nunca el sitio real ni contraseñas).

```
tests/visual/run.sh                  # todas las escenas, admin y cliente, escritorio (1440x900) y móvil (390x844)
tests/visual/run.sh detalle-rueda    # solo una escena (se pueden pasar varias)
ROLES=cliente SIZES=mobile tests/visual/run.sh alertas
```

Salida: `tests/visual/out/<rol>-<tamaño>-<escena>.png` (ignorado por git; no se commitea). Después hay que **mirar** las
imágenes (por ejemplo con la herramienta Read de Claude Code) y anotar defectos.

Tamaños: desktop (1440x900), mobile (390x844) y laptop (1280x720, opcional con SIZES).
Escenas: `login`, `inicio`, `ultimas-mediciones`, `ciclo-vida` (solo admin), `vehiculos`, `vehiculos-busqueda`, `detalle`, `detalle-rueda`, `detalle-rueda-km` (km estimados con nota de confiabilidad), `detalle-rueda-costo` (costo y costo por km; cliente), `reportes-cpk` (tabla Costo por km), `cambio-neumatico`, `flota`,
`alertas`, `stock`, `stock-alta`, `stock-mover` y `stock-busqueda` (cliente global; `stock-alta` también admin), `cambio-cubierta` y `cambio-almacenar` (cliente), `busqueda`, `dispositivos`, `reportes`, `mediciones`, `clientes`, `ficha` y `dispositivos` (solo admin), `selector-seccional` (cliente global).
`detalle-vacio`, `detalle-vacio-rueda`, `montar-neumatico`, `montar-nueva`, `montar-siguiente` y `retirar-neumatico` (cliente): coche sin neumáticos y montar/retirar (`?montar=1`, `tests/smoke/montar.fixture.js`).
Las de detalle/búsqueda/cambio solo existen como cliente (las fixtures de `vehiculo.fixture.js` son de cliente).

Cómo funciona: `tests/smoke/harness.html?shot=<escena>&vw=<ancho>&vh=<alto>[&cliente=1][&detalle=1][&nosession=1]` deja la
vista pedida en pantalla (`scenes.js`) y Chrome headless hace `--screenshot`. Una segunda pasada con `--dump-dom` comprueba
que el título sea `SMOKE:OK`: cualquier `console.error`, `Acción desconocida`, recurso que no carga, o un menú que resalta una
vista distinta de la activa, hace fallar la escena.

Requisitos: Google Chrome (se busca en la ruta de macOS y en `google-chrome`/`chromium`; o `CHROME=/ruta`) y `python3`.
Las capturas desactivan transiciones y animaciones: con tiempo virtual, Chrome fotografiaba el menú a mitad de la transición y parecía resaltar el ítem anterior (por ejemplo Inicio con otra vista abierta). El estado real del DOM era correcto.
Limitaciones: el stub no reproduce datos reales, RLS ni la caché de módulos del CDN; las fuentes se cargan de la red (sin
red cae a la tipografía del sistema); las animaciones no se capturan. Cada captura tarda unos segundos (44 capturas ~ 5 min).
