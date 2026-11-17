# Para `source` desde tests/smoke/run.sh y tests/visual/run.sh: levanta scripts/servir-estatico.mjs en segundo plano.
# Deja PORT (el pedido o, si no hay, el primer libre) y SRV (pid); el llamador hace `trap 'kill $SRV' EXIT`.
# Las URL usan 127.0.0.1: «localhost» puede resolver a ::1 y el servidor escucha solo en IPv4.
iniciar_servidor() {
  local log i; log=$(mktemp)
  PORT="${PORT:-0}"
  node scripts/servir-estatico.mjs "$PORT" . >"$log" 2>&1 &
  SRV=$!
  PORT=""
  for i in $(seq 1 50); do
    PORT=$(sed -n 's/^PUERTO=//p' "$log" | head -1)
    [ -n "$PORT" ] && break
    kill -0 "$SRV" 2>/dev/null || break
    sleep 0.1
  done
  if [ -z "$PORT" ]; then kill "$SRV" 2>/dev/null; echo "No se pudo iniciar el servidor estático:"; cat "$log"; rm -f "$log"; return 1; fi
  rm -f "$log"
}
