<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Contracts\Vpn\SshVpnBridgeInterface;
use App\Enums\LicenseStatus;
use App\Models\License;
use App\Models\Server;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class SyncLinuxAccountsCommand extends Command
{
    protected $signature = 'jts:vpn-sync-accounts {--server= : ID du serveur spécifique} {--all-users : Inclure les comptes non préfixés jts_}';

    protected $description = 'Synchronise via clé SSH les comptes Linux existants, la consommation bande passante et les sessions actives.';

    public function handle(SshVpnBridgeInterface $sshBridge): int
    {
        $query = Server::query()->where('is_active', true);
        if ($serverId = $this->option('server')) {
            $query->whereKey((int) $serverId);
        }

        $servers = $query->get();
        if ($servers->isEmpty()) {
            $this->warn('Aucun serveur actif à synchroniser.');

            return self::SUCCESS;
        }

        $onlyManaged = ! (bool) $this->option('all-users');

        foreach ($servers as $server) {
            if (($server->transport_mode ?? 'ssh_key') !== 'ssh_key') {
                continue;
            }

            try {
                $accounts = $sshBridge->listSystemAccounts($server, $onlyManaged);
                $totalSessions = 0;

                DB::transaction(function () use ($server, $accounts, &$totalSessions): void {
                    foreach ($accounts as $account) {
                        $totalSessions += $account->activeSessions;

                        $license = License::query()
                            ->where('server_id', $server->id)
                            ->where('vpn_username', $account->username)
                            ->first();

                        if (! $license) {
                            continue;
                        }

                        $newStatus = $license->status;
                        if ($account->isQuotaExhausted() && $license->status === LicenseStatus::ACTIVE) {
                            $newStatus = LicenseStatus::QUOTA_EXHAUSTED;
                        }

                        $license->update([
                            'bandwidth_used_bytes' => max($license->bandwidth_used_bytes, $account->bandwidthUsedBytes),
                            'status' => $newStatus,
                        ]);
                    }

                    $server->update([
                        'active_connections' => $totalSessions,
                        'last_heartbeat_at' => now(),
                    ]);
                });

                $this->info(sprintf(
                    '[%s] %d comptes Linux synchronisés (%d sessions actives).',
                    $server->name,
                    count($accounts),
                    $totalSessions,
                ));
            } catch (Throwable $e) {
                $this->error("[{$server->name}] Erreur SSH : {$e->getMessage()}");
            }
        }

        return self::SUCCESS;
    }
}
