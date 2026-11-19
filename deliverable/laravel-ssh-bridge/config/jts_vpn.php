<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Mode de transport VPN par défaut
    |--------------------------------------------------------------------------
    | 'ssh_key' : Connexion directe via phpseclib3 + clé privée Ed25519/RSA
    | 'agent'   : Microservice Python local vpn-agent (HMAC + Unix Socket/mTLS)
    */
    'default_transport' => env('JTS_VPN_TRANSPORT', 'ssh_key'),

    'ssh' => [
        'port' => (int) env('JTS_SSH_PORT', 22),
        'connect_timeout' => (int) env('JTS_SSH_CONNECT_TIMEOUT', 10),
        'command_timeout' => (int) env('JTS_SSH_COMMAND_TIMEOUT', 20),
        'strict_host_key_checking' => (bool) env('JTS_SSH_STRICT_HOST_KEY', true),
        'default_private_key_path' => env('JTS_SSH_PRIVATE_KEY_PATH', storage_path('app/keys/jts_vpn_ed25519')),
        'default_private_key_passphrase' => env('JTS_SSH_KEY_PASSPHRASE'),
        'managed_prefix' => env('JTS_MANAGED_USER_PREFIX', 'jts_'),
        'min_uid' => (int) env('JTS_LINUX_MIN_UID', 1000),
        'default_shell' => env('JTS_VPN_ACCOUNT_SHELL', '/usr/sbin/nologin'),
        'sudo_binary' => env('JTS_SUDO_BIN', 'sudo -n'),
    ],

    'paths' => [
        'quotas_dir' => '/etc/jts/quotas',
        'maxuser_dir' => '/etc/jts/maxuser',
        'usage_dir' => '/var/lib/jts/usage',
        'limits_dir' => '/etc/security/limits.d',
        'reaper_script' => '/usr/local/sbin/jts-ssh-quota-reaper.sh',
    ],

    'agent' => [
        'socket_path' => env('JTS_AGENT_SOCKET', '/run/jts-agent/agent.sock'),
        'hmac_secret' => env('JTS_AGENT_HMAC_SECRET', ''),
        'timeout' => (int) env('JTS_AGENT_TIMEOUT', 15),
    ],
];
