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
  mtnBeneficiary: 'Sidonie Fouda',
  mtnNumber: '+237 681057710',
  orangeBeneficiary: 'CELINE TSEGUI FOPA',
  orangeNumber: '+237 698057856',
  orangeMerchantOmAsso: '1017614',
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

export const INITIAL_SERVERS: ServerNode[] = [
  {
    id: 'srv-1',
    code: 'VPS-CM-01',
    name: 'Nœud Principal Ubuntu',
    hostname: 'vps1.justtechservices.xyz',
    publicIp: '194.163.142.88',
    sshPort: 22,
    wssPort: 443,
    slowDnsPort: 53,
    slowDnsNs: 'sdns1.justtechservices.xyz',
    slowDnsPubKey: '7f8b41c2e9a014d58b22e7c3a1f098e6d3b14a7c8f21e09b',
    status: 'Non vérifié',
    cpuPercent: 0,
    ramPercent: 0,
    bandwidthMbps: 1000,
    latencyMs: null,
    activeSessions: 214,
    maxSessions: 500,
    loadScore: 42.8,
    sshBanner: null,
    lastProbeAt: null,
    lastProbeStatus: 'Non vérifié',
    lastProbeDetail:
      'Serveur distant non sondé — cliquez sur « Tester SSH distant » pour exécuter une sonde TCP/SSH réelle.',
  },
  {
    id: 'srv-2',
    code: 'VPS-FR-02',
    name: 'Nœud Relais Europe',
    hostname: 'vps2.justtechservices.xyz',
    publicIp: '51.158.114.203',
    sshPort: 22,
    wssPort: 443,
    slowDnsPort: 53,
    slowDnsNs: 'sdns2.justtechservices.xyz',
    slowDnsPubKey: '9c12ab540d7e31f229c841a0e651bd7340f2a9c8e12d4b07',
    status: 'Non vérifié',
    cpuPercent: 0,
    ramPercent: 0,
    bandwidthMbps: 1000,
    latencyMs: null,
    activeSessions: 129,
    maxSessions: 500,
    loadScore: 25.8,
    sshBanner: null,
    lastProbeAt: null,
    lastProbeStatus: 'Non vérifié',
    lastProbeDetail:
      'Serveur distant non sondé — cliquez sur « Tester SSH distant » pour exécuter une sonde TCP/SSH réelle.',
  },
];

export const INITIAL_LICENSES: LicenseRecord[] = [
  {
    id: 'lic-1',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e01',
    clientName: 'Franck Mbarga',
    clientEmail: 'franck.mbarga@mail.cm',
    resellerName: 'KmerConnect Pro',
    resellerId: 'res-1',
    planName: 'VIP',
    serverCode: 'VPS-CM-01',
    sshUsername: 'jts_fmbarga92',
    sshPassword: 'Kx9#pL2vQ8mN',
    status: 'Active',
    dataUsedGb: 48.6,
    dataQuotaGb: 150,
    activeSessions: 2,
    maxSessions: 3,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-12-11',
  },
  {
    id: 'lic-2',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e02',
    clientName: 'Aminata Diallo',
    clientEmail: 'aminata.d@mail.sn',
    resellerName: null,
    resellerId: null,
    planName: 'Premium',
    serverCode: 'VPS-CM-01',
    sshUsername: 'jts_adiallo18',
    sshPassword: 'Tr4!wZ9nB3qP',
    status: 'Active',
    dataUsedGb: 61.2,
    dataQuotaGb: 80,
    activeSessions: 1,
    maxSessions: 2,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-11-28',
  },
  {
    id: 'lic-3',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e03',
    clientName: 'Brice Tchouameni',
    clientEmail: 'brice.t@mail.cm',
    resellerName: 'KmerConnect Pro',
    resellerId: 'res-1',
    planName: 'Standard',
    serverCode: 'VPS-FR-02',
    sshUsername: 'jts_btchou41',
    sshPassword: 'Vm7@cR5xD1kL',
    status: 'Quota épuisé',
    dataUsedGb: 35.0,
    dataQuotaGb: 35,
    activeSessions: 0,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-12-03',
  },
  {
    id: 'lic-4',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e04',
    clientName: 'Cédric Kouamé',
    clientEmail: 'cedric.k@mail.ci',
    resellerName: 'Abidjan Net',
    resellerId: 'res-2',
    planName: 'NPV 60 Go',
    serverCode: 'VPS-CM-01',
    sshUsername: 'jts_ckouame07',
    sshPassword: 'Hp2$yN8jM6sW',
    status: 'Active',
    dataUsedGb: 41.5,
    dataQuotaGb: 60,
    activeSessions: 3,
    maxSessions: 4,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-12-15',
  },
  {
    id: 'lic-5',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e05',
    clientName: 'Mireille Ngo',
    clientEmail: 'mireille.ngo@mail.cm',
    resellerName: 'KmerConnect Pro',
    resellerId: 'res-1',
    planName: 'Découverte',
    serverCode: 'VPS-CM-01',
    sshUsername: 'jts_mngo65',
    sshPassword: 'Qa6&zB4vF9tR',
    status: 'En provisionnement',
    dataUsedGb: 0,
    dataQuotaGb: 10,
    activeSessions: 0,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS'],
    expiresAt: '2026-11-25',
  },
  {
    id: 'lic-6',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e06',
    clientName: 'Samuel Etoh',
    clientEmail: 's.etoh@mail.cm',
    resellerName: null,
    resellerId: null,
    planName: 'Standard',
    serverCode: 'VPS-FR-02',
    sshUsername: 'jts_setoh33',
    sshPassword: 'Lp8%nC3mX7dV',
    status: 'Suspendue',
    dataUsedGb: 12.4,
    dataQuotaGb: 35,
    activeSessions: 0,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-11-30',
  },
  {
    id: 'lic-7',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e07',
    clientName: 'Yannick Fotso',
    clientEmail: 'yannick.f@mail.cm',
    resellerName: 'KmerConnect Pro',
    resellerId: 'res-1',
    planName: 'Standard',
    serverCode: 'VPS-CM-01',
    sshUsername: 'jts_yfotso14',
    sshPassword: 'Wz5#rK9bN2pQ',
    status: 'Expirée',
    dataUsedGb: 29.8,
    dataQuotaGb: 35,
    activeSessions: 0,
    maxSessions: 1,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-11-12',
  },
  {
    id: 'lic-8',
    uuid: '9b42c1a0-72d4-4e8a-b110-1a2b3c4d5e08',
    clientName: 'Doris Kamga',
    clientEmail: 'doris.k@mail.cm',
    resellerName: null,
    resellerId: null,
    planName: 'Premium',
    serverCode: 'VPS-CM-01',
    sshUsername: 'jts_dkamga50',
    sshPassword: 'Nx3!vM7kP4wL',
    status: 'En attente',
    dataUsedGb: 0,
    dataQuotaGb: 80,
    activeSessions: 0,
    maxSessions: 2,
    protocols: ['SSH', 'SSH SlowDNS', 'SSH-WSS'],
    expiresAt: '2026-12-18',
  },
];

export const INITIAL_PAYMENTS: PaymentRecord[] = [
  {
    id: 'pay-1',
    reference: 'JTS-202611-0891',
    clientName: 'Doris Kamga',
    planName: 'Premium (30j)',
    method: 'MTN Mobile Money',
    amountFcfa: 6000,
    phoneNumber: '+237 677 41 29 08',
    externalTxId: 'MP261118.1412.B89412',
    status: 'En vérification',
    declaredAt: '18/11 13:22',
  },
  {
    id: 'pay-2',
    reference: 'JTS-202611-0890',
    clientName: 'KmerConnect Pro (Recharge)',
    planName: 'Recharge Crédits Revendeur',
    method: 'Orange Money',
    amountFcfa: 50000,
    phoneNumber: '+237 699 18 74 30',
    externalTxId: 'OM261118.1205.A44219',
    status: 'Déclaré',
    declaredAt: '18/11 12:08',
  },
  {
    id: 'pay-3',
    reference: 'JTS-202611-0889',
    clientName: 'Franck Mbarga',
    planName: 'VIP (30j)',
    method: 'Crédit Revendeur',
    amountFcfa: 7800,
    phoneNumber: 'Portefeuille KmerConnect',
    externalTxId: 'LEDGER-90482',
    status: 'Validé',
    declaredAt: '18/11 09:44',
  },
  {
    id: 'pay-4',
    reference: 'JTS-202611-0888',
    clientName: 'Gérard Atangana',
    planName: 'Standard (30j)',
    method: 'Manuel',
    amountFcfa: 3500,
    phoneNumber: '+237 655 02 11 94',
    externalTxId: 'CASH-DLA-118',
    status: 'Refusé',
    declaredAt: '17/11 18:15',
  },
];

export const RESELLERS: ResellerAccount[] = [
  {
    id: 'res-1',
    name: 'KmerConnect Pro',
    email: 'kmerconnect@justtechservices.xyz',
    level: 'Revendeur',
    parentName: 'Super Admin',
    creditBalanceFcfa: 45200,
    gbBalance: 250,
    gbAllocatedTotal: 400,
    clientsCount: 38,
    maxClients: 100,
    commissionRatePercent: 12,
    monthSalesFcfa: 248500,
    canCreateSubResellers: true,
    isActive: true,
  },
  {
    id: 'res-2',
    name: 'Abidjan Net',
    email: 'abidjannet@justtechservices.xyz',
    level: 'Revendeur',
    parentName: 'Super Admin',
    creditBalanceFcfa: 92400,
    gbBalance: 500,
    gbAllocatedTotal: 650,
    clientsCount: 64,
    maxClients: 150,
    commissionRatePercent: 15,
    monthSalesFcfa: 412000,
    canCreateSubResellers: true,
    isActive: true,
  },
  {
    id: 'res-3',
    name: 'Douala Express Tunnel',
    email: 'doualaexpress@justtechservices.xyz',
    level: 'Sous-revendeur',
    parentName: 'KmerConnect Pro',
    creditBalanceFcfa: 14500,
    gbBalance: 80,
    gbAllocatedTotal: 120,
    clientsCount: 12,
    maxClients: 30,
    commissionRatePercent: 8,
    monthSalesFcfa: 63000,
    canCreateSubResellers: false,
    isActive: true,
  },
];

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

export const INITIAL_TICKETS: SupportTicket[] = [
  {
    id: 'tkt-1',
    number: 'TKT-2026-0412',
    author: 'Franck Mbarga',
    subject: 'Demande de passage de 2 à 3 sessions simultanées sur VIP',
    priority: 'Normale',
    status: 'En cours',
    updatedAt: 'Il y a 18 min',
  },
  {
    id: 'tkt-2',
    number: 'TKT-2026-0411',
    author: 'KmerConnect Pro',
    subject: 'Validation recharge Orange Money #OM261118.1205',
    priority: 'Haute',
    status: 'Ouvert',
    updatedAt: 'Il y a 1 h',
  },
  {
    id: 'tkt-3',
    number: 'TKT-2026-0408',
    author: 'Aminata Diallo',
    subject: 'Export configuration NapsternetV SlowDNS',
    priority: 'Normale',
    status: 'Résolu',
    updatedAt: 'Hier',
  },
];

export const CHART_SERIES_7D: ChartPoint[] = [
  { label: '12 Nov', revenueFcfa: 142000, trafficGb: 412 },
  { label: '13 Nov', revenueFcfa: 168500, trafficGb: 468 },
  { label: '14 Nov', revenueFcfa: 154000, trafficGb: 449 },
  { label: '15 Nov', revenueFcfa: 196000, trafficGb: 521 },
  { label: '16 Nov', revenueFcfa: 224500, trafficGb: 589 },
  { label: '17 Nov', revenueFcfa: 211000, trafficGb: 614 },
  { label: '18 Nov', revenueFcfa: 258000, trafficGb: 648 },
];

export const INITIAL_INVOICES: InvoiceRecord[] = [
  {
    id: 'inv-1',
    invoiceNumber: 'FAC-202611-000891',
    reference: 'JTS-202611-0891',
    clientName: 'Doris Kamga',
    planName: 'Premium (30j)',
    methodCategory: 'Mobile Money',
    methodLabel: 'MTN Mobile Money',
    externalTxId: 'MP261118.1412.B89412',
    amountFcfa: 6000,
    status: 'En attente',
    issuedAt: '18/11/2026 13:22',
  },
  {
    id: 'inv-2',
    invoiceNumber: 'FAC-202611-000890',
    reference: 'JTS-202611-0890',
    clientName: 'KmerConnect Pro (Recharge)',
    planName: 'Recharge Crédits Revendeur',
    methodCategory: 'Mobile Money',
    methodLabel: 'Orange Money',
    externalTxId: 'OM261118.1205.A44219',
    amountFcfa: 50000,
    status: 'En attente',
    issuedAt: '18/11/2026 12:08',
  },
  {
    id: 'inv-3',
    invoiceNumber: 'FAC-202611-000889',
    reference: 'JTS-202611-0889',
    clientName: 'Franck Mbarga',
    planName: 'VIP (30j)',
    methodCategory: 'Mobile Money',
    methodLabel: 'MTN Mobile Money',
    externalTxId: 'MP261118.0940.C10482',
    amountFcfa: 10000,
    status: 'Payée',
    issuedAt: '18/11/2026 09:44',
  },
  {
    id: 'inv-4',
    invoiceNumber: 'FAC-202611-000888',
    reference: 'JTS-202611-0888',
    clientName: 'Gérard Atangana',
    planName: 'Standard (30j)',
    methodCategory: 'Manuel',
    methodLabel: 'Paiement Manuel',
    externalTxId: 'CASH-DLA-118',
    amountFcfa: 3500,
    status: 'Rejetée',
    issuedAt: '17/11/2026 18:15',
  },
  {
    id: 'inv-5',
    invoiceNumber: 'FAC-202611-000887',
    reference: 'JTS-202611-0887',
    clientName: 'Cédric Kouamé',
    planName: 'NPV 60 Go (20j)',
    methodCategory: 'Manuel',
    methodLabel: 'Paiement Manuel',
    externalTxId: 'VIR-ABJ-7721',
    amountFcfa: 5000,
    status: 'Payée',
    issuedAt: '16/11/2026 15:10',
  },
];

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

export const INITIAL_CLOUD_CODES: import('../types/panel').CloudActivationRecord[] = [
  {
    id: 'cld-1',
    code: 'JTS-CLD-9F4A-208X',
    clientName: 'Franck Mbarga',
    planName: 'VIP (30j)',
    sshUsername: 'jts_fmbarga92',
    serverCode: 'VPS-CM-01',
    status: 'Activé sur appareil',
    createdAt: '18/11/2026 09:46',
    activatedDevice: 'Android 14 · Samsung A54',
  },
  {
    id: 'cld-2',
    code: 'JTS-CLD-3B7E-619M',
    clientName: 'Aminata Diallo',
    planName: 'Premium (30j)',
    sshUsername: 'jts_adiallo18',
    serverCode: 'VPS-CM-01',
    status: 'Prêt',
    createdAt: '18/11/2026 11:15',
  },
];

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

