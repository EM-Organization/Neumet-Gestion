# NEUMET Gestión (web) — Especificación de arreglos de UI: detalle de vehículo

Versión 1 · 2026-11-21 · Idioma de la interfaz: **español únicamente**.
Acompaña a `neumet-web-tokens.json` (estados, medidas del gráfico, contrastes) y a `neumet-tokens.json` (paleta base). Si hay conflicto, manda el archivo de tokens.
Pantalla: «Detalle de vehículo» (migas «Vehículos › Coche N»). Capturas de referencia: Coche 192 y Coche 179.

## 0. Reglas para el agente

1. Implementa solo lo que está aquí. Si falta un dato, deja `// TODO(neumet-web: <ID>)` y **no inventes** reglas, textos ni campos. Los IDs están en la sección 10.
2. **No cambies reglas de negocio.** Este trabajo unifica cómo se *muestra* el estado de desgaste. Antes de tocar nada, localiza en el código dónde se calcula hoy el estado de cada neumático, el estado del vehículo y la bandera de desgaste acelerado. Describe esas reglas en la descripción del cambio. Si encuentras un caso que contradice esta especificación, no lo corrijas en silencio: anótalo.
3. Mantén el framework, la librería de gráficos y los componentes que ya usa el proyecto. No agregues dependencias (`TODO-ROUTE-STACK`).
4. Los umbrales (8, 5 y 3 mm en las capturas) **se leen de la configuración de Umbrales**. Ningún número de umbral aparece escrito en el código ni en los textos.
5. Un solo lugar calcula el estado (4.1). Diagrama, chips, etiquetas, gráfico y estado del vehículo lo llaman. Está prohibido recalcularlo por separado.
6. Todos los textos visibles salen de la sección 8. Todos los colores y medidas salen de `neumet-web-tokens.json`. Sin hexadecimales sueltos en componentes.
7. Cada elemento interactivo o con estado lleva el identificador de prueba (`testId`) indicado.
8. Los valores de las capturas (patentes, lecturas) son de maqueta. Úsalos como casos de prueba (4.3), no como datos de producción.

## 1. Contexto y alcance

Pantalla maestro-detalle de un vehículo:
- **Encabezado**: título «Coche N», estado del vehículo, acciones, y cinco datos (matrícula, número de coche, sucursal, odómetro, última medición).
- **Tarjeta del esquema** (izquierda): chips de estado, esquema de neumáticos en vista superior (frente arriba, neumático de auxilio aparte), leyenda.
- **Panel del neumático** (derecha): título, etiquetas, datos, última medición, evolución del desgaste, velocidad de desgaste, alertas, historial y acciones.

**Dentro del alcance**: todo el sistema de estado de desgaste (4 a 7), el gráfico, la tarjeta fija, las acciones del encabezado y el vocabulario (secciones 5 a 7).
**Fuera del alcance** (no tocar): ver sección 11.

## 2. Diagnóstico y cambios

| ID | Qué se ve hoy | Cambio | Sección |
|---|---|---|---|
| W-01 | El relleno del neumático es un **degradado continuo** por milímetros y el símbolo (✓ ▲ ×) es una **categoría**. Se contradicen cerca de los límites: P8 con 5,1 mm (▲) se ve casi igual de rojo que P3 con 4,9 mm (×); P4 y P8 comparten ▲ y tienen colores distintos | Relleno **discreto**, uno por estado. El número en milímetros ya expresa la magnitud | 4, 5.2 |
| W-02 | Barra degradada «< 3 · 5 · ≥ 8 mm» y leyenda inferior que solo explica «Desconocido» y «Desgaste mayor al normal». No existe chip ni leyenda para ✓ | Se eliminan la barra y la leyenda inferior. Los chips de arriba son la leyenda, incluido ✓ | 5.1 |
| W-03 | Gráfico con líneas punteadas. Cada rótulo nombra la banda que queda **por encima** de su línea, pero no se entiende. Los rótulos aparecen cortados («Poco desgas», «Mayor desga») | Bandas de color con nombre y rango **dentro** del área, sin recortes | 5.4 |
| W-04 | «Nuevo 8» en el gráfico mientras P5 mide 16,0 mm y también se llama «Nuevo» | El nombre del estado pasa a «Buen estado» (`TODO-STATUS-NAMES`) | 4.2 |
| W-05 | Con una lectura baja el eje no deja espacio para la banda superior (Coche 192: eje de 2 a 8). Con una lectura alta el punto queda pegado a la esquina del eje (Coche 179) | Eje desde 0, con margen superior sobre el umbral más alto y margen lateral | 5.4 |
| W-06 | «Mayor desgaste» (nivel de profundidad) y «Desgaste mayor al normal» (velocidad) suenan igual y son cosas distintas | La segunda pasa a «Desgaste acelerado» (`TODO-STATUS-NAMES`) | 4.4 |
| W-07 | La insignia «!» flota sobre el neumático sin anclaje claro y el neumático ya tiene su propio símbolo | Insignia de 16 anclada al borde superior, igual en todos | 5.2 |
| W-08 | La tarjeta del esquema se desplaza con la página y sale de la vista (en Coche 179 los chips quedan cortados bajo la barra superior). Bajo la leyenda queda un hueco | Tarjeta fija al hacer scroll | 6 |
| W-09 | «Cambiar distribución» queda pegado al título y «Eliminar vehículo» no se diferencia de otras acciones | Grupo de acciones a la derecha; la destructiva en rojo con diálogo de confirmación | 5.7 |
| W-10 | «Interno / Externo» (la app dice «Interna / Externa»); la unidad aparece solo en «Promedio»; «distribución» en la web y «configuración» en la app | Vocabulario y formatos unificados | 7 |

**Por qué estados discretos y no degradado.** Los umbrales son configurables y disparan alertas, así que el estado es una decisión, no una magnitud. Con un degradado, dos neumáticos de estados distintos pueden verse iguales y uno solo puede verse de un color que no corresponde a su estado. La magnitud sigue visible: cada neumático muestra sus milímetros y el gráfico muestra la evolución.

## 3. Tokens

Ver `neumet-web-tokens.json`. Resumen:

| Estado | Relleno | Trazo | Símbolo | Texto |
|---|---|---|---|---|
| `bueno` | #E4EAD3 (`NeumetSuccessTint`) | 2 #4F6B26 (`NeumetSuccess`) | ✓ #4F6B26 | Buen estado |
| `poco` | #F8E4B5 | 2 #B9791A | ▲ #7A4E08 | Poco desgaste |
| `mayor` | #F7E3E0 (`NeumetErrorTint`) | 2 #B3362A (`NeumetError`) | × #8E2419 (`NeumetErrorOnWhite`) | Mayor desgaste |
| `sinDatos` | #EBEBEB (`NeumetLightGrey`) con rayado de 45° (`NeumetTruckOutline`, 1 de grosor, 5 de separación) | 2 punteado #857F66 (`NeumetInputBorder`) | — | Sin datos |

- Bandera «Desgaste acelerado»: círculo de 16, relleno `NeumetDeepOlive`, «!» blanco, aro blanco de 2.
- Selección del neumático: trazo de 3 `NeumetDeepOlive` (en lugar de los 2 del estado). Foco de teclado: contorno de 3 `NeumetGoldDeep` con separación de 2.
- Contrastes (calculados): trazos y símbolos ≥ 3:1 sobre blanco; texto ≥ 4.5:1. Los rellenos se parecen en luminosidad entre sí: se distinguen por tono, trazo y símbolo, **nunca solo por relleno**.
- Texto sobre rellenos de estado: `NeumetDeepOlive` (≥ 9.9:1) o `NeumetOliveDark` (≥ 5.5:1).
- Está prohibido interpolar colores entre estados: cada neumático usa exactamente uno de los cuatro.

## 4. Modelo de estado único

### 4.1 Función `wearStatus`

```
wearStatus(tire, thresholds) -> "bueno" | "poco" | "mayor" | "sinDatos"
  si tire no tiene lectura            -> "sinDatos"
  m = valor mostrado en el neumático  (hoy: el promedio de las 3 zonas; ver TODO-STATUS-MEASURE)
  m >= thresholds.buen                -> "bueno"
  thresholds.poco <= m < thresholds.buen   -> "poco"
  thresholds.mayor <= m < thresholds.poco  -> "mayor"
  m <  thresholds.mayor               -> comportamiento actual, ver TODO-BELOW-MAYOR
```

Principios:
- **El número que ves es el número con el que se decide el estado.** `m` es exactamente el valor que muestra el neumático en el esquema.
- Los límites son el valor inferior de cada banda. Inclusivo en el inferior, exclusivo en el superior (`TODO-BOUNDARY`).
- Los tres valores salen de Umbrales (en las capturas, 8, 5 y 3 mm). Si varían por tipo de neumático, eje o vehículo: `TODO-THRESHOLD-SCOPE`.

### 4.2 Nombres de los estados

| Estado | Nombre hoy | Nombre propuesto |
|---|---|---|
| `bueno` | «Nuevo» | **«Buen estado»** |
| `poco` | «Poco desgaste» | igual |
| `mayor` | «Mayor desgaste» | igual |
| `sinDatos` | «Desconocido» | **«Sin datos»** |

«Nuevo» se aplica hoy a cualquier neumático de 8 mm o más (en las capturas, 11,3 y 16,0 mm), y un neumático de 8 mm que parte de 16 está a mitad de vida. Decisión del equipo: `TODO-STATUS-NAMES`.

### 4.3 Casos de prueba (de las capturas)

| Captura | Neumático | Valor | Estado esperado | Bandera |
|---|---|---|---|---|
| Coche 192 | P1 | 4,9 | `mayor` | sí |
| Coche 192 | P2 | 5,3 | `poco` | no |
| Coche 192 | P3 | 4,7 | `mayor` | no |
| Coche 192 | P4 | 6,8 | `poco` | no |
| Coche 192 | P5 | 7,3 | `poco` | no |
| Coche 192 | P6 | 6,2 | `poco` | no |
| Coche 192 | P7 | 11,3 | `bueno` | no |
| Coche 192 | P8 | 11,5 | `bueno` | no |
| Coche 192 | AUX | 7,0 | `poco` | no |
| Coche 179 | P1 | 7,1 | `poco` | no |
| Coche 179 | P2 | 7,8 | `poco` | no |
| Coche 179 | P3 | 4,9 | `mayor` | no |
| Coche 179 | P4 | 7,3 | `poco` | sí |
| Coche 179 | P5 | 16,0 | `bueno` | no |
| Coche 179 | P6 | 16,0 | `bueno` | no |
| Coche 179 | P7 | 15,0 | `bueno` | no |
| Coche 179 | P8 | 5,1 | `poco` | sí |
| Coche 179 | AUX | 7,7 | `poco` | no |

Con umbrales 8, 5 y 3: Coche 192 debe sumar 2 `mayor`, 5 `poco`, 2 `bueno` y 1 bandera. Coche 179 debe sumar 1 `mayor`, 5 `poco`, 3 `bueno` y 2 banderas. Las banderas son las que muestran las capturas y su regla no se cambia (4.4). Si hoy el cálculo da otro estado para algún caso de la tabla, aplica la regla 2 de la sección 0.

### 4.4 Bandera «Desgaste acelerado»

- Es una bandera **independiente** del estado: un neumático puede ser `poco` y tener bandera (P4 y P8 de Coche 179).
- Se muestra como insignia en el neumático (5.2), como chip (5.1) y como etiqueta en el panel (5.3).
- Regla de cálculo: la actual (`TODO-RATE-RULE`). No se cambia.
- Nombre: «Desgaste acelerado» (`TODO-STATUS-NAMES`). Deja de existir el texto «desgaste mayor al normal».

### 4.5 Estado del vehículo

El chip junto al título del vehículo («× Mayor desgaste») usa el mismo componente de etiqueta (5.3). Regla: la actual (`TODO-VEHICLE-STATUS-RULE`; en las capturas coincide con el peor estado entre sus neumáticos). Si el neumático de auxilio entra o no en el cálculo: `TODO-AUX-IN-STATUS`.

## 5. Componentes

### 5.1 StatusChips (`status-chips`)

Fila de chips al inicio de la tarjeta del esquema. **Es la leyenda y a la vez el filtro**. Reemplaza a la leyenda y a la barra degradada de abajo.

Orden y contenido:
1. `chip-total`: «{n} neumáticos» (incluye el de auxilio). Fondo blanco, borde 1.5 `NeumetTruckOutline`. Sirve para limpiar el filtro.
2. `chip-mayor`, `chip-poco`, `chip-bueno`: símbolo + conteo + nombre + rango, por ejemplo «× 2 Mayor desgaste · 3–5 mm». Solo se muestran los estados con conteo mayor que 0.
3. `chip-sinDatos`: solo si hay neumáticos sin datos. Muestra el rayado en lugar del símbolo.
4. `chip-acelerado`: «! {n} Desgaste acelerado». Solo si hay alguno. Va al final.

Medidas y estilo:
- Alto 32, radio 16, padding horizontal 12, gap interno 6, gap entre chips 8, con salto de línea.
- Estados: relleno y borde 1.5 del color del estado (tabla de la sección 3), texto `NeumetDeepOlive` 13/600, rango 13/400 `NeumetOliveDark`.
- Rangos: se calculan de los umbrales y se formatean con coma y «mm»: `bueno` «≥ {buen} mm», `poco` «{poco}–{buen} mm», `mayor` «{mayor}–{poco} mm». Descripción completa en el atributo de accesibilidad: «de {poco} mm a menos de {buen} mm».

Comportamiento:
- Cada chip de estado y el de bandera es un botón con `aria-pressed`.
- Tocar un chip **resalta** los neumáticos de ese estado y atenúa los demás (opacidad `dimOpacity`). Los atenuados siguen siendo tocables. Tocar de nuevo o tocar `chip-total` limpia. Selección única. No cambia el neumático seleccionado ni el panel.
- La suma de los conteos de estado es igual al total de neumáticos.

### 5.2 TireNode (`tire-{posición}`)

Tamaño y disposición **no cambian** (incluido el neumático de auxilio con su rótulo «Auxilio»).

Contenido, de arriba abajo: etiqueta de posición («P3», 11/700 `NeumetOliveDark`), valor (15/800 `NeumetDeepOlive`, un decimal con coma), símbolo del estado (12).
- Relleno, trazo (2) y color del símbolo según el estado (sección 3). **Un estado, un color.** Sin degradados.
- `sinDatos`: rayado, trazo punteado, valor «—» y sin símbolo.
- Seleccionado: trazo de 3 `NeumetDeepOlive`.
- Foco de teclado: contorno `focusOutline`.
- Atenuado por el filtro: opacidad `dimOpacity`.
- **Insignia de bandera**: círculo de 16 con «!» (token `flagAcelerado`), centrado horizontalmente sobre el borde superior del neumático y metido 4 hacia adentro. Aro blanco de 2. Se dibuja sobre el neumático y sus vecinos. No cubre la etiqueta de posición. Es la misma en todos los neumáticos.
- Información al pasar o enfocar (tooltip): «P3 · Eje 2 izquierda exterior · 4,7 mm · Mayor desgaste». Si tiene bandera, agrega «· Desgaste acelerado».
- Tocar el neumático lo selecciona y abre su detalle en el panel.

### 5.3 StatusTag (`status-tag`)

Etiqueta de estado en el panel del neumático y junto al título del vehículo.
- Alto 28, radio 14, padding horizontal 10, gap 6. Mismo relleno, borde 1.5 y símbolo que el chip, sin conteo ni rango.
- Texto: nombre del estado (13/600 `NeumetDeepOlive`).
- Si hay bandera, segunda etiqueta (`flag-tag`): fondo blanco, borde 1.5 `NeumetDeepOlive`, círculo de 16 con «!» y el texto «Desgaste acelerado».

### 5.4 WearChart (`wear-chart`)

Sustituye al gráfico actual. **Las bandas del gráfico son las mismas bandas del modelo 4.1 y usan los colores de estado.**

Eje Y:
- Mínimo 0. Máximo = el mayor entre `buen + headroomAboveBuenMm` y la lectura máxima redondeada hacia arriba al múltiplo de 4. Con umbrales 8/5/3: Coche 192 (4,7 mm) → 0–12; Coche 179 (16,0 mm) → 0–16.
- Marcas cada 4 (12/400 `NeumetOliveDark`). Los umbrales no son marcas: sus valores van en los rótulos de banda.

Bandas (de abajo hacia arriba), a todo el ancho del área de trazado:

| Rango | Relleno | Rótulo |
|---|---|---|
| 0 a `mayor` | estilo `mayor` | sin rótulo propio (`TODO-BELOW-MAYOR`) |
| `mayor` a `poco` | estilo `mayor` | «Mayor desgaste · {mayor}–{poco} mm» |
| `poco` a `buen` | estilo `poco` | «Poco desgaste · {poco}–{buen} mm» |
| `buen` al máximo | estilo `bueno` | «Buen estado · ≥ {buen} mm» |

- Los rótulos van **dentro** del área, alineados a la derecha con 8 de margen, 12/600 `NeumetOliveDark`. Nunca se recortan ni salen del contenedor. Si una banda mide menos de 20 de alto, su rótulo se oculta (el chip ya la nombra).
- No hay líneas punteadas de umbral. Desaparece el texto «Nuevo {n}». Una referencia de «profundidad de neumático nuevo» solo se dibuja si el dato existe por neumático (`TODO-NEW-DEPTH`).

Serie (`TODO-CHART-SERIES`, hoy el promedio):
- Con 2 o más lecturas: línea de 2 `NeumetDeepOlive` y puntos de radio 5 con relleno del color de trazo del estado de esa lectura y aro blanco de 2. El último punto, radio 6.
- Con **una sola lectura**: solo el punto, centrado horizontalmente, y su fecha debajo. No se dibuja línea. El gráfico se muestra igual (las bandas muestran dónde está la lectura).
- Margen lateral del área de trazado: `plotInsetXPx` (24). El punto nunca toca el eje.
- Sin lecturas: no se dibuja el gráfico (el estado vacío queda fuera de esta especificación).
- Alto 220, ancho 100 % del panel.

Eje X: fechas con formato «20 nov» (con año cuando el rango cruza un año).

Interacción y accesibilidad:
- Al pasar o enfocar un punto: tooltip con fecha, interna, centro, externa, promedio y estado.
- El gráfico tiene `role="img"` y una descripción: «Evolución del desgaste de {posición}: {n} lecturas, última {x} mm el {fecha}, estado {estado}».
- Debajo, un control «Ver datos» (cerrado por defecto) que despliega una tabla con fecha, interna, centro, externa, promedio y estado.

### 5.5 MeasurementTable (`last-measurement`)

- Encabezados: «Interna», «Centro», «Externa», «Promedio» (12/700, mayúsculas, interletrado 0.08, `NeumetOliveDark`).
- Valores con un decimal y coma, **sin unidad en las celdas**. La unidad va en el título de la sección: «Última medición (mm)». Se quita el «mm» suelto de «Promedio».
- Debajo: «Medido el {fecha}».

### 5.6 Panel del neumático (cambios)

- Título como hoy («Eje 2 izquierda exterior»), luego las etiquetas de identidad (posición, marca, recauchutado), luego `StatusTag` y, si corresponde, `flag-tag`.
- Al elegir otro neumático el panel vuelve al inicio y, si el inicio del panel quedó fuera de la vista, el documento se desplaza hasta mostrarlo (sin animación si el usuario pidió reducir movimiento).

### 5.7 Acciones del encabezado (`page-actions`)

- Grupo alineado a la derecha del título, gap 12, alto 40: «Cambiar distribución» (secundario: borde 1.5 `NeumetOliveDark`, texto `NeumetDeepOlive`) y «Eliminar vehículo» (destructivo: borde 1.5 `NeumetError`, texto `NeumetErrorOnWhite`). La destructiva va **última** y separada visualmente (gap 24 respecto de la anterior).
- «Eliminar vehículo» abre `ConfirmDialog` (`delete-vehicle-dialog`). No elimina con un solo toque. Si ya existía una confirmación, se ajusta a esta.

**ConfirmDialog**: `role="alertdialog"`, ancho 440, radio 16, padding 24, fondo blanco, fondo atenuado `NeumetScrim`.
- Título: «¿Eliminar {Coche N}?». Texto: qué se pierde (`TODO-DELETE-CONSEQUENCES`).
- Botones: «Cancelar» (secundario) y «Eliminar vehículo» (relleno `NeumetError`, texto blanco).
- Foco inicial en «Cancelar». El foco queda atrapado en el diálogo. Escape y tocar el fondo cierran. Durante la eliminación: botón con progreso y deshabilitado. Si falla, mensaje dentro del diálogo y el diálogo no se cierra.
- «Cambiar distribución» conserva su flujo actual. Si la web debe ofrecer el mismo selector visual con miniaturas de la app: `TODO-DISTRIBUTION-PICKER`.

## 6. Layout

- La **tarjeta del esquema** queda fija: `position: sticky`, desplazamiento superior = alto de la barra superior + 16, alineada al inicio de la cuadrícula, con alto máximo `calc(100vh − barra − 32)`. Solo si el contenido supera ese alto, la propia tarjeta puede tener scroll interno (caso de vehículos con muchos ejes).
- El **panel del neumático no tiene scroll interno**: crece con la página. Solo desplaza el documento.
- Los anchos de las dos columnas no cambian.
- Debajo de 1024 de ancho: una columna, el esquema arriba sin quedar fijo (`TODO-BREAKPOINTS`).
- Con la tarjeta fija, el hueco que hoy queda bajo la leyenda deja de verse.

## 7. Vocabulario y formatos

| Tema | Regla |
|---|---|
| Zonas | «Interna», «Centro», «Externa» (concuerda con «zona» y con la app) |
| Números | Coma decimal, un decimal, punto de miles. Ejemplo: «4,7 mm», «214.195 km» |
| Unidad | «mm» una sola vez por tabla o título; en chips, tooltips y rótulos de banda siempre con «mm» |
| Fechas | «20/11/2026» en texto; «20 nov» en el eje del gráfico |
| Estados | Nombres de la sección 4.2 |
| Bandera | «Desgaste acelerado» |
| Términos pendientes de unificar con la app | «distribución» (web) y «configuración» (app): `TODO-TERM-DISTRIBUCION`. Nombre de ejes: la web usa «Eje N» para todos; la app usa «Delantero», «Trasero» y «Eje N»: `TODO-AXLE-NAMES-WEB`. Género de lado: «izquierda» (web) frente a «izquierdo» (app): `TODO-SIDE-GENDER`. Separador decimal de la app: la especificación de la app usa punto: `TODO-DECIMAL-FORMAT` |

## 8. Catálogo de textos (es)

| Clave | Texto |
|---|---|
| status.bueno | Buen estado |
| status.poco | Poco desgaste |
| status.mayor | Mayor desgaste |
| status.sinDatos | Sin datos |
| flag.acelerado | Desgaste acelerado |
| chips.total | {n} neumáticos |
| chips.range.bueno | ≥ {buen} mm |
| chips.range.rango | {a}–{b} mm |
| chips.aria | {n} neumáticos con {estado}, de {a} mm a menos de {b} mm |
| tire.tooltip | {posición} · {nombre} · {x} mm · {estado} |
| tire.aux | Auxilio |
| tire.empty | — |
| chart.title | Evolución del desgaste |
| chart.band.bueno | Buen estado · ≥ {buen} mm |
| chart.band.poco | Poco desgaste · {poco}–{buen} mm |
| chart.band.mayor | Mayor desgaste · {mayor}–{poco} mm |
| chart.aria | Evolución del desgaste de {posición}: {n} lecturas, última {x} mm el {fecha}, estado {estado} |
| chart.showData | Ver datos |
| chart.hideData | Ocultar datos |
| chart.col.date | Fecha |
| chart.col.estado | Estado |
| meas.title | Última medición (mm) |
| meas.col.interna | Interna |
| meas.col.centro | Centro |
| meas.col.externa | Externa |
| meas.col.promedio | Promedio |
| meas.date | Medido el {fecha} |
| actions.changeLayout | Cambiar distribución |
| actions.delete | Eliminar vehículo |
| dialog.delete.title | ¿Eliminar {Coche N}? |
| dialog.delete.text | [POR DEFINIR: `TODO-DELETE-CONSEQUENCES`] |
| dialog.cancel | Cancelar |
| dialog.delete.confirm | Eliminar vehículo |
| dialog.delete.error | [POR DEFINIR: `TODO-DELETE-CONSEQUENCES`] |

## 9. Accesibilidad

- Un estado nunca se comunica solo con color: siempre símbolo y texto.
- Chips: botones con `aria-pressed` y la etiqueta de `chips.aria`.
- Neumático: botón. Etiqueta: «Posición {P#}, {nombre}, {x} milímetros, {estado}», más «, desgaste acelerado» si tiene bandera y «, seleccionado» si lo está.
- Contraste: texto ≥ 4.5:1; trazos y símbolos ≥ 3:1 (valores en `neumet-web-tokens.json › contrast_checked`).
- Foco visible en todo lo interactivo. El diálogo atrapa el foco y devuelve el foco a «Eliminar vehículo» al cerrar.
- Gráfico: texto alternativo y tabla de datos (5.4).
- Respetar la preferencia de reducir movimiento (desplazamientos y animaciones).
- Orden de foco: encabezado, chips, neumáticos, panel.

## 10. Pendientes (no inventar)

| ID | Qué falta |
|---|---|
| TODO-ROUTE-STACK | Ruta de la pantalla, framework y librería de gráficos del proyecto (esta especificación no los impone) |
| TODO-STATUS-MEASURE | Con qué valor se decide hoy el estado: el promedio (el que muestra el neumático) o la zona más baja. Debe ser el valor mostrado |
| TODO-BOUNDARY | Qué pasa con un valor exactamente igual a un umbral (propuesta: el límite inferior pertenece a la banda de arriba) |
| TODO-BELOW-MAYOR | Estado y nombre de una lectura por debajo del umbral más bajo (3 mm en las capturas). Mantener el comportamiento actual y documentarlo |
| TODO-THRESHOLD-SCOPE | Si los umbrales varían por tipo de neumático, eje o vehículo. Si varían, los rangos de los chips se calculan por neumático y las bandas del gráfico son las del neumático seleccionado |
| TODO-STATUS-NAMES | Decisión del equipo sobre «Buen estado» en lugar de «Nuevo», «Sin datos» en lugar de «Desconocido» y «Desgaste acelerado» en lugar de «desgaste mayor al normal» |
| TODO-RATE-RULE | Regla que activa la bandera de desgaste acelerado |
| TODO-VEHICLE-STATUS-RULE | Regla del estado del vehículo junto al título |
| TODO-AUX-IN-STATUS | Si el neumático de auxilio cuenta para el estado del vehículo (sí cuenta en el total «9 neumáticos») |
| TODO-CHART-SERIES | Qué serie se grafica hoy (se asume el promedio) y si deben verse las tres zonas |
| TODO-NEW-DEPTH | Si existe la profundidad de neumático nuevo por neumático, para dibujar una referencia |
| TODO-DELETE-CONSEQUENCES | Qué se elimina junto con el vehículo (neumáticos, mediciones, historial) y textos de error |
| TODO-DISTRIBUTION-PICKER | Si «Cambiar distribución» usará el selector visual con miniaturas de la especificación de la app |
| TODO-BREAKPOINTS | Ancho a partir del cual la pantalla pasa a una columna |
| TODO-TOOLTIP-FOCUS | Tooltip visible al enfocar una rueda con teclado (§5.2). Hoy el `<title>` SVG solo aparece con el mouse y el `aria-label` anuncia lo mismo a los lectores de pantalla; un tooltip propio al enfocar no está definido en la spec |
| TODO-TERM-DISTRIBUCION, TODO-AXLE-NAMES-WEB, TODO-SIDE-GENDER, TODO-DECIMAL-FORMAT | Unificación de vocabulario y formatos con la app (sección 7) |

> **Decisión del dueño (2026-11-21), TODO-STATUS-MEASURE:** el estado se decide con el valor CRUDO (promedio con 2 decimales, igual que la base y las alertas: 2,97 con umbral 3 es «Desgaste límite», 7,97 con umbral 8 es «Poco desgaste») y el número se MUESTRA TRUNCADO a 1 decimal (2,97 = «2,9»; 7,97 = «7,9») en el esquema, tooltips, tabla, gráfico y lectores de pantalla, de modo que lo que se ve coincide con lo que se decide. Un único helper (`fmtMedida`, `domain/estado-desgaste.js`). Sin migración.

> **Estado actual, TODO-AUX-IN-STATUS:** se mantiene la regla del producto (PR 140, `domain/auxilio.js`): el auxilio (posición 99) en mayor desgaste o límite cuenta como «Poco desgaste» en los chips y en la etiqueta de la cabecera, suma en el total, se dibuja con su estado real y no lleva «Desgaste acelerado». Chips, cabecera, insignia y filtro usan la misma regla (`estadoContable`, `banderaDeFila`).

## 11. Fuera del alcance

No forma parte de este cambio y no se debe modificar:
- La barra de acciones del neumático («Cambiar neumático», «Retirar neumático», «Rotar con la posición» y «Registrar costo»).
- Los estados vacíos repetidos («Sin dato» en varios datos, nota de odómetro suelta, sección de velocidad de desgaste y alertas).
- La estructura del encabezado de cinco datos, el menú lateral y la barra superior.
- El cálculo de la velocidad de desgaste y de las alertas.

## 12. Criterios de aceptación

Formato: dado / cuando / entonces.

1. **Estado único.** Dado un neumático con valor `m`, entonces su estado es el mismo en el esquema, el chip, la etiqueta del panel, el punto del gráfico y la banda donde cae, y todos lo obtienen de `wearStatus`.
2. **Casos de prueba.** Dados los valores de 4.3 y los umbrales 8/5/3, entonces `wearStatus` devuelve el estado de la tabla.
3. **Sin degradado.** El relleno de cada neumático es uno de cuatro colores. Dos neumáticos con el mismo estado tienen el mismo color. No existe la barra degradada ni la leyenda inferior.
4. **Chips como leyenda.** Hay un chip por cada estado con neumáticos, incluido «Buen estado», y la suma de sus conteos es igual al total. Cada chip muestra su rango calculado de los umbrales.
5. **Umbrales vivos.** Si cambian los valores en Umbrales, los estados, los chips y las bandas se actualizan sin editar código.
6. **Filtro.** Tocar un chip resalta sus neumáticos y atenúa el resto sin cambiar la selección. Tocar de nuevo limpia. Los atenuados siguen siendo tocables.
7. **Nombres.** No aparece en ninguna parte el texto «Nuevo» como estado ni «desgaste mayor al normal». La bandera dice «Desgaste acelerado».
8. **Insignia.** La insignia de bandera se dibuja igual en todos los neumáticos, no tapa la etiqueta de posición y no queda separada del neumático.
9. **Bandas.** El gráfico muestra bandas con nombre y rango dentro del área. Ningún rótulo queda recortado entre 1024 y 1920 de ancho.
10. **Coherencia del gráfico.** Para cualquier lectura, el nombre de la banda donde cae su punto es igual al nombre del estado de ese neumático.
11. **Eje.** Con una lectura de 4,7 mm el eje va de 0 a 12 y se ve la banda «Buen estado». Con una de 16,0 mm va de 0 a 16 y el punto no toca el eje.
12. **Una lectura.** Con una sola lectura se dibuja un punto centrado, sin línea, y su fecha.
13. **Varias lecturas.** Con dos o más, línea y puntos coloreados por estado.
14. **Tarjeta fija.** Con la página desplazada 600 de alto, el esquema y los chips siguen visibles. El panel del neumático no contiene ningún elemento con scroll interno.
15. **Selección.** Al elegir otro neumático, el panel vuelve al inicio y el neumático elegido muestra el trazo de 3.
16. **Eliminar.** «Eliminar vehículo» abre el diálogo y no elimina con un solo toque. Foco inicial en «Cancelar», Escape cierra, el foco queda atrapado.
17. **Acciones.** «Cambiar distribución» y «Eliminar vehículo» están agrupadas a la derecha del título, la destructiva en rojo y última.
18. **Vocabulario.** La tabla de última medición dice «Interna», «Centro», «Externa» y «Promedio», con coma decimal y sin «mm» en las celdas. El título dice «Última medición (mm)».
19. **Accesibilidad.** Cada neumático tiene etiqueta con posición, milímetros y estado. Los contrastes cumplen la sección 9.
20. **Alcance.** No se modificaron los elementos de la sección 11.
21. **Idioma.** Ningún texto visible contiene palabras en inglés.
