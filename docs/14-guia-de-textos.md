# 14 · Guía de textos y de simplicidad del panel

Reglas para todo texto visible: títulos, botones, estados vacíos, placeholders, avisos (toasts), diálogos y tooltips (secciones 1 a 4), y principio de simplicidad para el operario que rige toda decisión de UX/UI (sección 5). Complementa el apartado de copy de `docs/13-checklist-revision-prs.md`.

## 1. Reglas

1. Tono profesional y neutro. Sin humor, exclamaciones, emojis ni diminutivos.
2. Frases cortas. Si un texto no ayuda a decidir o a actuar, se elimina.
3. Nada que explique lo evidente (un título «Vehículos» no necesita el subtítulo «Lista de vehículos»).
4. **Forma de dirigirse al usuario**: el panel no usa segunda persona (ni «vos» ni «tú» ni «usted»). Las instrucciones van en infinitivo («Elegir posición», «Completar los datos») y los estados en forma nominal o impersonal («Sin mediciones registradas», «Sin permiso para editar umbrales»). Así el tono es el mismo en todas las pantallas y no depende del país del usuario.
5. Los errores dicen qué falta o qué pasó y, si existe, qué hacer, en una frase: «Falta el nombre o el cliente», «No se pudo guardar. Reintentar».
6. Los estados vacíos dicen qué pasa y, si hay una acción posible, la ofrecen: «Sin vehículos registrados», «Ningún vehículo coincide. Revisar la matrícula o el número de coche.»
7. El estado nunca se comunica solo con color: siempre hay texto y símbolo. El rojo se reserva a neumáticos críticos.
8. Puntos suspensivos con el carácter «…» (no tres puntos) en estados de carga.
9. Los comentarios del código explican el porqué, no narran lo obvio; sin tono informal.

## 2. Ejemplos antes y después

| Antes | Después |
|---|---|
| Hola, Transportes Alfa | Inicio (con el nombre del cliente en el subtítulo) |
| Bienvenido / Iniciá sesión para continuar | Acceso / Iniciar sesión para continuar |
| Todavía no hay vehículos. Cuando se registren vehículos van a aparecer acá. | Sin vehículos registrados |
| Revisá la matrícula o el número de coche. | Revisar la matrícula o el número de coche. |
| Elegí la posición… | Elegir posición… |
| Tocá una rueda del diagrama para ver su estado, sus mediciones y sus alertas. | Elegir una rueda del diagrama para ver su estado, mediciones y alertas. |
| Completá nombre y cliente | Falta el nombre o el cliente |
| No tenés permiso para cambiar neumáticos de este vehículo | Sin permiso para cambiar neumáticos de este vehículo |
| Revisá tu conexión e intentá de nuevo. | Revisar la conexión y reintentar. |
| No pudimos cargar los datos | No se pudieron cargar los datos |
| Creá tu primer cliente con el botón de arriba | Usar «Nuevo cliente» para crear el primero |
| Probá con otro término o filtro | Cambiar la búsqueda o el filtro |
| Guardá estas credenciales ahora: no se volverán a mostrar. | Guardar estas credenciales: no se vuelven a mostrar. |
| Vehículos que más urgen / Por debajo del límite: conviene cambiarlos. | Requieren atención (una frase de causa por vehículo) |
| Placeholder «Ej: Unidad 07» | Placeholder «Unidad 07» |

## 3. Términos

| Usar | No usar |
|---|---|
| neumático (el montado o en general) | goma, llanta |
| cubierta (solo en Stock: la unidad individual disponible hasta que se monta; «Agregar cubierta», «Cubierta del stock») | cubierta fuera de Stock, goma, llanta |
| posición, con nombre en las listas («Delantera izquierda», «Eje 2 derecha exterior») y mini vehículo; el número de posición solo en el diagrama del detalle y en el taller | lugar; «P1, P2…» en listas |
| ubicación (solo en Stock: la sucursal donde está la cubierta, o «Sin sucursal») | ubicación para una rueda de un vehículo (ahí se dice posición) |
| Nuevo, Usado, Reparado, Recauchutado (condición de la banda; Nuevo pasa solo a Usado al primer montaje) | reencauche, reencauchado, retread, «de segunda» |
| interno / centro / externo (huellas de la banda) | izquierda / derecha, borde |
| sucursal | seccional, filial (en la interfaz) |
| matrícula | patente (en la interfaz; la columna de la base se llama `patente`) |
| número de coche | número interno, nº de unidad, nombre del vehículo |
| número de quema | número de serie, código de quema |
| km que ya traía el neumático | km de fábrica, km iniciales |
| Km recorridos (km en vehículos: tramos cerrados más el tramo actual); Km totales (km previos más recorridos); «Sin dato» cuando faltan odómetros | 0 km cuando el dato no existe; «km estimados» sin motivo |
| Estimado: faltan lecturas de odómetro; Estimado: hay lecturas de odómetro decrecientes; Sin dato: faltan lecturas de odómetro (notas de confiabilidad, siempre en texto) | tono de alarma o color como único indicador |
| Costo; Costo por km; Registrar costo; Muestra baja (menos de 5 neumáticos); «Comparar marcas sin ajustar por eje, carga y época puede engañar.»; «Sin costos registrados»; Monedas mixtas | gasto, precio por kilómetro, «CPK» en la interfaz |
| vehículo | camión, unidad (el vehículo se identifica por «Coche 106») |
| medición | lectura |
| dispositivo, medidor | sensor, calibre |
| crítico, desgaste bajo, OK, sin datos | rojo, amarillo, verde |
| Requieren atención | Urgentes, en problemas |
| alerta crítica (única alerta); Abierta, Reconocida, Silenciada; Reconocer, Silenciar 7 días, Resolver; «Nivel crítico» (mm) | alarma, incidente, ticket, «cerrar» |
| Próximos cambios | Pronósticos, predicciones |
| Montar neumático (poner uno en una posición vacía), Cargar neumáticos (montar varios en un vehículo sin ellos), Retirar neumático (sin reemplazo) | Colocar, instalar, sacar |
| posición vacía (rueda punteada: sin neumático montado) | rueda libre, hueco; no confundir con «sin datos» (neumático montado sin mediciones) |
| medición con observaciones, En revisión, Invalidar, Marcar como válida | medición rara, errónea, borrar medición |
| Cambiar neumático (acción del taller) | Reemplazar, sustituir |
| Rotar | Permutar, intercambiar |

El buscador de la barra superior y el de Inicio usan el texto «Matrícula, número de coche o quema» (la quema abre el vehículo donde está montado el neumático o, si es una cubierta en stock, la pantalla Stock filtrada por esa quema). El filtro de la lista de Vehículos usa «Matrícula o número de coche».

El campo `vehiculos.nombre` se presenta siempre como «Número de coche»: «Coche 106» cuando el nombre son solo dígitos; los nombres anteriores con texto se muestran tal cual.

## 3 bis. Criterio de «recauchutado» frente a «reencauche»

En la interfaz nueva se usa **recauchutado** (la condición «Recauchutado» y el destino «Recauchutado» al cambiar un neumático). Se alinearon solo los textos visibles donde el cambio es trivial y seguro: el destino del cambio de neumático, la etiqueta del tipo de evento, el mensaje de vida máxima («3 recauchutados») y la línea «recauchutado N» del panel de la rueda. **No** se cambian: los identificadores de código y de base de datos (`reencauche` como tipo de evento y destino de la RPC, `vida`), los comentarios históricos, ni los documentos de análisis (`docs/09`, `docs/15`, `docs/16`), que describen el dominio con ese término. Un texto nuevo usa siempre «recauchutado».

## 4. Revisión

El revisor busca en el diff: segunda persona («-á», «-és» en imperativos y «tu/tus»), exclamaciones, emojis, «Todavía», «acá», tres puntos en lugar de «…», placeholders con «Ej:» y comentarios que repiten el código. Un PR que añade un texto nuevo lo hace según esta guía.

## 5. Simplicidad para el operario

Decisión del 2026-11-13, confirmada con un cliente: el operario tiene pocos conocimientos de tecnología. La plataforma debe ser intuitiva, con flujos claros, pocos clics y «enter», sin pasos innecesarios ni confusos. Este principio rige cada decisión de UX/UI y se revisa en cada PR que toca la interfaz (casilla en `docs/13`). Reglas verificables:

1. **Un camino principal por pantalla**: una sola acción primaria, visible sin desplazarse, con el botón primario claramente distinguible. Las acciones secundarias no compiten con ella.
2. **Clics contados**: las tareas frecuentes (medir, cambiar, rotar, montar neumáticos) tienen un máximo de clics declarado en el PR. La referencia es el conteo de la auditoría pendiente (`docs/10`, Pendientes) y, mientras no exista, el conteo que declara el propio PR sobre `main`. Un cambio no puede aumentarlo sin justificarlo.
3. **Teclado**: en un formulario, «Enter» envía; el foco empieza en el primer campo útil y el orden de tabulación sigue el orden de lectura.
4. **Valores por defecto sensatos**: lo que casi siempre es igual viene completado (fecha de hoy, posición o vehículo en contexto). El operario corrige, no escribe desde cero. Ningún dato medido (odómetro, profundidades) se precompleta con un valor anterior: el último odómetro conocido puede mostrarse como referencia, pero el campo queda vacío hasta que el operario ingresa la lectura del día (dato no medido es nulo, nunca cero; `docs/16`, principio 5).
5. **Sin confirmaciones redundantes**: se confirma solo lo destructivo o irreversible. Lo reversible se hace y se ofrece deshacer cuando exista.
6. **Sin pasos ni campos que el sistema pueda deducir**: no se pide un dato que ya está en el contexto, y los campos opcionales no estorban el camino principal.
7. **Lenguaje llano**: mensajes y etiquetas sin jerga técnica ni códigos internos; el error dice qué pasó y qué hacer (regla 5 de la sección 1).
8. **Una pantalla, una tarea**: no se exige entender la estructura de datos (tablas, vidas, eventos) para completar una tarea.
