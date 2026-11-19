export type SessionRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'reseller'
  | 'sub_reseller'
  | 'client';
export type AdminStaffRole = 'super_admin' | 'admin' | 'manager';
export type RoleWorkspace = 'admin' | 'reseller' | 'client' | 'design-system';

export const ADMIN_STAFF_ROLES: readonly SessionRole[] = ['super_admin', 'admin', 'manager'];
export const RESELLER_ZONE_ROLES: readonly SessionRole[] = ['reseller', 'sub_reseller'];

export const ROLE_LABELS: Record<SessionRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  reseller: 'Reseller',
  sub_reseller: 'Sub Reseller',
  client: 'Client',
};

export type RbacPermission =
  | 'admin.access'
  | 'roles.manage'
  | 'roles.assign_super_admin'
  | 'servers.manage'
  | 'configs.manage'
  | 'cloud.templates.manage'
  | 'cloud.configs.create'
  | 'cloud.configs.revoke_all'
  | 'cloud.configs.revoke_own'
  | 'payments.manage'
  | 'payments.gateway_config'
  | 'resellers.manage'
  | 'licenses.manage'
  | 'tickets.manage'
  | 'design_system.view'
  | 'reseller.access'
  | 'client.access';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  isActive: boolean;
  mustChangePassword?: boolean;
  permissions: RbacPermission[];
  lastLoginAt?: string | null;
}

export interface ManagedUserRecord {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SecurityAuditEvent {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: SessionRole | 'anonymous';
  action: string;
  target: string;
  outcome: 'ALLOWED' | 'DENIED';
  detail: string;
}

export type LicenseStatus =
  | 'En attente'
  | 'En provisionnement'
  | 'Active'
  | 'Suspendue'
  | 'Quota épuisé'
  | 'Expirée'
  | 'Révoquée';

export type PaymentMethod = 'MTN Mobile Money' | 'Orange Money' | 'Manuel' | 'Crédit Revendeur';

export type PaymentStatus = 'Déclaré' | 'En vérification' | 'Validé' | 'Refusé';

export type PlanCategory = 'NPV TUNNEL' | 'OFFRE TEST GRATUIT';

export interface PlanOffer {
  id: string;
  slug: string;
  category: PlanCategory;
  name: string;
  audience: string;
  priceFcfa: number;
  resellerPriceFcfa: number;
  durationDays: number;
  durationHours: number;
  durationLabel: string;
  dataQuotaGb: number | null;
  maxSessions: number;
  protocols: ('SSH' | 'SSH SlowDNS' | 'SSH-WSS')[];
  isVip: boolean;
}

export interface PaymentGatewayConfig {
  mtnBeneficiary: string;
  mtnNumber: string;
  orangeBeneficiary: string;
  orangeNumber: string;
  orangeMerchantOmAsso: string;
  orangeCeilingFcfa: number;
  orangeCurrentVolumeFcfa: number;
  orangeCeilingReachedManual: boolean;
  orangeCeilingExceeded: boolean;
}

export interface ServerNode {
  id: string;
  code: string;
  name: string;
  hostname: string;
  publicIp: string;
  sshPort: number;
  wssPort: number;
  slowDnsPort: number;
  slowDnsNs: string;
  slowDnsPubKey: string;
  status: 'En ligne' | 'Dégradé' | 'Maintenance' | 'Hors ligne' | 'Non vérifié';
  cpuPercent: number;
  ramPercent: number;
  bandwidthMbps: number;
  latencyMs: number | null;
  activeSessions: number;
  maxSessions: number;
  loadScore: number;
  sshBanner?: string | null;
  lastProbeAt?: string | null;
  lastProbeStatus?: 'Non vérifié' | 'Joignable' | 'Injoignable';
  lastProbeDetail?: string | null;
}

export interface LicenseRecord {
  id: string;
  uuid: string;
  clientName: string;
  clientEmail: string;
  resellerName: string | null;
  resellerId: string | null;
  planName: string;
  serverCode: string;
  sshUsername: string;
  sshPassword: string;
  status: LicenseStatus;
  dataUsedGb: number;
  dataQuotaGb: number | null;
  activeSessions: number;
  maxSessions: number;
  protocols: ('SSH' | 'SSH SlowDNS' | 'SSH-WSS')[];
  expiresAt: string;
}

export interface PaymentRecord {
  id: string;
  reference: string;
  clientName: string;
  planName: string;
  method: PaymentMethod;
  amountFcfa: number;
  phoneNumber: string;
  externalTxId: string;
  status: PaymentStatus;
  declaredAt: string;
}

export interface ResellerAccount {
  id: string;
  name: string;
  email?: string;
  level: 'Revendeur' | 'Sous-revendeur';
  parentName: string;
  creditBalanceFcfa: number;
  gbBalance: number;
  gbAllocatedTotal?: number;
  clientsCount: number;
  maxClients: number;
  commissionRatePercent: number;
  monthSalesFcfa: number;
  canCreateSubResellers?: boolean;
  isActive: boolean;
}

export interface LedgerEntry {
  id: string;
  date: string;
  type:
    | 'Rechargement'
    | 'Dotation Gigas'
    | 'Achat forfait (Go)'
    | 'Achat licence'
    | 'Renouvellement'
    | 'Commission'
    | 'Transfert sous-revendeur';
  description: string;
  amountFcfa: number;
  balanceAfterFcfa: number;
  gbDelta?: number;
  balanceAfterGb?: number;
}

export interface VpnConfigTemplate {
  id: string;
  name: string;
  targetApp: 'NPV Tunnel' | 'NapsternetV';
  protocol: 'SSH' | 'SSH SlowDNS' | 'SSH-WSS';
  tier: 'Public' | 'VIP';
  version: string;
  shareToken: string;
  serverCode: string;
}

export interface SupportTicket {
  id: string;
  number: string;
  author: string;
  subject: string;
  priority: 'Normale' | 'Haute' | 'Urgente';
  status: 'Ouvert' | 'En cours' | 'Résolu';
  updatedAt: string;
}

export interface ChartPoint {
  label: string;
  revenueFcfa: number;
  trafficGb: number;
}

export type InvoiceStatus = 'En attente' | 'Payée' | 'Rejetée';

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  reference: string;
  clientName: string;
  planName: string;
  methodCategory: 'Mobile Money' | 'Manuel';
  methodLabel: string;
  externalTxId: string;
  amountFcfa: number;
  status: InvoiceStatus;
  issuedAt: string;
}

export type DeliveryPlatform = 'android' | 'iphone';

export interface NpvPrototype {
  id: string;
  name: string;
  version: string;
  fileExtension: '.npvt' | '.json';
  updatedAt: string;
  /**
   * Configuration prototype fournie par le Super Admin.
   * Pour chaque nouveau client iPhone, seuls sshUsername et sshPassword sont remplacés.
   */
  rawTemplateJson: string;
}

export interface CloudConfigQuotaSnapshot {
  totalGb: number;
  usedGb: number;
  remainingGb: number;
  totalBytes: number;
  usedBytes: number;
  remainingBytes: number;
  usagePercent: number;
  exhausted: boolean;
}

export interface CloudConfigBundle {
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
  operationalProtocols: ('ssh' | 'ssh_wss' | 'ssh_slowdns')[];
  quota: CloudConfigQuotaSnapshot;
  npvtFilename: string;
  publicJsonManifest: Record<string, unknown>;
  secretsRedacted: true;
  createdAt: string;
}

export interface CloudActivationRecord {
  id: string;
  code: string;
  clientName: string;
  planName: string;
  sshUsername: string;
  serverCode: string;
  status: 'Prêt' | 'Activé sur appareil' | 'Révoqué';
  createdAt: string;
  activatedDevice?: string;
  importUri?: string;
  exchangeToken?: string;
  quotaTotalGb?: number;
  quotaUsedGb?: number;
}


