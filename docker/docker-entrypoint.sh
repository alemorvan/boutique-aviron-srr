#!/bin/sh
# ============================================================
# Entrypoint Docker - Catalogue Vestimentaire SRR
# Génère js/runtime-config.js à partir des variables d'env
# puis lance nginx.
# ============================================================
set -eu

CONFIG_FILE="/usr/share/nginx/html/js/runtime-config.js"

# Variables d'environnement attendues (toutes optionnelles) :
#   GOOGLE_SCRIPT_URL : URL du endpoint Google Apps Script
#   CLUB_EMAIL        : email de contact du club (override YAML)
#   CLUB_IBAN         : IBAN pour virement SEPA (override YAML)

GOOGLE_SCRIPT_URL="${GOOGLE_SCRIPT_URL:-}"
CLUB_EMAIL="${CLUB_EMAIL:-}"
CLUB_IBAN="${CLUB_IBAN:-}"

# Échappe les doubles-quotes et backslashes pour l'inclusion sûre en JS.
escape_js() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > "$CONFIG_FILE" <<EOF
/* Auto-généré au démarrage par docker-entrypoint.sh — ne pas éditer. */
window.RUNTIME_CONFIG = {
  googleScriptUrl: "$(escape_js "$GOOGLE_SCRIPT_URL")",
  clubEmailOverride: "$(escape_js "$CLUB_EMAIL")",
  clubIbanOverride: "$(escape_js "$CLUB_IBAN")"
};
EOF

if [ -n "$GOOGLE_SCRIPT_URL" ]; then
    echo "[entrypoint] runtime-config.js généré avec GOOGLE_SCRIPT_URL configuré."
else
    echo "[entrypoint] runtime-config.js généré sans GOOGLE_SCRIPT_URL (mode PDF seul)."
fi

# Transfère l'exécution à nginx
exec "$@"
