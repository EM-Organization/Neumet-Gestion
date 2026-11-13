# 18 · Rotación y reposición para vehículos pesados

Investigación y propuesta de diseño de la fase F8 de [16](16-hoja-de-ruta.md): sugerencia de rotación y reposición de neumáticos para camiones y buses de pasajeros. Es un documento de propuesta: no cambia código, migraciones ni interfaz. Complementa y precisa la sección A de [15](15-rotacion-alertas-rendimiento.md), pensada para un caso más simple; la sección 2.2 dice qué decisiones de [15](15-rotacion-alertas-rendimiento.md) quedan reemplazadas y cuáles se conservan.

Fecha de consulta de todas las fuentes externas: 2026-11-13. Las afirmaciones sobre el repositorio llevan `archivo:línea` y se comprobaron sobre `main` en esa fecha. NEUMET sugiere; no certifica el cumplimiento de ninguna norma.

Principios que rigen el diseño ([16](16-hoja-de-ruta.md)): dato no medido es nulo, nunca cero; reglas interpretables, sin machine learning; el operario ve una acción simple, no una teoría.

## 1. Resumen para el dueño

1. La sugerencia dirá qué rotar o cambiar y por qué, en una frase, en la ficha del vehículo. Nunca ejecuta nada sola, y no reemplaza la inspección visual (cortes, telas expuestas y separaciones no se miden).
2. No hay una regla única en la industria. Los fabricantes coinciden en lo esencial y discrepan en las cifras, así que todo umbral será configurable por cliente, con un valor por defecto razonable.
3. Rotar no corrige la causa de un desgaste irregular (alineación, presión). La sugerencia siempre lo advierte y pide revisar la causa, pero no bloquea la rotación: según Goodyear, el desgaste irregular ya instalado continúa aunque se corrija la causa, así que esperar solo lo agrava.
4. Direccionales: cuidado máximo. El retiro se mide en la huella más baja, no en el promedio, porque la norma de EE. UU. lo mide en cualquier punto de una ranura principal. Se cambian antes que el resto y, en buses, no se montan recauchutados adelante (49 CFR 393.75(d)). Mientras no se sepa si un vehículo es bus o camión, se trata como bus.
5. Duales: los dos neumáticos de un par deben tener profundidad parecida; si no, el más gastado recibe la carga y se destruye antes.
6. Sin medición reciente no se sugiere nada: se pide medir primero.
7. El modelo actual no sabe qué eje es de dirección, tracción o arrastre, si el vehículo es bus o camión, ni la medida de cada neumático. Eso hay que agregarlo antes de que la sugerencia sea completa (sección 3).
8. Se propone entregar en siete PR chicos y en serie; cuatro llevan migración (sección 9).
9. La reposición sugiere cuántas cubiertas comprar por medida a partir de lo que se retirará durante el plazo de entrega, con el umbral de retiro de cada posición; los neumáticos sin tasa de desgaste se informan como «sin dato», no se cuentan como «no se retiran». El cliente decide.
10. Hay diez preguntas de negocio para el dueño (sección 10). Todo lo técnico lo resuelve este documento con una recomendación.

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
| Umbrales por cliente (bajo 8, crítico 5, retiro 3) | Sí | `supabase/migrations/20261116000000_calidad_datos.sql:477`; valores por defecto en `assets/js/domain/vehiculo-diagrama.js:110` |
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
| `rotacion_dual_max_mm` (3,0) y `rotacion_espera_dias` (30) | A.3 | Se conservan con el mismo valor | Conservada |
| Agrupar por clase | Dirección (eje 1) y «tracción y remolque» juntos | Dirección, tracción y arrastre por rol de eje; sin rol configurado se emite solo lo del eje 1 y los duales | Reemplazada |
| Tipo de eje: columna `vehiculos.ejes_config` o por eje (A.4, TODO) | Sin definir | Tabla `vehiculo_ejes` (sección 3) | Reemplazada |
| Dual: rotar interna con externa | A.3 | R4 aclara que no cierra la diferencia de diámetro; busca un intercambio en el mismo eje y, si no existe, un cambio con stock | Reemplazada |
| Salvaguarda de causa: la sugerencia lleva la frase «Revisar alineación y presión antes de rotar» | A.3, paso 7 | **Se conserva**: R1 pasa a ser aviso y marca, no bloqueo | Conservada |
| Candidatas: solo con medición vigente (`sin_medir = false`) | A.3, paso 1 | R0 usa el mismo criterio que la vista | Conservada |
| Pasar una direccional a tracción: no se recomienda | A.4 | R7, con el dato `apto_otra_posicion` | Conservada |
| Medida del neumático y no mezclar medidas | A.4, TODO | Sección 3 | Conservada |
| Proyección a 4 semanas (sugerencia preventiva) | A.4, TODO | No se usa; el desempate por tasa queda fuera de F8 | Sigue pendiente |

## 3. Datos que faltan y qué agregar

| Dato | Para qué | Propuesta | ¿Migración? |
|---|---|---|---|
| Rol de cada eje: `direccion`, `traccion`, `arrastre` | Todas las reglas por tipo de eje | Tabla `vehiculo_ejes (vehiculo_id, eje, rol)`; sin fila, se asume eje 1 dirección y los demás sin clasificar | Sí |
| Servicio del vehículo: bus o camión | Reglas de dirección de bus (R9) | Columna `vehiculos.servicio text` con `check (servicio in ('bus', 'camion'))`; **nulo = no se sabe y se trata como bus** (el valor prudente). Se guarda por vehículo, no por eje: no tiene sentido un eje de bus y otro de camión en la misma unidad. Mientras la columna no exista, el dominio recibe el servicio como opción y por defecto asume bus | Sí |
| Tipo de eje simple o dual | Reglas de duales | Se deriva de la posición (`ejeDePosicion`), no se guarda | No |
| Medida del neumático | No mezclar medidas en un par dual ni al reponer | `neumaticos.medida text`, nulo si no se conoce; la regla de duales y la reposición la ignoran si es nula y lo declaran | Sí |
| Aptitud por posición (p. ej. direccional apta para tracción por aprobación del fabricante) | Evitar pasar una direccional a tracción sin permiso | `neumaticos.apto_otra_posicion boolean` nulo = no se sabe, se trata como no apto | Sí (junto a la medida) |
| Reranurado | 393.75(d) y (e): ningún reranurado adelante en un bus, ni uno de 2.232 kg (4.920 lb) o más en un camión | `neumaticos.reranurado boolean`, nulo = no se sabe. Sin el dato, el sistema no puede detectar un reranurado; el aviso de la sección 6 lo declara | Sí (junto a la medida) |
| Privilegios de las columnas nuevas de `neumaticos` | `neumaticos` tiene privilegios por columna desde la migración de precios | Cada columna nueva exige `grant select (col)` y el test `t_90` falla si queda una sin otorgar (contrato de `supabase/migrations/20261116500000_privilegios_precios.sql:25-26`) | Sí, en la misma migración |
| Parámetros de rotación por cliente | Umbrales configurables | **Tabla propia `rotacion_parametros (cliente_id, ...)`**, no columnas de `clientes`; se escribe solo por la RPC `rotacion_configurar` (sección 9.1). Sin fila, el dominio usa los valores por defecto | Sí |
| Persistencia de «Ignorar» | Ocultar una sugerencia hasta la próxima medición | Tabla `rotacion_sugerencias_ignoradas (vehiculo_id, regla, posiciones, medicion_ref, user_id, created_at)` y una RPC que la escribe; sin ella «Ignorar» no se puede ofrecer (sección 7) | Sí, PR 5 |
| Kilómetros en cada rotación | Intervalo por km | Pasar el odómetro cuando el operario lo conoce; hoy se envía nulo. No se precompleta jamás ([14](14-guia-de-textos.md) sección 5) | No |
| Rotación en cruz atómica | Rotar 3 o más posiciones sin estados intermedios | RPC `neumatico_rotar_varias(vehículo, pares[])` que reutiliza las guardias de `neumatico_rotar`. El nombre evita «permutar», término que la guía de textos no admite | Sí |
| Interpretación de ejes extra (posiciones 17 a 98) | Camiones de más de 16 ruedas | Permitir montarlos con `neumatico_montar`; no es requisito de la primera entrega | Sí, aparte |

Recomendación: no bloquear la primera entrega por estos datos. El PR de dominio (sección 9) funciona con lo que hay (eje 1 como dirección, resto sin clasificar, vehículo tratado como bus) y las reglas que dependen del rol se activan cuando el cliente lo configura.

## 4. Reglas propuestas

Convenciones: las profundidades son promedios por posición (`promedio`) salvo que la regla diga lo contrario; «diferencia» es un valor absoluto en milímetros y se compara en décimas de milímetro enteras para evitar errores de coma flotante; los parámetros viven por cliente, con rango permitido. Todas las reglas de umbral comparan con «mayor o igual» (o «menor o igual» en los retiros): el umbral es el primer valor que dispara la sugerencia. Los textos están en el estilo de [14](14-guia-de-textos.md): infinitivo, sin emojis, con la regla aplicada en una frase y nombres de posición («Delantera izquierda», «Eje 3 derecha interior») en lugar de «P1, P2»; las huellas se llaman «interna», «central» y «externa». Los números de posición («P1») solo aparecen en la tabla de pruebas. Las fuentes se numeran en la sección 11.

Equivalencias usadas: 2/32 de pulgada = 1,6 mm; 3/32 = 2,4 mm; 4/32 = 3,2 mm; 6/32 = 4,8 mm.

### Definiciones comunes

- **Nombres de posición** (`assets/js/domain/posicion.js`, `nombrePosicion`): P1 Delantera izquierda; P2 Delantera derecha; P3 Eje 2 izquierda exterior; P4 Eje 2 izquierda interior; P5 Eje 2 derecha interior; P6 Eje 2 derecha exterior; P7 y P8 las dos del eje 3 izquierdo (exterior e interior); P9 y P10 las del eje 3 derecho (interior y exterior). «Interior» y «exterior» nombran la rueda de un dual; «interna», «central» y «externa» nombran la huella de la banda.
- **Huella más baja** (`minimo`): el menor de `mm1`, `mm2` y `mm3`. Se calcula solo si las tres huellas están medidas; si falta una, `minimo` es nulo (dato no medido, nunca cero) y la posición queda «Sin dato». Cuidado al implementarlo: `Math.min(null, 4)` da 0 y `least()` de SQL ignora los nulos; ambos producirían un mínimo falso. Hay que comprobar los tres valores de forma explícita (T38).
- **Rol dirección:** el eje 1 mientras no exista `vehiculo_ejes`; después, el eje con rol dirección.
- **Servicio:** `bus` o `camion`; nulo se trata como `bus`.
- **Umbral de retiro de la posición** (`umbral_retiro_pos`): en un eje de dirección, `direccion_retiro_mm` (R3); en otra posición de un cliente que recauchuta y con `vida` menor que 3, `recauchutar_mm` (R9); en cualquier otra, `umbral_retiro_mm` (3 mm por defecto, ya existente). Lo usan R3, R8, R9 y la reposición.
- **Semanas hasta el retiro de la posición:** `max(0, minimo − umbral_retiro_pos) / tasa_mm_semana`, con la `tasa_mm_semana` de la vista (la tasa del promedio) y nula si no hay tasa válida o si `minimo` es nulo. No es la columna `semanas_hasta_retiro` de la vista, que usa el promedio y el umbral general (`supabase/migrations/20261116000000_calidad_datos.sql:610`). Se recalcula en el dominio con los datos de la vista; no hace falta cambiar la vista en F8. Aproximación declarada: la tasa del promedio puede subestimar la de la huella más baja cuando hay desgaste irregular, así que el horizonte tiende a ser optimista. Confianza media-baja; una función de base con la tasa por huella sería un PR futuro que pasaría por `neumet-dba`.
- **Cubierta apta** (para cualquier reposición o cambio): en stock (`estado = 'almacenado'`), en la sucursal del vehículo, sin baja y fuera de proceso de recauchutado.
- **Cubierta apta para dirección** (la usan R3, R7 y el formulario prellenado de la sección 7). Es apta, y además:
  1. `condicion` es `nuevo` o `usado` con `vida = 0`. Una `recauchutado` (o con `vida` mayor que 0) no es apta si el vehículo es bus o su servicio se desconoce (49 CFR 393.75(d), fuente 2); en un camión no es apta salvo que el parámetro `direccion_camion_admite_recauchutada` sea verdadero (falso por defecto, pregunta 9). Una `reparado` no es apta salvo que `direccion_camion_admite_reparada` sea verdadero (falso por defecto, pregunta 9; solo camiones, en bus tampoco se ofrece).
  2. `reranurado` no es verdadero. Con `reranurado` nulo se avisa «reranurado sin registrar» y la cubierta sigue siendo apta, porque el dato aún no existe (sección 3).
  3. Tiene profundidad conocida: una cubierta `nuevo` se acepta sin medir; las demás necesitan una medición con las tres huellas, y su `minimo` debe ser mayor que `direccion_retiro_mm`. Sin dato no es apta (nulo, nunca cero).
  4. Si ella y su compañera de eje tienen `medida` registrada y distinta, no es apta; si alguna es nula, se avisa «medida sin registrar».
  5. Entre dos aptas se prefiere la de misma marca y modelo que la compañera de eje; no es exigencia.
  El formulario no se bloquea en la base: el operario puede elegir otra cubierta, y la lista la muestra con el motivo («No apta en dirección: recauchutada»).

### R0 · Medir primero (precondición de todas)

- **Condición:** alguna posición involucrada tiene `ultima_medicion_at` nula o `sin_medir` verdadero en la vista. Es el mismo criterio de la vista (`ultima_at < now() − dias_sin_medir_alerta`, comparación exacta de fecha y hora), no `dias_desde_medicion`, que usa `floor`: una medición de 30 días y 12 horas tiene `dias_desde_medicion = 30` pero `sin_medir = true`. Las mediciones invalidadas ya no cuentan en la vista (`calidad <> 'invalidada'`), así que se aplica R0 si no queda otra válida.
- **Parámetro:** el que ya existe, `dias_sin_medir_alerta` (30 por defecto, `supabase/migrations/20261116000000_calidad_datos.sql:477`). No se crea un parámetro nuevo: una sola definición de «medición vencida» en todo el producto.
- **Texto:** «Medir primero Delantera izquierda: la última medición tiene 41 días.»
- **Fuente y confianza:** criterio de seguridad propio, coherente con el principio de dato no medido nulo ([16](16-hoja-de-ruta.md)). Confianza alta como principio; el valor de 30 días es una elección (media).
- **Efecto:** ninguna sugerencia de rotación ni de retiro se emite sobre posiciones sin dato vigente. Es la única salida permitida. Varias posiciones sin medir se agrupan en una sola tarjeta.

### R1 · Revisar la causa del desgaste irregular (aviso, no bloqueo)

- **Condición por neumático con las tres huellas medidas:**
  - Asimetría: la diferencia entre `mm1` (interna) y `mm3` (externa) supera `irregularidad_mm` (2 mm por defecto, el mismo umbral de `desgaste_irregular` de la vista): causa probable de alineación o mecánica.
  - Centro gastado: `mm2` menor que el promedio de `mm1` y `mm3` por más de `rotacion_presion_dif_mm`: sobreinflado.
  - Bordes gastados: `mm2` mayor que ese promedio por más de `rotacion_presion_dif_mm`: subinflado o sobrecarga.
- **Parámetro:** `rotacion_presion_dif_mm`, por defecto 2,0 mm (coherente con `irregularidad_mm`), rango 1,0 a 4,0.
- **Texto:** «Revisar alineación del eje 1: Delantera izquierda tiene 3,1 mm de diferencia entre las huellas interna y externa.» / «Revisar presión de Eje 2 derecha interior: el centro está 2,4 mm más gastado que las huellas interna y externa.» / «Revisar presión de Eje 2 derecha interior: las huellas interna y externa están 2,6 mm más gastadas que el centro.»
- **Efecto:** se muestra el aviso mientras la condición se cumpla, con la etiqueta «Desgaste». **No bloquea ninguna rotación.** Si R2, R4, R5 o R6 sugieren mover ese neumático, la sugerencia sale marcada «Revisar la causa antes de rotar» (la frase de [15](15-rotacion-alertas-rendimiento.md) A.3, paso 7).
- **Por qué no bloquea (cambio respecto de la versión anterior de este documento):** un bloqueo «hasta una medición nueva posterior a la corrección» no tiene salida: corregir la alineación o la presión no devuelve la banda gastada, así que la medición siguiente repite la asimetría y el bloqueo volvería a activarse para siempre. Las fuentes dicen lo contrario de esperar: Goodyear Reino Unido (fuente 7): «Once the wear differential is about 3mm, you need to turn the tyre» y «Once irregular wear sets in – even if whatever causes that wear has been corrected – the wear will continue»; Michelin Reino Unido (fuente 1): en ciertos casos hay que combinar la rotación de posición con girar el neumático en la llanta. Por eso R1 avisa y deja decidir. Girar el neumático en la llanta no existe como operación del sistema y queda fuera de F8.
- **Registro de la corrección:** no hace falta para F8. Si más adelante se quisiera medir si una corrección frenó el desgaste, haría falta un evento de corrección; el tipo `inspeccion` ya lo admite el `check` de `eventos_neumatico`, pero ninguna RPC lo escribe (sección 2); crearla sería un PR aparte, fuera de este plan.
- **Fuente y confianza:** alta como principio. Michelin (fuentes 1 y 5), Continental y Goodyear vía Transport Engineer (fuente 7) y heavyvehicleinspection (fuente 6) coinciden en que la rotación no corrige la causa. Los patrones (centro, bordes, un solo lado) coinciden entre Michelin y heavyvehicleinspection. El umbral numérico es propio (media).
- **Nota:** si ambos neumáticos del mismo eje muestran el patrón simétrico, la causa es de presión o carga; si solo un lado del eje se gasta de forma asimétrica, es alineación (fuente 6, fabricante único con sustento comercial: media).

### R2 · Direccionales: rotar de lado

- **Condición:** eje con rol dirección, ambas posiciones medidas (R0), misma `marca`, `modelo` y `vida` (y `medida`, cuando exista; si no, «Neumáticos distintos» y no se sugiere), y diferencia de `promedio` entre izquierda y derecha mayor o igual a `rotacion_direccion_dif_mm`.
- **Parámetro:** `rotacion_direccion_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Rotar Delantera izquierda con Delantera derecha: 3,4 mm de diferencia entre lados (umbral 3,0 mm).»
- **Fuente y confianza:** Goodyear (fuente 7) indica girar a unos 3 mm de diferencia, y de ahí sale el valor por defecto de 3,0 mm. Michelin Reino Unido (fuente 1) es más estricto: considera la rotación desde «3/32 or more» de diferencia, es decir 2,4 mm, y su página es general, no específica de dirección; el rango mínimo de 2,0 mm permite configurar un cliente al criterio de Michelin. Overdrive resume disparadores de 3/32 a 5/32 (fuente 12, no abierta). Confianza media: hay consenso en el orden de magnitud y variación de un par de milímetros. La rotación de dirección de lado a lado es práctica común, no reglamento.
- **Qué no hace:** no rota direccionales a otro eje (R7). No ofrece mover un neumático con un daño visible: los daños de 393.75(a) (telas expuestas, separación, cortes) no se miden y el sistema no tiene dónde registrarlos (sección 2); por eso toda tarjeta lleva la frase fija «La sugerencia no reemplaza la inspección visual».

### R3 · Retiro por posición

- **Condición:** la huella más baja (`minimo`) de una posición es menor o igual a su `umbral_retiro_pos`: `direccion_retiro_mm` en dirección y `umbral_retiro_mm` (3,0 mm por defecto) en el resto, salvo el caso de recauchutado de R9. Se compara contra la huella más baja y no contra el promedio: 49 CFR 393.75(b) y (c) exigen el mínimo «en cualquier punto de una ranura principal» (fuente 2), de modo que un neumático con una huella en 2,8 mm y promedio de 3,3 mm ya incumple 4/32 de pulgada. Las huellas de NEUMET son tres puntos de la banda; que cada uno caiga en una ranura principal depende del calibre y no está verificado. Dato nulo en cualquiera de las huellas: no se calcula, nunca cero (T38).
- **Parámetros:** `direccion_retiro_mm`, por defecto 5,0 mm, rango 3,2 a 8,0. El mínimo del rango es el piso legal de EE. UU. para ruedas delanteras (4/32 de pulgada, 3,2 mm; fuente 2). El valor por defecto es una práctica de flota (5 a 6/32 de pulgada, fuentes 3 y 4); no hay consenso de fabricantes. Fuera de dirección rige el `umbral_retiro_mm` que el cliente ya tiene; el piso legal de EE. UU. para el resto es 2/32 de pulgada (1,6 mm), por debajo de ese valor.
- **Texto:** «Cambiar neumático en Delantera derecha: dirección con 4,6 mm en la huella más baja (retiro a 5,0 mm).» / «Cambiar neumático en Eje 2 derecha interior: 2,9 mm en la huella más baja (retiro a 3,0 mm).» Si no hay cubierta apta en stock (para dirección, la definición de la sección 4): «Sin stock apto; ver reposición».
- **Convivencia con la alerta crítica (S7):** el valor por defecto de 5,0 mm coincide con `umbral_critico_mm` (5) y con la alerta crítica que ya existe. Son dos señales distintas y compatibles. La alerta crítica es un estado con ciclo de vida (abierta, reconocida, resuelta) que se abre con `promedio < umbral_critico_mm` en cualquier posición; R3 es una sugerencia concreta («Cambiar neumático») de la ficha del vehículo, sin estado ni notificación, que sale con la huella más baja. Como `minimo` nunca supera al promedio, R3 en dirección salta antes o a la vez que la alerta crítica, nunca después. No se unifican: un cliente puede cambiar el crítico sin tocar la política de retiro de dirección.
- **Confianza:** alta para el piso legal de EE. UU.; baja a media para el valor por defecto. Pregunta al dueño (sección 10) por país y por la política real.
- **Buses:** el valor por defecto de dirección en bus es el mismo; la diferencia es la frecuencia de revisión (R10) y la prohibición de recauchutados adelante (R9).

### R4 · Duales: emparejar el par

- **Condición:** dentro de un mismo par dual (interior y exterior del mismo lado y eje), la diferencia de `promedio` es mayor o igual a `rotacion_dual_max_mm`.
- **Parámetro:** `rotacion_dual_max_mm`, por defecto 3,0 mm, rango 2,0 a 4,0. Ya existe con ese valor en el diseño base de [15](15-rotacion-alertas-rendimiento.md) sección A. Con «mayor o igual» como en R2, R5 y R6: el valor por defecto queda por debajo del límite de 4/32 de pulgada (3,2 mm) de FleetOwner, así que disparar en el umbral exacto sigue dentro de la tolerancia de la fuente.
- **Texto:** «Emparejar duales del eje 3 izquierdo: 4,2 mm de diferencia. Cambiar el neumático más gastado por uno de profundidad cercana a la de su compañero.»
- **Acción sugerida:** primero buscar, en el mismo eje, un intercambio con otro neumático que deje ambos pares dentro de tolerancia; si no existe, sugerir un cambio con una cubierta del stock apta y de profundidad cercana a la de la compañera. Rotar interior con exterior no cierra la diferencia de diámetro, solo equilibra el desgaste a largo plazo. No se ofrece mover un neumático con daño (R2, «Qué no hace»).
- **Fuente y confianza:** FleetOwner/TIA (fuente 8): hasta 4/32 de pulgada de profundidad; cada 1/32 más allá reduce la vida de ambas. Transport Engineer (fuente 7): guía de la federación británica hasta 4 mm; Goodyear Reino Unido no más de 2 a 3 mm. School Bus Fleet (fuente 9) usa límites de diámetro (0,5 pulgadas) y circunferencia (0,75 pulgadas) que en profundidad no se traducen de forma directa. Confianza media: el rango entre fuentes (2 a 4 mm) es el rango del parámetro.
- **Condiciones adicionales:** si ambos neumáticos tienen `medida` y son distintas, la regla da prioridad a «Revisar medida del par»; si la medida es nula se omite la comprobación y el texto avisa «medida sin registrar». Si `marca`, `modelo` o `vida` difieren, la equivalencia de 4/32 de pulgada con 1/4 de diámetro no vale (FleetOwner, fuente 8): se emite «Neumáticos distintos en el par: medir el diámetro» en lugar de la regla por profundidad.

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

### R7 · No pasar una direccional a otra posición sin aprobación

- **Condición:** un neumático de dirección llegó a `direccion_retiro_mm` o a un umbral de reubicación, y `apto_otra_posicion` no es verdadero. La cubierta que lo reemplaza debe ser apta para dirección (sección 4).
- **Efecto:** la sugerencia es siempre «Cambiar neumático»; nunca mover a tracción.
- **Texto:** «Cambiar neumático en Delantera izquierda: sin aprobación registrada para usarlo en otra posición.»
- **Fuente y confianza:** Goodyear (fuente 10) y Overdrive (fuente 12): cada tipo de neumático va en su posición; mover una direccional solo si el fabricante la aprueba para ese modelo. Es práctica de un fabricante respaldada por la mayoría de las guías: confianza media. Continental (fuente 7) describe pasar la dirección con unos 3 a 4 mm a otro eje tras reranurar; se trata como práctica de un solo fabricante y no entra por defecto.

### R8 · Cuándo no rotar

Se suprime la sugerencia de rotación (no la de retiro) cuando:

1. **Falta poco para retirar:** las semanas hasta el retiro de la posición (definición común) son menores que `rotacion_espera_semanas`, o la huella más baja está a menos de 2 mm del `umbral_retiro_pos` de esa posición. Es decir, con el umbral de la posición (5,0 mm en dirección), no con el general de 3 mm. Parámetro `rotacion_espera_semanas`, por defecto 4, rango 0 a 12. Bridgestone Costa Rica (resumen de búsqueda, fuente 13): con desgaste considerable conviene reemplazar en vez de rotar. Confianza media.
2. **Rotación reciente:** el último evento `rotacion` del neumático tiene menos de `rotacion_espera_dias` (30 por defecto, [15](15-rotacion-alertas-rendimiento.md) sección A, rango 7 a 90). Propio; sin fuente directa.
3. **Neumático en recauchutado o dado de baja:** la guardia de la base ya lo bloquea (`neumatico_rotar` y apéndice L de [08](08-esquema-datos.md)); la sugerencia no lo ofrece.
4. **Diferencia menor que la mínima:** por debajo del umbral de la regla (Michelin, fuente 1: 0 a 2/32 de pulgada de diferencia, no rotar). Confianza media-alta.

La causa mecánica sin corregir (R1) ya no suprime la rotación: la marca (R1).

Como Toyo opina (resumen de búsqueda, fuente 13) que fuera de casos específicos la rotación cuesta mano de obra con poco retorno, la regla errará hacia no sugerir.

### R9 · Neumáticos recauchutados, reparados y reranurados

- **Retiro para recauchutar (fuera de dirección):** si el cliente recauchuta (`recauchuta = true`, pregunta al dueño) y la carcasa admite otra vida (`vida` menor que 3), una posición que no es de dirección cuya huella más baja es menor o igual a `recauchutar_mm` se sugiere para recauchutado y no para descarte. En dirección el retiro ya sale por R3 (5,0 mm es mayor que 4,8 mm); el destino se elige al cambiar.
- **Parámetro:** `recauchutar_mm`, por defecto 4,8 mm (6/32 de pulgada), rango 3,5 a 8,0. Hoy `umbral_retiro_mm` es 3 mm y sirve para descarte, no para recauchutar; hace falta un parámetro nuevo.
- **Texto:** «Retirar Eje 2 derecha interior para recauchutado: queda 4,6 mm en la huella más baja (umbral 4,8 mm).»
- **Fuente y confianza:** TRIB, vía Tire Review (fuente 14, resumen de búsqueda: la página devolvió 403): retirar a unos 6/32 de pulgada. School Bus Fleet (fuente 9) dice que 6/32 suele alcanzar para recauchutar la carcasa. Dos fuentes, una solo por resumen: confianza media-baja.
- **Aviso de neumático no admitido en dirección (eje con rol dirección, tenga o no rol configurado: se evalúa siempre en el eje 1):**
  - **Recauchutado** (`condicion = 'recauchutado'` o `vida` mayor que 0): en un **bus**, o en un vehículo cuyo servicio se desconoce, siempre: 49 CFR 393.75(d) prohíbe reranurados, recauchutados y reencauchados en las ruedas delanteras de un bus (fuente 2; confianza alta). Texto: «Neumático recauchutado en dirección: no admitido en buses. Cambiar neumático.» Etiqueta «Seguridad». En un camión, solo si `direccion_camion_admite_recauchutada` es falso (por defecto): «Recauchutado en dirección: la política de la empresa no lo admite.» Las prácticas recomendadas de la industria lo desaconsejan en larga distancia y el TRIB lo trata como elección, no como mandato (fuente 11); confianza media.
  - **Reparado** (`condicion = 'reparado'`): aviso «Reparado en dirección: confirmar que fue una sola reparación de clavo, sin reparación de talón.» Modern Tire Dealer (fuente 11) cita que las normas de industria admiten una sola reparación de agujero de clavo por neumático de dirección y ninguna reparación en el talón. El sistema no sabe qué reparación fue; el aviso pide confirmarlo.
  - **Reranurado** (`reranurado` verdadero): en un bus, siempre, por 393.75(d); en un camión, 393.75(e) lo prohíbe en ruedas delanteras si la capacidad de carga es de 2.232 kg (4.920 lb) o más (fuente 2, alta). Los neumáticos de camión pesado de 22,5 pulgadas superan ese valor (p. ej. el índice de carga 152 equivale a 3.550 kg; conocimiento general, no verificado con fuente abierta: confianza media), así que se trata como prohibido sin evaluar la capacidad. Hasta que exista el dato (`reranurado`, sección 3), el sistema no detecta un reranurado: es un límite declarado, no una verificación.
- **Valor por defecto para camiones:** ni recauchutados ni reparados en dirección (valor conservador) mientras el dueño no decida (pregunta 9). Brasil también prohíbe reformados en buses (solo por resumen de búsqueda, sin verificar).

### R10 · Intervalo por kilómetros o tiempo

- **Hallazgo:** no hay consenso. Michelin rota a media vida según la tasa de desgaste y no da intervalo en kilómetros (fuente 1); Goodyear menciona unas 125.000 millas para el tándem, cifra poco fiable; los intervalos comerciales van de 8.000 a 10.000 km (blog, fuente 15) y de 30.000 a 75.000 millas (resúmenes de búsqueda).
- **Recomendación:** no usar los kilómetros como disparador. El disparador es la diferencia de desgaste (R2, R5, R6). Como recordatorio secundario, `rotacion_recordatorio_dias` (nulo por defecto, rango 30 a 365): si hay neumáticos sin rotar ni medir por más de ese plazo, avisar «Revisar rotación del vehículo: 120 días sin rotar». Los kilómetros solo se usarían con `km_confiable` verdadero.
- **Buses de pasajeros:** el disparador es el mismo; sube la frecuencia de medición: School Bus Fleet (fuente 9) describe revisión diaria de neumáticos y presión semanal, profundidad mensual. El parámetro `dias_sin_medir_alerta` ya cubre la frecuencia de medición.
- **Confianza:** alta en que no hay consenso; baja en cualquier cifra.

### R11 · Alineación entre reglas

Orden de evaluación: R0 (precondición); luego retiro y seguridad (R3, R9, R7); luego R8 (suprime rotaciones), R1 (aviso y marca) y las rotaciones R2, R4, R5, R6. Si un neumático recibe una sugerencia de retiro, no se le ofrece rotación en el mismo ciclo. Máximo 3 tarjetas por vehículo en pantalla, ordenadas por prioridad: «Seguridad» (retiro de dirección y avisos de dirección), «Desgaste», «Medir».

## 5. Reposición

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
| Sin medición, o medición vencida (`sin_medir`) | R0: «Medir primero». Ninguna otra sugerencia sobre esa posición |
| Medición con calidad invalidada | La vista la ignora; se aplica R0 si no queda otra válida |
| Medición sospechosa | La sugerencia se emite pero marcada «Medición con observaciones» (calidad ya existe, apéndice I de [08](08-esquema-datos.md)) |
| Alguna huella nula | `minimo` no se calcula: la posición queda «Sin dato»; nunca se trata como cero |
| Neumático en recauchutado | Excluido de rotación y de retiro; el stock apto no lo cuenta |
| Neumático dado de baja | Excluido; la base ya rechaza el intercambio |
| Posición vacía | Una rotación hacia posición vacía mueve el neumático; se ofrece solo si la regla lo justifica, no por defecto |
| Stock insuficiente | La sugerencia de cambio se emite con aviso «Sin stock apto; ver reposición» |
| Vehículo sin km confiables | Los kilómetros no intervienen; no se muestra recordatorio por km |
| Eje sin rol configurado | Se emiten R0, R1, R2 y R3 (eje 1 como dirección), R4 (duales), R9 (avisos del eje 1) y R3 general; no se emiten R5 ni R6 |
| Vehículo sin servicio (bus o camión) registrado | Se trata como bus: el aviso de recauchutado en dirección se emite (R9) y ningún recauchutado es apto para dirección |
| Eje 1 con medidas distintas a izquierda y derecha | «Revisar medida del par»; no se sugiere rotar |
| Una sola posición medida del par | No se sugiere nada; R0 pide medir la otra |
| Datos de ejes extra (17 a 98) | No se sugiere rotación; se muestra aviso «Eje sin soporte de rotación» hasta que el montaje los admita |
| Neumático con corte, telas expuestas, separación o fuga (393.75(a)) | No se mide ni se puede registrar hoy (sección 2). La sugerencia no reemplaza la inspección visual; toda tarjeta lo dice. R2 y R4 no pueden excluir un neumático dañado porque no existe el dato |
| Neumático reranurado | No se detecta hasta que exista `reranurado` (sección 3); aviso de límite declarado |
| Dos rotaciones simultáneas | La base serializa por posición; la vista recarga tras registrar |

## 7. Flujo para el operario

Cuenta de clics sobre la ficha del vehículo, según la sección 5 de [14](14-guia-de-textos.md):

| Tarea | Hoy | Propuesto |
|---|---|---|
| Rotar dos posiciones | 4 a 5 clics: tocar la rueda, abrir el desplegable, elegir destino, «Rotar», confirmar si hay intercambio (`assets/js/views/vehiculo-detalle.js:312-319`, `assets/js/views/cambio-neumatico.js:150-166`) | 1 clic: «Registrar rotación» en la tarjeta de la sugerencia; la sugerencia ya es la confirmación |
| Rotación en cruz | No existe como operación única | 1 clic con `neumatico_rotar_varias` (PR 6) |
| Ejecutar una sugerencia de cambio | 3 a 4 clics desde «Cambiar neumático» | 2 clics: «Cambiar neumático» abre el formulario con la posición y el motivo ya completados y, como cubierta sugerida, la primera apta (para dirección, la definición de la sección 4) |
| Ver por qué se sugiere | No aplica | 0 clics: el motivo es la frase visible de la tarjeta |
| Descartar una sugerencia | No aplica | 1 clic: «Ignorar hasta la próxima medición» (PR 5; hasta entonces no se ofrece) |

Pautas:

- Una acción primaria por tarjeta; la tarjeta muestra qué mover, hacia dónde y la regla en una frase, con nombres de posición («Delantera izquierda»), no «P1, P2».
- «Registrar rotación» (no «Aplicar», que no dice qué se aplica) guarda la rotación sin pedir odómetro (campo opcional, nunca precompletado).
- **Sin confirmación cuando el destino está ocupado:** hoy se confirma el intercambio; en la tarjeta se quita porque la acción es reversible (rotar de nuevo restaura las posiciones) y [14](14-guia-de-textos.md) sección 5, regla 5, reserva la confirmación para lo destructivo o irreversible.
- **«Ignorar hasta la próxima medición» necesita persistencia compartida**: si solo vive en el navegador, otro usuario o dispositivo vería la sugerencia de nuevo. Requiere la tabla de la sección 3 y una RPC; entra en el PR 5 (con migración). La primera versión de la tarjeta (PR 4) no ofrece «Ignorar». Pregunta 10: si debe pedir un motivo.
- Quién puede pulsar «Registrar rotación» queda ligado a quién puede rotar hoy (`neumatico_autorizar_vehiculo`): administrador de empresa y usuario de sucursal para su sucursal; el equipo Neumet solo mira (docs/17 (PR 72, aún sin fusionar) P1, ver sección 9.1). Pregunta 7.
- No se usa color como único indicador: cada tarjeta lleva un texto de prioridad («Seguridad», «Desgaste», «Medir»). Los textos usan el vocabulario de [14](14-guia-de-textos.md): «Rotar», «Cambiar neumático», «recauchutado», «posición vacía», «Sin dato», «Medición con observaciones».

## 8. Criterio de prueba

La función pura (propuesta: `recomendarRotacion(vehiculo, filas, opciones)` en `assets/js/domain/rotacion.js`, sin DOM ni supabase) devuelve una lista de sugerencias `{regla, tipo, posiciones, texto}` y una lista de avisos. Una segunda función pura, `esAptaDireccion(cubierta, vehiculo, opciones)`, implementa la definición de la sección 4. Cada fila de la tabla siguiente se convierte en un test unitario en `tests/unit/rotacion.test.mjs`. Los valores usan los parámetros por defecto y neumáticos con igual `marca`, `modelo`, `vida` y `medida` nula salvo que la entrada diga otra cosa. Las posiciones: P1 Delantera izquierda, P2 Delantera derecha, P3 a P6 del eje 2, P7 y P8 eje 3 izquierdo, P9 y P10 eje 3 derecho. «Uniforme» significa las tres huellas iguales. Los casos T01 a T34 son los de la primera versión, ajustados; T35 a T57 son nuevos y los de T10, T14, T15, T22, T26 y T30 cambiaron de contenido.

| ID | Regla | Entrada | Resultado esperado |
|---|---|---|---|
| T01 | R0 | P1 con `ultima_medicion_at` de hace 31 días | «Medir primero Delantera izquierda»; ninguna otra sugerencia sobre P1 |
| T02 | R0 | P1 medida hace 29 días y 23 horas, P2 vigente, P1 y P2 uniformes con 10,0 y 6,5 mm (3,5 mm de diferencia) | «Rotar Delantera izquierda con Delantera derecha» (la medición sigue vigente) |
| T03 | R0 | P1 con `ultima_medicion_at` nula | «Medir primero Delantera izquierda» |
| T04 | R1 | P1 con `mm1` = 9, `mm2` = 8, `mm3` = 6,5 (asimetría 2,5 mm) y P2 uniforme con 8,0 mm (sin diferencia relevante) | Aviso «Revisar alineación del eje 1»; sin rotación porque no hay diferencia entre lados, no por bloqueo |
| T05 | R1 | P5 con `mm1` = 9, `mm2` = 6,5, `mm3` = 9 | «Revisar presión» por centro gastado (2,5 mm) |
| T06 | R1 | P5 con `mm1` = 6, `mm2` = 8,6, `mm3` = 6 | «Revisar presión» por bordes gastados (2,6 mm) |
| T07 | R1 | P5 con `mm1` = 9, `mm2` = 8, `mm3` = 9 | Sin aviso por causa |
| T08 | R2 | P1 = 10 mm, P2 = 7,0 mm (uniformes) | «Rotar Delantera izquierda con Delantera derecha» (diferencia exacta de 3,0 mm: sugiere) |
| T09 | R2 | P1 = 10 mm, P2 = 7,1 mm (uniformes) | Sin sugerencia de rotación (2,9 mm) |
| T10 | R2 y R1 | P1 con `mm1` = 11,5, `mm2` = 10,5, `mm3` = 9,0 (promedio 10,33; asimetría 2,5 mm) y P2 uniforme con 7,0 mm | Aviso R1 y «Rotar Delantera izquierda con Delantera derecha» (3,33 mm de diferencia), marcada «Revisar la causa antes de rotar»; la rotación no se bloquea |
| T11 | R3 | P2 uniforme con 5,0 mm (dirección) | «Cambiar neumático en Delantera derecha» (igual al umbral: sugiere) |
| T12 | R3 | P2 uniforme con 5,1 mm | Sin sugerencia de retiro |
| T13 | R3 | P2 uniforme con 4,6 mm y P1 uniforme con 10 mm | Solo retiro de Delantera derecha, sin rotación entre P1 y P2 |
| T14 | R4 | P7 = 10 mm, P8 = 7,0 mm (uniformes) | «Emparejar duales del eje 3 izquierdo» (diferencia de 3,0 mm: sugiere, como R2) |
| T15 | R4 | P7 = 10 mm, P8 = 7,1 mm (uniformes) | Sin sugerencia (2,9 mm) |
| T16 | R4 | P7 y P8 con medidas distintas registradas | «Revisar medida del par» |
| T17 | R4 | P7 y P8 con medida nula, 10 y 5,8 mm (4,2 mm) | Se evalúa por profundidad y el texto indica «medida sin registrar» |
| T18 | R5 | Eje 2 con promedio 10 y eje 3 con promedio 6,4, con rol de eje configurado | «Rotar el eje 2 con el eje 3» (diferencia de 3,6 mm) |
| T19 | R5 | Mismo caso sin rol de eje configurado | Sin sugerencia R5 |
| T20 | R6 | Eje 4 = 9 mm y eje 5 = 5,7 mm, con rol arrastre y R6 activa | «Alternar los ejes 4 y 5» (3,3 mm) |
| T21 | R7 | P1 uniforme con 4,8 mm y `apto_otra_posicion` nulo | «Cambiar neumático en Delantera izquierda»; nunca mover a tracción |
| T22 | R8 | P1 uniforme con 12,0 mm; P2 uniforme con 8,0 mm y tasa de 1,0 mm por semana | Sin sugerencia de rotación: (8,0 − 5,0) / 1,0 = 3 semanas, menos que 4 (con el umbral general de 3 mm serían 5 semanas y no se suprimiría) |
| T23 | R8 | P1 rotada hace 10 días y diferencia de 4 mm | Sin sugerencia de rotación |
| T24 | R8 | P1 y P2 con 2,5 mm de diferencia | Sin sugerencia de rotación |
| T25 | R9 | P5 `vida` 1, uniforme con 4,8 mm, cliente que recauchuta | «Retirar Eje 2 derecha interior para recauchutado» (4,8 es menor o igual a 4,8) |
| T26 | R3 y R9 | P5 `vida` 3 (carcasa agotada), uniforme con 4,8 mm, cliente que recauchuta | Sin sugerencia: 4,8 mm es mayor que el retiro general de 3,0 mm y la carcasa no admite otra vida |
| T27 | R9 | Neumático recauchutado (`vida` 1) en el eje 1 de un vehículo con servicio `bus` | Aviso «Neumático recauchutado en dirección: no admitido en buses», etiqueta «Seguridad» |
| T28 | R10 | Cliente sin `rotacion_recordatorio_dias` | Sin recordatorio |
| T29 | R10 | Recordatorio de 120 días, 121 días sin rotar | «Revisar rotación del vehículo: 121 días sin rotar» |
| T30 | Reposición | 5 neumáticos llegan al retiro de su posición en el plazo, 2 cubiertas aptas en stock, seguridad 1 | Necesidad neta = 4 (5 + 1 − 2) |
| T31 | Reposición | 1 llega al retiro, 4 aptas en stock, seguridad 1 (1 + 1 − 4 = −2) | Cero; nunca se sugiere devolver |
| T32 | Reposición | Cubiertas aptas en proceso de recauchutado | No se cuentan como disponibles |
| T33 | Regresión de datos | Mm nulos | Nulo, nunca cero: sin dato, sin sugerencia |
| T34 | Límite de pantalla | Cuatro sugerencias válidas en un vehículo | Se muestran 3, con el retiro de dirección primero |
| T35 | R3 | `direccion_retiro_mm` = 3,2; P1 con `mm1` = 2,8, `mm2` = 3,6, `mm3` = 3,5 (promedio 3,30) | «Cambiar neumático en Delantera izquierda»: la huella más baja (2,8) es menor o igual a 3,2 aunque el promedio no lo sea; con el promedio no habría retiro |
| T36 | R3 | Valor por defecto 5,0; P2 con `mm1` = 4,0, `mm2` = 6,0, `mm3` = 5,5 (promedio 5,17) | «Cambiar neumático en Delantera derecha» (4,0 es menor o igual a 5,0); con el promedio no habría retiro |
| T37 | R3 | P2 con `mm1` = 5,1, `mm2` = 5,6, `mm3` = 5,3 | Sin retiro (la huella más baja, 5,1, supera 5,0) |
| T38 | R3 | P1 con `mm1` = 2,0, `mm2` nulo, `mm3` = 6,0 | `minimo` nulo: sin retiro ni rotación sobre P1; se muestra «Sin dato». La prueba falla si se implementa con `Math.min` o `least` sin comprobar nulos (daría 0 o 2,0) |
| T39 | R3 | P5 (no dirección) con `mm1` = 2,9, `mm2` = 4,0, `mm3` = 3,5 (promedio 3,47) y cliente sin recauchutado | «Cambiar neumático en Eje 2 derecha interior» (2,9 es menor o igual al retiro general de 3,0) |
| T40 | R1 | Como T10 tras la corrección de alineación: P1 con `mm1` = 11,4, `mm2` = 10,4, `mm3` = 8,9 (promedio 10,23; asimetría 2,5 mm, igual que antes) y P2 uniforme con 7,0 mm | Mismo resultado que T10: aviso R1 y rotación (3,23 mm) marcada; P1 no queda bloqueado |
| T41 | R0 | P1 medida hace 30 días y 12 horas (`dias_desde_medicion` = 30, `sin_medir` verdadero) | «Medir primero Delantera izquierda» (mismo criterio que la vista) |
| T42 | R2 | P1 y P2 de modelos distintos, uniformes con 10,0 y 6,0 mm | Sin rotación; «Neumáticos distintos» |
| T43 | R4 | P7 y P8 de modelos distintos, uniformes con 10,0 y 6,5 mm | «Neumáticos distintos en el par: medir el diámetro» en lugar de la regla por profundidad |
| T44 | R9 | Neumático recauchutado en el eje 1 de un vehículo con servicio nulo | Mismo aviso que T27 (se trata como bus) |
| T45 | R9 | Neumático recauchutado en el eje 1 de un camión con `direccion_camion_admite_recauchutada` falso, y luego verdadero | Falso: aviso «la política de la empresa no lo admite». Verdadero: sin aviso |
| T46 | R9 | Neumático con `condicion` = `reparado` en el eje 1 | Aviso «Reparado en dirección: confirmar que fue una sola reparación de clavo, sin reparación de talón» |
| T47 | Apta | Cubierta del stock `nuevo`, misma sucursal, sin medición | Apta para dirección |
| T48 | Apta | Cubierta `usado` con `vida` 0 y `minimo` 4,9 mm, y otra con 5,1 mm (`direccion_retiro_mm` = 5,0) | La de 4,9 no es apta (R3 la retiraría al montarla); la de 5,1 sí |
| T49 | Apta | Cubierta `recauchutado` en un bus, en un camión con el parámetro falso y en un camión con el parámetro verdadero | No apta, no apta, apta |
| T50 | Apta | Cubierta `usado` sin medición | No apta («Sin dato») |
| T51 | Apta | Cubierta `reparado` en un camión con `direccion_camion_admite_reparada` falso y luego verdadero | No apta; apta |
| T52 | Apta | Cubierta con medida registrada distinta a la de su compañera de eje, y otra con medida nula | La primera no es apta; la segunda es apta con aviso «medida sin registrar» |
| T53 | R8 | P1 uniforme con 10,5 mm; P2 uniforme con 6,5 mm (4,0 mm de diferencia), sin tasa | Sin rotación: 6,5 − 5,0 = 1,5 mm, menos de 2 mm del retiro de dirección (con el umbral general de 3 mm serían 3,5 mm y no se suprimiría) |
| T54 | Reposición | Dirección: 1 neumático uniforme con 6,0 mm y tasa de 0,25 mm por semana, plazo de 4 semanas | Cuenta como demanda: (6,0 − 5,0) / 0,25 = 4 semanas, menor o igual que 4 (la vista diría 12) |
| T55 | Reposición | 3 neumáticos con `minimo` por encima del umbral y sin tasa válida | No se cuentan en la demanda; el texto informa «3 sin dato de desgaste» |
| T56 | Reposición | Un neumático con `minimo` por debajo del umbral de su posición y sin tasa | Cuenta como demanda (ya está en el retiro; no necesita tasa) |
| T57 | R3 | P5 `vida` 3 uniforme con 3,0 mm, cliente que recauchuta | «Cambiar neumático en Eje 2 derecha interior» (no recauchutar: carcasa agotada) |

Además de los unitarios: una prueba e2e (`npm run e2e`) por cada nueva RPC y por cada tabla de parámetros, con el JWT de cada rol (admin, global, sucursal, sin perfil, `api`, y los roles que defina docs/17 (PR 72, aún sin fusionar)), según las reglas de [13](13-checklist-revision-prs.md).

## 9. Plan de implementación

PR chicos y en serie, cada uno con su verificación. Nunca dos migraciones en producción a la vez.

| # | Contenido | Migración | Notas |
|---|---|---|---|
| 1 | Dominio puro `rotacion.js` y `esAptaDireccion`; tests T01 a T29 (incluidos R9 y R10), T33 a T53 y T57, con eje 1 como dirección, el resto sin clasificar y servicio por defecto bus | No | Sin interfaz; se puede revisar solo |
| 2 | Parámetros por cliente: tabla `rotacion_parametros` y RPC `rotacion_configurar`; formulario de «Parámetros de rotación» (sección 9.1) | Sí | Idempotente, `check` por rango; apéndice nuevo en [08](08-esquema-datos.md); prueba SQL por rol |
| 3 | Datos del modelo: `vehiculo_ejes`, `vehiculos.servicio`, `neumaticos.medida`, `apto_otra_posicion`, `reranurado` (con `grant select` por columna y ajuste de `t_90`), lectura en `v_estado_neumaticos` si se justifica | Sí | Antes de aplicar, el director consulta a `neumet-dba` por la vista |
| 4 | Vista: tarjeta de sugerencias en la ficha y «Registrar rotación» con `neumatico_rotar`; clics contados en el PR; «Cambiar neumático» con el formulario prellenado con una cubierta apta (sección 4) | No | Sin «Ignorar» ni rotación en cruz |
| 5 | «Ignorar hasta la próxima medición»: tabla `rotacion_sugerencias_ignoradas` y RPC | Sí | Solo si el dueño lo confirma (pregunta 10) |
| 6 | `neumatico_rotar_varias` (rotación atómica de varios pares) y acción de R5 y R6 | Sí | Pruebas SQL y e2e por rol; sin rama de escritura para el equipo Neumet |
| 7 | Dominio de reposición, tests T30 a T32 y T54 a T56 y vista de sugerencia de compra | No (usa los parámetros del PR 2) | Requiere medida del PR 3 para agrupar por medida |

Cada PR de este plan actualiza en el mismo PR el apéndice de [08](08-esquema-datos.md) que corresponda y el tablero [10](10-tablero.md).

### 9.1 Parámetros por cliente y orden respecto de docs/17

**Dónde viven los parámetros.** En una tabla propia `rotacion_parametros (cliente_id primary key, ...)`, no en columnas nuevas de `clientes`. Es lo más simple y compatible con el plan de roles de docs/17 (PR 72, aún sin fusionar): la migración C2 de ese plan revoca `select` y `update` de tabla sobre `clientes`, otorga por columna y exige un test que falle si queda una columna sin otorgar; cada columna nueva de `clientes` tendría que entrar en esa lista y en la RPC `alerta_configurar`. Una tabla nueva no toca `clientes` ni a C2.

**Cómo se escriben.** Solo por una RPC `rotacion_configurar(p_cliente_id, ...)`, `SECURITY DEFINER` con `search_path` vacío: sin privilegios de escritura de tabla para `authenticated` (el `update` directo que hoy hace `ficha-cliente.js` sobre `clientes` no se replica). La RPC autoriza al **administrador de empresa**, hoy el perfil `cliente` sin sucursal (que docs/17 (PR 72, aún sin fusionar) llama «perfil global») y combina `current_sucursal_id()` con `current_cliente_id()` como exige la regla de la sección 8 de ese documento. Rechaza con `42501` al equipo Neumet (que solo mira, P1 de docs/17 (PR 72, aún sin fusionar)), al usuario de sucursal, a `api` y a quien no tiene perfil. La lectura queda con RLS por cliente (el equipo Neumet lee todas; cada empresa, la suya). Sin fila, el dominio usa los valores por defecto de la sección 4.

**Dónde se editan.** En un formulario «Parámetros de rotación» visible solo para el administrador de empresa, junto al nivel crítico en la vista de alertas (hoy `alertas.js` hospeda la edición de `alerta_configurar` para el perfil global). Cuando exista el menú «Empresa» de docs/17 (PR 72, aún sin fusionar) (su PR 4), el formulario se traslada ahí. No se agrega a la ficha de cliente.

**Orden respecto de docs/17.** F8 es prioridad fuerte (tablero [10](10-tablero.md)) y docs/17 (PR 72, aún sin fusionar) está solo planificado. En producción hay una sola migración a la vez, en serie, en cualquier orden entre las migraciones de F8 (PR 2, 3, 5, 6) y las de docs/17 (PR 72, aún sin fusionar) (A, B, C1, C2): ninguna depende de otra, salvo lo siguiente.

| Punto de contacto | Regla |
|---|---|
| F8 PR 2 (`rotacion_configurar`) y migración A de docs/17 (PR 72, aún sin fusionar) (`admin_empresa_cliente_id()`) | F8 PR 2 no espera a A: usa la regla inline («perfil `cliente` sin sucursal»), que es una copia más de la regla «global» que docs/17 (PR 72, aún sin fusionar) sección 2.2 quiere centralizar. Al fusionarse, docs/17 (PR 72, aún sin fusionar) debe agregar `rotacion_configurar` al inventario de la sección 2.2 y sustituir la regla inline por `admin_empresa_cliente_id()` en su migración A. Si A ya está aplicada cuando F8 PR 2 se escribe, usa la función directamente |
| F8 PR 3 y PR 5 (tablas y columnas nuevas) y C2 | C2 solo toca `clientes` y recorta ramas `is_admin()` de escritura de RPC operativas; F8 PR 3 toca `neumaticos`, `vehiculos` y tablas nuevas, así que no se pisan. Las RPC de escritura de F8 nacen sin rama `is_admin()` de escritura (P1) |
| F8 PR 4 y PR 6 («Registrar rotación», `neumatico_rotar_varias`) y C2 | Mientras C2 no esté aplicada, `neumatico_rotar` autoriza al `admin`; el botón se oculta al equipo Neumet desde el PR 4 para no depender del orden, y `neumatico_rotar_varias` nace sin rama de admin |
| Timestamps de migración | La siguiente migración en cola usa un timestamp posterior a la última aplicada, sea de F8 o de docs/17 (PR 72, aún sin fusionar); el director no lanza un PR con migración mientras otro siga sin aplicar y verificar |
| `docs/README.md` y `docs/10` | Los cambios de ambos planes sobre esos archivos se resuelven al fusionar el segundo; este documento no los toca |

## 10. Preguntas para el dueño

Solo de lógica de negocio; lo técnico queda resuelto arriba, con el valor conservador que se usa mientras no haya respuesta.

1. **Política de retiro de direccionales:** ¿a cuántos milímetros se retiran hoy en los camiones y en los buses? El valor por defecto propuesto es 5,0 mm medidos en la huella más baja, con piso de 3,2 mm.
2. **País o norma aplicable:** ¿en qué país operan los clientes con flota pesada y qué profundidad mínima legal exige la inspección? Los pisos legales verificados son de EE. UU.; México y Brasil se encontraron solo en resúmenes y Chile y Argentina no tienen un valor oficial hallado para pesados.
3. **Recauchutado:** ¿los clientes recauchutan, en qué posiciones lo permiten (fuera de dirección) y cuántas vidas de carcasa admiten?
4. **Intervalos actuales:** ¿cada cuánto rotan hoy y quién lo decide (taller propio o externo)? Sirve para fijar el recordatorio y para medir si la sugerencia mejora algo.
5. **Reposición:** ¿cuál es el plazo real de entrega de neumáticos y cuánta reserva de seguridad toleran en dinero o en unidades?
6. **Buses:** ¿los buses de pasajeros llevan ruedas simples adelante y duales atrás en todos los casos (un bus de 2 ejes tiene 2 ruedas simples adelante y 4 duales atrás: 6 ruedas)? ¿Hay buses de tres ejes? ¿Los buses de dos ejes se cargan hoy como camión de 10 ruedas con el eje 3 vacío?
7. **Quién edita y quién registra:** ¿qué rol edita los parámetros de rotación y quién puede pulsar «Registrar rotación»? Valor mientras tanto: los edita el administrador de empresa; registran la rotación el administrador de empresa y el usuario de sucursal de su sucursal; el equipo Neumet solo mira (enlaza con P1 de docs/17 (PR 72, aún sin fusionar)).
8. **Bus o camión por vehículo:** ¿se marca cada vehículo como bus o camión al darlo de alta? Valor mientras tanto: un vehículo sin marcar se trata como bus (el valor prudente), lo que puede generar avisos de más sobre camiones que lleven recauchutados adelante.
9. **Direccionales reparadas, recauchutadas o reranuradas en camiones:** ¿se permite montar en dirección neumáticos reparados, recauchutados o reranurados en camiones? Valor mientras tanto: no se permiten ni se ofrecen (en buses los recauchutados y reranurados quedan prohibidos por la norma de EE. UU. citada, sin parámetro).
10. **«Ignorar» una sugerencia:** ¿debe pedir un motivo? Valor mientras tanto: no pide motivo y oculta la sugerencia hasta la próxima medición; la decisión define si el PR 5 guarda el motivo.

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
