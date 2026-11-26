---
name: neumet-interfaz
description: Reglas de interfaz de NEUMET: textos en infinitivo según docs/14, sin emojis ni exclamaciones, rojo solo para lo crítico, nunca solo color para estado, simplicidad para el operario y conteo de clics. Cargar cuando un cambio toca vistas, textos o flujos del panel.
---

# Interfaz en NEUMET

## Textos
- Guía: `docs/14-guia-de-textos.md`.
- Sin segunda persona: infinitivo («Elegir posición», no «Elige» ni «Elegí»).
- Sin emojis ni signos de exclamación.
- Rojo solo para lo crítico. Nunca solo color para comunicar estado: acompañarlo con texto o ícono.

## Simplicidad para el operario
- El operario tiene pocos conocimientos de tecnología. Pocos clics, «enter» para confirmar, sin pasos innecesarios.
- Todo cambio de interfaz se revisa contra `docs/14`, sección 5.
- El cambio declara los clics de las tareas frecuentes que toca y no los aumenta sin justificación.

## Módulos
- Lógica nueva de negocio en `assets/js/domain/` (sin DOM). La vista solo orquesta.
- Sin scripts inline: la CSP los bloquea. Todo `innerHTML` pasa por `core/html.js`.
