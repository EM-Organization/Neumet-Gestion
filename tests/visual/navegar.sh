#!/usr/bin/env bash
# Panel navegable con datos simulados (stub de tests/smoke), para recorrerlo a mano o con un navegador controlado por un agente.
# Uso: tests/visual/navegar.sh [admin|global|sucursal|sinperfil]   (sin argumento: imprime las 4 URL)
# Deja el servidor corriendo hasta Ctrl+C. Nunca usa el sitio real, contraseñas ni producción.
# El arnés muestra el panel dentro de un iframe del mismo origen: es interactivo (clics, formularios), pero los datos
# son simulados y se reinician al recargar. Para datos reales de demo hace falta el e2e (ver .claude/skills/neumet-auditoria-ux).
set -uo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-8793}"; VW="${VW:-1280}"; VH="${VH:-800}"
BASE="http://localhost:$PORT/tests/smoke/harness.html"
Q="shot=inicio&vw=$VW&vh=$VH"
url() {
  case "$1" in
    admin) echo "$BASE?$Q" ;;
    global) echo "$BASE?$Q&cliente=1&detalle=1" ;;
    sucursal) echo "$BASE?$Q&cliente=1&secuser=1" ;;
    sinperfil) echo "$BASE?$Q&sinperfil=1" ;;
    *) echo "Rol desconocido: $1 (admin|global|sucursal|sinperfil)" >&2; return 1 ;;
  esac
}
if [ $# -gt 0 ]; then
  url "$1" || exit 2
else
  for r in admin global sucursal sinperfil; do echo "$r  $(url "$r")"; done
fi
echo "Servidor en el puerto $PORT. Ctrl+C para terminar." >&2
exec python3 -m http.server "$PORT" >/dev/null 2>&1
