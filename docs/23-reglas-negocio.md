# 23 · Reglas de negocio

> **Estado: vigente.** Versión condensada de la especificación de reglas de negocio v1.0 (24/11/2026), con las decisiones del 25/11/2026 (sección 4). Origen: reunión con Agencia Central del 23/11/2026. Donde choque con la propuesta histórica de [18](18-rotacion-vehiculos-pesados.md), prevalece este documento.

Este documento dice qué regla aplica el sistema, con qué parámetros, en qué ola de la hoja de ruta de [10](10-tablero.md) se implementa y con qué criterio de aceptación (CA) se verifica. Los parámetros son los valores por defecto de Agencia Central. El detalle de cada CA (dado, cuando, entonces) no se copia aquí: al implementar una ola, cada CA se lleva a una prueba en `tests/`.

## 1. Estados

- **Vigente**: el sistema ya la cumple.
- **Ola N**: se implementa en la ola N de la hoja de ruta de [10](10-tablero.md).
- **Parcial**: parte de la regla ya se cumple; la celda indica qué falta y en qué ola.
- **Fuera de alcance**: no entra en el piloto ni en las olas 1 a 7.

## 2. Reglas RN-01 a RN-32

| RN | Regla | Parámetros | Estado | CA |
|---|---|---|---|---|
| RN-01 | El desgaste, las alertas y las sugerencias usan la huella mínima de las tres mediciones. El promedio solo se muestra. | Huella mínima `min(mm1, mm2, mm3)`; umbrales de RN-02 | Parcial: estado y alertas por huella mínima en `main` (migración `20261126000000`, aplicación en producción). Faltan umbrales y leyenda, en la ola 2; CA-01 sin ola asignada, a planificar tras la ola 7 | CA-01 |
| RN-02 | Retiro a 3 mm en todos los ejes. En dirección, dos avisos amarillos para pasar la cubierta atrás: «Pasar atrás» a 8 mm o menos y «Pasar atrás ya» bajo 6 mm (P-02). La sugerencia para una direccional que llega a 8 mm es «Pasar a tracción o eje loco» (P-01). En tracción, de 15 a 3 mm, con rotación dentro del eje. | `direccion_aviso_mm` 8; `direccion_limite_mm` 6; `retiro_mm` 3; `traccion_inicial_mm` 15 (solo informativo) | Ola 2 | CA-02 |
| RN-03 | Una direccional puede rotar a tracción o al eje loco sin aprobación ni aviso de posición. | Ninguno | Ola 1 | CA-03 |
| RN-04 | El rendimiento (tasa, proyección, CPK, km por mm y km por vida) se mide por kilómetros con odómetro. El tiempo solo es respaldo rotulado cuando no hay odómetro. | Tasa en mm por 1.000 km | Ola 6 | CA-04 |
| RN-05 | Una cubierta nueva (vida 0) sugiere swap a los 20.000 km desde su montaje. Lo cierra cualquier rotación de posición o en disco. | `swap_km` 20.000, solo vida 0 | Ola 2 (apertura) y ola 3 (cierre) | CA-05 |
| RN-06 | Si la diferencia entre la huella máxima y la mínima es de 2 mm o más, se sugiere revisar la cubierta. La decisión final es del gomero. | `irregularidad_mm` 2 | Parcial: criterio en JS hecho (PR 157). Falta la sugerencia, en la ola 2 | CA-06 |
| RN-07 | Una cubierta con muchos km y poco desgaste se sugiere revisar. | `km_por_mm_revision`, nulo: alerta apagada (P-04) | Ola 2 (apagada) | CA-07 |
| RN-08 | Cualquier huella bajo 3 mm exige retiro inmediato, a renovación o a baja según el daño. No se rota a otro eje. | `retiro_mm` 3 | Parcial: el estado por huella mínima está en `main` (migración `20261126000000`). CA-08 sin ola asignada, a planificar tras la ola 7 | CA-08 |
| RN-09 | Si la huella mínima baja 5 mm o más entre dos mediciones válidas consecutivas, la medición queda sospechosa hasta que se revise. | `caida_brusca_mm` 5 (P-11) | Ola 4 | CA-09 |
| RN-10 | Una medición sospechosa se corrige a mano, con motivo y auditoría. | Motivo obligatorio | Ola 4 | CA-10 |
| RN-11 | Cada vehículo se mide una vez por mes con el medidor. Una cubierta sin medición en 30 días aparece como «sin medir». | `dias_sin_medir_alerta` 30 | Vigente con 30 días (`dias_sin_medir_alerta`); CA-11 sin ola asignada, a planificar tras la ola 7. La frecuencia del auxilio, en RN-13 | CA-11 (30 días) |
| RN-12 | El odómetro del vehículo se carga en cada registro: medición, montaje, desmontaje, cambio y rotación. | `odometro_obligatorio` (panel, por crear); `odometro_obligatorio_api` (API, pendiente) | Ola 1 | CA-12 |
| RN-13 | Cada vehículo tiene a lo sumo un auxilio (posición 99). El auxilio se mide con menos frecuencia y no suma km. | Posición 99 | Parcial: el corte de tramos de km en la posición 99 está en `main` (PR 156, migración `20261126010000`; aplicación en producción). Falta un solo auxilio por vehículo y su frecuencia propia: sin ola asignada, a planificar tras la ola 7 (P0-2) | CA-13 |
| RN-14 | Toda rotación, rotación en disco, alineación, cambio y baja lleva motivo, con usuario y fecha. | Catálogo por tipo; «Otro» exige texto (P-06) | Ola 1 | CA-14 |
| RN-15 | La rotación de posición (dos posiciones del vehículo) y la rotación en disco (misma posición, se invierten interior y exterior) son eventos distintos. | Evento `rotacion_disco` | Ola 3 | CA-15 |
| RN-16 | El desgaste lateral sugiere alinear. El gomero confirma con la máquina y la alineación se registra con motivo. | Evento `alineacion` | Ola 3 | CA-16 |
| RN-17 | Rotar una cubierta (de posición o en disco) cierra la sugerencia de alinear. | `resuelta_motivo` = `rotacion` | Ola 3 | CA-17 |
| RN-18 | Cada lunes se genera la lista de trabajos de la semana: rotaciones, alineaciones, cambios y descartes. | Rojo antes que amarillo; sin auxilio | Ola 6 | CA-18 |
| RN-19 | Cada día se revisan las inspecciones del día anterior contra la medición previa: mm bajados y km recorridos. | Diferencia de mínimo y km | Ola 6 | CA-19 |
| RN-20 | Las alertas se ven en un recuadro fijo en Inicio y en el vehículo: rojo para cambiar, amarillo para revisar. Siempre con texto y símbolo, nunca solo color. | Recuadro «N cambiar · N revisar» | Ola 2 | CA-20 |
| RN-21 | El aviso por WhatsApp o mail es un extra deseable, no necesario para el piloto. | Destinatarios y frecuencia | Fuera de alcance | CA-21 |
| RN-22 | Reporte mensual: km por mm promedio, costos, ahorro y top de marca y modelo. | Período mensual | Ola 7 | CA-22 |
| RN-23 | Informe trimestral frente al trimestre anterior: CPK, costo por mm, km por mm, porcentaje de renovación, cubiertas renovadas y ahorro. | Período trimestral; porcentaje como indicador (P-08) | Ola 7 | CA-23 |
| RN-24 | Ahorro por renovación: precio de referencia de una cubierta nueva menos el costo del recauchutado. | `precio_referencia_nueva` por cliente; nulo = no se calcula (P-09) | Ola 7 | CA-24 |
| RN-25 | Michelin y Bridgestone se renuevan hasta 3 veces. La cuarta renovación advierte y pide confirmación; no bloquea. | `max_renovaciones` por marca: Michelin 3 y Bridgestone 3; otras marcas a definir (propuesta: 1) | Ola 5 | CA-25 |
| RN-26 | La recauchutadora dictamina si la carcasa es renovable (golpes, cortes, deformaciones, pinchazos). | Dictamen de la recauchutadora | Vigente | CA-26 |
| RN-27 | Las bajas son definitivas y conservan su historial. El análisis de rendimiento se hace sobre las descartadas. Toda baja lleva motivo. | Catálogo de motivos de baja (P-06) | Ola 7 (análisis); motivo de baja en ola 1 | CA-27 |
| RN-28 | Los costos se cargan en USD, salvo que la factura esté en otra moneda. Los reportes no suman monedas sin conversión explícita. | `clientes.moneda_default` = USD | Ola 4 | CA-28 |
| RN-29 | Alta de cubiertas por lote: marca, modelo, dimensión y mm iniciales comunes; número de quema y DOT individuales. | DOT de 4 dígitos, formato WWYY (P-10) | Ola 5 | CA-29 |
| RN-30 | Las tablas y el CSV de cubiertas priorizan CPK, km, km por vida, precio por mm, quema, marca, modelo, dimensión, DOT, ubicación y situación. | Columnas de rendimiento y de compra | Ola 3 (rendimiento) y ola 5 (compra) | CA-30 |
| RN-31 | Buses: convencional (6x2, dirección en 1 y 2) y doble piso (8x2, dirección en 1 a 4). Los camiones usan las distribuciones existentes. | `rol_eje_posicion`; `vehiculos.servicio` (P-05, P-12) | Parcial: JS hecho (PR 157). SQL, en la ola 2 | CA-31 |
| RN-32 | Las bases de auxilio del interior guardan cubiertas y no usan la plataforma. | Ninguno | Fuera de alcance | CA-32 |

Notas sobre la tabla:

- **Huecos de la hoja de ruta**: el anexo no asigna ola a P0-2 (un solo auxilio por vehículo y frecuencia propia de medición), a CA-11 ni a CA-13. Sin ola asignada, a planificar tras la ola 7.
- **Huella mínima**: la migración `20261126000000` (P0-3) está en `main`. Sin ola asignada, a planificar tras la ola 7: P0-3, CA-01 y CA-08. La leyenda y los umbrales por huella mínima van en la ola 2.
- **RN-06**: la spec fija el umbral en 2 mm o más. La vista `desgaste_irregular` y el JS de `main` (PR 157) disparan con más de 2 mm (`>`). En la ola 2 se pasa a `>=` en la base y en el JS a la vez. Hasta entonces, una diferencia de 2,0 mm exactos no marca.
- **RN-11**: la regla es de 30 días (`dias_sin_medir_alerta`). CA-11 se ajusta a 30; la especificación decía 31.
- **CA-09** se ajusta a P-11: la ventana es entre mediciones válidas consecutivas, no de 30 días.
- **CA-02**: el color de `direccion_limite` es amarillo (P-02).

## 3. Glosario

| Término | Definición |
|---|---|
| Cubierta | Neumático. Es el término que usa el cliente. |
| Eje loco | Eje libre o de arrastre, que no tracciona. Es el destino final de las direccionales y de las tracciones gastadas o desparejas. |
| Swap | Primera rotación de una cubierta nueva, a los 20.000 km desde su montaje, para que asiente. |
| Rotación en disco | La cubierta se queda en la misma posición y se gira la llanta: se invierten interior y exterior. Se registra como evento distinto de la rotación de posición. |
| Vida | Cantidad de renovaciones de la carcasa. La vida 0 es la cubierta de fábrica; cada renovación suma una. En el sistema es `neumaticos.vida`, de 0 a 3. |

## 4. Decisiones del 2026-11-25

Las decisiones siguientes cierran las preguntas abiertas de la especificación (P-01 a P-12). Cada una indica la regla que afecta.

- **P-01** · El texto de la sugerencia para una direccional que llega a 8 mm es «Pasar a tracción o eje loco» (RN-02).
- **P-02** · Dos niveles amarillos en dirección: «Pasar atrás» a 8 mm o menos, y «Pasar atrás ya» bajo 6 mm. El rojo queda solo para el retiro general, bajo 3 mm (RN-02).
- **P-03** · El swap se sugiere a los 20.000 km de tramo desde el montaje, solo en cubiertas de vida 0. Lo cierra cualquier rotación de posición o en disco. No se prescriben pares de posiciones (RN-05).
- **P-04** · La regla de km por mm (RN-07) queda apagada: `km_por_mm_revision` es nulo hasta que se configure un valor.
- **P-05** · Los camiones usan las distribuciones existentes y se agrega `vehiculos.servicio` (RN-31).
- **P-06** · Motivos de movimiento y de baja: catálogo cerrado por tipo, con «Otro» que exige texto (RN-14, RN-27).
- **P-07** · La cuarta renovación advierte y pide confirmación; no bloquea (RN-25).
- **P-08** · El porcentaje de renovación se muestra como indicador del reporte trimestral (RN-23).
- **P-09** · Ahorro = precio de referencia de la cubierta nueva menos el costo del recauchutado. El precio de referencia es un parámetro por cliente; si es nulo, el ahorro no se calcula (RN-24).
- **P-10** · `factura` y `soporte` son texto libre. El DOT tiene 4 dígitos, formato WWYY (RN-29).
- **P-11** · La caída brusca se mide entre dos mediciones válidas consecutivas (RN-09).
- **P-12** · La numeración de posiciones es la del diagrama actual del panel. En el doble piso (8x2), las direccionales son 1 a 4 (RN-31).
- **P-01 y P-02 a 8 mm** · A 8 mm, la etiqueta del semáforo es «Pasar atrás» (P-02) y el texto de la sugerencia de rotación es «Pasar a tracción o eje loco» (P-01). Bajo 6 mm, la etiqueta es «Pasar atrás ya» (P-02).

Otros puntos de la decisión:

- **Moneda**: USD por defecto para clientes nuevos y para Agencia Central. Los datos ya cargados no se convierten; su revisión queda como pendiente en [10](10-tablero.md).
- **Fuera de alcance**: RN-21 (aviso por WhatsApp o mail), la integración con Smartway (sin acceso al odómetro automático, el odómetro se carga a mano) y RN-32 (bases de auxilio sin usuarios).
- **Asistente LLM**: pendiente del dueño (proveedor y clave). Su diseño va en un documento propio previsto para la ola 7 (`docs/24`, sin crear) y no tiene código hasta entonces.
