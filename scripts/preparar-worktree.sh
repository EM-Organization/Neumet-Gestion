#!/usr/bin/env bash
# Deja un worktree listo para correr lint, check, unitarias y test:front. Idempotente: si node_modules ya
# corresponde al package-lock.json actual no reinstala. Uso: scripts/preparar-worktree.sh
#
# Por qué `npm ci` propio y no un enlace al node_modules del repo principal: ese directorio puede estar viejo
# (faltaban eslint-plugin-svelte, vite y vitest) y un enlace compartido haría que un `npm install` en un worktree
# modifique las dependencias de todos los demás. Con la caché de npm (~/.npm) la instalación tarda unos segundos.
set -uo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null && command -v npm >/dev/null || { echo "Falta node/npm (se necesita node >= 22.12)"; exit 2; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || { echo "node $(node -v) es menor que 22.12 (engines de package.json)"; exit 2; }

[ -f package-lock.json ] || { echo "No hay package-lock.json: ¿se está en la raíz del repo?"; exit 2; }
if command -v shasum >/dev/null; then HASH=$(shasum -a 256 package-lock.json | cut -d' ' -f1); else HASH=$(sha256sum package-lock.json | cut -d' ' -f1); fi
MARCA=node_modules/.neumet-lock-hash

if [ -d node_modules ] && [ -f "$MARCA" ] && [ "$(cat "$MARCA")" = "$HASH" ]; then
  echo "node_modules al día (package-lock.json sin cambios)"
else
  echo "Instalando dependencias (npm ci, con caché)..."
  npm ci --prefer-offline --no-audit --no-fund --loglevel=error || { echo "FALLA npm ci"; exit 1; }
  echo "$HASH" > "$MARCA"
fi

# Comprobación rápida de que las herramientas cargan (no corre las pruebas completas)
for b in eslint vite vitest; do
  [ -x "node_modules/.bin/$b" ] || { echo "FALTA node_modules/.bin/$b: borrar node_modules y repetir"; exit 1; }
done
npm run -s lint -- --quiet && npm run -s check && echo "worktree listo: lint y check corren" || { echo "FALLA lint/check"; exit 1; }
echo "Siguiente: npm test · npm run test:front · scripts/verificar-rapido.sh (e2e: ver docs/11, sección «Pruebas en un worktree»)"
