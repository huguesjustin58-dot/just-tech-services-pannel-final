<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\License;
use App\Models\Plan;
use App\Services\Billing\MobileMoneyGatewayService;
use App\Services\Compliance\FreeTestEligibilityService;
use App\Services\Config\AndroidCloudConfigService;
use App\Services\Config\NpvPrototypeCompilerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Contrôleur Client strictement cloisonné :
 * - Le client voit uniquement les tarifs FCFA (plans), les canaux Mobile Money et son propre abonnement.
 * - Aucun serveur, IP ou prototype brut n'est exposé au client.
 * - Après paiement, le client choisit Android (Code Cloud) ou iPhone (NPV Tunnel compilé).
 */
class ClientDeliveryController extends Controller
{
    public function catalog(): JsonResponse
    {
        $plans = Plan::query()
            ->where('is_active', true)
            ->orderBy('price_fcfa')
            ->get(['id', 'code', 'name', 'price_fcfa', 'duration_days', 'quota_gb', 'max_concurrent_sessions', 'is_vip']);

        return response()->json(['plans' => $plans]);
    }

    public function paymentChannels(MobileMoneyGatewayService $gateway): JsonResponse
    {
        return response()->json($gateway->getCheckoutChannels());
    }

    public function claimFreeTest(Request $request, FreeTestEligibilityService $eligibility): JsonResponse
    {
        $validated = $request->validate([
            'device_fingerprint' => ['required', 'string', 'max:120'],
            'platform' => ['required', 'in:android,iphone'],
        ]);

        $eligibility->assertEligibleAndRecord(
            client: $request->user(),
            deviceFingerprint: $validated['device_fingerprint'],
            platform: $validated['platform'],
        );

        return response()->json([
            'approved' => true,
            'plan_code' => 'free_test_3go_2h',
            'platform' => $validated['platform'],
        ]);
    }

    public function issueAndroidCloudCode(Request $request, AndroidCloudConfigService $cloudService): JsonResponse
    {
        $license = License::query()
            ->where('user_id', $request->user()->id)
            ->latest('id')
            ->firstOrFail();

        $cloudCode = $cloudService->issueForLicense($license);

        return response()->json([
            'platform' => 'android',
            'cloud_code' => $cloudCode->code,
            'expires_at' => $cloudCode->expires_at->toIso8601String(),
            'instructions' => "Ouvrez l'application Android JUST TECH VPN avec une connexion internet et saisissez ce code.",
        ]);
    }

    public function downloadIphoneNpv(Request $request, NpvPrototypeCompilerService $npvCompiler): Response
    {
        $license = License::query()
            ->where('user_id', $request->user()->id)
            ->latest('id')
            ->firstOrFail();

        $compiled = $npvCompiler->compileForClient($license);

        return response($compiled['content'], 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="'.$compiled['filename'].'"',
        ]);
    }

    public function resolveCloudCodeForAndroidApp(Request $request, string $code, AndroidCloudConfigService $cloudService): JsonResponse
    {
        $payload = $cloudService->redeemCloudCode(
            code: $code,
            deviceName: $request->input('device_name'),
            clientIp: $request->ip(),
        );

        return response()->json($payload);
    }
}
