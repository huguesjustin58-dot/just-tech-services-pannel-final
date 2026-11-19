#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Provisionnement SlowDNS (dnstt-server non-root :5300)
# Usage: sudo bash setup-slowdns.sh ns1.justtechservices.xyz
# ==============================================================================
set -euo pipefail

NS_DOMAIN="${1:-ns1.justtechservices.xyz}"
LISTEN_ADDR="127.0.0.1:5300"
KEY_DIR="/etc/jts/slowdns"
DNSTT_BIN="/usr/local/bin/dnstt-server"

echo "[1/4] Création utilisateur système dédié jts-dnstt..."
if ! id -u jts-dnstt >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin jts-dnstt
fi

mkdir -p "$KEY_DIR"
chown jts-dnstt:jts-dnstt "$KEY_DIR"
chmod 750 "$KEY_DIR"

echo "[2/4] Vérification du binaire dnstt-server..."
if [[ ! -x "$DNSTT_BIN" ]]; then
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64) BIN_URL="https://dnstt.network/dnstt-server-linux-amd64" ;;
        aarch64|arm64) BIN_URL="https://dnstt.network/dnstt-server-linux-arm64" ;;
        *) echo "Architecture non supportée pour auto-download : $ARCH"; exit 1 ;;
    esac
    echo "Téléchargement de dnstt-server (${ARCH})..."
    curl -fsSL "$BIN_URL" -o "$DNSTT_BIN" || echo "[WARN] Téléchargement bloqué hors ligne; placez dnstt-server manuellement dans $DNSTT_BIN."
    [[ -f "$DNSTT_BIN" ]] && chmod 0755 "$DNSTT_BIN"
fi

echo "[3/4] Génération de la paire de clés SlowDNS..."
if [[ -x "$DNSTT_BIN" ]] && [[ ! -f "${KEY_DIR}/server.key" ]]; then
    "$DNSTT_BIN" -gen-key -privkey-file "${KEY_DIR}/server.key" -pubkey-file "${KEY_DIR}/server.pub"
    chown jts-dnstt:jts-dnstt "${KEY_DIR}/server.key" "${KEY_DIR}/server.pub"
    chmod 600 "${KEY_DIR}/server.key"
    chmod 644 "${KEY_DIR}/server.pub"
fi

echo "[4/4] Déploiement du service systemd jts-dnstt..."
cat <<EOF > /etc/systemd/system/jts-dnstt.service
[Unit]
Description=JUST TECH SERVICES - SlowDNS (dnstt-server)
After=network.target

[Service]
Type=simple
User=jts-dnstt
Group=jts-dnstt
NoNewPrivileges=true
ProtectSystem=strict
ReadOnlyPaths=/etc/jts/slowdns
ExecStart=${DNSTT_BIN} -udp ${LISTEN_ADDR} -privkey-file ${KEY_DIR}/server.key ${NS_DOMAIN} 127.0.0.1:22
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
if [[ -x "$DNSTT_BIN" ]]; then
    systemctl enable --now jts-dnstt
fi

if [[ -f "${KEY_DIR}/server.pub" ]]; then
    echo "------------------------------------------------------------------"
    echo "SlowDNS prêt pour domaine NS : ${NS_DOMAIN}"
    echo "Clé publique SlowDNS (à saisir dans Filament -> Serveurs) :"
    cat "${KEY_DIR}/server.pub"
    echo "Rappel Cloudflare : enregistrements A et NS en mode DNS Only (proxied=false)."
    echo "------------------------------------------------------------------"
fi
