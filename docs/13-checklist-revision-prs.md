# 13 · Checklist de revisión de PR y criterio de pruebas

Lo que debe cumplir un PR para fusionarse. Lo aplica el revisor y el autor lo verifica antes de abrir el PR.

## 1. Rigor al buscar bugs
El revisor no se limita a leer el diff: ejecuta los caminos nuevos.
- Probar con datos vacíos, con `null`, con un solo registro y con muchos.
- Probar con cada rol (admin, cliente global, cliente de sucursal) y con una sesión sin perfil.
- Pensar qué cambia respecto a producción: caché del navegador, orden de carga de módulos, datos reales vs datos de prueba.
- Buscar el caso negativo: qué pasa si la consulta falla, si el campo no existe, si el usuario no tiene permiso.
- Un PR que arregla un bug incluye un test que **falla sin el arreglo**.

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

## 4. Copy (textos de la interfaz)
- Tono profesional y neutro, frases cortas, sin humor, exclamaciones, emojis ni diminutivos.
- Si un texto no ayuda a decidir o actuar, se elimina.
- Los estados vacíos dicen qué hacer, en una frase.
- Los comentarios del código explican el porqué, no narran lo obvio.

## 5. Despliegue
- Si el PR trae migración, el revisor la lee entera (permisos, `search_path`, RLS) y avisa al director; se aplica antes de fusionar el front que la usa.
- Si cambia archivos servidos por Vercel, comprobar el efecto de la caché.
- Nunca fusionar con CI rojo; nunca ampliar el allowlist de secretos para acomodar un valor de ejemplo.
