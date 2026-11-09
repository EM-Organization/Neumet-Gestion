#!/usr/bin/env bash
# QA visual: capturas de las vistas clave (admin/cliente x escritorio/móvil) con Chrome headless y el stub de tests/smoke.
# Uso: tests/visual/run.sh [escena ...]      (sin argumentos: todas). Salida: tests/visual/out/<rol>-<tamaño>-<escena>.png
# Variables: PORT (8792), CHROME (ruta del binario), SIZES="desktop mobile"  # también: laptop (1280x720), ROLES="admin cliente".
set -uo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-8792}"; OUT_DIR="tests/visual/out"
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome google-chrome-stable chromium chromium-browser; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "No se encontró Chrome (definí CHROME=...)"; exit 2; }
SIZES="${SIZES:-desktop mobile}"; ROLES="${ROLES:-admin cliente}"
# escena:roles que la admiten (detalle/selector necesitan fixtures de cliente)
ALL="login:admin sin-acceso:admin inicio:both ultimas-mediciones:both ciclo-vida:admin ciclo-costo:admin vehiculos:both flota:both alertas:both dispositivos:admin reportes:both reportes-cpk:both mediciones:both clientes:admin ficha:admin stock:both stock-alta:both stock-mover:cliente stock-busqueda:cliente busqueda:both vehiculos-busqueda:cliente detalle:cliente detalle-rueda:cliente detalle-rueda-km:cliente detalle-rueda-costo:cliente cambio-neumatico:cliente cambio-cubierta:cliente cambio-almacenar:cliente detalle-vacio:cliente detalle-vacio-rueda:cliente montar-neumatico:cliente montar-nueva:cliente montar-siguiente:cliente retirar-neumatico:cliente selector-seccional:cliente confirmar-intercambio:cliente confirmar-eliminar:admin"
mkdir -p "$OUT_DIR"
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT; sleep 1
FAIL=0; N=0
for item in $ALL; do
  scene="${item%%:*}"; who="${item##*:}"
  if [ $# -gt 0 ]; then case " $* " in *" $scene "*) ;; *) continue;; esac; fi
  for role in $ROLES; do
    [ "$who" != both ] && [ "$who" != "$role" ] && continue
    for size in $SIZES; do
      case "$size" in mobile) W=390; H=844;; laptop) W=1280; H=720;; *) W=1440; H=900;; esac
      Q="shot=$scene&vw=$W&vh=$H"
      [ "$role" = cliente ] && Q="$Q&cliente=1"
      [ "$role" = cliente ] && [ "$scene" = vehiculos ] && Q="$Q&detalle=1"
      case "$scene" in detalle-vacio*|montar-*|retirar-neumatico) Q="$Q&detalle=1&cliente=1&montar=1";;
        vehiculos-busqueda|detalle*|confirmar-intercambio|cambio-neumatico|cambio-cubierta|cambio-almacenar) Q="$Q&detalle=1&cliente=1";; esac
      [ "$scene" = login ] && Q="$Q&nosession=1"
      [ "$scene" = sin-acceso ] && Q="$Q&sinperfil=1"
      f="$OUT_DIR/$role-$size-$scene.png"; rm -f "$f"
      "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=$W,$H --virtual-time-budget=${BUDGET:-30000} \
        --screenshot="$PWD/$f" "http://localhost:$PORT/tests/smoke/harness.html?$Q" >/dev/null 2>&1
      # Comprobación del estado (errores de consola/recursos): segunda pasada rápida con --dump-dom
      T=$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=${BUDGET:-30000} --dump-dom "http://localhost:$PORT/tests/smoke/harness.html?$Q" 2>/dev/null | grep -o '<title>[^<]*</title>' | head -1)
      N=$((N+1))
      if [ -s "$f" ] && [[ "$T" == *"SMOKE:OK"* ]]; then echo "ok    $f"; else echo "FALLA $f $T"; FAIL=$((FAIL+1)); fi
    done
  done
done
echo "$N capturas, $FAIL con problemas -> $OUT_DIR"
[ "$FAIL" -eq 0 ]
