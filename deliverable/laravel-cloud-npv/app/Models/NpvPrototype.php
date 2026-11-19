<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NpvPrototype extends Model
{
    protected $fillable = [
        'name',
        'version',
        'file_extension',
        'raw_template',
        'is_active',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
