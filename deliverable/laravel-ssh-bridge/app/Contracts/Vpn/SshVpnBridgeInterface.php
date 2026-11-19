<?php

declare(strict_types=1);

namespace App\Contracts\Vpn;

use App\DTOs\Vpn\LinuxSystemAccountData;
use App\Models\Server;
use DateTimeInterface;

interface SshVpnBridgeInterface
{
    /**
     * Liste les comptes système Linux existants sur le serveur VPN cible
     * avec leur état (verrouillé/actif), date d'expiration, quota de bande passante,
     * consommation mesurée et nombre de sessions SSH simultanées actives.
     *
     * @return list<LinuxSystemAccountData>
     */
    public function listSystemAccounts(Server $server, bool $onlyJtsManaged = true): array;

    /**
     * Récupère les détails complets d'un compte Linux spécifique, ou null s'il n'existe pas.
     */
    public function getSystemAccount(Server $server, string $username): ?LinuxSystemAccountData;

    /**
     * Crée (ou met à jour de manière idempotente) un compte système Linux dédié au VPN
     * avec expiration, quota de bande passante en octets et limite de sessions simultanées (maxuser).
     *
     * @return array{
     *     status: string,
     *     username: string,
     *     uid: int,
     *     quota_bytes: int,
     *     max_sessions: int,
     *     expires_at: string,
     *     created: bool
     * }
     */
    public function createUserWithBandwidthQuota(
        Server $server,
        string $username,
        string $plainPassword,
        DateTimeInterface $expiresAt,
        int $quotaBytes,
        int $maxSessions = 1,
        ?int $bandwidthRateKbps = null,
    ): array;

    /**
     * Met à jour le quota de bande passante (et réinitialise éventuellement le compteur consommé).
     *
     * @return array{username: string, uid: int, quota_bytes: int, used_bytes: int, unlocked: bool}
     */
    public function updateBandwidthQuota(
        Server $server,
        string $username,
        int $quotaBytes,
        bool $resetUsage = false,
        ?int $bandwidthRateKbps = null,
    ): array;

    /**
     * Configure la limite de sessions SSH simultanées (maxuser) via PAM limits.d
     * et le contrôleur de processus tunnel (-N / WSS / SlowDNS).
     *
     * @return array{username: string, max_sessions: int, active_sessions: int, terminated_excess_pids: list<int>}
     */
    public function configureMaxUserSessions(
        Server $server,
        string $username,
        int $maxSessions,
        bool $enforceImmediately = true,
    ): array;

    /**
     * Retourne le nombre de sessions SSH actives et les PIDs associés pour un utilisateur ou tous.
     *
     * @return array<string, list<int>>
     */
    public function getActiveSessionsMap(Server $server, ?string $username = null): array;

    /**
     * Suspend un compte Linux (verrouillage + fermeture forcée des tunnels actifs).
     */
    public function suspendAccount(Server $server, string $username): bool;

    /**
     * Réactive un compte Linux précédemment suspendu.
     */
    public function unsuspendAccount(Server $server, string $username, ?DateTimeInterface $expiresAt = null): bool;

    /**
     * Supprime définitivement le compte Linux, ses règles de quota iptables/tc et sa config maxuser.
     */
    public function revokeAccount(Server $server, string $username): bool;

    /**
     * Vérifie la connectivité SSH par clé et collecte les métriques système en temps réel.
     *
     * @return array{reachable: bool, latency_ms: int, cpu_percent: float, ram_percent: float, active_tunnels: int}
     */
    public function probeServerHealth(Server $server): array;
}
