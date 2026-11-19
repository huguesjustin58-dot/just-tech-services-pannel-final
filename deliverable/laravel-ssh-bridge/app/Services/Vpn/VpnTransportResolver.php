<?php

declare(strict_types=1);

namespace App\Services\Vpn;

use App\Contracts\Vpn\SshVpnBridgeInterface;
use App\Models\License;
use App\Models\Server;

/**
 * Service intermédiaire de routage entre :
 * 1) Le pont SSH sécurisé par clé (serveurs VPS distants ou mode 'ssh_key')
 * 2) L'agent Python local HMAC/Unix-Socket (nœud local ou mode 'agent')
 */
class VpnTransportResolver
{
    public function __construct(
        private readonly SshVpnBridgeInterface $sshBridge,
        private readonly VpnAgentClient $agentClient,
    ) {}

    public function usesSshKeyBridge(Server $server): bool
    {
        $mode = $server->transport_mode ?? config('jts_vpn.default_transport', 'ssh_key');

        return $mode === 'ssh_key';
    }

    public function provisionLicenseAccount(License $license, string $plainPassword): array
    {
        $server = $license->server;
        $plan = $license->plan;
        $quotaBytes = (int) ($license->bandwidth_quota_bytes ?: ($plan->quota_gb * 1024 * 1024 * 1024));
        $maxSessions = (int) ($license->max_concurrent_sessions ?: $plan->max_concurrent_sessions ?: 1);

        if ($this->usesSshKeyBridge($server)) {
            return $this->sshBridge->createUserWithBandwidthQuota(
                server: $server,
                username: $license->vpn_username,
                plainPassword: $plainPassword,
                expiresAt: $license->expires_at,
                quotaBytes: $quotaBytes,
                maxSessions: $maxSessions,
            );
        }

        return $this->agentClient->createUser(
            server: $server,
            username: $license->vpn_username,
            password: $plainPassword,
            expiresAt: $license->expires_at->format('Y-m-d'),
            maxSessions: $maxSessions,
            quotaBytes: $quotaBytes,
        );
    }

    public function syncLicenseLimits(License $license, bool $resetUsage = false): array
    {
        $server = $license->server;
        $quotaBytes = (int) $license->bandwidth_quota_bytes;
        $maxSessions = max(1, (int) $license->max_concurrent_sessions);

        if ($this->usesSshKeyBridge($server)) {
            $quotaResult = $this->sshBridge->updateBandwidthQuota(
                server: $server,
                username: $license->vpn_username,
                quotaBytes: $quotaBytes,
                resetUsage: $resetUsage,
            );
            $sessionResult = $this->sshBridge->configureMaxUserSessions(
                server: $server,
                username: $license->vpn_username,
                maxSessions: $maxSessions,
                enforceImmediately: true,
            );

            return [
                'quota' => $quotaResult,
                'sessions' => $sessionResult,
            ];
        }

        return $this->agentClient->updateLimits(
            server: $server,
            username: $license->vpn_username,
            quotaBytes: $quotaBytes,
            maxSessions: $maxSessions,
        );
    }

    public function suspendLicenseAccount(License $license): bool
    {
        if ($this->usesSshKeyBridge($license->server)) {
            return $this->sshBridge->suspendAccount($license->server, $license->vpn_username);
        }

        return (bool) ($this->agentClient->suspendUser($license->server, $license->vpn_username)['ok'] ?? false);
    }

    public function revokeLicenseAccount(License $license): bool
    {
        if ($this->usesSshKeyBridge($license->server)) {
            return $this->sshBridge->revokeAccount($license->server, $license->vpn_username);
        }

        return (bool) ($this->agentClient->revokeUser($license->server, $license->vpn_username)['ok'] ?? false);
    }
}
