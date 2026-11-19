<?php

declare(strict_types=1);

use App\Http\Controllers\Api\ClientDeliveryController;
use App\Http\Middleware\EnsureInfraVisibleRole;
use App\Models\NpvPrototype;
use App\Models\Server;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// Tarifs FCFA publics & canaux Mobile Money (seules informations publiques visibles côté client)
Route::get('/v1/client/plans', [ClientDeliveryController::class, 'catalog']);
Route::get('/v1/client/payment-channels', [ClientDeliveryController::class, 'paymentChannels']);

// Endpoint appelé par l'application Android JUST TECH VPN (avec connexion internet)
Route::post('/v1/cloud-config/{code}', [ClientDeliveryController::class, 'resolveCloudCodeForAndroidApp'])
    ->middleware('throttle:30,1');

// Espace Client authentifié : contrôle Free Test + choix Android (Code Cloud) vs iPhone (NPV Tunnel)
Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function (): void {
    Route::post('/v1/client/free-test/claim', [ClientDeliveryController::class, 'claimFreeTest']);
    Route::post('/v1/client/delivery/android', [ClientDeliveryController::class, 'issueAndroidCloudCode']);
    Route::get('/v1/client/delivery/iphone', [ClientDeliveryController::class, 'downloadIphoneNpv']);
});

// Routes Serveurs & Prototypes : strictement limitées Super Admin / Revendeur / Sous-revendeur
Route::middleware(['auth:sanctum', EnsureInfraVisibleRole::class])->group(function (): void {
    Route::get('/v1/infra/servers', static fn () => response()->json([
        'servers' => Server::query()->where('is_active', true)->get(['id', 'name', 'region_code', 'hostname', 'active_connections', 'max_connections']),
    ]));

    Route::get('/v1/infra/npv-prototype', static fn () => response()->json([
        'prototype' => NpvPrototype::query()->where('is_active', true)->latest('id')->first(),
    ]));

    Route::post('/v1/infra/npv-prototype', static function (Request $request) {
        abort_unless($request->user()->role->value === 'super_admin', 403);
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'version' => ['required', 'string', 'max:24'],
            'file_extension' => ['required', 'in:.npvt,.json'],
            'raw_template' => ['required', 'string'],
        ]);

        NpvPrototype::query()->where('is_active', true)->update(['is_active' => false]);
        $proto = NpvPrototype::create([
            ...$validated,
            'is_active' => true,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['prototype' => $proto], 201);
    });
});
