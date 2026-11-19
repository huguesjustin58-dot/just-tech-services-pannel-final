#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Vérification de Santé Post-Déploiement
# ==============================================================================
set -euo pipefail

INSTALL_DIR="${JTS_INSTALL_DIR:-/opt/justtech-panel}"
ERRORS=0

check_step() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        printf '\033[1;32m[PASS]\033[0m %s\n' "$label"
    else
        printf '\033[1;31m[FAIL]\033[0m %s\n' "$label"
        ERRORS=$((ERRORS + 1))
    fi
}

cd "$INSTALL_DIR"
check_step "Conteneur PostgreSQL 16 sain" docker compose exec -T postgres pg_isready -U "${DB_USERNAME:-jts_user}"
check_step "Conteneur Redis 7 actif" docker compose ps --status running redis
check_step "Conteneur PHP-FPM (app) actif" docker compose ps --status running app
check_step "Conteneur Laravel Horizon actif" docker compose ps --status running horizon
check_step "Conteneur Scheduler actif" docker compose ps --status running scheduler
check_step "Conteneur Nginx interne actif" docker compose ps --status running nginx
check_step "Timer systemd jts-quota-reaper actif" systemctl is-active jts-quota-reaper.timer
check_step "Service Fail2ban actif" systemctl is-active fail2ban
check_step "Chaîne iptables JTS_QUOTA présente" iptables -L JTS_QUOTA -n
check_step "Réponse HTTP locale Nginx (:8080)" curl -fsS -o /dev/null http://127.0.0.1:8080/

if [[ "$ERRORS" -gt 0 ]]; then
    echo "Healthcheck terminé avec ${ERRORS} erreur(s)." >&2
    exit 1
fi

echo "Tous les contrôles de santé JUST TECH SERVICES PANEL sont verts."
