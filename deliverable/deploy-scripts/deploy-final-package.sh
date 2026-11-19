#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES PANEL — Script Principal de Déploiement Final
# Déploie JUST_TECH_SERVICES_PANEL_FINAL.zip sur Ubuntu 22.04 / 24.04 LTS
# Usage: sudo bash deploy-final-package.sh /chemin/JUST_TECH_SERVICES_PANEL_FINAL.zip
# ==============================================================================
set -euo pipefail

ZIP_INPUT="${1:-./JUST_TECH_SERVICES_PANEL_FINAL.zip}"
INSTALL_DIR="${JTS_INSTALL_DIR:-/opt/justtech-panel}"
PANEL_DOMAIN="${JTS_PANEL_DOMAIN:-panel.justtechservices.xyz}"
API_DOMAIN="${JTS_API_DOMAIN:-api.justtechservices.xyz}"
SLOWDNS_NS_DOMAIN="${JTS_SLOWDNS_NS_DOMAIN:-ns1.justtechservices.xyz}"
ADMIN_EMAIL="${JTS_ADMIN_EMAIL:-admin@justtechservices.xyz}"
SKIP_TLS="${JTS_SKIP_TLS:-0}"

log()  { printf '\033[1;33m[JTS-DEPLOY]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ERREUR]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Exécutez ce script avec sudo ou en tant que root."
[[ -f "$ZIP_INPUT" ]] || fail "Archive introuvable : $ZIP_INPUT"

# 1. Vérification SHA-256 si le fichier compagnon .sha256 est présent
if [[ -f "${ZIP_INPUT}.sha256" ]]; then
    log "Vérification de l'empreinte SHA-256 de l'archive..."
    (cd "$(dirname "$ZIP_INPUT")" && sha256sum -c "$(basename "${ZIP_INPUT}.sha256")")
    ok "Intégrité SHA-256 confirmée."
fi

# 2. Dépendances système de base & Docker Engine
log "Installation des paquets prérequis..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq unzip curl openssl ca-certificates gnupg lsb-release jq iptables-persistent netfilter-persistent fail2ban nginx

if ! command -v docker >/dev/null 2>&1; then
    log "Installation de Docker Engine & Compose v2..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 requis."

# 3. Sauvegarde d'une éventuelle installation existante (.env + clés SSH)
BACKUP_TMP=""
if [[ -d "$INSTALL_DIR/backend" ]]; then
    BACKUP_TMP="$(mktemp -d)"
    [[ -f "$INSTALL_DIR/backend/.env" ]] && cp -a "$INSTALL_DIR/backend/.env" "$BACKUP_TMP/.env"
    [[ -d "$INSTALL_DIR/backend/storage/app/keys" ]] && cp -a "$INSTALL_DIR/backend/storage/app/keys" "$BACKUP_TMP/keys"
    log "Configuration existante préservée temporairement dans $BACKUP_TMP."
fi

# 4. Extraction propre du package dans /opt/justtech-panel
TMP_EXTRACT="$(mktemp -d)"
unzip -q -o "$ZIP_INPUT" -d "$TMP_EXTRACT"
mkdir -p "$INSTALL_DIR"
cp -a "$TMP_EXTRACT/JUST_TECH_SERVICES_PANEL/." "$INSTALL_DIR/"
rm -rf "$TMP_EXTRACT"
chmod +x "$INSTALL_DIR"/infra/*.sh "$INSTALL_DIR"/infra/scripts/*.sh

if [[ -n "$BACKUP_TMP" ]]; then
    [[ -f "$BACKUP_TMP/.env" ]] && cp -a "$BACKUP_TMP/.env" "$INSTALL_DIR/backend/.env"
    [[ -d "$BACKUP_TMP/keys" ]] && mkdir -p "$INSTALL_DIR/backend/storage/app" && cp -a "$BACKUP_TMP/keys" "$INSTALL_DIR/backend/storage/app/keys"
    rm -rf "$BACKUP_TMP"
fi

# 5. Génération sécurisée du .env et des secrets cryptographiques
ENV_FILE="$INSTALL_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    cp "$INSTALL_DIR/backend/.env.example" "$ENV_FILE"
fi

generate_if_placeholder() {
    local key="$1"
    local placeholder="$2"
    local new_val="$3"
    if grep -qE "^${key}=(${placeholder}|)$" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=${new_val}|g" "$ENV_FILE"
    fi
}

generate_if_placeholder "DB_PASSWORD" "CHANGE_ME_STRONG_PG_PASS" "$(openssl rand -hex 24)"
generate_if_placeholder "REDIS_PASSWORD" "CHANGE_ME_STRONG_REDIS_PASS" "$(openssl rand -hex 24)"
generate_if_placeholder "JTS_AGENT_HMAC_SECRET" "CHANGE_ME_64_HEX_HMAC_SECRET" "$(openssl rand -hex 32)"
sed -i "s|^APP_URL=.*|APP_URL=https://${PANEL_DOMAIN}|g" "$ENV_FILE"

# Export variables pour docker compose
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# 6. Clé SSH Ed25519 dédiée au pont Laravel <-> Serveurs VPN
KEY_DIR="$INSTALL_DIR/backend/storage/app/keys"
KEY_FILE="$KEY_DIR/jts_vpn_ed25519"
mkdir -p "$KEY_DIR"
if [[ ! -f "$KEY_FILE" ]]; then
    ssh-keygen -t ed25519 -C "jts-panel-bridge" -f "$KEY_FILE" -N "" >/dev/null
    log "Paire de clés SSH Ed25519 générée : $KEY_FILE"
fi
chown -R 1000:1000 "$INSTALL_DIR/backend"
chmod 700 "$KEY_DIR"
chmod 600 "$KEY_FILE"

# 7. Configuration système Ubuntu, Pare-feu, SlowDNS & Agent Python
cd "$INSTALL_DIR"
bash "$INSTALL_DIR/infra/ubuntu-setup.sh"
bash "$INSTALL_DIR/infra/scripts/setup-firewall-fail2ban.sh"
bash "$INSTALL_DIR/infra/scripts/setup-slowdns.sh" "$SLOWDNS_NS_DOMAIN"

# Enregistrement automatique de la clé publique locale pour jts-provisioner (nœud local prêt)
mkdir -p /home/jts-provisioner/.ssh
if ! grep -qxFf "${KEY_FILE}.pub" /home/jts-provisioner/.ssh/authorized_keys 2>/dev/null; then
    cat "${KEY_FILE}.pub" >> /home/jts-provisioner/.ssh/authorized_keys
fi
chown -R jts-provisioner:jts-provisioner /home/jts-provisioner/.ssh
chmod 700 /home/jts-provisioner/.ssh
chmod 600 /home/jts-provisioner/.ssh/authorized_keys

# 8. Démarrage de la stack Docker non-root + Migrations Laravel
log "Construction et démarrage des conteneurs Docker..."
docker compose --env-file "$ENV_FILE" up -d --build

log "Attente de disponibilité PostgreSQL..."
for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U "${DB_USERNAME:-jts_user}" -d "${DB_DATABASE:-just_tech_panel}" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

if [[ ! -d "$INSTALL_DIR/backend/vendor" ]]; then
    log "Installation des dépendances PHP Composer..."
    docker compose exec -T app composer install --no-dev --optimize-autoloader --no-interaction
fi

if grep -qE "^APP_KEY=$" "$ENV_FILE"; then
    docker compose exec -T app php artisan key:generate --force
fi

docker compose exec -T app php artisan migrate --seed --force
docker compose exec -T app php artisan config:cache
docker compose exec -T app php artisan route:cache || true
docker compose exec -T app php artisan jts:vpn-sync-accounts || true

# 9. Reverse Proxy Nginx hôte + TLS
bash "$INSTALL_DIR/infra/scripts/setup-nginx-tls.sh" "$PANEL_DOMAIN" "$API_DOMAIN" "$ADMIN_EMAIL" "$SKIP_TLS"

# 10. Vérification finale
bash "$INSTALL_DIR/infra/scripts/healthcheck-deploy.sh"
ok "Déploiement JUST TECH SERVICES PANEL terminé avec succès sur https://${PANEL_DOMAIN}"
