<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;
use Throwable;

class VpnSshException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $serverHost = '',
        public readonly ?string $command = null,
        public readonly ?int $exitCode = null,
        int $code = 0,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, $code, $previous);
    }

    public static function authenticationFailed(string $host, string $reason): self
    {
        return new self(
            message: "Échec d'authentification SSH sécurisée sur {$host} : {$reason}",
            serverHost: $host,
            code: 401,
        );
    }

    public static function hostKeyMismatch(string $host, string $expected, string $actual): self
    {
        return new self(
            message: "Empreinte de clé hôte SSH invalide sur {$host} (attendue: {$expected}, reçue: {$actual}).",
            serverHost: $host,
            code: 403,
        );
    }

    public static function invalidUsername(string $username): self
    {
        return new self(
            message: "Nom d'utilisateur Linux invalide ou interdit : '{$username}'.",
            code: 422,
        );
    }

    public static function commandFailed(string $host, string $command, int $exitCode, string $stderr): self
    {
        return new self(
            message: "Commande SSH échouée sur {$host} (exit {$exitCode}) : {$stderr}",
            serverHost: $host,
            command: $command,
            exitCode: $exitCode,
            code: 500,
        );
    }
}
