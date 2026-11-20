import {
  ChartPoint,
  InvoiceRecord,
  LedgerEntry,
  LicenseRecord,
  PaymentRecord,
  PlanOffer,
  ResellerAccount,
  ServerNode,
  SupportTicket,
  VpnConfigTemplate,
} from '../types/panel';

export const PAYMENT_ACCOUNTS = {
  mtnBeneficiary: '',
  mtnNumber: '',
  orangeBeneficiary: '',
  orangeNumber: '',
  orangeMerchantOmAsso: '',
};

export const PLANS: PlanOffer[] = [
  // NPV TUNNEL
  {
    id: 'npv-500',
    slug: 'npv-5go-5j',
    category: 'NPV TUNNEL',
    name: 'NPV 5 Go',
    audience: 'Navigation légère · Android & iPhone',
    priceFcfa: 500,
    resellerPriceFcfa: 400,
    durationDays: 5,
    durationHours: 120,
    durationLabel: '5 jours',
    dataQuotaGb: 5,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: false,
  },
  {
    id: 'npv-1000',
    slug: 'npv-10go-7j',
    category: 'NPV TUNNEL',
    name: 'NPV 10 Go',
    audience: 'Forfait hebdomadaire · Android & iPhone',
    priceFcfa: 1000,
    resellerPriceFcfa: 800,
    durationDays: 7,
    durationHours: 168,
    durationLabel: '7 jours',
    dataQuotaGb: 10,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: false,
  },
  {
    id: 'npv-2000',
    slug: 'npv-20go-10j',
    category: 'NPV TUNNEL',
    name: 'NPV 20 Go',
    audience: 'Streaming & réseaux · 10 jours',
    priceFcfa: 2000,
    resellerPriceFcfa: 1600,
    durationDays: 10,
    durationHours: 240,
    durationLabel: '10 jours',
    dataQuotaGb: 20,
    maxSessions: 2,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: false,
  },
  {
    id: 'npv-2500',
    slug: 'npv-25go-12j',
    category: 'NPV TUNNEL',
    name: 'NPV 25 Go',
    audience: 'Confort multi-usages · 12 jours',
    priceFcfa: 2500,
    resellerPriceFcfa: 2000,
    durationDays: 12,
    durationHours: 288,
    durationLabel: '12 jours',
    dataQuotaGb: 25,
    maxSessions: 2,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: false,
  },
  {
    id: 'npv-4000',
    slug: 'npv-40go-15j',
    category: 'NPV TUNNEL',
    name: 'NPV 40 Go',
    audience: 'Haute capacité · 15 jours',
    priceFcfa: 4000,
    resellerPriceFcfa: 3200,
    durationDays: 15,
    durationHours: 360,
    durationLabel: '15 jours',
    dataQuotaGb: 40,
    maxSessions: 2,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: false,
  },
  {
    id: 'npv-5000',
    slug: 'npv-60go-20j',
    category: 'NPV TUNNEL',
    name: 'NPV 60 Go',
    audience: 'Maxi Volume NPV · 20 jours',
    priceFcfa: 5000,
    resellerPriceFcfa: 4000,
    durationDays: 20,
    durationHours: 480,
    durationLabel: '20 jours',
    dataQuotaGb: 60,
    maxSessions: 3,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: true,
  },
  // OFFRE TEST GRATUIT
  {
    id: 'free-test-3gb',
    slug: 'offre-test-gratuit',
    category: 'OFFRE TEST GRATUIT',
    name: 'Test Gratuit 3 Go',
    audience: '1 test/appareil · 2 générations max/compte',
    priceFcfa: 0,
    resellerPriceFcfa: 0,
    durationDays: 1,
    durationHours: 2,
    durationLabel: '2 heures',
    dataQuotaGb: 3,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    isVip: false,
  },
];

export const INITIAL_SERVERS: ServerNode[] = [];

export const INITIAL_LICENSES: LicenseRecord[] = [];

export const INITIAL_PAYMENTS: PaymentRecord[] = [];

export const RESELLERS: ResellerAccount[] = [];

export const INITIAL_LEDGER: LedgerEntry[] = [
  {
    id: 'led-1',
    date: '18/11 09:44',
    type: 'Achat forfait (Go)',
    description: 'Forfait NPV 60 Go · jts_fmbarga92 (5 000 FCFA)',
    amountFcfa: -5000,
    balanceAfterFcfa: 45200,
    gbDelta: -60,
    balanceAfterGb: 250,
  },
  {
    id: 'led-2',
    date: '17/11 19:10',
    type: 'Transfert sous-revendeur',
    description: 'Dotation Gigas vers Douala Express Tunnel',
    amountFcfa: 0,
    balanceAfterFcfa: 45200,
    gbDelta: -40,
    balanceAfterGb: 310,
  },
  {
    id: 'led-3',
    date: '16/11 14:25',
    type: 'Renouvellement',
    description: 'Renouvellement NPV 20 Go · jts_btchou41 (2 000 FCFA)',
    amountFcfa: -2000,
    balanceAfterFcfa: 47200,
    gbDelta: -20,
    balanceAfterGb: 350,
  },
  {
    id: 'led-4',
    date: '15/11 10:02',
    type: 'Dotation Gigas',
    description: 'Attribution Super Admin (+200 Go au stock)',
    amountFcfa: 0,
    balanceAfterFcfa: 47200,
    gbDelta: 200,
    balanceAfterGb: 370,
  },
];

export const VPN_CONFIGS: VpnConfigTemplate[] = [
  {
    id: 'cfg-1',
    name: 'CM-MTN-SlowDNS-NPV-v2',
    targetApp: 'NPV Tunnel',
    protocol: 'SSH SlowDNS',
    tier: 'VIP',
    version: '2.4.1',
    shareToken: 'npvt-jts-918a4f2c',
    serverCode: 'VPS-CM-01',
  },
  {
    id: 'cfg-2',
    name: 'CM-Orange-WSS-TLS443',
    targetApp: 'NapsternetV',
    protocol: 'SSH-WSS',
    tier: 'VIP',
    version: '3.1.0',
    shareToken: 'npv4-jts-441b7e90',
    serverCode: 'VPS-CM-01',
  },
  {
    id: 'cfg-3',
    name: 'Direct-SSH-Standard-22',
    targetApp: 'NPV Tunnel',
    protocol: 'SSH',
    tier: 'Public',
    version: '1.8.0',
    shareToken: 'npvt-jts-205d8c11',
    serverCode: 'VPS-FR-02',
  },
];

export const INITIAL_TICKETS: SupportTicket[] = [];

export const CHART_SERIES_7D: ChartPoint[] = [];

export const INITIAL_INVOICES: InvoiceRecord[] = [];

export const DEFAULT_NPV_PROTOTYPE_JSON = JSON.stringify(
  {
    name: 'JUST TECH VIP PROTOTYPE',
    connectionMode: 'SSH_WSS_SLOWDNS',
    sshHost: 'vps1.justtechservices.xyz',
    sshPort: 22,
    wssPort: 443,
    sshUsername: '{{SSH_USERNAME}}',
    sshPassword: '{{SSH_PASSWORD}}',
    sni: 'cdn.justtechservices.xyz',
    payload:
      'GET wss://cdn.justtechservices.xyz/wss HTTP/1.1[crlf]Host: vps1.justtechservices.xyz[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]',
    slowDns: {
      enabled: true,
      dnsServer: '8.8.8.8:53',
      nameserver: 'sdns1.justtechservices.xyz',
      publicKey: '7f8b41c2e9a014d58b22e7c3a1f098e6d3b14a7c8f21e09b',
    },
    autoReplaceOnBypass: true,
    generator: 'JUST TECH SERVICES NPV COMPILER v2',
  },
  null,
  2
);

export const INITIAL_NPV_PROTOTYPE: import('../types/panel').NpvPrototype = {
  id: 'npv-proto-1',
  name: 'Prototype Officiel iOS — JUST TECH VIP',
  version: 'v2.4',
  fileExtension: '.npvt',
  updatedAt: '18/11/2026 14:05',
  rawTemplateJson: DEFAULT_NPV_PROTOTYPE_JSON,
};

export const INITIAL_CLOUD_CODES: import('../types/panel').CloudActivationRecord[] = [];

export interface RawHttpPayloadAudit {
  sourceKind: 'json_payload_field' | 'raw_http_payload';
  charCount: number;
  byteLength: number;
  crlfCount: number;
  lfOnlyCount: number;
  leadingSpaces: number;
  trailingSpaces: number;
  macrosDetected: string[];
  escapedPreview: string;
}

/**
 * Inspecte un Payload HTTP brut (ou le champ `payload` d'un prototype JSON)
 * SANS jamais appliquer de .trim() ni altérer les CRLF (\r\n), espaces ou balises.
 */
export function inspectRawHttpPayload(rawInput: string): RawHttpPayloadAudit {
  let targetPayload = rawInput;
  let sourceKind: 'json_payload_field' | 'raw_http_payload' = 'raw_http_payload';

  try {
    const parsed = JSON.parse(rawInput) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.payload === 'string') {
      targetPayload = parsed.payload;
      sourceKind = 'json_payload_field';
    }
  } catch {
    // Contenu texte/HTTP brut conservé caractère par caractère
  }

  const crlfCount = (targetPayload.match(/\r\n/g) ?? []).length;
  const lfOnlyCount = (targetPayload.replace(/\r\n/g, '').match(/\n/g) ?? []).length;
  const leadingMatch = targetPayload.match(/^[ \t]+/);
  const trailingMatch = targetPayload.match(/[ \t]+$/);
  const macroList = ['[host]', '[crlf]', '[split]', '[ua]', '[raw]', '[protocol]'];
  const macrosDetected = macroList.filter((m) => targetPayload.includes(m));
  const byteLength = new TextEncoder().encode(targetPayload).length;
  const escapedPreview = targetPayload
    .replace(/\r\n/g, '␍␊\n')
    .replace(/\r/g, '␍')
    .replace(/ /g, '·');

  return {
    sourceKind,
    charCount: targetPayload.length,
    byteLength,
    crlfCount,
    lfOnlyCount,
    leadingSpaces: leadingMatch ? leadingMatch[0].length : 0,
    trailingSpaces: trailingMatch ? trailingMatch[0].length : 0,
    macrosDetected,
    escapedPreview,
  };
}

/**
 * Compile une configuration NPV Tunnel iPhone à partir du prototype Super Admin :
 * - Ne modifie QUE les identifiants SSH (username & password) du client.
 * - Préserve 100 % des caractères bruts dans les Payloads HTTP (CRLF \r\n, espaces,
 *   [host], [crlf], [split], [ua]) : AUCUN .trim() destructif n'est jamais appliqué.
 */
export function compileNpvFromPrototype(
  rawPrototype: string,
  sshUsername: string,
  sshPassword: string,
  clientLabel: string
): string {
  try {
    const parsed = JSON.parse(rawPrototype) as Record<string, unknown>;
    const clone: Record<string, unknown> = structuredClone(parsed);

    const replaceCredsRecursive = (obj: Record<string, unknown>) => {
      for (const key of Object.keys(obj)) {
        const lower = key.toLowerCase();
        const val = obj[key];
        if (typeof val === 'string') {
          if (
            lower === 'sshusername' ||
            lower === 'ssh_username' ||
            lower === 'username' ||
            lower === 'user'
          ) {
            obj[key] = sshUsername;
          } else if (
            lower === 'sshpassword' ||
            lower === 'ssh_password' ||
            lower === 'password' ||
            lower === 'pass'
          ) {
            obj[key] = sshPassword;
          } else if (lower === 'payload' || lower === 'http_payload' || lower === 'httppayload') {
            // Préservation absolue octet par octet du Payload HTTP (\r\n, espaces, [host], [crlf], [split], [ua])
            obj[key] = val;
          } else {
            obj[key] = val
              .replace(/\{\{SSH_USERNAME\}\}/g, sshUsername)
              .replace(/\{\{SSH_PASSWORD\}\}/g, sshPassword);
          }
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          replaceCredsRecursive(val as Record<string, unknown>);
        }
      }
    };

    replaceCredsRecursive(clone);
    if (!('sshUsername' in clone) && !('username' in clone)) {
      clone.sshUsername = sshUsername;
    }
    if (!('sshPassword' in clone) && !('password' in clone)) {
      clone.sshPassword = sshPassword;
    }
    clone.issuedFor = clientLabel;
    return JSON.stringify(clone, null, 2);
  } catch {
    // Mode brut (Payload HTTP ou format texte/NPV) : AUCUN .trim(), 100 % des espaces, \r\n et balises préservés
    return rawPrototype
      .replace(/\{\{SSH_USERNAME\}\}/g, sshUsername)
      .replace(/\{\{SSH_PASSWORD\}\}/g, sshPassword)
      .replace(/("sshUsername"\s*:\s*)"[^"]*"/g, `$1"${sshUsername}"`)
      .replace(/("sshPassword"\s*:\s*)"[^"]*"/g, `$1"${sshPassword}"`)
      .replace(/("username"\s*:\s*)"[^"]*"/g, `$1"${sshUsername}"`)
      .replace(/("password"\s*:\s*)"[^"]*"/g, `$1"${sshPassword}"`);
  }
}

export const formatFcfa = (value: number): string => {
  return `${new Intl.NumberFormat('fr-FR').format(value)} FCFA`;
};

