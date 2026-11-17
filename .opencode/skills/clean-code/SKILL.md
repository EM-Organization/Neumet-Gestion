---
name: clean-code
description: Criterios de código limpio para NEUMET: nombres descriptivos, funciones cortas, comentarios que explican el porqué, sin código muerto ni abstracciones prematuras, sanitización centralizada. Usar al escribir o corregir código antes de abrir el PR.
---

# Clean code en NEUMET

Antes de abrir el PR, revisar contra esta lista. El revisor juzga contra `docs/13`.

## Código
- Nombres que dicen qué hacen o qué contienen; si un nombre necesita un comentario, es mal nombre.
- Funciones cortas que hacen una cosa; early return antes de anidar.
- Comentarios: el porqué de una decisión, no lo obvio que ya dice el código. En español.
- Sin código muerto, sin variables de paso, sin flags que ramifican media función.
- Sin abstracción prematura: dos usos antes de extraer; el arreglo más simple que funcione (p. ej. guardar formularios en vez de controles idempotentes, ver `docs/13` §1.b).
- Casos límite pensados: vacío, `null`, un registro, muchos; consulta que falla; usuario sin permiso.

## Reglas propias del repo
- `assets/js/domain/` es lógica pura: sin DOM ni supabase. La vista orquesta, el dominio decide.
- `core/html.js` es el ÚNICO sumidero de `innerHTML`; todo lo demás arma DOM. ESLint `no-unsanitized` lo hace cumplir.
- Sin scripts inline (la CSP de `vercel.json` los bloquea).
- En `src/` (Svelte): un solo cliente supabase, sin `{@html}` (regla del lint propio).
- `select('*')` sobre `clientes` da `42501` desde C2: nombrar columnas siempre.

## Interfaz (si el cambio toca UI)
- Textos según `docs/14`: infinitivo, sin segunda persona, sin emojis ni exclamaciones, rojo solo para lo crítico, nunca solo color para comunicar estado.
- Un solo énfasis por pantalla; estilos minimalistas, colores apagados.
- No aumentar los clics de las tareas frecuentes sin justificación (declararlos en el PR).

## Al terminar
- `npm run lint` y `npm run check` en verde; luego el nivel del skill `neumet-verificar` que corresponda al diff.
