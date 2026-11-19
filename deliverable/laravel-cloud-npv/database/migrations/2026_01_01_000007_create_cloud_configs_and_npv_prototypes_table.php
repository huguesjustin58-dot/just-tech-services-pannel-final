<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('npv_prototypes', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 120);
            $table->string('version', 24)->default('v1.0');
            $table->string('file_extension', 10)->default('.npvt');
            $table->longText('raw_template');
            $table->boolean('is_active')->default(true)->index();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('cloud_activation_codes', function (Blueprint $table): void {
            $table->id();
            $table->string('code', 32)->unique();
            $table->foreignId('license_id')->constrained('licenses')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('status', 24)->default('ready')->index();
            $table->string('activated_device', 120)->nullable();
            $table->string('activated_ip', 45)->nullable();
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('expires_at')->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cloud_activation_codes');
        Schema::dropIfExists('npv_prototypes');
    }
};
