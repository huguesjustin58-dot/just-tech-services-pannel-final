<?php

declare(strict_types=1);

namespace App\Services\Config;

use App\Enums\LicenseStatus;
use App\Models\CloudActivationCode;
use App\Models\License;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class AndroidCloudConfigService
{
    /**
     * Génère un code Cloud unique (JTS-CLD-XXXX-XXXX) après paiement pour l'application VPN Android.
     * Révoque les anciens codes encore en attente de la même licence.
     */
    public function issueForLicense(License $license): CloudActivationCode
    {
        if (! in_array($license->status, [LicenseStatus::ACTIVE, LicenseStatus::PROVISIONING], true)) {
            throw new RuntimeException('La licence doit être active ou en cours de provisionnement pour générer un Code Cloud.');
        }

        return DB::transaction(function () use ($license): CloudActivationCode {
            CloudActivationCode::query()
                ->where('license_id', $license->id)
                ->where('status', 'ready')
                ->update(['status' => 'revoked']);

            do {
                $code = 'JTS-CLD-'.Str::upper(Str::random(4)).'-'.Str::upper(Str::random(4));
            } while (CloudActivationCode::query()->where('code', $code)->exists());

            return CloudActivationCode::create([
                'code' => $code,
                'license_id' => $license->id,
                'user_id' => $license->user_id,
                'status' => 'ready',
                'expires_at' => $license->expires_at,
            ]);
        });
    }

    /**
     * Endpoint appelé par l'application Android JUST TECH VPN (avec connexion internet)
     * pour télécharger la configuration cloud complète associée au code.
     */
    public function redeemCloudCode(string $code, ?string $deviceName = null, ?string $clientIp = null): array
    {
        $record = CloudActivationCode::query()
            ->with(['license.server', 'license.plan'])
            ->where('code', strtoupper(trim($code)))
            ->first();

        if (! $record || $record->status === 'revoked') {
            throw new RuntimeException('Code Cloud introuvable ou révoqué.');
        }

        if ($record->expires_at->isPast() || $record->license->status !== LicenseStatus::ACTIVE) {
            throw new RuntimeException('Licence expirée ou suspendue.');
        }

        $record->update([
            'status' => 'activated',
            'activated_device' => $deviceName ?? $record->activated_device ?? 'Android VPN App',
            'activated_ip' => $clientIp,
            'activated_at' => $record->activated_at ?? now(),
        ]);

        $license = $record->license;
        $server = $license->server;

        return [
            'status' => 'ok',
            'code' => $record->code,
            'plan' => $license->plan->name,
            'expires_at' => $license->expires_at->toIso8601String(),
            'quota_bytes' => $license->bandwidth_quota_bytes,
            'max_sessions' => $license->max_concurrent_sessions,
            'tunnel' => [
                'protocols' => $license->plan->allowed_protocols,
                'host' => $server->hostname ?: $server->public_ip,
                'ssh_port' => $server->ssh_port,
                'wss_port' => $server->wss_port,
                'slowdns_port' => $server->slowdns_port,
                'slowdns_ns' => $server->slowdns_ns_domain,
                'slowdns_pubkey' => $server->slowdns_public_key,
                'username' => $license->vpn_username,
                'password' => Crypt::decryptString($license->vpn_password_encrypted),
            ],
        ];
    }
}
