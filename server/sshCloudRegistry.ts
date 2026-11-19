import crypto from 'crypto';
import QRCode from 'qrcode';
import type { PublicUserRecord, SessionRole } from './authRbac.js';
import {
  BYTES_PER_GIGABYTE,
  PROTOCOL_MAP,
  SshCloudConfigV1,
  buildSshCloudConfigV1Object,
} from '../src/types/sshCloudConfig.js';

export interface CloudDistributionRecord {
  cloudCode: string;
  configId: string;
  resolveUrl: string;
  importUri: string;
  qrDataUrl: string;
  config: SshCloudConfigV1;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  ownerRole: SessionRole;
  assignedClientName: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  resolveCount: number;
  lastResolvedAt: string | null;
  lastResolvedDevice: string | null;
}

export interface PublicCloudDistributionView {
  cloudCode: string;
  configId: string;
  resolveUrl: string;
  importUri: string;
  qrDataUrl: string;
  /** Config exposée sans mot de passe/clé privée pour les vues partageables ; la valeur réelle reste en coffre serveur */
  config: SshCloudConfigV1;
  hasSecretCredentials: boolean;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  ownerRole: SessionRole;
  assignedClientName: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  resolveCount: number;
  lastResolvedAt: string | null;
  lastResolvedDevice: string | null;
}

export type ResolveCloudResult =
  | {
      ok: true;
      status: 200;
      cloudCode: string;
      resolvedAt: string;
      resolveCount: number;
      deliveryMode: 'mobile_handshake' | 'public_redacted';
      payload: SshCloudConfigV1;
    }
  | {
      ok: false;
      status: number;
      errorCode:
        | 'CLOUD_CODE_NOT_FOUND'
        | 'CLOUD_CODE_REVOKED'
        | 'CLOUD_CODE_DISABLED'
        | 'CLOUD_CODE_EXPIRED'
        | 'CLOUD_CODE_DRAFT';
      error: string;
      cloudCode: string;
      revokedAt?: string | null;
    };

const CLOUD_CODE_REGEX = /^JTS-[A-F0-9]{16}-[A-F0-9]{16}$/;

const ROLE_MAX_QUOTA_GB: Record<SessionRole, number | null> = {
  super_admin: null,
  admin: null,
  manager: 100,
  reseller: 60,
  sub_reseller: 25,
  client: 0,
};

function generateShortCloudCode(): string {
  const seg1 = crypto.randomBytes(8).toString('hex').toUpperCase();
  const seg2 = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `JTS-${seg1}-${seg2}`;
}

async function generateSecureQrDataUrl(importUri: string): Promise<string> {
  // RÈGLE ABSOLUE : le QR Code contient UNIQUEMENT l'URI opaque jts://import?code=JTS-XXXX-XXXX
  // Jamais de mot de passe SSH, jamais de clé privée.
  return QRCode.toDataURL(importUri, {
    width: 240,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#070B14',
      light: '#F2F6FF',
    },
  });
}

function buildLinks(cloudCode: string, origin: string): { resolveUrl: string; importUri: string } {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return {
    resolveUrl: `${cleanOrigin}/api/v1/cloud/resolve/${encodeURIComponent(cloudCode)}`,
    importUri: `jts://import?code=${encodeURIComponent(cloudCode)}`,
  };
}

export class SshCloudConfigRegistry {
  private readonly recordsByCode = new Map<string, CloudDistributionRecord>();
  private readonly codeByConfigId = new Map<string, string>();

  constructor() {
    if (process.env.NODE_ENV !== 'production') {
      void this.seedInitialRecords();
    }
  }

  private async seedInitialRecords(): Promise<void> {
    const now = new Date().toISOString();
    const defaultOrigin = 'https://panel.justtechservices.xyz';

    const starterWss: SshCloudConfigV1 = {
      schema_version: 1,
      provider: 'JUST_TECH_SERVICES',
      config_id: 'JTS-CFG-WSS1001',
      config_name: 'JUST TECH VIP — Douala WSS 443',
      remarks: 'Client: Franck Mbarga · Offre: NPV 20 Go (10 jours)',
      protocol: 'SSH_WSS',
      server: {
        host: 'vps1.justtechservices.xyz',
        port: 443,
        udpgw_port: 7300,
        udpgw_dns: '8.8.8.8',
      },
      proxy: { host: '', port: 0 },
      authentication: {
        type: 'password',
        username: 'jts_fmbarga92',
        password: 'Jts#SeedSecret92',
        private_key: '',
      },
      payload: {
        content:
          'GET /wss [protocol][crlf]Host: [host][crlf]User-Agent: [ua][crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]',
      },
      tls: { enabled: true, sni: 'cdn.justtechservices.xyz' },
      websocket: { enabled: true, path: '/wss' },
      slowdns: { enabled: false, nameserver: '', public_key: '', dns_server: '' },
      subscription: {
        duration: '10d',
        quota_bytes: 20 * BYTES_PER_GIGABYTE,
      },
      cloud: {
        enabled: true,
        cloud_code: 'JTS-WSS1-84A2',
        status: 'active',
      },
    };

    const starterReseller: SshCloudConfigV1 = {
      schema_version: 1,
      provider: 'JUST_TECH_SERVICES',
      config_id: 'JTS-CFG-RES2002',
      config_name: 'KmerConnect — Client Nadine T.',
      remarks: 'Client: Nadine Tchoupa · Offre: NPV 10 Go (7 jours)',
      protocol: 'SSH_SLOWDNS',
      server: {
        host: 'vps1.justtechservices.xyz',
        port: 22,
        udpgw_port: 7300,
        udpgw_dns: '8.8.8.8',
      },
      proxy: { host: '', port: 0 },
      authentication: {
        type: 'password',
        username: 'jts_ntchoupa44',
        password: 'Jts#Reseller44',
        private_key: '',
      },
      payload: { content: '' },
      tls: { enabled: false, sni: '' },
      websocket: { enabled: false, path: '' },
      slowdns: {
        enabled: true,
        nameserver: 'sdns1.justtechservices.xyz',
        public_key: '7f8b41c2e9a014d58b22e7c3a1f098e6d3b14a7c8f21e09b',
        dns_server: '8.8.8.8:53',
      },
      subscription: {
        duration: '7d',
        quota_bytes: 10 * BYTES_PER_GIGABYTE,
      },
      cloud: {
        enabled: true,
        cloud_code: 'JTS-DNS2-7F9C',
        status: 'active',
      },
    };

    const entries: Array<{
      cfg: SshCloudConfigV1;
      ownerUserId: string;
      ownerName: string;
      ownerEmail: string;
      ownerRole: SessionRole;
      client: string;
    }> = [
      {
        cfg: starterWss,
        ownerUserId: 'usr-superadmin',
        ownerName: 'Justin Hugues (Super Admin)',
        ownerEmail: (process.env.JTS_SUPERADMIN_EMAIL || 'huguesjustin58@gmail.com').toLowerCase(),
        ownerRole: 'super_admin',
        client: 'Franck Mbarga',
      },
      {
        cfg: starterReseller,
        ownerUserId: 'usr-reseller',
        ownerName: 'KamerNet Telecom (Revendeur)',
        ownerEmail: 'reseller@justtechservices.xyz',
        ownerRole: 'reseller',
        client: 'Nadine Tchoupa',
      },
    ];

    for (const item of entries) {
      const code = item.cfg.cloud.cloud_code;
      const { resolveUrl, importUri } = buildLinks(code, defaultOrigin);
      const qrDataUrl = await generateSecureQrDataUrl(importUri);
      this.recordsByCode.set(code, {
        cloudCode: code,
        configId: item.cfg.config_id,
        resolveUrl,
        importUri,
        qrDataUrl,
        config: structuredClone(item.cfg),
        ownerUserId: item.ownerUserId,
        ownerName: item.ownerName,
        ownerEmail: item.ownerEmail,
        ownerRole: item.ownerRole,
        assignedClientName: item.client,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        revokedBy: null,
        resolveCount: 0,
        lastResolvedAt: null,
        lastResolvedDevice: null,
      });
      this.codeByConfigId.set(item.cfg.config_id, code);
    }
  }

  private nextUniqueCloudCode(): string {
    for (let i = 0; i < 20; i++) {
      const candidate = generateShortCloudCode();
      if (!this.recordsByCode.has(candidate)) {
        return candidate;
      }
    }
    return `JTS-${Date.now().toString(36).slice(-4).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private canActorAccessRecord(actor: PublicUserRecord, record: CloudDistributionRecord): boolean {
    if (actor.role === 'super_admin' || actor.role === 'admin' || actor.role === 'manager') {
      return true;
    }
    if (actor.role === 'reseller') {
      return record.ownerUserId === actor.id || record.ownerRole === 'sub_reseller';
    }
    if (actor.role === 'sub_reseller') {
      return record.ownerUserId === actor.id;
    }
    return false;
  }

  public toPublicView(record: CloudDistributionRecord, origin?: string): PublicCloudDistributionView {
    const links = origin
      ? buildLinks(record.cloudCode, origin)
      : { resolveUrl: record.resolveUrl, importUri: record.importUri };

    const hasSecretCredentials = Boolean(
      record.config.authentication.password || record.config.authentication.private_key
    );

    return {
      cloudCode: record.cloudCode,
      configId: record.configId,
      resolveUrl: links.resolveUrl,
      importUri: links.importUri,
      qrDataUrl: record.qrDataUrl,
      config: buildSshCloudConfigV1Object(record.config, { redactSecrets: true }),
      hasSecretCredentials,
      ownerUserId: record.ownerUserId,
      ownerName: record.ownerName,
      ownerEmail: record.ownerEmail,
      ownerRole: record.ownerRole,
      assignedClientName: record.assignedClientName,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revokedAt: record.revokedAt,
      revokedBy: record.revokedBy,
      resolveCount: record.resolveCount,
      lastResolvedAt: record.lastResolvedAt,
      lastResolvedDevice: record.lastResolvedDevice,
    };
  }

  public listForActor(actor: PublicUserRecord, origin: string): PublicCloudDistributionView[] {
    if (actor.role === 'client') {
      return [];
    }
    return Array.from(this.recordsByCode.values())
      .filter((rec) => this.canActorAccessRecord(actor, rec))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((rec) => this.toPublicView(rec, origin));
  }

  public async upsertConfig(
    actor: PublicUserRecord,
    incoming: SshCloudConfigV1,
    options: { origin: string; assignedClientName?: string; forceNewCloudCode?: boolean }
  ): Promise<
    | { ok: true; record: PublicCloudDistributionView }
    | { ok: false; status: number; error: string; code: string }
  > {
    if (actor.role === 'client') {
      return {
        ok: false,
        status: 403,
        code: 'RBAC_FORBIDDEN',
        error: 'Le rôle Client ne peut pas créer ou publier de configuration Cloud.',
      };
    }

    if (!incoming || incoming.schema_version !== 1 || incoming.provider !== 'JUST_TECH_SERVICES') {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_SCHEMA',
        error: 'Schéma invalide : attendu schema_version: 1 et provider: "JUST_TECH_SERVICES".',
      };
    }

    if (!(incoming.protocol in PROTOCOL_MAP)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_PROTOCOL',
        error: `Protocole inconnu : ${String(incoming.protocol)}.`,
      };
    }

    // Garde-fou quota RBAC côté serveur (Reseller <= 60 Go, Sub Reseller <= 25 Go, Manager <= 100 Go)
    const maxQuotaGb = ROLE_MAX_QUOTA_GB[actor.role];
    const requestedBytes = Math.max(0, Number(incoming.subscription?.quota_bytes) || 0);
    if (maxQuotaGb !== null && requestedBytes > maxQuotaGb * BYTES_PER_GIGABYTE) {
      return {
        ok: false,
        status: 403,
        code: 'RBAC_QUOTA_EXCEEDED',
        error: `Plafond RBAC dépassé : votre rôle (${actor.role}) est limité à ${maxQuotaGb} Go par configuration.`,
      };
    }

    const assignedClient = (options.assignedClientName || '').trim();
    if ((actor.role === 'reseller' || actor.role === 'sub_reseller') && !assignedClient) {
      return {
        ok: false,
        status: 400,
        code: 'CLIENT_ATTRIBUTION_REQUIRED',
        error: 'Un revendeur / sous-revendeur doit attribuer la configuration à un de ses clients.',
      };
    }

    // Vérifier si une config existante avec le même config_id appartient à quelqu'un d'autre
    const existingCodeForConfig = this.codeByConfigId.get(incoming.config_id);
    const existingRecord = existingCodeForConfig
      ? this.recordsByCode.get(existingCodeForConfig)
      : undefined;

    if (existingRecord && !this.canActorAccessRecord(actor, existingRecord)) {
      return {
        ok: false,
        status: 403,
        code: 'RBAC_OWNER_MISMATCH',
        error: "Vous n'êtes pas autorisé à modifier une configuration appartenant à un autre compte.",
      };
    }

    // Détermination de l'identifiant unique JTS-XXXX-XXXX
    const requestedCode = String(incoming.cloud?.cloud_code || '').trim().toUpperCase();
    let finalCloudCode: string;
    if (options.forceNewCloudCode) {
      finalCloudCode = this.nextUniqueCloudCode();
    } else if (existingRecord) {
      finalCloudCode = existingRecord.cloudCode;
    } else if (CLOUD_CODE_REGEX.test(requestedCode) && !this.recordsByCode.has(requestedCode)) {
      finalCloudCode = requestedCode;
    } else {
      finalCloudCode = this.nextUniqueCloudCode();
    }

    // Préservation des secrets existants si l'UI envoie un champ masqué
    const incomingPass = incoming.authentication?.password ?? '';
    const incomingKey = incoming.authentication?.private_key ?? '';
    const resolvedPassword =
      incomingPass.startsWith('•••') && existingRecord
        ? existingRecord.config.authentication.password
        : incomingPass;
    const resolvedPrivateKey =
      incomingKey.startsWith('•••') && existingRecord
        ? existingRecord.config.authentication.private_key
        : incomingKey;

    // Construction du schéma v1 strict avec PRÉSERVATION 100 % BRUTE DU PAYLOAD (aucun .trim())
    const normalizedConfig: SshCloudConfigV1 = buildSshCloudConfigV1Object(
      {
        ...incoming,
        authentication: {
          type: incoming.authentication?.type || 'password',
          username: incoming.authentication?.username ?? '',
          password: resolvedPassword,
          private_key: resolvedPrivateKey,
        },
        payload: {
          content: typeof incoming.payload?.content === 'string' ? incoming.payload.content : '',
        },
        cloud: {
          enabled: incoming.cloud?.enabled ?? true,
          cloud_code: finalCloudCode,
          status: incoming.cloud?.status || 'active',
        },
      },
      { redactSecrets: false }
    );

    const { resolveUrl, importUri } = buildLinks(finalCloudCode, options.origin);
    const qrDataUrl = await generateSecureQrDataUrl(importUri);
    const now = new Date().toISOString();

    const record: CloudDistributionRecord = {
      cloudCode: finalCloudCode,
      configId: normalizedConfig.config_id,
      resolveUrl,
      importUri,
      qrDataUrl,
      config: normalizedConfig,
      ownerUserId: existingRecord ? existingRecord.ownerUserId : actor.id,
      ownerName: existingRecord ? existingRecord.ownerName : actor.name,
      ownerEmail: existingRecord ? existingRecord.ownerEmail : actor.email,
      ownerRole: existingRecord ? existingRecord.ownerRole : actor.role,
      assignedClientName: assignedClient || existingRecord?.assignedClientName || '',
      createdAt: existingRecord ? existingRecord.createdAt : now,
      updatedAt: now,
      revokedAt:
        normalizedConfig.cloud.status === 'revoked'
          ? existingRecord?.revokedAt ?? now
          : null,
      revokedBy:
        normalizedConfig.cloud.status === 'revoked'
          ? existingRecord?.revokedBy ?? actor.email
          : null,
      resolveCount: existingRecord?.resolveCount ?? 0,
      lastResolvedAt: existingRecord?.lastResolvedAt ?? null,
      lastResolvedDevice: existingRecord?.lastResolvedDevice ?? null,
    };

    this.recordsByCode.set(finalCloudCode, record);
    this.codeByConfigId.set(record.configId, finalCloudCode);

    return { ok: true, record: this.toPublicView(record, options.origin) };
  }

  public setStatus(
    actor: PublicUserRecord,
    rawCloudCode: string,
    nextStatus: 'active' | 'revoked' | 'draft' | 'expired',
    origin: string
  ):
    | { ok: true; record: PublicCloudDistributionView }
    | { ok: false; status: number; error: string } {
    if (actor.role === 'client') {
      return { ok: false, status: 403, error: 'Action interdite pour le rôle Client.' };
    }
    const cleanCode = rawCloudCode.trim().toUpperCase();
    const record = this.recordsByCode.get(cleanCode);
    if (!record) {
      return { ok: false, status: 404, error: `Code Cloud ${cleanCode} introuvable.` };
    }
    if (!this.canActorAccessRecord(actor, record)) {
      return {
        ok: false,
        status: 403,
        error: "Accès refusé : vous ne pouvez gérer que vos propres configurations Cloud.",
      };
    }

    const now = new Date().toISOString();
    record.config.cloud.status = nextStatus;
    record.config.cloud.enabled = nextStatus === 'active';
    record.updatedAt = now;
    if (nextStatus === 'revoked') {
      record.revokedAt = now;
      record.revokedBy = actor.email;
    } else if (nextStatus === 'active') {
      record.revokedAt = null;
      record.revokedBy = null;
    }

    return { ok: true, record: this.toPublicView(record, origin) };
  }

  public deleteConfig(
    actor: PublicUserRecord,
    rawCloudCode: string
  ): { ok: true } | { ok: false; status: number; error: string } {
    if (actor.role !== 'super_admin' && actor.role !== 'admin' && actor.role !== 'manager') {
      return {
        ok: false,
        status: 403,
        error: 'La suppression définitive est réservée au staff (Super Admin, Admin, Manager).',
      };
    }
    const cleanCode = rawCloudCode.trim().toUpperCase();
    const record = this.recordsByCode.get(cleanCode);
    if (!record) {
      return { ok: false, status: 404, error: `Code Cloud ${cleanCode} introuvable.` };
    }
    this.recordsByCode.delete(cleanCode);
    this.codeByConfigId.delete(record.configId);
    return { ok: true };
  }

  /**
   * Résolution API officielle GET / POST /api/v1/cloud/resolve/:code
   * Bloque immédiatement tout code révoqué, désactivé, expiré ou en brouillon.
   */
  public resolveCloudCode(
    rawCloudCode: string,
    options: {
      deviceId?: string;
      includeSecretsForMobileHandshake: boolean;
    }
  ): ResolveCloudResult {
    const cleanCode = rawCloudCode.trim().toUpperCase();
    const record = this.recordsByCode.get(cleanCode);

    if (!record) {
      return {
        ok: false,
        status: 404,
        errorCode: 'CLOUD_CODE_NOT_FOUND',
        cloudCode: cleanCode,
        error: `Code Cloud "${cleanCode}" introuvable dans le registre JUST TECH SERVICES.`,
      };
    }

    if (record.config.cloud.status === 'revoked') {
      return {
        ok: false,
        status: 410,
        errorCode: 'CLOUD_CODE_REVOKED',
        cloudCode: cleanCode,
        revokedAt: record.revokedAt,
        error: `Résolution bloquée : le code Cloud ${cleanCode} a été révoqué${record.revokedBy ? ` par ${record.revokedBy}` : ''}.`,
      };
    }

    if (!record.config.cloud.enabled) {
      return {
        ok: false,
        status: 410,
        errorCode: 'CLOUD_CODE_DISABLED',
        cloudCode: cleanCode,
        error: `Résolution bloquée : la diffusion Cloud est désactivée pour ${cleanCode}.`,
      };
    }

    if (record.config.cloud.status === 'expired') {
      return {
        ok: false,
        status: 410,
        errorCode: 'CLOUD_CODE_EXPIRED',
        cloudCode: cleanCode,
        error: `Résolution bloquée : le code Cloud ${cleanCode} a expiré.`,
      };
    }

    if (record.config.cloud.status === 'draft') {
      return {
        ok: false,
        status: 409,
        errorCode: 'CLOUD_CODE_DRAFT',
        cloudCode: cleanCode,
        error: `Le code Cloud ${cleanCode} est encore en brouillon (statut: draft) et non distribuable.`,
      };
    }

    const now = new Date().toISOString();
    record.resolveCount += 1;
    record.lastResolvedAt = now;
    record.lastResolvedDevice = options.deviceId?.trim() || 'client-anonyme';

    const payload = buildSshCloudConfigV1Object(record.config, {
      redactSecrets: !options.includeSecretsForMobileHandshake,
    });

    return {
      ok: true,
      status: 200,
      cloudCode: cleanCode,
      resolvedAt: now,
      resolveCount: record.resolveCount,
      deliveryMode: options.includeSecretsForMobileHandshake
        ? 'mobile_handshake'
        : 'public_redacted',
      payload,
    };
  }
}
