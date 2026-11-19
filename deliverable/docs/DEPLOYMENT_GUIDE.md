# Documentation Technique de Déploiement — `JUST_TECH_SERVICES_PANEL_FINAL.zip`

Ce document décrit l'architecture des scripts Bash d'industrialisation, la séquence d'exécution sur VPS Ubuntu 22.04/24.04 LTS, les variables d'environnement supportées, les ports réseau et les procédures de mise à jour / restauration.

---

## 1. Structure des Scripts Bash de Déploiement

```text
JUST_TECH_SERVICES_PANEL/
└── infra/
    ├── deploy-final-package.sh          # Orchestrateur principal (extraction, secrets, Docker, TLS)
    ├── ubuntu-setup.sh                  # Initialisation OS, jts-provisioner, sudoers, DNSStubListener
    ├── fail2ban-jts.local               # Configuration Fail2ban SSH
    ├── sudoers/jts-provisioner          # Droits sudo granulaires sans accès root complet
    ├── systemd/
    │   ├── jts-quota-reaper.service     # Unité oneshot du reaper quotas & maxuser
    │   └── jts-quota-reaper.timer       # Exécution toutes les 10 secondes
    └── scripts/
        ├── setup-firewall-fail2ban.sh   # UFW, chaîne iptables JTS_QUOTA, NAT UDP 53->5300
        ├── setup-slowdns.sh             # Installation dnstt-server non-root + clés SlowDNS
        ├── setup-nginx-tls.sh           # Reverse proxy hôte (HTTPS + WebSocket /wss)
        ├── jts-ssh-quota-reaper.sh      # Comptage UID iptables & fermeture tunnels > maxuser
        ├── backup-restore.sh            # Sauvegarde/Restauration pg_dump + clés + /etc/jts
        └── healthcheck-deploy.sh        # Contrôle complet post-déploiement (Docker + systemd + HTTP)
```

---

## 2. Séquence d'Orchestration & Dépendances

1. **`deploy-final-package.sh`** (point d'entrée unique) :
   - Contrôle l'empreinte SHA-256 (`JUST_TECH_SERVICES_PANEL_FINAL.zip.sha256`).
   - Installe `docker`, `docker compose`, `unzip`, `jq`, `fail2ban`, `nginx`, `netfilter-persistent`.
   - Préserve automatiquement un éventuel `.env` et `storage/app/keys` existants lors d'une mise à niveau.
   - Génère automatiquement les secrets manquants (`DB_PASSWORD`, `REDIS_PASSWORD`, `JTS_AGENT_HMAC_SECRET`, `APP_KEY`) et une clé SSH Ed25519 dédiée (`/opt/justtech-panel/backend/storage/app/keys/jts_vpn_ed25519`).
2. **`ubuntu-setup.sh`** :
   - Crée `/etc/jts/{quotas,maxuser}` et `/var/lib/jts/usage`.
   - Provisionne l'utilisateur Linux restreint `jts-provisioner` avec le fichier `/etc/sudoers.d/jts-provisioner` (mode `0440`).
   - Désactive `DNSStubListener` de `systemd-resolved` pour libérer le port UDP `53`.
   - Active le timer `jts-quota-reaper.timer` (10s).
3. **`setup-firewall-fail2ban.sh`** :
   - Active UFW (`22/tcp`, `80/tcp`, `443/tcp`, `53/udp`).
   - Crée la chaîne `iptables JTS_QUOTA` en tête de `OUTPUT` pour mesurer le trafic par `--uid-owner`.
   - Redirige `PREROUTING UDP :53` vers `127.0.0.1:5300` (SlowDNS non-root) et sauvegarde via `netfilter-persistent`.
4. **`setup-slowdns.sh`** :
   - Crée l'utilisateur système `jts-dnstt`, télécharge `dnstt-server`, génère `server.key` / `server.pub`, et lance `jts-dnstt.service`.
5. **Stack Docker (`docker compose up -d --build`)** :
   - Conteneurs `app`, `horizon` et `scheduler` exécutés strictement en **non-root (`1000:1000`)** avec `cap_drop: ALL`.
   - Migrations PostgreSQL, seed des 5 formules FCFA et synchronisation initiale `php artisan jts:vpn-sync-accounts`.
6. **`setup-nginx-tls.sh` & `healthcheck-deploy.sh`** :
   - Configure le proxy hôte vers `:8080` (panel/API) et `:8880` (`/wss`), applique TLS (Certbot ou Cloudflare Origin), puis valide l'état de chaque service.

---

## 3. Variables d'Environnement de Déploiement

| Variable | Valeur par défaut | Description |
| :--- | :--- | :--- |
| `JTS_INSTALL_DIR` | `/opt/justtech-panel` | Répertoire cible d'installation sur le VPS |
| `JTS_PANEL_DOMAIN` | `panel.justtechservices.xyz` | Nom de domaine principal du panneau |
| `JTS_API_DOMAIN` | `api.justtechservices.xyz` | Nom de domaine de l'API REST |
| `JTS_SLOWDNS_NS_DOMAIN` | `ns1.justtechservices.xyz` | Enregistrement `NS` dédié au tunnel SlowDNS |
| `JTS_ADMIN_EMAIL` | `admin@justtechservices.xyz` | Email utilisé pour Certbot ACME |
| `JTS_SKIP_TLS` | `0` | Mettre `1` si TLS est terminé exclusivement par Cloudflare Origin |
| `JTS_SSH_PORT` | `22` | Port SSH autorisé dans UFW |

---

## 4. Matrice des Ports & Services Systemd

| Service | Port / Socket | Utilisateur | Rôle |
| :--- | :--- | :--- | :--- |
| `nginx` (hôte) | `80/tcp`, `443/tcp` | `www-data` | TLS, Proxy Laravel (`127.0.0.1:8080`), Upgrade `/wss` (`:8880`) |
| `sshd` | `22/tcp` | `root` | Tunnels SSH clients + Pont gestion `jts-provisioner` |
| `jts-dnstt.service` | `53/udp` -> `127.0.0.1:5300` | `jts-dnstt` | Serveur SlowDNS non-root |
| `jts-quota-reaper.timer` | Timer 10s | `root` | Comptage `iptables JTS_QUOTA` & contrôle `maxuser` |
| `postgres` / `redis` | Réseau interne `jts_internal` | Docker | Base PostgreSQL 16 & files Redis 7 |

---

## 5. Procédure de Déploiement sur un Nouveau VPS Ubuntu

```bash
# 1. Transférer l'archive et son checksum sur le VPS
scp JUST_TECH_SERVICES_PANEL_FINAL.zip* root@IP_VPS:/root/

# 2. Extraire le script principal et lancer l'installation complète
unzip -j /root/JUST_TECH_SERVICES_PANEL_FINAL.zip "JUST_TECH_SERVICES_PANEL/infra/deploy-final-package.sh" -d /root/
JTS_PANEL_DOMAIN="panel.justtechservices.xyz" \
JTS_SLOWDNS_NS_DOMAIN="ns1.justtechservices.xyz" \
sudo -E bash /root/deploy-final-package.sh /root/JUST_TECH_SERVICES_PANEL_FINAL.zip
```

---

## 6. Sauvegarde, Mise à Jour & Rollback

- **Sauvegarde quotidienne (cron)** :
  ```bash
  0 3 * * * /opt/justtech-panel/infra/scripts/backup-restore.sh >> /var/log/jts-backup.log 2>&1
  ```
- **Restauration complète après incident** :
  ```bash
  sudo bash /opt/justtech-panel/infra/scripts/backup-restore.sh --restore /var/backups/jts/jts_backup_YYYYMMDD_HHMMSS.tar.gz
  ```
- **Contrôle de santé manuel** :
  ```bash
  sudo bash /opt/justtech-panel/infra/scripts/healthcheck-deploy.sh
  ```
