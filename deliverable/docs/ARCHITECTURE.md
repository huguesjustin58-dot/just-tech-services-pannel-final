# Architecture Technique — JUST TECH SERVICES PANEL

## 1. Vue d'Ensemble & Isolation de Sécurité

L'architecture sépare strictement deux plans d'exécution afin qu'aucune faille applicative web ne puisse compromettre directement le noyau Linux du VPS :

1. **Plan Web / SaaS (Conteneurs Docker non-root `UID 1000`)** :
   - `nginx` : terminaison HTTP interne, en-têtes CSP/HSTS stricts.
   - `app` (PHP 8.3-FPM) : Laravel 11 + Filament v3 (panels `/admin` et `/reseller`), API REST Sanctum.
   - `horizon` : workers asynchrones Redis pour le provisionnement idempotent, alertes Telegram et exports.
   - `scheduler` : exécution `schedule:run` (expirations, télémétrie serveurs, synchronisation quotas).
   - `postgres` (PostgreSQL 16) : stockage transactionnel ACID, montants en `BIGINT` FCFA, quotas en `BIGINT` octets, index partiels `WHERE status = 'active'`.
   - `redis` (Redis 7) : files Horizon, verrous distribués atomiques et cache.

2. **Plan VPN Engine (Système Linux Hôte)** :
   - Services natifs : `sshd` (tunnels SSH), `stunnel/wss` (SSH-WSS), `jts-dnstt` (SlowDNS UDP 53 -> 5300).
   - Contrôleur de quotas et sessions : `jts-ssh-quota-reaper.sh` (mesure `iptables -L JTS_QUOTA` par UID Linux et contrôle `maxuser` sur les processus `sshd`).
   - Communication depuis Laravel selon `servers.transport_mode` :
     - **`ssh_key`** : via `SshVpnBridgeInterface` / `SshKeyVpnBridgeService` (`phpseclib3` + clé Ed25519 chiffrée en base via `Crypt` + vérification SHA-256 de la clé hôte). Idéal pour piloter 1 ou N VPS distants sans installer d'agent Python exposé sur Internet.
     - **`agent`** : via `VpnAgentClient` sur socket Unix `/run/jts-agent/agent.sock` signé HMAC-SHA256 (`X-JTS-Timestamp` + `X-JTS-Nonce` + `X-JTS-Signature`).

---

## 2. Pipeline d'Idempotence & Provisionnement

```text
[Paiement FCFA / Crédit Revendeur]
       │
       ▼ (DB::transaction + lockForUpdate + idempotency_key)
[Création Licence : status = provisioning]
       │
       ▼ (Dispatch Horizon Job : ProvisionVpnAccountJob)
[ServerLoadBalancer::selectOptimalServer()]
       │
       ▼ (VpnTransportResolver)
   ┌───┴────────────────────────┐
   │ mode = ssh_key             │ mode = agent
   ▼                            ▼
[SshKeyVpnBridgeService]   [VpnAgentClient HMAC]
   │                            │
   └────────────┬───────────────┘
                ▼
 [useradd + chpasswd + chage + iptables UID + maxlogins]
                │
       ┌────────┴────────┐
   (Succès)          (Échec réseau/SSH)
       │                 │
       ▼                 ▼
 [status = active]  [Retry backoff sans double débit crédits]
 [Notif Telegram]   [Journal erreur audit_logs]
```

---

## 3. Cloisonnement Multi-Revendeurs (RBAC 5 Niveaux)

- **Global Scope** `ResellerIsolationScope` appliqué sur `User` (clients), `License`, `Payment` et `ResellerCreditLedger` :
  - Un `Revendeur` ne voit que ses clients (`reseller_id = auth()->id()`) et ceux de ses `Sous-revendeurs` (`parent_reseller_id = auth()->id()`).
  - Un `Sous-revendeur` est strictement restreint à ses propres enregistrements.
- **Immuabilité Financière** :
  - `ResellerCreditLedger` et `AuditLog` refusent toute mise à jour (`updating`) ou suppression (`deleting`) au niveau Eloquent. Toute correction passe par une écriture compensatrice.

---

## 4. Architecture SlowDNS (UDP 53 Non-Root)

Sur Ubuntu 22.04/24.04, `systemd-resolved` écoute par défaut sur `127.0.0.53:53`.
Le script `infra/ubuntu-setup.sh` :
1. Désactive `DNSStubListener=no` dans `/etc/systemd/resolved.conf`.
2. Lance `dnstt-server` sous un utilisateur dédié non-privilégié (`jts-dnstt`) sur `127.0.0.1:5300`.
3. Redirige le trafic entrant UDP port `53` vers `5300` via `iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5300`.
4. Impose `proxied = false` (DNS Only) sur Cloudflare pour les enregistrements `A` (nameserver) et `NS` (sous-domaine tunnel).
