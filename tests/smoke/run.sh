#!/usr/bin/env bash
# Uso: tests/smoke/run.sh [admin|cliente|montar|...] [captura.png]   (requiere Google Chrome y node; PORT opcional, por defecto el primer puerto libre)
set -uo pipefail
cd "$(dirname "$0")/../.."
# BUDGET es tiempo virtual de Chrome: la corrida termina apenas acaba el recorrido, así que un default alto no la alarga
# (desde el PR 96, cliente necesita más de 90000).
MODE="${1:-admin}"
# Un modo desconocido no puede caer en silencio a `admin`: pasaría en verde sin haber probado lo pedido.
case "$MODE" in *[!a-z-]*) MODE_MAL=1;; esac
if [ -n "${MODE_MAL:-}" ] || { [ "$MODE" != admin ] && ! grep -q "^\[ \"\$MODE\" = $MODE \] &&" "$0"; }; then
  echo "Modo desconocido: $MODE (los válidos están en las líneas '[ \"\$MODE\" = ... ]' de este script)"; exit 2
fi
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome google-chrome-stable chromium chromium-browser; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "No se encontró Chrome (definir CHROME=...)"; exit 2; }
# En Linux (CI) no existe la ruta de macOS: se usa el Chrome del PATH.
if [ ! -x "$CHROME" ]; then
  for c in google-chrome google-chrome-stable chromium chromium-browser; do command -v "$c" >/dev/null 2>&1 && CHROME=$(command -v "$c") && break; done
fi
# shellcheck source=../lib-servidor.sh
. tests/lib-servidor.sh
iniciar_servidor || exit 2
trap 'kill $SRV 2>/dev/null' EXIT
Q=""
[ "$MODE" = cliente ] && Q="?cliente=1"
[ "$MODE" = reportes ] && Q="?reportes=1"
[ "$MODE" = flota ] && Q="?flota=1"
[ "$MODE" = alertas-cliente ] && Q="?cliente=1&alertas=1"
[ "$MODE" = detalle ] && Q="?cliente=1&detalle=1"
[ "$MODE" = detalle-admin ] && Q="?detalle=1"
[ "$MODE" = montar ] && Q="?cliente=1&detalle=1&montar=1"
[ "$MODE" = montar-sucursal ] && Q="?cliente=1&secuser=1&detalle=1&montar=1"
[ "$MODE" = secuser ] && Q="?cliente=1&secuser=1"
[ "$MODE" = empresa ] && Q="?cliente=1&empresa=1"
[ "$MODE" = empresa-sucursal ] && Q="?cliente=1&secuser=1&empresa=1"
[ "$MODE" = empresa-admin ] && Q="?empresa=1"
[ "$MODE" = sinperfil ] && Q="?sinperfil=1"
[ "$MODE" = api ] && Q="?api=1"
[ "$MODE" = arranque ] && Q="?arranque=1"
[ "$MODE" = arranque-sinsesion ] && Q="?arranque=1&nosession=1"
[ "$MODE" = arranque-roto ] && Q="?arranque=1&roto=1"
[ "$MODE" = arranque-sinperfil ] && Q="?arranque=1&sinperfil=1"
[ "$MODE" = arranque-colgada-sesion ] && Q="?arranque=1&colgada=sesion"
[ "$MODE" = arranque-colgada-perfiles ] && Q="?arranque=1&colgada=perfiles"
[ "$MODE" = arranque-colgada-lanza ] && Q="?arranque=1&colgada=lanza"
[ "$MODE" = arranque-colgada-tardia ] && Q="?arranque=1&colgada=tardia"
[ "$MODE" = arranque-signout ] && Q="?arranque=1&escena=signout&perfil=lento&ms=3000"
[ "$MODE" = arranque-red ] && Q="?arranque=1&escena=red&perfil=error"
[ "$MODE" = arranque-reingreso ] && Q="?arranque=1&escena=reingreso&perfil=nunca1"
[ "$MODE" = arranque-tope ] && Q="?arranque=1&escena=tope&colgada=sesion"
[ "$MODE" = arranque-login ] && Q="?arranque=1&escena=login&nosession=1&perfil=lento&ms=1000"
[ "$MODE" = arranque-ventana ] && Q="?arranque=1&escena=ventana&perfil=lento&ms=3000&sesionms=1000"
[ "$MODE" = arranque-cambio ] && Q="?arranque=1&escena=cambio&perfil=lento&ms=3000&desde=2"
[ "$MODE" = arranque-cambio-error ] && Q="?arranque=1&escena=cambio&perfil=error&desde=2"
[ "$MODE" = arranque-sinmodulos ] && Q="?arranque=1&escena=sinmodulos&vw=390"
OUT=$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=${BUDGET:-250000} --dump-dom "http://127.0.0.1:$PORT/tests/smoke/harness.html$Q" 2>/dev/null)
echo "$OUT" | grep -o '<title>[^<]*</title>' | head -1
echo "$OUT" | awk '/<pre id="smoke-log">/{f=1} f{print} /<\/pre>/{f=0}' | sed 's/<[^>]*>//g'
[[ "$OUT" == *"<title>SMOKE:OK</title>"* ]]
