<?php

declare(strict_types=1);

namespace App\Services\Billing;

use Illuminate\Support\Facades\Cache;

/**
 * Passerelle Mobile Money Cameroun + Bascule automatique Plafond Orange -> OM ASSO 1017614.
 */
class MobileMoneyGatewayService
{
    public function getCheckoutChannels(): array
    {
        $orangeVolume = (int) Cache::get('jts:orange_monthly_volume_fcfa', 0);
        $orangeCeiling = (int) config('services.jts_mobile_money.orange_ceiling_fcfa', 1500000);
        $ceilingReached = (bool) Cache::get('jts:orange_ceiling_forced', false) || $orangeVolume >= $orangeCeiling;

        return [
            'mtn_momo' => [
                'label' => 'MTN Mobile Money',
                'beneficiary' => env('MTN_MOMO_BENEFICIARY', 'Sidonie Fouda'),
                'number' => env('MTN_MOMO_NUMBER', '+237 681057710'),
                'active' => true,
            ],
            'orange_money' => [
                'label' => 'Orange Money',
                'beneficiary' => env('ORANGE_MONEY_BENEFICIARY', 'CELINE TSEGUI FOPA'),
                'number' => env('ORANGE_MONEY_NUMBER', '+237 698057856'),
                'ceiling_reached' => $ceilingReached,
                'active' => !$ceilingReached,
            ],
            'orange_merchant_fallback' => [
                'label' => 'Paiement Marchand Orange (OM ASSO)',
                'code' => env('ORANGE_MERCHANT_OM_ASSO', '1017614'),
                'ussd' => '#150*47*' . env('ORANGE_MERCHANT_OM_ASSO', '1017614') . '#',
                'recommended' => $ceilingReached,
            ],
        ];
    }
}
