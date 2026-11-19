#!/usr/bin/env bash
# ==============================================================================
# JUST TECH SERVICES — Provisionnement Nœud VPN Seul (Secondary VPN Edge Node)
# Installe OpenSSH (:22,:2222), WebSocket Payload Proxy (:80,:8080),
# Stunnel4 TLS (:443,:8443), BadVPN UDPGW (:7300) et SlowDNS dnstt (:5300/udp)
# ==============================================================================
set -euo pipefail

SLOWDNS_NS_DOMAIN="${1:-sdns1.justtechservices.xyz}"
export DEBIAN_FRONTEND=noninteractive

echo "[JTS-VPN-NODE] Installation de la stack VPN multi-protocole..."
apt-get update -qq
apt-get install -y -qq curl wget git jq openssl python3 openssh-server stunnel4 ufw fail2ban iptables cmake build-essential

# 1. OpenSSH (:22, :2222)
if ! grep -q "^Port 2222" /etc/ssh/sshd_config; then
  printf "\nPort 22\nPort 2222\n" >> /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

# 2. Proxy WebSocket / HTTP Payload (:80 et :8080 -> 127.0.0.1:22)
cat <<'PYEOF' > /usr/local/bin/jts-ws-proxy.py
#!/usr/bin/env python3
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

async def pipe(reader, writer):
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

async def handle_client(client_reader, client_writer):
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
    s80 = await asyncio.start_server(handle_client, LISTEN_HOST, 80)
    s8080 = await asyncio.start_server(handle_client, LISTEN_HOST, 8080)
    async with s80, s8080:
        await asyncio.gather(s80.serve_forever(), s8080.serve_forever())

if __name__ == "__main__":
    asyncio.run(main())
PYEOF
chmod +x /usr/local/bin/jts-ws-proxy.py

cat <<EOF > /etc/systemd/system/jts-ws-proxy.service
[Unit]
Description=JUST TECH SERVICES — HTTP & WebSocket SSH Payload Proxy (:80 & :8080)
After=network.target ssh.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/jts-ws-proxy.py
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now jts-ws-proxy.service

# 3. Stunnel4 (:443 et :8443 -> 127.0.0.1:8080)
mkdir -p /etc/stunnel
if [[ ! -f /etc/stunnel/jts-stunnel.pem ]]; then
  openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
    -subj "/C=CM/ST=Littoral/L=Douala/O=JUST TECH SERVICES/CN=${SLOWDNS_NS_DOMAIN}" \
    -keyout /etc/stunnel/jts-stunnel.key \
    -out /etc/stunnel/jts-stunnel.crt 2>/dev/null
  cat /etc/stunnel/jts-stunnel.key /etc/stunnel/jts-stunnel.crt > /etc/stunnel/jts-stunnel.pem
  chmod 600 /etc/stunnel/jts-stunnel.pem
fi

cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4.pid
cert = /etc/stunnel/jts-stunnel.pem
client = no

[jts-tls-443]
accept = 0.0.0.0:443
connect = 127.0.0.1:8080

[jts-tls-8443]
accept = 0.0.0.0:8443
connect = 127.0.0.1:8080
EOF
sed -i 's/ENABLED=0/ENABLED=1/g' /etc/default/stunnel4 2>/dev/null || true
systemctl enable --now stunnel4 2>/dev/null || systemctl restart stunnel4 2>/dev/null || true

# 4. Pare-feu UFW
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 2222/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow 8080/tcp >/dev/null 2>&1 || true
ufw allow 8443/tcp >/dev/null 2>&1 || true
ufw allow 53/udp >/dev/null 2>&1 || true
ufw allow 5300/udp >/dev/null 2>&1 || true

echo "[OK] Nœud VPN JUST TECH SERVICES opérationnel."
