# Runbook d'Exploitation — JUST TECH SERVICES PANEL

## 1. Enrôler un Nouveau Serveur VPN Distant (Pont Clé SSH)

1. Sur le panneau Laravel (ou via CLI), générez une paire de clés Ed25519 dédiée :
   ```bash
   ssh-keygen -t ed25519 -C "jts-panel-bridge" -f storage/app/keys/jts_vpn_ed25519 -N ""
   chmod 600 storage/app/keys/jts_vpn_ed25519
   ```
2. Sur le nouveau VPS Ubuntu VPN, créez l'utilisateur de gestion `jts-provisioner` avec droits sudo restreints aux binaires système VPN :
   ```bash
   useradd -m -s /bin/bash jts-provisioner
   mkdir -p /home/jts-provisioner/.ssh
   # Copiez la clé publique dans authorized_keys
   chmod 700 /home/jts-provisioner/.ssh && chmod 600 /home/jts-provisioner/.ssh/authorized_keys
   ```
3. Déployez le reaper temps réel (`infra/scripts/jts-ssh-quota-reaper.sh`) dans `/usr/local/sbin/jts-ssh-quota-reaper.sh` (timer systemd 10s).
4. Récupérez l'empreinte SHA-256 exacte de la clé hôte pour prévenir tout MITM :
   ```bash
   ssh-keyscan -t ed25519 <IP_SERVEUR> | ssh-keygen -lf -
   ```
5. Renseignez `transport_mode = 'ssh_key'`, `ssh_mgmt_user = 'jts-provisioner'`, et `ssh_host_fingerprint = 'SHA256:...'` dans la fiche Serveur Filament.
6. Testez la synchronisation immédiate :
   ```bash
   docker compose exec app php artisan jts:vpn-sync-accounts --all-users
   ```

---

## 2. Rotation des Secrets Critiques

- **Secret HMAC Agent Local** :
  1. Générez un secret aléatoire 64 caractères (`openssl rand -hex 32`).
  2. Mettez à jour `/etc/jts/agent.env` et `backend/.env` (`JTS_AGENT_HMAC_SECRET`).
  3. Redémarrez `systemctl restart jts-vpn-agent` puis `docker compose restart app horizon`.
- **Clé SSH de Provisionnement** :
  1. Ajoutez la nouvelle clé publique dans `~/.ssh/authorized_keys` de chaque nœud.
  2. Remplacez `ssh_private_key_encrypted` ou `storage/app/keys/jts_vpn_ed25519`.
  3. Supprimez l'ancienne clé publique des nœuds après validation de `jts:vpn-sync-accounts`.

---

## 3. Sauvegarde & Restauration PostgreSQL Chiffrée

### Sauvegarde quotidienne recommandée (cron hôte)
```bash
docker compose exec -T postgres pg_dump -U jts_user -Fc just_tech_panel \
  | gzip > /var/backups/jts/pg_$(date +%Y%m%d_%H%M).dump.gz
```

### Restauration
```bash
gunzip -c /var/backups/jts/pg_YYYYMMDD_HHMM.dump.gz \
  | docker compose exec -T postgres pg_restore -U jts_user -d just_tech_panel --clean --if-exists
```

---

## 4. Dépannage Rapide

| Symptôme | Cause probable | Action corrective |
| :--- | :--- | :--- |
| SlowDNS ne répond pas | Cloudflare proxy activé ou port 53 occupé par `systemd-resolved` | Vérifier `proxied=false` sur Cloudflare et `ss -ulnp \| grep :53` |
| Un client dépasse `maxuser` | Tunnels SSH sans PTY (`-N`) contournant `pam_limits` | Vérifier `systemctl status jts-quota-reaper.timer` et `/var/log/jts-reaper.log` |
| Compteur bande passante figé à 0 | Chaîne `iptables JTS_QUOTA` absente après reboot | Relancer `jts:vpn-sync-accounts` ou `iptables-restore` |
| Erreur SSH `HostKeyMismatch` | Réinstallation du VPS VPN cible | Mettre à jour `ssh_host_fingerprint` après vérification hors-bande |
