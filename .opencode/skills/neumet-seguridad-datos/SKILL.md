---
name: neumet-seguridad-datos
description: Reglas de seguridad de datos de NEUMET: la visibilidad se cumple en la base (RLS), RLS filtra filas y no columnas, privilegios por columna para precios y costos, pruebas con el JWT de cada rol, secretos y gitleaks. Cargar cuando un cambio toca RLS, roles, RPC, Edge Functions o cualquier dato sensible.
---

# Seguridad de datos en NEUMET

## Visibilidad
- La visibilidad se hace cumplir en la base, nunca solo en la interfaz.
- La RLS filtra **filas**, no **columnas**. Para ocultar una columna (precios, costos) se usan privilegios por columna (`revoke` / `grant` sobre columnas).
- Roles a probar: admin, global, sucursal, sin perfil, `api`.

## Cómo se prueba
- Con la API real y el JWT de cada rol, no solo con el smoke simulado.
- Lo que toque la base se prueba también en `npm run e2e`.
- Cada política nueva trae prueba por rol: que el rol permitido ve y el no permitido no.

## Edge Functions
- Todas `verify_jwt = false`: cada handler valida JWT y rol por su cuenta.

## Secretos
- Sin claves ni contraseñas de ejemplo de alta entropía en ningún commit. gitleaks escanea todas las ramas y el historial.
- Nunca ampliar el allowlist de `.gitleaks.toml` para acomodar un valor.
- No pedir ni pegar claves secretas en la conversación.

## Revisión
- Leer la migración o política entera, no el diff.
- Si el riesgo sobre datos reales de clientes es alto, decirlo explícitamente en el informe.
