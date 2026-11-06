# 06 · Identidad visual NEUMET

> Fuente: `identidad.pdf` (Alegra Studio, exportado de Canva, 2026-06-02). **El PDF no se versiona en el repo** (binario de 860 KB, repo potencialmente público y licencia de la tipografía del wordmark aún sin confirmar); se conserva en el almacenamiento interno del equipo.
> Estado: **documentación y assets disponibilizados. El sitio y el panel todavía NO usan esta identidad** (plan de adopción en §8).

## 1. Qué contiene la identidad entregada

| Pág. | Contenido |
|---|---|
| 1 | Paleta de 6 colores |
| 2 | Isotipo en círculo dorado |
| 3 | Isotipo en 5 colores |
| 4 | Exploración tipográfica del wordmark (Michroma, Chakra Petch, Ethnocentric, Rajdhani, TDTD, Neuropol) |
| 5 | Wordmark "NEUMET" en 4 colores |
| 6 | Combinaciones bicolor del wordmark sobre fondo oscuro y claro |

Más el **logo horizontal** (isotipo + wordmark bicolor), entregado como imagen.

## 2. Paleta

| Token | Nombre | HEX | RGB | Rol |
|---|---|---|---|---|
| `--n-blanco` | Blanco | `#FFFFFF` | 255 255 255 | Superficies, tarjetas |
| `--n-gris` | Gris claro | `#EBEBEB` | 235 235 235 | Fondo de página, divisores |
| `--n-dorado` | Dorado | `#D5C58A` | 213 197 138 | **Color de marca / acento** |
| `--n-oliva` | Oliva | `#615A3F` | 97 90 63 | Color de marca secundario, texto secundario |
| `--n-oscuro` | Oliva oscuro | `#383424` | 56 52 36 | Texto principal, sidebar, fondos oscuros |
| `--n-negro` | Negro | `#000000` | 0 0 0 | Uso excepcional (impresión monocroma) |

### Accesibilidad (contraste WCAG 2.1, calculado)

Texto (fila) sobre fondo (columna). AA = ≥ 4,5 (texto normal) · ≥ 3 (texto grande ≥ 24 px o 18,66 px bold y componentes de UI).

| | Blanco | Gris | Dorado | Oliva | Oscuro |
|---|---|---|---|---|---|
| **Blanco** | — | 1,19 ✗ | 1,72 ✗ | 6,90 ✓ | 12,46 ✓ |
| **Gris** | 1,19 ✗ | — | 1,45 ✗ | 5,79 ✓ | 10,46 ✓ |
| **Dorado** | 1,72 ✗ | 1,45 ✗ | — | 4,00 (solo grande) | 7,23 ✓ |
| **Oliva** | 6,90 ✓ | 5,79 ✓ | 4,00 (solo grande) | — | 1,81 ✗ |
| **Oscuro** | 12,46 ✓ | 10,46 ✓ | 7,23 ✓ | 1,81 ✗ | — |

**Reglas que se derivan:**
1. **El dorado nunca es color de texto ni de icono/borde funcional sobre blanco o gris claro** (1,72 y 1,45). Sobre fondos claros, el dorado se usa como *relleno* de acentos (botones, chips, barras) con texto `oscuro` encima (7,23).
2. **Texto sobre dorado: siempre `oscuro`**, nunca blanco. (La propia lámina de paleta del PDF muestra texto blanco sobre el dorado: no replicar.)
3. Sobre fondos oscuros (`oscuro`, `oliva`) el dorado sí funciona como texto/acento: 7,23 sobre `oscuro`; 4,00 sobre `oliva` (solo texto grande).
4. El logo bicolor claro (dorado sobre `#EBEBEB`) tiene contraste bajo por diseño; los logos están exentos de WCAG, pero evitar usarlo en tamaños pequeños. Preferir la versión monocroma oscura en fondos claros chicos.

## 3. Logotipos

Todos en `assets/brand/` (ver su `README.md` para el catálogo completo).

| Pieza | Descripción | Archivos |
|---|---|---|
| **Isotipo** | Tres bloques redondeados formando una "esquina"/ángulo; en 5 colores | `isotipo/isotipo-{dorado,oliva,oscuro,gris,negro}.svg` |
| **Isotipo en círculo** | Isotipo oliva sobre círculo dorado (avatar, favicon, redes) | `isotipo/isotipo-circulo.svg`, `…-oscuro.svg` |
| **Wordmark** | "NEUMET" en tipografía display personalizada, monocromo o bicolor (NEU \| MET) | `wordmark/*.svg` |
| **Logo horizontal** | Isotipo + wordmark, altura del isotipo = altura de mayúsculas | `logo/logo-horizontal-*.svg` |
| **Favicons / PNG** | Exportaciones raster | `favicon/`, `png/` |

### Variantes de color del logo horizontal

| Fondo | Variante | Isotipo / NEU / MET |
|---|---|---|
| Claro (blanco, `#EBEBEB`) | `claro` (principal) | dorado / oliva / dorado |
| Oscuro (`#383424`, negro) | `oscuro` | dorado / gris claro / dorado |
| Monocromo | `mono-oscuro`, `mono-negro`, `mono-gris`, `mono-dorado` | un solo color |

### Uso correcto
- **Zona de seguridad:** una altura de la "M"/isotipo × 0,5 libre en todos los lados.
- **Tamaño mínimo:** logo horizontal 120 px de ancho en pantalla (24 mm impresos); isotipo 16 px (favicon).
- Bicolor siempre con el corte **NEU | MET**. No invertir los colores al azar: usar las variantes provistas.
- No estirar, rotar, añadir sombras ni contornos, ni recolorear fuera de la paleta.
- No usar el wordmark sobre fotos sin un velo `oscuro` ≥ 60 %.
- **El wordmark es arte, no texto:** no reescribir "NEUMET" con una fuente para simularlo.

### Notas técnicas y deuda de los assets
1. **Isotipo reconstruido en vectores limpios** a partir de la geometría del PDF (rectángulos con radio 27 u + acuerdo interior de radio 33 u). Coincide con la lámina original.
2. **El círculo del PDF (pág. 2) está deformado** (688 × 648, es una elipse). El `isotipo-circulo.svg` entregado es un círculo real, con el isotipo al 61 % del diámetro, centrado.
3. **El wordmark en el PDF es una imagen raster** (≈ 1200 × 149 px por variante), no vector. Se **vectorizó por trazado automático** (potrace) para disponer de SVG escalables. Es adecuado para web y pantalla, pero los bordes no son geometría perfecta (se aprecian pequeñas imprecisiones en las esquinas internas al ampliar mucho).
   **Acción requerida:** pedir a Alegra Studio los **archivos vectoriales originales (.ai/.svg/.pdf)** del logo y reemplazar los trazados. Hasta entonces: no usar el wordmark en impresión de gran formato.
4. **Tipografía del wordmark sin identificar ni licenciar.** La página 4 compara Ethnocentric, Neuropol, TDTD (tipografías de uso personal/comercial restringido) con Rajdhani, Michroma y Chakra Petch (Open Font License, Google Fonts). El wordmark final no coincide exactamente con ninguna. **Preguntar al estudio** de qué fuente deriva y bajo qué licencia, para asegurar el uso comercial. Mientras se use solo como archivo gráfico no hay problema de licencia de *fuente instalada*, pero sí conviene tenerlo por escrito.
5. **No hay isotipo ni logo en los assets actuales del sitio**: usaba `assets/img/WhatsApp Image …jpeg` (logo anterior, raster). Ya se reemplazó por `assets/brand/` y los jpeg fueron eliminados (§8).

## 4. Tipografía de interfaz

La identidad **no define tipografía de UI**: el PDF usa Open Sans solo en las etiquetas de la lámina de paleta (valor por defecto de Canva) y la exploración de la pág. 4 es del *wordmark*. Por eso lo siguiente es una **propuesta a validar**, no parte de la identidad entregada:

| Uso | Propuesta | Licencia | Por qué |
|---|---|---|---|
| Titulares / KPI / números grandes | **Rajdhani** 600–700 | OFL | Fue una candidata del propio estudio; geometría técnica, afín al wordmark; excelentes numerales para mm de desgaste |
| Texto / tablas / formularios | **Inter** 400–600 (se mantiene) | OFL | Ya en uso; legible en tablas densas |
| Códigos, MAC, patentes | **JetBrains Mono** (se mantiene) | OFL | Ya en uso |

Hoy el CSS define `Exo 2` como `--font-brand` (`styles.css:26`, 2 usos) y el sitio carga Google Fonts en cada visita. **Decisión pendiente:** autoalojar las fuentes elegidas (privacidad, CSP más estricta, rendimiento; ver `02-auditoria-seguridad.md` §6).

## 5. Tokens de diseño propuestos

Capa 1, **primitivos** (verdad de la marca) y capa 2, **semánticos** (lo que usa la UI). Se documenta como especificación; no está aplicado en el código.

```css
:root {
  /* Primitivos — identidad.pdf */
  --n-blanco:  #FFFFFF;
  --n-gris:    #EBEBEB;
  --n-dorado:  #D5C58A;
  --n-oliva:   #615A3F;
  --n-oscuro:  #383424;
  --n-negro:   #000000;

  /* Semánticos */
  --bg:               var(--n-gris);
  --surface:          var(--n-blanco);
  --text-primary:     var(--n-oscuro);
  --text-secondary:   var(--n-oliva);
  --accent:           var(--n-dorado);   /* relleno; NUNCA texto sobre claro */
  --on-accent:        var(--n-oscuro);
  --accent-dark:      var(--n-oscuro);
  --sidebar-bg:       var(--n-oscuro);
  --sidebar-text-active: var(--n-dorado);
}
```

### Derivados (no están en la identidad: requieren validación del estudio)
Para cubrir necesidades que la paleta no resuelve, se proponen *tints* calculados desde los primitivos y no colores nuevos:

| Token | Derivación | Uso |
|---|---|---|
| `--surface-2` | mezcla 50 % `blanco` + `gris` ≈ `#F5F5F5` | Zebra de tablas, inputs |
| `--text-tertiary` | `oliva` al 70 % de opacidad sobre blanco ≈ `#908C79` (≈ 3,4:1) | Solo texto grande/auxiliar; **no** para información esencial |
| `--border` | `oscuro` al 10–14 % | Líneas |
| `--accent-light` / `--accent-border` | `dorado` al 15 % / 40 % | Fondos de selección |

### Colores semánticos de estado (fuera de la identidad, se conservan)
El estado de los neumáticos exige colores de semáforo universales; la identidad es cromáticamente cálida y no los cubre. **Se mantienen**, desacoplados de la marca:

| Estado | Rango | Color actual |
|---|---|---|
| OK | ≥ 8 mm | `#34c759` / texto `#1a7f37` |
| Bajo | 5–7,9 mm | `#ff9500` / texto `#b25000` |
| Crítico | < 5 mm | `#ff3b30` / texto `#c0392b` |
| Sin datos | — | gris |

Regla: **el dorado nunca representa un estado** (se confundiría con "bajo" en ámbar). Además, no depender solo del color: acompañar con icono/etiqueta (ya existe en el dashboard: ✓ ⚠ ✕).

### Mapa de migración de tokens actuales

| Hoy | Valor | → Nuevo | Nota |
|---|---|---|---|
| `--accent` | `#C9B96A` | `--n-dorado` `#D5C58A` | Más claro: revisar contrastes de texto sobre acento (usar `oscuro`) |
| `--accent-dark`, `--sidebar-bg` | `#3D3C20` | `--n-oscuro` `#383424` | |
| `--text-primary` | `#2C2B18` | `--n-oscuro` | 12,46:1 sobre blanco |
| `--text-secondary` | `#6B6A52` | `--n-oliva` `#615A3F` | 6,90:1 |
| `--text-tertiary` | `#9E9D82` | derivado | El actual da ≈ 2,7:1 sobre blanco; ya incumplía AA |
| `--bg` | `#F5F4EE` (crema) | `--n-gris` `#EBEBEB` | Cambio de temperatura: de cálido a neutro |
| `--surface-secondary` | `#F9F8F3` | derivado | |

## 6. Forma y tono (inferido del isotipo, a confirmar)
- **Geometría:** rectángulos con radios generosos (≈ 7 % del lado mayor) y un acuerdo interior mayor. Trasladar a la UI: radio de tarjetas 12–16 px (ya 16), botones 10–12 px, evitar esquinas vivas.
- **Peso visual:** wordmark muy pesado y ancho, itálico oblicuo en E/T/M: reservarlo para marca y titulares; no para texto corrido.
- **Tono:** técnico, industrial, sobrio (paleta tierra/militar). Evitar fucsias, degradados saturados o emojis decorativos en la landing.

## 7. Dónde está hoy el estilo (alcance del cambio)

| Archivo | Colores legados¹ | Observación |
|---|---|---|
| `index.html` (landing) | 27 | Tokens propios duplicados en `:root` (líneas 14-39) |
| `assets/css/styles.css` (panel) | 9 | Tokens `:root` (líneas 3-32); `--font-brand: Exo 2` |
| `assets/js/app.js` (monolito original; hoy `assets/js/views/` y `core/brand.js`) | 32 | Hex hardcodeados en templates y SVG de gráficos |
| `adminpanel/index.html` | 1 (+ estilos inline) | Logo anterior (ya reemplazado por `assets/brand/`) en login y sidebar |
| `supabase/functions/contacto/index.ts` | 15 | Plantilla de email con estilos inline |

¹ `#3D3C20`, `#C9B96A`, `#2C2B18`, `#6B6A52`, `#9E9D82`, `#F5F4EE`, `#F9F8F3`.
Además: **no hay favicon, `theme-color` ni `og:image`** en ninguna página.

La duplicación de tokens (landing y panel definen sus propias variables) debe eliminarse: **una sola hoja de tokens** (`assets/css/tokens.css`) importada por ambos. Con el paso a Vite (ver `03`/`05`) pasa a ser un módulo compartido.

## 8. Plan de adopción

| ID | Tarea | Depende de |
|---|---|---|
| B0 | ✅ Documentar identidad y publicar assets en `assets/brand/` | — |
| B1 | Solicitar a Alegra Studio: vectores originales, fuente/licencia del wordmark, y manual de uso (zonas, tamaños mínimos) | — |
| B2 | ✅ Crear `tokens.css` con primitivos + semánticos (§5); landing y panel lo importan | B0 |
| B3 | ✅ Sustituir el logo `WhatsApp…jpeg` por `logo-horizontal-*.svg`/isotipo; añadir favicon, `apple-touch-icon`, `theme-color`, `og:image` | B0 |
| B4 | 🟡 Reemplazar hex hardcodeados del panel (`assets/js/`) y `index.html` por `var(--…)` (landing y `styles.css` hechos; panel migrado a `core/brand.js`) | B2 |
| B5 | Plantilla de email de `contacto` con nueva paleta + logo (los clientes de correo no soportan `var()` ni SVG: usar PNG alojado y colores inline) | B0 |
| B6 | Autoalojar tipografías elegidas; retirar Google Fonts | decisión §4 |
| B7 | Verificación de contraste automatizada (axe/Lighthouse) y revisión visual por vista | B2–B4 |
| B8 | ✅ parcial (jpeg borrados; `app-demo.mp4` pendiente) Retirar del repo `assets/img/WhatsApp Image…` y `app-demo.mp4` si ya no se usan | B3 |

Riesgo principal: **el dorado nuevo es más claro** que el actual y varios puntos usan el acento como color de texto o de línea sobre fondo claro (p. ej. etiquetas y enlaces). Esos usos hay que reasignar a `oliva`/`oscuro`; no es un cambio de variable 1:1.

## 9. Decisiones abiertas
1. ¿Se mantiene Inter/JetBrains Mono y se adopta Rajdhani para titulares, o el estudio entrega tipografía de marca?
2. ¿El panel de gestión usa tema claro (fondo `#EBEBEB`) como hoy, o se plantea modo oscuro con `#383424`? La paleta lo permite bien; sería un extra.
3. ¿Se aprueban los tints derivados de §5 o se pide al estudio una paleta extendida?
4. ¿El nombre se escribe NEUMET (mayúsculas) en todo texto corrido? (el wordmark es siempre mayúsculas; el README y la landing alternan "NEUMET"/"Neumet").
