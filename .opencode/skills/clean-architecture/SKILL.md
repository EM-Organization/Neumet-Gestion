---
name: clean-architecture
description: Reglas de arquitectura de NEUMET: dependencias hacia adentro, domain/ sin DOM ni supabase, un único sumidero de innerHTML, un solo cliente supabase en src/, módulos ES sin bundler en el panel. Usar al diseñar un cambio o decidir dónde va un archivo nuevo.
---

# Clean architecture en NEUMET

## Capas y dirección de dependencias
```
vista (assets/js/views/)  →  dominio (assets/js/domain/)  →  datos (supabase)
        orquesta DOM                  lógica pura                  API/RLS
```
- Las dependencias van **hacia adentro**: el dominio no conoce el DOM ni supabase; la vista no inventa reglas de negocio.
- Lógica de negocio nueva → `assets/js/domain/` (pura, testeable unitariamente). Orquestación de pantalla → `views/`. Acceso a datos → capa de datos existente.
- `core/` es infraestructura compartida (html.js, helpers): no importa de `views/` hacia `domain/`.

## Reglas firmes del repo
- `core/html.js` es el único sumidero de `innerHTML` (la CSP bloquea scripts inline; `no-unsanitized` vigila).
- El panel es SPA de módulos ES **sin bundler ni framework**: sin pasos de build, sin dependencias nuevas de runtime sin justificación fuerte.
- `src/` es el front nuevo en Svelte 5 + Vite: un solo cliente supabase, sin `{@html}`. No mezclar estilos del panel viejo.
- La seguridad de datos vive en la **base** (RLS filtra filas; privilegios por columna ocultan precios/costos), nunca solo en la interfaz.
- Edge Functions: cada handler valida JWT y rol por su cuenta (`verify_jwt = false`); sin lógica de negocio duplicada entre función y panel.

## Dónde va cada cosa (guía rápida)
| Cambio | Archivo/lugar |
|---|---|
| Regla o cálculo de negocio | `assets/js/domain/` + unitarias |
| Pantalla, flujo, clics | `assets/js/views/` (+ smoke de los modos que toca) |
| Acceso a datos nuevo | Capa de datos + e2e |
| Tabla, vista, RPC, política | `supabase/migrations/` (idempotente) + pruebas por rol en `tests/sql/` |
| Texto visible | Según `docs/14`; menú según `docs/12` |
| Comportamiento nuevo | Mismo PR actualiza docs (`08`, `10`) |

## Antes de proponer una estructura nueva
- Diseño previo de media página para concurrencia/estado compartido (`docs/13` §1.b): operaciones, guardas, qué pasa si dos llegan a la vez.
- Preferir el cambio más pequeño que respete las capas; si un cambio fuerza reorganizar capas, separarlo en su propio PR.
