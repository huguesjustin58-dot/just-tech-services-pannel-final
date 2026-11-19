<?php

declare(strict_types=1);

namespace App\DTOs\Vpn;

use Carbon\CarbonImmutable;

final readonly class LinuxSystemAccountData
{
    public function __construct(
        public string $username,
        public int $uid,
        public int $gid,
        public string $homeDirectory,
        public string $shell,
        public bool $isLocked,
        public ?CarbonImmutable $expiresAt,
        public int $bandwidthQuotaBytes,
        public int $bandwidthUsedBytes,
        public int $maxSessions,
        public int $activeSessions,
        public bool $isJtsManaged,
    ) {}

    public function remainingBandwidthBytes(): int
    {
        if ($this->bandwidthQuotaBytes <= 0) {
            return PHP_INT_MAX;
        }

        return max(0, $this->bandwidthQuotaBytes - $this->bandwidthUsedBytes);
    }

    public function isQuotaExhausted(): bool
    {
        return $this->bandwidthQuotaBytes > 0
            && $this->bandwidthUsedBytes >= $this->bandwidthQuotaBytes;
    }

    public function toArray(): array
    {
        return [
            'username' => $this->username,
            'uid' => $this->uid,
            'gid' => $this->gid,
            'home_directory' => $this->homeDirectory,
            'shell' => $this->shell,
            'is_locked' => $this->isLocked,
            'expires_at' => $this->expiresAt?->toIso8601String(),
            'bandwidth_quota_bytes' => $this->bandwidthQuotaBytes,
            'bandwidth_used_bytes' => $this->bandwidthUsedBytes,
            'remaining_bandwidth_bytes' => $this->remainingBandwidthBytes(),
            'quota_exhausted' => $this->isQuotaExhausted(),
            'max_sessions' => $this->maxSessions,
            'active_sessions' => $this->activeSessions,
            'is_jts_managed' => $this->isJtsManaged,
        ];
    }
}
