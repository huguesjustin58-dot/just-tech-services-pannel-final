export type SshTunnelProtocol =
  | 'SSH_DIRECT'
  | 'SSH_PROXY'
  | 'SSH_PAYLOAD'
  | 'SSH_PROXY_PAYLOAD'
  | 'SSH_TLS'
  | 'SSH_TLS_PROXY'
  | 'SSH_TLS_PAYLOAD'
  | 'SSH_TLS_PROXY_PAYLOAD'
  | 'SSH_SLOWDNS'
  | 'SSH_WSS';

export type SshAuthType = 'password' | 'private_key' | 'password_and_key';
export type CloudConfigStatus = 'active' | 'draft' | 'revoked' | 'expired';

export interface SshCloudConfigV1 {
  schema_version: 1;
  provider: 'JUST_TECH_SERVICES';
  config_id: string;
  config_name: string;
  remarks: string;
  protocol: SshTunnelProtocol;
  server: {
    host: string;
    port: number;
    udpgw_port: number;
    udpgw_dns: string;
  };
  proxy: {
    host: string;
    port: number;
  };
  authentication: {
    type: SshAuthType;
    username: string;
    password: string;
    private_key: string;
  };
  payload: {
    content: string;
  };
  tls: {
    enabled: boolean;
    sni: string;
  };
  websocket: {
    enabled: boolean;
    path: string;
  };
  slowdns: {
    enabled: boolean;
    nameserver: string;
    public_key: string;
    dns_server: string;
  };
  subscription: {
    duration: string;
    quota_bytes: number;
  };
  cloud: {
    enabled: boolean;
    cloud_code: string;
    status: CloudConfigStatus;
  };
}

export interface ProtocolCapability {
  id: SshTunnelProtocol;
  label: string;
  summary: string;
  defaultPort: number;
  usesProxy: boolean;
  usesPayload: boolean;
  usesTls: boolean;
  usesWebsocket: boolean;
  usesSlowDns: boolean;
}

export const SSH_PROTOCOLS: readonly ProtocolCapability[] = [
  {
    id: 'SSH_DIRECT',
    label: 'SSH Direct',
    summary: 'Connexion SSH directe sans proxy, sans payload HTTP ni couche TLS.',
    defaultPort: 22,
    usesProxy: false,
    usesPayload: false,
    usesTls: false,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_PROXY',
    label: 'SSH Proxy',
    summary: 'Tunnel SSH relayé via un serveur proxy HTTP/CONNECT.',
    defaultPort: 22,
    usesProxy: true,
    usesPayload: false,
    usesTls: false,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_PAYLOAD',
    label: 'SSH Payload',
    summary: 'Injection d’un payload HTTP brut directement vers le serveur SSH.',
    defaultPort: 80,
    usesProxy: false,
    usesPayload: true,
    usesTls: false,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_PROXY_PAYLOAD',
    label: 'SSH Proxy + Payload',
    summary: 'Injection de payload HTTP brut combinée à un relais proxy.',
    defaultPort: 22,
    usesProxy: true,
    usesPayload: true,
    usesTls: false,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_TLS',
    label: 'SSH TLS (SSL/SNI)',
    summary: 'Tunnel SSH encapsulé dans TLS avec SNI personnalisé.',
    defaultPort: 443,
    usesProxy: false,
    usesPayload: false,
    usesTls: true,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_TLS_PROXY',
    label: 'SSH TLS + Proxy',
    summary: 'Encapsulation TLS/SNI acheminée à travers un proxy distant.',
    defaultPort: 443,
    usesProxy: true,
    usesPayload: false,
    usesTls: true,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_TLS_PAYLOAD',
    label: 'SSH TLS + Payload',
    summary: 'Handshake TLS/SNI suivi d’un payload HTTP brut.',
    defaultPort: 443,
    usesProxy: false,
    usesPayload: true,
    usesTls: true,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_TLS_PROXY_PAYLOAD',
    label: 'SSH TLS + Proxy + Payload',
    summary: 'Pile complète TLS/SNI + Proxy HTTP + Payload brut.',
    defaultPort: 443,
    usesProxy: true,
    usesPayload: true,
    usesTls: true,
    usesWebsocket: false,
    usesSlowDns: false,
  },
  {
    id: 'SSH_SLOWDNS',
    label: 'SSH SlowDNS (dnstt)',
    summary: 'Tunnel SSH sur DNS (UDP 53) via résolveur SlowDNS et clé publique dnstt.',
    defaultPort: 22,
    usesProxy: false,
    usesPayload: false,
    usesTls: false,
    usesWebsocket: false,
    usesSlowDns: true,
  },
  {
    id: 'SSH_WSS',
    label: 'SSH WebSocket (WSS)',
    summary: 'SSH sur WebSocket sécurisé (TLS/SNI + chemin WS + Payload Upgrade).',
    defaultPort: 443,
    usesProxy: false,
    usesPayload: true,
    usesTls: true,
    usesWebsocket: true,
    usesSlowDns: false,
  },
] as const;

export const PROTOCOL_MAP: Record<SshTunnelProtocol, ProtocolCapability> = SSH_PROTOCOLS.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<SshTunnelProtocol, ProtocolCapability>
);

export const PAYLOAD_QUICK_TAGS: readonly { tag: string; hint: string }[] = [
  { tag: '[crlf]', hint: 'Retour chariot + saut de ligne (\\r\\n)' },
  { tag: '[lf]', hint: 'Saut de ligne Unix (\\n)' },
  { tag: '[host]', hint: 'Hôte cible / SNI' },
  { tag: '[port]', hint: 'Port de connexion' },
  { tag: '[protocol]', hint: 'Version HTTP (HTTP/1.1)' },
  { tag: '[split]', hint: 'Découpage de paquet TCP' },
  { tag: '[ua]', hint: 'En-tête User-Agent' },
];

export const PAYLOAD_PRESETS: readonly { id: string; label: string; content: string }[] = [
  {
    id: 'wss-upgrade',
    label: 'WebSocket Upgrade',
    content:
      'GET /wss [protocol][crlf]Host: [host][crlf]User-Agent: [ua][crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]',
  },
  {
    id: 'http-split',
    label: 'HTTP Split CRLF',
    content:
      'GET http://[host]:[port]/ [protocol]\r\nHost: [host]\r\n[split]Connection: Keep-Alive\r\nUser-Agent: [ua]\r\n\r\n',
  },
  {
    id: 'connect-proxy',
    label: 'CONNECT Proxy',
    content:
      'CONNECT [host]:[port] [protocol][crlf]Host: [host][crlf]Proxy-Connection: Keep-Alive[crlf]User-Agent: [ua][crlf][crlf]',
  },
];

export const BYTES_PER_GIGABYTE = 1024 * 1024 * 1024;

export function generateConfigId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `JTS-CFG-${hex}`;
}

export function generateCloudCodeV1(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const part1 = Array.from(bytes.slice(0, 2), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const part2 = Array.from(bytes.slice(2, 4), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `JTS-${part1}-${part2}`;
}

export function buildCloudDistributionLinks(
  cloudCode: string,
  origin?: string
): { resolveUrl: string; importUri: string } {
  const cleanCode = cloudCode.trim().toUpperCase();
  const resolvedOrigin = (
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://panel.justtechservices.xyz')
  ).replace(/\/+$/, '');
  return {
    resolveUrl: `${resolvedOrigin}/api/v1/cloud/resolve/${encodeURIComponent(cleanCode)}`,
    importUri: `jts://import?code=${encodeURIComponent(cleanCode)}`,
  };
}

export function createDefaultSshCloudConfig(
  protocol: SshTunnelProtocol = 'SSH_WSS'
): SshCloudConfigV1 {
  const cap = PROTOCOL_MAP[protocol];
  return {
    schema_version: 1,
    provider: 'JUST_TECH_SERVICES',
    config_id: generateConfigId(),
    config_name: 'JUST TECH VIP — Tunnel Principal',
    remarks: 'Configuration optimisée JUST TECH SERVICES TUNNEL',
    protocol,
    server: {
      host: 'vps1.justtechservices.xyz',
      port: cap.defaultPort,
      udpgw_port: 7300,
      udpgw_dns: '8.8.8.8',
    },
    proxy: {
      host: '',
      port: 8080,
    },
    authentication: {
      type: 'password',
      username: '',
      password: '',
      private_key: '',
    },
    payload: {
      content: cap.usesPayload ? PAYLOAD_PRESETS[0].content : '',
    },
    tls: {
      enabled: cap.usesTls,
      sni: cap.usesTls ? 'cdn.justtechservices.xyz' : '',
    },
    websocket: {
      enabled: cap.usesWebsocket,
      path: '/wss',
    },
    slowdns: {
      enabled: cap.usesSlowDns,
      nameserver: 'sdns1.justtechservices.xyz',
      public_key: '7f8b41c2e9a014d58b22e7c3a1f098e6d3b14a7c8f21e09b',
      dns_server: '8.8.8.8:53',
    },
    subscription: {
      duration: '30d',
      quota_bytes: 20 * BYTES_PER_GIGABYTE,
    },
    cloud: {
      enabled: true,
      cloud_code: generateCloudCodeV1(),
      status: 'active',
    },
  };
}

/**
 * Met à jour le protocole sélectionné et synchronise les flags d'activation
 * (tls.enabled, websocket.enabled, slowdns.enabled) SANS jamais altérer payload.content.
 */
export function applyProtocolSelection(
  current: SshCloudConfigV1,
  nextProtocol: SshTunnelProtocol
): SshCloudConfigV1 {
  const prevCap = PROTOCOL_MAP[current.protocol];
  const nextCap = PROTOCOL_MAP[nextProtocol];

  const shouldUpdatePort = current.server.port === prevCap.defaultPort;

  return {
    ...current,
    protocol: nextProtocol,
    server: {
      ...current.server,
      port: shouldUpdatePort ? nextCap.defaultPort : current.server.port,
    },
    tls: {
      ...current.tls,
      enabled: nextCap.usesTls,
    },
    websocket: {
      ...current.websocket,
      enabled: nextCap.usesWebsocket,
      path: current.websocket.path || '/wss',
    },
    slowdns: {
      ...current.slowdns,
      enabled: nextCap.usesSlowDns,
    },
    // Préservation brute absolue : aucun .trim() ni mutation sur payload.content
    payload: {
      content:
        nextCap.usesPayload && current.payload.content.length === 0
          ? PAYLOAD_PRESETS[0].content
          : current.payload.content,
    },
  };
}

export interface ConfigValidationIssue {
  field: string;
  message: string;
}

export function validateSshCloudConfigV1(config: SshCloudConfigV1): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  const cap = PROTOCOL_MAP[config.protocol];

  if (!config.config_name.trim()) {
    issues.push({ field: 'config_name', message: 'Le nom de configuration est requis.' });
  }
  if (!config.server.host.trim()) {
    issues.push({ field: 'server.host', message: 'L’hôte ou IP du serveur SSH est requis.' });
  }
  if (!Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) {
    issues.push({ field: 'server.port', message: 'Le port serveur doit être compris entre 1 et 65535.' });
  }
  if (
    !Number.isInteger(config.server.udpgw_port) ||
    config.server.udpgw_port < 1 ||
    config.server.udpgw_port > 65535
  ) {
    issues.push({ field: 'server.udpgw_port', message: 'Le port UDPGW doit être valide (ex: 7300).' });
  }

  if (cap.usesProxy) {
    if (!config.proxy.host.trim()) {
      issues.push({ field: 'proxy.host', message: `Hôte Proxy requis pour le protocole ${config.protocol}.` });
    }
    if (!Number.isInteger(config.proxy.port) || config.proxy.port < 1 || config.proxy.port > 65535) {
      issues.push({ field: 'proxy.port', message: 'Port Proxy invalide (1–65535).' });
    }
  }

  if (cap.usesPayload && config.payload.content.length === 0) {
    issues.push({
      field: 'payload.content',
      message: `Un Payload HTTP brut est requis pour ${config.protocol}.`,
    });
  }

  if (cap.usesTls && config.tls.enabled && !config.tls.sni.trim()) {
    issues.push({ field: 'tls.sni', message: 'Le SNI TLS est recommandé/requis lorsque TLS est activé.' });
  }

  if (cap.usesWebsocket && config.websocket.enabled && !config.websocket.path.startsWith('/')) {
    issues.push({ field: 'websocket.path', message: 'Le chemin WebSocket doit commencer par « / » (ex: /wss).' });
  }

  if (cap.usesSlowDns) {
    if (!config.slowdns.nameserver.trim()) {
      issues.push({ field: 'slowdns.nameserver', message: 'Le domaine Nameserver (NS) SlowDNS est requis.' });
    }
    if (!config.slowdns.public_key.trim()) {
      issues.push({ field: 'slowdns.public_key', message: 'La clé publique dnstt SlowDNS est requise.' });
    }
    if (!config.slowdns.dns_server.trim()) {
      issues.push({ field: 'slowdns.dns_server', message: 'Le résolveur DNS SlowDNS (ex: 8.8.8.8:53) est requis.' });
    }
  }

  if (config.cloud.enabled && !config.cloud.cloud_code.trim()) {
    issues.push({ field: 'cloud.cloud_code', message: 'Un cloud_code révocable est requis lorsque le Cloud est activé.' });
  }

  return issues;
}

/**
 * Sérialise exactement selon le Schéma JSON v1 (`schema_version: 1`, `provider: "JUST_TECH_SERVICES"`).
 * - Préserve 100 % des caractères bruts dans `payload.content` (zéro .trim()).
 * - Masque par défaut `authentication.password` et `authentication.private_key` pour l'aperçu public / partageable.
 */
export function buildSshCloudConfigV1Object(
  config: SshCloudConfigV1,
  options: { redactSecrets?: boolean } = { redactSecrets: true }
): SshCloudConfigV1 {
  const cap = PROTOCOL_MAP[config.protocol];
  const redact = options.redactSecrets !== false;

  const redactedPassword =
    redact && config.authentication.password.length > 0
      ? '[REDACTED — ÉCHANGE POST UNIQUEMENT]'
      : config.authentication.password;

  const redactedPrivateKey =
    redact && config.authentication.private_key.length > 0
      ? '[REDACTED — JAMAIS EN URL/QR]'
      : config.authentication.private_key;

  return {
    schema_version: 1,
    provider: 'JUST_TECH_SERVICES',
    config_id: config.config_id,
    config_name: config.config_name,
    remarks: config.remarks,
    protocol: config.protocol,
    server: {
      host: config.server.host,
      port: Number(config.server.port) || cap.defaultPort,
      udpgw_port: Number(config.server.udpgw_port) || 7300,
      udpgw_dns: config.server.udpgw_dns,
    },
    proxy: cap.usesProxy
      ? {
          host: config.proxy.host,
          port: Number(config.proxy.port) || 8080,
        }
      : {
          host: '',
          port: 0,
        },
    authentication: {
      type: config.authentication.type,
      username: config.authentication.username,
      password: redactedPassword,
      private_key: redactedPrivateKey,
    },
    payload: {
      // Préservation intégrale octet par octet — aucun .trim()
      content: cap.usesPayload ? config.payload.content : '',
    },
    tls: {
      enabled: cap.usesTls ? config.tls.enabled : false,
      sni: cap.usesTls && config.tls.enabled ? config.tls.sni : '',
    },
    websocket: {
      enabled: cap.usesWebsocket ? config.websocket.enabled : false,
      path: cap.usesWebsocket && config.websocket.enabled ? config.websocket.path : '',
    },
    slowdns: {
      enabled: cap.usesSlowDns ? config.slowdns.enabled : false,
      nameserver: cap.usesSlowDns && config.slowdns.enabled ? config.slowdns.nameserver : '',
      public_key: cap.usesSlowDns && config.slowdns.enabled ? config.slowdns.public_key : '',
      dns_server: cap.usesSlowDns && config.slowdns.enabled ? config.slowdns.dns_server : '',
    },
    subscription: {
      duration: config.subscription.duration,
      quota_bytes: Math.max(0, Math.round(Number(config.subscription.quota_bytes) || 0)),
    },
    cloud: {
      enabled: config.cloud.enabled,
      cloud_code: config.cloud.enabled ? config.cloud.cloud_code : '',
      status: config.cloud.status,
    },
  };
}

/**
 * Template SSH réutilisable : stocke uniquement les paramètres réseau & transport
 * (`host`, `port`, `udpgw_port`, `protocol`, `payload`, `sni`, `ws_path`, `slowdns`)
 * sans jamais stocker de mot de passe ou clé privée client.
 */
export interface SshConfigTemplate {
  id: string;
  name: string;
  createdAt: string;
  protocol: SshTunnelProtocol;
  host: string;
  port: number;
  udpgw_port: number;
  udpgw_dns: string;
  proxy: {
    host: string;
    port: number;
  };
  /** Payload HTTP brut — 100 % préservé sans jamais appeler .trim() */
  payload: string;
  tls_enabled: boolean;
  sni: string;
  ws_enabled: boolean;
  ws_path: string;
  slowdns: {
    enabled: boolean;
    nameserver: string;
    public_key: string;
    dns_server: string;
  };
}

export function generateTemplateId(): string {
  const bytes = new Uint8Array(3);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `JTS-TPL-${hex}`;
}

export const INITIAL_SSH_TEMPLATES: SshConfigTemplate[] = [
  {
    id: 'JTS-TPL-WSS01',
    name: 'VIP WSS TLS — Cameroun Principal',
    createdAt: '2026-11-18T12:00:00.000Z',
    protocol: 'SSH_WSS',
    host: 'vps1.justtechservices.xyz',
    port: 443,
    udpgw_port: 7300,
    udpgw_dns: '8.8.8.8',
    proxy: { host: '', port: 0 },
    payload:
      'GET /wss [protocol][crlf]Host: [host][crlf]User-Agent: [ua][crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]',
    tls_enabled: true,
    sni: 'cdn.justtechservices.xyz',
    ws_enabled: true,
    ws_path: '/wss',
    slowdns: {
      enabled: false,
      nameserver: '',
      public_key: '',
      dns_server: '',
    },
  },
  {
    id: 'JTS-TPL-SDNS2',
    name: 'Secours SlowDNS dnstt — UDP 53',
    createdAt: '2026-11-18T14:30:00.000Z',
    protocol: 'SSH_SLOWDNS',
    host: 'vps1.justtechservices.xyz',
    port: 22,
    udpgw_port: 7300,
    udpgw_dns: '8.8.8.8',
    proxy: { host: '', port: 0 },
    payload: '',
    tls_enabled: false,
    sni: '',
    ws_enabled: false,
    ws_path: '',
    slowdns: {
      enabled: true,
      nameserver: 'sdns1.justtechservices.xyz',
      public_key: '7f8b41c2e9a014d58b22e7c3a1f098e6d3b14a7c8f21e09b',
      dns_server: '8.8.8.8:53',
    },
  },
];

export function extractTemplateFromConfig(
  config: SshCloudConfigV1,
  templateName: string
): SshConfigTemplate {
  const cap = PROTOCOL_MAP[config.protocol];
  return {
    id: generateTemplateId(),
    name: templateName.trim() || `Template ${config.protocol} (${config.server.host})`,
    createdAt: new Date().toISOString(),
    protocol: config.protocol,
    host: config.server.host,
    port: Number(config.server.port) || cap.defaultPort,
    udpgw_port: Number(config.server.udpgw_port) || 7300,
    udpgw_dns: config.server.udpgw_dns,
    proxy: cap.usesProxy
      ? { host: config.proxy.host, port: Number(config.proxy.port) || 8080 }
      : { host: '', port: 0 },
    // Préservation brute 100 % sans .trim()
    payload: cap.usesPayload ? config.payload.content : '',
    tls_enabled: cap.usesTls ? config.tls.enabled : false,
    sni: cap.usesTls ? config.tls.sni : '',
    ws_enabled: cap.usesWebsocket ? config.websocket.enabled : false,
    ws_path: cap.usesWebsocket ? config.websocket.path : '',
    slowdns: cap.usesSlowDns
      ? {
          enabled: config.slowdns.enabled,
          nameserver: config.slowdns.nameserver,
          public_key: config.slowdns.public_key,
          dns_server: config.slowdns.dns_server,
        }
      : {
          enabled: false,
          nameserver: '',
          public_key: '',
          dns_server: '',
        },
  };
}

export function instantiateConfigFromTemplate(
  template: SshConfigTemplate,
  attribution?: {
    configName?: string;
    clientName?: string;
    planName?: string;
    duration?: string;
    quotaBytes?: number;
    sshUsername?: string;
    sshPassword?: string;
  }
): SshCloudConfigV1 {
  const clientLabel = attribution?.clientName?.trim();
  const planLabel = attribution?.planName?.trim();
  const autoName =
    attribution?.configName?.trim() ||
    (clientLabel && planLabel
      ? `${clientLabel} — ${planLabel}`
      : clientLabel
        ? `${clientLabel} — ${template.name}`
        : `${template.name} — Client`);

  const autoRemarks = [
    `Template: ${template.name}`,
    clientLabel ? `Client: ${clientLabel}` : null,
    planLabel ? `Offre: ${planLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    schema_version: 1,
    provider: 'JUST_TECH_SERVICES',
    config_id: generateConfigId(),
    config_name: autoName,
    remarks: autoRemarks,
    protocol: template.protocol,
    server: {
      host: template.host,
      port: template.port,
      udpgw_port: template.udpgw_port,
      udpgw_dns: template.udpgw_dns,
    },
    proxy: {
      host: template.proxy.host,
      port: template.proxy.port,
    },
    authentication: {
      type: 'password',
      username: attribution?.sshUsername ?? '',
      password: attribution?.sshPassword ?? '',
      private_key: '',
    },
    payload: {
      // Préservation brute 100 % du payload du template
      content: template.payload,
    },
    tls: {
      enabled: template.tls_enabled,
      sni: template.sni,
    },
    websocket: {
      enabled: template.ws_enabled,
      path: template.ws_path,
    },
    slowdns: {
      enabled: template.slowdns.enabled,
      nameserver: template.slowdns.nameserver,
      public_key: template.slowdns.public_key,
      dns_server: template.slowdns.dns_server,
    },
    subscription: {
      duration: attribution?.duration ?? '30d',
      quota_bytes: attribution?.quotaBytes ?? 20 * BYTES_PER_GIGABYTE,
    },
    cloud: {
      enabled: true,
      cloud_code: generateCloudCodeV1(),
      status: 'active',
    },
  };
}

/**
 * Duplique une configuration existante sans modifier l'originale :
 * génère un nouvel identifiant `config_id` unique et un nouveau `cloud_code` révocable,
 * tout en préservant à 100 % le payload HTTP brut.
 */
export function duplicateSshCloudConfig(source: SshCloudConfigV1): SshCloudConfigV1 {
  const cloned = structuredClone(source);
  const baseName = source.config_name.replace(/\s*\(Copie(?:\s+\d+)?\)$/i, '');
  cloned.config_id = generateConfigId();
  cloned.config_name = `${baseName} (Copie)`;
  cloned.cloud = {
    ...cloned.cloud,
    cloud_code: cloned.cloud.enabled ? generateCloudCodeV1() : '',
  };
  return cloned;
}

/**
 * Génère le fichier JSON exact conforme au contrat JUST TECH SERVICES TUNNEL v1.
 */
export function serializeJtsTunnelConfigV1(
  config: SshCloudConfigV1,
  options: { redactSecrets?: boolean } = { redactSecrets: true }
): string {
  return JSON.stringify(buildSshCloudConfigV1Object(config, options), null, 2);
}

/**
 * Enregistrement distribué par l'API Cloud v1 (/api/v1/cloud/configs).
 */
export interface CloudDistributionItemDto {
  cloudCode: string;
  configId: string;
  resolveUrl: string;
  importUri: string;
  qrDataUrl: string;
  config: SshCloudConfigV1;
  hasSecretCredentials: boolean;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  ownerRole: 'super_admin' | 'admin' | 'manager' | 'reseller' | 'sub_reseller' | 'client';
  assignedClientName: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  resolveCount: number;
  lastResolvedAt: string | null;
  lastResolvedDevice: string | null;
}

/**
 * Politique RBAC complète (6 rôles) appliquée dans SSH & Cloud Config Builder.
 */
export interface SshBuilderRbacPolicy {
  role: 'super_admin' | 'admin' | 'manager' | 'reseller' | 'sub_reseller' | 'client';
  roleLabel: string;
  canAccessBuilder: boolean;
  canCreateCustomProtocolConfig: boolean;
  canManageTemplates: boolean;
  canDeleteTemplates: boolean;
  canUnlockAdvancedMode: boolean;
  canPublishCloudConfig: boolean;
  canDuplicateConfig: boolean;
  canRevokeAnyConfig: boolean;
  canRevokeOwnConfig: boolean;
  canDeleteSavedConfig: boolean;
  canViewRawJson: boolean;
  canExportJson: boolean;
  canRevealSecretsLocally: boolean;
  canUseMobileSimulator: boolean;
  requiresClientAttribution: boolean;
  maxQuotaGb: number | null;
  scopeSummary: string;
}

export function getSshBuilderRbacPolicy(
  role: 'super_admin' | 'admin' | 'manager' | 'reseller' | 'sub_reseller' | 'client'
): SshBuilderRbacPolicy {
  switch (role) {
    case 'super_admin':
      return {
        role,
        roleLabel: 'Super Admin',
        canAccessBuilder: true,
        canCreateCustomProtocolConfig: true,
        canManageTemplates: true,
        canDeleteTemplates: true,
        canUnlockAdvancedMode: true,
        canPublishCloudConfig: true,
        canDuplicateConfig: true,
        canRevokeAnyConfig: true,
        canRevokeOwnConfig: true,
        canDeleteSavedConfig: true,
        canViewRawJson: true,
        canExportJson: true,
        canRevealSecretsLocally: true,
        canUseMobileSimulator: true,
        requiresClientAttribution: false,
        maxQuotaGb: null,
        scopeSummary:
          'Autorité totale : accès exclusif au contrat JSON v1 pour adapter la configuration à chaque utilisateur, 10 protocoles, Templates SSH, Mode Avancé illimité & révocation globale.',
      };
    case 'admin':
      return {
        role,
        roleLabel: 'Admin',
        canAccessBuilder: true,
        canCreateCustomProtocolConfig: true,
        canManageTemplates: true,
        canDeleteTemplates: true,
        canUnlockAdvancedMode: true,
        canPublishCloudConfig: true,
        canDuplicateConfig: true,
        canRevokeAnyConfig: true,
        canRevokeOwnConfig: true,
        canDeleteSavedConfig: true,
        canViewRawJson: false,
        canExportJson: false,
        canRevealSecretsLocally: false,
        canUseMobileSimulator: true,
        requiresClientAttribution: false,
        maxQuotaGb: null,
        scopeSummary:
          'Gestion complète : création multi-protocoles, Templates SSH, Mode Avancé, distribution Cloud & révocation globale (sortie JSON brute réservée au Super Admin).',
      };
    case 'manager':
      return {
        role,
        roleLabel: 'Manager',
        canAccessBuilder: true,
        canCreateCustomProtocolConfig: true,
        canManageTemplates: false,
        canDeleteTemplates: false,
        canUnlockAdvancedMode: true,
        canPublishCloudConfig: true,
        canDuplicateConfig: true,
        canRevokeAnyConfig: true,
        canRevokeOwnConfig: true,
        canDeleteSavedConfig: false,
        canViewRawJson: false,
        canExportJson: false,
        canRevealSecretsLocally: false,
        canUseMobileSimulator: true,
        requiresClientAttribution: false,
        maxQuotaGb: 100,
        scopeSummary:
          'Opérations clients (≤ 100 Go/config) : création, duplication, diffusion Cloud & révocation. Templates système et JSON brut réservés au Super Admin.',
      };
    case 'reseller':
      return {
        role,
        roleLabel: 'Reseller',
        canAccessBuilder: true,
        canCreateCustomProtocolConfig: false,
        canManageTemplates: false,
        canDeleteTemplates: false,
        canUnlockAdvancedMode: false,
        canPublishCloudConfig: true,
        canDuplicateConfig: true,
        canRevokeAnyConfig: false,
        canRevokeOwnConfig: true,
        canDeleteSavedConfig: false,
        canViewRawJson: false,
        canExportJson: false,
        canRevealSecretsLocally: false,
        canUseMobileSimulator: true,
        requiresClientAttribution: true,
        maxQuotaGb: 60,
        scopeSummary:
          'Périmètre Revendeur (≤ 60 Go/config) : création depuis Templates verrouillés, uniquement pour vos propres clients et vos codes Cloud (sans accès JSON brut).',
      };
    case 'sub_reseller':
      return {
        role,
        roleLabel: 'Sub Reseller',
        canAccessBuilder: true,
        canCreateCustomProtocolConfig: false,
        canManageTemplates: false,
        canDeleteTemplates: false,
        canUnlockAdvancedMode: false,
        canPublishCloudConfig: true,
        canDuplicateConfig: false,
        canRevokeAnyConfig: false,
        canRevokeOwnConfig: true,
        canDeleteSavedConfig: false,
        canViewRawJson: false,
        canExportJson: false,
        canRevealSecretsLocally: false,
        canUseMobileSimulator: true,
        requiresClientAttribution: true,
        maxQuotaGb: 25,
        scopeSummary:
          'Périmètre Sous-revendeur (≤ 25 Go/config) : création depuis Templates verrouillés uniquement pour vos propres clients (sans accès JSON brut).',
      };
    case 'client':
    default:
      return {
        role: 'client',
        roleLabel: 'Client',
        canAccessBuilder: false,
        canCreateCustomProtocolConfig: false,
        canManageTemplates: false,
        canDeleteTemplates: false,
        canUnlockAdvancedMode: false,
        canPublishCloudConfig: false,
        canDuplicateConfig: false,
        canRevokeAnyConfig: false,
        canRevokeOwnConfig: false,
        canDeleteSavedConfig: false,
        canViewRawJson: false,
        canExportJson: false,
        canRevealSecretsLocally: false,
        canUseMobileSimulator: false,
        requiresClientAttribution: true,
        maxQuotaGb: 0,
        scopeSummary:
          'Accès Builder interdit au rôle Client : utilisez votre code Cloud JTS-XXXX-XXXX ou QR code dans le Portail Client.',
      };
  }
}


