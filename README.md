# NEUMET · Sistema de Gestión Admin

Panel de administración para la gestión de clientes, vehículos, dispositivos y mediciones de neumáticos.

## Estructura del proyecto

```
Neumet-Gestion/
├── index.html              # Página principal
├── assets/
│   ├── css/
│   │   └── styles.css      # Estilos globales
│   ├── js/
│   │   └── app.js          # Lógica de la aplicación
│   └── img/
│       └── logo.png        # Logo de NEUMET
└── .gitignore
```

## Funcionalidades

- **Clientes** — Alta, edición y eliminación de clientes con credenciales de acceso
- **Vehículos** — Gestión de vehículos por cliente (patente, cantidad de ruedas)
- **Dispositivos** — Registro de medidores por MAC Address
- **Balance** — Ingresos por cliente, gastos de la empresa y resultado neto mensual
- **Mediciones** — Visualización del estado de neumáticos por vehículo o dispositivo

## Desarrollo local

No requiere dependencias. Abrí `index.html` directamente en el navegador, o usá un servidor local:

```bash
# Con Node.js
npx serve .

# Con Python
python -m http.server 8080
```

## Despliegue

El proyecto se despliega automáticamente en **Vercel** al hacer push a `main`.

También está configurado para **GitHub Pages** via la rama `gh-pages`.

## Variables de entorno

El archivo `assets/js/app.js` usa las credenciales de Supabase. En producción estas se configuran como variables de entorno en Vercel.
