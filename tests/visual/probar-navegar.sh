#!/usr/bin/env bash
# Prueba el servidor de navegar.sh: lanza uno en un puerto libre, comprueba con curl --path-as-is que lo sensible da 404
# (mayúsculas, %-codificación, enlaces simbólicos al exterior y a referencias/), %00 da 400 y lo legítimo da 200; lo detiene.
# Crea archivos y enlaces temporales dentro del repo y los borra siempre al salir.
set -uo pipefail
cd "$(dirname "$0")/../.."
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
mkdir -p referencias
echo secreto > referencias/probar-navegar.txt
ln -s /etc tests/visual/enlace_etc_tmp
ln -s ../../referencias tests/visual/enlace_ref_tmp
PID=""
limpiar() {
  if [ -n "$PID" ]; then kill -TERM "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; fi
  rm -f tests/visual/enlace_etc_tmp tests/visual/enlace_ref_tmp referencias/probar-navegar.txt
  rmdir referencias 2>/dev/null || true
}
trap limpiar EXIT
PORT=$PORT tests/visual/navegar.sh admin >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
fallos=0
chk() { # esperado ruta
  local got; got=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$2")
  if [ "$got" = "$1" ]; then echo "ok   $got $2"; else echo "FALLA esperado $1, obtuvo $got: $2"; fallos=$((fallos+1)); fi
}
chk 404 /referencias/probar-navegar.txt
chk 404 /Referencias/probar-navegar.txt
chk 404 /REFERENCIAS/probar-navegar.txt
chk 404 /%52eferencias/probar-navegar.txt
chk 404 /tests/visual/enlace_etc_tmp/passwd
chk 404 /tests/visual/enlace_ref_tmp/probar-navegar.txt
chk 404 /tests/visual/enlace_ref_tmp/PROBAR-NAVEGAR.TXT
chk 404 /.git/config
chk 404 /.claude/agents/neumet-ux.md
chk 404 /adminpanel/../.git/config
chk 400 /tests/%00
chk 200 /adminpanel/
chk 200 /tests/smoke/harness.html
kill -TERM "$PID"; wait "$PID" 2>/dev/null; PID=""
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then echo "FALLA: el servidor sigue vivo"; fallos=$((fallos+1)); fi
if [ "$fallos" -eq 0 ]; then echo "navegar.sh: todo ok"; else echo "navegar.sh: $fallos fallo(s)"; exit 1; fi
