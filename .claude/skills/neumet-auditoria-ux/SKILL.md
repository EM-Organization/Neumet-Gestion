---
name: neumet-auditoria-ux
description: Auditar la UX/UI del panel de NEUMET navegándolo en un navegador real con datos simulados, recorriendo las tareas frecuentes del operario, contando clics y registrando confusiones, textos fuera de la guía, estados vacíos, accesibilidad y ancho móvil. Solo lectura. Lo usa el agente neumet-ux, y sirve para revisar visualmente un PR de interfaz.
---

# Auditoría de UX/UI

Argumento: alcance (todo el panel, una tarea, o un PR de interfaz).
Principio: `docs/14` sección 5 «Simplicidad para el operario» (8 reglas verificables; leerlas del archivo, no copiarlas aquí) y las reglas de texto de la sección 1. El operario sabe poco de tecnología.

## 1. Preparar el entorno (nunca producción)
1. Servidor local con datos simulados, un rol por vez:
   `tests/visual/navegar.sh global` (también `admin`, `sucursal`, `sinperfil`; sin argumento lista las 4 URL). Escucha solo en `127.0.0.1` (puerto 8793; `PORT=` para cambiarlo), responde 404 a rutas sensibles y sale con error si el puerto está ocupado. Corre en segundo plano (`run_in_background`). **Al terminar, detenerlo**: `TaskStop` sobre esa tarea o `kill -TERM <pid>`; Ctrl+C no sirve si se lanzó con `&`.
   Roles: `admin` = Neumet interno; `global` = administrador de empresa (ve Sucursales y selector); `sucursal` = perfil de una sucursal (sin selector); `sinperfil` = solo «Sin acceso».
2. Abrir la URL impresa en el navegador. El arnés muestra el panel en un iframe del mismo origen: los clics y formularios funcionan, los datos son del stub (`tests/smoke/stub.js`, fixtures) y se reinician al recargar. Con `VW=390 VH=844` se obtiene el ancho móvil.
3. **Elegir cómo navegar**, en este orden:
   a. **Herramientas MCP de navegador** (`mcp__claude-in-chrome__*`; cargar antes la skill `claude-in-chrome`). Paso previo del director o el usuario: la extensión Claude in Chrome conectada (`/chrome` o `claude --chrome`; un proyecto no puede activarla por configuración), permiso por sitio para `127.0.0.1`/`localhost` y el subagente en primer plano (no hay confirmación oficial de que funcione en segundo plano). El nombre del grupo (`mcp__claude-in-chrome__*`) depende de la sesión. Usar un **perfil de Chrome separado**, sin sesiones de producción ni de Supabase. Si faltan en la sesión (se comprueba con `ToolSearch` por «chrome»), pasar a (b) y decirlo.
   b. **Chrome headless con capturas por pasos**: `tests/visual/run.sh <escena>` (`ROLES`, `SIZES=desktop mobile`) o `--screenshot` sobre la URL de `navegar.sh`; mirar cada PNG con Read. Sirve para ver pantallas, **no** para encadenar clics: los clics de un recorrido se cuentan leyendo `data-action` y flujos de `tests/smoke/*.flow.js` y quedan **no verificados visualmente**.
   c. Playwright no está en el repo (las pruebas usan Chrome headless directo: `tests/e2e/lib/chrome.mjs`); no instalarlo para una auditoría.
   Alternativa con datos reales de demo y PostgREST real: `npm run e2e` los levanta, pero solo durante la prueba y sin modo interactivo; un arranque manual queda como pendiente (no inventarlo en la auditoría).
4. No iniciar sesión en producción, no pedir contraseñas, no tocar pestañas con sesión real. No abrir el puerto a la red ni compartir la URL del servidor.

## 2. Elegir las tareas
Lista inicial (existen en `assets/js/views/`; confirmar que siguen ahí con `grep`):
| Tarea | Dónde | Vista |
|---|---|---|
| Ver un vehículo y su estado | Inicio (buscador) → Vehículos → detalle con diagrama | `inicio.js`, `vehiculos.js`, `vehiculo-detalle.js` |
| Revisar la última medición de una rueda | detalle del vehículo → rueda; Inicio «Últimas mediciones» | `vehiculo-detalle.js`, `inicio.js` |
| Registrar una medición | Se hace en la app móvil, no en el panel: verificar que el panel lo deje claro y no ofrezca un camino roto | `mediciones.js` (admin) |
| Cambiar un neumático | detalle → rueda → cambiar (`neumatico-cambiar`) | `cambio-neumatico.js` |
| Rotar un neumático | detalle → rueda → rotar (`neumatico-rotar-pos`) | `vehiculo-detalle.js` |
| Montar un neumático en un coche vacío | detalle vacío → montar (`neumatico-montar`), del stock o cubierta nueva | `montar-neumatico.js` |
| Retirar un neumático | detalle → rueda → retirar (`neumatico-retirar`) | `vehiculo-detalle.js` |
| Ver y reconocer alertas | Alertas | `alertas.js` |
| Ver stock y buscar una cubierta | Stock | `stock.js` |
| Revisar mediciones a revisar (calidad) | Inicio → «Revisar» | `calidad.js` |
Agregar las que pida el alcance. Escenarios del stub útiles: vehículo con neumáticos (patente `AB123CD`) y coche sin neumáticos (`301`, `tests/smoke/montar.fixture.js`; en `navegar.sh` usar `global`, que ya trae `detalle=1`; para `montar=1` agregarlo a la URL a mano).

## 3. Recorrer y registrar
Cada tarea, desde la pantalla de partida **como lo haría un operario** (sin atajos que solo conoce un desarrollador):
- **Pasos y clics**: contar clics, escrituras y desplazamientos hasta terminar; anotar el camino.
- **Campos obligatorios** y cuáles el sistema podría deducir (reglas 4 y 6 de `docs/14` §5). Dato no medido es nulo, nunca cero: no recomendar precompletar odómetro ni profundidades con valores anteriores (regla 4); el último odómetro puede mostrarse solo como referencia, con el campo vacío.
- **Un camino principal** por pantalla: ¿se ve cuál es la acción primaria sin desplazarse? (regla 1).
- **Teclado**: Enter envía, foco inicial, orden de tabulación (regla 3).
- **Confirmaciones**: ¿hay alguna sobre algo reversible? (regla 5).
- **Confusiones**: dónde un operario dudaría (jerga, códigos internos, íconos sin texto, pasos sin retorno). Probar el recorrido erróneo: dato vacío, volver atrás, cancelar.
- **Textos** contra `docs/14` §1: segunda persona, emojis, exclamaciones, «...» en lugar de «…», estado solo con color.
- **Estados vacíos y de error**: ¿dicen qué pasó y qué hacer?
- **Accesibilidad básica**: foco visible, contraste, botones con nombre, `Esc` cierra el modal, tamaño táctil.
- **Móvil** (390 px): sin desplazamiento horizontal, acciones alcanzables con el pulgar, tablas legibles.
- Repetir con los roles relevantes (la misma tarea puede cambiar para sucursal o sin permiso).

## 4. Informe
Tabla por tarea:
| Tarea | Rol | Clics | Campos obligatorios | Hallazgos | Prioridad |
Prioridad: **P1** bloquea o confunde una tarea frecuente; **P2** fricción evitable (clics o campos de más); **P3** pulido. Cada hallazgo: evidencia (captura o texto exacto), regla de `docs/14` violada, recomendación concreta y esfuerzo estimado (S/M/L). Cerrar con:
- **Conteo de referencia** de clics por tarea frecuente: es el que `docs/14` §5 regla 2 pide para la auditoría de `docs/10`.
- **Qué no se pudo verificar** y por qué (sin navegador interactivo, datos simulados, rol no probado). Nunca como «ok».
- Para un PR de interfaz: comparar los clics contra `main` y marcar cualquier aumento sin justificación.

El informe se devuelve como respuesta. No se edita el repo; los arreglos los hace un autor.
