#!/usr/bin/env python3
"""
JUST TECH SERVICES PANEL — Phase 12 Final Package Generator
Construit l'arborescence complète de production (Laravel 11, Filament 3,
PostgreSQL 16, Redis 7, Pont SSH Clé Sécurisée, VPN Agent FastAPI, Infra Ubuntu)
et génère l'archive vérifiée JUST_TECH_SERVICES_PANEL_FINAL.zip.

Usage:
    python3 generate_jts_panel.py [--output-dir .] [--zip-name JUST_TECH_SERVICES_PANEL_FINAL.zip]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import zipfile
from pathlib import Path
from typing import Dict

EXECUTABLE_SUFFIXES = (".sh",)


def build_manifest(base_docs_dir: Path, ssh_bridge_dir: Path) -> Dict[str, str]:
    """Assemble le dictionnaire complet {chemin_relatif: contenu_utf8} sans aucune troncature."""
    files: Dict[str, str] = {}

    # ------------------------------------------------------------------
    # 1. DOCUMENTATION PHASE 12
    # ------------------------------------------------------------------
    for doc_name, target_rel in [
        ("README.md", "README.md"),
        ("ARCHITECTURE.md", "docs/ARCHITECTURE.md"),
        ("OPERATIONS_RUNBOOK.md", "docs/OPERATIONS_RUNBOOK.md"),
        ("DEPLOYMENT_GUIDE.md", "docs/DEPLOYMENT_GUIDE.md"),
    ]:
        doc_path = base_docs_dir / doc_name
        if doc_path.exists():
            files[target_rel] = doc_path.read_text(encoding="utf-8")

    deploy_scripts_dir = base_docs_dir.parent / "deploy-scripts"
    for script_name, target_rel in [
        ("deploy-final-package.sh", "infra/deploy-final-package.sh"),
        ("setup-firewall-fail2ban.sh", "infra/scripts/setup-firewall-fail2ban.sh"),
        ("setup-slowdns.sh", "infra/scripts/setup-slowdns.sh"),
        ("setup-nginx-tls.sh", "infra/scripts/setup-nginx-tls.sh"),
        ("backup-restore.sh", "infra/scripts/backup-restore.sh"),
        ("healthcheck-deploy.sh", "infra/scripts/healthcheck-deploy.sh"),
    ]:
        script_path = deploy_scripts_dir / script_name
        if script_path.exists():
            files[target_rel] = script_path.read_text(encoding="utf-8")

    # ------------------------------------------------------------------
    # 2. DOCKER & MAKEFILE (Non-root UID 1000)
    # ------------------------------------------------------------------
    files["docker-compose.yml"] = r'''services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_DATABASE:-just_tech_panel}
      POSTGRES_USER: ${DB_USERNAME:-jts_user}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD required}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USERNAME:-jts_user} -d ${DB_DATABASE:-just_tech_panel}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - jts_internal

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD:?REDIS_PASSWORD required}"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - jts_internal

  app:
    build:
      context: .
      dockerfile: docker/php/Dockerfile
    restart: unless-stopped
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./backend:/var/www/html
      - /run/jts-agent:/run/jts-agent
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - jts_internal

  horizon:
    build:
      context: .
      dockerfile: docker/php/Dockerfile
    restart: unless-stopped
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    command: ["php", "artisan", "horizon"]
    volumes:
      - ./backend:/var/www/html
      - /run/jts-agent:/run/jts-agent
    depends_on:
      - app
    networks:
      - jts_internal

  scheduler:
    build:
      context: .
      dockerfile: docker/php/Dockerfile
    restart: unless-stopped
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    command: ["sh", "-c", "while true; do php artisan schedule:run --no-interaction; sleep 60; done"]
    volumes:
      - ./backend:/var/www/html
      - /run/jts-agent:/run/jts-agent
    depends_on:
      - app
    networks:
      - jts_internal

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:80"
    volumes:
      - ./backend/public:/var/www/html/public:ro
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    networks:
      - jts_internal

volumes:
  pgdata:
  redisdata:

networks:
  jts_internal:
    driver: bridge
'''

    files["docker/php/Dockerfile"] = r'''FROM php:8.3-fpm-alpine

RUN apk add --no-cache \
    bash \
    curl \
    git \
    icu-dev \
    libpq-dev \
    libzip-dev \
    gmp-dev \
    oniguruma-dev \
    openssh-client \
    freetype-dev \
    libjpeg-turbo-dev \
    libpng-dev \
    $PHPIZE_DEPS \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_pgsql \
        pgsql \
        bcmath \
        gmp \
        intl \
        pcntl \
        sockets \
        zip \
        gd \
        opcache \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del $PHPIZE_DEPS

COPY --from=composer:2.8 /usr/bin/composer /usr/bin/composer

RUN deluser www-data || true \
    && addgroup -g 1000 jts \
    && adduser -D -u 1000 -G jts jts \
    && mkdir -p /var/www/html \
    && chown -R jts:jts /var/www/html

WORKDIR /var/www/html
USER jts
'''

    files["docker/nginx/default.conf"] = r'''server {
    listen 80;
    server_name _;
    root /var/www/html/public;
    index index.php;

    client_max_body_size 20M;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass app:9000;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 60s;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }
}
'''

    files["Makefile"] = r'''.PHONY: up down build migrate seed sync-vpn test backup

up:
	docker compose up -d

build:
	docker compose up -d --build

down:
	docker compose down

migrate:
	docker compose exec app php artisan migrate --force

seed:
	docker compose exec app php artisan db:seed --force

sync-vpn:
	docker compose exec app php artisan jts:vpn-sync-accounts

test:
	docker compose exec app php artisan test

backup:
	mkdir -p backups
	docker compose exec -T postgres pg_dump -U $${DB_USERNAME:-jts_user} -Fc $${DB_DATABASE:-just_tech_panel} | gzip > backups/jts_$$(date +%Y%m%d_%H%M).dump.gz
'''

    # ------------------------------------------------------------------
    # 3. BACKEND LARAVEL 11 + FILAMENT 3 + PHPSECLIB3
    # ------------------------------------------------------------------
    files["backend/composer.json"] = json.dumps({
        "name": "justtechservices/panel",
        "type": "project",
        "description": "JUST TECH SERVICES PANEL - SaaS VPN & Mobile Money Management Platform",
        "require": {
            "php": "^8.3",
            "barryvdh/laravel-dompdf": "^3.0",
            "filament/filament": "^3.2",
            "laravel/framework": "^11.0",
            "laravel/horizon": "^5.24",
            "laravel/sanctum": "^4.0",
            "phpseclib/phpseclib": "^3.0",
        },
        "require-dev": {
            "mockery/mockery": "^1.6",
            "phpunit/phpunit": "^11.0",
        },
        "autoload": {
            "psr-4": {
                "App\\": "app/",
                "Database\\Factories\\": "database/factories/",
                "Database\\Seeders\\": "database/seeders/",
            }
        },
        "autoload-dev": {
            "psr-4": {
                "Tests\\": "tests/",
            }
        },
        "minimum-stability": "stable",
        "prefer-stable": True,
    }, indent=2)

    files["backend/.env.example"] = r'''APP_NAME="JUST TECH SERVICES PANEL"
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_URL=https://panel.justtechservices.xyz

DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=just_tech_panel
DB_USERNAME=jts_user
DB_PASSWORD=CHANGE_ME_STRONG_PG_PASS

REDIS_HOST=redis
REDIS_PASSWORD=CHANGE_ME_STRONG_REDIS_PASS
REDIS_PORT=6379
QUEUE_CONNECTION=redis
CACHE_STORE=redis

JTS_VPN_TRANSPORT=ssh_key
JTS_SSH_PORT=22
JTS_SSH_CONNECT_TIMEOUT=10
JTS_SSH_COMMAND_TIMEOUT=20
JTS_SSH_STRICT_HOST_KEY=true
JTS_SSH_PRIVATE_KEY_PATH=/var/www/html/storage/app/keys/jts_vpn_ed25519

JTS_AGENT_SOCKET=/run/jts-agent/agent.sock
JTS_AGENT_HMAC_SECRET=CHANGE_ME_64_HEX_HMAC_SECRET

CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
'''

    files["backend/bootstrap/providers.php"] = r'''<?php

return [
    App\Providers\AppServiceProvider::class,
    App\Providers\VpnServiceProvider::class,
];
'''

    # Inclusion directe de tous les fichiers du Pont SSH Laravel validés
    ssh_bridge_mappings = [
        ("config/jts_vpn.php", "backend/config/jts_vpn.php"),
        ("app/Exceptions/VpnSshException.php", "backend/app/Exceptions/VpnSshException.php"),
        ("app/DTOs/Vpn/LinuxSystemAccountData.php", "backend/app/DTOs/Vpn/LinuxSystemAccountData.php"),
        ("app/Contracts/Vpn/SshVpnBridgeInterface.php", "backend/app/Contracts/Vpn/SshVpnBridgeInterface.php"),
        ("app/Services/Vpn/SshKeyVpnBridgeService.php", "backend/app/Services/Vpn/SshKeyVpnBridgeService.php"),
        ("app/Services/Vpn/VpnTransportResolver.php", "backend/app/Services/Vpn/VpnTransportResolver.php"),
        ("app/Console/Commands/SyncLinuxAccountsCommand.php", "backend/app/Console/Commands/SyncLinuxAccountsCommand.php"),
        ("app/Providers/VpnServiceProvider.php", "backend/app/Providers/VpnServiceProvider.php"),
        ("database/migrations/2026_01_01_000006_add_ssh_key_bridge_columns_to_servers_table.php", "backend/database/migrations/2026_01_01_000006_add_ssh_key_bridge_columns_to_servers_table.php"),
        ("tests/Feature/SshKeyVpnBridgeTest.php", "backend/tests/Feature/SshKeyVpnBridgeTest.php"),
        ("infra/scripts/jts-ssh-quota-reaper.sh", "infra/scripts/jts-ssh-quota-reaper.sh"),
    ]
    for src_rel, dest_rel in ssh_bridge_mappings:
        src_path = ssh_bridge_dir / src_rel
        if src_path.exists():
            files[dest_rel] = src_path.read_text(encoding="utf-8")

    cloud_npv_dir = base_docs_dir.parent / "laravel-cloud-npv"
    cloud_npv_mappings = [
        ("database/migrations/2026_01_01_000007_create_cloud_configs_and_npv_prototypes_table.php", "backend/database/migrations/2026_01_01_000007_create_cloud_configs_and_npv_prototypes_table.php"),
        ("database/migrations/2026_05_02_000011_create_free_test_claims_table.php", "backend/database/migrations/2026_05_02_000011_create_free_test_claims_table.php"),
        ("app/Models/NpvPrototype.php", "backend/app/Models/NpvPrototype.php"),
        ("app/Models/CloudActivationCode.php", "backend/app/Models/CloudActivationCode.php"),
        ("app/Services/Billing/MobileMoneyGatewayService.php", "backend/app/Services/Billing/MobileMoneyGatewayService.php"),
        ("app/Services/Compliance/FreeTestEligibilityService.php", "backend/app/Services/Compliance/FreeTestEligibilityService.php"),
        ("app/Services/Config/AndroidCloudConfigService.php", "backend/app/Services/Config/AndroidCloudConfigService.php"),
        ("app/Services/Config/NpvPrototypeCompilerService.php", "backend/app/Services/Config/NpvPrototypeCompilerService.php"),
        ("app/Http/Controllers/Api/ClientDeliveryController.php", "backend/app/Http/Controllers/Api/ClientDeliveryController.php"),
        ("app/Http/Middleware/EnsureInfraVisibleRole.php", "backend/app/Http/Middleware/EnsureInfraVisibleRole.php"),
        ("routes/api.php", "backend/routes/api.php"),
    ]
    for src_rel, dest_rel in cloud_npv_mappings:
        src_path = cloud_npv_dir / src_rel
        if src_path.exists():
            files[dest_rel] = src_path.read_text(encoding="utf-8")

    # Enums PHP 8.3
    files["backend/app/Enums/UserRole.php"] = r'''<?php

declare(strict_types=1);

namespace App\Enums;

enum UserRole: string
{
    case SUPER_ADMIN = 'super_admin';
    case ADMIN = 'admin';
    case MANAGER = 'manager';
    case RESELLER = 'reseller';
    case SUB_RESELLER = 'sub_reseller';
    case CLIENT = 'client';

    public function label(): string
    {
        return match ($this) {
            self::SUPER_ADMIN => 'Super Administrateur',
            self::ADMIN => 'Administrateur',
            self::MANAGER => 'Gestionnaire',
            self::RESELLER => 'Revendeur',
            self::SUB_RESELLER => 'Sous-revendeur',
            self::CLIENT => 'Client',
        };
    }

    public function isStaff(): bool
    {
        return in_array($this, [self::SUPER_ADMIN, self::ADMIN, self::MANAGER], true);
    }

    public function isResellerTier(): bool
    {
        return in_array($this, [self::RESELLER, self::SUB_RESELLER], true);
    }
}
'''

    files["backend/app/Enums/LicenseStatus.php"] = r'''<?php

declare(strict_types=1);

namespace App\Enums;

enum LicenseStatus: string
{
    case PENDING = 'pending';
    case PROVISIONING = 'provisioning';
    case ACTIVE = 'active';
    case SUSPENDED = 'suspended';
    case QUOTA_EXHAUSTED = 'quota_exhausted';
    case EXPIRED = 'expired';
    case REVOKED = 'revoked';

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'En attente',
            self::PROVISIONING => 'En provisionnement',
            self::ACTIVE => 'Active',
            self::SUSPENDED => 'Suspendue',
            self::QUOTA_EXHAUSTED => 'Quota épuisé',
            self::EXPIRED => 'Expirée',
            self::REVOKED => 'Révoquée',
        };
    }
}
'''

    files["backend/app/Enums/PaymentMethod.php"] = r'''<?php

declare(strict_types=1);

namespace App\Enums;

enum PaymentMethod: string
{
    case MTN_MOMO = 'mtn_momo';
    case ORANGE_MONEY = 'orange_money';
    case ORANGE_OM_ASSO = 'orange_om_asso';
    case MANUAL = 'manual';
    case RESELLER_CREDIT = 'reseller_credit';

    public function label(): string
    {
        return match ($this) {
            self::MTN_MOMO => 'MTN Mobile Money',
            self::ORANGE_MONEY => 'Orange Money',
            self::ORANGE_OM_ASSO => 'Orange Marchand OM ASSO (1017614)',
            self::MANUAL => 'Manuel',
            self::RESELLER_CREDIT => 'Crédit Revendeur',
        };
    }
}
'''

    files["backend/app/Enums/PaymentStatus.php"] = r'''<?php

declare(strict_types=1);

namespace App\Enums;

enum PaymentStatus: string
{
    case PENDING = 'pending';
    case PAID = 'paid';
    case REJECTED = 'rejected';

    public function label(): string
    {
        return match ($this) {
            self::PENDING => 'En attente',
            self::PAID => 'Payée',
            self::REJECTED => 'Rejetée',
        };
    }
}
'''

    files["backend/app/Enums/VpnProtocol.php"] = r'''<?php

declare(strict_types=1);

namespace App\Enums;

enum VpnProtocol: string
{
    case SSH = 'ssh';
    case SSH_SLOWDNS = 'ssh_slowdns';
    case SSH_WSS = 'ssh_wss';

    public function label(): string
    {
        return match ($this) {
            self::SSH => 'SSH Direct',
            self::SSH_SLOWDNS => 'SSH SlowDNS',
            self::SSH_WSS => 'SSH WebSocket TLS',
        };
    }
}
'''

    # Migrations PostgreSQL optimisées 1 000+ clients
    files["backend/database/migrations/2026_01_01_000001_create_users_and_resellers_table.php"] = r'''<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('phone', 32)->nullable()->index();
            $table->string('password');
            $table->string('role', 24)->default('client')->index();
            $table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('parent_reseller_id')->nullable()->constrained('users')->nullOnDelete();
            $table->bigInteger('credit_balance_fcfa')->default(0);
            $table->unsignedInteger('client_seat_limit')->default(50);
            $table->unsignedSmallInteger('commission_bps')->default(1000);
            $table->boolean('can_create_sub_resellers')->default(false);
            $table->boolean('is_active')->default(true)->index();
            $table->rememberToken();
            $table->timestamps();

            $table->index(['role', 'reseller_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
'''

    files["backend/database/migrations/2026_01_01_000002_create_plans_and_servers_table.php"] = r'''<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table): void {
            $table->id();
            $table->string('code', 40)->unique();
            $table->string('name', 80);
            $table->bigInteger('price_fcfa');
            $table->bigInteger('reseller_cost_fcfa');
            $table->unsignedInteger('duration_days');
            $table->unsignedInteger('quota_gb');
            $table->unsignedSmallInteger('max_concurrent_sessions')->default(1);
            $table->jsonb('allowed_protocols');
            $table->boolean('is_vip')->default(false);
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });

        Schema::create('servers', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 80);
            $table->string('region_code', 16)->default('EU-FR');
            $table->string('public_ip', 45)->unique();
            $table->string('hostname', 120)->nullable();
            $table->unsignedSmallInteger('ssh_port')->default(22);
            $table->unsignedSmallInteger('wss_port')->default(443);
            $table->unsignedSmallInteger('slowdns_port')->default(53);
            $table->string('slowdns_ns_domain', 120)->nullable();
            $table->text('slowdns_public_key')->nullable();
            $table->string('agent_endpoint', 180)->default('/run/jts-agent/agent.sock');
            $table->unsignedInteger('max_connections')->default(500);
            $table->unsignedInteger('active_connections')->default(0);
            $table->decimal('cpu_usage_percent', 5, 2)->default(0);
            $table->decimal('ram_usage_percent', 5, 2)->default(0);
            $table->unsignedInteger('latency_ms')->default(0);
            $table->boolean('is_active')->default(true)->index();
            $table->timestamp('last_heartbeat_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('servers');
        Schema::dropIfExists('plans');
    }
};
'''

    files["backend/database/migrations/2026_01_01_000003_create_licenses_table.php"] = r'''<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('licenses', function (Blueprint $table): void {
            $table->id();
            $table->string('idempotency_key', 96)->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('plan_id')->constrained('plans');
            $table->foreignId('server_id')->constrained('servers');
            $table->string('vpn_username', 48)->unique();
            $table->text('vpn_password_encrypted');
            $table->string('status', 24)->default('pending')->index();
            $table->bigInteger('bandwidth_quota_bytes');
            $table->bigInteger('bandwidth_used_bytes')->default(0);
            $table->unsignedSmallInteger('max_concurrent_sessions')->default(1);
            $table->timestamp('starts_at');
            $table->timestamp('expires_at')->index();
            $table->text('last_error')->nullable();
            $table->timestamps();

            $table->index(['reseller_id', 'status']);
        });

        DB::statement("CREATE INDEX idx_licenses_active_expiry ON licenses (expires_at) WHERE status = 'active'");
    }

    public function down(): void
    {
        Schema::dropIfExists('licenses');
    }
};
'''

    files["backend/database/migrations/2026_01_01_000004_create_payments_and_ledger_tables.php"] = r'''<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table): void {
            $table->id();
            $table->string('invoice_number', 40)->unique();
            $table->string('idempotency_key', 96)->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('plan_id')->constrained('plans');
            $table->foreignId('license_id')->nullable()->constrained('licenses')->nullOnDelete();
            $table->bigInteger('amount_fcfa');
            $table->string('method', 32)->index();
            $table->string('status', 24)->default('pending')->index();
            $table->string('external_reference', 96)->nullable()->index();
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->timestamps();
        });

        Schema::create('reseller_credit_ledgers', function (Blueprint $table): void {
            $table->id();
            $table->string('idempotency_key', 96)->unique();
            $table->foreignId('reseller_id')->constrained('users');
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('entry_type', 32)->index();
            $table->bigInteger('amount_fcfa');
            $table->bigInteger('balance_before_fcfa');
            $table->bigInteger('balance_after_fcfa');
            $table->string('description', 255);
            $table->jsonb('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reseller_credit_ledgers');
        Schema::dropIfExists('payments');
    }
};
'''

    files["backend/database/migrations/2026_01_01_000005_create_configs_dns_and_audit_tables.php"] = r'''<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vpn_configs', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 120);
            $table->string('protocol', 24)->index();
            $table->string('target_app', 32)->default('npv_tunnel');
            $table->string('visibility', 16)->default('public')->index();
            $table->unsignedInteger('version')->default(1);
            $table->string('download_token', 64)->unique();
            $table->jsonb('template_payload');
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });

        DB::statement('CREATE INDEX idx_vpn_configs_payload_gin ON vpn_configs USING GIN (template_payload)');

        Schema::create('dns_records', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('server_id')->constrained('servers')->cascadeOnDelete();
            $table->string('record_type', 8);
            $table->string('fqdn', 160);
            $table->string('content', 180);
            $table->string('cloudflare_record_id', 64)->nullable();
            $table->boolean('proxied')->default(false);
            $table->timestamps();
        });

        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 80)->index();
            $table->string('auditable_type', 120)->nullable();
            $table->unsignedBigInteger('auditable_id')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->jsonb('context')->nullable();
            $table->timestamp('created_at')->useCurrent()->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('dns_records');
        Schema::dropIfExists('vpn_configs');
    }
};
'''

    # Modèles & Scope d'isolation revendeur
    files["backend/app/Models/Scopes/ResellerIsolationScope.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models\Scopes;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Support\Facades\Auth;

class ResellerIsolationScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = Auth::user();
        if (! $user instanceof User) {
            return;
        }

        if ($user->role === UserRole::SUPER_ADMIN || $user->role->isStaff()) {
            return;
        }

        $table = $model->getTable();
        if ($user->role === UserRole::RESELLER) {
            $subIds = User::withoutGlobalScopes()
                ->where('parent_reseller_id', $user->id)
                ->pluck('id')
                ->all();
            $allowedResellerIds = array_merge([$user->id], $subIds);
            $builder->whereIn("{$table}.reseller_id", $allowedResellerIds);
            return;
        }

        if ($user->role === UserRole::SUB_RESELLER) {
            $builder->where("{$table}.reseller_id", $user->id);
            return;
        }

        if ($user->role === UserRole::CLIENT) {
            $col = $table === 'users' ? 'id' : 'user_id';
            $builder->where("{$table}.{$col}", $user->id);
        }
    }
}
'''

    files["backend/app/Models/User.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\UserRole;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name', 'email', 'phone', 'password', 'role',
        'reseller_id', 'parent_reseller_id', 'credit_balance_fcfa',
        'client_seat_limit', 'commission_bps', 'can_create_sub_resellers', 'is_active',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'role' => UserRole::class,
            'password' => 'hashed',
            'credit_balance_fcfa' => 'integer',
            'client_seat_limit' => 'integer',
            'commission_bps' => 'integer',
            'can_create_sub_resellers' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function reseller(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reseller_id');
    }

    public function licenses(): HasMany
    {
        return $this->hasMany(License::class);
    }
}
'''

    files["backend/app/Models/Server.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Server extends Model
{
    use HasFactory;

    protected $fillable = [
        'name', 'region_code', 'public_ip', 'hostname',
        'ssh_port', 'wss_port', 'slowdns_port', 'slowdns_ns_domain',
        'slowdns_public_key', 'agent_endpoint', 'transport_mode',
        'ssh_mgmt_user', 'ssh_mgmt_port', 'ssh_host_fingerprint',
        'ssh_private_key_encrypted', 'ssh_private_key_passphrase_encrypted',
        'max_connections', 'active_connections', 'cpu_usage_percent',
        'ram_usage_percent', 'latency_ms', 'is_active', 'last_heartbeat_at',
    ];

    protected $hidden = [
        'ssh_private_key_encrypted',
        'ssh_private_key_passphrase_encrypted',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'cpu_usage_percent' => 'float',
            'ram_usage_percent' => 'float',
            'last_heartbeat_at' => 'datetime',
        ];
    }

    public function licenses(): HasMany
    {
        return $this->hasMany(License::class);
    }

    public function loadScore(): float
    {
        $connRatio = $this->max_connections > 0
            ? ($this->active_connections / $this->max_connections) * 100
            : 100.0;

        return ($connRatio * 0.5) + ($this->cpu_usage_percent * 0.3) + ($this->ram_usage_percent * 0.2);
    }
}
'''

    files["backend/app/Models/Plan.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    use HasFactory;

    protected $fillable = [
        'code', 'name', 'price_fcfa', 'reseller_cost_fcfa',
        'duration_days', 'quota_gb', 'max_concurrent_sessions',
        'allowed_protocols', 'is_vip', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'allowed_protocols' => 'array',
            'is_vip' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
'''

    files["backend/app/Models/License.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\LicenseStatus;
use App\Models\Scopes\ResellerIsolationScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class License extends Model
{
    use HasFactory;

    protected $fillable = [
        'idempotency_key', 'user_id', 'reseller_id', 'plan_id', 'server_id',
        'vpn_username', 'vpn_password_encrypted', 'status',
        'bandwidth_quota_bytes', 'bandwidth_used_bytes', 'max_concurrent_sessions',
        'starts_at', 'expires_at', 'last_error',
    ];

    protected $hidden = ['vpn_password_encrypted'];

    protected static function booted(): void
    {
        static::addGlobalScope(new ResellerIsolationScope());
    }

    protected function casts(): array
    {
        return [
            'status' => LicenseStatus::class,
            'bandwidth_quota_bytes' => 'integer',
            'bandwidth_used_bytes' => 'integer',
            'max_concurrent_sessions' => 'integer',
            'starts_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class);
    }
}
'''

    files["backend/app/Models/Payment.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\PaymentMethod;
use App\Enums\PaymentStatus;
use App\Models\Scopes\ResellerIsolationScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    protected $fillable = [
        'invoice_number', 'idempotency_key', 'user_id', 'reseller_id',
        'plan_id', 'license_id', 'amount_fcfa', 'method', 'status',
        'external_reference', 'verified_by', 'verified_at', 'rejection_reason',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new ResellerIsolationScope());
    }

    protected function casts(): array
    {
        return [
            'method' => PaymentMethod::class,
            'status' => PaymentStatus::class,
            'amount_fcfa' => 'integer',
            'verified_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }
}
'''

    files["backend/app/Models/ResellerCreditLedger.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

class ResellerCreditLedger extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'idempotency_key', 'reseller_id', 'actor_id', 'entry_type',
        'amount_fcfa', 'balance_before_fcfa', 'balance_after_fcfa',
        'description', 'metadata', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('Le journal financier revendeur est strictement immuable.'));
        static::deleting(static fn () => throw new LogicException('La suppression du journal financier est interdite.'));
    }

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
'''

    files["backend/app/Models/VpnConfig.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\VpnProtocol;
use Illuminate\Database\Eloquent\Model;

class VpnConfig extends Model
{
    protected $fillable = [
        'name', 'protocol', 'target_app', 'visibility',
        'version', 'download_token', 'template_payload', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'protocol' => VpnProtocol::class,
            'template_payload' => 'array',
            'is_active' => 'boolean',
        ];
    }
}
'''

    files["backend/app/Models/AuditLog.php"] = r'''<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

class AuditLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'actor_id', 'action', 'auditable_type', 'auditable_id',
        'ip_address', 'context', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('AuditLog est immuable.'));
        static::deleting(static fn () => throw new LogicException('AuditLog est immuable.'));
    }

    protected function casts(): array
    {
        return [
            'context' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
'''

    # Services Billing, LoadBalancer, AgentClient, Provisioning, Config Generators
    files["backend/app/Services/Billing/CreditLedgerService.php"] = r'''<?php

declare(strict_types=1);

namespace App\Services\Billing;

use App\Models\ResellerCreditLedger;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class CreditLedgerService
{
    public function debitForLicense(
        User $reseller,
        int $amountFcfa,
        string $idempotencyKey,
        string $description,
        ?User $actor = null,
    ): ResellerCreditLedger {
        return DB::transaction(function () use ($reseller, $amountFcfa, $idempotencyKey, $description, $actor): ResellerCreditLedger {
            $existing = ResellerCreditLedger::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();

            if ($existing) {
                return $existing;
            }

            $locked = User::withoutGlobalScopes()
                ->whereKey($reseller->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($locked->credit_balance_fcfa < $amountFcfa) {
                throw new RuntimeException("Solde de crédits insuffisant ({$locked->credit_balance_fcfa} FCFA disponibles).");
            }

            $before = $locked->credit_balance_fcfa;
            $after = $before - $amountFcfa;
            $locked->update(['credit_balance_fcfa' => $after]);

            return ResellerCreditLedger::create([
                'idempotency_key' => $idempotencyKey,
                'reseller_id' => $locked->id,
                'actor_id' => $actor?->id ?? $locked->id,
                'entry_type' => 'license_debit',
                'amount_fcfa' => -$amountFcfa,
                'balance_before_fcfa' => $before,
                'balance_after_fcfa' => $after,
                'description' => $description,
                'created_at' => now(),
            ]);
        });
    }
}
'''

    files["backend/app/Services/Vpn/ServerLoadBalancer.php"] = r'''<?php

declare(strict_types=1);

namespace App\Services\Vpn;

use App\Models\Server;
use RuntimeException;

class ServerLoadBalancer
{
    public function selectOptimalServer(?string $preferredRegion = null): Server
    {
        $query = Server::query()
            ->where('is_active', true)
            ->whereColumn('active_connections', '<', 'max_connections');

        if ($preferredRegion !== null) {
            $regional = (clone $query)->where('region_code', $preferredRegion)->get();
            if ($regional->isNotEmpty()) {
                return $regional->sortBy(fn (Server $s): float => $s->loadScore())->first();
            }
        }

        $server = $query->get()->sortBy(fn (Server $s): float => $s->loadScore())->first();
        if (! $server) {
            throw new RuntimeException('Aucun serveur VPN disponible avec capacité libre.');
        }

        return $server;
    }
}
'''

    files["backend/app/Services/Vpn/VpnAgentClient.php"] = r'''<?php

declare(strict_types=1);

namespace App\Services\Vpn;

use App\Models\Server;
use Illuminate\Support\Str;
use RuntimeException;

class VpnAgentClient
{
    public function createUser(
        Server $server,
        string $username,
        string $password,
        string $expiresAt,
        int $maxSessions,
        int $quotaBytes,
    ): array {
        return $this->request($server, 'POST', '/v1/users/provision', [
            'username' => $username,
            'password' => $password,
            'expires_at' => $expiresAt,
            'max_sessions' => $maxSessions,
            'quota_bytes' => $quotaBytes,
        ]);
    }

    public function updateLimits(Server $server, string $username, int $quotaBytes, int $maxSessions): array
    {
        return $this->request($server, 'POST', '/v1/users/limits', [
            'username' => $username,
            'quota_bytes' => $quotaBytes,
            'max_sessions' => $maxSessions,
        ]);
    }

    public function suspendUser(Server $server, string $username): array
    {
        return $this->request($server, 'POST', '/v1/users/suspend', ['username' => $username]);
    }

    public function revokeUser(Server $server, string $username): array
    {
        return $this->request($server, 'POST', '/v1/users/revoke', ['username' => $username]);
    }

    protected function request(Server $server, string $method, string $path, array $payload): array
    {
        $socketPath = $server->agent_endpoint ?: config('jts_vpn.agent.socket_path', '/run/jts-agent/agent.sock');
        $secret = (string) config('jts_vpn.agent.hmac_secret');
        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $nonce = Str::uuid()->toString();
        $signature = hash_hmac('sha256', "{$timestamp}.{$nonce}.{$method}.{$path}.{$body}", $secret);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_UNIX_SOCKET_PATH => $socketPath,
            CURLOPT_URL => "http://localhost{$path}",
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => (int) config('jts_vpn.agent.timeout', 15),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                "X-JTS-Timestamp: {$timestamp}",
                "X-JTS-Nonce: {$nonce}",
                "X-JTS-Signature: {$signature}",
            ],
        ]);

        $raw = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $status >= 400) {
            throw new RuntimeException("Erreur Agent VPN ({$status}) : {$err} {$raw}");
        }

        return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    }
}
'''

    files["backend/app/Jobs/ProvisionVpnAccountJob.php"] = r'''<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Enums\LicenseStatus;
use App\Models\License;
use App\Services\Vpn\VpnTransportResolver;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Crypt;
use Throwable;

class ProvisionVpnAccountJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 4;
    public array $backoff = [10, 30, 90];

    public function __construct(public readonly int $licenseId) {}

    public function handle(VpnTransportResolver $transport): void
    {
        $license = License::withoutGlobalScopes()->with(['server', 'plan'])->findOrFail($this->licenseId);
        if ($license->status === LicenseStatus::REVOKED) {
            return;
        }

        try {
            $plainPassword = Crypt::decryptString($license->vpn_password_encrypted);
            $transport->provisionLicenseAccount($license, $plainPassword);

            $license->update([
                'status' => LicenseStatus::ACTIVE,
                'last_error' => null,
            ]);
        } catch (Throwable $e) {
            $license->update(['last_error' => $e->getMessage()]);
            throw $e;
        }
    }
}
'''

    files["backend/app/Services/Config/VpnConfigGeneratorService.php"] = r'''<?php

declare(strict_types=1);

namespace App\Services\Config;

use App\Models\License;
use App\Models\VpnConfig;
use Illuminate\Support\Facades\Crypt;

class VpnConfigGeneratorService
{
    public function generateForLicense(VpnConfig $config, License $license): array
    {
        $server = $license->server;
        $password = Crypt::decryptString($license->vpn_password_encrypted);
        $payload = $config->template_payload;

        return [
            'app' => $config->target_app,
            'profile_name' => "{$config->name} v{$config->version}",
            'protocol' => $config->protocol->value,
            'server' => [
                'host' => $server->hostname ?: $server->public_ip,
                'ssh_port' => $server->ssh_port,
                'wss_port' => $server->wss_port,
                'slowdns_port' => $server->slowdns_port,
                'slowdns_ns' => $server->slowdns_ns_domain,
                'slowdns_pubkey' => $server->slowdns_public_key,
            ],
            'auth' => [
                'username' => $license->vpn_username,
                'password' => $password,
            ],
            'payload_template' => $payload,
            'expires_at' => $license->expires_at->toIso8601String(),
        ];
    }
}
'''

    files["backend/database/seeders/DatabaseSeeder.php"] = r'''<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        User::firstOrCreate(
            ['email' => 'superadmin@justtechservices.xyz'],
            [
                'name' => 'Super Admin JTS',
                'password' => Hash::make('ChangeMeStrong!2026'),
                'role' => UserRole::SUPER_ADMIN,
                'is_active' => true,
            ],
        );

        $plans = [
            // NPV TUNNEL
            ['code' => 'npv_500', 'name' => 'NPV 5 Go (5 jours)', 'price_fcfa' => 500, 'reseller_cost_fcfa' => 400, 'duration_days' => 5, 'quota_gb' => 5, 'max_concurrent_sessions' => 1, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => false],
            ['code' => 'npv_1000', 'name' => 'NPV 10 Go (7 jours)', 'price_fcfa' => 1000, 'reseller_cost_fcfa' => 800, 'duration_days' => 7, 'quota_gb' => 10, 'max_concurrent_sessions' => 1, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => false],
            ['code' => 'npv_2000', 'name' => 'NPV 20 Go (10 jours)', 'price_fcfa' => 2000, 'reseller_cost_fcfa' => 1600, 'duration_days' => 10, 'quota_gb' => 20, 'max_concurrent_sessions' => 2, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => false],
            ['code' => 'npv_2500', 'name' => 'NPV 25 Go (12 jours)', 'price_fcfa' => 2500, 'reseller_cost_fcfa' => 2000, 'duration_days' => 12, 'quota_gb' => 25, 'max_concurrent_sessions' => 2, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => false],
            ['code' => 'npv_4000', 'name' => 'NPV 40 Go (15 jours)', 'price_fcfa' => 4000, 'reseller_cost_fcfa' => 3200, 'duration_days' => 15, 'quota_gb' => 40, 'max_concurrent_sessions' => 2, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => false],
            ['code' => 'npv_5000', 'name' => 'NPV 60 Go (20 jours)', 'price_fcfa' => 5000, 'reseller_cost_fcfa' => 4000, 'duration_days' => 20, 'quota_gb' => 60, 'max_concurrent_sessions' => 3, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => true],
            // INTERNET ILLIMITÉ
            ['code' => 'unlim_3000', 'name' => 'Illimité 1 Semaine', 'price_fcfa' => 3000, 'reseller_cost_fcfa' => 2400, 'duration_days' => 7, 'quota_gb' => 0, 'max_concurrent_sessions' => 2, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => true],
            ['code' => 'unlim_4800', 'name' => 'Illimité 2 Semaines', 'price_fcfa' => 4800, 'reseller_cost_fcfa' => 3800, 'duration_days' => 14, 'quota_gb' => 0, 'max_concurrent_sessions' => 2, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => true],
            ['code' => 'unlim_10000', 'name' => 'Illimité 1 Mois', 'price_fcfa' => 10000, 'reseller_cost_fcfa' => 8000, 'duration_days' => 30, 'quota_gb' => 0, 'max_concurrent_sessions' => 3, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => true],
            // OFFRE TEST GRATUIT
            ['code' => 'free_test_3go_2h', 'name' => 'Offre Test Gratuit (3 Go / 2h)', 'price_fcfa' => 0, 'reseller_cost_fcfa' => 0, 'duration_days' => 1, 'quota_gb' => 3, 'max_concurrent_sessions' => 1, 'allowed_protocols' => ['ssh', 'ssh_slowdns', 'ssh_wss'], 'is_vip' => false],
        ];

        foreach ($plans as $plan) {
            Plan::updateOrCreate(['code' => $plan['code']], $plan);
        }
    }
}
'''

    files["backend/routes/console.php"] = r'''<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('jts:vpn-sync-accounts')->everyMinute()->withoutOverlapping();
'''

    # ------------------------------------------------------------------
    # 4. MICROSERVICE PYTHON VPN-AGENT (FastAPI + HMAC)
    # ------------------------------------------------------------------
    files["vpn-agent/requirements.txt"] = "fastapi==0.115.0\nuvicorn==0.30.6\npydantic==2.9.2\n"

    files["vpn-agent/security.py"] = r'''import hashlib
import hmac
import os
import re
import time
from collections import OrderedDict
from fastapi import HTTPException, Request

USERNAME_RE = re.compile(r"^jts_[a-z0-9_]{3,24}$")
_NONCE_CACHE: OrderedDict[str, float] = OrderedDict()


def validate_username(username: str) -> str:
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=422, detail="Nom d'utilisateur VPN invalide.")
    return username


async def verify_hmac_request(request: Request) -> bytes:
    secret = os.environ.get("JTS_AGENT_HMAC_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="Secret HMAC manquant.")

    ts = request.headers.get("X-JTS-Timestamp", "")
    nonce = request.headers.get("X-JTS-Nonce", "")
    sig = request.headers.get("X-JTS-Signature", "")

    if not ts.isdigit() or abs(time.time() - int(ts)) > 30:
        raise HTTPException(status_code=401, detail="Horodatage expiré.")

    if not nonce or nonce in _NONCE_CACHE:
        raise HTTPException(status_code=401, detail="Nonce invalide ou rejoué.")

    body = await request.body()
    canonical = f"{ts}.{nonce}.{request.method}.{request.url.path}.{body.decode('utf-8')}"
    expected = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=401, detail="Signature HMAC invalide.")

    _NONCE_CACHE[nonce] = time.time()
    while len(_NONCE_CACHE) > 2048:
        _NONCE_CACHE.popitem(last=False)

    return body
'''

    files["vpn-agent/main.py"] = r'''import json
import subprocess
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from security import validate_username, verify_hmac_request

app = FastAPI(title="JUST TECH SERVICES VPN Agent")


class ProvisionPayload(BaseModel):
    username: str
    password: str
    expires_at: str
    max_sessions: int = Field(ge=1, le=50)
    quota_bytes: int = Field(ge=0)


@app.post("/v1/users/provision")
async def provision_user(request: Request):
    raw = await verify_hmac_request(request)
    data = ProvisionPayload(**json.loads(raw))
    uname = validate_username(data.username)

    subprocess.run(
        ["sudo", "/usr/local/sbin/jts-user-create.sh", uname, data.expires_at, str(data.max_sessions), str(data.quota_bytes)],
        input=f"{uname}:{data.password}\n".encode(),
        check=True,
    )
    return {"ok": True, "username": uname}


@app.post("/v1/users/suspend")
async def suspend_user(request: Request):
    raw = await verify_hmac_request(request)
    uname = validate_username(json.loads(raw)["username"])
    subprocess.run(["sudo", "usermod", "-L", uname], check=True)
    subprocess.run(["sudo", "pkill", "-TERM", "-u", uname], check=False)
    return {"ok": True, "username": uname}
'''

    # ------------------------------------------------------------------
    # 5. INFRASTRUCTURE UBUNTU / SYSTEMD / SUDOERS / FAIL2BAN
    # ------------------------------------------------------------------
    files["infra/ubuntu-setup.sh"] = r'''#!/usr/bin/env bash
set -euo pipefail

echo "[1/5] Création des répertoires /etc/jts et /var/lib/jts..."
mkdir -p /etc/jts/quotas /etc/jts/maxuser /var/lib/jts/usage /run/jts-agent

echo "[2/5] Installation du reaper Quotas & MaxUser..."
install -m 0755 infra/scripts/jts-ssh-quota-reaper.sh /usr/local/sbin/jts-ssh-quota-reaper.sh
install -m 0644 infra/systemd/jts-quota-reaper.service /etc/systemd/system/jts-quota-reaper.service
install -m 0644 infra/systemd/jts-quota-reaper.timer /etc/systemd/system/jts-quota-reaper.timer

echo "[3/5] Configuration sudoers restreinte pour jts-provisioner..."
if ! id -u jts-provisioner >/dev/null 2>&1; then
    useradd -m -s /bin/bash jts-provisioner
fi
install -m 0440 infra/sudoers/jts-provisioner /etc/sudoers.d/jts-provisioner

echo "[4/5] Désactivation DNSStubListener (libération UDP 53 pour SlowDNS)..."
mkdir -p /etc/systemd/resolved.conf.d
printf "[Resolve]\nDNSStubListener=no\n" > /etc/systemd/resolved.conf.d/jts-slowdns.conf
systemctl restart systemd-resolved || true

echo "[5/5] Activation du timer jts-quota-reaper..."
systemctl daemon-reload
systemctl enable --now jts-quota-reaper.timer
echo "Setup Ubuntu terminé."
'''

    files["infra/systemd/jts-quota-reaper.service"] = r'''[Unit]
Description=JUST TECH SERVICES - Quota & MaxUser Enforcer

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/jts-ssh-quota-reaper.sh
'''

    files["infra/systemd/jts-quota-reaper.timer"] = r'''[Unit]
Description=Run JTS Quota & MaxUser Enforcer every 10 seconds

[Timer]
OnBootSec=15s
OnUnitActiveSec=10s
AccuracySec=1s

[Install]
WantedBy=timers.target
'''

    files["infra/sudoers/jts-provisioner"] = r'''Defaults:jts-provisioner !requiretty
jts-provisioner ALL=(root) NOPASSWD: /usr/sbin/useradd, /usr/sbin/usermod, /usr/sbin/userdel, /usr/sbin/chpasswd, /usr/bin/chage, /usr/bin/getent, /usr/sbin/iptables, /usr/bin/pkill, /bin/kill, /bin/mkdir, /usr/bin/tee, /bin/chmod, /bin/rm
'''

    files["infra/fail2ban-jts.local"] = r'''[sshd]
enabled = true
port = ssh
maxretry = 5
bantime = 3600
findtime = 600
'''

    return files


def generate_package(output_dir: Path, zip_name: str, docs_dir: Path, ssh_bridge_dir: Path) -> Path:
    project_root = output_dir / "JUST_TECH_SERVICES_PANEL"
    zip_path = output_dir / zip_name
    manifest = build_manifest(docs_dir, ssh_bridge_dir)

    for rel_path, content in manifest.items():
        full_path = project_root / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")
        if rel_path.endswith(EXECUTABLE_SUFFIXES):
            os.chmod(full_path, 0o755)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel_path in sorted(manifest.keys()):
            full_path = project_root / rel_path
            zf.write(full_path, arcname=f"JUST_TECH_SERVICES_PANEL/{rel_path}")

    sha256 = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (output_dir / f"{zip_name}.sha256").write_text(f"{sha256}  {zip_name}\n", encoding="utf-8")

    print(f"[OK] Projet généré : {project_root} ({len(manifest)} fichiers)")
    print(f"[OK] Archive ZIP   : {zip_path} ({zip_path.stat().st_size} octets)")
    print(f"[OK] SHA-256       : {sha256}")
    return zip_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Générateur final JUST_TECH_SERVICES_PANEL_FINAL.zip")
    parser.add_argument("--output-dir", default=".", help="Répertoire de sortie")
    parser.add_argument("--zip-name", default="JUST_TECH_SERVICES_PANEL_FINAL.zip", help="Nom de l'archive ZIP")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    generate_package(
        output_dir=Path(args.output_dir).resolve(),
        zip_name=args.zip_name,
        docs_dir=script_dir / "docs",
        ssh_bridge_dir=script_dir / "laravel-ssh-bridge",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
