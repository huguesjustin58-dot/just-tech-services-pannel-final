#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Nginx Reverse Proxy Hôte, WebSocket SSH-WSS & TLS
# Usage: sudo bash setup-nginx-tls.sh panel.justtechservices.xyz api.justtechservices.xyz admin@justtechservices.xyz 0
# ==============================================================================
set -euo pipefail

PANEL_DOMAIN="${1:-panel.justtechservices.xyz}"
API_DOMAIN="${2:-api.justtechservices.xyz}"
ADMIN_EMAIL="${3:-admin@justtechservices.xyz}"
SKIP_TLS="${4:-0}"

NGINX_CONF="/etc/nginx/sites-available/justtech-panel.conf"

cat <<EOF > "$NGINX_CONF"
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN} ${API_DOMAIN};

    client_max_body_size 25M;

    # Endpoint SSH-WSS (WebSocket Tunnel Upgrade)
    location /wss {
        proxy_pass http://127.0.0.1:8880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400s;
    }

    # Application Laravel / Filament / API REST
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/justtech-panel.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [[ "$SKIP_TLS" != "1" ]] && command -v certbot >/dev/null 2>&1; then
    certbot --nginx --non-interactive --agree-tos -m "$ADMIN_EMAIL" \
        -d "$PANEL_DOMAIN" -d "$API_DOMAIN" --redirect || \
        echo "[WARN] Certbot a échoué (vérifiez le DNS Cloudflare). Site actif en HTTP sur port 80."
else
    echo "[INFO] TLS Certbot ignoré (SKIP_TLS=${SKIP_TLS} ou Certbot absent ; TLS géré par Cloudflare Origin)."
fi
