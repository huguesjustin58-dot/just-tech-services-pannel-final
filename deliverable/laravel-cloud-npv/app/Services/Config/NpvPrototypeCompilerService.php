<?php

declare(strict_types=1);

namespace App\Services\Config;

use App\Models\License;
use App\Models\NpvPrototype;
use Illuminate\Support\Facades\Crypt;
use RuntimeException;

class NpvPrototypeCompilerService
{
    private const USERNAME_KEYS = ['sshusername', 'ssh_username', 'username', 'user'];
    private const PASSWORD_KEYS = ['sshpassword', 'ssh_password', 'password', 'pass'];

    /**
     * Compile le fichier NPV Tunnel iPhone à partir du prototype actif fourni par le Super Admin.
     * Règle stricte : seuls le nom d'utilisateur SSH et le mot de passe du client sont substitués.
     *
     * @return array{filename: string, content: string, prototype_version: string}
     */
    public function compileForClient(License $license, ?NpvPrototype $prototype = null): array
    {
        $prototype ??= NpvPrototype::query()
            ->where('is_active', true)
            ->latest('id')
            ->first();

        if (! $prototype) {
            throw new RuntimeException('Aucun prototype NPV Tunnel iPhone actif configuré par le Super Administrateur.');
        }

        $sshUser = $license->vpn_username;
        $sshPass = Crypt::decryptString($license->vpn_password_encrypted);
        $raw = trim($prototype->raw_template);

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $compiled = $this->replaceCredentialsRecursive($decoded, $sshUser, $sshPass);
            if (! array_key_exists('sshUsername', $compiled) && ! array_key_exists('username', $compiled)) {
                $compiled['sshUsername'] = $sshUser;
            }
            if (! array_key_exists('sshPassword', $compiled) && ! array_key_exists('password', $compiled)) {
                $compiled['sshPassword'] = $sshPass;
            }
            $content = json_encode($compiled, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } else {
            // Support des prototypes NPV texte/encodés contenant marqueurs ou paires JSON partielles
            $content = str_replace(
                ['{{SSH_USERNAME}}', '{{SSH_PASSWORD}}'],
                [$sshUser, $sshPass],
                $raw,
            );
            $content = preg_replace('/("(?:sshUsername|ssh_username|username)"\s*:\s*)"[^"]*"/i', '$1"'.$sshUser.'"', $content) ?? $content;
            $content = preg_replace('/("(?:sshPassword|ssh_password|password)"\s*:\s*)"[^"]*"/i', '$1"'.$sshPass.'"', $content) ?? $content;
        }

        $ext = str_starts_with($prototype->file_extension, '.') ? $prototype->file_extension : '.'.$prototype->file_extension;

        return [
            'filename' => "justtech-{$sshUser}-iphone{$ext}",
            'content' => $content,
            'prototype_version' => $prototype->version,
        ];
    }

    private function replaceCredentialsRecursive(array $node, string $sshUser, string $sshPass): array
    {
        foreach ($node as $key => $value) {
            if (is_array($value)) {
                $node[$key] = $this->replaceCredentialsRecursive($value, $sshUser, $sshPass);
                continue;
            }
            if (! is_string($value)) {
                continue;
            }

            $lowerKey = strtolower((string) $key);
            if (in_array($lowerKey, self::USERNAME_KEYS, true)) {
                $node[$key] = $sshUser;
            } elseif (in_array($lowerKey, self::PASSWORD_KEYS, true)) {
                $node[$key] = $sshPass;
            } else {
                $node[$key] = str_replace(['{{SSH_USERNAME}}', '{{SSH_PASSWORD}}'], [$sshUser, $sshPass], $value);
            }
        }

        return $node;
    }
}
