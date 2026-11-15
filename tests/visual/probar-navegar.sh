#!/usr/bin/env bash
# Prueba el servidor de navegar.sh: lanza uno en un puerto libre, comprueba con curl --path-as-is que lo sensible da 404
# (mayúsculas, %-codificación, enlaces simbólicos al exterior y a referencias/), %00 da 400 y lo legítimo da 200; lo detiene.
# Crea archivos y enlaces temporales dentro del repo y los borra siempre al salir.
set -uo pipefail
cd "$(dirname "$0")/../.."
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
# Sufijo aleatorio: no pisa ni borra un archivo real de referencias/. En Linux (distingue mayúsculas) también se crea
# REFERENCIAS/, para que la prueba de mayúsculas ejercite un archivo existente y no solo un 404 por ausencia.
ARCH="probar-navegar-$(python3 -c 'import secrets;print(secrets.token_hex(4))').txt"
ARCH_MAY=$(echo "$ARCH" | tr a-z A-Z)
PID=""; CREO_REF=0; CREO_MAY=0
limpiar() {
  if [ -n "$PID" ]; then kill -TERM "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; fi
  rm -f tests/visual/enlace_etc_tmp tests/visual/enlace_ref_tmp "referencias/$ARCH" "REFERENCIAS/$ARCH"
  if [ "$CREO_REF" = 1 ]; then rmdir referencias 2>/dev/null; fi
  if [ "$CREO_MAY" = 1 ]; then rmdir REFERENCIAS 2>/dev/null; fi
  return 0
}
trap limpiar EXIT
if [ ! -d referencias ]; then CREO_REF=1; fi
mkdir -p referencias
echo secreto > "referencias/$ARCH"
# En macOS REFERENCIAS ya es referencias: solo se crea si es otro directorio.
if [ ! -d REFERENCIAS ]; then CREO_MAY=1; mkdir REFERENCIAS; fi
echo secreto > "REFERENCIAS/$ARCH"
rm -f tests/visual/enlace_etc_tmp tests/visual/enlace_ref_tmp
ln -s /etc tests/visual/enlace_etc_tmp
ln -s ../../referencias tests/visual/enlace_ref_tmp
PORT=$PORT tests/visual/navegar.sh admin >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
fallos=0
chk() { # esperado ruta
  local got; got=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$2")
  if [ "$got" = "$1" ]; then echo "ok   $got $2"; else echo "FALLA esperado $1, obtuvo $got: $2"; fallos=$((fallos+1)); fi
}
chk 404 /referencias/$ARCH
chk 404 /Referencias/$ARCH
chk 404 /REFERENCIAS/$ARCH
chk 404 /REFERENCIAS/$ARCH_MAY
chk 404 /%52eferencias/$ARCH
chk 404 /tests/visual/enlace_etc_tmp/passwd
chk 404 /tests/visual/enlace_ref_tmp/$ARCH
chk 404 /tests/visual/enlace_ref_tmp/$ARCH_MAY
chk 404 /.git/config
chk 404 /.claude/agents/neumet-ux.md
chk 404 /adminpanel/../.git/config
chk 400 /tests/%00
chk 200 /adminpanel/
chk 200 /tests/smoke/harness.html
kill -TERM "$PID"; wait "$PID" 2>/dev/null; PID=""
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then echo "FALLA: el servidor sigue vivo"; fallos=$((fallos+1)); fi
if [ "$fallos" -eq 0 ]; then echo "navegar.sh: todo ok"; else echo "navegar.sh: $fallos fallo(s)"; exit 1; fi
