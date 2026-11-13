# 18 · Rotación y reposición para vehículos pesados

Investigación y propuesta de diseño de la fase F8 de [16](16-hoja-de-ruta.md): sugerencia de rotación y reposición de neumáticos para camiones y buses de pasajeros. Es un documento de propuesta: no cambia código, migraciones ni interfaz. Complementa y precisa la sección A de [15](15-rotacion-alertas-rendimiento.md), pensada para un caso más simple.

Fecha de consulta de todas las fuentes externas: 2026-11-13. Las afirmaciones sobre el repositorio llevan `archivo:línea` y se comprobaron sobre `main` en esa fecha.

Principios que rigen el diseño ([16](16-hoja-de-ruta.md)): dato no medido es nulo, nunca cero; reglas interpretables, sin machine learning; el operario ve una acción simple, no una teoría.

## 1. Resumen para el dueño

1. La sugerencia dirá qué rotar o cambiar y por qué, en una frase, en la ficha del vehículo. Nunca ejecuta nada sola.
2. No hay una regla única en la industria. Los fabricantes coinciden en lo esencial y discrepan en las cifras, así que todo umbral será configurable por cliente, con un valor por defecto razonable.
3. La regla más firme: antes de rotar hay que corregir la causa de un desgaste irregular (alineación, presión). Rotar un neumático mal alineado solo reparte el problema.
4. Direccionales: cuidado máximo. Se cambian antes que el resto y, en buses, no se montan recauchutados adelante en varios países.
5. Duales: las dos cubiertas de un par deben tener profundidad parecida; si no, la más gastada recibe la carga y se destruye antes.
6. Sin medición reciente no se sugiere nada: se pide medir primero.
7. El modelo actual no sabe qué eje es de dirección, tracción o arrastre, ni la medida de cada cubierta. Eso hay que agregarlo antes de que la sugerencia sea completa (sección 3).
8. Se propone entregar en seis PR chicos y en serie; tres llevan migración (sección 9).
9. La reposición sugiere cuántas cubiertas comprar por medida a partir de lo que se gastará durante el plazo de entrega; el cliente decide.
10. Hay seis preguntas de negocio para el dueño (sección 10). Todo lo técnico lo resuelve este documento con una recomendación.

## 2. Qué soporta hoy el modelo

| Configuración | Soporte | Evidencia |
|---|---|---|
| Camión de 10 ruedas (eje 1 simple, ejes 2 y 3 duales) | Sí | `assets/js/domain/camion.js:2-15`, `vehiculos.tipo_ruedas` solo admite 10 o 16 (`supabase/migrations/20261106000000_init_schema.sql:95`) |
| Camión de 16 ruedas (eje 1 simple, ejes 2 a 4 duales, eje 5 simple) | Sí | `assets/js/domain/camion.js:2-15` |
| Ejes extra duales (posiciones 17 a 98, de a 4) | Solo se dibujan y se leen; no se pueden montar desde el panel | Diagrama: `assets/js/domain/vehiculo-diagrama.js:24-32` y `:55-77`. Montaje: `neumatico_montar` rechaza 17 a 98 con 23514 (`supabase/migrations/20261114500000_montar_neumaticos.sql:101-108`); entran solo por la API de ingesta (`supabase/migrations/20261106000000_init_schema.sql:562, 622`) |
| Auxilio (posición 99, uno por vehículo) | Sí | `assets/js/domain/vehiculo-diagrama.js:5`; índice único en `supabase/migrations/20261106000000_init_schema.sql:162-166` |
| Rol del eje (dirección, tracción, arrastre) | No. Solo se sabe que el eje 1 es el delantero | `assets/js/domain/vehiculo-diagrama.js:24-32` |
| Bus de 2 ejes (4 ruedas delante dirección simple, par dual atrás) | No como tipo propio: el mínimo es el diseño de 10 ruedas con el eje 3 vacío | `assets/js/domain/camion.js:2-15`, `assets/js/domain/vehiculo-diagrama.js:55-77` |
| Tándem, eje de levante, semirremolque | No: no hay concepto de tractor y remolque ni de eje elevable | Sin evidencia de soporte en el dominio ni en el esquema (`vehiculos` no tiene columna de configuración de ejes) |
| Medida del neumático | No existe la columna `medida` en `neumaticos`; sí `marca`, `modelo`, `vida`, `numero_quema`, `km_previos`, `condicion` | `supabase/migrations/20261106000000_init_schema.sql:140-166` (la tabla), sin coincidencias de `medida` en las migraciones |
| Profundidad por huella | Sí: mm1 interno, mm2 centro, mm3 externo | `supabase/functions/api-proveedor/mapping.ts:4`, `docs/07-api-proveedor.md:39` |
| Antigüedad de la medición | Sí: `dias_desde_medicion`, `sin_medir` | `supabase/migrations/20261116000000_calidad_datos.sql:585` y `:591` |
| Desgaste irregular por cliente | Sí: `diferencia_huellas_mm` y `desgaste_irregular` con `irregularidad_mm` | `supabase/migrations/20261116000000_calidad_datos.sql:593-595` |
| Umbrales por cliente (bajo 8, crítico 5, retiro 3) | Sí | `supabase/migrations/20261116000000_calidad_datos.sql:477`; valores por defecto en `assets/js/domain/vehiculo-diagrama.js:110` |
| Kilómetros por cubierta | Sí, con indicador de confiabilidad (`v_km_cubierta`) | `docs/08-esquema-datos.md` apéndice H |
| Rotación atómica de dos posiciones | Sí: `neumatico_rotar(vehículo, pos_a, pos_b, odómetro)` intercambia o mueve, rechaza cubiertas dadas de baja y registra un evento `rotacion` por cubierta; no abre ni cierra tramos de km | `supabase/migrations/20261108000000_cambio_neumatico.sql:352-440` |
| Rotación de más de dos posiciones en una sola operación | No: una rotación en cruz son dos intercambios sucesivos, no atómicos | misma RPC |
| Cubierta recauchutada | Sí: vida 0 a 3 por carcasa y guardia que bloquea mover cubiertas en proceso | apéndice L de `docs/08-esquema-datos.md` |
| Stock de cubiertas aptas | Sí: `neumaticos` sin montar (`estado = 'almacenado'`, `condicion`, `sucursal_id`) | `supabase/migrations/20261113000000_stock_cubiertas.sql` |

Conclusión: los ejes se pueden derivar de la posición, pero el rol del eje y la medida no están en el modelo. Sin el rol no es posible distinguir tracción de arrastre ni aplicar las reglas de dirección salvo en el eje 1.

### 2.1 Cómo es hoy el flujo de rotar

Desde la ficha del vehículo: tocar la rueda, abrir el desplegable «Elegir posición…», elegir el destino, pulsar «Rotar» y, si el destino está ocupado, confirmar el intercambio (`assets/js/views/vehiculo-detalle.js:312-319` y `:538-542`; `assets/js/views/cambio-neumatico.js:150-166`). Son 4 a 5 clics por intercambio. El odómetro viaja nulo (`p_odometro_km: null`, `assets/js/views/cambio-neumatico.js:150-166`), por lo que hoy ninguna rotación guarda kilómetros.

## 3. Datos que faltan y qué agregar

| Dato | Para qué | Propuesta | ¿Migración? |
|---|---|---|---|
| Rol de cada eje: `direccion`, `traccion`, `arrastre` | Todas las reglas por tipo de eje | Tabla `vehiculo_ejes (vehiculo_id, eje, rol, servicio)` con `servicio` = `camion` o `bus`; sin fila, se asume eje 1 dirección y los demás sin clasificar | Sí |
| Tipo de eje simple o dual | Reglas de duales | Se deriva de la posición (`ejeDePosicion`), no se guarda | No |
| Medida de la cubierta | No mezclar medidas en un par dual ni al reponer | `neumaticos.medida text`, nulo si no se conoce; la regla de duales y la reposición la ignoran si es nula y lo declaran | Sí |
| Aptitud por posición (p. ej. direccional apto para tracción por aprobación del fabricante) | Evitar pasar una direccional a tracción sin permiso | `neumaticos.apto_otra_posicion boolean` nulo = no se sabe, se trata como no apto | Sí (junto a la medida) |
| Parámetros de rotación por cliente | Umbrales configurables | Columnas nuevas en `clientes`, con valores por defecto (sección 4) | Sí |
| Kilómetros en cada rotación | Intervalo por km | Pasar el odómetro cuando el operario lo conoce; hoy se envía nulo. No se precompleta jamás ([14](14-guia-de-textos.md) sección 5) | No |
| Rotación en cruz atómica | Permutar 3 o más posiciones sin estados intermedios | RPC `neumatico_permutar(vehículo, pares[])` que reutiliza las guardias de `neumatico_rotar` | Sí |
| Interpretación de ejes extra (posiciones 17 a 98) | Camiones de más de 16 ruedas | Permitir montarlos con `neumatico_montar`; no es requisito de la primera entrega | Sí, aparte |

Recomendación: no bloquear la primera entrega por estos datos. El PR de dominio (sección 9) funciona con lo que hay (eje 1 como dirección, resto sin clasificar) y las reglas que dependen del rol se activan cuando el cliente lo configura.

## 4. Reglas propuestas

Convenciones: las profundidades son promedios por posición (`promedio`) salvo que la regla diga lo contrario; «diferencia» es un valor absoluto en milímetros; los parámetros viven por cliente, con rango permitido. Los textos están en el estilo de [14](14-guia-de-textos.md): infinitivo, sin emojis, con la regla aplicada en una frase. Las fuentes se numeran en la sección 11.

Equivalencias usadas: 2/32 de pulgada = 1,6 mm; 3/32 = 2,4 mm; 4/32 = 3,2 mm; 6/32 = 4,8 mm.

### R0 · Medir primero (precondición de todas)

- **Condición:** alguna posición involucrada tiene `ultima_medicion_at` nula, `dias_desde_medicion` mayor que `rotacion_medicion_max_dias` o su última medición tiene calidad invalidada.
- **Parámetro:** `rotacion_medicion_max_dias`, por defecto 30, rango 7 a 90. Coincide con el valor por defecto de `dias_sin_medir_alerta` (`supabase/migrations/20261116000000_calidad_datos.sql:477`).
- **Texto:** «Medir primero P3 y P4: la última medición tiene 41 días.»
- **Fuente y confianza:** criterio de seguridad propio, coherente con el principio de dato no medido nulo ([16](16-hoja-de-ruta.md)). Confianza alta como principio; el valor de 30 días es una elección (media).
- **Efecto:** ninguna sugerencia de rotación ni retiro se emite sobre posiciones sin dato vigente. Es la única salida permitida.

### R1 · Corregir la causa antes de rotar

- **Condición por cubierta con las tres huellas medidas:**
  - Asimetría: la diferencia entre `mm1` (interno) y `mm3` (externo) supera `irregularidad_mm` (2 mm por defecto): causa probable de alineación o mecánica.
  - Centro gastado: `mm2` menor que el promedio de `mm1` y `mm3` por más de `rotacion_presion_dif_mm`: sobreinflado.
  - Hombros gastados: `mm2` mayor que ese promedio por más de `rotacion_presion_dif_mm`: subinflado o sobrecarga.
- **Parámetro:** `rotacion_presion_dif_mm`, por defecto 2,0 mm (coherente con `irregularidad_mm`), rango 1,0 a 4,0.
- **Texto:** «Revisar alineación del eje 1: P1 tiene 3,1 mm de diferencia entre interior y exterior.» / «Revisar presión de P5: el centro está 2,4 mm más gastado que los hombros.»
- **Efecto:** se bloquea cualquier rotación de esa cubierta hasta una medición nueva posterior a la corrección. La causa se muestra en lugar de la rotación.
- **Fuente y confianza:** alta como principio. Michelin (fuentes 1 y 5), Continental y Goodyear vía Transport Engineer (fuente 7) y heavyvehicleinspection (fuente 6) coinciden en que la rotación no corrige la causa. Los patrones (centro, hombros, un solo lado) coinciden entre Michelin y heavyvehicleinspection. El umbral numérico es propio (media).
- **Nota:** si ambas cubiertas del mismo eje muestran el patrón simétrico, la causa es de presión o carga; si solo un lado del eje se gasta de forma asimétrica, es alineación (fuente 6, fabricante único con sustento comercial: media).

### R2 · Direccionales: intercambiar de lado

- **Condición:** eje con rol dirección, ambas posiciones medidas (R0), sin bloqueo R1, y diferencia de `promedio` entre izquierda y derecha mayor o igual a `rotacion_direccion_dif_mm`.
- **Parámetro:** `rotacion_direccion_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Intercambiar P1 y P2. Hay 3,4 mm de diferencia entre lados (umbral 3,0 mm).»
- **Fuente y confianza:** Michelin (fuente 1) fija 3/32 de pulgada como punto para considerar la rotación y menos de eso como no rotar; Goodyear indica girar a unos 3 mm de diferencia (fuente 7); Overdrive resume disparadores de 3/32 a 5/32 (fuente 12, no abierta). Confianza media: hay consenso en el orden de magnitud y variación de un par de milímetros. La rotación de dirección de lado a lado es práctica común, no reglamento.
- **Qué no hace:** no rota direccionales a otro eje (R7).

### R3 · Retiro de direccionales

- **Condición:** `promedio` de una posición de dirección menor o igual a `direccion_retiro_mm`.
- **Parámetro:** `direccion_retiro_mm`, por defecto 5,0 mm, rango 3,2 a 8,0. El mínimo del rango es el piso legal de EE. UU. para ruedas delanteras (4/32 de pulgada, 3,2 mm; fuente 2). El valor por defecto es una práctica de flota (5 a 6/32 de pulgada, fuentes 3 y 4); no hay consenso de fabricantes.
- **Texto:** «Cambiar neumático en P2: dirección con 4,6 mm (retiro a 5,0 mm).»
- **Confianza:** alta para el piso legal de EE. UU.; baja a media para el valor por defecto. Pregunta al dueño (sección 10) por país y por la política real.
- **Buses:** el valor por defecto de dirección en bus es el mismo; la diferencia es la frecuencia de revisión (R10) y la prohibición de recauchutados adelante (R9).

### R4 · Duales: emparejar el par

- **Condición:** dentro de un mismo par dual (interna y externa del mismo lado y eje), la diferencia de `promedio` es mayor que `rotacion_dual_max_mm`.
- **Parámetro:** `rotacion_dual_max_mm`, por defecto 3,0 mm, rango 2,0 a 4,0. Ya existe con ese valor en el diseño base de [15](15-rotacion-alertas-rendimiento.md) sección A.
- **Texto:** «Emparejar duales de P7 y P8: 4,2 mm de diferencia. Cambiar P8 por una cubierta de 6 a 9 mm.»
- **Acción sugerida:** primero buscar, en el mismo eje, un intercambio con otra cubierta que deje ambos pares dentro de tolerancia; si no existe, sugerir un cambio con una cubierta del stock apta y de profundidad cercana a la de la compañera. Rotar interna con externa no cierra la diferencia de diámetro, solo equilibra el desgaste a largo plazo.
- **Fuente y confianza:** FleetOwner/TIA (fuente 8): hasta 4/32 de pulgada de profundidad; cada 1/32 más allá reduce la vida de ambas. Transport Engineer (fuente 7): guía de la federación británica hasta 4 mm; Goodyear Reino Unido no más de 2 a 3 mm. School Bus Fleet (fuente 9) usa límites de diámetro (0,5 pulgadas) y circunferencia (0,75 pulgadas) que en profundidad no se traducen de forma directa. Confianza media: el rango entre fuentes (2 a 4 mm) es el rango del parámetro.
- **Condición adicional:** si ambas cubiertas tienen `medida` y son distintas, la regla da prioridad a «Revisar medida del par»; si la medida es nula se omite la comprobación y el texto avisa «medida sin registrar».

### R5 · Tracción: rotar entre ejes y lados

- **Condición:** ejes de tracción con diferencia de promedio de eje (promedio de sus cubiertas) mayor o igual a `rotacion_traccion_dif_mm`; los pares duales se mueven completos.
- **Parámetro:** `rotacion_traccion_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Rotar eje 2 con eje 3 y cruzar los lados: el eje 3 tiene 3,6 mm menos de profundidad que el eje 2.»
- **Fuente y confianza:** Michelin (fuente 1): el eje trasero se gasta más que los intermedios; rotar a mitad de vida. Overdrive (fuente 12, no abierta): tracción adelante-atrás, de lado a lado o en X, con 3/32 a 4/32 de diferencia. Confianza media-baja: las cifras vienen de resúmenes y hay desacuerdo sobre cruzar lados; se deja el cruce como parte del texto y no como obligación.
- **Requisito:** rol de eje configurado. Sin él, esta regla no se emite (el modelo actual solo identifica la dirección).
- **Atomicidad:** requiere `neumatico_permutar` (sección 3); con dos intercambios no atómicos se puede dejar una posición con una cubierta de baja o con dos operaciones a medio terminar.

### R6 · Arrastre y remolque

- **Condición:** ejes con rol arrastre, diferencia de promedio entre el último eje y el medio mayor o igual a `rotacion_arrastre_dif_mm`.
- **Parámetro:** `rotacion_arrastre_dif_mm`, por defecto 3,0 mm, rango 2,0 a 5,0.
- **Texto:** «Alternar los ejes 4 y 5: el último eje tiene 3,3 mm menos de profundidad.»
- **Fuente y confianza:** Transport Engineer (fuente 7): en remolque de tres ejes el último eje se gasta más y conviene alternar medio y último. Una sola fuente de prensa especializada: confianza baja. Por ello la regla está desactivada por defecto en la primera entrega.

### R7 · No pasar una direccional a otra posición sin aprobación

- **Condición:** una cubierta de dirección llegó a `direccion_retiro_mm` o a un umbral de reubicación, y `apto_otra_posicion` no es verdadero.
- **Efecto:** la sugerencia es siempre «Cambiar neumático»; nunca mover a tracción.
- **Texto:** «Cambiar neumático en P1: no hay aprobación registrada para usarla en otra posición.»
- **Fuente y confianza:** Goodyear (fuente 10) y Overdrive (fuente 12): cada tipo de cubierta va en su posición; mover una direccional solo si el fabricante la aprueba para ese modelo. Es práctica de un fabricante respaldada por la mayoría de las guías: confianza media. Continental (fuente 7) describe pasar la dirección con unos 3 a 4 mm a otro eje tras reranurar; se trata como práctica de un solo fabricante y no entra por defecto.

### R8 · Cuándo no rotar

Se suprime la sugerencia de rotación (no la de retiro) cuando:

1. **Falta poco para retirar:** `semanas_hasta_retiro` menor que `rotacion_espera_semanas` o `promedio` a menos de 2 mm de `umbral_retiro_mm`. Parámetro `rotacion_espera_semanas`, por defecto 4, rango 0 a 12. Bridgestone Costa Rica (resumen de búsqueda, fuente 13): con desgaste considerable conviene reemplazar en vez de rotar. Confianza media.
2. **Rotación reciente:** el último evento `rotacion` de la cubierta tiene menos de `rotacion_espera_dias` (30 por defecto, [15](15-rotacion-alertas-rendimiento.md) sección A, rango 7 a 90). Propio; sin fuente directa.
3. **Cubierta en recauchutado o dada de baja:** la guardia de la base ya la bloquea (`neumatico_rotar` y apéndice L de [08](08-esquema-datos.md)); la sugerencia no la ofrece.
4. **Diferencia menor que la mínima:** por debajo del umbral de la regla (Michelin, fuente 1: 0 a 2/32 de pulgada de diferencia, no rotar). Confianza media-alta.
5. **Causa mecánica sin corregir:** R1.

Como Toyo opina (resumen de búsqueda, fuente 13) que fuera de casos específicos la rotación cuesta mano de obra con poco retorno, la regla errará hacia no sugerir.

### R9 · Cubiertas recauchutadas y retiro para recauchutar

- **Retiro para recauchutar:** si el cliente recauchuta (`recauchuta = true`, pregunta al dueño), una cubierta de vida baja cuyo `promedio` es menor o igual a `recauchutar_mm` y cuya carcasa aún admite otra vida, se sugiere para recauchutado y no para descarte.
- **Parámetro:** `recauchutar_mm`, por defecto 4,8 mm (6/32 de pulgada), rango 3,5 a 8,0. Hoy `umbral_retiro_mm` es 3 mm y sirve para descarte, no para recauchutar; hace falta un parámetro nuevo.
- **Texto:** «Retirar P5 para recauchutado: queda 4,6 mm (umbral 4,8 mm).»
- **Fuente y confianza:** TRIB, vía Tire Review (fuente 14, resumen de búsqueda: la página devolvió 403): retirar a unos 6/32 de pulgada. School Bus Fleet (fuente 9) dice que 6/32 suele alcanzar para recauchutar la carcasa. Dos fuentes, una solo por resumen: confianza media-baja.
- **Direccionales recauchutadas:** el valor por defecto para buses es no montar recauchutadas en el eje 1; para camiones es configurable. En EE. UU. 49 CFR 393.75(d) lo prohíbe en las ruedas delanteras de buses (fuente 2); las prácticas recomendadas de la industria lo desaconsejan en larga distancia (fuente 11); el TRIB lo trata como elección y no como mandato (fuente 11). Brasil también lo prohíbe en buses (solo por resumen de búsqueda). Confianza alta para el bus; media para camión.

### R10 · Intervalo por kilómetros o tiempo

- **Hallazgo:** no hay consenso. Michelin rota a media vida según la tasa de desgaste y no da intervalo en kilómetros (fuente 1); Goodyear menciona unas 125.000 millas para el tándem, cifra poco fiable; los intervalos comerciales van de 8.000 a 10.000 km (blog, fuente 15) y de 30.000 a 75.000 millas (resúmenes de búsqueda).
- **Recomendación:** no usar los kilómetros como disparador. El disparador es la diferencia de desgaste (R2, R5, R6). Como recordatorio secundario, `rotacion_recordatorio_dias` (nulo por defecto, rango 30 a 365): si hay cubiertas sin rotar ni medir por más de ese plazo, avisar «Revisar rotación del vehículo: 120 días sin rotar». Los kilómetros solo se usarían con `km_confiable` verdadero.
- **Buses de pasajeros:** el disparador es el mismo; sube la frecuencia de medición: School Bus Fleet (fuente 9) describe revisión diaria de neumáticos y presión semanal, profundidad mensual. El parámetro `dias_sin_medir_alerta` ya cubre la frecuencia de medición.
- **Confianza:** alta en que no hay consenso; baja en cualquier cifra.

### R11 · Alineación entre reglas

Orden de evaluación: R0, R1, R8 y luego R3, R9, R7, R2, R4, R5, R6. Si una cubierta recibe una sugerencia de retiro, no se le ofrece rotación en el mismo ciclo. Máximo 3 sugerencias por vehículo en pantalla, ordenadas por seguridad (retiro de dirección primero).

## 5. Reposición

Alcance: sugerir cuántas cubiertas comprar por medida y rol de eje. Es una sugerencia revisable, nunca una compra automática ([16](16-hoja-de-ruta.md) F8).

- **Necesidad neta** = demanda durante el plazo de entrega + seguridad − cubiertas aptas disponibles.
- **Demanda durante el plazo:** cantidad de cubiertas montadas cuya `semanas_hasta_retiro` es menor o igual al plazo de entrega más un margen. Es un conteo por regla, sin pronóstico estadístico.
- **Plazo de entrega:** parámetro `reposicion_plazo_semanas`, por defecto 4, rango 1 a 26 (dato de negocio: pregunta al dueño).
- **Seguridad:** `reposicion_seguridad_pct`, por defecto 10 % de las cubiertas montadas de esa medida, mínimo 1, rango 0 a 30 %.
- **Aptas disponibles:** stock con `estado = 'almacenado'`, `condicion` apta y en la sucursal del vehículo; se excluyen las cubiertas en proceso de recauchutado.
- **Dirección aparte:** las direccionales se cuentan por separado porque no se reutilizan en otras posiciones (R7).
- **Texto:** «Comprar 3 neumáticos 295/80 R22,5: 5 llegan al retiro en 4 semanas, hay 2 en stock y 1 de seguridad.»
- **Fuente y confianza:** la forma ROP = D·L + SS es el modelo estándar de reposición de inventario (min-max); heavyvehicleinspection lo describe sin fórmula de seguridad (fuente 16) y no hay guía específica de neumáticos. Confianza media en la forma; baja en los valores por defecto (los fija el negocio).
- **Prerrequisito:** `neumaticos.medida` (sección 3). Sin ella, la reposición agrupa por rol de eje y lo declara.

## 6. Casos límite y de seguridad

| Caso | Comportamiento |
|---|---|
| Sin medición, o medición vieja | R0: «Medir primero». Ninguna otra sugerencia sobre esa posición |
| Medición con calidad invalidada | Se ignora; se aplica R0 si no queda otra válida |
| Medición sospechosa | La sugerencia se emite pero marcada «Medición dudosa» (calidad ya existe, apéndice I de [08](08-esquema-datos.md)) |
| Cubierta en recauchutado | Excluida de rotación y de retiro; el stock apto no la cuenta |
| Cubierta dada de baja | Excluida; la base ya rechaza el intercambio |
| Posición vacía | Una rotación hacia posición vacía mueve la cubierta; se ofrece solo si la regla lo justifica, no por defecto |
| Stock insuficiente | La sugerencia de cambio se emite con aviso «Sin stock apto; ver reposición» |
| Vehículo sin km confiables | Los kilómetros no intervienen; no se muestra recordatorio por km |
| Eje sin rol configurado | Solo se emiten R0, R1, R2 (eje 1) y R4 (duales) |
| Eje 1 con medidas distintas a izquierda y derecha | «Revisar medida del par»; no se sugiere rotar |
| Una sola cubierta medida del par | No se sugiere nada; R0 pide medir la otra |
| Datos de ejes extra (17 a 98) | No se sugiere rotación; se muestra aviso «Eje sin soporte de rotación» hasta que el montaje los admita |
| Dos rotaciones simultáneas | La base serializa por posición; la vista recarga tras aplicar |

## 7. Flujo para el operario

Cuenta de clics sobre la ficha del vehículo, según la sección 5 de [14](14-guia-de-textos.md):

| Tarea | Hoy | Propuesto |
|---|---|---|
| Rotar dos posiciones | 4 a 5 clics: tocar la rueda, abrir el desplegable, elegir destino, «Rotar», confirmar si hay intercambio (`assets/js/views/vehiculo-detalle.js:312-319`, `assets/js/views/cambio-neumatico.js:150-166`) | 1 clic: «Aplicar» en la tarjeta de la sugerencia; la sugerencia ya es la confirmación |
| Rotación en cruz | No existe como operación única | 1 clic con `neumatico_permutar` |
| Ejecutar una sugerencia de cambio | 3 a 4 clics desde «Cambiar neumático» | 2 clics: «Cambiar neumático» abre el formulario con la posición y el motivo ya completados |
| Ver por qué se sugiere | No aplica | 0 clics: el motivo es la frase visible de la tarjeta |

Pautas: una acción primaria por tarjeta; la tarjeta muestra qué mover, hacia dónde y la regla en una frase; «Aplicar» registra la rotación sin pedir odómetro (campo opcional, nunca precompletado); si el operario no está de acuerdo, un solo botón secundario «Ignorar» oculta la sugerencia hasta la próxima medición. No se usa color como único indicador: cada tarjeta lleva un texto de prioridad («Seguridad», «Desgaste», «Medir»). Los textos usan el vocabulario de [14](14-guia-de-textos.md): «Rotar», «Cambiar neumático», «recauchutado», «posición vacía», «Sin dato».

## 8. Criterio de prueba

La función pura (propuesta: `recomendarRotacion(vehiculo, filas, opciones)` en `assets/js/domain/rotacion.js`, sin DOM ni supabase) devuelve una lista de sugerencias `{regla, tipo, posiciones, texto}` y una lista de bloqueos. Cada fila de la tabla siguiente se convierte en un test unitario en `tests/unit/rotacion.test.mjs`. Los valores usan los parámetros por defecto.

| ID | Regla | Entrada | Resultado esperado |
|---|---|---|---|
| T01 | R0 | P1 con `dias_desde_medicion` = 31 | «Medir primero P1»; ninguna otra sugerencia sobre P1 |
| T02 | R0 | P1 con `dias_desde_medicion` = 30 y diferencia de 3,5 mm con P2 | Sugiere intercambiar P1 y P2 (30 no supera el máximo) |
| T03 | R0 | P1 con `ultima_medicion_at` nula | «Medir primero P1» |
| T04 | R1 | P1 con `mm1` = 9, `mm2` = 8, `mm3` = 6,5 | «Revisar alineación»; sin rotación de P1 |
| T05 | R1 | P5 con `mm1` = 9, `mm2` = 6,5, `mm3` = 9 | «Revisar presión» por centro gastado |
| T06 | R1 | P5 con `mm1` = 6, `mm2` = 8,6, `mm3` = 6 | «Revisar presión» por hombros gastados |
| T07 | R1 | P5 con `mm1` = 9, `mm2` = 8, `mm3` = 9 | Sin bloqueo por causa |
| T08 | R2 | P1 = 10 mm, P2 = 7,0 mm | Intercambiar P1 y P2 (diferencia exacta de 3,0 mm: sugiere) |
| T09 | R2 | P1 = 10 mm, P2 = 7,1 mm | Sin sugerencia de rotación |
| T10 | R2 | P1 = 10 mm, P2 = 6 mm y P1 con causa R1 | Sin rotación; se muestra R1 |
| T11 | R3 | P2 = 5,0 mm (dirección) | «Cambiar neumático en P2» (igual al umbral: sugiere) |
| T12 | R3 | P2 = 5,1 mm | Sin sugerencia de retiro |
| T13 | R3 | P2 = 4,6 mm y P1 = 10 mm | Solo retiro de P2, sin intercambio P1 y P2 |
| T14 | R4 | P7 = 10 mm, P8 = 7,0 mm | Sin sugerencia (diferencia de 3,0 mm no supera el máximo de 3,0) |
| T15 | R4 | P7 = 10 mm, P8 = 6,9 mm | «Emparejar duales de P7 y P8» |
| T16 | R4 | P7 y P8 con medidas distintas registradas | «Revisar medida del par» |
| T17 | R4 | P7 y P8 con medida nula | Se evalúa por profundidad y el texto indica «medida sin registrar» |
| T18 | R5 | Eje 2 con promedio 10 y eje 3 con promedio 6,4 | «Rotar eje 2 con eje 3» (diferencia de 3,6 mm) |
| T19 | R5 | Mismo caso sin rol de eje configurado | Sin sugerencia R5 |
| T20 | R6 | Eje 4 = 9 mm y eje 5 = 5,7 mm, con rol arrastre y R6 activa | «Alternar los ejes 4 y 5» |
| T21 | R7 | P1 en 4,8 mm con `apto_otra_posicion` nulo | «Cambiar neumático en P1»; nunca mover a tracción |
| T22 | R8 | P2 con `semanas_hasta_retiro` = 3 y diferencia de 4 mm con P1 | Sin sugerencia de rotación |
| T23 | R8 | P1 rotada hace 10 días y diferencia de 4 mm | Sin sugerencia de rotación |
| T24 | R8 | P1 y P2 con 2,5 mm de diferencia | Sin sugerencia de rotación |
| T25 | R9 | P5 vida 1 en 4,8 mm con cliente que recauchuta | «Retirar P5 para recauchutado» |
| T26 | R9 | P5 vida 3 (carcasa agotada) en 4,8 mm | «Cambiar neumático en P5» (no recauchutar) |
| T27 | R9 | Cubierta recauchutada en eje 1 de un bus | Aviso «No montar recauchutadas en dirección» |
| T28 | R10 | Cliente sin `rotacion_recordatorio_dias` | Sin recordatorio |
| T29 | R10 | Recordatorio de 120 días, 121 días sin rotar | «Revisar rotación del vehículo: 121 días sin rotar» |
| T30 | Reposición | 5 cubiertas llegan al retiro en el plazo, 2 aptas en stock, seguridad 1 | Necesidad neta = 4 (5 + 1 − 2) |
| T31 | Reposición | Necesidad neta calculada negativa | Cero; nunca se sugiere devolver |
| T32 | Reposición | Cubiertas aptas en proceso de recauchutado | No se cuentan como disponibles |
| T33 | Regresión de datos | Mm nulos | Nulo, nunca cero: sin dato, sin sugerencia |
| T34 | Límite de pantalla | Cuatro sugerencias válidas en un vehículo | Se muestran 3, con el retiro de dirección primero |

Además de los unitarios: una prueba e2e (`npm run e2e`) por cada nueva RPC y por cada columna de parámetros, con el JWT de cada rol (admin, global, sucursal, sin perfil, `api`), según las reglas de [13](13-checklist-revision-prs.md).

## 9. Plan de implementación

PR chicos y en serie, cada uno con su verificación. Nunca dos migraciones en producción a la vez.

| # | Contenido | Migración | Notas |
|---|---|---|---|
| 1 | Dominio puro `rotacion.js` y tests T01 a T24 y T33 a T34, con eje 1 como dirección y el resto sin clasificar | No | Sin interfaz; se puede revisar solo |
| 2 | Parámetros por cliente (columnas con valores por defecto y rango) y edición en la configuración | Sí | Idempotente, `check` por rango; apéndice nuevo en [08](08-esquema-datos.md) |
| 3 | Rol de eje, `medida` y `apto_otra_posicion` más lectura en `v_estado_neumaticos` si se justifica | Sí | Antes de aplicar, el director consulta a `neumet-dba` por la vista |
| 4 | Vista: tarjeta de sugerencias en la ficha y «Aplicar» con `neumatico_rotar`; clics contados en el PR | No | Para rotación en cruz hace falta la permutación del PR 5 |
| 5 | `neumatico_permutar` (rotación atómica de varios pares) y R5 y R6 | Sí | Pruebas SQL y e2e por rol |
| 6 | Dominio de reposición, tests T30 a T32 y vista de sugerencia de compra | No (usa los parámetros del PR 2) | Requiere medida del PR 3 para agrupar por medida |

Cada PR de este plan actualiza en el mismo PR el apéndice de [08](08-esquema-datos.md) que corresponda y el tablero [10](10-tablero.md).

## 10. Preguntas para el dueño

Solo de lógica de negocio; lo técnico queda resuelto arriba.

1. **Política de retiro de direccionales:** ¿a cuántos milímetros se retiran hoy en los camiones y en los buses? El valor por defecto propuesto es 5,0 mm con piso de 3,2 mm.
2. **País o norma aplicable:** ¿en qué país operan los clientes con flota pesada y qué profundidad mínima legal exige la inspección? Los pisos legales verificados son de EE. UU.; México y Brasil se encontraron solo en resúmenes y Chile y Argentina no tienen un valor oficial hallado para pesados.
3. **Recauchutado:** ¿los clientes recauchutan, en qué posiciones lo permiten y cuántas vidas de carcasa admiten?
4. **Intervalos actuales:** ¿cada cuánto rotan hoy y quién lo decide (taller propio o externo)? Sirve para fijar el recordatorio y para medir si la sugerencia mejora algo.
5. **Reposición:** ¿cuál es el plazo real de entrega de cubiertas y cuánta reserva de seguridad toleran en dinero o en unidades?
6. **Buses:** ¿los buses de pasajeros llevan duales atrás y simples adelante en todos los casos? ¿Hay buses de dos ejes que hoy se cargan como camión de 10 ruedas con el eje 3 vacío?

## 11. Fuentes

Consultadas el 2026-11-13. Se parafrasea; las cifras se contrastaron con al menos dos fuentes en las reglas importantes. «Abierta» significa que se leyó la página completa; «resumen» que solo se vio el extracto del buscador.

| N.º | Fuente | Tipo | Estado |
|---|---|---|---|
| 1 | Michelin Reino Unido, [Truck tyre rotation](https://business.michelin.co.uk/help-advice/truck/tyre-maintenance-truck-tyre-rotation) | Fabricante | Abierta |
| 2 | eCFR, [49 CFR 393.75](https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-49?part=393&section=393.75) | Norma de EE. UU. | Abierta |
| 3 | School Bus Fleet, [Tire maintenance best practices](https://www.schoolbusfleet.com/10010314/tire-maintenance-best-practices) | Prensa de buses | Abierta |
| 4 | Transit RFTA (dirección a 6/32, tracción o tag a 4/32) | Operador de buses | Resumen |
| 5 | Michelin EE. UU., [Uneven commercial truck tire wear](https://business.michelinman.com/tips-suggestions/truck/uneven-commercial-truck-tire-wear) | Fabricante | Abierta |
| 6 | heavyvehicleinspection, [Tire wear pattern diagnosis](https://heavyvehicleinspection.com/article/tire-wear-pattern-diagnosis-alignment-fleet) | Sitio comercial | Abierta |
| 7 | Transport Engineer (Reino Unido), [Tyre rotation for commercial vehicles](https://www.transportengineer.org.uk/content/features/tyre-rotation-for-commercial-vehicles) | Prensa; cita a Michelin, Goodyear, Continental | Abierta |
| 8 | FleetOwner, Rohlwing (TIA), [Playing matchmaker](https://www.fleetowner.com/equipment/article/21687894/playing-matchmaker), 2014 | Prensa y asociación | Abierta |
| 9 | School Bus Fleet (misma de la fuente 3) para duales de bus | Prensa de buses | Abierta |
| 10 | Goodyear Europa, [Steer, drive, trailer](https://www.goodyear.eu/en_gb/truck/knowledge-centre/truck-tyre-types-steer-drive-trailer.html) | Fabricante | Abierta |
| 11 | Modern Tire Dealer, [Retreads on steer axles](https://www.moderntiredealer.com/articles/29202-the-myth-behind-using-retreads-on-steer-axles) | Prensa | Abierta |
| 12 | Overdrive, «Tire rotation» y «Stop and swap» (la primera ya citada en [15](15-rotacion-alertas-rendimiento.md)) | Prensa de transporte | Solo resumen: la página devolvió 403 |
| 13 | Bridgestone Costa Rica (autos), Toyo, Bridgestone: citas por resumen del buscador | Fabricantes | Resumen |
| 14 | TRIB, vía Tire Review ([15](15-rotacion-alertas-rendimiento.md) cita la página `?p=59825`) | Asociación | Resumen: 403 |
| 15 | 91trucks, blog de intervalos | Blog comercial | Abierta; baja fiabilidad |
| 16 | heavyvehicleinspection, fórmulas de reposición min-max | Sitio comercial | Abierta |

No se pudieron abrir: Overdrive (403), Tire Review (403), Fleet Equipment (403), BusMARC, USTMA (PDF), la página de Continental Reino Unido (solo navegación) y el PDF de la NOM-068-SCT-2-2014 de México (ilegible). No se halló el texto de la práctica recomendada TMC RP 235; solo se cita de forma indirecta.

Normas de profundidad mínima:

- EE. UU. (FMCSA, 393.75): 4/32 de pulgada (3,2 mm) en ruedas delanteras y 2/32 (1,6 mm) en el resto. Verificada (fuente 2).
- México (NOM-068-SCT-2-2014): 3,2 mm en dirección o remolque de materiales peligrosos y 1,6 mm en ejes sin dirección. **Sin verificar**: solo resumen del buscador.
- Brasil (Resolución CONTRAN 913/2022): 1,6 mm general y prohibición de reformados en el eje delantero de buses. **Sin verificar**: solo resumen del buscador.
- Chile y Argentina: no se halló valor oficial para vehículos pesados.

Ningún país se asume: el umbral queda configurable y es una pregunta al dueño.

### Reglas de menor confianza

R6 (arrastre: una sola fuente), R5 (cruce de lados: cifras de resúmenes), R9 (valor de retiro para recauchutar), R10 (sin consenso de intervalos), R3 (valor por defecto) y los valores por defecto de la reposición.
