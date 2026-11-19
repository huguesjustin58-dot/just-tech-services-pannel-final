<?php

declare(strict_types=1);

namespace App\Providers;

use App\Contracts\Vpn\SshVpnBridgeInterface;
use App\Services\Vpn\SshKeyVpnBridgeService;
use Illuminate\Support\ServiceProvider;

class VpnServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(
            base_path('config/jts_vpn.php'),
            'jts_vpn',
        );

        $this->app->singleton(SshVpnBridgeInterface::class, SshKeyVpnBridgeService::class);
    }
}
