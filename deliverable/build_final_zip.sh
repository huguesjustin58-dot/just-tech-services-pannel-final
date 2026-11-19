#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/dist}"

mkdir -p "$OUT_DIR"
python3 "$SCRIPT_DIR/generate_jts_panel.py" \
  --output-dir "$OUT_DIR" \
  --zip-name "JUST_TECH_SERVICES_PANEL_FINAL.zip"

echo "Vérification de l'intégrité de l'archive :"
(cd "$OUT_DIR" && sha256sum -c JUST_TECH_SERVICES_PANEL_FINAL.zip.sha256)
