# 18 · Rotación y reposición para vehículos pesados

> **Estado: propuesta histórica (2026-11-13), superada en parte por las reglas de negocio vigentes ([23](23-reglas-negocio.md)).** Donde choquen, prevalece [23](23-reglas-negocio.md). El apartado 0 indica qué cambia y cuál es el backlog vigente (P0 y P1).

Investigación y propuesta de diseño de la fase F8 de [16](16-hoja-de-ruta.md): sugerencia de rotación y reposición de neumáticos para camiones y buses de pasajeros. Es un documento de propuesta: no cambia código, migraciones ni interfaz. Complementa y precisa la sección A de [15](15-rotacion-alertas-rendimiento.md), pensada para un caso más simple; la sección 2.2 dice qué decisiones de [15](15-rotacion-alertas-rendimiento.md) quedan reemplazadas y cuáles se conservan.

Fecha de consulta de todas las fuentes externas: 2026-11-13. Las afirmaciones sobre el repositorio llevan `archivo:línea` y se comprobaron sobre `main` en esa fecha. NEUMET sugiere; no certifica el cumplimiento de ninguna norma.

Principios que rigen el diseño ([16](16-hoja-de-ruta.md)): dato no medido es nulo, nunca cero; reglas interpretables, sin machine learning; el operario ve una acción simple, no una teoría.

## 0. Estado y precedencia (actualizado el 25/11/2026)

**Este documento es una propuesta histórica del 2026-11-13.** No es backlog aprobado ni diseño vigente. Las secciones 1 a 11 describen lo que se propuso entonces; para cualquier comportamiento, manda [23 · Reglas de negocio](23-reglas-negocio.md) (RN-01 a RN-32 y decisiones del 25/11/2026). Donde ese documento y este choquen, **prevalece [23](23-reglas-negocio.md)**. Se conserva el contexto histórico (fuentes, normas, análisis de datos) porque sigue siendo útil como referencia.

Lo que sigue describe la propuesta histórica. El estado de cada ítem está en el apartado 0.2 y en [10](10-tablero.md). En `main` ya están la huella mínima en la base (migración `20261126000000`, aplicación en producción), el corte de tramos de km del auxilio (PR 156, migración `20261126010000`, aplicación en producción) y el criterio de desparejo y el rol de eje en JS (PR 157).

### 0.1 Reglas que cambian (vigentes)

| Tema | Propuesta histórica (13/11) | Regla vigente ([23](23-reglas-negocio.md)) |
|---|---|---|
| Retiro de direccionales (R3) | 5,0 mm en la huella más baja (`direccion_retiro_mm`) | No hay retiro propio de dirección. El retiro general es 3 mm en todos los ejes (RN-02). En dirección, **«Pasar atrás» a 8 mm o menos** y **«Pasar atrás ya» bajo 6 mm** (amarillo, P-02). |
| Colores de alerta | Rojo para retiro; amarillo para rotación y alineación | **Rojo solo para el retiro general** (huella mínima menor que 3 mm: cambiar). **Amarillo** para rotar, alinear y pasar atrás una direccional. Nota: P-02 ([23](23-reglas-negocio.md) §4, decidida el 25/11) fija dos niveles amarillos en dirección: «Pasar atrás» a 8 mm o menos y «Pasar atrás ya» bajo 6 mm. La sugerencia para una direccional que llega a 8 mm es «Pasar a tracción o eje loco» (P-01). |
| Restricción de posición de direccionales (R7, `apto_otra_posicion`) | No pasar una direccional a otra posición sin aprobación | **Descartada para Agencia Central** (RN-03). Una direccional puede rotar a tracción o a eje loco sin aprobación ni aviso de fuera de posición. No hace falta `apto_otra_posicion`. |
| Intervalo y disparadores por kilómetros (R10) | No usar kilómetros como disparador; recordatorio por tiempo | Todo el rendimiento se mide por kilómetros con odómetro (RN-04): tasa en mm por 1.000 km, proyección por km y CPK. El **swap se sugiere a los 20.000 km** en cubiertas de vida 0 (RN-05). El tiempo solo es respaldo rotulado cuando no hay odómetro. Sin odómetro, el dato es **«sin dato»**; no se estima ni se inventa (RN-12). |
| Estado y alertas por desgaste (RN-01) | Umbrales sobre el promedio en la mayoría de las reglas | Estado, alertas y sugerencias se calculan con la **huella mínima** `min(mm1, mm2, mm3)`. El promedio solo se muestra como dato informativo. Si falta alguna huella, no hay mínimo y la posición queda **«sin dato»**, nunca cero. |
| Rol de eje en buses (RN-31) | Dirección solo en el eje 1 (posiciones 1 y 2) | En doble piso las posiciones 1 a 4 son direccionales (eje delantero de 4 posiciones). El rol se deriva de la distribución del vehículo. La numeración es la del diagrama actual del panel (P-12 de [23](23-reglas-negocio.md) §4). |
| Retiro para recauchutar (R9, 4,8 mm) | Recauchutar a 4,8 mm (6/32) | La renovación se hace al llegar a 3 mm (RN-08). El valor de 4,8 mm no es vigente hasta que lo confirme el dueño. |
| Reposición (sección 5) y R0 a R11 | Propuesta de reglas y plan en siete PR | Propuesta histórica. No es backlog. Ver 0.3. |

### 0.2 Backlog vigente (P0 y P1, con su estado)

Todo lo que no figure aquí queda fuera del backlog vigente (ver 0.3). Los ítems sin estado indicado están pendientes; los demás indican qué ya está en `main`.

**P0 · antes del piloto (bloqueante)**

| # | Ítem | RN / G |
|---|---|---|
| 1 | Odómetro manual en cada registro: API (con coordinación con DAC), RPC de movimiento y UI | RN-12 / G-12 |
| 2 | Auxilio: corte de tramos de km en la posición 99 (en `main` por PR 156, migración `20261126010000`; aplicación en producción); pendientes un solo auxilio por vehículo y su frecuencia de medición, sin ola asignada | RN-13 / G-13 |
| 3 | Estado y alertas por huella mínima: en `main` (SQL, migración `20261126000000`, aplicación en producción; JS); la leyenda y los umbrales van en la ola 2 | RN-01, RN-08 / G-01 |
| 4 | Rol de eje y umbrales de dirección («Pasar atrás» a 8 mm y «Pasar atrás ya» bajo 6 mm): rol de eje en JS (PR 157); SQL y umbrales, en la ola 2 | RN-02, RN-31 / G-02, G-28 |
| 5 | Motivo obligatorio en todos los movimientos (catálogo base) | RN-14 / G-14 |
| 6 | Moneda por defecto USD | RN-28 / G-25 |
| 7 | Caída brusca de 5 mm como medición sospechosa | RN-09 / G-09 |
| 8 | Recuadro de alertas fijo en Inicio y en el vehículo, rojo y amarillo, con texto y símbolo | RN-20 / G-19 |
| 9 | Configuraciones de bus convencional y doble piso, mapeadas a 6x2 y 8x2 (parcial: JS en `main` por PR 157; SQL y el rol por distribución en 8x2 y 8x4, en la ola 2) | RN-31 / G-28 |

**P1 · primer mes de piloto**

| # | Ítem | RN / G |
|---|---|---|
| 10 | Rotación en disco y registro de alineación | RN-15, RN-16 / G-15, G-16 |
| 11 | Sugerencias amarillas: swap a 20.000 km, diferencia entre huellas, direccional en aviso, con cierre por rotación o alineación | RN-05, RN-06, RN-17 / G-05, G-06, G-16 |
| 12 | Tasa y proyección por km | RN-04 / G-04 |
| 13 | Corrección manual de medición | RN-10 / G-10 |
| 14 | Alta de cubiertas por lote, con DOT, medida, proveedor y factura | RN-29, RN-30 / G-26, G-27 |
| 15 | Máximo de renovaciones por marca, como advertencia | RN-25 / G-23 |
| 16 | Trabajos de la semana e inspecciones de ayer | RN-18, RN-19 / G-17, G-18 |
| 17 | Unificar el criterio de desgaste desparejo entre JS (`IRREGULARIDAD_MM_DEFECTO`, `unevenWear`) y SQL (`irregularidad_mm`): **hecho (PR 157)**, con el criterio de la base. Queda pasar a `>=` (2 mm o más) en la ola 2, en la base y en el JS a la vez (RN-06) | RN-06 |
| 18 | Actualizar este documento según [23](23-reglas-negocio.md) (hecho; última revisión 2026-11-25) | RN-02, RN-03, RN-04 / G-03, G-04 |

P2 (después del piloto, fuera de este documento): `reporte_periodo` mensual y trimestral, agente LLM de solo lectura, ahorro por renovación, km por mm como alerta, WhatsApp o mail, bases de auxilio como sucursales, integración con Smartway.

### 0.3 Qué queda como historia

- Sección 1 (resumen), 2 (qué soporta el modelo, salvo las filas marcadas en 0.1), 3 (datos que faltan), 4 (reglas R0 a R11), 5 (reposición), 6 (casos límite), 7 (flujo del operario), 8 (criterio de prueba), 9 (plan en PR), 10 (preguntas) y 11 (fuentes): **propuesta histórica**. Las fuentes de la sección 11 y el análisis normativo sí se conservan como referencia.
- Las preguntas de la sección 10 se reemplazan por las decisiones de [23](23-reglas-negocio.md) §4 (P-01 a P-12, decididas el 25/11/2026). La pregunta 1 queda respondida (ver allí).
- Los casos de la sección 8 que usan `direccion_retiro_mm` = 5,0 mm, `apto_otra_posicion` o R7 **no son vigentes**. Los casos de R10 basados en tiempo tampoco.
- El plan de reposición (sección 5 y PR 7 de la sección 9) queda fuera del backlog vigente.

## 1. Resumen para el dueño

1. La sugerencia dirá qué rotar o cambiar y por qué, en una frase, en la ficha del vehículo. Nunca ejecuta nada sola, y no reemplaza la inspección visual (cortes, telas expuestas y separaciones no se miden).
2. No hay una regla única en la industria. Los fabricantes coinciden en lo esencial y discrepan en las cifras, así que todo umbral será configurable por cliente, con un valor por defecto razonable.
3. Rotar no corrige la causa de un desgaste irregular (alineación, presión). La sugerencia siempre lo advierte y pide revisar la causa, pero no bloquea la rotación: según Goodyear, el desgaste irregular ya instalado continúa aunque se corrija la causa si la diferencia supera 3 a 4 mm, así que esperar solo lo agrava.
4. Direccionales: cuidado máximo. El retiro se mide en la huella más baja, no en el promedio, porque la norma de EE. UU. lo mide en cualquier punto de una ranura principal. Se cambian antes que el resto y, en buses, no se montan recauchutados adelante (49 CFR 393.75(d)). Mientras no se sepa si un vehículo es bus o camión, se trata como bus.
5. Duales: los dos neumáticos de un par deben tener profundidad parecida; si no, el más gastado recibe la carga y se destruye antes.
6. Sin medición reciente no se sugiere nada que dependa de la profundidad: se pide medir primero. La única excepción es lo que la norma prohíbe sin importar la profundidad (recauchutado o reranurado en dirección, sección 4, R9): se sugiere el retiro aunque la posición no esté medida.
7. El modelo actual no sabe qué eje es de dirección, tracción o arrastre, si el vehículo es bus o camión, ni la medida de cada neumático. Eso hay que agregarlo antes de que la sugerencia sea completa (sección 3).
8. Se propone entregar en siete PR chicos y en serie; cuatro llevan migración (sección 9).
9. La reposición sugiere cuántas cubiertas comprar por medida a partir de lo que se retirará durante el plazo de entrega, con el umbral de retiro de cada posición; los neumáticos sin tasa de desgaste se informan como «sin dato», no se cuentan como «no se retiran». El cliente decide.
10. Hay once preguntas de negocio para el dueño (sección 10). Todo lo técnico lo resuelve este documento con una recomendación.

## 2. Qué soporta hoy el modelo

| Configuración | Soporte | Evidencia |
|---|---|---|
| Camión de 10 ruedas (eje 1 simple, ejes 2 y 3 duales) | Sí | `assets/js/domain/camion.js:2-15`, `vehiculos.tipo_ruedas` solo admite 10 o 16 (`supabase/migrations/20261106000000_init_schema.sql:95`) |
| Camión de 16 ruedas (eje 1 simple, ejes 2 a 4 duales, eje 5 simple) | Sí | `assets/js/domain/camion.js:2-15` |
| Ejes extra duales (posiciones 17 a 98, de a 4) | Solo se dibujan y se leen; no se pueden montar desde el panel | Diagrama: `assets/js/domain/vehiculo-diagrama.js:24-32` y `:55-77`. Montaje: `neumatico_montar` rechaza 17 a 98 con 23514 (`supabase/migrations/20261114500000_montar_neumaticos.sql:101-108`). Esas posiciones llegan solo como mediciones: `asignar_dispositivo_a_cliente` crea el vehículo con `tipo_ruedas = 16` si alguna posición supera 10 (`supabase/migrations/20261106000000_init_schema.sql:555-628`) y `v_estado_neumaticos` las lee sin fila en `neumaticos` (`posiciones_medidas_sin_neumatico`, `supabase/migrations/20261116000000_calidad_datos.sql:549`). `api_guardar_montaje` solo escribe mediciones sobre neumáticos que ya existen (`supabase/migrations/20261106010000_api_proveedor.sql:112` y `:171-173`) |
| Auxilio (posición 99, uno por vehículo) | Sí | `assets/js/domain/vehiculo-diagrama.js:5`; índice único en `supabase/migrations/20261106000000_init_schema.sql:162-166` |
| Rol del eje (dirección, tracción, arrastre) | No. Solo se sabe que el eje 1 es el delantero | `assets/js/domain/vehiculo-diagrama.js:24-32` |
| Servicio del vehículo (bus o camión) | No: `vehiculos` no tiene la columna | `supabase/migrations/20261106000000_init_schema.sql:90-100` |
| Bus de 2 ejes (2 ruedas simples adelante y 4 duales atrás: 6 ruedas) | No como tipo propio: se carga como el diseño de 10 ruedas con el eje 3 vacío (el eje 1 coincide con las ruedas simples y el eje 2 con el par dual trasero) | `assets/js/domain/camion.js:2-15`, `assets/js/domain/vehiculo-diagrama.js:55-77` |
| Tándem, eje de levante, semirremolque | No: no hay concepto de tractor y remolque ni de eje elevable | Sin evidencia de soporte en el dominio ni en el esquema (`vehiculos` no tiene columna de configuración de ejes) |
| Medida del neumático | No existe la columna `medida` en `neumaticos`; sí `marca`, `modelo`, `vida`, `numero_quema`, `km_previos`, `condicion` | La tabla: `supabase/migrations/20261106000000_init_schema.sql:140-166`. `vida`: `supabase/migrations/20261106020000_producto_vistas.sql:54`. `numero_quema` y `km_previos`: `supabase/migrations/20261110000000_numero_quema.sql:28-29`. `condicion`: `supabase/migrations/20261113000000_stock_cubiertas.sql:37` (valores `nuevo`, `usado`, `reparado`, `recauchutado`, `:49`). Sin coincidencias de `medida` en las migraciones |
| Reranurado del neumático | No se registra | Sin coincidencias de `reranur` en las migraciones |
| Profundidad por huella | Sí: mm1 interno, mm2 centro, mm3 externo | `supabase/functions/api-proveedor/mapping.ts:4`, `docs/07-api-proveedor.md:39` |
| Antigüedad de la medición | Sí: `dias_desde_medicion` (con `floor`) y `sin_medir` (comparación exacta de fecha y hora) | `supabase/migrations/20261116000000_calidad_datos.sql:585` y `:591` |
| Desgaste irregular por cliente | Sí: `diferencia_huellas_mm` y `desgaste_irregular` (máximo menos mínimo de las huellas mayor que `irregularidad_mm`) | `supabase/migrations/20261116000000_calidad_datos.sql:593-595` |
| Umbrales por cliente (bajo 8, crítico 5, retiro 3, `dias_sin_medir_alerta` 30, `irregularidad_mm` 2) | Sí | Columnas y valores por defecto: `supabase/migrations/20261106020000_producto_vistas.sql:19-23`; la vista los expone en `supabase/migrations/20261116000000_calidad_datos.sql:477`; las cinco categorías visibles (`nuevo`, `poco_desgaste`, `mayor_desgaste`, `desgaste_limite`, `desconocido`) y la alerta única de límite se definen en `supabase/migrations/20261123000000_categorias_desgaste.sql`; copia en el panel: `assets/js/domain/vehiculo-diagrama.js:110` |
| Semanas hasta el retiro | Sí, pero contra el umbral de retiro general (3 mm) y con la tasa del promedio | `supabase/migrations/20261116000000_calidad_datos.sql:610` |
| Kilómetros por cubierta | Sí, con indicador de confiabilidad (`v_km_cubierta`) | `docs/08-esquema-datos.md` apéndice H |
| Rotación atómica de dos posiciones | Sí: `neumatico_rotar(vehículo, pos_a, pos_b, odómetro)` intercambia o mueve, rechaza cubiertas dadas de baja y registra un evento `rotacion` por cubierta; no abre ni cierra tramos de km | `supabase/migrations/20261108000000_cambio_neumatico.sql:352-440` |
| Rotación de más de dos posiciones en una sola operación | No: una rotación en cruz son dos intercambios sucesivos, no atómicos | misma RPC |
| Cubierta recauchutada | Sí: vida 0 a 3 por carcasa y guardia que bloquea mover cubiertas en proceso | apéndice L de `docs/08-esquema-datos.md` |
| Registro de daños o de una corrección de alineación | No: `eventos_neumatico` admite el tipo `inspeccion` (`supabase/migrations/20261118000000_recauchutado_carcasa.sql:40-43`), pero ninguna RPC ni pantalla lo escribe | `assets/js/domain/ciclo-vida.js:2` solo lo lista |
| Stock de cubiertas aptas | Sí: `neumaticos` sin montar (`estado = 'almacenado'`, `condicion`, `sucursal_id`) | `supabase/migrations/20261113000000_stock_cubiertas.sql` |

Conclusión: los ejes se pueden derivar de la posición, pero el rol del eje, el servicio del vehículo y la medida no están en el modelo. Sin el rol no es posible distinguir tracción de arrastre; sí se puede aplicar la dirección en el eje 1.

### 2.1 Cómo es hoy el flujo de rotar

Desde la ficha del vehículo: tocar la rueda, abrir el desplegable «Elegir posición…», elegir el destino, pulsar «Rotar» y, si el destino está ocupado, confirmar el intercambio (`assets/js/views/vehiculo-detalle.js:312-319` y `:538-542`; `assets/js/views/cambio-neumatico.js:150-166`). Son 4 a 5 clics por intercambio. El odómetro viaja nulo (`p_odometro_km: null`, `assets/js/views/cambio-neumatico.js:150-166`), por lo que hoy ninguna rotación guarda kilómetros.

### 2.2 Qué decisiones de docs/15 A quedan reemplazadas y cuáles se conservan

Donde [15](15-rotacion-alertas-rendimiento.md) sección A y este documento difieren, **manda este documento**. Ningún comportamiento de [15](15-rotacion-alertas-rendimiento.md) A está implementado todavía.

| Tema | docs/15 A | Este documento | Queda |
|---|---|---|---|
| Máximo de sugerencias por vehículo | 2 (A.3, paso 6) | 3 en pantalla (R11): un camión tiene más ejes y más posiciones | Reemplazada por 3 |
| Cruzar de lado en tracción | «No se cruza de lado en la primera versión» (A.3, paso 2) | R5 lo incluye como parte del texto, no como obligación; solo se ofrece como acción desde el PR 6 (rotación en cruz atómica) | Reemplazada |
| Regla de mezcla: solo intercambiar con igual `marca`, `modelo` y `vida` (y `medida` cuando exista) | A.3, paso 2 | **Se conserva** en R2, R5 y R6. Para R4 se usa como aviso: la equivalencia de 4/32 de pulgada con 1/4 de diámetro solo vale con neumáticos idénticos (FleetOwner, fuente 8) | Conservada |
| Parámetro de umbral de rotación | Uno solo, `rotacion_umbral_mm` (3,0 mm, rango 1,0 a 6,0) | Un parámetro por regla: `rotacion_direccion_dif_mm`, `rotacion_traccion_dif_mm`, `rotacion_arrastre_dif_mm` (3,0 mm cada uno). `rotacion_umbral_mm` no se crea | Reemplazada |
| `rotacion_espera_dias` (30) | A.3 | Se conserva con el mismo valor (rango 7 a 90) | Conservada |
| `rotacion_dual_max_mm` (3,0) | A.3 (docs/15:45): diferencia máxima tolerada entre las dos ruedas de un dual **después de rotar**, tope 6 mm | Cambia de significado: en R4 es el **disparador** (diferencia de dos ruedas del par mayor o igual a ese valor), rango 2,0 a 4,0. El valor por defecto coincide, el uso no | Reemplazada |
| Salvaguarda de causa por tasa: tasa mayor que 1,5 veces la mediana (`evaluarDesgaste`) (docs/15:64, A.3 paso 7) | Dispara la frase «Revisar alineación y presión antes de rotar» | No se usa: R1 dispara por el patrón de las huellas (asimetría, centro, bordes), no por la tasa. El disparador por tasa queda fuera de F8 | Reemplazada |
| Puntuación de cada intercambio: se descarta si `difDespues` no mejora a `difAntes` en al menos 1 mm (docs/15:59-60, A.3 paso 5 y su criterio de prueba, línea 90) | Simula el estado tras el intercambio | Deja de valer: R2 a R6 sugieren por la diferencia actual contra el umbral de cada regla; no simulan el estado posterior ni exigen 1 mm de mejora | Reemplazada |
| Parámetros como columnas de `clientes` y campos en `CAMPOS_UMBRAL` (docs/15:40 y :75) | Migración corta sobre `clientes` | No se crean columnas en `clientes` ni se agregan campos a `CAMPOS_UMBRAL`: tabla propia `rotacion_parametros` (sección 9.1) | Reemplazada |
| Agrupar por clase | Dirección (eje 1) y «tracción y remolque» juntos | Dirección, tracción y arrastre por rol de eje; sin rol configurado se emite solo lo del eje 1 y los duales | Reemplazada |
| Tipo de eje: columna `vehiculos.ejes_config` o por eje (A.4, TODO) | Sin definir | Tabla `vehiculo_ejes` (sección 3) | Reemplazada |
| Dual: rotar interna con externa | A.3 | R4 aclara que no cierra la diferencia de diámetro; busca un intercambio en el mismo eje y, si no existe, un cambio con stock | Reemplazada |
| Salvaguarda de causa: la sugerencia lleva la frase «Revisar alineación y presión antes de rotar» | A.3, paso 7 | **Se conserva**: R1 pasa a ser aviso y marca, no bloqueo | Conservada |
| Candidatas: solo con medición vigente (`sin_medir = false`) | A.3, paso 1 | R0 usa el mismo criterio que la vista | Conservada |
| Pasar una direccional a tracción: no se recomienda | A.4 | R7, con el dato `apto_otra_posicion` | **Descartada 24/11/2026** ([23](23-reglas-negocio.md), RN-03): una direccional puede pasar a tracción o eje loco sin aprobación |
| Medida del neumático y no mezclar medidas | A.4, TODO | Sección 3 | Conservada |
| Proyección a 4 semanas (sugerencia preventiva) | A.4, TODO | No se usa; el desempate por tasa queda fuera de F8 | Sigue pendiente |

## 3. Datos que faltan y qué agregar

| Dato | Para qué | Propuesta | ¿Migración? |
|---|---|---|---|
| Rol de cada eje: `direccion`, `traccion`, `arrastre` | Todas las reglas por tipo de eje | Tabla `vehiculo_ejes (vehiculo_id, eje, rol)`. **El eje 1 es siempre dirección**: la tabla lo impone con `rol text not null`, `check (eje >= 1)`, `check (rol in ('direccion', 'traccion', 'arrastre'))` y un `check` (`eje <> 1 or rol = 'direccion'` y `rol <> 'direccion' or eje = 1`), y el dominio lo aplica aunque falte la fila o llegue otro rol; así R3, la cubierta apta para dirección y R9 no dependen de la configuración. Sin fila en los demás ejes, quedan sin clasificar. **Límite declarado:** `direccion` fuera del eje 1 no tiene cabida (un 8x4 con dos ejes delanteros directrices o un bus con eje de cola direccional quedarían mal descritos); es la pregunta 6 | Sí |
| Servicio del vehículo: bus o camión | Reglas de dirección de bus (R9) | Columna `vehiculos.servicio text` con `check (servicio in ('bus', 'camion'))`; **nulo = no se sabe y se trata como bus** (el valor prudente). Se guarda por vehículo, no por eje: no tiene sentido un eje de bus y otro de camión en la misma unidad. Mientras la columna no exista, el dominio recibe el servicio como opción y por defecto asume bus | Sí |
| Tipo de eje simple o dual | Reglas de duales | Se deriva de la posición (`ejeDePosicion`), no se guarda | No |
| Medida del neumático | No mezclar medidas en un par dual ni al reponer | `neumaticos.medida text`, nulo si no se conoce; la regla de duales y la reposición la ignoran si es nula y lo declaran | Sí |
| Aptitud por posición (p. ej. direccional apta para tracción por aprobación del fabricante) | Histórico. Descartado 24/11/2026 (RN-03): no hace falta permiso para pasar una direccional a tracción o eje loco | `neumaticos.apto_otra_posicion boolean` nulo = no se sabe, se trata como no apto | Sí (junto a la medida) |
| Reranurado | 393.75(d) y (e): ningún reranurado adelante en un bus, ni uno de 2.232 kg (4.920 lb) o más en un camión | `neumaticos.reranurado boolean`, nulo = no se sabe. Sin el dato, el sistema no puede detectar un reranurado; el aviso de la sección 6 lo declara | Sí (junto a la medida) |
| Privilegios de las columnas nuevas de `neumaticos` | `neumaticos` tiene privilegios por columna desde la migración de precios | Cada columna nueva exige `grant select (col)` y el test `t_90` falla si queda una sin otorgar (contrato de `supabase/migrations/20261116500000_privilegios_precios.sql:25-26`) | Sí, en la misma migración |
| Parámetros de rotación por cliente | Umbrales configurables | **Tabla propia `rotacion_parametros (cliente_id, ...)`**, no columnas de `clientes`; se escribe solo por la RPC `rotacion_configurar` (sección 9.1). Sin fila, el dominio usa los valores por defecto | Sí |
| Persistencia de «Ignorar» | Ocultar una sugerencia hasta la próxima medición | Tabla `rotacion_sugerencias_ignoradas (vehiculo_id, regla, posiciones, medicion_ref, user_id, created_at)` y una RPC que la escribe; sin ella «Ignorar» no se puede ofrecer (sección 7) | Sí, PR 5 |
| Kilómetros en cada rotación | Intervalo por km | Pasar el odómetro cuando el operario lo conoce; hoy se envía nulo. No se precompleta jamás ([14](14-guia-de-textos.md) sección 5) | No |
| Rotación en cruz atómica | Rotar 3 o más posiciones sin estados intermedios | RPC `neumatico_rotar_varias(vehículo, pares[])` que reutiliza las guardias de `neumatico_rotar`. El nombre evita «permutar», término que la guía de textos no admite | Sí |
| Interpretación de ejes extra (posiciones 17 a 98) | Camiones de más de 16 ruedas | Permitir montarlos con `neumatico_montar`; no es requisito de la primera entrega | Sí, aparte |

Recomendación: no bloquear la primera entrega por estos datos. El PR de dominio (sección 9) funciona con lo que hay (eje 1 como dirección, resto sin clasificar, vehículo tratado como bus) y las reglas que dependen del rol se activan cuando el cliente lo configura.

### 3.1 Quién escribe los datos nuevos y por qué vía

Hasta el PR 9a de F10 `vehiculos` y `neumaticos` se escribían con PATCH directo del admin desde el panel (`vehiculos.js` y `neumaticos.js`; el PR 9a retiró esos formularios y `neumaticos.js` ya no existe), y la empresa no tiene política de escritura: no puede editarlos. La migración C2 de docs/17 (§4.1) revoca `insert, update, delete` a `authenticated` sobre las tablas con política `*_admin_all`, entre ellas `vehiculos` y `neumaticos`, y su prueba se genera desde el catálogo y mira **todas las relaciones de `public`** (tablas, vistas y demás, no solo tablas): falla si **cualquiera**, nueva o no, tiene escritura para `authenticated` (fuera de `dispositivos`, `gastos` y las dos columnas de `clientes` que se conservan) o una política de escritura con `is_admin()` (fuera de `dispositivos`, `gastos` y la excepción explícita `clientes_admin_update`, `FOR UPDATE` con `is_admin()` solo en `clientes`; docs/17, sección 4.1). Por eso F8 no usa PATCH directo para ningún dato nuevo: todo se escribe por una RPC `SECURITY DEFINER` con `search_path` vacío, `revoke` a `public` y `anon`, **sin rama `is_admin()`** (P1 de docs/17: el equipo Neumet solo mira; recibe `42501`) y `42501` uniforme para quien no está autorizado (equipo Neumet, `api`, sin perfil, otra empresa u otra sucursal). Las tablas nuevas nacen sin grant de escritura a `authenticated`, solo con política de lectura por `cliente_id` (más la lectura del equipo Neumet con `is_admin()`).

| Dato | Quién escribe | Vía | Quién lee |
|---|---|---|---|
| `rotacion_parametros` (tabla, PR 2) | Administrador de empresa | `rotacion_configurar` | Administrador de empresa y usuario de sucursal de su empresa; equipo Neumet todas |
| `vehiculos.servicio` y `vehiculo_ejes` (PR 3) | Administrador de empresa | `vehiculo_configurar(p_vehiculo_id, p_servicio, p_ejes)`: guarda el servicio y reemplaza los ejes del vehículo en una sola transacción; fija el eje 1 como `direccion` y acepta `traccion` o `arrastre` solo del eje 2 en adelante | Igual que el vehículo (RLS actual); equipo Neumet todas |
| `neumaticos.medida`, `apto_otra_posicion`, `reranurado` (PR 3) | Administrador de empresa; usuario de sucursal solo en neumáticos montados en un vehículo de su sucursal (el operario conoce la cubierta que tiene en la mano) | `neumatico_datos_editar(p_neumatico_id, p_medida, p_apto_otra_posicion, p_reranurado)`: reemplaza los tres valores (el formulario envía los actuales; nulo = no se sabe). Un neumático en stock lo edita solo el administrador de empresa, porque el usuario de sucursal no ve el stock. **Deja rastro:** `neumaticos` no tiene trigger `audit_row`, así que la RPC escribe una fila en `audit_log` (valor anterior, valor nuevo y actor), a diferencia de `vehiculos`, cuya auditoría (la de `vehiculo_corregir_odometro` de docs/17 incluida) la deja el trigger `trg_audit_vehiculos` (`supabase/migrations/20261106000000_init_schema.sql:379`) y no la RPC. Sin él, un usuario de sucursal podría poner `reranurado` en falso y borrar sin rastro un retiro por norma de R9. Como el formulario envía los tres valores, dos editores simultáneos se pisarían: la RPC recibe también los valores anteriores que vio el formulario y rechaza el cambio si ya no coinciden | Igual que el neumático (columnas con `grant select` por columna) |
| `rotacion_sugerencias_ignoradas` (tabla, PR 5) | Administrador de empresa y usuario de sucursal de su sucursal | RPC de «Ignorar» (PR 5) | Igual que el vehículo |
| Rotaciones y cambios | Los de hoy (`neumatico_rotar`, `neumatico_rotar_varias` en el PR 6) | Sin cambio | |

Autorización: ninguna de estas RPC reutiliza `neumatico_autorizar_vehiculo` mientras esa función conserve su rama de `admin` (`supabase/migrations/20261108000000_cambio_neumatico.sql:48`); calculan el alcance con la regla del administrador de empresa (`admin_empresa_cliente_id()` de la migración A de docs/17 si ya existe; si no, la regla inline de la sección 9.1) combinada con `current_sucursal_id()` y `current_cliente_id()`. Ninguna columna nueva entra en un grant de `update`: la única escritura posible es la de la RPC.

Mientras C2 no esté aplicada, el admin conserva el PATCH directo sobre `vehiculos` y `neumaticos`, pero el front de F8 no lo usa para estos datos, de modo que el recorte de C2 no rompe nada de F8. Pruebas que lo exigen: sección 8.

## 4. Reglas propuestas (histórico, no vigente salvo lo que indica el apartado 0)

> Las reglas R0 a R11 son la propuesta del 2026-11-13. Las que chocan con las reglas vigentes de [23](23-reglas-negocio.md) (R3, R7, R9 en su umbral de 4,8 mm, R10) están marcadas en su encabezado. Ver 0.1.

Convenciones: las profundidades son promedios por posición (`promedio`) salvo que la regla diga lo contrario; «diferencia» es un valor absoluto en milímetros y se compara en décimas de milímetro enteras para evitar errores de coma flotante; los parámetros viven por cliente, con rango permitido. Las reglas de umbral comparan con «mayor o igual» (o «menor o igual» en los retiros): el umbral es el primer valor que dispara la sugerencia. **Excepciones declaradas:** R1 usa «supera» (estrictamente mayor, igual que `desgaste_irregular` de la vista, `supabase/migrations/20261116000000_calidad_datos.sql:593-595`) y R8.1 usa «menos de» (a 2,0 mm exactos del retiro no se suprime la rotación); T60 y T08 las fijan. Los textos están en el estilo de [14](14-guia-de-textos.md): infinitivo, sin emojis, con la regla aplicada en una frase y nombres de posición («Delantera izquierda», «Eje 3 derecha interior») en lugar de «P1, P2»; las huellas se llaman «interna», «central» y «externa». Los números de posición («P1») solo aparecen en la tabla de pruebas. Las fuentes se numeran en la sección 11.

Equivalencias usadas: 2/32 de pulgada = 1,6 mm; 3/32 = 2,4 mm; 4/32 = 3,2 mm; 6/32 = 4,8 mm.

### Definiciones comunes

- **Nombres de posición** (`assets/js/domain/posicion.js`, `nombrePosicion`): P1 Delantera izquierda; P2 Delantera derecha; P3 Eje 2 izquierda exterior; P4 Eje 2 izquierda interior; P5 Eje 2 derecha interior; P6 Eje 2 derecha exterior; P7 y P8 las dos del eje 3 izquierdo (exterior e interior); P9 y P10 las del eje 3 derecho (interior y exterior). «Interior» y «exterior» nombran la rueda de un dual; «interna», «central» y «externa» nombran la huella de la banda.
- **Huella más baja** (`minimo`): el menor de `mm1`, `mm2` y `mm3`. Se calcula solo si las tres huellas están medidas; si falta una, `minimo` es nulo (dato no medido, nunca cero) y la posición queda «Sin dato». Cuidado al implementarlo: `Math.min(null, 4)` da 0 y `least()` de SQL ignora los nulos; ambos producirían un mínimo falso. Hay que comprobar los tres valores de forma explícita (T38).
- **Rol dirección:** siempre y solo el eje 1 (las ruedas delanteras, que es lo que regula 49 CFR 393.75(b), (d) y (e)), sea cual sea `vehiculo_ejes`. Decisión de diseño: la tabla `vehiculo_ejes` no puede dar al eje 1 otro rol ni dar rol dirección a otro eje (sección 3), y si un dato llegara con otro rol, el dominio lo ignora para R2, R3, R7, R9 y la cubierta apta para dirección. Los roles `traccion` y `arrastre` solo se configuran en los ejes 2 en adelante.
- **Servicio:** `bus` o `camion`; nulo se trata como `bus`.
- **Umbral de descarte de la posición** (`umbral_descarte_pos`): en el eje 1 (dirección), `direccion_retiro_mm`; en cualquier otra, `umbral_retiro_mm` (3 mm por defecto, ya existente). Es el único umbral de R3: R3 nunca usa `recauchutar_mm`. `umbral_retiro_mm` es editable por cliente (hoy lo edita el admin desde la ficha del cliente, `CAMPOS_UMBRAL`; `alerta_configurar` no lo recibe) (hoy solo se exige que sea mayor que 0 y menor que `umbral_critico_mm`, `supabase/migrations/20261106020000_producto_vistas.sql:27-28`), de modo que puede quedar por encima de `recauchutar_mm` (4,0 y 3,5 es una configuración válida).
- **Umbral de retiro de la posición** (`umbral_retiro_pos`): el momento en que la posición deja de rodar y se retira, sea para descarte o para recauchutar: en el eje 1, `direccion_retiro_mm`; en otra posición de un cliente que recauchuta y con `vida` menor que 3, `max(recauchutar_mm, umbral_retiro_mm)` (R9); en cualquier otra (incluida una posición con `vida` nula, que no se trata como recauchutable), `umbral_retiro_mm`. Lo usan R8, R9 y la reposición. **Invariante: `umbral_retiro_pos` nunca es menor que `umbral_descarte_pos`.** El máximo lo garantiza en la propia definición, sin depender de un `check` en `rotacion_configurar`, que no alcanzaría porque `umbral_retiro_mm` se edita después en `clientes`. Sin él, con `umbral_retiro_mm` = 4,0 y `recauchutar_mm` = 3,5 un neumático de `vida` 1 en 3,8 mm tendría una tarjeta de retiro (R3, 3,8 ≤ 4,0) que la reposición no contaría (3,8 > 3,5), y se descartaría a 3,8 mm pero se recauchutaría a 3,4 mm, contra R11 (T71; la parte de reposición, T72).
- **Semanas hasta el retiro de la posición:** `max(0, minimo − umbral_retiro_pos) / tasa_mm_semana`, con la `tasa_mm_semana` de la vista (la tasa del promedio) y nula si no hay tasa válida o si `minimo` es nulo. No es la columna `semanas_hasta_retiro` de la vista, que usa el promedio y el umbral general (`supabase/migrations/20261116000000_calidad_datos.sql:610`). Se recalcula en el dominio con los datos de la vista; no hace falta cambiar la vista en F8. Aproximación declarada: la tasa del promedio puede subestimar la de la huella más baja cuando hay desgaste irregular, así que el horizonte tiende a ser optimista. Confianza media-baja; una función de base con la tasa por huella sería un PR futuro que pasaría por `neumet-dba`.
- **Datos que no salen de `v_estado_neumaticos`:** la vista sí trae `vida` (`supabase/migrations/20261116000000_calidad_datos.sql:467`) y no trae `calidad` ni `condicion` (`:459-480`). La `calidad` de la última medición (para «Medición con observaciones» y la invalidación) sale de una consulta a `mediciones` (columna `calidad`, `supabase/migrations/20261116000000_calidad_datos.sql:17`) por el mismo criterio de la vista (última medición del neumático con `calidad <> 'invalidada'`). La `condicion` y, cuando existan, `medida`, `reranurado` y `apto_otra_posicion` salen de una consulta a `neumaticos`; las de stock, del mismo origen. Dato necesario del PR 4 y del PR 1 (el dominio los recibe como entrada); sin ellos, el dominio no puede aplicar R9 ni la cubierta apta, y lo declara.
- **Posición medida sin fila en `neumaticos`** (la vista la lee con `neumatico_id` nulo y `marca`, `modelo` y `vida` nulos: posiciones 17 a 98 o un vehículo con mediciones y sin neumáticos cargados): la profundidad es un dato real y la seguridad no espera el registro, así que R0 y R3 sí se aplican (tarjeta de retiro con acción solo en las posiciones 1 a 10 y 99, donde el formulario puede montar; sin acción en las demás). No hay neumático que mover: R2, R4, R5, R6, R7 (que necesita el dato `apto_otra_posicion` de un neumático que no existe) y R8.2 no la consideran y se emite el aviso «Posición sin neumático registrado» (Datos). R9 tampoco la evalúa: sin neumático no hay condición ni `reranurado` que mirar, y el aviso «Posición sin neumático registrado» ya señala el hueco. Nulo no es igual a nulo: dos neumáticos con `marca` o `modelo` nulos no se consideran «iguales» en R2, R4, R5 ni R6 (T67).
- **Cubierta apta** (para cualquier reposición o cambio): en stock (`estado = 'almacenado'`), en la sucursal del vehículo, sin baja y fuera de proceso de recauchutado.
- **Cubierta apta para dirección** (la usan R3, R7 y el formulario prellenado de la sección 7). Es apta, y además:
  1. `condicion` es `nuevo` o `usado` con `vida = 0`. Una `recauchutado` (o con `vida` mayor que 0) no es apta si el vehículo es bus o su servicio se desconoce (49 CFR 393.75(d), fuente 2); en un camión no es apta salvo que el parámetro `direccion_camion_admite_recauchutada` sea verdadero (falso por defecto, pregunta 9). Una `reparado` no es apta salvo que `direccion_camion_admite_reparada` sea verdadero (falso por defecto, pregunta 9; solo camiones, en bus tampoco se ofrece).
  2. `reranurado` no es verdadero. Con `reranurado` nulo se avisa «Reranurado sin registrar» y la cubierta sigue siendo apta, en bus y en camión: tratar el nulo como no apto dejaría sin cubiertas de dirección a todo cliente mientras no cargue el dato (ninguna cubierta existente lo tiene). El aviso es visible en el formulario prellenado junto a la cubierta sugerida y en la lista de cubiertas (sección 7), de modo que el operario lo ve antes de confirmar.
  3. Tiene profundidad conocida: una cubierta `nuevo` se acepta sin medir; las demás necesitan una medición con las tres huellas, y su `minimo` debe ser mayor que `direccion_retiro_mm`. Sin dato no es apta (nulo, nunca cero).
  4. Si ella y su compañera de eje tienen `medida` registrada y distinta, no es apta; si alguna es nula, la cubierta sigue siendo apta y lleva la marca «medida sin registrar» (no es aviso: clasificación en R11).
  5. Entre dos aptas se prefiere la de misma marca y modelo que la compañera de eje; no es exigencia.
  El formulario no se bloquea en la base: el operario puede elegir otra cubierta, y la lista la muestra con el motivo («No apta en dirección: recauchutada»). Si en un bus se elige a mano una recauchutada para el eje 1, R9 la marca de inmediato como retiro; si eso debe impedirse en el formulario y no solo avisarse, es la pregunta 11.

### R0 · Medir primero (precondición de todas)

- **Condición:** alguna posición involucrada tiene `ultima_medicion_at` nula o `sin_medir` verdadero en la vista. Es el mismo criterio de la vista (`ultima_at < now() − dias_sin_medir_alerta`, comparación exacta de fecha y hora), no `dias_desde_medicion`, que usa `floor`: una medición de 30 días y 12 horas tiene `dias_desde_medicion = 30` pero `sin_medir = true`. Las mediciones invalidadas ya no cuentan en la vista (`calidad <> 'invalidada'`), así que se aplica R0 si no queda otra válida.
- **Parámetro:** el que ya existe, `dias_sin_medir_alerta` (30 por defecto; su definición y la de los demás umbrales por cliente están en `supabase/migrations/20261106020000_producto_vistas.sql:19-23`; la vista solo los expone, `supabase/migrations/20261116000000_calidad_datos.sql:477`). No se crea un parámetro nuevo: una sola definición de «medición vencida» en todo el producto.
- **Texto:** «Medir primero Delantera izquierda: la última medición tiene 41 días.»
- **Fuente y confianza:** criterio de seguridad propio, coherente con el principio de dato no medido nulo ([16](16-hoja-de-ruta.md)). Confianza alta como principio; el valor de 30 días es una elección (media).
- **Efecto:** ninguna sugerencia de rotación ni de retiro **que dependa de la profundidad** (R2 a R8 y el retiro para recauchutar de R9) se emite sobre posiciones sin dato vigente; la salida es «Medir primero». Varias posiciones sin medir se agrupan por eje 1 y resto (R11).
- **Excepción: el retiro por norma de R9** (recauchutado o reranurado en dirección donde la norma lo prohíbe) no depende de la profundidad ni de la antigüedad de la medición, así que R0 no lo anula: se emite aunque la posición esté sin medir (`ultima_medicion_at` nula, p. ej. tras un `montaje` a mano, o `sin_medir` verdadero). En esa posición no se emite «Medir primero»: el neumático se cambia y medirlo no cambia la acción. La otra posición del eje 1, si está sin medir, sigue recibiendo su «Medir primero».

### R1 · Revisar la causa del desgaste irregular (aviso, no bloqueo)

- **Condición por neumático con las tres huellas medidas:**
  - Asimetría: la diferencia entre `mm1` (interna) y `mm3` (externa) supera `irregularidad_mm` (2 mm por defecto): causa probable de alineación o mecánica. El rango de las tres huellas es el desparejo de RN-06 ([23](23-reglas-negocio.md)), no esta regla.
  - Centro gastado: `mm2` menor que el promedio de `mm1` y `mm3` por más de `rotacion_presion_dif_mm`: sobreinflado.
  - Bordes gastados: `mm2` mayor que ese promedio por más de `rotacion_presion_dif_mm`: subinflado o sobrecarga.
- **Parámetro:** `rotacion_presion_dif_mm`, por defecto 2,0 mm (coherente con `irregularidad_mm`), rango 1,0 a 4,0.
- **Texto:** «Revisar alineación del eje 1: Delantera izquierda tiene 3,1 mm de diferencia entre la huella interna y la externa.» / «Revisar presión de Eje 2 derecha interior: el centro está 2,4 mm más gastado que las huellas interna y externa.» / «Revisar presión de Eje 2 derecha interior: las huellas interna y externa están 2,6 mm más gastadas que el centro.»
- **Efecto:** es un **aviso** (no una tarjeta; clasificación de R11): se muestra mientras la condición se cumpla, con la etiqueta «Desgaste». **No bloquea ninguna rotación.** Si R2, R4, R5 o R6 sugieren mover ese neumático, la sugerencia sale marcada «Revisar la causa antes de rotar» (la frase de [15](15-rotacion-alertas-rendimiento.md) A.3, paso 7).
- **Por qué no bloquea (cambio respecto de la versión anterior de este documento):** un bloqueo «hasta una medición nueva posterior a la corrección» no tiene salida: corregir la alineación o la presión no devuelve la banda gastada, así que la medición siguiente repite la asimetría y el bloqueo volvería a activarse para siempre. Las fuentes dicen lo contrario de esperar: Goodyear Reino Unido (fuente 7): «Once the wear differential is about 3mm, you need to turn the tyre» y «Once irregular wear sets in – even if whatever causes that wear has been corrected – the wear will continue, if the difference is more than 3-4mm» (la continuidad vale cuando la diferencia supera 3 a 4 mm); Michelin Reino Unido (fuente 1): en ciertos casos hay que combinar la rotación de posición con girar el neumático en la llanta. Por eso R1 avisa y deja decidir. Girar el neumático en la llanta no existe como operación del sistema y queda fuera de F8.
- **Registro de la corrección:** no hace falta para F8. Si más adelante se quisiera medir si una corrección frenó el desgaste, haría falta un evento de corrección; el tipo `inspeccion` ya lo admite el `check` de `eventos_neumatico`, pero ninguna RPC lo escribe (sección 2); crearla sería un PR aparte, fuera de este plan.
- **Fuente y confianza:** alta como principio. Michelin (fuentes 1 y 5), Continental y Goodyear vía Transport Engineer (fuente 7) y heavyvehicleinspection (fuente 6) coinciden en que la rotación no corrige la causa. Los patrones (centro, bordes, un solo lado) coinciden entre Michelin y heavyvehicleinspection. El umbral numérico es propio (media).
- **Nota:** si ambos neumáticos del mismo eje muestran el patrón simétrico, la causa es de presión o carga; si solo un lado del eje se gasta de forma asimétrica, es alineación (fuente 6, fabricante único con sustento comercial: media).

### R2 · Direccionales: rotar de lado

- **Condición:** eje 1 (dirección), ambas posiciones medidas (R0), misma `marca`, `modelo` y `vida` (y `medida`, cuando exista; si `marca`, `modelo` o `vida` difieren, aviso «Neumáticos distintos», etiqueta «Datos», y no se sugiere; si la `medida` difiere, aviso «Revisar medida del par» (Datos), el mismo de R4 y de la sección 6, y no se sugiere; ni se sugiere rotar una posición sin neumático registrado, ver definiciones comunes), y diferencia de `promedio` entre izquierda y derecha mayor o igual a `rotacion_direccion_dif_mm`.
- **Parámetro:** `rotacion_direccion_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Rotar Delantera izquierda con Delantera derecha: 3,4 mm de diferencia entre lados (umbral 3,0 mm).»
- **Fuente y confianza:** Goodyear (fuente 7) indica girar a unos 3 mm de diferencia, y de ahí sale el valor por defecto de 3,0 mm. Michelin Reino Unido (fuente 1) es más estricto: considera la rotación desde «3/32 or more» de diferencia, es decir 2,4 mm, y su página es general, no específica de dirección; el rango mínimo de 2,0 mm permite configurar un cliente al criterio de Michelin. Overdrive resume disparadores de 3/32 a 5/32 (fuente 12, no abierta). Confianza media: hay consenso en el orden de magnitud y variación de un par de milímetros. La rotación de dirección de lado a lado es práctica común, no reglamento.
- **Qué no hace:** no rota direccionales a otro eje (R7). No ofrece mover un neumático con un daño visible: los daños de 393.75(a) (telas expuestas, separación, cortes) no se miden y el sistema no tiene dónde registrarlos (sección 2); por eso toda tarjeta lleva la frase fija «La sugerencia no reemplaza la inspección visual».

### R3 · Retiro por posición

> **Superada en dirección ([23](23-reglas-negocio.md), RN-02 y RN-08).** El retiro general es 3 mm en todos los ejes; en dirección, «Pasar atrás» a 8 mm o menos y «Pasar atrás ya» bajo 6 mm (amarillo). El retiro de 5,0 mm de este apartado no se usa. Lo que sigue es histórico.

- **Condición:** la huella más baja (`minimo`) de una posición es menor o igual a su `umbral_descarte_pos`: `direccion_retiro_mm` en el eje 1 y `umbral_retiro_mm` (3,0 mm por defecto) en el resto. El retiro para recauchutar (a `max(recauchutar_mm, umbral_retiro_mm)`) no es de R3 sino de R9; en una posición con recauchutado posible, R9 dispara siempre que R3 dispara, y ambas se fusionan (R11, donde prevalece R9). Se compara contra la huella más baja y no contra el promedio: 49 CFR 393.75(b) exige en las ruedas delanteras el mínimo «at any point on a major tread groove», es decir en cualquier punto de una ranura principal (fuente 2; el (c), para el resto de las ruedas, dice «in a major tread groove», sin «en cualquier punto»), de modo que un neumático con una huella en 2,8 mm y promedio de 3,3 mm ya incumple 4/32 de pulgada. Las huellas de NEUMET son tres puntos de la banda; que cada uno caiga en una ranura principal depende del calibre y no está verificado. Dato nulo en cualquiera de las huellas: no se calcula, nunca cero (T38).
- **Parámetros (histórico, no vigente):** `direccion_retiro_mm`, por defecto 5,0 mm, rango 3,2 a 8,0. El mínimo del rango es el piso legal de EE. UU. para ruedas delanteras (4/32 de pulgada, 3,2 mm; fuente 2). El valor por defecto es una práctica de flota (5 a 6/32 de pulgada, fuentes 3 y 4); no hay consenso de fabricantes. Fuera de dirección rige el `umbral_retiro_mm` que el cliente ya tiene; el piso legal de EE. UU. para el resto es 2/32 de pulgada (1,6 mm), por debajo de ese valor.
- **Texto:** «Cambiar neumático en Delantera derecha: dirección con 4,6 mm en la huella más baja (retiro a 5,0 mm).» / «Cambiar neumático en Eje 2 derecha interior: 2,9 mm en la huella más baja (retiro a 3,0 mm).» Si no hay cubierta apta en stock (para dirección, la definición de la sección 4): «Sin stock apto; ver reposición».
- **Convivencia con la alerta crítica (S7):** el valor por defecto de 5,0 mm coincide con `umbral_critico_mm` (5) y con la alerta crítica que ya existe. Son dos señales distintas y compatibles. La alerta crítica es un estado con ciclo de vida (abierta, reconocida, resuelta) que se abre con `promedio < umbral_critico_mm` en cualquier posición; R3 es una sugerencia concreta («Cambiar neumático») de la ficha del vehículo, sin estado ni notificación, que sale con la huella más baja. Como `minimo` nunca supera al promedio, con `direccion_retiro_mm` mayor o igual que `umbral_critico_mm` (los valores por defecto, 5,0 y 5) R3 en dirección salta antes o a la vez que la alerta crítica, nunca después; si el cliente sube `umbral_critico_mm` por encima de `direccion_retiro_mm`, la alerta crítica puede abrirse antes que R3. No se unifican: un cliente puede cambiar el crítico sin tocar la política de retiro de dirección.
- **Confianza:** alta para el piso legal de EE. UU.; baja a media para el valor por defecto. Pregunta al dueño (sección 10) por país y por la política real.
- **Buses:** el valor por defecto de dirección en bus es el mismo; la diferencia es la frecuencia de revisión (R10) y la prohibición de recauchutados adelante (R9).

### R4 · Duales: emparejar el par

- **Condición:** dentro de un mismo par dual (interior y exterior del mismo lado y eje), la diferencia de `promedio` es mayor o igual a `rotacion_dual_max_mm`.
- **Parámetro:** `rotacion_dual_max_mm`, por defecto 3,0 mm, rango 2,0 a 4,0. Ya existe con ese valor en el diseño base de [15](15-rotacion-alertas-rendimiento.md) sección A. Con «mayor o igual» como en R2, R5 y R6: el valor por defecto queda por debajo del límite de 4/32 de pulgada (3,2 mm) de FleetOwner, así que disparar en el umbral exacto sigue dentro de la tolerancia de la fuente.
- **Texto:** «Emparejar duales del eje 3 izquierdo: 4,2 mm de diferencia. Cambiar el neumático más gastado por uno de profundidad cercana a la de su compañero.»
- **Acción sugerida:** primero buscar, en el mismo eje, un intercambio con otro neumático que deje ambos pares dentro de tolerancia; si no existe, sugerir un cambio con una cubierta del stock apta y de profundidad cercana a la de la compañera. Rotar interior con exterior no cierra la diferencia de diámetro, solo equilibra el desgaste a largo plazo. No se ofrece mover un neumático con daño (R2, «Qué no hace»).
- **Fuente y confianza:** FleetOwner/TIA (fuente 8): hasta 4/32 de pulgada de profundidad; cada 1/32 más allá reduce la vida de ambas. Transport Engineer (fuente 7): guía de la federación británica hasta 4 mm; Goodyear Reino Unido no más de 2 a 3 mm. School Bus Fleet (fuente 9) usa límites de diámetro (0,5 pulgadas) y circunferencia (0,75 pulgadas) que en profundidad no se traducen de forma directa. Confianza media: el rango entre fuentes (2 a 4 mm) es el rango del parámetro.
- **Condiciones adicionales:** si ambos neumáticos tienen `medida` y son distintas, la regla da prioridad a «Revisar medida del par»; si la medida es nula se omite la comprobación y la sugerencia lleva la marca «medida sin registrar» (marca de texto, no aviso; R11). Si `marca`, `modelo` o `vida` difieren, la equivalencia de 4/32 de pulgada con 1/4 de diámetro no vale (FleetOwner, fuente 8): se emite el aviso «Neumáticos distintos en el par: medir el diámetro» (etiqueta «Datos») en lugar de la sugerencia por profundidad. «Revisar medida del par» también es un aviso «Datos».

### R5 · Tracción: rotar entre ejes y lados

- **Condición:** ejes de tracción con diferencia de promedio de eje (promedio de sus neumáticos) mayor o igual a `rotacion_traccion_dif_mm`; los pares duales se mueven completos; los neumáticos intercambiados tienen igual `marca`, `modelo` y `vida` (y `medida`, cuando exista).
- **Parámetro:** `rotacion_traccion_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Rotar el eje 2 con el eje 3 y cruzar los lados: el eje 3 tiene 3,6 mm menos de profundidad que el eje 2.»
- **Fuente y confianza:** Michelin (fuente 1): el eje trasero se gasta más que los intermedios; rotar a mitad de vida. Overdrive (fuente 12, no abierta): tracción adelante-atrás, de lado a lado o en X, con 3/32 a 4/32 de diferencia. Confianza media-baja: las cifras vienen de resúmenes y hay desacuerdo sobre cruzar lados; se deja el cruce como parte del texto y no como obligación.
- **Requisito:** rol de eje configurado. Sin él, esta regla no se emite (el modelo actual solo identifica la dirección).
- **Atomicidad:** requiere `neumatico_rotar_varias` (sección 3); con dos intercambios no atómicos se puede dejar una posición con una cubierta de baja o con dos operaciones a medio terminar. Hasta el PR 6, R5 y R6 se muestran como información sin botón de acción.

### R6 · Arrastre y remolque

- **Condición:** ejes con rol arrastre, diferencia de promedio entre el último eje y el medio mayor o igual a `rotacion_arrastre_dif_mm`; mismas condiciones de mezcla que R5.
- **Parámetro:** `rotacion_arrastre_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Alternar los ejes 4 y 5: el último eje tiene 3,3 mm menos de profundidad.»
- **Fuente y confianza:** Transport Engineer (fuente 7): en remolque de tres ejes el último eje se gasta más y conviene alternar medio y último. Una sola fuente de prensa especializada: confianza baja. Por ello la regla está desactivada por defecto en la primera entrega.

### R7 · No pasar una direccional a otra posición sin aprobación (DESCARTADA para Agencia Central)

> **Descartada ([23](23-reglas-negocio.md), RN-03).** Una direccional puede rotar a tracción o a eje loco sin aprobación del fabricante y sin aviso de fuera de posición. No hace falta el dato `apto_otra_posicion`. No implementar. Lo que sigue es histórico.

- **Condición:** un neumático de dirección (eje 1) con fila en `neumaticos` (R7 no evalúa una posición sin neumático registrado: T66) llegó a `direccion_retiro_mm` (la misma condición de R3) y `apto_otra_posicion` no es verdadero. No hay un «umbral de reubicación» propio: la reubicación de una direccional a otro eje con 3 a 4 mm (práctica de Continental, fuente 7) queda fuera de la primera entrega y no tiene parámetro. La cubierta que lo reemplaza debe ser apta para dirección (sección 4).
- **Efecto:** la sugerencia es siempre «Cambiar neumático»; nunca mover a tracción. Como su condición contiene la de R3, cuando R7 dispara también dispara R3 sobre la misma posición: no son dos tarjetas, se fusionan en una (R11, «Una tarjeta de retiro por posición») y R7 aporta la restricción de la acción (el neumático retirado no se ofrece para otra posición).
- **Texto:** el de la tarjeta fusionada (R3, que tiene más prioridad que R7 en R11): «Cambiar neumático en Delantera izquierda: dirección con 4,8 mm en la huella más baja (retiro a 5,0 mm).» La restricción se agrega siempre que R7 participe de la fusión, al final de la tarjeta: «Sin aprobación registrada para usarlo en otra posición.» (T21; excepción: cuando gana el texto de R9 por norma, R11).
- **Fuente y confianza:** Goodyear (fuente 10) y Overdrive (fuente 12): cada tipo de neumático va en su posición; mover una direccional solo si el fabricante la aprueba para ese modelo. Es práctica de un fabricante respaldada por la mayoría de las guías: confianza media. Continental (fuente 7) describe pasar la dirección con unos 3 a 4 mm a otro eje tras reranurar; se trata como práctica de un solo fabricante y no entra por defecto.

### R8 · Cuándo no rotar

Se suprime la sugerencia de rotación (no la de retiro) cuando:

1. **Falta poco para retirar:** las semanas hasta el retiro de la posición (definición común) son menores que `rotacion_espera_semanas`, o la huella más baja está a menos de 2 mm (estrictamente; a 2,0 mm exactos no se suprime) del `umbral_retiro_pos` de esa posición. Es decir, con el umbral de la posición (5,0 mm en dirección), no con el general de 3 mm. Parámetro `rotacion_espera_semanas`, por defecto 4, rango 0 a 12. Bridgestone Costa Rica (resumen de búsqueda, fuente 13): con desgaste considerable conviene reemplazar en vez de rotar. Confianza media.
2. **Rotación reciente:** el último evento `rotacion` del neumático tiene menos de `rotacion_espera_dias` (30 por defecto, [15](15-rotacion-alertas-rendimiento.md) sección A, rango 7 a 90). Propio; sin fuente directa.
3. **Neumático en recauchutado o dado de baja:** la guardia de la base ya lo bloquea (`neumatico_rotar` y apéndice L de [08](08-esquema-datos.md)); la sugerencia no lo ofrece.
4. **Diferencia menor que la mínima:** por debajo del umbral de la regla (Michelin, fuente 1: 0 a 2/32 de pulgada de diferencia, no rotar). Confianza media-alta.

La causa mecánica sin corregir (R1) ya no suprime la rotación: la marca (R1).

Como Toyo opina (resumen de búsqueda, fuente 13) que fuera de casos específicos la rotación cuesta mano de obra con poco retorno, la regla errará hacia no sugerir.

### R9 · Neumáticos recauchutados, reparados y reranurados

- **Retiro para recauchutar (fuera de dirección; es la única regla que dispara por `recauchutar_mm`):** si el cliente recauchuta (`recauchuta = true`, pregunta al dueño) y la carcasa admite otra vida (`vida` menor que 3), una posición que no es de dirección cuya huella más baja es menor o igual a su `umbral_retiro_pos`, es decir `max(recauchutar_mm, umbral_retiro_mm)`, se sugiere para recauchutado y no para descarte. El máximo evita que, con `umbral_retiro_mm` por encima de `recauchutar_mm` (4,0 y 3,5), el mismo neumático se descarte a 3,8 mm y se recauchute a 3,4 mm (T71). En dirección el retiro ya sale por R3 (5,0 mm es mayor que 4,8 mm); el destino se elige al cambiar. **El destino lo decide la inspección de la carcasa:** el sistema no sabe si la carcasa sirve; con muy poca banda (por ejemplo 1,5 mm) la tarjeta se emite igual y el formulario de la sección 7 deja elegir «Baja por desgaste» en lugar de «Recauchutado».
- **Parámetro:** `recauchutar_mm`, por defecto 4,8 mm (6/32 de pulgada), rango 3,5 a 8,0. Hoy `umbral_retiro_mm` es 3 mm y sirve para descarte, no para recauchutar; hace falta un parámetro nuevo. Si `umbral_retiro_mm` es mayor, rige este como piso del disparador (`umbral_retiro_pos`, sección 4).
- **Texto:** «Retirar Eje 2 derecha interior para recauchutado: queda 4,6 mm en la huella más baja (umbral 4,8 mm).» El umbral que se muestra es el `umbral_retiro_pos` de la posición.
- **Fuente y confianza:** TRIB, vía Tire Review (fuente 14, resumen de búsqueda: la página devolvió 403): retirar a unos 6/32 de pulgada. School Bus Fleet (fuente 9) dice que 6/32 suele alcanzar para recauchutar la carcasa. Dos fuentes, una solo por resumen: confianza media-baja.
- **Neumático no admitido en dirección (se evalúa siempre en el eje 1, tenga o no `vehiculo_ejes`):** las prohibiciones **de la norma** son una **sugerencia de retiro** (tipo `retiro`, sin depender de la medición: excepción de R0), no un simple aviso; lo que es política de la empresa o requiere confirmar un dato son avisos.
  - **Recauchutado** (`condicion = 'recauchutado'` o `vida` mayor que 0): en un **bus**, o en un vehículo cuyo servicio se desconoce, siempre: 49 CFR 393.75(d) prohíbe reranurados, recauchutados y reencauchados en las ruedas delanteras de un bus (fuente 2; confianza alta). Es una sugerencia de retiro de tipo `retiro` (como R3 y R7): cuenta para R11, así que suprime la rotación de ese neumático y de su par. Texto: «Cambiar neumático en Delantera izquierda: recauchutado en dirección, no admitido en buses.» Etiqueta «Seguridad». Se emite aunque la posición no esté medida (excepción de R0). En un camión, solo si `direccion_camion_admite_recauchutada` es falso (por defecto): «Recauchutado en dirección: la política de la empresa no lo admite.» Las prácticas recomendadas de la industria lo desaconsejan en larga distancia y el TRIB lo trata como elección, no como mandato (fuente 11); confianza media.
  - **Reparado** (`condicion = 'reparado'`): aviso «Reparado en dirección: confirmar que fue una sola reparación de clavo, sin reparación de talón.» Modern Tire Dealer (fuente 11) cita que las normas de industria admiten una sola reparación de agujero de clavo por neumático de dirección y ninguna reparación en el talón. El sistema no sabe qué reparación fue; el aviso pide confirmarlo.
  - **Reranurado** (`reranurado` verdadero): sugerencia de retiro de tipo `retiro`, etiqueta «Seguridad», que cuenta para R11 (suprime la rotación de ese neumático y de su par), tanto en bus como en camión. En un **bus**, o con servicio desconocido, siempre, por 393.75(d): «Cambiar neumático en Delantera izquierda: reranurado en dirección, no admitido en buses.» En un **camión**, 393.75(e) lo prohíbe en ruedas delanteras si la capacidad de carga es de 2.232 kg (4.920 lb) o más (fuente 2, alta). Los neumáticos de camión pesado de 22,5 pulgadas superan ese valor (p. ej. el índice de carga 152 equivale a 3.550 kg; conocimiento general, no verificado con fuente abierta: confianza media) y el sistema no conoce la capacidad de carga de cada cubierta, así que se trata como prohibido sin evaluar la capacidad y por eso es retiro y no aviso (un aviso no suprimiría la rotación y dejaría sugerir «Rotar» sobre un neumático que la norma no admite adelante): «Cambiar neumático en Delantera izquierda: reranurado en dirección, no admitido en camiones de carga pesada (49 CFR 393.75(e)).» Hasta que exista el dato (`reranurado`, sección 3), el sistema no detecta un reranurado: es un límite declarado, no una verificación. Con la columna creada pero `reranurado` nulo en el eje 1 (bus o camión) no hay retiro: se emite un aviso por posición del eje 1 (hasta dos) «Reranurado sin registrar en dirección: confirmar que no es reranurado» (etiqueta «Datos»), por la misma razón de la cubierta apta (T64).
- **Valor por defecto para camiones:** ni recauchutados ni reparados en dirección (valor conservador) mientras el dueño no decida (pregunta 9). Brasil también prohíbe reformados en buses (solo por resumen de búsqueda, sin verificar).

### R10 · Intervalo por kilómetros o tiempo

> **Parcialmente superada ([23](23-reglas-negocio.md), RN-04, RN-05 y RN-12).** Los kilómetros sí son la base del rendimiento y de la proyección, y el swap a 20.000 km en vida 0 es vigente. El texto de recomendación que sigue, que descartaba los kilómetros, ya no aplica; ver la recomendación vigente abajo.

- **Hallazgo:** no hay consenso. Michelin rota a media vida según la tasa de desgaste y no da intervalo en kilómetros (fuente 1); Goodyear menciona unas 125.000 millas para el tándem, cifra poco fiable; los intervalos comerciales van de 8.000 a 10.000 km (blog, fuente 15) y de 30.000 a 75.000 millas (resúmenes de búsqueda).
- **Recomendación vigente ([23](23-reglas-negocio.md)):** el rendimiento y la proyección se miden por kilómetros con odómetro (tasa en mm por 1.000 km y km hasta el retiro); el swap se sugiere a los 20.000 km en cubiertas de vida 0. Si no hay odómetro, el dato es «sin dato» y no se inventa; el tiempo solo se usa como respaldo rotulado.
- **Recomendación histórica (superada):** no usar los kilómetros como disparador. El disparador era la diferencia de desgaste (R2, R5, R6). Como recordatorio secundario, `rotacion_recordatorio_dias` (nulo por defecto, rango 30 a 365): si el vehículo lleva más de ese plazo sin una rotación (días desde el último evento `rotacion` de cualquiera de sus posiciones o, si nunca se rotó, desde el primer montaje; medir no reinicia la cuenta, T29; un vehículo sin evento `montaje` no tiene fecha de inicio: caso a definir, decisión de negocio pendiente), emitir el aviso (etiqueta «Desgaste», sin tarjeta) «Revisar rotación del vehículo: 120 días sin rotar». (Histórico: [23](23-reglas-negocio.md) exige km con odómetro para todo rendimiento (RN-04); el criterio de `km_confiable` sigue siendo referencia de implementación.)
- **Buses de pasajeros:** el disparador es el mismo; sube la frecuencia de medición: School Bus Fleet (fuente 9) describe revisión diaria de neumáticos y presión semanal, profundidad mensual. El parámetro `dias_sin_medir_alerta` ya cubre la frecuencia de medición.
- **Confianza:** alta en que no hay consenso; baja en cualquier cifra.

### R11 · Clasificación y alineación entre reglas

**Clasificación única.** El dominio produce dos clases de salida, y las secciones 6, 7 y 8 y las reglas R0 a R10 usan esta tabla y no otra:

- **Sugerencia** (se muestra como **tarjeta**, tiene acción y `tipo`): suprime otras sugerencias según este apartado y cuenta para el tope de tarjetas.
- **Aviso** (se muestra en una lista aparte, bajo las tarjetas, sin acción): no suprime nada, no cuenta para el tope y no se limita. Lleva una etiqueta: «Seguridad», «Desgaste» o «Datos».

| Salida | Clase | `tipo` o etiqueta |
|---|---|---|
| R0 «Medir primero» | Sugerencia | `medir` |
| R3 retiro; R7; R9 retiro por norma (recauchutado o reranurado en dirección donde la norma lo prohíbe); R9 retiro para recauchutar. Una posición da **a lo más una** de estas tarjetas (fusión, abajo) | Sugerencia | `retiro`; etiqueta de la tarjeta «Seguridad» en el eje 1 y en los retiros por norma, «Desgaste» en las demás posiciones |
| R2 rotar de lado; R4 emparejar duales; R5; R6 | Sugerencia | `rotacion`; etiqueta «Desgaste» |
| R1 «Revisar la causa» (alineación o presión) | Aviso | «Desgaste» |
| R10 «Revisar rotación del vehículo» (recordatorio) | Aviso | «Desgaste» |
| R9 reparado en dirección; R9 recauchutado en dirección de un camión por política de la empresa | Aviso | «Seguridad» |
| R9 «Reranurado sin registrar» en dirección; «Neumáticos distintos» (R2) y «Neumáticos distintos en el par: medir el diámetro» (R4); «Revisar medida del par»; «Posición sin neumático registrado»; «Eje sin soporte de rotación» | Aviso | «Datos» |
| «Medición con observaciones»; «medida sin registrar»; «Sin stock apto; ver reposición» (sección 6); «Sin dato» (posición con `minimo` nulo, T38); la nota de límite declarado de «Neumático reranurado» (sección 6) | **Marcas de texto**, no salidas: no son tarjeta ni aviso, no suprimen nada ni cuentan para el tope. «Sin stock apto; ver reposición» se agrega a la tarjeta de cambio cuando no hay cubierta apta; «Sin dato» es el estado que muestra la posición cuando falta una huella (no hay sugerencia que acompañar); la nota de límite declarado es texto fijo de la ficha mientras no exista `reranurado`, no se genera por vehículo. La primera se agrega a la sugerencia que usa esa medición; la segunda, a la sugerencia de R4 (o de R2, R5 o R6) cuando algún neumático del par tiene `medida` nula, y a la cubierta apta de la lista y del formulario (sección 4, criterio 4). Una medida nula es el valor por defecto mientras no se cargue el dato, así que la marca no se cuenta como aviso | |

**Supresión.** Orden de evaluación: R0 (precondición); luego retiro y seguridad (R3, R9, R7); luego R8 (suprime rotaciones), R1 (aviso) y las rotaciones R2, R4, R5, R6. Una **sugerencia de retiro** es cualquiera de tipo `retiro`: R3, R7, el retiro por norma de R9 (recauchutado o reranurado en dirección de un bus; reranurado en dirección de un camión) y el retiro para recauchutar de R9. Los avisos de R9 (reparado, política de camión, reranurado sin registrar) y R1 no lo son. Si un neumático recibe una sugerencia de retiro, no se le ofrece rotación en el mismo ciclo, y tampoco se rota su par de eje: un bus con P1 y P2 recauchutados emite solo dos «Cambiar neumático».

**Una tarjeta de retiro por posición.** Cada posición da a lo más una sugerencia `retiro`. Si varias reglas la producen (R9 por norma, R3, R7, R9 para recauchutar), se fusionan en una sola tarjeta con el texto de la de mayor prioridad: **R9 por norma > R9 para recauchutar > R3 > R7** (R9 para recauchutar solo existe fuera del eje 1 y R7 solo en el eje 1, así que el orden no tiene cruces: fuera de dirección, una carcasa que admite otra vida se retira para recauchutar y no para descarte; como R9 dispara en `max(recauchutar_mm, umbral_retiro_mm)`, donde R3 dispara R9 también y gana la fusión, con cualquier `umbral_retiro_mm`, T71). La tarjeta lleva la etiqueta más alta entre las reglas fusionadas («Seguridad» si alguna la tiene) y la restricción de acción de R7. Esa restricción se agrega siempre que R7 participe de la fusión (frase al final del texto: «Sin aprobación registrada para usarlo en otra posición.»), salvo cuando el texto ganador es el de R9 por norma, que ya dice que el neumático no se admite (T69). En el eje 1 la condición de R7 implica la de R3 (R7 dispara solo si R3 dispara); un bus con P1 recauchutado y 4,0 mm da R9 por norma, R3 y R7 sobre la misma posición y se muestra **una** tarjeta (T69). La fusión ocurre antes del tope y del conteo de «sugerencias más».

**Tope y orden de las tarjetas.** Máximo 3 tarjetas por vehículo en pantalla, en este orden (desempate dentro de cada grupo: menor huella más baja, o mayor diferencia en las rotaciones, y luego número de posición): 1) retiros con etiqueta «Seguridad»; 2) «Medir primero» del eje 1; 3) los demás retiros; 4) rotaciones; 5) «Medir primero» del resto de las posiciones. «Medir primero» se agrupa en dos tarjetas como máximo: una para el eje 1 y otra para el resto. La de dirección ocupa el segundo lugar porque los retiros de dirección dependen de medir: como el eje 1 tiene dos posiciones, los retiros «Seguridad» y el «Medir primero» del eje 1 suman a lo más dos tarjetas: una posición da a lo más un retiro (fusión de arriba; sin ella, R3, R7 y R9 sobre la misma posición ocuparían tres) y una posición sin medir no tiene retiro «Seguridad» por profundidad, aunque la prohibición por norma, que no pide medir, sí lo da. Por eso **«Medir primero» del eje 1 nunca queda fuera por el tope**. Lo que no cabe se cuenta en una línea sin acción («1 sugerencia más»), para que ninguna quede oculta sin aviso; si no sobra ninguna (cero), la línea no se muestra.

## 5. Reposición (histórico, fuera del backlog vigente; ver 0.3)

Alcance: sugerir cuántas cubiertas comprar por medida y rol de eje. Es una sugerencia revisable, nunca una compra automática ([16](16-hoja-de-ruta.md) F8).

- **Necesidad neta** = demanda durante el plazo de entrega + seguridad − cubiertas aptas disponibles. Nunca negativa (T31).
- **Demanda durante el plazo:** cantidad de neumáticos montados que, con el umbral de retiro de su posición, ya están en el retiro (`minimo` menor o igual a `umbral_retiro_pos`, sin necesidad de tasa) o llegarán a él dentro del plazo de entrega (semanas hasta el retiro de la posición, definidas en la sección 4, menores o iguales al plazo). Es un conteo por regla, sin pronóstico estadístico. Un neumático de dirección en 6,0 mm con tasa de 0,25 mm por semana llega a 5,0 mm en 4 semanas; la columna `semanas_hasta_retiro` de la vista diría 12 (contra el umbral de 3 mm) y lo dejaría fuera del conteo.
- **Sin dato:** un neumático montado con `minimo` por encima del umbral y sin tasa válida (o con `minimo` nulo) **no se cuenta como «no se retira»**: se informa aparte, «N sin dato de desgaste», para que el cliente decida (principio 5 de [16](16-hoja-de-ruta.md)).
- **Plazo de entrega:** parámetro `reposicion_plazo_semanas`, por defecto 4, rango 1 a 26 (dato de negocio: pregunta al dueño).
- **Seguridad:** `reposicion_seguridad_pct`, por defecto 10 % de los neumáticos montados de esa medida, redondeado hacia arriba, mínimo 1, rango 0 a 30 %.
- **Aptas disponibles:** la definición de cubierta apta de la sección 4 (stock con `estado = 'almacenado'`, `condicion` apta y en la sucursal del vehículo; se excluyen las cubiertas en proceso de recauchutado).
- **Dirección aparte:** las direccionales se cuentan por separado y contra las cubiertas aptas para dirección (sección 4), porque no se reutilizan en otras posiciones (R7) y no toda cubierta del stock sirve adelante.
- **Texto:** «Comprar 4 neumáticos 295/80 R22,5: 5 llegan al retiro en 4 semanas, hay 2 en stock y 1 de seguridad (10 montados). 3 sin dato de desgaste.» Cuenta: 5 + 1 − 2 = 4.
- **Fuente y confianza:** la forma ROP = D·L + SS es el modelo estándar de reposición de inventario (min-max); heavyvehicleinspection lo describe sin fórmula de seguridad (fuente 16) y no hay guía específica de neumáticos. Confianza media en la forma; baja en los valores por defecto (los fija el negocio) y media-baja en el horizonte (tasa del promedio, sección 4).
- **Prerrequisito:** `neumaticos.medida` (sección 3). Sin ella, la reposición agrupa por rol de eje y lo declara.

## 6. Casos límite y de seguridad

| Caso | Comportamiento |
|---|---|
| Sin medición, o medición vencida (`sin_medir`) | R0: «Medir primero». Ninguna otra sugerencia que dependa de la profundidad sobre esa posición; el retiro por norma de R9 (recauchutado o reranurado en dirección) sí se emite (T61, T62) |
| Medición con calidad invalidada | La vista la ignora; se aplica R0 si no queda otra válida |
| Medición sospechosa | La sugerencia se emite pero marcada «Medición con observaciones» (calidad ya existe, apéndice I de [08](08-esquema-datos.md)) |
| Alguna huella nula | `minimo` no se calcula: la posición queda con la marca «Sin dato» (marca de texto, R11); nunca se trata como cero |
| Neumático en recauchutado | Excluido de rotación y de retiro; el stock apto no lo cuenta |
| Neumático dado de baja | Excluido; la base ya rechaza el intercambio |
| Posición vacía | Una rotación hacia posición vacía mueve el neumático; se ofrece solo si la regla lo justifica, no por defecto |
| Stock insuficiente | La sugerencia de cambio se emite con la marca de texto «Sin stock apto; ver reposición» (R11; no es un aviso) |
| Sin odómetro ([23](23-reglas-negocio.md), RN-04 y RN-12) | El rendimiento y la proyección por km quedan **«sin dato»**; no se inventan ni se estiman. Solo el respaldo por tiempo, rotulado como tal |
| Eje sin rol configurado | Se emiten R0, R1, R2, R3 y R7 (eje 1 siempre dirección), R4 (duales), R8, R9 (eje 1 y retiro para recauchutar) y R3 en las demás posiciones; no se emiten R5 ni R6 |
| Eje 1 con rol distinto de dirección en los datos | El dominio lo trata igual como dirección (R3 con `direccion_retiro_mm`, cubierta apta para dirección, R9); la base lo rechaza con un `check` (sección 3) |
| Vehículo sin servicio (bus o camión) registrado | Se trata como bus: la sugerencia de retiro por recauchutado en dirección se emite (R9) y ningún recauchutado es apto para dirección |
| Eje 1 con medidas distintas a izquierda y derecha | Aviso «Revisar medida del par» (Datos); no se sugiere rotar |
| Una sola posición medida del par | No se sugiere nada; R0 pide medir la otra |
| Datos de ejes extra (17 a 98) | No se sugiere rotación; se muestra el aviso «Eje sin soporte de rotación» (Datos) hasta que el montaje los admita |
| Neumático con corte, telas expuestas, separación o fuga (393.75(a)) | No se mide ni se puede registrar hoy (sección 2). La sugerencia no reemplaza la inspección visual; toda tarjeta lo dice. R2 y R4 no pueden excluir un neumático dañado porque no existe el dato |
| Neumático reranurado | No se detecta hasta que exista `reranurado` (sección 3); nota fija de límite declarado, marca de texto de R11 (no es un aviso por vehículo) |
| Dos rotaciones simultáneas | La base serializa por posición; la vista recarga tras registrar |

## 7. Flujo para el operario

Cuenta de clics sobre la ficha del vehículo, según la sección 5 de [14](14-guia-de-textos.md):

| Tarea | Hoy | Propuesto |
|---|---|---|
| Rotar dos posiciones | 4 a 5 clics: tocar la rueda, abrir el desplegable, elegir destino, «Rotar», confirmar si hay intercambio (`assets/js/views/vehiculo-detalle.js:312-319`, `assets/js/views/cambio-neumatico.js:150-166`) | 1 clic: «Registrar rotación» en la tarjeta de la sugerencia; la sugerencia ya es la confirmación |
| Rotación en cruz | No existe como operación única | 1 clic con `neumatico_rotar_varias` (PR 6) |
| Ejecutar una sugerencia de cambio | 3 a 4 clics desde «Cambiar neumático» | 2 clics: «Cambiar neumático» abre el formulario con la posición y el motivo ya completados y, como cubierta sugerida, la primera apta (para dirección, la definición de la sección 4) |
| Ver por qué se sugiere | No aplica | 0 clics: el motivo es la frase visible de la tarjeta |
| Ejecutar «Retirar para recauchutado» (R9) | No existe | 2 clics, como el cambio: la tarjeta abre el mismo formulario con la posición, el destino «Recauchutado» preseleccionado y el motivo «Desgaste: retiro para recauchutado» prellenado (editable); elegir «Baja por desgaste» si la inspección de la carcasa lo descarta |
| Descartar una sugerencia | No aplica | 1 clic: «Ignorar hasta la próxima medición» (PR 5; hasta entonces no se ofrece) |

Pautas:

- Una acción primaria por tarjeta; la tarjeta muestra qué mover, hacia dónde y la regla en una frase, con nombres de posición («Delantera izquierda»), no «P1, P2».
- «Registrar rotación» (no «Aplicar», que no dice qué se aplica) guarda la rotación sin pedir odómetro (campo opcional, nunca precompletado).
- **Sin confirmación cuando el destino está ocupado:** hoy se confirma el intercambio; en la tarjeta se quita porque la acción es reversible (rotar de nuevo restaura las posiciones) y [14](14-guia-de-textos.md) sección 5, regla 5, reserva la confirmación para lo destructivo o irreversible.
- **«Ignorar hasta la próxima medición» necesita persistencia compartida**: si solo vive en el navegador, otro usuario o dispositivo vería la sugerencia de nuevo. Requiere la tabla de la sección 3 y una RPC; entra en el PR 5 (con migración). La primera versión de la tarjeta (PR 4) no ofrece «Ignorar». Pregunta 10: si debe pedir un motivo.
- Quién puede pulsar «Registrar rotación» queda ligado a quién puede rotar hoy (`neumatico_autorizar_vehiculo`): administrador de empresa y usuario de sucursal para su sucursal; el equipo Neumet solo mira (docs/17 P1, ver sección 9.1). Pregunta 7.
- No se usa color como único indicador: cada tarjeta lleva un texto de prioridad («Seguridad», «Desgaste», «Medir») y cada aviso una etiqueta («Seguridad», «Desgaste», «Datos»), según la clasificación única de R11. Los textos usan el vocabulario de [14](14-guia-de-textos.md): «Rotar», «Cambiar neumático», «recauchutado», «posición vacía», «Sin dato», «Medición con observaciones».

## 8. Criterio de prueba (histórico, no vigente salvo lo que indica el apartado 0)

> Los casos que usan `direccion_retiro_mm` = 5,0 mm, `apto_otra_posicion` o R7 no son vigentes. Los casos de R10 basados en tiempo tampoco. Los criterios de aceptación están en [23](23-reglas-negocio.md) (CA-01 a CA-32).

La función pura (propuesta: `recomendarRotacion(vehiculo, filas, opciones)` en `assets/js/domain/rotacion.js`, sin DOM ni supabase) devuelve una lista de sugerencias `{regla, tipo, posiciones, texto}` (con `tipo` `retiro`, `rotacion` o `medir`; son las tarjetas y las que cuentan para R11) y una lista aparte de avisos `{regla, etiqueta, posiciones, texto}`, ambas según la clasificación única de R11 (los avisos no suprimen nada ni cuentan para el tope de tarjetas). Una segunda función pura, `esAptaDireccion(cubierta, vehiculo, opciones)`, implementa la definición de la sección 4. Cada fila de la tabla siguiente se convierte en un test unitario en `tests/unit/rotacion.test.mjs`. Los valores usan los parámetros por defecto y neumáticos con igual `marca`, `modelo`, `vida` y `medida` nula salvo que la entrada diga otra cosa. Las posiciones: P1 Delantera izquierda, P2 Delantera derecha, P3 a P6 del eje 2, P7 y P8 eje 3 izquierdo, P9 y P10 eje 3 derecho. «Uniforme» significa las tres huellas iguales. Los casos T01 a T34 son los de la primera versión, ajustados; T35 a T72 son nuevos. En la ronda 5 se agregó T70 y cambiaron T25, T51 y T52; en la ronda 6 se agregó T71 (y en la ronda 7 T72, la parte de reposición que estaba en T71) y se precisó el orden de las tarjetas en T58 y T63. En la ronda 4 cambiaron T11, T13, T21, T34, T35, T36, T59 y T66 (una sola tarjeta de retiro por posición, R11) y se agregaron T68 y T69. T02, T08, T10, T27 y T44 cambiaron en la ronda 2; T27 y T44 se precisaron en la ronda 3 (posición medida). T02 usaba P2 en 6,5 mm, a 1,5 mm del retiro de dirección, donde R8.1 suprime la rotación (ese caso es ahora T53); T02 usa 7,5 mm en P2 para que la rotación se emita.

| ID | Regla | Entrada | Resultado esperado |
|---|---|---|---|
| T01 | R0 | P1 con `ultima_medicion_at` de hace 31 días | «Medir primero Delantera izquierda»; ninguna otra sugerencia sobre P1 |
| T02 | R0 | P1 medida hace 29 días y 23 horas, P2 vigente, P1 y P2 uniformes con 11,0 y 7,5 mm (3,5 mm de diferencia; P2 a 2,5 mm del retiro de 5,0, sin tasa) | «Rotar Delantera izquierda con Delantera derecha» (la medición sigue vigente; R8.1 no suprime porque 2,5 no es menor que 2) |
| T03 | R0 | P1 con `ultima_medicion_at` nula | «Medir primero Delantera izquierda» |
| T04 | R1 | P1 con `mm1` = 9, `mm2` = 8, `mm3` = 6,5 (asimetría 2,5 mm) y P2 uniforme con 8,0 mm (sin diferencia relevante) | Aviso «Revisar alineación del eje 1»; sin rotación porque no hay diferencia entre lados, no por bloqueo |
| T05 | R1 | P5 con `mm1` = 9, `mm2` = 6,5, `mm3` = 9 | «Revisar presión» por centro gastado (2,5 mm) |
| T06 | R1 | P5 con `mm1` = 6, `mm2` = 8,6, `mm3` = 6 | «Revisar presión» por bordes gastados (2,6 mm) |
| T07 | R1 | P5 con `mm1` = 9, `mm2` = 8, `mm3` = 9 | Sin aviso por causa |
| T08 | R2 y R8 | P1 = 10 mm, P2 = 7,0 mm (uniformes), sin tasa | «Rotar Delantera izquierda con Delantera derecha» (diferencia exacta de 3,0 mm: sugiere). P2 queda a 2,0 mm exactos del retiro (7,0 − 5,0): R8.1 usa «menos de», así que a 2,0 mm exactos no se suprime |
| T09 | R2 | P1 = 10 mm, P2 = 7,1 mm (uniformes) | Sin sugerencia de rotación (2,9 mm) |
| T10 | R2 y R1 | P1 con `mm1` = 11,5, `mm2` = 10,5, `mm3` = 9,0 (promedio 10,33; asimetría 2,5 mm) y P2 uniforme con 7,0 mm (a 2,0 mm exactos del retiro, no se suprime) | Aviso R1 y «Rotar Delantera izquierda con Delantera derecha» (3,33 mm de diferencia), marcada «Revisar la causa antes de rotar»; la rotación no se bloquea |
| T11 | R3 | P2 uniforme con 5,0 mm (dirección) | Una sola tarjeta «Cambiar neumático en Delantera derecha» (igual al umbral: sugiere); R3 y R7 (`apto_otra_posicion` nulo) se fusionan, no son dos tarjetas |
| T12 | R3 | P2 uniforme con 5,1 mm | Sin sugerencia de retiro |
| T13 | R3 | P2 uniforme con 4,6 mm y P1 uniforme con 10 mm | Una sola tarjeta de retiro de Delantera derecha (R3 y R7 fusionadas), sin rotación entre P1 y P2 |
| T14 | R4 | P7 = 10 mm, P8 = 7,0 mm (uniformes) | «Emparejar duales del eje 3 izquierdo» (diferencia de 3,0 mm: sugiere, como R2) |
| T15 | R4 | P7 = 10 mm, P8 = 7,1 mm (uniformes) | Sin sugerencia (2,9 mm) |
| T16 | R4 | P7 y P8 con medidas distintas registradas | Aviso «Revisar medida del par» (Datos); sin sugerencia |
| T17 | R4 | P7 y P8 con medida nula, 10 y 5,8 mm (4,2 mm) | Se evalúa por profundidad; la sugerencia lleva la marca «medida sin registrar» (sin aviso) |
| T18 | R5 | Eje 2 con promedio 10 y eje 3 con promedio 6,4, con rol de eje configurado | «Rotar el eje 2 con el eje 3» (diferencia de 3,6 mm) |
| T19 | R5 | Mismo caso sin rol de eje configurado | Sin sugerencia R5 |
| T20 | R6 | Eje 4 = 9 mm y eje 5 = 5,7 mm, con rol arrastre y R6 activa | «Alternar los ejes 4 y 5» (3,3 mm) |
| T21 | R7 | P1 uniforme con 4,8 mm y `apto_otra_posicion` nulo | Una sola tarjeta «Cambiar neumático en Delantera izquierda» con el texto de R3 y la restricción de R7 (nunca mover a tracción) |
| T22 | R8 | P1 uniforme con 12,0 mm; P2 uniforme con 8,0 mm y tasa de 1,0 mm por semana | Sin sugerencia de rotación: (8,0 − 5,0) / 1,0 = 3 semanas, menos que 4 (con el umbral general de 3 mm serían 5 semanas y no se suprimiría) |
| T23 | R8.2 | P1 uniforme con 12,0 mm y P2 uniforme con 8,0 mm (4,0 mm de diferencia; P2 a 3,0 mm del retiro, así que R8.1 no interviene), sin tasa; el último evento `rotacion` de ambas fue hace 10 días | Sin sugerencia de rotación: 10 días es menos de `rotacion_espera_dias` (30) |
| T24 | R8.4 | P1 uniforme con 10,0 mm y P2 uniforme con 7,5 mm (2,5 mm de diferencia; P2 a 2,5 mm del retiro, así que R8.1 no interviene), sin tasa y sin rotaciones previas | Sin sugerencia de rotación: la diferencia es menor que `rotacion_direccion_dif_mm` (3,0) |
| T25 | R9 | P5 `vida` 1, uniforme con 4,8 mm, cliente que recauchuta | «Retirar Eje 2 derecha interior para recauchutado» (4,8 es menor o igual a 4,8; R3 no dispara: 4,8 es mayor que `umbral_retiro_mm` 3,0) |
| T26 | R3 y R9 | P5 `vida` 3 (carcasa agotada), uniforme con 4,8 mm, cliente que recauchuta | Sin sugerencia: 4,8 mm es mayor que el retiro general de 3,0 mm y la carcasa no admite otra vida |
| T27 | R9 | P1 recauchutado (`vida` 1), uniforme con 10,0 mm y medición vigente, en el eje 1 de un vehículo con servicio `bus` | Sugerencia de retiro (`tipo` `retiro`) «Cambiar neumático en Delantera izquierda: recauchutado en dirección, no admitido en buses.», etiqueta «Seguridad» |
| T28 | R10 | Cliente sin `rotacion_recordatorio_dias` | Sin recordatorio |
| T29 | R10 | Recordatorio de 120 días; el último evento `rotacion` del vehículo fue hace 121 días (una medición de hace 5 días no reinicia la cuenta) | Aviso (sin tarjeta) «Revisar rotación del vehículo: 121 días sin rotar» |
| T30 | Reposición | 5 neumáticos llegan al retiro de su posición en el plazo, 2 cubiertas aptas en stock, seguridad 1 | Necesidad neta = 4 (5 + 1 − 2) |
| T31 | Reposición | 1 llega al retiro, 4 aptas en stock, seguridad 1 (1 + 1 − 4 = −2) | Cero; nunca se sugiere devolver |
| T32 | Reposición | Cubiertas aptas en proceso de recauchutado | No se cuentan como disponibles |
| T33 | Regresión de datos | Mm nulos | Nulo, nunca cero: sin dato, sin sugerencia |
| T34 | Límite de pantalla y R11 | Camión con todos los neumáticos `nuevo`, con `reranurado` falso y con cubiertas aptas en stock: P2 uniforme con 4,6 mm (retiro de dirección) y medición vigente; P1 con la última medición hace 31 días; P5 uniforme con 2,9 mm; P7 uniforme con 10,0 mm y P8 uniforme con 6,5 mm (diferencia de 3,5 mm); las demás posiciones vacías. Cuatro sugerencias válidas tras la fusión (R3 y R7 de P2 son una) y ningún aviso: la medida nula del par P7-P8 es una marca de texto, no un aviso (R11) | Se muestran 3 tarjetas en este orden: 1) «Cambiar neumático en Delantera derecha» (retiro «Seguridad»), 2) «Medir primero Delantera izquierda» (el de dirección va antes que los demás retiros), 3) «Cambiar neumático en Eje 2 derecha interior» (retiro «Desgaste»); la rotación de P7 y P8 (con la marca «medida sin registrar») no cabe y sale como «1 sugerencia más»; «Medir primero» de dirección no queda fuera. Sin la fusión serían 5 sugerencias y «2 sugerencias más» |
| T35 | R3 | `direccion_retiro_mm` = 3,2; P1 con `mm1` = 2,8, `mm2` = 3,6, `mm3` = 3,5 (promedio 3,30) | Una tarjeta «Cambiar neumático en Delantera izquierda» (R3 y R7 fusionadas): la huella más baja (2,8) es menor o igual a 3,2 aunque el promedio no lo sea; con el promedio no habría retiro |
| T36 | R3 | Valor por defecto 5,0; P2 con `mm1` = 4,0, `mm2` = 6,0, `mm3` = 5,5 (promedio 5,17) | Una tarjeta «Cambiar neumático en Delantera derecha» (R3 y R7 fusionadas; 4,0 es menor o igual a 5,0); con el promedio no habría retiro |
| T37 | R3 | P2 con `mm1` = 5,1, `mm2` = 5,6, `mm3` = 5,3 | Sin retiro (la huella más baja, 5,1, supera 5,0) |
| T38 | R3 | P1 con `mm1` = 2,0, `mm2` nulo, `mm3` = 6,0 | `minimo` nulo: sin retiro ni rotación sobre P1; se muestra «Sin dato». La prueba falla si se implementa con `Math.min` o `least` sin comprobar nulos (daría 0 o 2,0) |
| T39 | R3 | P5 (no dirección) con `mm1` = 2,9, `mm2` = 4,0, `mm3` = 3,5 (promedio 3,47) y cliente sin recauchutado | «Cambiar neumático en Eje 2 derecha interior» (2,9 es menor o igual al retiro general de 3,0) |
| T40 | R1 | Como T10 tras la corrección de alineación: P1 con `mm1` = 11,4, `mm2` = 10,4, `mm3` = 8,9 (promedio 10,23; asimetría 2,5 mm, igual que antes) y P2 uniforme con 7,0 mm | Mismo resultado que T10: aviso R1 y rotación (3,23 mm) marcada; P1 no queda bloqueado |
| T41 | R0 | P1 medida hace 30 días y 12 horas (`dias_desde_medicion` = 30, `sin_medir` verdadero) | «Medir primero Delantera izquierda» (mismo criterio que la vista) |
| T42 | R2 | P1 y P2 de modelos distintos, uniformes con 10,0 y 7,0 mm (3,0 mm de diferencia, que con neumáticos iguales dispararía R2; P2 a 2,0 mm del retiro, R8.1 no suprime) | Sin sugerencia de rotación; aviso «Neumáticos distintos» (Datos) |
| T43 | R4 | P7 y P8 de modelos distintos, uniformes con 10,0 y 6,5 mm | «Neumáticos distintos en el par: medir el diámetro» en lugar de la regla por profundidad |
| T44 | R9 | P1 recauchutado (`vida` 1), uniforme con 10,0 mm y medición vigente, en un vehículo con servicio nulo | Misma sugerencia de retiro que T27 (se trata como bus) |
| T45 | R9 | Neumático recauchutado en el eje 1 de un camión con `direccion_camion_admite_recauchutada` falso, y luego verdadero | Falso: aviso «la política de la empresa no lo admite». Verdadero: sin aviso |
| T46 | R9 | Neumático con `condicion` = `reparado` en el eje 1 | Aviso «Reparado en dirección: confirmar que fue una sola reparación de clavo, sin reparación de talón» |
| T47 | Apta | Cubierta del stock `nuevo`, misma sucursal, sin medición | Apta para dirección |
| T48 | Apta | Cubierta `usado` con `vida` 0 y `minimo` 4,9 mm, y otra con 5,1 mm (`direccion_retiro_mm` = 5,0) | La de 4,9 no es apta (R3 la retiraría al montarla); la de 5,1 sí |
| T49 | Apta | Cubierta `recauchutado` (`vida` 1, `reranurado` falso) con las tres huellas en 9,0 mm (mayor que `direccion_retiro_mm`, para que solo decida la condición), en un bus, en un camión con el parámetro falso y en un camión con el parámetro verdadero | No apta, no apta, apta |
| T50 | Apta | Cubierta `usado` sin medición | No apta («Sin dato») |
| T51 | Apta | Cubierta `reparado`, uniforme con 9,0 mm (para que solo decida la condición), en un camión con `direccion_camion_admite_reparada` falso y luego verdadero | No apta; apta |
| T52 | Apta | Cubierta `usado` con `vida` 0, uniforme con 9,0 mm, medida registrada distinta a la de su compañera de eje (también con 9,0 mm); y otra igual (`usado`, `vida` 0, 9,0 mm) con medida nula, con una compañera de medida registrada | La primera no es apta; la segunda es apta con la marca «medida sin registrar» (sin aviso). En ambos casos la condición y la profundidad son aptas y solo decide la medida |
| T53 | R8 | P1 uniforme con 10,5 mm; P2 uniforme con 6,5 mm (4,0 mm de diferencia), sin tasa | Sin rotación: 6,5 − 5,0 = 1,5 mm, menos de 2 mm del retiro de dirección (con el umbral general de 3 mm serían 3,5 mm y no se suprimiría) |
| T54 | Reposición | Dirección: 1 neumático uniforme con 6,0 mm y tasa de 0,25 mm por semana, plazo de 4 semanas | Cuenta como demanda: (6,0 − 5,0) / 0,25 = 4 semanas, menor o igual que 4 (la vista diría 12) |
| T55 | Reposición | 3 neumáticos con `minimo` por encima del umbral y sin tasa válida | No se cuentan en la demanda; el texto informa «3 sin dato de desgaste» |
| T56 | Reposición | Un neumático con `minimo` por debajo del umbral de su posición y sin tasa | Cuenta como demanda (ya está en el retiro; no necesita tasa) |
| T57 | R3 | P5 `vida` 3 uniforme con 3,0 mm, cliente que recauchuta | «Cambiar neumático en Eje 2 derecha interior» (no recauchutar: carcasa agotada) |
| T58 | R9 y R11 | Bus; P1 y P2 recauchutados (`vida` 1, misma marca y modelo), uniformes con 10,0 y 7,0 mm y medición vigente (la diferencia de 3,0 mm cumpliría R2) | Solo dos sugerencias de retiro, ambas «Seguridad», en este orden (desempate por huella más baja): «Cambiar neumático en Delantera derecha: recauchutado en dirección, no admitido en buses.» (7,0 mm) y luego la misma para «Delantera izquierda» (10,0 mm); ningún «Rotar»: el retiro de R9 suprime la rotación (R11) |
| T59 | R3 y apta | Camión con la fila `vehiculo_ejes` del eje 1 en `traccion` (dato que la base rechazaría; el dominio lo recibe igual) o sin fila; P1 uniforme con 4,0 mm y P2 con 10,0 mm; en stock una `usado` con `vida` 0 y 9,0 mm y una `recauchutado` | Una tarjeta «Cambiar neumático en Delantera izquierda» (R3 y R7 fusionadas; 4,0 es menor o igual a `direccion_retiro_mm` 5,0; con `umbral_retiro_mm` 3,0 no habría retiro y bajo el piso legal de 3,2 mm podría quedar); sin rotación; la cubierta sugerida es la `usado`, no la recauchutada |
| T60 | R1 | P1 con `mm1` = 9,0, `mm2` = 8,0, `mm3` = 7,0 (asimetría exacta de 2,0 mm); luego con `mm3` = 6,9 (2,1 mm) | Con 2,0 mm: sin aviso de alineación («supera» es estricto, como `desgaste_irregular`); con 2,1 mm: aviso «Revisar alineación del eje 1» |
| T61 | R0 y R9 | Bus; P1 recauchutado (`vida` 1) montado a mano (evento `montaje`), sin ninguna medición (`ultima_medicion_at` nula, `sin_medir` verdadero); P2 nuevo, uniforme con 10,0 mm y medición vigente | Retiro de P1 «Cambiar neumático en Delantera izquierda: recauchutado en dirección, no admitido en buses.»; **sin** «Medir primero Delantera izquierda» (R0 no anula el retiro por norma); sin rotación |
| T62 | R0 y R9 | Igual que T61 pero P1 con la última medición hace 31 días (`sin_medir` verdadero) | Mismo resultado que T61 |
| T63 | R9 y R11 | Camión; P1 y P2 con `reranurado` verdadero (misma marca y modelo), uniformes con 10,0 y 7,0 mm y medición vigente (la diferencia de 3,0 mm cumpliría R2) | Dos sugerencias de retiro, ambas «Seguridad», en este orden (desempate por huella más baja): «Cambiar neumático en Delantera derecha: reranurado en dirección, no admitido en camiones de carga pesada (49 CFR 393.75(e)).» (7,0 mm) y luego la misma para «Delantera izquierda» (10,0 mm); ningún «Rotar» ni aviso de reranurado |
| T64 | R9 y R3 | Bus; P1 y P2 con `reranurado` nulo (la columna existe, el dato no está cargado), `nuevo`, uniformes con 10,0 y 7,0 mm y medición vigente | Sin retiro; dos avisos, uno por posición (Delantera izquierda y Delantera derecha), «Reranurado sin registrar en dirección: confirmar que no es reranurado» (Datos); la rotación de R2 se sugiere (3,0 mm de diferencia) |
| T65 | R2 y definiciones | Camión; P1 y P2 medidas (uniformes con 10,0 y 6,0 mm, medición vigente) sin fila en `neumaticos` | Sin retiro (6,0 es mayor que 5,0) ni rotación; aviso «Posición sin neumático registrado» (Datos) |
| T66 | R3 y definiciones | Camión; P1 medida uniforme con 4,0 mm sin fila en `neumaticos`; P2 `nuevo`, uniforme con 10,0 mm | Una tarjeta de retiro «Cambiar neumático en Delantera izquierda» (4,0 es menor o igual a 5,0; solo R3, porque R7 no evalúa una posición sin neumático registrado) con acción de montar; sin rotación; aviso «Posición sin neumático registrado» (Datos); R9 no evalúa P1 |
| T67 | R2 | P1 y P2 con `marca` nula en ambos y mismo `modelo` y `vida`, uniformes con 10,0 y 7,0 mm, medición vigente | Sin sugerencia de rotación; aviso «Neumáticos distintos» (Datos): nulo no es igual a nulo |
| T68 | R3, R7 y R11 | Camión; P2 uniforme con 4,6 mm y `apto_otra_posicion` nulo (R3 y R7 disparan sobre la misma posición); P1 sin ninguna medición; las demás posiciones vacías | Dos tarjetas: «Cambiar neumático en Delantera derecha» (una sola de retiro, R3 y R7 fusionadas, texto de R3, «Seguridad») y «Medir primero Delantera izquierda»; sin la línea «sugerencias más» (no sobra ninguna). Sin la fusión serían tres tarjetas |
| T69 | R9, R3, R7 y R11 | Bus; P1 recauchutado (`vida` 1), uniforme con 4,0 mm, medición vigente y `apto_otra_posicion` nulo (R9 por norma, R3 y R7 sobre la misma posición); P2 `nuevo` con la última medición hace 31 días | Dos tarjetas: «Cambiar neumático en Delantera izquierda: recauchutado en dirección, no admitido en buses.» (una sola de retiro; texto de R9 por norma, la de mayor prioridad) y «Medir primero Delantera derecha»; el «Medir primero» del eje 1 no queda fuera por el tope. Sin la fusión serían tres retiros sobre P1 y el «Medir primero» saldría como «1 sugerencia más» |
| T70 | R9 y R3 | P5 `vida` 1, uniforme con 2,9 mm (menor o igual a `umbral_retiro_mm` 3,0 y a `recauchutar_mm` 4,8), cliente que recauchuta; luego P5 `vida` 3 con los mismos 2,9 mm | `vida` 1: una sola tarjeta «Retirar Eje 2 derecha interior para recauchutado» (R9 y R3 disparan, se fusionan y prevalece R9); `vida` 3: «Cambiar neumático en Eje 2 derecha interior» (la carcasa no admite otra vida) |
| T71 | R9, R3 y reposición | `umbral_retiro_mm` = 4,0 y `recauchutar_mm` = 3,5 (válido: 4,0 es mayor que 0 y menor que `umbral_critico_mm`; 3,5 está en el rango), cliente que recauchuta; P5 `vida` 1 uniforme con 3,8 mm; luego con 3,4 mm; luego P5 `vida` 3 con 3,8 mm | `umbral_retiro_pos` de P5 = max(3,5; 4,0) = 4,0. `vida` 1 con 3,8 mm y con 3,4 mm: el mismo tipo de tarjeta y la misma regla (R9 para recauchutar); el texto muestra la huella de cada caso («Retirar Eje 2 derecha interior para recauchutado: queda 3,8 mm en la huella más baja (umbral 4,0 mm).» y la misma frase con 3,4 mm). R3 y R9 disparan, se fusionan y prevalece R9; nunca «Cambiar neumático» a 3,8 y «recauchutado» a 3,4. `vida` 3: «Cambiar neumático en Eje 2 derecha interior» (la carcasa no admite otra vida). Invariante: `umbral_retiro_pos` mayor o igual que `umbral_descarte_pos`; el test lo recorre con `umbral_retiro_mm` de 0,5 a 4,5 y `recauchutar_mm` de 3,5 a 8,0, en pasos de 0,1 mm. Sin el máximo, el caso de 3,8 mm daría R3 sin recauchutado (y, en el PR 7, sin reposición: T72) |
| T72 | Reposición | Misma configuración que T71 (`umbral_retiro_mm` = 4,0, `recauchutar_mm` = 3,5, cliente que recauchuta); P5 `vida` 1 uniforme con 3,8 mm; reposición sin tasa | El neumático de 3,8 mm cuenta como demanda (3,8 menor o igual a `umbral_retiro_pos` 4,0). Sin el máximo de `umbral_retiro_pos`, la reposición no lo contaría y habría tarjeta de retiro sin demanda. Es de la reposición y va en el PR 7 |

Además de los unitarios: una prueba e2e (`npm run e2e`) por cada nueva RPC y por cada tabla de parámetros, con el JWT de cada rol (admin, global, sucursal, sin perfil, `api`, y los roles que defina docs/17), según las reglas de [13](13-checklist-revision-prs.md).

Pruebas de escritura de datos nuevos (PR 2, 3, 5 y 6; SQL por rol en `tests/sql` y e2e contra PostgREST):

- Cada RPC de la sección 3.1 (`rotacion_configurar`, `vehiculo_configurar`, `neumatico_datos_editar`, la de «Ignorar») responde `42501` al equipo Neumet (`admin`), a `api`, a quien no tiene perfil y a otra empresa; el administrador de empresa escribe; el usuario de sucursal escribe solo donde la sección 3.1 lo permite (su sucursal) y recibe `42501` en otra sucursal y sobre el stock.
- Cada RPC rechaza valores fuera de dominio: servicio distinto de `bus` o `camion`, rol `direccion` fuera del eje 1, eje 1 con otro rol, eje menor que 1 (`check`), parámetros fuera de rango.
- Por PostgREST con el JWT de cada rol, un `PATCH` o `POST` directo sobre `vehiculo_ejes`, `rotacion_parametros`, `rotacion_sugerencias_ignoradas` y sobre las columnas nuevas de `vehiculos` y `neumaticos` falla (sin grant; con el admin también, en las tablas nuevas, y en `vehiculos` y `neumaticos` una vez aplicada C2).
- La prueba de C2 generada desde el catálogo (docs/17, sección 4.1) pasa con las tablas de F8 presentes; el ajuste de `t_90` cubre cada columna nueva de `neumaticos` con `grant select`. La prueba de catálogo de la matriz por rol de docs/17 (sección 10, `t_93`, entra con la migración A; generada desde `pg_proc`) exige que toda función `SECURITY DEFINER` con `execute` para `authenticated` figure en un grupo: las RPC de F8 (`rotacion_configurar`, `vehiculo_configurar`, `neumatico_datos_editar`, la de «Ignorar» y `neumatico_rotar_varias`) deben quedar clasificadas en el grupo «sin rama de admin». Prueba propia de F8, no atribuida a docs/17: el cuerpo de cada una no contiene `is_admin()` ni `rol = 'admin'`; la cubre el `42501` que recibe el admin en la primera viñeta de esta sección.
- `neumatico_datos_editar` escribe en `audit_log` el valor anterior, el nuevo y el actor; la prueba SQL comprueba la fila tras un cambio de `reranurado` hecho por un usuario de sucursal, y que un cambio con valores anteriores desactualizados se rechaza.

## 9. Plan de implementación (histórico; el backlog vigente está en el apartado 0.2)

PR chicos y en serie, cada uno con su verificación. Nunca dos migraciones en producción a la vez.

| # | Contenido | Migración | Notas |
|---|---|---|---|
| 1 | Dominio puro `rotacion.js` y `esAptaDireccion`; tests T01 a T29 (incluidos R9 y R10), T33 a T53 y T57 a T71 (T71 sin la parte de reposición), con eje 1 como dirección, el resto sin clasificar y servicio por defecto bus | No | Sin interfaz; se puede revisar solo |
| 2 | Parámetros por cliente: tabla `rotacion_parametros` y RPC `rotacion_configurar`; formulario de «Parámetros de rotación» (sección 9.1) | Sí | Idempotente, `check` por rango; apéndice nuevo en [08](08-esquema-datos.md); prueba SQL por rol |
| 3 | Datos del modelo: `vehiculo_ejes`, `vehiculos.servicio`, `neumaticos.medida`, `apto_otra_posicion`, `reranurado` (con `grant select` por columna y ajuste de `t_90`), lectura en `v_estado_neumaticos` si se justifica; **escritura solo por las RPC `vehiculo_configurar` y `neumatico_datos_editar`** (sección 3.1), con formulario en la ficha del vehículo y del neumático | Sí | Antes de aplicar, el director consulta a `neumet-dba` por la vista. Pruebas SQL y e2e por rol de la sección 8 |
| 4 | Vista: tarjeta de sugerencias en la ficha y «Registrar rotación» con `neumatico_rotar`; clics contados en el PR; «Cambiar neumático» con el formulario prellenado con una cubierta apta (sección 4) | No | Sin «Ignorar» ni rotación en cruz |
| 5 | «Ignorar hasta la próxima medición»: tabla `rotacion_sugerencias_ignoradas` y RPC | Sí | Solo si el dueño lo confirma (pregunta 10) |
| 6 | `neumatico_rotar_varias` (rotación atómica de varios pares) y acción de R5 y R6 | Sí | Pruebas SQL y e2e por rol; sin rama de escritura para el equipo Neumet |
| 7 | Dominio de reposición, tests T30 a T32, T54 a T56 y T72 y vista de sugerencia de compra | No (usa los parámetros del PR 2) | Requiere medida del PR 3 para agrupar por medida |

Cada PR de este plan actualiza en el mismo PR el apéndice de [08](08-esquema-datos.md) que corresponda y el tablero [10](10-tablero.md).

### 9.1 Parámetros por cliente y orden respecto de docs/17

**Dónde viven los parámetros.** En una tabla propia `rotacion_parametros (cliente_id primary key, ...)`, no en columnas nuevas de `clientes`. Es lo más simple y compatible con el plan de roles de docs/17: la migración C2 de ese plan revoca `select` y `update` de tabla sobre `clientes`, otorga por columna y exige un test que falle si queda una columna sin otorgar; cada columna nueva de `clientes` tendría que entrar en esa lista y en la RPC `alerta_configurar`. Una tabla nueva no toca `clientes` ni a C2.

**Parámetros del PR 2.** Columnas de `rotacion_parametros`; sin fila rigen los valores por defecto. Los tres umbrales que ya existen en `clientes` (`umbral_retiro_mm`, `dias_sin_medir_alerta`, `irregularidad_mm`) no se mueven.

| Parámetro | Defecto | Rango | Regla |
|---|---|---|---|
| `rotacion_direccion_dif_mm` | 3,0 | 2,0 a 5,0 | R2 |
| `rotacion_traccion_dif_mm` | 3,0 | 2,0 a 5,0 | R5 |
| `rotacion_arrastre_dif_mm` | 3,0 | 2,0 a 5,0 | R6 |
| `rotacion_arrastre_activa` (interruptor de R6) | falso | verdadero o falso | R6 |
| `rotacion_dual_max_mm` | 3,0 | 2,0 a 4,0 | R4 |
| `rotacion_presion_dif_mm` | 2,0 | 1,0 a 4,0 | R1 |
| `rotacion_espera_semanas` | 4 | 0 a 12 | R8.1 |
| `rotacion_espera_dias` | 30 | 7 a 90 | R8.2 |
| `rotacion_recordatorio_dias` | nulo (sin recordatorio) | 30 a 365 | R10 |
| `direccion_retiro_mm` | 5,0 | 3,2 a 8,0 | R3 |
| `recauchuta` (el cliente recauchuta) | falso | verdadero o falso | R9 |
| `recauchutar_mm` | 4,8 | 3,5 a 8,0 | R9 |
| `direccion_camion_admite_recauchutada` | falso | verdadero o falso | R9, cubierta apta |
| `direccion_camion_admite_reparada` | falso | verdadero o falso | R9, cubierta apta |
| `reposicion_plazo_semanas` | 4 | 1 a 26 | Reposición |
| `reposicion_seguridad_pct` | 10 | 0 a 30 | Reposición |

`rotacion_umbral_mm` no se crea (sección 2.2). Lectura: la fila de su empresa la lee el administrador de empresa **y el usuario de sucursal** (RLS por `cliente_id`, sin filtro de sucursal, porque el dominio necesita los valores para mostrar las sugerencias); `api` no la lee; el equipo Neumet lee todas.

**Cómo se escriben.** Solo por una RPC `rotacion_configurar(p_cliente_id, ...)`, `SECURITY DEFINER` con `search_path` vacío: sin privilegios de escritura de tabla para `authenticated` (el `update` directo que hoy hace `ficha-cliente.js` sobre `clientes` no se replica). La RPC autoriza al **administrador de empresa**, hoy el perfil `cliente` sin sucursal (que docs/17 llama «perfil global») y combina `current_sucursal_id()` con `current_cliente_id()` como exige la regla de la sección 8 de ese documento. Rechaza con `42501` al equipo Neumet (que solo mira, P1 de docs/17), al usuario de sucursal, a `api` y a quien no tiene perfil. La lectura queda con RLS por cliente (el equipo Neumet lee todas; cada empresa, la suya, incluido el usuario de sucursal; `api` no). Sin fila, el dominio usa los valores por defecto de la sección 4.

**Dónde se editan.** En un formulario «Parámetros de rotación» visible solo para el administrador de empresa, en el menú «Empresa» de docs/17, junto a Umbrales (el nivel crítico ya no se edita en la vista de alertas desde el PR 9c). No se agrega a la ficha de cliente.

**Orden respecto de docs/17.** F8 es prioridad fuerte (tablero [10](10-tablero.md)) y docs/17 (plan fusionado en `main`, PR 72) está en curso (F10; migraciones A, B, C1 y C2 ya aplicadas): el estado de sus migraciones está en el tablero [10](10-tablero.md). En producción hay una sola migración a la vez, en serie, en cualquier orden entre las migraciones de F8 (PR 2, 3, 5, 6) y las de docs/17 (A, B, C1, C2): ninguna depende de otra, salvo lo siguiente.

| Punto de contacto | Regla |
|---|---|
| F8 PR 2 (`rotacion_configurar`) y migración A de docs/17 (`admin_empresa_cliente_id()`) | Depende de cuál se aplica primero. **Si A ya está aplicada** cuando se escribe F8 PR 2: `rotacion_configurar` usa `admin_empresa_cliente_id()` directamente (se sabe porque la migración A está en `main` y aplicada según `docs/10`), y no se toca docs/17 sección 2.2: la RPC usa el helper y no copia la regla. **Si A no está aplicada**: F8 PR 2 no espera a A y usa la regla inline («perfil `cliente` sin sucursal»), una copia más de la regla «global» que docs/17 sección 2.2 enumera y quiere centralizar; en ese caso F8 PR 2 agrega `rotacion_configurar` a la lista de RPC con la regla copiada de esa sección (edita solo esa línea), y el **PR que implemente la migración A de docs/17** (PR 2 del plan de roles) la quita de la lista al reemplazar el cuerpo de `rotacion_configurar` por `admin_empresa_cliente_id()`. El brief del PR de A cita este punto; el director asigna la tarea a quien llegue segundo |
| F8 PR 3 y PR 5 (tablas y columnas nuevas) y C2 | **Sí se tocan**: C2 (docs/17, sección 4.1) hace `revoke insert, update, delete` sobre nueve tablas, entre ellas `vehiculos` y `neumaticos`, además de recortar ramas `is_admin()` de escritura de RPC operativas y de generar desde el catálogo una prueba que falla si cualquier tabla de `public`, nueva o no, tiene escritura para `authenticated` o una política de escritura con `is_admin()`. Consecuencia para F8: sus columnas y tablas nuevas **no se escriben nunca por PostgREST**; se escriben solo por las RPC de la sección 3.1, que nacen sin rama `is_admin()` (P1), y las tablas nuevas nacen sin grant de escritura. Con eso la prueba de escritura de C2 pasa con las tablas de F8 en cualquiera de los dos órdenes. **El orden no es indiferente en un punto**: las RPC de F8 son `SECURITY DEFINER` con `execute` para `authenticated`, y la prueba de catálogo de docs/17 sección 10 exige clasificar cada una en el grupo «sin rama de admin» (docs/17 sección 4.1 lo prevé para las de otros planes). Quien llegue segundo respecto de la prueba de catálogo (`t_93`, que entra en el PR 2 de docs/17, migración A) hace la clasificación: si esa prueba ya está, el PR de F8 que crea la RPC agrega su nombre al grupo en el mismo PR; si F8 va primero, docs/17 agrega las RPC de F8 ya existentes a su lista al introducir la prueba |
| F8 PR 4 y PR 6 («Registrar rotación», `neumatico_rotar_varias`) y C2 | Mientras C2 no esté aplicada, `neumatico_rotar` autoriza al `admin`; el botón se oculta al equipo Neumet desde el PR 4 para no depender del orden, y `neumatico_rotar_varias` nace sin rama de admin |
| Timestamps de migración | La siguiente migración en cola usa un timestamp posterior a la última aplicada, sea de F8 o de docs/17; el director no lanza un PR con migración mientras otro siga sin aplicar y verificar |
| `docs/README.md` y `docs/10` | Este PR (propuesta) agrega la entrada de este documento a `docs/README.md` y enlaza esta propuesta en la fila de F8 de `docs/10`, además de enlazarla en `docs/16` y `docs/15`; los cambios futuros de ambos planes (F8 y docs/17) sobre esos archivos se resuelven al fusionar el segundo |

## 10. Preguntas para el dueño

Solo de lógica de negocio; lo técnico queda resuelto arriba, con el valor conservador que se usa mientras no haya respuesta.

1. **Política de retiro de direccionales** (respondida en [23](23-reglas-negocio.md), RN-02 y RN-08: «Pasar atrás» a 8 mm o menos, «Pasar atrás ya» bajo 6 mm, retiro general a 3 mm; el valor de 5,0 mm de abajo queda superado): ¿a cuántos milímetros se retiran hoy en los camiones y en los buses? El valor por defecto propuesto es 5,0 mm medidos en la huella más baja, con piso de 3,2 mm.
2. **País o norma aplicable:** ¿en qué país operan los clientes con flota pesada y qué profundidad mínima legal exige la inspección? Los pisos legales verificados son de EE. UU.; México y Brasil se encontraron solo en resúmenes y Chile y Argentina no tienen un valor oficial hallado para pesados.
3. **Recauchutado:** ¿los clientes recauchutan, en qué posiciones lo permiten (fuera de dirección) y cuántas vidas de carcasa admiten?
4. **Intervalos actuales:** ¿cada cuánto rotan hoy y quién lo decide (taller propio o externo)? Sirve para fijar el recordatorio y para medir si la sugerencia mejora algo.
5. **Reposición:** ¿cuál es el plazo real de entrega de neumáticos y cuánta reserva de seguridad toleran en dinero o en unidades?
6. **Buses:** ¿los buses de pasajeros llevan ruedas simples adelante y duales atrás en todos los casos (un bus de 2 ejes tiene 2 ruedas simples adelante y 4 duales atrás: 6 ruedas)? ¿Hay buses de tres ejes? ¿Los buses de dos ejes se cargan hoy como camión de 10 ruedas con el eje 3 vacío? ¿Hay vehículos con más de un eje direccional (p. ej. un 8x4) o buses con eje de cola direccional? El diseño solo admite dirección en el eje 1 (sección 3); con respuesta afirmativa el rol dirección dejaría de ser fijo.
7. **Quién edita y quién registra:** ¿qué rol edita los parámetros de rotación y los datos del vehículo y del neumático (servicio, ejes, medida, reranurado, aptitud), y quién puede pulsar «Registrar rotación»? Valor mientras tanto (sección 3.1): el administrador de empresa edita los parámetros, el servicio y los ejes; edita los datos del neumático junto con el usuario de sucursal (solo montados en su sucursal); registran la rotación el administrador de empresa y el usuario de sucursal de su sucursal; el equipo Neumet solo mira (enlaza con P1 de docs/17). Como el usuario de sucursal puede editar `reranurado` y `neumaticos` no tiene auditoría de tabla, `neumatico_datos_editar` registra en `audit_log` el valor anterior, el nuevo y el actor (sección 3.1): de lo contrario esa edición borraría sin rastro un retiro por norma. La edición compara los valores anteriores para que dos editores no se pisen; si el dueño prefiere que `reranurado` solo lo edite el administrador de empresa, se acota en la RPC.
8. **Bus o camión por vehículo:** ¿se marca cada vehículo como bus o camión al darlo de alta? Valor mientras tanto: un vehículo sin marcar se trata como bus (el valor prudente), lo que puede generar avisos de más sobre camiones que lleven recauchutados adelante.
9. **Direccionales reparadas, recauchutadas o reranuradas en camiones:** ¿se permite montar en dirección neumáticos reparados, recauchutados o reranurados en camiones? Valor mientras tanto: no se permiten ni se ofrecen (en buses los recauchutados y reranurados quedan prohibidos por la norma de EE. UU. citada, sin parámetro).
10. **«Ignorar» una sugerencia:** ¿debe pedir un motivo? Valor mientras tanto: no pide motivo y oculta la sugerencia hasta la próxima medición; la decisión define si el PR 5 guarda el motivo.
11. **Recauchutado o reranurado en ruedas delanteras de un bus:** ¿se impide montarlo (el formulario lo rechaza) o basta con avisar y sugerir su retiro? Valor mientras tanto: solo se avisa y se sugiere el retiro, sin bloquear en el formulario ni en la base, porque el sistema no conoce la situación legal del cliente.

## 11. Fuentes

Consultadas el 2026-11-13. Se parafrasea; las cifras se contrastaron con al menos dos fuentes en las reglas importantes. «Abierta» significa que se leyó la página completa; «resumen» que solo se vio el extracto del buscador.

| N.º | Fuente | Tipo | Estado |
|---|---|---|---|
| 1 | Michelin Reino Unido, [Truck tyre rotation](https://business.michelin.co.uk/help-advice/truck/tyre-maintenance-truck-tyre-rotation); página general (no específica de dirección), publicada el 2026-08-20 y actualizada el 2026-11-09 | Fabricante | Abierta |
| 2 | eCFR, [49 CFR 393.75](https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-49?part=393&section=393.75) | Norma de EE. UU. | Abierta; texto vigente releído el 2026-11-13 |
| 3 | School Bus Fleet, [Tire maintenance best practices](https://www.schoolbusfleet.com/10010314/tire-maintenance-best-practices) | Prensa de buses | Abierta |
| 4 | Transit RFTA (dirección a 6/32, tracción o tag a 4/32) | Operador de buses | Resumen |
| 5 | Michelin EE. UU., [Uneven commercial truck tire wear](https://business.michelinman.com/tips-suggestions/truck/uneven-commercial-truck-tire-wear) | Fabricante | Abierta |
| 6 | heavyvehicleinspection, [Tire wear pattern diagnosis](https://heavyvehicleinspection.com/article/tire-wear-pattern-diagnosis-alignment-fleet) | Sitio comercial | Abierta |
| 7 | Transport Engineer (Reino Unido), D. Parton, 2019-03-07, [Tyre rotation for commercial vehicles](https://www.transportengineer.org.uk/content/features/tyre-rotation-for-commercial-vehicles) | Prensa; cita a Michelin, Goodyear, Continental | Abierta; relectura del 2026-11-13 para las citas de Goodyear |
| 8 | FleetOwner, Rohlwing (TIA), [Playing matchmaker](https://www.fleetowner.com/equipment/article/21687894/playing-matchmaker), 2014 | Prensa y asociación | Abierta |
| 9 | School Bus Fleet (misma de la fuente 3) para duales de bus | Prensa de buses | Abierta |
| 10 | Goodyear Europa, [Steer, drive, trailer](https://www.goodyear.eu/en_gb/truck/knowledge-centre/truck-tyre-types-steer-drive-trailer.html) | Fabricante | Abierta |
| 11 | Modern Tire Dealer, B. Ulrich, 2010-09-15, [Retreads on steer axles](https://www.moderntiredealer.com/articles/29202-the-myth-behind-using-retreads-on-steer-axles). Dice que las prácticas recomendadas de la industria excluyen de la dirección de un camión de larga distancia un neumático «previously retreaded»; que las normas federales no prohíben la reparación de agujero de clavo en la banda de un neumático de dirección y la industria admite solo una por neumático; y que ninguna reparación de talón es aceptable. Michelin dice no recomendar recauchutados de dirección en larga distancia y Goodyear que no es una práctica extendida | Prensa | Abierta; relectura del 2026-11-13 |
| 12 | Overdrive, «Tire rotation» y «Stop and swap» (la primera ya citada en [15](15-rotacion-alertas-rendimiento.md)) | Prensa de transporte | Solo resumen: la página devolvió 403 |
| 13 | Bridgestone Costa Rica (autos), Toyo, Bridgestone: citas por resumen del buscador | Fabricantes | Resumen |
| 14 | TRIB, vía Tire Review ([15](15-rotacion-alertas-rendimiento.md) cita la página `?p=59825`) | Asociación | Resumen: 403 |
| 15 | 91trucks, blog de intervalos | Blog comercial | Abierta; baja fiabilidad |
| 16 | heavyvehicleinspection, fórmulas de reposición min-max | Sitio comercial | Abierta |

No se pudieron abrir: Overdrive (403), Tire Review (403), Fleet Equipment (403), BusMARC, USTMA (PDF), la página de Continental Reino Unido (solo navegación) y el PDF de la NOM-068-SCT-2-2014 de México (ilegible). No se halló el texto de la práctica recomendada TMC RP 235; solo se cita de forma indirecta.

Normas de profundidad mínima y de uso:

- EE. UU. (FMCSA, 49 CFR 393.75, fuente 2, verificada): (a) ninguna llanta con telas o cinturones expuestos, separación de banda o flanco, fuga audible o corte que exponga telas; (b) 4/32 de pulgada (3,2 mm) en cualquier punto de una ranura principal, lejos de puentes y abultamientos, en las ruedas delanteras de un bus, camión o tractocamión; (c) 2/32 (1,6 mm) en el resto; (d) un bus no puede operar con neumáticos reranurados, recauchutados o reencauchados en las ruedas delanteras; (e) un neumático reranurado con capacidad de carga de 2.232 kg (4.920 lb) o más no puede usarse en las ruedas delanteras de un camión o tractocamión.
- México (NOM-068-SCT-2-2014): 3,2 mm en dirección o remolque de materiales peligrosos y 1,6 mm en ejes sin dirección. **Sin verificar**: solo resumen del buscador.
- Brasil (Resolución CONTRAN 913/2022): 1,6 mm general y prohibición de reformados en el eje delantero de buses. **Sin verificar**: solo resumen del buscador.
- Chile y Argentina: no se halló valor oficial para vehículos pesados.

Ningún país se asume: el umbral queda configurable y es una pregunta al dueño. Lo único que se fija sin pregunta es el valor prudente: bus ante la duda y sin recauchutados adelante en bus.

### Reglas de menor confianza

R6 (arrastre: una sola fuente), R5 (cruce de lados: cifras de resúmenes), R9 (valor de retiro para recauchutar y capacidad de carga de camión), R10 (sin consenso de intervalos), R3 (valor por defecto), el horizonte de retiro por la tasa del promedio y los valores por defecto de la reposición.
