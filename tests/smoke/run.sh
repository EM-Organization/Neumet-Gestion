#!/usr/bin/env bash
# Uso: tests/smoke/run.sh [admin|cliente|montar|...] [captura.png]   (requiere Google Chrome y python3)
set -uo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-admin}"; PORT="${PORT:-8791}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
Q=""; [ "$MODE" = cliente ] && Q="?cliente=1"
[ "$MODE" = reportes ] && Q="?reportes=1"
[ "$MODE" = flota ] && Q="?flota=1"
[ "$MODE" = detalle ] && Q="?cliente=1&detalle=1"
[ "$MODE" = montar ] && Q="?cliente=1&detalle=1&montar=1"
[ "$MODE" = secuser ] && Q="?cliente=1&secuser=1"
[ "$MODE" = sinperfil ] && Q="?sinperfil=1"
[ "$MODE" = api ] && Q="?api=1"
OUT=$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=${BUDGET:-90000} --dump-dom "http://localhost:$PORT/tests/smoke/harness.html$Q" 2>/dev/null)
echo "$OUT" | grep -o '<title>[^<]*</title>' | head -1
echo "$OUT" | awk '/<pre id="smoke-log">/{f=1} f{print} /<\/pre>/{f=0}' | sed 's/<[^>]*>//g'
[[ "$OUT" == *"<title>SMOKE:OK</title>"* ]]
