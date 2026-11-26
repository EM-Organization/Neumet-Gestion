---
name: principios-diseno
description: Forma de trabajar del Technical Leader de NEUMET: diseño guiado por el dominio (lenguaje ubicuo, contextos delimitados), arquitectura hexagonal (puertos y adaptadores, dependencias hacia adentro) y Clean Code (nombres que revelan intención, funciones pequeñas, comentarios que explican el porqué). Cargar al diseñar un cambio, decidir dónde va un archivo o evaluar un diff.
---

# Principios de diseño en NEUMET

Fuentes: Diseño guiado por el dominio (Eric Evans, 2003; es.wikipedia), Arquitectura hexagonal (Alistair Cockburn, 2005; es.wikipedia), Clean Code (Robert C. Martin; guía FRC 3624). Lo de abajo es el resumen aplicado al repo, no la fuente completa.

## 1. Dominio primero (DDD)
- **Lenguaje ubicuo**: los nombres de clases, funciones y campos usan las palabras que usa el operario y el cliente (neumático, calibre, rotación, desgaste). Si un nombre técnico no existe en el negocio, se pregunta antes de inventarlo.
- **Contexto delimitado**: cada área tiene su modelo coherente. En NEUMET: medición (calibre), flota/vehículos, sucursales y perfiles, sugerencia de rotación (F8). Un cambio no mezcla dos contextos sin decirlo.
- **Lógica de negocio en el dominio**: reglas como «cuándo rotar» viven en `assets/js/domain/` (o su equivalente en `src/`), en código puro, sin DOM ni cliente de Supabase.
- **Límites de agregado**: una operación que cambia varias cosas a la vez se modela en una sola unidad que valida las reglas, no en la interfaz.

## 2. Dependencias hacia adentro (arquitectura hexagonal)
- El núcleo (dominio) define lo que necesita; el exterior lo implementa con adaptadores: Supabase, el DOM, la API, el calibre.
- Regla de chequeo: el dominio no importa de `views/`, `core/` del DOM ni del cliente de Supabase. Si lo hace, el cambio está mal ubicado.
- Un puerto puede tener varios adaptadores (por ejemplo, el mismo cálculo llamado desde la vista y desde una Edge Function). Si la lógica está en el adaptador, se mueve al núcleo.
- Probar el núcleo sin base ni interfaz real: si una regla de dominio necesita Supabase para probarse, la regla está en el lugar equivocado.

## 3. Código limpio
- **Nombres**: clases con sustantivos, funciones con verbos. Si un nombre necesita comentario, cambiá el nombre (`elapsedTimeInDays`, no `d // días`). Sin `m_` ni sufijos vacíos (`Info`, `Data`). Una letra solo para contadores de bucle.
- **Sin efectos ocultos**: una función que se llama `checkPassword` no debe además inicializar sesión. Si hay un orden obligatorio, que el nombre lo diga (`checkPasswordAndInitializeSession`).
- **Funciones pequeñas que hacen una cosa**; early return antes de anidar.
- **Comentarios**: si el código necesita un comentario para entenderse, primero se intenta expresarlo con un nombre o una función. Los comentarios que quedan explican el porqué, no lo obvio.
- **Sin abstracción prematura**: dos usos antes de extraer. El arreglo más simple que funcione.
- Las fuentes no cubren formato, manejo de errores ni pruebas: para eso usar `neumet-pruebas` y las reglas de `AGENTS.md`.

## Cómo usarla al evaluar un diff
1. ¿Los nombres nuevos son del negocio? ¿Coinciden con el lenguaje de `docs/14` y `docs/16`?
2. ¿Alguna dependencia va hacia afuera (dominio → DOM o Supabase)?
3. ¿Hay efectos ocultos o funciones que hacen dos cosas?
4. ¿Hay comentarios que tapan código confuso?
5. Cada hallazgo se reporta como bloqueante (viola una regla del proyecto) o sugerencia (opinable), con `archivo:línea`.
