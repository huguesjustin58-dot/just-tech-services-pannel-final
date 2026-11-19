#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Sauvegarde & Restauration Complète (PostgreSQL + Clés)
# Usage:
#   Sauvegarde : sudo bash backup-restore.sh
#   Restauration : sudo bash backup-restore.sh --restore /var/backups/jts/jts_backup_YYYYMMDD.tar.gz
# ==============================================================================
set -euo pipefail

INSTALL_DIR="${JTS_INSTALL_DIR:-/opt/justtech-panel}"
BACKUP_DIR="${JTS_BACKUP_DIR:-/var/backups/jts}"
RETENTION_DAYS="${JTS_BACKUP_RETENTION:-14}"

if [[ "${1:-}" == "--restore" ]]; then
    ARCHIVE="${2:-}"
    [[ -f "$ARCHIVE" ]] || { echo "Archive introuvable: $ARCHIVE" >&2; exit 1; }
    TMP_RESTORE="$(mktemp -d)"
    tar -xzf "$ARCHIVE" -C "$TMP_RESTORE"

    echo "[RESTORE] Restauration .env, clés SSH et /etc/jts..."
    [[ -f "$TMP_RESTORE/backend.env" ]] && cp -a "$TMP_RESTORE/backend.env" "$INSTALL_DIR/backend/.env"
    [[ -d "$TMP_RESTORE/keys" ]] && cp -a "$TMP_RESTORE/keys/." "$INSTALL_DIR/backend/storage/app/keys/"
    [[ -d "$TMP_RESTORE/etc_jts" ]] && cp -a "$TMP_RESTORE/etc_jts/." /etc/jts/

    set -a
    # shellcheck disable=SC1090
    source "$INSTALL_DIR/backend/.env"
    set +a

    echo "[RESTORE] Restauration PostgreSQL..."
    cd "$INSTALL_DIR"
    cat "$TMP_RESTORE/database.dump" | docker compose exec -T postgres pg_restore -U "${DB_USERNAME:-jts_user}" -d "${DB_DATABASE:-just_tech_panel}" --clean --if-exists
    rm -rf "$TMP_RESTORE"
    echo "[OK] Restauration complète terminée."
    exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
TMP_STAGE="$(mktemp -d)"

set -a
# shellcheck disable=SC1090
source "$INSTALL_DIR/backend/.env"
set +a

cd "$INSTALL_DIR"
docker compose exec -T postgres pg_dump -U "${DB_USERNAME:-jts_user}" -Fc "${DB_DATABASE:-just_tech_panel}" > "$TMP_STAGE/database.dump"
cp -a "$INSTALL_DIR/backend/.env" "$TMP_STAGE/backend.env"
[[ -d "$INSTALL_DIR/backend/storage/app/keys" ]] && cp -a "$INSTALL_DIR/backend/storage/app/keys" "$TMP_STAGE/keys"
[[ -d /etc/jts ]] && cp -a /etc/jts "$TMP_STAGE/etc_jts"

OUT_FILE="${BACKUP_DIR}/jts_backup_${STAMP}.tar.gz"
tar -czf "$OUT_FILE" -C "$TMP_STAGE" .
chmod 600 "$OUT_FILE"
rm -rf "$TMP_STAGE"

find "$BACKUP_DIR" -name "jts_backup_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[OK] Sauvegarde créée : $OUT_FILE"
