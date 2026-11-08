# Documentación técnica · NEUMET Gestión

Punto de partida: el [README](../README.md) de la raíz (qué es NEUMET, arquitectura, roles, panel, API, pruebas y despliegue). Los documentos de esta carpeta amplían cada tema. Estado de cada uno: **vigente** (se mantiene al día) o **referencia/histórico** (registro de decisiones; el estado actual está en el tablero).

## Vigentes
| Documento | Contenido |
|---|---|
| [07 · API de proveedor](07-api-proveedor.md) y [`api/openapi.yaml`](api/openapi.yaml) | Contrato, mapeo `mm1..mm4`, seguridad y decisiones de implementación (Apéndice A) |
| [08 · Esquema de datos](08-esquema-datos.md) | Tablas, RLS, RPC y un apéndice por migración (vistas, sucursales, cambio de neumático, mediciones por neumático, número de quema) |
| [10 · Tablero](10-tablero.md) | Estado de la infraestructura, lo hecho y los pendientes |
| [11 · Runbook de operación](11-runbook-operacion.md) | Crear administrador y cuentas de API, migraciones, funciones, rotación de claves, cutover |
| [12 · Mapa de navegación](12-mapa-navegacion.md) | Qué ve cada rol y a dónde lleva cada elemento |
| [13 · Checklist de revisión de PR](13-checklist-revision-prs.md) | Criterio de pruebas y de revisión |
| [14 · Guía de textos](14-guia-de-textos.md) | Reglas de redacción de la interfaz y de la documentación |
| [15 · Rotación, alertas y rendimiento](15-rotacion-alertas-rendimiento.md) | Diseño pendiente: recomendación de rotación, alerta única de estado crítico y rendimiento del indicador de desgaste |
| [16 · Hoja de ruta de producto](16-hoja-de-ruta.md) | Fases propuestas sin machine learning: stock individual, km por cubierta, calidad de datos, costo por km, recauchutado, alertas |
| [03 · Despliegue Vercel + Supabase](03-despliegue-vercel-supabase.md) | Plan de despliegue y decisiones de la CSP (la sección final está al día) |
| [06 · Identidad visual](06-identidad-visual.md) | Paleta, contraste, logos y tipografía (assets en [`assets/brand/`](../assets/brand/README.md)) |

## Referencia e histórico
| Documento | Contenido |
|---|---|
| [01 · Revisión de arquitectura](01-revision-arquitectura.md) | Diagnóstico inicial (2026-11-06) |
| [02 · Auditoría de seguridad](02-auditoria-seguridad.md) | Hallazgos iniciales y prioridades |
| [04 · Observabilidad y logging](04-observabilidad-logging.md) | Ingesta, auditoría, errores y alertas |
| [05 · Roadmap](05-roadmap.md) | Plan por fases, con notas de avance, y decisiones abiertas |
| [09 · Benchmark de gestión de neumáticos](09-benchmark-gestion-neumaticos.md) | Competidores, modelo de dominio, KPIs y backlog |

Otros: política de reporte de vulnerabilidades en [`../SECURITY.md`](../SECURITY.md); estructura del panel en [`../assets/js/README.md`](../assets/js/README.md); pruebas en `../tests/*/README.md`.
