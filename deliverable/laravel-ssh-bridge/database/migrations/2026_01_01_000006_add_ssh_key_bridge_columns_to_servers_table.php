<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('servers', function (Blueprint $table): void {
            $table->string('transport_mode', 20)->default('ssh_key')->after('agent_endpoint');
            $table->string('ssh_mgmt_user', 64)->default('jts-provisioner')->after('transport_mode');
            $table->unsignedSmallInteger('ssh_mgmt_port')->default(22)->after('ssh_mgmt_user');
            $table->string('ssh_host_fingerprint', 128)->nullable()->after('ssh_mgmt_port');
            $table->text('ssh_private_key_encrypted')->nullable()->after('ssh_host_fingerprint');
            $table->text('ssh_private_key_passphrase_encrypted')->nullable()->after('ssh_private_key_encrypted');
        });
    }

    public function down(): void
    {
        Schema::table('servers', function (Blueprint $table): void {
            $table->dropColumn([
                'transport_mode',
                'ssh_mgmt_user',
                'ssh_mgmt_port',
                'ssh_host_fingerprint',
                'ssh_private_key_encrypted',
                'ssh_private_key_passphrase_encrypted',
            ]);
        });
    }
};
