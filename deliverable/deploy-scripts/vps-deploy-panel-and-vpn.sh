#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Déploiement Automatisé VPS (Panel + Stack VPN Complète)
# Compatible Mode Nom de Domaine + HTTPS Let's Encrypt & Mode Adresse IP Directe
# Compatible Ubuntu 22.04 / 24.04 LTS & Debian 12
#
# Stack déployée sur le VPS :
#   1. JUST TECH SERVICES PANEL (Node.js 20 + Express + React/Vite build -> systemd jts-panel.service :3000)
#   2. Reverse Proxy Nginx (:80 & :443 Let's Encrypt TLS + route WebSocket /ws, /ssh, /tunnel)
#   3. Stack VPN Multi-Protocole (compatible 100% avec les 10 protocoles JSON v1) :
#      - OpenSSH (:22, :2222)
#      - Proxy HTTP / WebSocket Payload JTS (:8080 & :80/ws, :443/ws -> 127.0.0.1:22 avec 101 Switching Protocols)
#      - Stunnel4 TLS / SNI (:8443 -> Proxy WebSocket / SSH utilisant le certificat Let's Encrypt ou auto-signé)
#      - BadVPN UDPGW (:7300 -> Appels VoIP / Jeux UDP)
#      - SlowDNS dnstt-server (:5300/udp -> 127.0.0.1:22)
#      - Pare-feu UFW & Fail2ban
# ==============================================================================
set -euo pipefail

INSTALL_DIR="${JTS_INSTALL_DIR:-/opt/justtech-panel}"
RELEASE_ARCHIVE="${1:-/tmp/jts-release.tar.gz}"
BOOTSTRAP_DIR="${2:-}"
DETECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
PANEL_HOST="${JTS_PANEL_DOMAIN:-${DETECTED_IP}}"
SLOWDNS_NS_DOMAIN="${JTS_SLOWDNS_NS_DOMAIN:-sdns1.justtechservices.xyz}"
SUPERADMIN_EMAIL="${JTS_SUPERADMIN_EMAIL:-}"
SUPERADMIN_PASSWORD="${JTS_SUPERADMIN_PASSWORD:-}"
DEPLOY_VPN_STACK="${JTS_DEPLOY_VPN_STACK:-true}"
ENABLE_SSL="${JTS_ENABLE_SSL:-true}"

# Détection automatique : Nom de Domaine vs Adresse IPv4
IS_IPV4="false"
if [[ "${PANEL_HOST}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IS_IPV4="true"
fi

if [[ "${IS_IPV4}" == "false" && "${ENABLE_SSL}" == "true" ]]; then
  PUBLIC_SCHEME="https"
else
  PUBLIC_SCHEME="http"
fi

log()  { printf '\033[1;36m[JTS-VPS-DEPLOY]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Ce script doit être exécuté en tant que root (ou via sudo)."

export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------------------
# 1. Paquets système requis & Node.js 20 LTS
# ------------------------------------------------------------------------------
log "1/7 — Mise à jour système et installation des dépendances VPS (Domaine/Hôte: ${PANEL_HOST})..."
apt-get update -qq
apt-get install -y -qq \
  curl wget unzip tar git jq openssl ca-certificates gnupg lsb-release \
  nginx certbot python3-certbot-nginx python3 \
  openssh-server stunnel4 ufw fail2ban iptables cmake build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  log "Installation de Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
ok "Node.js $(node -v) & npm $(npm -v) prêts."

# ------------------------------------------------------------------------------
# 2. Déploiement du code JUST TECH SERVICES PANEL
# ------------------------------------------------------------------------------
log "2/7 — Déploiement de JUST TECH SERVICES PANEL dans ${INSTALL_DIR}..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT_CANDIDATE="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || echo '')"

mkdir -p "${INSTALL_DIR}" "${INSTALL_DIR}/data"

BACKUP_STATE_DIR="$(mktemp -d)"
if [[ -d "${INSTALL_DIR}/data" ]]; then
  cp -a "${INSTALL_DIR}/data/." "${BACKUP_STATE_DIR}/" 2>/dev/null || true
fi

if [[ -f "${RELEASE_ARCHIVE}" && "${RELEASE_ARCHIVE}" == *.tar.gz ]]; then
  tar -xzf "${RELEASE_ARCHIVE}" -C "${INSTALL_DIR}"
  rm -f "${RELEASE_ARCHIVE}"
  ok "Archive tar.gz extraite dans ${INSTALL_DIR}."
elif [[ -f "${RELEASE_ARCHIVE}" && "${RELEASE_ARCHIVE}" == *.zip ]]; then
  TMP_ZIP_DIR="$(mktemp -d)"
  unzip -q -o "${RELEASE_ARCHIVE}" -d "${TMP_ZIP_DIR}"
  if [[ -d "${TMP_ZIP_DIR}/JUST_TECH_SERVICES_PANEL_FINAL" ]]; then
    cp -a "${TMP_ZIP_DIR}/JUST_TECH_SERVICES_PANEL_FINAL/." "${INSTALL_DIR}/"
  else
    cp -a "${TMP_ZIP_DIR}/." "${INSTALL_DIR}/"
  fi
  rm -rf "${TMP_ZIP_DIR}"
  ok "Archive ZIP extraite dans ${INSTALL_DIR}."
elif [[ -f "/tmp/JUST_TECH_SERVICES_PANEL_FINAL.zip" ]]; then
  TMP_ZIP_DIR="$(mktemp -d)"
  unzip -q -o "/tmp/JUST_TECH_SERVICES_PANEL_FINAL.zip" -d "${TMP_ZIP_DIR}"
  if [[ -d "${TMP_ZIP_DIR}/JUST_TECH_SERVICES_PANEL_FINAL" ]]; then
    cp -a "${TMP_ZIP_DIR}/JUST_TECH_SERVICES_PANEL_FINAL/." "${INSTALL_DIR}/"
  else
    cp -a "${TMP_ZIP_DIR}/." "${INSTALL_DIR}/"
  fi
  rm -rf "${TMP_ZIP_DIR}"
  ok "Archive /tmp/JUST_TECH_SERVICES_PANEL_FINAL.zip extraite dans ${INSTALL_DIR}."
elif [[ -n "${JTS_GIT_REPO:-}" ]]; then
  log "Clonage du dépôt Git ${JTS_GIT_REPO}..."
  TMP_GIT_DIR="$(mktemp -d)"
  git clone --depth 1 "${JTS_GIT_REPO}" "${TMP_GIT_DIR}/repo"
  cp -a "${TMP_GIT_DIR}/repo/." "${INSTALL_DIR}/"
  rm -rf "${TMP_GIT_DIR}"
  ok "Dépôt Git déployé dans ${INSTALL_DIR}."
elif [[ -n "${PROJECT_ROOT_CANDIDATE}" && -f "${PROJECT_ROOT_CANDIDATE}/server.ts" && "${PROJECT_ROOT_CANDIDATE}" != "${INSTALL_DIR}" ]]; then
  cp -a "${PROJECT_ROOT_CANDIDATE}/." "${INSTALL_DIR}/"
  ok "Fichiers copiés depuis ${PROJECT_ROOT_CANDIDATE} vers ${INSTALL_DIR}."
else
  warn "Utilisation des fichiers déjà présents dans ${INSTALL_DIR}."
fi

if [[ -d "${BACKUP_STATE_DIR}" ]]; then
  mkdir -p "${INSTALL_DIR}/data"
  cp -a "${BACKUP_STATE_DIR}/." "${INSTALL_DIR}/data/" 2>/dev/null || true
  rm -rf "${BACKUP_STATE_DIR}"
fi

cd "${INSTALL_DIR}"
log "Installation des dépendances npm & compilation du bundle production..."
npm install --include=dev --no-audit --no-fund
npm run build
ok "Build frontend Vite et serveur TypeScript prêts."

# ------------------------------------------------------------------------------
# 3. Génération du fichier .env (JTS_SUPERADMIN_EMAIL & JTS_SUPERADMIN_PASSWORD)
# ------------------------------------------------------------------------------
log "3/7 — Configuration de l'environnement (.env) pour ${PUBLIC_SCHEME}://${PANEL_HOST}..."
ENV_FILE="${INSTALL_DIR}/.env"
dotenv_quote() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//
ok "Fichier ${ENV_FILE} généré (APP_URL=${PUBLIC_SCHEME}://${PANEL_HOST} | Super Admin: ${SUPERADMIN_EMAIL})."

# ------------------------------------------------------------------------------
# 4. Service systemd pour JUST TECH SERVICES PANEL (jts-panel.service)
# ------------------------------------------------------------------------------
log "4/7 — Configuration du service systemd jts-panel.service..."
NPX_BIN="$(command -v npx)"
cat <<EOF > /etc/systemd/system/jts-panel.service
[Unit]
Description=JUST TECH SERVICES PANEL (Full-Stack Console & Cloud Config API v1)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NPX_BIN} tsx server.ts
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable jts-panel.service
systemctl restart jts-panel.service
ok "Service jts-panel.service démarré sur 127.0.0.1:3000."

# ------------------------------------------------------------------------------
# 5. Provisionnement de la Stack VPN Multi-Protocole sur le VPS
# ------------------------------------------------------------------------------
if [[ "${DEPLOY_VPN_STACK}" == "true" ]]; then
  log "5/7 — Installation et configuration de la Stack VPN JUST TECH SERVICES..."

  # 5a. OpenSSH multi-port (:22 et :2222)
  if ! grep -q "^Port 2222" /etc/ssh/sshd_config; then
    sed -i 's/^#\?Port 22$/Port 22\nPort 2222/' /etc/ssh/sshd_config || true
    if ! grep -q "^Port 22" /etc/ssh/sshd_config; then
      printf "\nPort 22\nPort 2222\n" >> /etc/ssh/sshd_config
    fi
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi

  # 5b. Proxy Multiplexeur HTTP / WebSocket Payload JTS (:8080 -> 127.0.0.1:22)
  cat <<'PYEOF' > /usr/local/bin/jts-ws-proxy.py
#!/usr/bin/env python3
"""
JUST TECH SERVICES — HTTP / WebSocket Payload SSH Tunnel Proxy (:8080 -> 127.0.0.1:22)
Accepte tous les payloads d'injection HTTP/WebSocket (GET, CONNECT, Upgrade: websocket, split)
et répond "HTTP/1.1 101 Switching Protocols\r\n\r\n" avant de relayer le flux TCP vers OpenSSH.
"""
import asyncio
import sys

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 22
HANDSHAKE_RESPONSE = (
    b"HTTP/1.1 101 Switching Protocols\r\n"
    b"Upgrade: websocket\r\n"
    b"Connection: Upgrade\r\n"
    b"Server: JTS-Tunnel-Edge\r\n\r\n"
)

async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while not reader.at_eof():
            data = await reader.read(16384)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    try:
        initial = await asyncio.wait_for(client_reader.read(4096), timeout=10.0)
        if not initial:
            client_writer.close()
            return

        target_reader, target_writer = await asyncio.wait_for(
            asyncio.open_connection(TARGET_HOST, TARGET_PORT), timeout=5.0
        )

        if initial.startswith(b"SSH-"):
            target_writer.write(initial)
            await target_writer.drain()
        else:
            client_writer.write(HANDSHAKE_RESPONSE)
            await client_writer.drain()

        await asyncio.gather(
            pipe(client_reader, target_writer),
            pipe(target_reader, client_writer),
        )
    except Exception:
        try:
            client_writer.close()
        except Exception:
            pass

async def main():
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(main())
PYEOF
  chmod +x /usr/local/bin/jts-ws-proxy.py

  cat <<EOF > /etc/systemd/system/jts-ws-proxy.service
[Unit]
Description=JUST TECH SERVICES — HTTP & WebSocket SSH Payload Proxy (:8080)
After=network.target ssh.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/jts-ws-proxy.py 8080
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now jts-ws-proxy.service
  ok "Proxy WebSocket/HTTP Payload actif sur :8080 -> 127.0.0.1:22."

  # 5c. Certificat TLS Stunnel4 (:8443 -> 127.0.0.1:8080)
  mkdir -p /etc/stunnel
  if [[ ! -f /etc/stunnel/jts-stunnel.pem ]]; then
    openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
      -subj "/C=CM/ST=Littoral/L=Douala/O=JUST TECH SERVICES/CN=${PANEL_HOST}" \
      -keyout /etc/stunnel/jts-stunnel.key \
      -out /etc/stunnel/jts-stunnel.crt 2>/dev/null
    cat /etc/stunnel/jts-stunnel.key /etc/stunnel/jts-stunnel.crt > /etc/stunnel/jts-stunnel.pem
    chmod 600 /etc/stunnel/jts-stunnel.pem
  fi

  cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4.pid
cert = /etc/stunnel/jts-stunnel.pem
client = no
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[jts-ssh-tls]
accept = 0.0.0.0:8443
connect = 127.0.0.1:8080
EOF
  sed -i 's/ENABLED=0/ENABLED=1/g' /etc/default/stunnel4 2>/dev/null || true
  systemctl enable --now stunnel4 2>/dev/null || systemctl restart stunnel4 2>/dev/null || true
  ok "Stunnel4 TLS/SNI configuré sur :8443 -> 127.0.0.1:8080."

  # 5d. BadVPN UDPGW (:7300)
  if [[ ! -x /usr/local/bin/badvpn-udpgw ]]; then
    log "Compilation de badvpn-udpgw (:7300)..."
    TMP_BADVPN="$(mktemp -d)"
    if git clone --depth 1 https://github.com/ambrop72/badvpn.git "${TMP_BADVPN}/badvpn" >/dev/null 2>&1; then
      mkdir -p "${TMP_BADVPN}/build"
      (
        cd "${TMP_BADVPN}/build"
        cmake "${TMP_BADVPN}/badvpn" -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 >/dev/null 2>&1
        make -j"$(nproc)" >/dev/null 2>&1
        cp udpgw/badvpn-udpgw /usr/local/bin/badvpn-udpgw
        chmod +x /usr/local/bin/badvpn-udpgw
      ) || warn "Compilation badvpn-udpgw ignorée."
    fi
    rm -rf "${TMP_BADVPN}"
  fi

  if [[ -x /usr/local/bin/badvpn-udpgw ]]; then
    cat <<EOF > /etc/systemd/system/jts-udpgw.service
[Unit]
Description=JUST TECH SERVICES — BadVPN UDPGW (:7300)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/badvpn-udpgw --listen-addr 127.0.0.1:7300 --max-clients 1000 --max-connections-for-client 10
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now jts-udpgw.service
    ok "BadVPN UDPGW actif sur 127.0.0.1:7300."
  fi

  # 5e. SlowDNS (dnstt-server sur :5300/udp -> 127.0.0.1:22)
  if [[ -f "${INSTALL_DIR}/deliverable/deploy-scripts/setup-slowdns.sh" ]]; then
    bash "${INSTALL_DIR}/deliverable/deploy-scripts/setup-slowdns.sh" "${SLOWDNS_NS_DOMAIN}" || true
  fi
fi

# ------------------------------------------------------------------------------
# 6. Reverse Proxy Nginx + Certificat HTTPS Let's Encrypt Automatique (Domaine)
# ------------------------------------------------------------------------------
log "6/7 — Configuration Nginx Reverse Proxy (${PANEL_HOST})..."
cat <<EOF > /etc/nginx/sites-available/justtech-panel.conf
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${PANEL_HOST} _;

    client_max_body_size 20M;

    # Route WebSocket Tunnel SSH (pour payloads WS/WSS sur port 80/443 avec chemin /ws, /ssh ou /tunnel)
    location ~ ^/(ws|ssh|tunnel)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Console & API JUST TECH SERVICES PANEL (port 3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/justtech-panel.conf /etc/nginx/sites-enabled/justtech-panel.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ "${ENABLE_SSL}" == "true" && "${IS_IPV4}" == "false" ]]; then
  log "Activation du certificat HTTPS Let's Encrypt via Certbot pour ${PANEL_HOST}..."
  if certbot --nginx -d "${PANEL_HOST}" --non-interactive --agree-tos -m "${SUPERADMIN_EMAIL}" --redirect; then
    ok "Certificat HTTPS Let's Encrypt actif sur https://${PANEL_HOST}"
    # Synchronise le certificat Let's Encrypt avec Stunnel4 (:8443)
    if [[ -f "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem" && -f "/etc/letsencrypt/live/${PANEL_HOST}/privkey.pem" ]]; then
      cat "/etc/letsencrypt/live/${PANEL_HOST}/privkey.pem" "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem" > /etc/stunnel/jts-stunnel.pem
      chmod 600 /etc/stunnel/jts-stunnel.pem
      systemctl restart stunnel4 2>/dev/null || true
      ok "Certificat TLS Let's Encrypt également appliqué à Stunnel4 (:8443)."
    fi
  else
    warn "Certbot n'a pas encore pu émettre le certificat pour ${PANEL_HOST} (vérifiez que l'enregistrement DNS A de ${PANEL_HOST} pointe vers ${DETECTED_IP}). Le Panel reste accessible en HTTP."
  fi
fi

# ------------------------------------------------------------------------------
# 7. Pare-feu UFW & Vérification de santé finale
# ------------------------------------------------------------------------------
log "7/7 — Ouverture des ports UFW et vérification de santé..."
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 2222/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow 8080/tcp >/dev/null 2>&1 || true
ufw allow 8443/tcp >/dev/null 2>&1 || true
ufw allow 53/udp >/dev/null 2>&1 || true
ufw allow 5300/udp >/dev/null 2>&1 || true

for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

HEALTH_JSON="$(curl -fsS http://127.0.0.1:3000/api/health || echo '{"status":"error"}')"
ok "Healthcheck Panel API : ${HEALTH_JSON}"

echo "=============================================================================="
echo " JUST TECH SERVICES — DÉPLOIEMENT VPS TERMINÉ AVEC SUCCÈS"
echo "------------------------------------------------------------------------------"
echo " Portail Client     : ${PUBLIC_SCHEME}://${PANEL_HOST}"
echo " Console SuperAdmin : ${PUBLIC_SCHEME}://${PANEL_HOST}/admin"
echo " Super Admin Email  : ${SUPERADMIN_EMAIL}"
echo " API Cloud Resolve  : ${PUBLIC_SCHEME}://${PANEL_HOST}/api/v1/cloud/resolve/{cloud_code}"
echo " Ports VPN actifs   : SSH(:22, :2222) | WSS(:443/ws) | WS(:80/ws, :8080) | TLS(:8443) | UDPGW(:7300) | SlowDNS(:5300/udp)"
if [[ -f /etc/jts/slowdns/server.pub ]]; then
  echo " Clé Publique dnstt : $(cat /etc/jts/slowdns/server.pub)"
fi
echo "=============================================================================="
\\r'/}
  value=${value//
ok "Fichier ${ENV_FILE} généré (APP_URL=${PUBLIC_SCHEME}://${PANEL_HOST} | Super Admin: ${SUPERADMIN_EMAIL})."

# ------------------------------------------------------------------------------
# 4. Service systemd pour JUST TECH SERVICES PANEL (jts-panel.service)
# ------------------------------------------------------------------------------
log "4/7 — Configuration du service systemd jts-panel.service..."
NPX_BIN="$(command -v npx)"
cat <<EOF > /etc/systemd/system/jts-panel.service
[Unit]
Description=JUST TECH SERVICES PANEL (Full-Stack Console & Cloud Config API v1)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NPX_BIN} tsx server.ts
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable jts-panel.service
systemctl restart jts-panel.service
ok "Service jts-panel.service démarré sur 127.0.0.1:3000."

# ------------------------------------------------------------------------------
# 5. Provisionnement de la Stack VPN Multi-Protocole sur le VPS
# ------------------------------------------------------------------------------
if [[ "${DEPLOY_VPN_STACK}" == "true" ]]; then
  log "5/7 — Installation et configuration de la Stack VPN JUST TECH SERVICES..."

  # 5a. OpenSSH multi-port (:22 et :2222)
  if ! grep -q "^Port 2222" /etc/ssh/sshd_config; then
    sed -i 's/^#\?Port 22$/Port 22\nPort 2222/' /etc/ssh/sshd_config || true
    if ! grep -q "^Port 22" /etc/ssh/sshd_config; then
      printf "\nPort 22\nPort 2222\n" >> /etc/ssh/sshd_config
    fi
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi

  # 5b. Proxy Multiplexeur HTTP / WebSocket Payload JTS (:8080 -> 127.0.0.1:22)
  cat <<'PYEOF' > /usr/local/bin/jts-ws-proxy.py
#!/usr/bin/env python3
"""
JUST TECH SERVICES — HTTP / WebSocket Payload SSH Tunnel Proxy (:8080 -> 127.0.0.1:22)
Accepte tous les payloads d'injection HTTP/WebSocket (GET, CONNECT, Upgrade: websocket, split)
et répond "HTTP/1.1 101 Switching Protocols\r\n\r\n" avant de relayer le flux TCP vers OpenSSH.
"""
import asyncio
import sys

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 22
HANDSHAKE_RESPONSE = (
    b"HTTP/1.1 101 Switching Protocols\r\n"
    b"Upgrade: websocket\r\n"
    b"Connection: Upgrade\r\n"
    b"Server: JTS-Tunnel-Edge\r\n\r\n"
)

async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while not reader.at_eof():
            data = await reader.read(16384)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    try:
        initial = await asyncio.wait_for(client_reader.read(4096), timeout=10.0)
        if not initial:
            client_writer.close()
            return

        target_reader, target_writer = await asyncio.wait_for(
            asyncio.open_connection(TARGET_HOST, TARGET_PORT), timeout=5.0
        )

        if initial.startswith(b"SSH-"):
            target_writer.write(initial)
            await target_writer.drain()
        else:
            client_writer.write(HANDSHAKE_RESPONSE)
            await client_writer.drain()

        await asyncio.gather(
            pipe(client_reader, target_writer),
            pipe(target_reader, client_writer),
        )
    except Exception:
        try:
            client_writer.close()
        except Exception:
            pass

async def main():
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(main())
PYEOF
  chmod +x /usr/local/bin/jts-ws-proxy.py

  cat <<EOF > /etc/systemd/system/jts-ws-proxy.service
[Unit]
Description=JUST TECH SERVICES — HTTP & WebSocket SSH Payload Proxy (:8080)
After=network.target ssh.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/jts-ws-proxy.py 8080
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now jts-ws-proxy.service
  ok "Proxy WebSocket/HTTP Payload actif sur :8080 -> 127.0.0.1:22."

  # 5c. Certificat TLS Stunnel4 (:8443 -> 127.0.0.1:8080)
  mkdir -p /etc/stunnel
  if [[ ! -f /etc/stunnel/jts-stunnel.pem ]]; then
    openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
      -subj "/C=CM/ST=Littoral/L=Douala/O=JUST TECH SERVICES/CN=${PANEL_HOST}" \
      -keyout /etc/stunnel/jts-stunnel.key \
      -out /etc/stunnel/jts-stunnel.crt 2>/dev/null
    cat /etc/stunnel/jts-stunnel.key /etc/stunnel/jts-stunnel.crt > /etc/stunnel/jts-stunnel.pem
    chmod 600 /etc/stunnel/jts-stunnel.pem
  fi

  cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4.pid
cert = /etc/stunnel/jts-stunnel.pem
client = no
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[jts-ssh-tls]
accept = 0.0.0.0:8443
connect = 127.0.0.1:8080
EOF
  sed -i 's/ENABLED=0/ENABLED=1/g' /etc/default/stunnel4 2>/dev/null || true
  systemctl enable --now stunnel4 2>/dev/null || systemctl restart stunnel4 2>/dev/null || true
  ok "Stunnel4 TLS/SNI configuré sur :8443 -> 127.0.0.1:8080."

  # 5d. BadVPN UDPGW (:7300)
  if [[ ! -x /usr/local/bin/badvpn-udpgw ]]; then
    log "Compilation de badvpn-udpgw (:7300)..."
    TMP_BADVPN="$(mktemp -d)"
    if git clone --depth 1 https://github.com/ambrop72/badvpn.git "${TMP_BADVPN}/badvpn" >/dev/null 2>&1; then
      mkdir -p "${TMP_BADVPN}/build"
      (
        cd "${TMP_BADVPN}/build"
        cmake "${TMP_BADVPN}/badvpn" -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 >/dev/null 2>&1
        make -j"$(nproc)" >/dev/null 2>&1
        cp udpgw/badvpn-udpgw /usr/local/bin/badvpn-udpgw
        chmod +x /usr/local/bin/badvpn-udpgw
      ) || warn "Compilation badvpn-udpgw ignorée."
    fi
    rm -rf "${TMP_BADVPN}"
  fi

  if [[ -x /usr/local/bin/badvpn-udpgw ]]; then
    cat <<EOF > /etc/systemd/system/jts-udpgw.service
[Unit]
Description=JUST TECH SERVICES — BadVPN UDPGW (:7300)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/badvpn-udpgw --listen-addr 127.0.0.1:7300 --max-clients 1000 --max-connections-for-client 10
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now jts-udpgw.service
    ok "BadVPN UDPGW actif sur 127.0.0.1:7300."
  fi

  # 5e. SlowDNS (dnstt-server sur :5300/udp -> 127.0.0.1:22)
  if [[ -f "${INSTALL_DIR}/deliverable/deploy-scripts/setup-slowdns.sh" ]]; then
    bash "${INSTALL_DIR}/deliverable/deploy-scripts/setup-slowdns.sh" "${SLOWDNS_NS_DOMAIN}" || true
  fi
fi

# ------------------------------------------------------------------------------
# 6. Reverse Proxy Nginx + Certificat HTTPS Let's Encrypt Automatique (Domaine)
# ------------------------------------------------------------------------------
log "6/7 — Configuration Nginx Reverse Proxy (${PANEL_HOST})..."
cat <<EOF > /etc/nginx/sites-available/justtech-panel.conf
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${PANEL_HOST} _;

    client_max_body_size 20M;

    # Route WebSocket Tunnel SSH (pour payloads WS/WSS sur port 80/443 avec chemin /ws, /ssh ou /tunnel)
    location ~ ^/(ws|ssh|tunnel)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Console & API JUST TECH SERVICES PANEL (port 3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/justtech-panel.conf /etc/nginx/sites-enabled/justtech-panel.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ "${ENABLE_SSL}" == "true" && "${IS_IPV4}" == "false" ]]; then
  log "Activation du certificat HTTPS Let's Encrypt via Certbot pour ${PANEL_HOST}..."
  if certbot --nginx -d "${PANEL_HOST}" --non-interactive --agree-tos -m "${SUPERADMIN_EMAIL}" --redirect; then
    ok "Certificat HTTPS Let's Encrypt actif sur https://${PANEL_HOST}"
    # Synchronise le certificat Let's Encrypt avec Stunnel4 (:8443)
    if [[ -f "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem" && -f "/etc/letsencrypt/live/${PANEL_HOST}/privkey.pem" ]]; then
      cat "/etc/letsencrypt/live/${PANEL_HOST}/privkey.pem" "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem" > /etc/stunnel/jts-stunnel.pem
      chmod 600 /etc/stunnel/jts-stunnel.pem
      systemctl restart stunnel4 2>/dev/null || true
      ok "Certificat TLS Let's Encrypt également appliqué à Stunnel4 (:8443)."
    fi
  else
    warn "Certbot n'a pas encore pu émettre le certificat pour ${PANEL_HOST} (vérifiez que l'enregistrement DNS A de ${PANEL_HOST} pointe vers ${DETECTED_IP}). Le Panel reste accessible en HTTP."
  fi
fi

# ------------------------------------------------------------------------------
# 7. Pare-feu UFW & Vérification de santé finale
# ------------------------------------------------------------------------------
log "7/7 — Ouverture des ports UFW et vérification de santé..."
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 2222/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow 8080/tcp >/dev/null 2>&1 || true
ufw allow 8443/tcp >/dev/null 2>&1 || true
ufw allow 53/udp >/dev/null 2>&1 || true
ufw allow 5300/udp >/dev/null 2>&1 || true

for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

HEALTH_JSON="$(curl -fsS http://127.0.0.1:3000/api/health || echo '{"status":"error"}')"
ok "Healthcheck Panel API : ${HEALTH_JSON}"

echo "=============================================================================="
echo " JUST TECH SERVICES — DÉPLOIEMENT VPS TERMINÉ AVEC SUCCÈS"
echo "------------------------------------------------------------------------------"
echo " Portail Client     : ${PUBLIC_SCHEME}://${PANEL_HOST}"
echo " Console SuperAdmin : ${PUBLIC_SCHEME}://${PANEL_HOST}/admin"
echo " Super Admin Email  : ${SUPERADMIN_EMAIL}"
echo " API Cloud Resolve  : ${PUBLIC_SCHEME}://${PANEL_HOST}/api/v1/cloud/resolve/{cloud_code}"
echo " Ports VPN actifs   : SSH(:22, :2222) | WSS(:443/ws) | WS(:80/ws, :8080) | TLS(:8443) | UDPGW(:7300) | SlowDNS(:5300/udp)"
if [[ -f /etc/jts/slowdns/server.pub ]]; then
  echo " Clé Publique dnstt : $(cat /etc/jts/slowdns/server.pub)"
fi
echo "=============================================================================="
\\n'/}
  printf '"%s"' "$value"
}

JTS_MOBILE_CONTRACT_SECRET="${JTS_MOBILE_CONTRACT_SECRET:-$(openssl rand -hex 32)}"
{
  printf 'NODE_ENV=production\\nPORT=3000\\nAPP_URL=%s\\n' "$(dotenv_quote "${PUBLIC_SCHEME}://${PANEL_HOST}")"
  printf 'JTS_SUPERADMIN_EMAIL=%s\\n' "$(dotenv_quote "$SUPERADMIN_EMAIL")"
  printf 'JTS_SUPERADMIN_PASSWORD=%s\\n' "$(dotenv_quote "$SUPERADMIN_PASSWORD")"
  printf 'JTS_MOBILE_CONTRACT_SECRET=%s\\n' "$(dotenv_quote "$JTS_MOBILE_CONTRACT_SECRET")"
  printf 'JTS_SLOWDNS_NS_DOMAIN=%s\\n' "$(dotenv_quote "${JTS_SLOWDNS_NS_DOMAIN:-}")"
  printf 'JTS_SLOWDNS_PUBKEY=%s\\n' "$(dotenv_quote "${JTS_SLOWDNS_PUBKEY:-}")"
  printf 'MTN_MOMO_BENEFICIARY=%s\\n' "$(dotenv_quote "${MTN_MOMO_BENEFICIARY:-}")"
  printf 'MTN_MOMO_NUMBER=%s\\n' "$(dotenv_quote "${MTN_MOMO_NUMBER:-}")"
  printf 'ORANGE_MONEY_BENEFICIARY=%s\\n' "$(dotenv_quote "${ORANGE_MONEY_BENEFICIARY:-}")"
  printf 'ORANGE_MONEY_NUMBER=%s\\n' "$(dotenv_quote "${ORANGE_MONEY_NUMBER:-}")"
  printf 'ORANGE_MERCHANT_OM_ASSO=%s\\n' "$(dotenv_quote "${ORANGE_MERCHANT_OM_ASSO:-}")"
  printf 'ORANGE_MONTHLY_CEILING_FCFA=%s\\n' "$(dotenv_quote "${ORANGE_MONTHLY_CEILING_FCFA:-1500000}")"
} > "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
ok "Fichier ${ENV_FILE} généré (APP_URL=${PUBLIC_SCHEME}://${PANEL_HOST} | Super Admin: ${SUPERADMIN_EMAIL})."

# ------------------------------------------------------------------------------
# 4. Service systemd pour JUST TECH SERVICES PANEL (jts-panel.service)
# ------------------------------------------------------------------------------
log "4/7 — Configuration du service systemd jts-panel.service..."
NPX_BIN="$(command -v npx)"
cat <<EOF > /etc/systemd/system/jts-panel.service
[Unit]
Description=JUST TECH SERVICES PANEL (Full-Stack Console & Cloud Config API v1)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NPX_BIN} tsx server.ts
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable jts-panel.service
systemctl restart jts-panel.service
ok "Service jts-panel.service démarré sur 127.0.0.1:3000."

# ------------------------------------------------------------------------------
# 5. Provisionnement de la Stack VPN Multi-Protocole sur le VPS
# ------------------------------------------------------------------------------
if [[ "${DEPLOY_VPN_STACK}" == "true" ]]; then
  log "5/7 — Installation et configuration de la Stack VPN JUST TECH SERVICES..."

  # 5a. OpenSSH multi-port (:22 et :2222)
  if ! grep -q "^Port 2222" /etc/ssh/sshd_config; then
    sed -i 's/^#\?Port 22$/Port 22\nPort 2222/' /etc/ssh/sshd_config || true
    if ! grep -q "^Port 22" /etc/ssh/sshd_config; then
      printf "\nPort 22\nPort 2222\n" >> /etc/ssh/sshd_config
    fi
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi

  # 5b. Proxy Multiplexeur HTTP / WebSocket Payload JTS (:8080 -> 127.0.0.1:22)
  cat <<'PYEOF' > /usr/local/bin/jts-ws-proxy.py
#!/usr/bin/env python3
"""
JUST TECH SERVICES — HTTP / WebSocket Payload SSH Tunnel Proxy (:8080 -> 127.0.0.1:22)
Accepte tous les payloads d'injection HTTP/WebSocket (GET, CONNECT, Upgrade: websocket, split)
et répond "HTTP/1.1 101 Switching Protocols\r\n\r\n" avant de relayer le flux TCP vers OpenSSH.
"""
import asyncio
import sys

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 22
HANDSHAKE_RESPONSE = (
    b"HTTP/1.1 101 Switching Protocols\r\n"
    b"Upgrade: websocket\r\n"
    b"Connection: Upgrade\r\n"
    b"Server: JTS-Tunnel-Edge\r\n\r\n"
)

async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while not reader.at_eof():
            data = await reader.read(16384)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    try:
        initial = await asyncio.wait_for(client_reader.read(4096), timeout=10.0)
        if not initial:
            client_writer.close()
            return

        target_reader, target_writer = await asyncio.wait_for(
            asyncio.open_connection(TARGET_HOST, TARGET_PORT), timeout=5.0
        )

        if initial.startswith(b"SSH-"):
            target_writer.write(initial)
            await target_writer.drain()
        else:
            client_writer.write(HANDSHAKE_RESPONSE)
            await client_writer.drain()

        await asyncio.gather(
            pipe(client_reader, target_writer),
            pipe(target_reader, client_writer),
        )
    except Exception:
        try:
            client_writer.close()
        except Exception:
            pass

async def main():
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(main())
PYEOF
  chmod +x /usr/local/bin/jts-ws-proxy.py

  cat <<EOF > /etc/systemd/system/jts-ws-proxy.service
[Unit]
Description=JUST TECH SERVICES — HTTP & WebSocket SSH Payload Proxy (:8080)
After=network.target ssh.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/jts-ws-proxy.py 8080
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now jts-ws-proxy.service
  ok "Proxy WebSocket/HTTP Payload actif sur :8080 -> 127.0.0.1:22."

  # 5c. Certificat TLS Stunnel4 (:8443 -> 127.0.0.1:8080)
  mkdir -p /etc/stunnel
  if [[ ! -f /etc/stunnel/jts-stunnel.pem ]]; then
    openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
      -subj "/C=CM/ST=Littoral/L=Douala/O=JUST TECH SERVICES/CN=${PANEL_HOST}" \
      -keyout /etc/stunnel/jts-stunnel.key \
      -out /etc/stunnel/jts-stunnel.crt 2>/dev/null
    cat /etc/stunnel/jts-stunnel.key /etc/stunnel/jts-stunnel.crt > /etc/stunnel/jts-stunnel.pem
    chmod 600 /etc/stunnel/jts-stunnel.pem
  fi

  cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4.pid
cert = /etc/stunnel/jts-stunnel.pem
client = no
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[jts-ssh-tls]
accept = 0.0.0.0:8443
connect = 127.0.0.1:8080
EOF
  sed -i 's/ENABLED=0/ENABLED=1/g' /etc/default/stunnel4 2>/dev/null || true
  systemctl enable --now stunnel4 2>/dev/null || systemctl restart stunnel4 2>/dev/null || true
  ok "Stunnel4 TLS/SNI configuré sur :8443 -> 127.0.0.1:8080."

  # 5d. BadVPN UDPGW (:7300)
  if [[ ! -x /usr/local/bin/badvpn-udpgw ]]; then
    log "Compilation de badvpn-udpgw (:7300)..."
    TMP_BADVPN="$(mktemp -d)"
    if git clone --depth 1 https://github.com/ambrop72/badvpn.git "${TMP_BADVPN}/badvpn" >/dev/null 2>&1; then
      mkdir -p "${TMP_BADVPN}/build"
      (
        cd "${TMP_BADVPN}/build"
        cmake "${TMP_BADVPN}/badvpn" -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 >/dev/null 2>&1
        make -j"$(nproc)" >/dev/null 2>&1
        cp udpgw/badvpn-udpgw /usr/local/bin/badvpn-udpgw
        chmod +x /usr/local/bin/badvpn-udpgw
      ) || warn "Compilation badvpn-udpgw ignorée."
    fi
    rm -rf "${TMP_BADVPN}"
  fi

  if [[ -x /usr/local/bin/badvpn-udpgw ]]; then
    cat <<EOF > /etc/systemd/system/jts-udpgw.service
[Unit]
Description=JUST TECH SERVICES — BadVPN UDPGW (:7300)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/badvpn-udpgw --listen-addr 127.0.0.1:7300 --max-clients 1000 --max-connections-for-client 10
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now jts-udpgw.service
    ok "BadVPN UDPGW actif sur 127.0.0.1:7300."
  fi

  # 5e. SlowDNS (dnstt-server sur :5300/udp -> 127.0.0.1:22)
  if [[ -f "${INSTALL_DIR}/deliverable/deploy-scripts/setup-slowdns.sh" ]]; then
    bash "${INSTALL_DIR}/deliverable/deploy-scripts/setup-slowdns.sh" "${SLOWDNS_NS_DOMAIN}" || true
  fi
fi

# ------------------------------------------------------------------------------
# 6. Reverse Proxy Nginx + Certificat HTTPS Let's Encrypt Automatique (Domaine)
# ------------------------------------------------------------------------------
log "6/7 — Configuration Nginx Reverse Proxy (${PANEL_HOST})..."
cat <<EOF > /etc/nginx/sites-available/justtech-panel.conf
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${PANEL_HOST} _;

    client_max_body_size 20M;

    # Route WebSocket Tunnel SSH (pour payloads WS/WSS sur port 80/443 avec chemin /ws, /ssh ou /tunnel)
    location ~ ^/(ws|ssh|tunnel)(/|$) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Console & API JUST TECH SERVICES PANEL (port 3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/justtech-panel.conf /etc/nginx/sites-enabled/justtech-panel.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ "${ENABLE_SSL}" == "true" && "${IS_IPV4}" == "false" ]]; then
  log "Activation du certificat HTTPS Let's Encrypt via Certbot pour ${PANEL_HOST}..."
  if certbot --nginx -d "${PANEL_HOST}" --non-interactive --agree-tos -m "${SUPERADMIN_EMAIL}" --redirect; then
    ok "Certificat HTTPS Let's Encrypt actif sur https://${PANEL_HOST}"
    # Synchronise le certificat Let's Encrypt avec Stunnel4 (:8443)
    if [[ -f "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem" && -f "/etc/letsencrypt/live/${PANEL_HOST}/privkey.pem" ]]; then
      cat "/etc/letsencrypt/live/${PANEL_HOST}/privkey.pem" "/etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem" > /etc/stunnel/jts-stunnel.pem
      chmod 600 /etc/stunnel/jts-stunnel.pem
      systemctl restart stunnel4 2>/dev/null || true
      ok "Certificat TLS Let's Encrypt également appliqué à Stunnel4 (:8443)."
    fi
  else
    warn "Certbot n'a pas encore pu émettre le certificat pour ${PANEL_HOST} (vérifiez que l'enregistrement DNS A de ${PANEL_HOST} pointe vers ${DETECTED_IP}). Le Panel reste accessible en HTTP."
  fi
fi

# ------------------------------------------------------------------------------
# 7. Pare-feu UFW & Vérification de santé finale
# ------------------------------------------------------------------------------
log "7/7 — Ouverture des ports UFW et vérification de santé..."
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 2222/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow 8080/tcp >/dev/null 2>&1 || true
ufw allow 8443/tcp >/dev/null 2>&1 || true
ufw allow 53/udp >/dev/null 2>&1 || true
ufw allow 5300/udp >/dev/null 2>&1 || true

for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

HEALTH_JSON="$(curl -fsS http://127.0.0.1:3000/api/health || echo '{"status":"error"}')"
ok "Healthcheck Panel API : ${HEALTH_JSON}"

echo "=============================================================================="
echo " JUST TECH SERVICES — DÉPLOIEMENT VPS TERMINÉ AVEC SUCCÈS"
echo "------------------------------------------------------------------------------"
echo " Portail Client     : ${PUBLIC_SCHEME}://${PANEL_HOST}"
echo " Console SuperAdmin : ${PUBLIC_SCHEME}://${PANEL_HOST}/admin"
echo " Super Admin Email  : ${SUPERADMIN_EMAIL}"
echo " API Cloud Resolve  : ${PUBLIC_SCHEME}://${PANEL_HOST}/api/v1/cloud/resolve/{cloud_code}"
echo " Ports VPN actifs   : SSH(:22, :2222) | WSS(:443/ws) | WS(:80/ws, :8080) | TLS(:8443) | UDPGW(:7300) | SlowDNS(:5300/udp)"
if [[ -f /etc/jts/slowdns/server.pub ]]; then
  echo " Clé Publique dnstt : $(cat /etc/jts/slowdns/server.pub)"
fi
echo "=============================================================================="
