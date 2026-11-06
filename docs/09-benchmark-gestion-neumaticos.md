# 09 · Benchmark de gestión de neumáticos para flotas

Fecha: 2026-11-06. Objetivo: definir el backlog de producto de NEUMET (calibre → app → API → panel).

**Convención.** Todo lo marcado **[F]** es *hecho con fuente* (URL en la sección Fuentes; páginas consultadas hoy). Lo marcado **[I]** es *inferencia mía*. "no consta" = no encontré evidencia en las páginas leídas, **no** que la plataforma no lo tenga. Muchas fuentes son marketing del propio proveedor: describen qué se ofrece, no qué tan bien funciona.

## 0. Fuentes (clave → URL)

| Clave | URL |
|---|---|
| R | https://ruedata.ai/ (sitio oficial de Ruedata; `ruedata.com` redirige aquí) |
| R2 | https://www.descubre.vc/noticia/ruedata-digitaliza-la-gesti-n-de-neum-ticos-en-cementos-progreso-2026-03-27 (prensa; sin detalle funcional) |
| E | https://emenube.com (página de Emenube, módulo "Neumáticos: control y rotación") |
| M | https://connectedfleet.michelin.com/es/knowledge-base/modulo-de-neumaticos (Michelin Connected Fleet, módulo de neumáticos) |
| G | https://ttnews.com/articles/goodyear-tire-management-system-complete-solution (contenido patrocinado por Goodyear, 15-feb-2021) |
| B | https://noticias.autocosmos.com.mx/2025/11/14/bridgestone-fleet-care-llega-a-mexico-la-plataforma-para-gestionar-flotas (Bridgestone Fleet Care, México, nov-2025) |
| T | https://www.tirecheck.com |
| U | https://uffizio.com/blog/benefits-of-tire-inventory-management-software-in-fleet-operations/ |
| TS | https://github.com/tiresoft-platform (README del perfil de la organización) |
| Y | https://github.com/yusufaykin/TireManagementSystem |
| F | https://github.com/jmnda-dev/Fleetms |
| FB | https://github.com/fleetbase/fleetbase |
| O | https://raw.githubusercontent.com/odoo/odoo/master/addons/fleet/__manifest__.py y https://www.odoo.com/documentation/19.0/applications/hr/fleet/service.html |
| C | CPK: https://www.hanksugi.com/nz/cost-calculator.html y https://www.kweli.co.za/blog/truck-tyre-cost-per-km-south-africa/ (resultados de búsqueda; ver §3) |

**No verificado (intentado):** Pirelli+Geotab (la página devolvió 403), Fleetio (403; solo vi su listado en buscadores, sin contenido), Tiremetrix (solo resultados indirectos que lo nombran como integración de registro DOT/TPMS de talleres en EE. UU.; no lo trato como competidor de flotas), Michelin "TMS" (no hallé un producto con ese nombre; uso Michelin Connected Fleet / MyConnectedFleet), Goodyear Fleet HQ (solo como servicio de coordinación en resultados de búsqueda; uso el artículo G).

## 1. Matriz de funcionalidades

Leyenda: ✓ consta · P parcial/mencionado sin detalle · ✗ consta que no · — no consta. Las celdas ✓/P llevan fuente.

| Capacidad | Ruedata | Emenube | Michelin CF | Goodyear | Bridgestone | TireCheck | Uffizio |
|---|---|---|---|---|---|---|---|
| Inspección digital (app/medidor) con evidencia | ✓ R (fotos, offline) | P E (checklists con imágenes, genéricos de flota) | — | ✓ G (Tire Optix, CheckPoint) | ✓ B (ToolBox) | ✓ T | — |
| Medidor propio de mm y presión | ✓ R (TLGX, BT, 0–30 mm ±0,1) | — | — | ✓ G (medidor BT) | P B (profundidad/presión, hardware no detallado) | ✓ T (Inspection Gauge/FlexiGauge) | — |
| TPMS (presión/temperatura continua) | ✓ R (lee sensores y RFID) | — | ✓ M | ✓ G (TPMS Plus) | — B (no se nombra en el artículo) | ✓ T | — |
| Alertas de neumático (presión/desgaste/crítico) | ✓ R | P E (alertas de mantenimiento) | ✓ M (gravedad, destinatarios email/SMS, franjas, zonas) | ✓ G | ✓ B | ✓ T | ✓ U |
| Umbrales configurables por vehículo/eje | — | — | ✓ M | — | — | — | P U ("personalizables") |
| Historial por vehículo/neumático | P R (historial de inspecciones) | — | ✓ M (presión/temp. por vehículo) | ✓ G (datos históricos) | P B (ciclo de vida digitalizado) | — | ✓ U (historial de servicio) |
| Ciclo de vida del neumático (compra→baja) | P R ("ciclo de vida", sin detalle técnico) | — | — | — | ✓ B | — | ✓ U |
| Rotación | — | ✓ E (módulo "control y rotación", sin detalle) | — | — | — | — | ✓ U (recordatorios) |
| Inventario/stock de neumáticos | — | P E (stock de repuestos incluye neumáticos) | — | — | — | — | ✓ U (niveles, reorden) |
| Reencauche/recauchutado | ✓ R (optimización) | — | — | — | P B (servicio Bandag, no software) | — | — |
| CPK / costo por km | ✓ R (dashboard CPK y predictivo) | — | — | — | P B (objetivo declarado de reducir CPK) | — | — (solo presupuesto/costos) |
| Predicción de desgaste / vida remanente | ✓ R (IA) | — | P M (menciona seguimiento de desgaste, sin función descrita) | ✓ G (analítica predictiva, sobre fugas/temperatura) | — | ✓ T (alertas predictivas, yard monitoring) | ✓ U (vida útil por patrones) |
| Dashboard de flota con semáforo/prioridades | ✓ R | P E | ✓ M (verde/amarillo/naranja + acciones pendientes) | ✓ G (Fleet Central) | P B | P T | — |
| Reportes exportables | ✓ R | — | ✓ M (PDF/XLSX) | ✓ G (reportes online) | — | ✓ T (informes automáticos) | — |
| Integración telemática/ERP/API | ✓ R (API abierta; Samsara, Geotab, etc.) | — | ✓ M (propia telemática) | P G | ✓ B (APIs; Webfleet) | — | — |
| App móvil | ✓ R (iOS/Android) | ✓ E | — | ✓ G | — | ✓ T | — |
| Mapa con estado por vehículo | — | — | ✓ M (solo con sensores) | P G (geovallas en TPMS Plus) | — | — | — |
| Despacho de servicio / asistencia | — | — | — | ✓ G (24/7) | P B (servicios) | — | — |

Notas: Michelin (M) distingue verde/amarillo/naranja, no verde/naranja/rojo como NEUMET. Emenube (E): solo hay una línea sobre neumáticos; **[I]** no se puede concluir su profundidad real sin demo.

## 2. Modelo de dominio típico

**[F]** parcial (TS: compra→disposición, montaje/desmontaje, reparación, recauchutado, almacén, proveedor, historial de eventos; U: tipo, medida, fecha de compra, servicio, estado; Y: marca, medida, año, temporada, precio, foto, QR). El resto es **[I]** (práctica común del sector, no verificada en una fuente única).

- **Neumático (activo):** id, código interno/QR, marca, modelo, medida, DOT/fecha de fabricación, precio de compra, proveedor, estado (en stock / montado / en reparación / en reencauche / baja), vida (0 = nuevo, 1, 2… = reencauches), profundidad inicial de banda, presión recomendada.
- **Montaje/posición:** neumático ↔ vehículo ↔ posición (eje, lado, interior/exterior, auxilio), fecha de montaje y desmontaje, odómetro/horas del vehículo en cada evento.
- **Eventos de ciclo de vida** (una tabla de eventos append-only): montaje, desmontaje, rotación (posición origen→destino), reparación (tipo, costo, taller), envío a reencauche (costo, proveedor), baja (motivo: desgaste, daño, accidente).
- **Medición/inspección:** neumático+posición, fecha, mm por huella (NEUMET: 3), presión, temperatura, odómetro, medidor/dispositivo, inspector, fotos.
- **Vehículo:** tipo/configuración de ruedas, odómetro (km u horas), fecha de última lectura.
- **TPMS:** lectura continua (presión, temperatura, sensor id) separada de las mediciones manuales por volumen.
- **Costos:** compra, reparaciones, reencauche, valor residual de la carcasa, mano de obra.
- **Alertas:** regla, severidad, estado (abierta/reconocida/cerrada), entidad afectada.

## 3. KPIs estándar

| KPI | Fórmula | Fuente |
|---|---|---|
| CPK (costo por km) | (compra + montaje + reparaciones + reencauches − crédito/valor residual de carcasa) / km recorridos por el neumático hasta su baja | **[F]** estructura de costos en C; fórmula consolidada **[I]** |
| CPK simplificado | precio del neumático / vida en km | **[F]** C (calculadora sudafricana) |
| Desgaste mm/1.000 km | (mm_anterior − mm_actual) / (km_actual − km_anterior) × 1000 | **[I]** (no hallé fuente que lo defina como KPI estándar) |
| Desgaste mm/semana (el que ya calcula NEUMET) | (mm_anterior − mm_actual) / semanas entre mediciones | **[I]** |
| Vida remanente (km o semanas) | (mm_actual − mm_de_retiro) / tasa de desgaste; el umbral de retiro debe ser parámetro por cliente | **[I]** |
| % reencauchado | neumáticos con vida ≥ 1 / total de neumáticos activos (o reencauches realizados / bajas) | **[I]** |
| Presión fuera de rango | % de lecturas/neumáticos con presión fuera de [objetivo ± tolerancia] | **[I]**; umbrales por vehículo/eje: **[F]** M |
| Irregularidad de desgaste | diferencia entre huellas (borde−borde, centro−borde) por neumático | **[I]** (NEUMET ya tiene 3 huellas) |
| Neumáticos críticos | recuento por flota de mm < umbral rojo | NEUMET (semáforo propio) |
| Rendimiento por marca/modelo | km (o mm/1000 km) medios por marca/modelo | **[I]**; R habla de "datos para decisiones de compra" |
| Rotaciones/inspecciones al día | % vehículos con última medición < N días | **[I]** |

## 4. Alertas y reportes habituales

**Alertas** — **[F]**: baja presión o desgaste excesivo (U), pinchazo/temperatura (M, G), seguridad en tiempo real y mantenimiento (R), servicio pendiente (U, E). **[I]** adicionales para NEUMET: neumático rojo, tasa de desgaste anómala, desgaste irregular, vehículo sin medir hace N días, dispositivo sin sincronizar, stock bajo, medición inconsistente.

**Reportes** — **[F]** exportables PDF/XLSX (M), reportes personalizables (R), informes automáticos de inspección (T). **[I]** habituales: estado de flota por cliente, neumáticos críticos, historial por neumático/vehículo, CPK por marca/modelo, bajas con motivo, inventario valorizado, inspecciones realizadas por técnico/dispositivo.

## 5. Brecha de NEUMET

**Hoy (según el encargo y docs/07):** calibre BT → app → API → panel; dibujo de camión por rueda; semáforo verde ≥8 / naranja 5–7,9 / rojo <5 mm; historial; mm/semana; clientes, vehículos, dispositivos, stock de neumáticos, balance económico. Tablas conocidas (docs/07, **a verificar contra el esquema real**): `neumaticos(vehiculo_id, posicion, marca, modelo, fecha_compra, precio_unidad, notas)`, `stock_neumaticos`, `mediciones` (con `idneumatico`, `mm1`–`mm3`, `promedio`), `dispositivos`, `clientes`. Este repo no contiene migraciones, así que **no verifiqué el esquema**.

**Qué falta frente al benchmark:** alertas activas, vida/reencauche, eventos de ciclo de vida (rotación/reparación/baja), odómetro, presión/temperatura, costos por neumático completos, reportes exportables, salud de dispositivos.

| KPI | Datos que ya tenemos | Datos que nos faltan |
|---|---|---|
| mm/semana | mm + fecha por neumático | nada (ya existe); depende de `idneumatico` estable |
| Neumáticos críticos / semáforo | mm | nada |
| Vida remanente (semanas) | mm, tasa mm/semana | umbral de retiro configurable |
| mm/1.000 km | mm, fecha | **km del vehículo en cada medición** (odómetro) |
| Vida remanente (km) | — | km + tasa mm/1.000 km |
| CPK | precio_unidad, fecha_compra | km acumulados por neumático (montaje/desmontaje con odómetro), reparaciones, reencauches, valor residual, fecha/motivo de baja |
| % reencauchado | — | campo `vida` (0,1,2…) y evento de reencauche |
| Presión fuera de rango | — | presión (medidor ya la lee en otros productos; el nuestro **[verificar]**) y presión objetivo |
| Desgaste irregular | mm1–mm3 | nada (regla nueva) |
| Salud de dispositivos | tabla `dispositivos` | último sync/ingesta por dispositivo (**[verificar]** si existe) |
| Rendimiento por marca | marca/modelo, mm | km por neumático |

## 6. Backlog MVP priorizado (~24 h de trabajo de agentes)

Esfuerzo: S ≈ 1–2 h, M ≈ 3–5 h, L ≈ 6–10 h. QW = quick win (solo panel, sin esquema nuevo, valor visible). Todos asumen datos y RLS actuales hasta verificar el esquema.

| # | Pri | Ítem | Valor | Esf. | Dependencias de datos/esquema | Vista del panel | QW |
|---|---|---|---|---|---|---|---|
| 1 | P0 | **Panel de flota con prioridades**: lista ordenada por neumático más crítico, contadores rojo/naranja/verde, filtros por cliente | Primera pantalla útil; replica el dashboard con acciones de M y G | M | `mediciones` + `neumaticos` (existentes) | Inicio / Flota | ✓ |
| 2 | P0 | **Alertas de neumático crítico** (mm < 5, tasa de desgaste anómala, sin medir hace N días) como centro de alertas en el panel | Reduce riesgo y justifica la plataforma (alertas en todos los competidores) | M | Cálculo en cliente/vista SQL; sin tabla nueva en versión 1 | Alertas (nuevo) | ✓ |
| 3 | P0 | **Reporte exportable** (CSV/XLSX/PDF imprimible) por cliente/vehículo | M, R y T lo tienen; pedido típico de clientes | S–M | Datos existentes | Cliente, Vehículo | ✓ |
| 4 | P0 | **Vista de cliente mejorada**: resumen de flota, estado, últimos vehículos medidos, gasto en neumáticos | Cierra el recorrido comercial | M | `clientes`, `vehiculos`, `neumaticos` | Cliente | ✓ |
| 5 | P1 | **Salud de dispositivos**: último sync, mediciones por dispositivo, "sin actividad hace N días" | Detecta calibres/apps caídos | S–M | Último evento por dispositivo; **[verificar]** si hay timestamp | Dispositivos | ✓ si existe |
| 6 | P1 | **Captura de km (odómetro)** en la app y la API (campo opcional `odometro_km` en la medición) | Desbloquea mm/1.000 km, vida en km y CPK | M | Columna nueva en `mediciones` (y/o `vehiculos`); cambio de contrato con la app y docs/07 | Medición, Vehículo | — |
| 7 | P1 | **Ciclo de vida del neumático**: tabla de eventos (montaje, rotación, reparación, baja) + línea de tiempo por neumático | Base de CPK, % reencauche y trazabilidad; modelo de TS | L | Tabla `eventos_neumatico`, `vida`, `estado`; RLS | Neumático (detalle) | — |
| 8 | P1 | **Predicción mejorada**: vida remanente en semanas con umbral de retiro configurable y alerta "se cruza el rojo en N semanas" | Convierte mm/semana en decisión | S–M | Umbral por cliente (puede ir en config) | Neumático, Alertas | ✓ |
| 9 | P1 | **Desgaste irregular** (diferencia entre huellas) con aviso de alineación/presión | Diferencial técnico con datos que ya capturamos | S | mm1–mm3 | Neumático, Alertas | ✓ |
| 10 | P2 | **CPK por neumático y por marca/modelo** | KPI de decisión de compra (R lo ofrece) | M | Requiere #6 y #7 (km, costos, baja) | Balance económico | — |
| 11 | P2 | **Reencauche** (vida 0,1,2…, envío, costo, % reencauchado) | Ahorro grande en flotas; R y B lo destacan | M | #7 | Neumático, Balance | — |
| 12 | P2 | **Presión/temperatura** (captura manual o TPMS) y umbrales por eje | Paridad con M/G/T; fuera de alcance del calibre actual | L | Hardware/protocolo a definir | Neumático, Alertas | — |

Orden de ejecución sugerido: 1 → 2 → 3 → 4 (paralelizables, solo panel), luego 5 y 9 y 8, luego 6 → 7 (esquema; coordinar con la API de docs/07), y 10–12 quedan para la siguiente iteración. Una "versión pulida" a 24 h realista = P0 completo + 5, 8, 9. Lo de esquema (6, 7) solo si el esquema real se confirma primero.

## 7. Alternativas open source

| Proyecto | Licencia | Stack | Qué ofrece (con fuente) | Qué aprender | ¿Integrar? |
|---|---|---|---|---|---|
| **Odoo Fleet** | LGPL-3 (módulo `fleet` del repo oficial) [O]; ojo: es solo la licencia de ese módulo | Python/Odoo | Vehículos, contratos, servicios (costo, proveedor, odómetro), lecturas de odómetro, gráficos de costos; los neumáticos solo se citan como ejemplo de servicio [O] | Modelo de **odómetro como lectura con fecha** y servicios con costo por vehículo | No integrar (otro ecosistema); inspirarse |
| **yusufaykin/TireManagementSystem** | MIT (según README; pie dice "All rights reserved") [Y] | React 18, MUI, QR, xlsx | Inventario de neumáticos con QR, ventas, dashboard de valor de inventario, **Tire Hotel** (almacenaje de neumáticos de clientes) [Y]. No describe backend ni modelo. Orientado a tienda, no a flotas | QR por neumático y Tire Hotel como idea de producto | Solo inspirarse |
| **TireSoft Platform** | No indicada en lo visible [TS]; sin licencia no hay derecho de reutilización | Kotlin (Spring Boot) + Angular [TS] | Perfil con descripción de ciclo de vida: compra→disposición, montaje/desmontaje, reparación, recauchutado, almacén, proveedor, historial de eventos, alertas [TS]. Solo vi el repo `.github` (README), no el código | **Mejor referencia de modelo de dominio** (eventos de ciclo de vida) | Inspirarse únicamente; no copiar código |
| **jmnda-dev/Fleetms** | MIT [F] | Elixir/Phoenix, Ash, PostgreSQL, Flutter | Vehículos, órdenes de trabajo, inspecciones configurables, inventario de repuestos con alertas de stock, combustible/gastos, multi-organización [F]. **No menciona neumáticos** | Inspecciones con formularios, recordatorios por tiempo/km, multitenancia por esquema; es proyecto de aprendizaje, no de producción [F] | Inspirarse |
| **Fleetbase** | AGPL-3.0 o licencia comercial [FB] | PHP, MySQL/Redis, React Native | Logística/despacho, telemetría, flujos configurables y campos personalizados; no menciona neumáticos [FB] | Poco para neumáticos; AGPL obliga a publicar modificaciones de servicios en red | No integrar |

Conclusión **[I]**: ninguna cubre el dominio de neumáticos de flotas con licencia reutilizable y calidad de producción. Recomendación: **no integrar**, tomar ideas (eventos de ciclo de vida de TS, odómetro de Odoo, QR de Y). Si se quiere reutilizar código MIT (Y, F), revisar el LICENSE real del repo y atribuir.

## 8. Riesgos, supuestos y no verificado

- La mayoría de las fuentes son material comercial; la presencia de una función ≠ calidad. Goodyear (2021) y Michelin/Emenube son páginas cortas; el contenido puede estar desactualizado.
- "no consta" en la matriz refleja solo las páginas leídas (1–2 por plataforma). No hubo demos ni pruebas.
- **No verificado:** Pirelli+Geotab, Fleetio, Tiremetrix (§0); fórmula exacta de CPK y mm/1.000 km como KPI estándar (la estructura de costos sí tiene fuente, la consolidación es mía); precios; profundidad del módulo de neumáticos de Emenube.
- **Esquema real de NEUMET no verificado** (no hay migraciones en el repo): existencia de `odometro`, `vida`, `ultimo sync`, `idneumatico` estable. Los esfuerzos S/M/L son estimaciones mías.
- Supuesto: las 24 h son de agentes en paralelo, con el panel como cliente de Supabase y RLS vigente. Cambios de esquema y de API (ítems 6–7) deben coordinarse con docs/07 y con DAC.
- Los umbrales de color y el umbral de retiro son decisiones de negocio del dueño; no se contrastaron con normativa.
