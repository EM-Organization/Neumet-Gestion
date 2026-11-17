# 13 · Checklist de revisión de PR y criterio de pruebas

Lo que debe cumplir un PR para fusionarse. Lo aplica el revisor y el autor lo verifica antes de abrir el PR.
Un PR chico o solo de docs lo revisa uno; uno grande, hasta tres revisores en paralelo con foco acotado (seguridad/base/RLS; UX y textos; concurrencia y pruebas mutantes) y el director consolida un solo veredicto (ver `neumet-orquestar`).
**Bloqueante** es lo que causa pérdida de datos, una elección del usuario perdida, una fuga entre roles o una afirmación falsa en la documentación; el resto es sugerencia. Desde la ronda 1 el revisor las separa.

## 1. Rigor al buscar bugs
El revisor no se limita a leer el diff: ejecuta los caminos nuevos.
- Probar con datos vacíos, con `null`, con un solo registro y con muchos.
- Probar con cada rol (admin, cliente global, cliente de sucursal) y con una sesión sin perfil.
- Pensar qué cambia respecto a producción: caché del navegador, orden de carga de módulos, datos reales vs datos de prueba.
- Buscar el caso negativo: qué pasa si la consulta falla, si el campo no existe, si el usuario no tiene permiso.
- Un PR que arregla un bug incluye un test que **falla sin el arreglo**.
- Una regla de visibilidad de datos («la sucursal no ve precios») se hace cumplir en la base, no solo en la interfaz: la RLS filtra filas, no columnas. Se prueba con la API real y el JWT de cada rol, pidiendo la columna directa, con `select=*`, con filtro/orden y embebida.
- `select('*')` sobre `clientes` da `42501` desde C2 (privilegios por columna, `precio_mensual` sin SELECT): revisar que toda lectura o `.update().select()` de `clientes` en el front y en las pruebas nombre sus columnas.

### 1.b Concurrencia y estado compartido (guardas, colas, doble envío, reintentos, recargas)
Antes de implementar, el autor deja media página de diseño (operaciones, claves de guarda, qué pasa si dos llegan a la vez o una nunca responde) y prefiere el arreglo más simple (guardar formularios, no controles idempotentes como un select).
Autor y revisor comprueban, con una prueba que falla sin el arreglo, cada caso aplicable:
- Doble envío (dos clics o dos Enter seguidos).
- Enter mantenido (`e.repeat`).
- Cambios superpuestos del mismo control (queda la última elección del usuario).
- Operaciones distintas simultáneas (una no bloquea ni descarta a la otra).
- Fallo a mitad de la operación (estado coherente, mensaje claro, se puede reintentar).
- Respuesta que nunca llega (la interfaz no queda bloqueada para siempre).
- Recarga que pisa texto sin guardar.

## 2. Pruebas completas
- Toda lógica nueva tiene pruebas unitarias con casos límite, no solo el camino feliz.
- Toda política RLS o función SQL nueva tiene pruebas SQL para cada rol permitido y cada rol denegado.
- Los smoke con datos simulados no bastan por sí solos: los datos simulados pueden no coincidir con la base real (un buscador pasó los smoke y falló en producción). Los flujos de usuario se prueban también contra la base real local con los datos de demo (ver `tests/e2e/`, cuando exista).
- Cualquier `console.error` o "Acción desconocida" durante un flujo hace fallar la prueba.
- Las aserciones comprueban resultados concretos (filas, textos, permisos), no que "algo apareció".

## 3. Revisión visual (PR que toca la interfaz)
- El revisor genera capturas con `tests/visual/run.sh` y las mira, en escritorio y en móvil.
- Se rechaza si hay texto cortado, elementos superpuestos, tablas desbordadas, contraste insuficiente o dependencia exclusiva del color.
- Estilo: minimalista, colores apagados, un solo énfasis por pantalla. El rojo solo para lo realmente crítico.
- ¿El PR declara los clics de las tareas frecuentes que toca y no los aumenta sin justificación? (ver `docs/14-guia-de-textos.md`, sección 5; en un PR de interfaz el revisor puede apoyarse en el agente `neumet-ux`)
- **Pregunta fija sobre el menú:** ¿el PR agrega, mueve, renombra o duplica algo del menú o de una pestaña? ¿Dónde lo buscaría un operario? Si la respuesta es «en dos lugares» o «no es evidente», se rechaza o se justifica por escrito. La fuente de verdad es [docs/12](12-mapa-navegacion.md) (sección 4): el PR la actualiza en el mismo cambio y el revisor la compara con el menú que ve.

## 4. Copy (textos de la interfaz)
- Tono profesional y neutro, frases cortas, sin humor, exclamaciones, emojis ni diminutivos.
- Si un texto no ayuda a decidir o actuar, se elimina.
- Los estados vacíos dicen qué hacer, en una frase.
- Los comentarios del código explican el porqué, no narran lo obvio.

## 5. Despliegue
- Si el PR trae migración, el revisor la lee entera (permisos, `search_path`, RLS) y avisa al director; se aplica antes de fusionar el front que la usa.
- Si cambia archivos servidos por Vercel, comprobar el efecto de la caché.
- Nunca fusionar con CI rojo; nunca ampliar el allowlist de secretos para acomodar un valor de ejemplo.

## 6. Auditoría UX por tareas al cerrar una fase
Al cerrar cada fase que toca la interfaz (F8, F10, F11 y siguientes), antes de darla por terminada, el director lanza `neumet-ux` (skill `neumet-auditoria-ux`) para recorrer las tareas frecuentes por rol: medir, cambiar, rotar, montar, ver alertas, consultar el stock y, según la fase, administrar usuarios y sucursales.
- Se cuentan los clics de cada tarea y se comparan con el conteo anterior de `docs/10`; un aumento sin justificación es un hallazgo.
- Se revisa que cada tarea se encuentre en un solo lugar del menú, de acuerdo con [docs/12](12-mapa-navegacion.md) (sección 4).
- Se mira la pantalla en escritorio y en móvil, con los textos de [docs/14](14-guia-de-textos.md) (sección 5).
- El resultado (conteos y hallazgos) se anota en `docs/10`; los hallazgos pendientes pasan a tareas del tablero, no se pierden en el cierre.
