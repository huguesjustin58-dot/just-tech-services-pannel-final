#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Pare-feu UFW, Chaînes iptables JTS_QUOTA & Fail2ban
# ==============================================================================
set -euo pipefail

SSH_PORT="${JTS_SSH_PORT:-22}"
SLOWDNS_UDP_PORT="${JTS_SLOWDNS_PORT:-5300}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[1/4] Configuration du pare-feu UFW..."
if command -v ufw >/dev/null 2>&1; then
    ufw --force reset >/dev/null
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow "${SSH_PORT}/tcp" comment 'SSH Management & Tunnels'
    ufw allow 80/tcp comment 'HTTP Redirect / ACME'
    ufw allow 443/tcp comment 'HTTPS Panel & SSH-WSS'
    ufw allow 53/udp comment 'SlowDNS Public UDP'
    ufw --force enable
fi

echo "[2/4] Création de la chaîne iptables JTS_QUOTA (comptage bande passante par UID)..."
if ! iptables -L JTS_QUOTA -n >/dev/null 2>&1; then
    iptables -N JTS_QUOTA
fi
if ! iptables -C OUTPUT -j JTS_QUOTA >/dev/null 2>&1; then
    iptables -I OUTPUT 1 -j JTS_QUOTA
fi

echo "[3/4] Redirection NAT UDP 53 -> ${SLOWDNS_UDP_PORT} (SlowDNS non-root)..."
if ! iptables -t nat -C PREROUTING -p udp --dport 53 -j REDIRECT --to-ports "${SLOWDNS_UDP_PORT}" >/dev/null 2>&1; then
    iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-ports "${SLOWDNS_UDP_PORT}"
fi

# Persistance des règles iptables après redémarrage
if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null
fi

echo "[4/4] Activation Fail2ban..."
if [[ -f "${REPO_ROOT}/infra/fail2ban-jts.local" ]]; then
    install -m 0644 "${REPO_ROOT}/infra/fail2ban-jts.local" /etc/fail2ban/jail.d/jts.local
fi
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "[OK] Pare-feu, NAT SlowDNS, JTS_QUOTA et Fail2ban configurés."
