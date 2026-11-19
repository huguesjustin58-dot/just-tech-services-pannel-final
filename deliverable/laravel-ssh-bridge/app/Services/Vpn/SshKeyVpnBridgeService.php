<?php

declare(strict_types=1);

namespace App\Services\Vpn;

use App\Contracts\Vpn\SshVpnBridgeInterface;
use App\DTOs\Vpn\LinuxSystemAccountData;
use App\Exceptions\VpnSshException;
use App\Models\Server;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Net\SSH2;
use Throwable;

class SshKeyVpnBridgeService implements SshVpnBridgeInterface
{
    private const USERNAME_PATTERN = '/^[a-z_][a-z0-9_-]{2,31}$/';

    /**
     * Liste les comptes système Linux existants en consolidant :
     * - /etc/passwd (UID >= min_uid, hors nobody/nfsnobody)
     * - statut de verrouillage shadow ('!' ou '*')
     * - date d'expiration (chage -l)
     * - quota configuré (/etc/jts/quotas/<user>.conf) + consommation (usage + iptables)
     * - limite maxuser (/etc/jts/maxuser/<user> ou limits.d) + sessions sshd actives
     */
    public function listSystemAccounts(Server $server, bool $onlyJtsManaged = true): array
    {
        $ssh = $this->connect($server);

        $prefix = (string) config('jts_vpn.ssh.managed_prefix', 'jts_');
        $minUid = (int) config('jts_vpn.ssh.min_uid', 1000);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');
        $quotasDir = (string) config('jts_vpn.paths.quotas_dir', '/etc/jts/quotas');
        $maxUserDir = (string) config('jts_vpn.paths.maxuser_dir', '/etc/jts/maxuser');
        $usageDir = (string) config('jts_vpn.paths.usage_dir', '/var/lib/jts/usage');

        // Script atomique exécuté en une seule passe SSH pour éviter N+1 round-trips
        $remoteScript = <<<BASH
set -euo pipefail
MIN_UID={$minUid}
ONLY_MANAGED={$this->boolToFlag($onlyJtsManaged)}
PREFIX={$this->esc($prefix)}

# Active sshd tunnel/shell sessions per username
declare -A SESS_COUNT
while read -r cnt usr; do
    [ -n "\${usr:-}" ] && SESS_COUNT["\$usr"]="\$cnt"
done < <(ps -eo user=,comm= | awk '\$2 == "sshd" && \$1 != "root" && \$1 != "sshd" {c[\$1]++} END {for (u in c) print c[u], u}')

# Live iptables counters per UID (JTS_QUOTA chain)
declare -A IPT_BYTES
if {$sudo} iptables -L JTS_QUOTA -vxn >/dev/null 2>&1; then
    while read -r uid_val bytes_val; do
        [ -n "\${uid_val:-}" ] && IPT_BYTES["\$uid_val"]="\$bytes_val"
    done < <({$sudo} iptables -L JTS_QUOTA -vxn 2>/dev/null | awk '/owner UID match/ {
        bytes=\$2;
        for (i=1; i<=NF; i++) {
            if (\$i == "match" && (i+1)<=NF) { uid=$(i+1); gsub(/[^0-9]/, "", uid); if (uid != "") print uid, bytes }
        }
    }')
fi

while IFS=: read -r uname _ uid gid _ home shell; do
    [ "\$uid" -ge "\$MIN_UID" ] || continue
    [ "\$uname" != "nobody" ] && [ "\$uname" != "nfsnobody" ] || continue
    if [ "\$ONLY_MANAGED" = "1" ] && [[ "\$uname" != "\$PREFIX"* ]]; then
        continue
    fi

    # Shadow lock state
    shadow_line=\$({$sudo} getent shadow "\$uname" 2>/dev/null || echo "")
    pass_hash=\$(echo "\$shadow_line" | cut -d: -f2)
    locked="0"
    if [[ "\$pass_hash" == "!"* ]] || [[ "\$pass_hash" == "*"* ]]; then
        locked="1"
    fi

    # Expiration via chage
    exp_raw=\$({$sudo} chage -l "\$uname" 2>/dev/null | awk -F': ' '/Account expires/ {print \$2}' || echo "never")
    exp_iso=""
    if [ -n "\$exp_raw" ] && [ "\$exp_raw" != "never" ]; then
        exp_iso=\$(date -d "\$exp_raw" -u +"%Y-%m-%dT23:59:59Z" 2>/dev/null || echo "")
    fi

    # Quota config
    quota_bytes="0"
    if [ -f "{$quotasDir}/\${uname}.conf" ]; then
        quota_bytes=\$(awk -F= '/^QUOTA_BYTES=/ {print \$2}' "{$quotasDir}/\${uname}.conf" 2>/dev/null | tr -dc '0-9')
        quota_bytes=\${quota_bytes:-0}
    fi

    # Persisted usage + live iptables delta
    stored_usage="0"
    if [ -f "{$usageDir}/\${uname}.bytes" ]; then
        stored_usage=\$(cat "{$usageDir}/\${uname}.bytes" 2>/dev/null | tr -dc '0-9')
        stored_usage=\${stored_usage:-0}
    fi
    live_usage="\${IPT_BYTES[\$uid]:-0}"
    total_usage=\$((stored_usage + live_usage))

    # Max concurrent sessions (maxuser)
    max_sess="1"
    if [ -f "{$maxUserDir}/\${uname}" ]; then
        max_sess=\$(cat "{$maxUserDir}/\${uname}" 2>/dev/null | tr -dc '0-9')
        max_sess=\${max_sess:-1}
    fi

    active_sess="\${SESS_COUNT[\$uname]:-0}"
    is_jts="0"
    [[ "\$uname" == "\$PREFIX"* ]] && is_jts="1"

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "\$uname" "\$uid" "\$gid" "\$home" "\$shell" "\$locked" "\$exp_iso" "\$quota_bytes" "\$total_usage" "\$max_sess" "\$active_sess" "\$is_jts"
done < /etc/passwd
BASH;

        $output = $this->runScript($ssh, $server, $remoteScript);

        $accounts = [];
        foreach (explode("\n", trim($output)) as $line) {
            if ($line === '') {
                continue;
            }
            $parts = explode("\t", $line);
            if (count($parts) < 12) {
                continue;
            }

            $expiresAt = null;
            if ($parts[6] !== '') {
                try {
                    $expiresAt = CarbonImmutable::parse($parts[6]);
                } catch (Throwable) {
                    $expiresAt = null;
                }
            }

            $accounts[] = new LinuxSystemAccountData(
                username: $parts[0],
                uid: (int) $parts[1],
                gid: (int) $parts[2],
                homeDirectory: $parts[3],
                shell: $parts[4],
                isLocked: $parts[5] === '1',
                expiresAt: $expiresAt,
                bandwidthQuotaBytes: (int) $parts[7],
                bandwidthUsedBytes: (int) $parts[8],
                maxSessions: max(1, (int) $parts[9]),
                activeSessions: max(0, (int) $parts[10]),
                isJtsManaged: $parts[11] === '1',
            );
        }

        return $accounts;
    }

    public function getSystemAccount(Server $server, string $username): ?LinuxSystemAccountData
    {
        $this->assertValidUsername($username);
        $accounts = $this->listSystemAccounts($server, onlyJtsManaged: false);

        foreach ($accounts as $account) {
            if ($account->username === $username) {
                return $account;
            }
        }

        return null;
    }

    /**
     * Crée ou met à jour de façon idempotente un compte Linux, son quota de bande passante
     * (iptables UID owner + /etc/jts/quotas) et sa limite de sessions simultanées (maxuser).
     */
    public function createUserWithBandwidthQuota(
        Server $server,
        string $username,
        string $plainPassword,
        DateTimeInterface $expiresAt,
        int $quotaBytes,
        int $maxSessions = 1,
        ?int $bandwidthRateKbps = null,
    ): array {
        $this->assertValidUsername($username);
        if ($quotaBytes < 0) {
            throw new VpnSshException('Le quota de bande passante ne peut pas être négatif.', $server->public_ip);
        }
        $maxSessions = max(1, min(50, $maxSessions));

        $ssh = $this->connect($server);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');
        $shell = (string) config('jts_vpn.ssh.default_shell', '/usr/sbin/nologin');
        $quotasDir = (string) config('jts_vpn.paths.quotas_dir', '/etc/jts/quotas');
        $maxUserDir = (string) config('jts_vpn.paths.maxuser_dir', '/etc/jts/maxuser');
        $usageDir = (string) config('jts_vpn.paths.usage_dir', '/var/lib/jts/usage');
        $limitsDir = (string) config('jts_vpn.paths.limits_dir', '/etc/security/limits.d');

        $expiryDate = CarbonImmutable::instance($expiresAt)->utc()->format('Y-m-d');
        $chpasswdB64 = base64_encode("{$username}:{$plainPassword}\n");
        $rateKbps = $bandwidthRateKbps !== null ? max(64, $bandwidthRateKbps) : 0;

        $remoteScript = <<<BASH
set -euo pipefail
USER_NAME={$this->esc($username)}
EXPIRY_DATE={$this->esc($expiryDate)}
QUOTA_BYTES={$quotaBytes}
MAX_USER={$maxSessions}
RATE_KBPS={$rateKbps}
PASS_B64={$this->esc($chpasswdB64)}

{$sudo} mkdir -p {$this->esc($quotasDir)} {$this->esc($maxUserDir)} {$this->esc($usageDir)} {$this->esc($limitsDir)}

CREATED=0
if ! id -u "\$USER_NAME" >/dev/null 2>&1; then
    {$sudo} useradd -M -N -s {$this->esc($shell)} -e "\$EXPIRY_DATE" "\$USER_NAME"
    CREATED=1
else
    {$sudo} usermod -e "\$EXPIRY_DATE" -U "\$USER_NAME" >/dev/null 2>&1 || true
fi

USER_UID=\$(id -u "\$USER_NAME")

# Mise à jour sécurisée du mot de passe via stdin (invisible dans ps aux)
printf '%s' "\$PASS_B64" | base64 -d | {$sudo} chpasswd
{$sudo} chage -E "\$EXPIRY_DATE" "\$USER_NAME"

# Initialisation du compteur d'usage si absent
if [ ! -f "{$usageDir}/\${USER_NAME}.bytes" ]; then
    echo "0" | {$sudo} tee "{$usageDir}/\${USER_NAME}.bytes" >/dev/null
fi

# Configuration du quota de bande passante
cat <<EOF | {$sudo} tee "{$quotasDir}/\${USER_NAME}.conf" >/dev/null
USERNAME=\$USER_NAME
UID=\$USER_UID
QUOTA_BYTES=\$QUOTA_BYTES
RATE_KBPS=\$RATE_KBPS
UPDATED_AT=\$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

# Chaîne iptables JTS_QUOTA pour mesurer le trafic sortant réel par UID Linux
if ! {$sudo} iptables -L JTS_QUOTA -n >/dev/null 2>&1; then
    {$sudo} iptables -N JTS_QUOTA
    {$sudo} iptables -I OUTPUT 1 -j JTS_QUOTA
fi
if ! {$sudo} iptables -C JTS_QUOTA -m owner --uid-owner "\$USER_UID" -m comment --comment "jts:\$USER_NAME" -j RETURN >/dev/null 2>&1; then
    {$sudo} iptables -A JTS_QUOTA -m owner --uid-owner "\$USER_UID" -m comment --comment "jts:\$USER_NAME" -j RETURN
fi

# Configuration de la limite de sessions simultanées (maxuser)
echo "\$MAX_USER" | {$sudo} tee "{$maxUserDir}/\${USER_NAME}" >/dev/null
printf "%s hard maxlogins %d\n" "\$USER_NAME" "\$MAX_USER" | {$sudo} tee "{$limitsDir}/90-jts-\${USER_NAME}.conf" >/dev/null
{$sudo} chmod 0644 "{$limitsDir}/90-jts-\${USER_NAME}.conf"

printf 'OK\t%s\t%s\t%s\n' "\$USER_UID" "\$CREATED" "\$EXPIRY_DATE"
BASH;

        $output = trim($this->runScript($ssh, $server, $remoteScript));
        $parts = explode("\t", $output);

        if (count($parts) < 4 || $parts[0] !== 'OK') {
            throw new VpnSshException(
                "Réponse inattendue lors de la création de {$username} : {$output}",
                $server->public_ip,
            );
        }

        Log::info('Compte Linux VPN provisionné via clé SSH', [
            'server_id' => $server->id,
            'server_ip' => $server->public_ip,
            'username' => $username,
            'uid' => (int) $parts[1],
            'quota_bytes' => $quotaBytes,
            'max_sessions' => $maxSessions,
            'created' => $parts[2] === '1',
        ]);

        return [
            'status' => 'provisioned',
            'username' => $username,
            'uid' => (int) $parts[1],
            'quota_bytes' => $quotaBytes,
            'max_sessions' => $maxSessions,
            'expires_at' => $parts[3],
            'created' => $parts[2] === '1',
        ];
    }

    public function updateBandwidthQuota(
        Server $server,
        string $username,
        int $quotaBytes,
        bool $resetUsage = false,
        ?int $bandwidthRateKbps = null,
    ): array {
        $this->assertValidUsername($username);
        if ($quotaBytes < 0) {
            throw new VpnSshException('Le quota de bande passante doit être >= 0.', $server->public_ip);
        }

        $ssh = $this->connect($server);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');
        $quotasDir = (string) config('jts_vpn.paths.quotas_dir', '/etc/jts/quotas');
        $usageDir = (string) config('jts_vpn.paths.usage_dir', '/var/lib/jts/usage');
        $rateKbps = $bandwidthRateKbps !== null ? max(64, $bandwidthRateKbps) : 0;
        $resetFlag = $this->boolToFlag($resetUsage);

        $remoteScript = <<<BASH
set -euo pipefail
USER_NAME={$this->esc($username)}
QUOTA_BYTES={$quotaBytes}
RATE_KBPS={$rateKbps}
RESET_USAGE={$resetFlag}

USER_UID=\$(id -u "\$USER_NAME")
{$sudo} mkdir -p {$this->esc($quotasDir)} {$this->esc($usageDir)}

if [ "\$RESET_USAGE" = "1" ]; then
    echo "0" | {$sudo} tee "{$usageDir}/\${USER_NAME}.bytes" >/dev/null
    {$sudo} iptables -Z JTS_QUOTA >/dev/null 2>&1 || true
fi

cat <<EOF | {$sudo} tee "{$quotasDir}/\${USER_NAME}.conf" >/dev/null
USERNAME=\$USER_NAME
UID=\$USER_UID
QUOTA_BYTES=\$QUOTA_BYTES
RATE_KBPS=\$RATE_KBPS
UPDATED_AT=\$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

USED_BYTES=\$(cat "{$usageDir}/\${USER_NAME}.bytes" 2>/dev/null | tr -dc '0-9')
USED_BYTES=\${USED_BYTES:-0}

UNLOCKED=0
if [ "\$QUOTA_BYTES" -eq 0 ] || [ "\$USED_BYTES" -lt "\$QUOTA_BYTES" ]; then
    {$sudo} usermod -U "\$USER_NAME" >/dev/null 2>&1 || true
    UNLOCKED=1
fi

printf 'OK\t%s\t%s\t%s\n' "\$USER_UID" "\$USED_BYTES" "\$UNLOCKED"
BASH;

        $parts = explode("\t", trim($this->runScript($ssh, $server, $remoteScript)));

        return [
            'username' => $username,
            'uid' => (int) ($parts[1] ?? 0),
            'quota_bytes' => $quotaBytes,
            'used_bytes' => (int) ($parts[2] ?? 0),
            'unlocked' => ($parts[3] ?? '0') === '1',
        ];
    }

    /**
     * Configure maxuser dans PAM (/etc/security/limits.d/90-jts-<user>.conf) ET
     * dans /etc/jts/maxuser/<user> pour les tunnels ssh -N sans PTY.
     * Coupe optionnellement les sessions excédentaires les plus anciennes.
     */
    public function configureMaxUserSessions(
        Server $server,
        string $username,
        int $maxSessions,
        bool $enforceImmediately = true,
    ): array {
        $this->assertValidUsername($username);
        $maxSessions = max(1, min(50, $maxSessions));

        $ssh = $this->connect($server);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');
        $maxUserDir = (string) config('jts_vpn.paths.maxuser_dir', '/etc/jts/maxuser');
        $limitsDir = (string) config('jts_vpn.paths.limits_dir', '/etc/security/limits.d');
        $enforceFlag = $this->boolToFlag($enforceImmediately);

        $remoteScript = <<<BASH
set -euo pipefail
USER_NAME={$this->esc($username)}
MAX_USER={$maxSessions}
ENFORCE={$enforceFlag}

id -u "\$USER_NAME" >/dev/null 2>&1
{$sudo} mkdir -p {$this->esc($maxUserDir)} {$this->esc($limitsDir)}

echo "\$MAX_USER" | {$sudo} tee "{$maxUserDir}/\${USER_NAME}" >/dev/null
printf "%s hard maxlogins %d\n" "\$USER_NAME" "\$MAX_USER" | {$sudo} tee "{$limitsDir}/90-jts-\${USER_NAME}.conf" >/dev/null
{$sudo} chmod 0644 "{$limitsDir}/90-jts-\${USER_NAME}.conf"

mapfile -t PIDS < <(pgrep -u "\$USER_NAME" -x sshd --oldest 2>/dev/null || pgrep -u "\$USER_NAME" -x sshd 2>/dev/null || true)
ACTIVE_COUNT=\${#PIDS[@]}
KILLED_CSV=""

if [ "\$ENFORCE" = "1" ] && [ "\$ACTIVE_COUNT" -gt "\$MAX_USER" ]; then
    EXCESS=\$((ACTIVE_COUNT - MAX_USER))
    for ((i=0; i<EXCESS; i++)); do
        PID_TO_KILL="\${PIDS[\$i]}"
        if [ -n "\$PID_TO_KILL" ]; then
            {$sudo} kill -TERM "\$PID_TO_KILL" >/dev/null 2>&1 || true
            KILLED_CSV="\${KILLED_CSV}\${KILLED_CSV:+,}\${PID_TO_KILL}"
        fi
    done
    ACTIVE_COUNT="\$MAX_USER"
fi

printf 'OK\t%s\t%s\n' "\$ACTIVE_COUNT" "\$KILLED_CSV"
BASH;

        $parts = explode("\t", trim($this->runScript($ssh, $server, $remoteScript)));
        $killedPids = array_values(array_filter(
            array_map('intval', explode(',', $parts[2] ?? '')),
            static fn (int $pid): bool => $pid > 0,
        ));

        return [
            'username' => $username,
            'max_sessions' => $maxSessions,
            'active_sessions' => (int) ($parts[1] ?? 0),
            'terminated_excess_pids' => $killedPids,
        ];
    }

    public function getActiveSessionsMap(Server $server, ?string $username = null): array
    {
        if ($username !== null) {
            $this->assertValidUsername($username);
        }

        $ssh = $this->connect($server);
        $filterUser = $username !== null ? $this->esc($username) : "''";

        $remoteScript = <<<BASH
set -euo pipefail
TARGET_USER={$filterUser}
ps -eo user=,pid=,comm= | awk -v target="\$TARGET_USER" '
\$3 == "sshd" && \$1 != "root" && \$1 != "sshd" {
    if (target == "" || \$1 == target) {
        print \$1 "\t" \$2
    }
}'
BASH;

        $output = trim($this->runScript($ssh, $server, $remoteScript));
        $map = [];
        foreach (explode("\n", $output) as $line) {
            if ($line === '') {
                continue;
            }
            [$usr, $pid] = explode("\t", $line);
            $map[$usr][] = (int) $pid;
        }

        return $map;
    }

    public function suspendAccount(Server $server, string $username): bool
    {
        $this->assertValidUsername($username);
        $ssh = $this->connect($server);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');

        $remoteScript = <<<BASH
set -euo pipefail
USER_NAME={$this->esc($username)}
if id -u "\$USER_NAME" >/dev/null 2>&1; then
    {$sudo} usermod -L -s /usr/sbin/nologin "\$USER_NAME"
    {$sudo} pkill -TERM -u "\$USER_NAME" >/dev/null 2>&1 || true
fi
echo "OK"
BASH;

        return trim($this->runScript($ssh, $server, $remoteScript)) === 'OK';
    }

    public function unsuspendAccount(Server $server, string $username, ?DateTimeInterface $expiresAt = null): bool
    {
        $this->assertValidUsername($username);
        $ssh = $this->connect($server);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');
        $expiryClause = $expiresAt !== null
            ? $this->esc(CarbonImmutable::instance($expiresAt)->utc()->format('Y-m-d'))
            : "''";

        $remoteScript = <<<BASH
set -euo pipefail
USER_NAME={$this->esc($username)}
EXPIRY_DATE={$expiryClause}
{$sudo} usermod -U "\$USER_NAME"
if [ -n "\$EXPIRY_DATE" ]; then
    {$sudo} chage -E "\$EXPIRY_DATE" "\$USER_NAME"
fi
echo "OK"
BASH;

        return trim($this->runScript($ssh, $server, $remoteScript)) === 'OK';
    }

    public function revokeAccount(Server $server, string $username): bool
    {
        $this->assertValidUsername($username);
        $ssh = $this->connect($server);
        $sudo = (string) config('jts_vpn.ssh.sudo_binary', 'sudo -n');
        $quotasDir = (string) config('jts_vpn.paths.quotas_dir', '/etc/jts/quotas');
        $maxUserDir = (string) config('jts_vpn.paths.maxuser_dir', '/etc/jts/maxuser');
        $usageDir = (string) config('jts_vpn.paths.usage_dir', '/var/lib/jts/usage');
        $limitsDir = (string) config('jts_vpn.paths.limits_dir', '/etc/security/limits.d');

        $remoteScript = <<<BASH
set -euo pipefail
USER_NAME={$this->esc($username)}
if id -u "\$USER_NAME" >/dev/null 2>&1; then
    USER_UID=\$(id -u "\$USER_NAME")
    {$sudo} pkill -KILL -u "\$USER_NAME" >/dev/null 2>&1 || true
    {$sudo} iptables -D JTS_QUOTA -m owner --uid-owner "\$USER_UID" -m comment --comment "jts:\$USER_NAME" -j RETURN >/dev/null 2>&1 || true
    {$sudo} userdel -r "\$USER_NAME" >/dev/null 2>&1 || {$sudo} userdel "\$USER_NAME" >/dev/null 2>&1 || true
fi
{$sudo} rm -f "{$quotasDir}/\${USER_NAME}.conf" "{$maxUserDir}/\${USER_NAME}" "{$usageDir}/\${USER_NAME}.bytes" "{$limitsDir}/90-jts-\${USER_NAME}.conf"
echo "OK"
BASH;

        return trim($this->runScript($ssh, $server, $remoteScript)) === 'OK';
    }

    public function probeServerHealth(Server $server): array
    {
        $start = hrtime(true);
        $ssh = $this->connect($server);
        $latencyMs = (int) round((hrtime(true) - $start) / 1_000_000);

        $remoteScript = <<<'BASH'
set -euo pipefail
CPU=$(top -bn1 | awk '/Cpu\(s\)/ {print 100 - $8}' | head -n1 || echo "0")
RAM=$(free | awk '/Mem:/ {printf "%.1f", ($3/$2)*100}' || echo "0")
TUNNELS=$(ps -eo user=,comm= | awk '$2 == "sshd" && $1 != "root" && $1 != "sshd" {c++} END {print c+0}')
printf '%s\t%s\t%s\n' "$CPU" "$RAM" "$TUNNELS"
BASH;

        $parts = explode("\t", trim($this->runScript($ssh, $server, $remoteScript)));

        return [
            'reachable' => true,
            'latency_ms' => $latencyMs,
            'cpu_percent' => round((float) ($parts[0] ?? 0), 1),
            'ram_percent' => round((float) ($parts[1] ?? 0), 1),
            'active_tunnels' => (int) ($parts[2] ?? 0),
        ];
    }

    /**
     * Établit une connexion SSH2 authentifiée par clé privée (Ed25519 / RSA)
     * avec vérification cryptographique de l'empreinte hôte SHA-256.
     */
    protected function connect(Server $server): SSH2
    {
        $host = (string) $server->public_ip;
        $port = (int) ($server->ssh_mgmt_port ?? config('jts_vpn.ssh.port', 22));
        $username = (string) ($server->ssh_mgmt_user ?? 'jts-provisioner');
        $connectTimeout = (int) config('jts_vpn.ssh.connect_timeout', 10);
        $commandTimeout = (int) config('jts_vpn.ssh.command_timeout', 20);

        $ssh = new SSH2($host, $port, $connectTimeout);
        $ssh->setTimeout($commandTimeout);

        // Vérification de la clé hôte pour bloquer les attaques MITM
        $serverHostKey = $ssh->getServerPublicHostKey();
        if ($serverHostKey !== false && ! empty($server->ssh_host_fingerprint)) {
            $computedFingerprint = $this->computeOpenSshSha256Fingerprint($serverHostKey);
            $expectedFingerprint = trim((string) $server->ssh_host_fingerprint);
            if (! hash_equals($expectedFingerprint, $computedFingerprint)) {
                throw VpnSshException::hostKeyMismatch($host, $expectedFingerprint, $computedFingerprint);
            }
        }

        $privateKeyRaw = $this->resolvePrivateKeyMaterial($server);
        $passphrase = $this->resolvePassphrase($server);

        try {
            $key = PublicKeyLoader::load($privateKeyRaw, $passphrase ?: false);
        } catch (Throwable $e) {
            throw VpnSshException::authenticationFailed($host, 'Clé privée SSH illisible : '.$e->getMessage());
        }

        if (! $ssh->login($username, $key)) {
            throw VpnSshException::authenticationFailed($host, implode(' | ', $ssh->getErrors() ?: ['Clé rejetée']));
        }

        return $ssh;
    }

    protected function runScript(SSH2 $ssh, Server $server, string $bashScript): string
    {
        $encoded = base64_encode($bashScript);
        $command = "printf '%s' {$this->esc($encoded)} | base64 -d | bash -s";

        $stdout = (string) $ssh->exec($command);
        $exitStatus = $ssh->getExitStatus();

        if ($exitStatus !== 0 && $exitStatus !== false) {
            $stderr = trim((string) $ssh->getStdError());
            throw VpnSshException::commandFailed(
                $server->public_ip,
                'bash-remote-script',
                (int) $exitStatus,
                $stderr !== '' ? $stderr : trim($stdout),
            );
        }

        return $stdout;
    }

    protected function resolvePrivateKeyMaterial(Server $server): string
    {
        if (! empty($server->ssh_private_key_encrypted)) {
            return Crypt::decryptString((string) $server->ssh_private_key_encrypted);
        }

        $fallbackPath = (string) config('jts_vpn.ssh.default_private_key_path');
        if ($fallbackPath !== '' && is_readable($fallbackPath)) {
            $contents = file_get_contents($fallbackPath);
            if ($contents !== false) {
                return $contents;
            }
        }

        throw VpnSshException::authenticationFailed(
            (string) $server->public_ip,
            'Aucune clé privée SSH configurée pour ce serveur.',
        );
    }

    protected function resolvePassphrase(Server $server): ?string
    {
        if (! empty($server->ssh_private_key_passphrase_encrypted)) {
            return Crypt::decryptString((string) $server->ssh_private_key_passphrase_encrypted);
        }

        $globalPassphrase = config('jts_vpn.ssh.default_private_key_passphrase');

        return is_string($globalPassphrase) && $globalPassphrase !== '' ? $globalPassphrase : null;
    }

    protected function computeOpenSshSha256Fingerprint(string $opensshPublicKeyLine): string
    {
        $parts = preg_split('/\s+/', trim($opensshPublicKeyLine));
        $blob = isset($parts[1]) ? base64_decode($parts[1], true) : false;
        if ($blob === false) {
            return '';
        }

        return 'SHA256:'.rtrim(base64_encode(hash('sha256', $blob, true)), '=');
    }

    protected function assertValidUsername(string $username): void
    {
        if (preg_match(self::USERNAME_PATTERN, $username) !== 1 || in_array($username, ['root', 'ubuntu', 'admin', 'www-data', 'postgres', 'redis'], true)) {
            throw VpnSshException::invalidUsername($username);
        }
    }

    protected function esc(string $value): string
    {
        return escapeshellarg($value);
    }

    protected function boolToFlag(bool $value): string
    {
        return $value ? '1' : '0';
    }
}
