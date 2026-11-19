# JUST TECH SERVICES PANEL

Plateforme SaaS commerciale de gestion d'abonnements VPN, facturation Mobile Money (FCFA) et orchestration d'infrastructure privée (**SSH**, **SSH SlowDNS**, **SSH-WSS**) pour **JUST TECH SERVICES**.

---

## 1. Caractéristiques Clés

- **Hiérarchie RBAC à 5 Niveaux** :
  1. `Super Administrateur` : contrôle intégral infrastructure, permissions, audit immuable, crédits.
  2. `Administrateur` : opérations quotidiennes, clients, serveurs, configurations, paiements.
  3. `Gestionnaire` : opérations commerciales, création clients, vérification paiements FCFA.
  4. `Revendeur / Sous-revendeur` : espace strictement cloisonné (`ResellerIsolationScope`), portefeuille de crédits, commissions.
  5. `Client` : suivi abonnement, consommation Go, téléchargement JSON **NPV Tunnel** / **NapsternetV**, tickets support.
- **Double Pont Infrastructure VPN** :
  - **Pont Clé SSH Sécurisée** (`SshVpnBridgeInterface` + `SshKeyVpnBridgeService` via `phpseclib3`) : gestion multi-VPS distante par clé Ed25519 + vérification empreinte SHA-256 hôte, listing des comptes Linux, quotas bande passante `iptables` par UID, limites simultanées `maxuser` (`limits.d` + `jts-ssh-quota-reaper.sh`).
  - **Agent Local Isolé** (`vpn-agent` FastAPI) : communication Unix Socket signée HMAC-SHA256 + anti-replay (±30s + nonce).
- **Facturation Mobile Money & FCFA** :
  - Formules préconfigurées : `Découverte` (1 500 FCFA), `Standard` (3 000 FCFA), `Premium` (5 500 FCFA), `VIP` (9 500 FCFA), `VIP Illimité` (18 000 FCFA).
  - Workflow : Déclaration (`MTN Mobile Money`, `Orange Money`, `Manuel`) -> Vérification -> Validation ACID -> Provisionnement idempotent -> Facture PDF/CSV.
- **SlowDNS & Cloudflare Automation** :
  - Gestion automatisée des enregistrements `A` et `NS` (`proxied=false`) + `dnstt-server` sur UDP 53 (NAT vers port 5300 non-root).

---

## 2. Prérequis Système (VPS Ubuntu 22.04 / 24.04 LTS)

- 2 vCPU minimum, 4 Go RAM, 40 Go NVMe.
- Docker Engine 24+ et Docker Compose v2.
- Ports ouverts : `22/tcp` (SSH), `80/tcp` & `443/tcp` (HTTPS/WSS), `53/udp` (SlowDNS).
- Domaine géré via Cloudflare (`panel.justtechservices.xyz`, `api.justtechservices.xyz`, `status.justtechservices.xyz`).

---

## 3. Démarrage Rapide (5 Commandes)

```bash
# 1. Décompresser l'archive finale
unzip JUST_TECH_SERVICES_PANEL_FINAL.zip -d /opt/justtech-panel && cd /opt/justtech-panel

# 2. Préparer l'environnement et générer les secrets
cp backend/.env.example backend/.env
sudo bash infra/ubuntu-setup.sh

# 3. Démarrer la stack Docker non-root (PostgreSQL 16, Redis 7, PHP-FPM, Horizon, Nginx)
docker compose up -d --build

# 4. Exécuter les migrations PostgreSQL et le seeder initial
docker compose exec app php artisan migrate --seed --force

# 5. Vérifier la santé globale & synchroniser les comptes Linux VPN
docker compose exec app php artisan jts:vpn-sync-accounts
```

---

## 4. Structure du Projet

```text
JUST_TECH_SERVICES_PANEL/
├── docker-compose.yml              # Stack Docker stricte non-root (UID 1000)
├── Makefile                        # Raccourcis build, test, migrate, backup
├── docker/
│   ├── php/Dockerfile              # PHP 8.3-FPM + pgsql + redis + gmp + sockets
│   └── nginx/default.conf          # Reverse proxy Nginx interne
├── backend/                        # Application Laravel 11 + Filament v3
│   ├── app/Contracts/Vpn/          # Contrats SshVpnBridgeInterface & ProtocolDriver
│   ├── app/Services/Vpn/           # SshKeyVpnBridgeService, VpnTransportResolver, LoadBalancer
│   ├── app/Services/Billing/       # CreditLedgerService (ACID lockForUpdate)
│   ├── app/Services/Config/        # Générateurs NPV Tunnel & NapsternetV
│   ├── app/Enums/                  # Enums PHP 8.3 (UserRole, LicenseStatus, PaymentMethod...)
│   ├── database/migrations/        # Schéma PostgreSQL indexé pour 1 000+ clients
│   └── tests/Feature/              # Tests isolation revendeur, idempotence, SSH bridge
├── vpn-agent/                      # Microservice Python FastAPI isolé (Unix socket + HMAC)
├── infra/                          # Scripts Ubuntu, SlowDNS dnstt, Fail2ban, Nginx hôte
└── docs/                           # Architecture détaillée & Runbook d'exploitation
```
