import crypto from 'crypto';
import QRCode from 'qrcode';

export type VpnProtocolKey = 'ssh' | 'ssh_wss' | 'ssh_slowdns';

export interface PassQuotaInput {
  planId: string;
  planName: string;
  clientName: string;
  dataQuotaGb: number;
  dataUsedGb?: number;
  durationHours: number;
  expiresAt?: string;
  maxSessions: number;
  serverCode?: string;
  serverHost?: string;
  sshUsername: string;
  sshPassword: string;
  licenseStatus?: string;
}

export interface CloudQuotaSnapshot {
  totalGb: number;
  usedGb: number;
  remainingGb: number;
  totalBytes: number;
  usedBytes: number;
  remainingBytes: number;
  usagePercent: number;
  exhausted: boolean;
}

export interface InternalCloudBundleRecord {
  code: string;
  exchangeToken: string;
  tokenExpiresAt: string;
  importUri: string;
  qrDataUrl: string;
  clientName: string;
  planId: string;
  planName: string;
  serverCode: string;
  host: string;
  ports: { ssh: number; wss: number; slowdns: number };
  slowDnsNs: string;
  slowDnsPubKey: string;
  operationalProtocols: VpnProtocolKey[];
  quotaTotalGb: number;
  quotaUsedGb: number;
  maxSessions: number;
  expiresAt: string;
  status: 'Prêt' | 'Activé sur appareil' | 'Révoqué';
  deviceId?: string;
  activatedDevice?: string;
  sshUsername: string;
  sshPassword: string;
  createdAt: string;
}

export interface PublicCloudBundleResponse {
  code: string;
  importUri: string;
  exchangeToken: string;
  tokenExpiresAt: string;
  qrDataUrl: string;
  clientName: string;
  planId: string;
  planName: string;
  serverCode: string;
  serverHost: string;
  maxSessions: number;
  expiresAt: string;
  status: 'Prêt' | 'Activé sur appareil' | 'Quota épuisé' | 'Expiré' | 'Révoqué';
  activatedDevice?: string;
  operationalProtocols: VpnProtocolKey[];
  quota: CloudQuotaSnapshot;
  npvtFilename: string;
  publicJsonManifest: Record<string, unknown>;
  secretsRedacted: true;
  createdAt: string;
}

const BYTES_PER_GB = 1024 * 1024 * 1024;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h opaque short-lived exchange token

const SERVER_NODES_MAP: Record<string, { host: string; ssh: number; wss: number; slowdns: number }> = {
  'VPS-CM-01': { host: 'vps1.justtechservices.xyz', ssh: 22, wss: 443, slowdns: 53 },
  'VPS-FR-02': { host: 'vps2.justtechservices.xyz', ssh: 22, wss: 443, slowdns: 53 },
  'VPS-DE-03': { host: 'vps3.justtechservices.xyz', ssh: 22, wss: 443, slowdns: 53 },
};

function computeQuotaSnapshot(totalGbRaw: number, usedGbRaw: number): CloudQuotaSnapshot {
  const totalGb = Math.max(0, Number(totalGbRaw) || 0);
  const usedGb = Math.max(0, Math.min(totalGb > 0 ? totalGb : Number.MAX_SAFE_INTEGER, Number(usedGbRaw) || 0));
  const remainingGb = Math.max(0, Number((totalGb - usedGb).toFixed(2)));
  const totalBytes = Math.round(totalGb * BYTES_PER_GB);
  const usedBytes = Math.round(usedGb * BYTES_PER_GB);
  const remainingBytes = Math.max(0, totalBytes - usedBytes);
  const usagePercent = totalGb > 0 ? Math.min(100, Math.round((usedGb / totalGb) * 100)) : 100;
  return {
    totalGb,
    usedGb: Number(usedGb.toFixed(2)),
    remainingGb,
    totalBytes,
    usedBytes,
    remainingBytes,
    usagePercent,
    exhausted: totalGb <= 0 || remainingBytes <= 0,
  };
}

/**
 * Garde de sécurité absolue : garantit qu'aucun mot de passe SSH, aucune clé privée PEM/OpenSSH
 * ni aucun identifiant sensible ne peut être sérialisé dans un QR code, un lien public URI
 * ou un manifeste JSON public. Seuls `cloud_code` et `import_token` révocables sont autorisés.
 */
function assertZeroSecretsInPublicSurface(
  serializedPublicText: string,
  secretValues: string[]
): void {
  const forbiddenPatterns = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
    /OPENSSH PRIVATE KEY/i,
    /[?&](?:ssh_?password|password|pass|private_?key|privkey)=/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serializedPublicText)) {
      throw new Error(
        'Violation sécurité bloquée : détection de mot de passe ou clé privée dans une surface publique (QR/URI/JSON).'
      );
    }
  }

  for (const secret of secretValues) {
    if (secret.length >= 4) {
      const encoded = encodeURIComponent(secret);
      if (
        serializedPublicText.includes(secret) ||
        (encoded.length >= 4 && serializedPublicText.includes(encoded))
      ) {
        throw new Error(
          'Violation sécurité bloquée : tentative d’exposition d’un secret sensible dans une surface publique (QR/URI/JSON).'
        );
      }
    }
  }
}

export class CloudConfigEngine {
  private readonly store = new Map<string, InternalCloudBundleRecord>();
  private readonly signingSecret: string;

  constructor() {
    const configuredSecret = process.env.JTS_MOBILE_CONTRACT_SECRET;
    if (process.env.NODE_ENV === 'production' && (!configuredSecret || configuredSecret.length < 64)) {
      throw new Error('JTS_MOBILE_CONTRACT_SECRET must be configured with at least 64 characters in production.');
    }
    this.signingSecret = configuredSecret || crypto.randomBytes(32).toString('hex');
  }

  public get size(): number {
    return this.store.size;
  }

  public getInternal(code: string): InternalCloudBundleRecord | undefined {
    return this.store.get(code.toUpperCase().trim());
  }

  public listPublicBundles(): PublicCloudBundleResponse[] {
    return Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((rec) => this.toPublicBundle(rec));
  }

  private signObject(issuedAt: string, payload: Record<string, unknown>): string {
    return crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${issuedAt}.${JSON.stringify(payload)}`)
      .digest('hex');
  }

  private resolveEffectiveStatus(
    rec: InternalCloudBundleRecord
  ): 'Prêt' | 'Activé sur appareil' | 'Quota épuisé' | 'Expiré' | 'Révoqué' {
    if (rec.status === 'Révoqué') return 'Révoqué';
    if (new Date(rec.expiresAt).getTime() <= Date.now()) return 'Expiré';
    const quota = computeQuotaSnapshot(rec.quotaTotalGb, rec.quotaUsedGb);
    if (quota.exhausted) return 'Quota épuisé';
    return rec.status;
  }

  private buildZeroSecretManifest(rec: InternalCloudBundleRecord): Record<string, unknown> {
    const quota = computeQuotaSnapshot(rec.quotaTotalGb, rec.quotaUsedGb);
    const sshEnabled = rec.operationalProtocols.includes('ssh');
    const wssEnabled = rec.operationalProtocols.includes('ssh_wss');
    const slowDnsEnabled = rec.operationalProtocols.includes('ssh_slowdns');
    const issuedAt = new Date().toISOString();

    const core = {
      schema_version: '2.0',
      app_target: 'JUST_TECH_SERVICES_TUNNEL',
      manifest_type: 'public_cloud_reference',
      cloud_code: rec.code,
      code: rec.code,
      import_uri: rec.importUri,
      exchange_endpoint: `/api/v1/cloud-config/${rec.code}`,
      exchange_method: 'POST',
      token_revocable: true,
      token_expires_at: rec.tokenExpiresAt,
      pass: {
        plan_id: rec.planId,
        plan_name: rec.planName,
        status: this.resolveEffectiveStatus(rec),
        expires_at: rec.expiresAt,
        max_sessions: rec.maxSessions,
      },
      quota: {
        total_gb: quota.totalGb,
        used_gb: quota.usedGb,
        remaining_gb: quota.remainingGb,
        total_bytes: quota.totalBytes,
        used_bytes: quota.usedBytes,
        remaining_bytes: quota.remainingBytes,
        usage_percent: quota.usagePercent,
      },
      server: {
        code: rec.serverCode,
        hostname: rec.host,
        operational_protocols: rec.operationalProtocols,
      },
      tunnels: {
        ssh: { enabled: sshEnabled, host: sshEnabled ? rec.host : null, port: sshEnabled ? rec.ports.ssh : null },
        ssh_wss: {
          enabled: wssEnabled,
          host: wssEnabled ? rec.host : null,
          port: wssEnabled ? rec.ports.wss : null,
          sni: wssEnabled ? rec.host : null,
          ws_path: wssEnabled ? '/wss' : null,
          tls: wssEnabled,
        },
        ssh_slowdns: {
          enabled: slowDnsEnabled,
          dns_port: slowDnsEnabled ? rec.ports.slowdns : null,
          nameserver: slowDnsEnabled ? rec.slowDnsNs : null,
          public_key: slowDnsEnabled ? rec.slowDnsPubKey : null,
        },
      },
      credentials: {
        delivery: 'POST_DEVICE_BOUND_EXCHANGE_ONLY',
        ssh_password_redacted: true,
        private_key_redacted: true,
        redacted: true,
      },
    };

    const manifest = {
      ...core,
      integrity: {
        issued_at: issuedAt,
        signature_hmac_sha256: this.signObject(issuedAt, core),
      },
    };

    // Vérification stricte anti-fuite de secret avant retour
    assertZeroSecretsInPublicSurface(JSON.stringify(manifest), [rec.sshPassword, rec.sshUsername]);
    return manifest;
  }

  public toPublicBundle(rec: InternalCloudBundleRecord): PublicCloudBundleResponse {
    const quota = computeQuotaSnapshot(rec.quotaTotalGb, rec.quotaUsedGb);
    const safeClientSlug = rec.clientName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 18) || 'client';

    return {
      code: rec.code,
      importUri: rec.importUri,
      exchangeToken: rec.exchangeToken,
      tokenExpiresAt: rec.tokenExpiresAt,
      qrDataUrl: rec.qrDataUrl,
      clientName: rec.clientName,
      planId: rec.planId,
      planName: rec.planName,
      serverCode: rec.serverCode,
      serverHost: rec.host,
      maxSessions: rec.maxSessions,
      expiresAt: rec.expiresAt,
      status: this.resolveEffectiveStatus(rec),
      activatedDevice: rec.activatedDevice,
      operationalProtocols: [...rec.operationalProtocols],
      quota,
      npvtFilename: `justtech-${safeClientSlug}-${rec.code.toLowerCase()}.npvt`,
      publicJsonManifest: this.buildZeroSecretManifest(rec),
      secretsRedacted: true,
      createdAt: rec.createdAt,
    };
  }

  public async issueBundle(input: PassQuotaInput): Promise<
    | { ok: true; bundle: PublicCloudBundleResponse; internal: InternalCloudBundleRecord }
    | { ok: false; status: number; error: string }
  > {
    const normalizedStatus = (input.licenseStatus || 'Active').toLowerCase();
    if (
      normalizedStatus.includes('révoq') ||
      normalizedStatus.includes('suspend') ||
      normalizedStatus.includes('expir')
    ) {
      return {
        ok: false,
        status: 422,
        error: `Impossible de générer une configuration Cloud : le pass est en statut "${input.licenseStatus}".`,
      };
    }

    const quota = computeQuotaSnapshot(input.dataQuotaGb, input.dataUsedGb ?? 0);
    if (quota.exhausted) {
      return {
        ok: false,
        status: 422,
        error: `Quota client épuisé (${quota.usedGb} / ${quota.totalGb} Go). Renouvelez le pass avant de générer une configuration.`,
      };
    }

    const expiresAt =
      input.expiresAt && !Number.isNaN(Date.parse(input.expiresAt))
        ? new Date(input.expiresAt).toISOString()
        : new Date(Date.now() + Math.max(1, input.durationHours) * 3600 * 1000).toISOString();

    if (new Date(expiresAt).getTime() <= Date.now()) {
      return {
        ok: false,
        status: 422,
        error: 'Ce pass client est expiré. Renouvelez-le avant de générer une configuration Cloud.',
      };
    }

    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `JTS-CLD-${part1}-${part2}`;
    const exchangeToken = `jts_tok_${crypto.randomBytes(18).toString('hex')}`;
    const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const params = new URLSearchParams({
      cloud_code: code,
      import_token: exchangeToken,
      endpoint: '/api/v1/cloud-config',
      v: '2.0',
    });
    const importUri = `jts-tunnel://cloud?${params.toString()}`;

    // Garde absolue : le lien public et le QR code ne contiennent QUE cloud_code + import_token révocable (zéro mot de passe / zéro clé privée)
    assertZeroSecretsInPublicSurface(importUri, [input.sshPassword, input.sshUsername]);

    const qrDataUrl = await QRCode.toDataURL(importUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: {
        dark: '#F2F6FF',
        light: '#070B14',
      },
    });

    const serverCode = input.serverCode || 'VPS-CM-01';
    const node = SERVER_NODES_MAP[serverCode] ?? {
      host: input.serverHost || 'vps1.justtechservices.xyz',
      ssh: 22,
      wss: 443,
      slowdns: 53,
    };

    const slowDnsNs = process.env.JTS_SLOWDNS_NS_DOMAIN || '';
    const slowDnsPubKey =
      process.env.JTS_SLOWDNS_PUBKEY || '';
    const operationalProtocols: VpnProtocolKey[] = ['ssh', 'ssh_wss'];
    if (slowDnsNs && slowDnsPubKey) {
      operationalProtocols.push('ssh_slowdns');
    }

    const internal: InternalCloudBundleRecord = {
      code,
      exchangeToken,
      tokenExpiresAt,
      importUri,
      qrDataUrl,
      clientName: input.clientName,
      planId: input.planId,
      planName: input.planName,
      serverCode,
      host: input.serverHost || node.host,
      ports: { ssh: node.ssh, wss: node.wss, slowdns: node.slowdns },
      slowDnsNs,
      slowDnsPubKey,
      operationalProtocols,
      quotaTotalGb: quota.totalGb,
      quotaUsedGb: quota.usedGb,
      maxSessions: Math.max(1, input.maxSessions),
      expiresAt,
      status: 'Prêt',
      sshUsername: input.sshUsername,
      sshPassword: input.sshPassword,
      createdAt: new Date().toISOString(),
    };

    this.store.set(code, internal);
    return {
      ok: true,
      bundle: this.toPublicBundle(internal),
      internal,
    };
  }

  public updateQuota(
    code: string,
    usedGb: number,
    totalGb?: number
  ): PublicCloudBundleResponse | null {
    const rec = this.store.get(code.toUpperCase().trim());
    if (!rec) return null;
    if (typeof totalGb === 'number' && totalGb > 0) {
      rec.quotaTotalGb = totalGb;
    }
    rec.quotaUsedGb = Math.max(0, Number(usedGb) || 0);
    return this.toPublicBundle(rec);
  }

  public revoke(code: string): PublicCloudBundleResponse | null {
    const rec = this.store.get(code.toUpperCase().trim());
    if (!rec) return null;
    rec.status = 'Révoqué';
    return this.toPublicBundle(rec);
  }

  /**
   * Échange sécurisé par l'application mobile (POST uniquement, lié au device_id,
   * vérification quota restant, expiration, révocation et token courte durée si fourni).
   */
  public redeemForDevice(
    code: string,
    deviceId: string,
    options?: { deviceName?: string; token?: string }
  ): { ok: true; payload: Record<string, unknown> } | { ok: false; status: number; error: string; code: string } {
    const cleanDevice = deviceId.trim();
    if (cleanDevice.length < 6) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_DEVICE_ID',
        error: 'Identifiant appareil (device_id) requis (6 caractères minimum).',
      };
    }

    const entry = this.store.get(code.toUpperCase().trim());
    if (!entry || entry.status === 'Révoqué') {
      return {
        ok: false,
        status: 404,
        code: 'CLOUD_CODE_REVOKED_OR_NOT_FOUND',
        error: 'Code Cloud introuvable ou révoqué.',
      };
    }

    if (options?.token) {
      const tokenBuf = Buffer.from(options.token);
      const expectedBuf = Buffer.from(entry.exchangeToken);
      if (
        tokenBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(tokenBuf, expectedBuf)
      ) {
        return {
          ok: false,
          status: 403,
          code: 'INVALID_EXCHANGE_TOKEN',
          error: "Jeton d'échange Cloud invalide.",
        };
      }
      if (new Date(entry.tokenExpiresAt).getTime() <= Date.now()) {
        return {
          ok: false,
          status: 410,
          code: 'EXCHANGE_TOKEN_EXPIRED',
          error: "Le jeton d'échange temporaire a expiré. Régénérez un lien depuis le portail.",
        };
      }
    }

    if (new Date(entry.expiresAt).getTime() <= Date.now()) {
      return {
        ok: false,
        status: 410,
        code: 'PASS_EXPIRED',
        error: 'Ce pass client a expiré.',
      };
    }

    const quota = computeQuotaSnapshot(entry.quotaTotalGb, entry.quotaUsedGb);
    if (quota.exhausted) {
      return {
        ok: false,
        status: 403,
        code: 'QUOTA_EXHAUSTED',
        error: `Quota data épuisé (${quota.usedGb}/${quota.totalGb} Go). Renouvelez votre pass.`,
      };
    }

    if (entry.deviceId && entry.deviceId !== cleanDevice) {
      return {
        ok: false,
        status: 403,
        code: 'DEVICE_MISMATCH',
        error: 'Ce Code Cloud est déjà lié à un autre appareil.',
      };
    }

    entry.status = 'Activé sur appareil';
    entry.deviceId = entry.deviceId ?? cleanDevice;
    entry.activatedDevice = options?.deviceName || 'JUST TECH SERVICES TUNNEL';

    const sshEnabled = entry.operationalProtocols.includes('ssh');
    const wssEnabled = entry.operationalProtocols.includes('ssh_wss');
    const slowDnsEnabled = entry.operationalProtocols.includes('ssh_slowdns');
    const issuedAt = new Date().toISOString();

    const core = {
      schema_version: '2.0',
      app_target: 'JUST_TECH_SERVICES_TUNNEL',
      status: 'ok',
      activation: {
        code: entry.code,
        plan_code: entry.planId,
        plan_name: entry.planName,
        expires_at: entry.expiresAt,
        quota_bytes: quota.totalBytes,
        quota_used_bytes: quota.usedBytes,
        quota_remaining_bytes: quota.remainingBytes,
        quota_usage_percent: quota.usagePercent,
        max_sessions: entry.maxSessions,
        device_bound: true,
      },
      server: {
        code: entry.serverCode,
        hostname: entry.host,
        operational_protocols: entry.operationalProtocols,
      },
      tunnels: {
        ssh: {
          enabled: sshEnabled,
          host: sshEnabled ? entry.host : null,
          port: sshEnabled ? entry.ports.ssh : null,
        },
        ssh_wss: {
          enabled: wssEnabled,
          host: wssEnabled ? entry.host : null,
          port: wssEnabled ? entry.ports.wss : null,
          sni: wssEnabled ? entry.host : null,
          ws_path: wssEnabled ? '/wss' : null,
          tls: wssEnabled,
        },
        ssh_slowdns: {
          enabled: slowDnsEnabled,
          dns_port: slowDnsEnabled ? entry.ports.slowdns : null,
          nameserver: slowDnsEnabled ? entry.slowDnsNs : null,
          public_key: slowDnsEnabled ? entry.slowDnsPubKey : null,
        },
      },
      credentials: {
        username: entry.sshUsername,
        password: entry.sshPassword,
      },
    };

    return {
      ok: true,
      payload: {
        ...core,
        integrity: {
          issued_at: issuedAt,
          signature_hmac_sha256: this.signObject(issuedAt, core),
        },
      },
    };
  }

  /**
   * Compile le fichier .npvt privé pour téléchargement direct POST (jamais dans un QR ou URL publique),
   * enrichi des métadonnées réelles du pass et du quota client restant.
   */
  public compilePrivateNpvt(
    code: string,
    rawPrototype: string,
    token?: string
  ):
    | { ok: true; filename: string; content: string }
    | { ok: false; status: number; error: string } {
    const entry = this.store.get(code.toUpperCase().trim());
    if (!entry || entry.status === 'Révoqué') {
      return { ok: false, status: 404, error: 'Code Cloud introuvable ou révoqué.' };
    }

    if (token) {
      const tBuf = Buffer.from(token);
      const eBuf = Buffer.from(entry.exchangeToken);
      if (tBuf.length !== eBuf.length || !crypto.timingSafeEqual(tBuf, eBuf)) {
        return { ok: false, status: 403, error: "Jeton de téléchargement .npvt invalide." };
      }
    }

    const quota = computeQuotaSnapshot(entry.quotaTotalGb, entry.quotaUsedGb);
    if (quota.exhausted) {
      return {
        ok: false,
        status: 403,
        error: `Quota client épuisé (${quota.usedGb}/${quota.totalGb} Go) : téléchargement .npvt bloqué.`,
      };
    }
    if (new Date(entry.expiresAt).getTime() <= Date.now()) {
      return { ok: false, status: 410, error: 'Pass expiré : téléchargement .npvt bloqué.' };
    }

    let content: string;
    try {
      const parsed = JSON.parse(rawPrototype) as Record<string, unknown>;
      const clone = structuredClone(parsed);

      const replaceCreds = (obj: Record<string, unknown>) => {
        for (const key of Object.keys(obj)) {
          const lower = key.toLowerCase();
          const val = obj[key];
          if (typeof val === 'string') {
            if (lower === 'sshusername' || lower === 'ssh_username' || lower === 'username' || lower === 'user') {
              obj[key] = entry.sshUsername;
            } else if (lower === 'sshpassword' || lower === 'ssh_password' || lower === 'password' || lower === 'pass') {
              obj[key] = entry.sshPassword;
            } else if (lower === 'payload' || lower === 'http_payload' || lower === 'httppayload') {
              // Préservation 100 % brute du Payload HTTP (\r\n, espaces, [host], [crlf], [split], [ua]) — jamais de .trim()
              obj[key] = val;
            } else {
              obj[key] = val
                .replace(/\{\{SSH_USERNAME\}\}/g, entry.sshUsername)
                .replace(/\{\{SSH_PASSWORD\}\}/g, entry.sshPassword);
            }
          } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            replaceCreds(val as Record<string, unknown>);
          }
        }
      };

      replaceCreds(clone);
      if (!('sshUsername' in clone) && !('username' in clone)) clone.sshUsername = entry.sshUsername;
      if (!('sshPassword' in clone) && !('password' in clone)) clone.sshPassword = entry.sshPassword;
      clone.sshHost = entry.host;
      clone.sshPort = entry.ports.ssh;
      clone.wssPort = entry.ports.wss;
      clone.issuedFor = entry.clientName;
      clone.jtsPassMetadata = {
        cloudCode: entry.code,
        planId: entry.planId,
        planName: entry.planName,
        quotaTotalGb: quota.totalGb,
        quotaUsedGb: quota.usedGb,
        quotaRemainingGb: quota.remainingGb,
        maxSessions: entry.maxSessions,
        expiresAt: entry.expiresAt,
      };
      content = JSON.stringify(clone, null, 2);
    } catch {
      // Mode brut (Payload HTTP / texte brut) : préservation 100 % intégrale sans .trim()
      content = rawPrototype
        .replace(/\{\{SSH_USERNAME\}\}/g, entry.sshUsername)
        .replace(/\{\{SSH_PASSWORD\}\}/g, entry.sshPassword);
    }

    const pub = this.toPublicBundle(entry);
    return { ok: true, filename: pub.npvtFilename, content };
  }
}
