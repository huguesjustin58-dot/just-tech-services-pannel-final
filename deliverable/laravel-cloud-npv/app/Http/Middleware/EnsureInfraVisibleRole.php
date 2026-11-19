<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Enums\UserRole;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restreint strictement la visibilité des serveurs, IPs, configurations et prototypes NPV
 * au Super Admin, aux Revendeurs et aux Sous-revendeurs (jamais aux Clients).
 */
class EnsureInfraVisibleRole
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || ! in_array($user->role, [
            UserRole::SUPER_ADMIN,
            UserRole::ADMIN,
            UserRole::RESELLER,
            UserRole::SUB_RESELLER,
        ], true)) {
            abort(403, 'Accès réservé au Super Admin, Revendeurs et Sous-revendeurs.');
        }

        return $next($request);
    }
}
