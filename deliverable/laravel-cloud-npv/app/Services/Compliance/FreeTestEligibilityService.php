<?php

declare(strict_types=1);

namespace App\Services\Compliance;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Contrôle anti-abus strict pour l'Offre Test Gratuit (3 Go / 2 heures) :
 * - Un même appareil (device_fingerprint) ne peut effectuer ni activer le test qu'1 seule fois.
 * - Un compte client ne peut générer que 2 codes tests gratuits maximum sur la plateforme.
 */
class FreeTestEligibilityService
{
    public const MAX_PER_DEVICE = 1;
    public const MAX_PER_ACCOUNT = 2;

    public function assertEligibleAndRecord(User $client, string $deviceFingerprint, string $platform): void
    {
        $cleanFingerprint = trim($deviceFingerprint);
        if ($cleanFingerprint === '') {
            throw ValidationException::withMessages([
                'device_fingerprint' => 'Empreinte appareil requise pour activer le test gratuit.',
            ]);
        }

        DB::transaction(function () use ($client, $cleanFingerprint, $platform): void {
            $deviceUsed = DB::table('free_test_claims')
                ->where('device_fingerprint', $cleanFingerprint)
                ->lockForUpdate()
                ->exists();

            if ($deviceUsed) {
                throw ValidationException::withMessages([
                    'device_fingerprint' => 'Cet appareil a déjà effectué ou activé un test gratuit (1 seule fois max).',
                ]);
            }

            $accountCount = DB::table('free_test_claims')
                ->where('user_id', $client->id)
                ->lockForUpdate()
                ->count();

            if ($accountCount >= self::MAX_PER_ACCOUNT) {
                throw ValidationException::withMessages([
                    'account' => 'Ce compte client a atteint le plafond de 2 générations de code test.',
                ]);
            }

            DB::table('free_test_claims')->insert([
                'user_id' => $client->id,
                'device_fingerprint' => $cleanFingerprint,
                'platform' => $platform,
                'activated_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }
}
