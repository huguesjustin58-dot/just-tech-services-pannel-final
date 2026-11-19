<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Contracts\Vpn\SshVpnBridgeInterface;
use App\DTOs\Vpn\LinuxSystemAccountData;
use App\Exceptions\VpnSshException;
use App\Models\Server;
use App\Services\Vpn\SshKeyVpnBridgeService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class SshKeyVpnBridgeTest extends TestCase
{
    use RefreshDatabase;

    public function test_ssh_bridge_rejects_shell_injection_usernames(): void
    {
        $service = new SshKeyVpnBridgeService();
        $server = Server::factory()->make(['public_ip' => '51.75.201.44']);

        $this->expectException(VpnSshException::class);

        $service->createUserWithBandwidthQuota(
            server: $server,
            username: 'jts_bad;rm -rf /',
            plainPassword: 'secret',
            expiresAt: CarbonImmutable::now()->addDays(30),
            quotaBytes: 10 * 1024 * 1024 * 1024,
            maxSessions: 2,
        );
    }

    public function test_ssh_bridge_rejects_privileged_system_usernames(): void
    {
        $service = new SshKeyVpnBridgeService();
        $server = Server::factory()->make(['public_ip' => '51.75.201.44']);

        $this->expectException(VpnSshException::class);

        $service->configureMaxUserSessions($server, 'root', 5);
    }

    public function test_sync_command_updates_license_bandwidth_and_active_connections(): void
    {
        $server = Server::factory()->create([
            'is_active' => true,
            'transport_mode' => 'ssh_key',
            'active_connections' => 0,
        ]);

        $mockBridge = Mockery::mock(SshVpnBridgeInterface::class);
        $mockBridge->shouldReceive('listSystemAccounts')
            ->once()
            ->with(Mockery::on(fn (Server $s) => $s->id === $server->id), true)
            ->andReturn([
                new LinuxSystemAccountData(
                    username: 'jts_kofi99',
                    uid: 1042,
                    gid: 1042,
                    homeDirectory: '/home/jts_kofi99',
                    shell: '/usr/sbin/nologin',
                    isLocked: false,
                    expiresAt: CarbonImmutable::now()->addDays(15),
                    bandwidthQuotaBytes: 50 * 1024 * 1024 * 1024,
                    bandwidthUsedBytes: 12 * 1024 * 1024 * 1024,
                    maxSessions: 3,
                    activeSessions: 2,
                    isJtsManaged: true,
                ),
            ]);

        $this->app->instance(SshVpnBridgeInterface::class, $mockBridge);

        $this->artisan('jts:vpn-sync-accounts')
            ->assertSuccessful();

        $this->assertSame(2, $server->fresh()->active_connections);
    }
}
