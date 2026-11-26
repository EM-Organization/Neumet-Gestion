---
name: neumet-pruebas
description: Reglas de pruebas de NEUMET: un arreglo de bug trae un test que falla sin el arreglo, todo console.error o «Acción desconocida» falla la prueba, lo que toca datos se prueba también en e2e, y qué comando correr según el cambio. Cargar al escribir o corregir código.
---

# Pruebas en NEUMET

- Un arreglo de bug trae un test que **falla sin el arreglo**. Comprobarlo: revertir el arreglo y ver que el test falla.
- Todo `console.error` o «Acción desconocida» en un flujo falla la prueba.
- Los smoke con datos simulados no bastan: lo que toque la base se prueba también en `npm run e2e`.
- Correr solo las pruebas del área tocada; la suite completa la valida el CI.
- Un test nunca se debilita para que pase: si no pasa, el código está mal o el test estaba mal, y eso se dice.
- Comandos según el cambio: ver la skill `neumet-proyecto`.
- Salida recortada: `... 2>&1 | tail -40`.
