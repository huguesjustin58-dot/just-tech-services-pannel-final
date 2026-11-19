# JUST TECH SERVICES PANEL — Production Deployment Guide

Complete, production-ready deployment package for **JUST TECH SERVICES PANEL** (React 19 + TypeScript + Tailwind CSS + Express API + SSH & Cloud Config Builder v1 + 6-Role RBAC + AI Payment Verification Agent).

## Security & Role-Based Access Summary

- **Strict Super Admin–Only JSON Access**:
  - Raw JSON v1 (`Sortie JSON v1`, `Export JSON`, `.json` / `.jts` download & import, NPV Tunnel Prototype JSON editor, `Inspecter JSON`, and raw API JSON inspection via `GET /api/v1/cloud/resolve/:code`, `GET /api/cloud-config/:code/manifest`, `POST /api/npv-prototype`) is **exclusively visible and editable by `super_admin`** so the Super Admin can adapt configurations for every user.
  - **Clients** never see any JSON tab, JSON preview, or `.json` file — they only receive their QR Code, opaque `jts://import?code=...` link, Cloud Code (`JTS-XXXX-XXXX`), revocable `import_token`, or private `.npvt` file.
  - **Admin, Manager, Reseller, and Sub Reseller** roles can provision users within their RBAC scope, publish/revoke Cloud Codes, and share QR Codes without seeing or exporting raw JSON.
- **Zero Secrets in Public URLs / QR Codes**: SSH passwords and private keys are never embedded in share URLs or public QR codes.
- **100% Raw HTTP Payload Preservation**: `\r\n`, spaces, `[host]`, `[crlf]`, `[lf]`, `[port]`, `[protocol]`, `[split]`, and `[ua]` are preserved byte-for-byte with zero `.trim()`.

---

## Quick Deployment (Ubuntu / Debian VPS — Node.js 22+)

### 1. Prerequisites
- Node.js **22.x** or higher (`node -v`)
- npm **10.x** or higher
- (Optional) PM2 (`npm i -g pm2`) & Nginx with Let's Encrypt TLS

### 2. Install & Configure Environment
```bash
unzip JUST_TECH_SERVICES_PANEL_FINAL.zip -d just-tech-services-panel
cd just-tech-services-panel

cp .env.example .env
# Edit .env with your real values:
# - GEMINI_API_KEY
# - APP_URL (e.g., https://panel.justtechservices.xyz)
# - Mobile Money beneficiaries & ceilings
```

### 3. Install Dependencies & Build Frontend
```bash
npm install
npm run build
```

### 4. Start in Production Mode (Port 3000)
```bash
NODE_ENV=production npx tsx server.ts
```
Or with **PM2** (recommended for 24/7 uptime):
```bash
NODE_ENV=production pm2 start "npx tsx server.ts" --name just-tech-panel
pm2 save
pm2 startup
```

### 5. Nginx Reverse Proxy (HTTPS)
Point `panel.justtechservices.xyz` to `http://127.0.0.1:3000`:
```nginx
server {
    listen 80;
    server_name panel.justtechservices.xyz;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable TLS with Certbot:
```bash
sudo certbot --nginx -d panel.justtechservices.xyz
```

---

## Included Infrastructure & Laravel/PostgreSQL Bridge

Inside `deliverable/`, this archive also preserves your infrastructure and Laravel integration kits:
- `deliverable/laravel-cloud-npv/` — Laravel controllers, services & migrations for Cloud Config & NPV
- `deliverable/laravel-ssh-bridge/` — Secure SSH key bridge for VPS provisioning
- `deliverable/deploy-scripts/` — Ubuntu firewall/fail2ban, SlowDNS (`dnstt`), Nginx TLS & backup scripts
- `deliverable/docs/` — Architecture & Operations Runbook
