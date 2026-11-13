#!/usr/bin/env bash
# Panel navegable con datos simulados (stub de tests/smoke), para recorrerlo a mano o con un navegador controlado por un agente.
# Uso: tests/visual/navegar.sh [admin|global|sucursal|sinperfil]   (sin argumento: imprime las 4 URL)
# Servidor SOLO local (127.0.0.1) que responde 404 a lo sensible (rutas con un segmento que empiece con «.», referencias/,
# supabase/.temp). Se detiene con SIGTERM (kill -TERM <pid>, o TaskStop si se lanzó en segundo plano) o Ctrl+C en primer
# plano. Nunca usa el sitio real, contraseñas ni producción.
# El arnés muestra el panel dentro de un iframe del mismo origen: es interactivo (clics, formularios), pero los datos
# son simulados y se reinician al recargar. Para datos reales de demo hace falta el e2e (ver .claude/skills/neumet-auditoria-ux).
set -uo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-8793}"; VW="${VW:-1280}"; VH="${VH:-800}"
BASE="http://127.0.0.1:$PORT/tests/smoke/harness.html"
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
echo "Servidor solo local en 127.0.0.1:$PORT. SIGTERM o Ctrl+C para terminar. No abrir el puerto ni compartir la URL." >&2
# exec en primer plano: SIGTERM llega directo a Python. SIGINT se restaura a su acción por defecto porque un shell no
# interactivo lanza los procesos en segundo plano con SIGINT ignorado.
exec python3 -I - "$PORT" <<'PY'
import http.server, posixpath, signal, socket, sys, urllib.parse

port = int(sys.argv[1])
signal.signal(signal.SIGINT, signal.SIG_DFL)
signal.signal(signal.SIGTERM, signal.SIG_DFL)

# Puerto ocupado en cualquier familia (IPv4 o IPv6): salir con error claro en vez de levantar un segundo servidor.
for fam, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
    try:
        with socket.socket(fam, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) == 0:
                sys.exit("Error: el puerto %d ya está ocupado en %s. Liberarlo o usar PORT=<otro>." % (port, host))
    except OSError:
        pass  # familia no disponible en esta máquina

# Prefijos que no se sirven nunca; además, cualquier segmento que empiece con «.» (.claude, .temp, dotfiles del repo...).
BLOQUEADO = ("referencias", "supabase/.temp", "node_modules/.cache", ".claude")

class Handler(http.server.SimpleHTTPRequestHandler):
    def _permitido(self):
        ruta = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(self.path).path))
        partes = [p for p in ruta.split("/") if p]
        if any(p.startswith(".") for p in partes):
            return False
        rel = "/".join(partes)
        return not any(rel == b or rel.startswith(b + "/") for b in BLOQUEADO)

    def send_head(self):
        if not self._permitido():
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)  # sin listados: no revelar nombres de archivos
        return None

    def log_message(self, *a):
        pass

class Servidor(http.server.ThreadingHTTPServer):
    allow_reuse_address = True  # reiniciar enseguida no falla por TIME_WAIT; el puerto ocupado ya se comprobó arriba

Servidor(("127.0.0.1", port), Handler).serve_forever()
PY
