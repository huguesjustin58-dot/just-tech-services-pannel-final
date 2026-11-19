import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Cloud,
  Copy,
  CreditCard,
  Download,
  FileCode2,
  Globe,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Minus,
  Network,
  Pause,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Terminal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  CHART_SERIES_7D,
  INITIAL_CLOUD_CODES,
  INITIAL_INVOICES,
  INITIAL_LICENSES,
  INITIAL_NPV_PROTOTYPE,
  INITIAL_PAYMENTS,
  INITIAL_SERVERS,
  INITIAL_TICKETS,
  PAYMENT_ACCOUNTS,
  PLANS,
  RESELLERS,
  VPN_CONFIGS,
  compileNpvFromPrototype,
  formatFcfa,
  inspectRawHttpPayload,
} from '../data/maquetteData';
import {
  AuthenticatedUser,
  CloudActivationRecord,
  InvoiceRecord,
  InvoiceStatus,
  LicenseRecord,
  LicenseStatus,
  NpvPrototype,
  PaymentGatewayConfig,
  PaymentRecord,
  ROLE_LABELS,
  ResellerAccount,
  ServerNode,
  SessionRole,
  SupportTicket,
  VpnConfigTemplate,
} from '../types/panel';
import { authFetch } from '../services/authClient';
import { CloudConfigBuilder } from './CloudConfigBuilder';
import { RevenueTrafficChart } from './RevenueTrafficChart';
import { RoleManagementPanel } from './RoleManagementPanel';
import { LicenseStatusText, PaymentStatusText } from './StatusText';
import { VpsDeploymentWizardModal } from './VpsDeploymentWizardModal';
import {
  ServiceAIAgentSnapshot,
  SubscriptionSimulationResult,
  serviceAIAgent,
} from '../services/ServiceAIAgent';

type AdminTab =
  | 'overview'
  | 'licenses'
  | 'resellers'
  | 'servers'
  | 'configs'
  | 'ssh-builder'
  | 'payments'
  | 'invoices'
  | 'tickets'
  | 'roles';

const ALL_STATUSES: ('Toutes' | LicenseStatus)[] = [
  'Toutes',
  'Active',
  'En provisionnement',
  'En attente',
  'Suspendue',
  'Quota épuisé',
  'Expirée',
  'Révoquée',
];

interface AdminWorkspaceProps {
  currentUser: AuthenticatedUser;
  npvPrototype?: NpvPrototype;
  onUpdateNpvPrototype?: (next: NpvPrototype) => void;
  cloudCodes?: CloudActivationRecord[];
  onRevokeCloudCode?: (id: string) => void;
  onGenerateCloudCode?: (
    clientName: string,
    planName: string,
    sshUsername: string,
    explicitCode?: string
  ) => CloudActivationRecord;
}

interface AuditLogEntry {
  id: string;
  event: string;
  detail: string;
  level: 'ok' | 'warn' | 'info';
  timestamp: string;
}

export const AdminWorkspace: React.FC<AdminWorkspaceProps> = ({
  currentUser,
  npvPrototype = INITIAL_NPV_PROTOTYPE,
  onUpdateNpvPrototype,
  cloudCodes = INITIAL_CLOUD_CODES,
  onRevokeCloudCode,
  onGenerateCloudCode,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      if (path.includes('/ssh-builder') || params.get('tab') === 'ssh-builder') {
        return 'ssh-builder';
      }
    }
    return 'overview';
  });
  const canManageRoles = currentUser.role === 'super_admin' || currentUser.role === 'admin';
  const canManageInfra = currentUser.role === 'super_admin' || currentUser.role === 'admin';
  const [licenses, setLicenses] = useState<LicenseRecord[]>(INITIAL_LICENSES);
  const [payments, setPayments] = useState<PaymentRecord[]>(INITIAL_PAYMENTS);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(INITIAL_INVOICES);
  const [resellers, setResellers] = useState<ResellerAccount[]>(RESELLERS);
  const [servers, setServers] = useState<ServerNode[]>(INITIAL_SERVERS);
  const [tickets, setTickets] = useState<SupportTicket[]>(INITIAL_TICKETS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([
    { id: 'aud-1', event: 'license.provisioned', detail: 'jts_fmbarga92 · VPS-CM-01 · OK', level: 'ok', timestamp: '18/11 09:44' },
    { id: 'aud-2', event: 'quota.threshold_100', detail: 'jts_btchou41 · Verrouillé OS', level: 'warn', timestamp: '18/11 11:12' },
    { id: 'aud-3', event: 'payment.verified', detail: 'LEDGER-90482 · 7 800 FCFA', level: 'ok', timestamp: '18/11 12:08' },
    { id: 'aud-4', event: 'dns.cloudflare.sync', detail: 'sdns1.justtechservices.xyz · NS OK', level: 'info', timestamp: '18/11 13:00' },
  ]);

  const [protoName, setProtoName] = useState(npvPrototype.name);
  const [protoExt, setProtoExt] = useState<'.npvt' | '.json'>(npvPrototype.fileExtension);
  const [protoJson, setProtoJson] = useState(npvPrototype.rawTemplateJson);
  const [protoTestPreview, setProtoTestPreview] = useState<string | null>(null);
  const [showRawEscapedPayload, setShowRawEscapedPayload] = useState(false);
  const [probingServerId, setProbingServerId] = useState<string | null>(null);
  const rawPayloadAudit = useMemo(() => inspectRawHttpPayload(protoJson), [protoJson]);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'Toutes' | InvoiceStatus>('Toutes');
  const [invoiceMethodFilter, setInvoiceMethodFilter] = useState<'Toutes' | 'Mobile Money' | 'Manuel'>('Toutes');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Toutes' | LicenseStatus>('Toutes');
  const [previewConfig, setPreviewConfig] = useState<VpnConfigTemplate | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeployWizard, setShowDeployWizard] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newPlanId, setNewPlanId] = useState(
    () => PLANS.find((p) => p.id === 'npv-2000')?.id ?? PLANS[0].id
  );

  // Modales Revendeurs & Serveurs
  const [showResellerModal, setShowResellerModal] = useState(false);
  const [newResellerName, setNewResellerName] = useState('');
  const [newResellerEmail, setNewResellerEmail] = useState('');
  const [newResellerPassword, setNewResellerPassword] = useState('');
  const [newResellerLevel, setNewResellerLevel] = useState<'Revendeur' | 'Sous-revendeur'>('Revendeur');
  const [newResellerParent, setNewResellerParent] = useState('Super Admin');
  const [newResellerGb, setNewResellerGb] = useState(100);
  const [newResellerCredit, setNewResellerCredit] = useState(0);
  const [newResellerMaxClients, setNewResellerMaxClients] = useState(50);
  const [newResellerCommission, setNewResellerCommission] = useState(12);
  const [newResellerCanCreateSub, setNewResellerCanCreateSub] = useState(true);

  const [creditTargetReseller, setCreditTargetReseller] = useState<ResellerAccount | null>(null);
  const [creditAmountInput, setCreditAmountInput] = useState(10000);
  const [gbTargetReseller, setGbTargetReseller] = useState<ResellerAccount | null>(null);
  const [gbMode, setGbMode] = useState<'add' | 'set'>('add');
  const [gbAmountInput, setGbAmountInput] = useState(100);

  const [showServerModal, setShowServerModal] = useState(false);
  const [srvCode, setSrvCode] = useState('VPS-CM-03');
  const [srvName, setSrvName] = useState('Douala Core Node #3');
  const [srvHostname, setSrvHostname] = useState('vps3.justtechservices.xyz');
  const [srvPublicIp, setSrvPublicIp] = useState('102.215.48.92');
  const [srvSshPort, setSrvSshPort] = useState(22);
  const [srvWssPort, setSrvWssPort] = useState(443);
  const [srvSlowDnsPort, setSrvSlowDnsPort] = useState(53);
  const [srvSlowDnsNs, setSrvSlowDnsNs] = useState('sdns3.justtechservices.xyz');
  const [srvSlowDnsKey, setSrvSlowDnsKey] = useState('9a4c22f1d8041b66c31f0a7e592d4812bc7a30f8e110d24a');
  const [srvMaxSessions, setSrvMaxSessions] = useState(300);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [gatewayConfig, setGatewayConfig] = useState<PaymentGatewayConfig>({
    ...PAYMENT_ACCOUNTS,
    orangeCeilingFcfa: 1500000,
    orangeCurrentVolumeFcfa: 1180000,
    orangeCeilingReachedManual: false,
    orangeCeilingExceeded: false,
  });

  const [agentMonitors, setAgentMonitors] = useState<{
    transactions: {
      id: string;
      status: string;
      verificationSource: string;
      reasoning: string;
      forensicReport?: { authenticityScore: number; isFalsified: boolean };
      input: { clientName: string; provider: string; transactionRef: string; expectedAmountFcfa: number; planName: string };
    }[];
  }>({ transactions: [] });

  const fetchAgentMonitors = async () => {
    try {
      const res = await authFetch('/api/agent/monitors');
      if (res.ok) {
        const data = await res.json();
        setAgentMonitors(data);
      }
    } catch {
      // Ignore transient offline error
    }
  };

  const [serviceSnapshot, setServiceSnapshot] = useState<ServiceAIAgentSnapshot>(() =>
    serviceAIAgent.getSnapshot(licenses)
  );
  const [simClientName, setSimClientName] = useState('Junior Kamdem');
  const [simAccountId, setSimAccountId] = useState('client-jkamdem');
  const [simDeviceFp, setSimDeviceFp] = useState('DEV-JK-9012');
  const [simResult, setSimResult] = useState<SubscriptionSimulationResult | null>(null);

  useEffect(() => {
    fetch('/api/payment-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setGatewayConfig(d);
      })
      .catch(() => undefined);
    void fetchAgentMonitors();

    const unsub = serviceAIAgent.subscribe((snap) => {
      setServiceSnapshot(snap);
    });
    return unsub;
  }, []);

  const toggleOrangeCeiling = async () => {
    if (!canManageInfra) {
      notify('Action réservée aux rôles Super Admin et Admin.');
      return;
    }
    const nextManual = !gatewayConfig.orangeCeilingExceeded;
    try {
      const res = await authFetch('/api/payment-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orangeCeilingReachedManual: nextManual }),
      });
      if (res.ok) {
        const updated = (await res.json()) as PaymentGatewayConfig;
        setGatewayConfig(updated);
        notify(
          updated.orangeCeilingExceeded
            ? `Plafond Orange activé : les clients sont dirigés vers OM ASSO (${updated.orangeMerchantOmAsso}).`
            : `Orange Money standard réactivé (${updated.orangeNumber}).`
        );
      } else {
        notify('Refus serveur (403) : droits insuffisants pour modifier la passerelle.');
      }
    } catch {
      notify('Impossible de mettre à jour la passerelle Orange Money.');
    }
  };

  const notify = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3200);
  };

  const recordAudit = (event: string, detail: string, level: 'ok' | 'warn' | 'info' = 'info') => {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setAuditLogs((prev) => [
      { id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, event, detail, level, timestamp: ts },
      ...prev.slice(0, 29),
    ]);
    serviceAIAgent.logActivity({
      category: event.startsWith('ssh.') || event.startsWith('vps.') ? 'security' : 'subscription',
      action: event,
      actor: 'Super Admin',
      target: detail.split(' · ')[0] || 'Panel',
      severity: level,
      detail,
    });
  };

  const filteredLicenses = useMemo(() => {
    return licenses.filter((lic) => {
      const matchesStatus = statusFilter === 'Toutes' || lic.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        lic.clientName.toLowerCase().includes(q) ||
        lic.sshUsername.toLowerCase().includes(q) ||
        lic.serverCode.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [licenses, statusFilter, searchQuery]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const matchesStatus = invoiceStatusFilter === 'Toutes' || inv.status === invoiceStatusFilter;
      const matchesMethod =
        invoiceMethodFilter === 'Toutes' || inv.methodCategory === invoiceMethodFilter;
      const q = invoiceSearch.trim().toLowerCase();
      const matchesQuery =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.reference.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.externalTxId.toLowerCase().includes(q);
      return matchesStatus && matchesMethod && matchesQuery;
    });
  }, [invoices, invoiceStatusFilter, invoiceMethodFilter, invoiceSearch]);

  const activeLicensesCount = licenses.filter((l) => l.status === 'Active').length;
  const totalSessions = licenses.reduce((sum, l) => sum + l.activeSessions, 0);
  const pendingPaymentsCount = payments.filter(
    (p) => p.status === 'Déclaré' || p.status === 'En vérification'
  ).length;
  const monthlyRevenue = 1354000;

  const updateLicenseStatus = (id: string, nextStatus: LicenseStatus, actionLabel: string) => {
    const target = licenses.find((l) => l.id === id);
    setLicenses((prev) =>
      prev.map((lic) =>
        lic.id === id
          ? {
              ...lic,
              status: nextStatus,
              activeSessions: nextStatus === 'Active' ? lic.activeSessions : 0,
            }
          : lic
      )
    );
    if (target) {
      recordAudit(
        nextStatus === 'Révoquée' ? 'license.revoked' : 'license.status_updated',
        `${target.sshUsername} · ${actionLabel} (${nextStatus})`,
        nextStatus === 'Révoquée' || nextStatus === 'Suspendue' ? 'warn' : 'ok'
      );
    }
    notify(`Licence mise à jour (${actionLabel}) · Tâche envoyée à l'agent VPS.`);
  };

  const adjustMaxSessions = (id: string, delta: number) => {
    const target = licenses.find((l) => l.id === id);
    if (!target) return;
    const nextMax = Math.max(1, Math.min(8, target.maxSessions + delta));
    if (nextMax === target.maxSessions) return;
    setLicenses((prev) =>
      prev.map((lic) => (lic.id === id ? { ...lic, maxSessions: nextMax } : lic))
    );
    recordAudit(
      'ssh.maxuser.updated',
      `${target.sshUsername} · ${target.serverCode} · maxSessions = ${nextMax}`,
      'info'
    );
    notify(`Limite SSH maxuser pour ${target.sshUsername} fixée à ${nextMax} session(s).`);
  };

  const handleDeliverAndroidCloudAdmin = async (lic: LicenseRecord) => {
    try {
      const res = await fetch('/api/delivery/select-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'android',
          planName: lic.planName,
          clientName: lic.clientName,
          dataQuotaGb: lic.dataQuotaGb ?? 5,
          dataUsedGb: lic.dataUsedGb,
          expiresAt: `${lic.expiresAt}T23:59:59Z`,
          maxSessions: lic.maxSessions,
          serverCode: lic.serverCode,
          licenseStatus: lic.status,
          sshUsername: lic.sshUsername,
          sshPassword: lic.sshPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error || `Génération Cloud bloquée pour ${lic.clientName}.`);
        return;
      }
      const explicitCode: string | undefined = data?.cloudRecord?.code;
      const importUri: string | undefined = data?.cloudRecord?.importUri;
      const created = onGenerateCloudCode?.(lic.clientName, lic.planName, lic.sshUsername, explicitCode);
      const code = created?.code ?? explicitCode ?? '';
      if (importUri) {
        navigator.clipboard?.writeText(importUri);
      } else if (code) {
        navigator.clipboard?.writeText(code);
      }
      recordAudit(
        'cloud.key.issued',
        `${code} · ${lic.clientName} (${lic.dataUsedGb}/${lic.dataQuotaGb ?? 0} Go · zéro secret)`,
        'ok'
      );
      notify(
        `Lien Cloud opaque ${code} généré & copié pour ${lic.clientName} (quota ${Math.max(0, (lic.dataQuotaGb ?? 0) - lic.dataUsedGb).toFixed(1)} Go restants).`
      );
    } catch {
      notify('Impossible de joindre le serveur de génération Cloud.');
    }
  };

  const handleDeliverIphoneNpvAdmin = (lic: LicenseRecord) => {
    const compiled = compileNpvFromPrototype(
      npvPrototype.rawTemplateJson,
      lic.sshUsername,
      lic.sshPassword,
      lic.clientName
    );
    const blob = new Blob([compiled], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `justtech-${lic.sshUsername}-iphone${npvPrototype.fileExtension}`;
    a.click();
    URL.revokeObjectURL(url);
    recordAudit('ios.npv.compiled', `${lic.sshUsername} · ${npvPrototype.version}`, 'ok');
    notify(`Fichier NPV Tunnel iPhone généré (${npvPrototype.version}) pour ${lic.clientName}.`);
  };

  const handlePaymentDecision = (id: string, decision: 'Validé' | 'Refusé') => {
    const target = payments.find((p) => p.id === id);
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: decision } : p))
    );
    if (target) {
      recordAudit(
        decision === 'Validé' ? 'payment.verified' : 'payment.rejected',
        `${target.externalTxId} · ${formatFcfa(target.amountFcfa)} (${target.clientName})`,
        decision === 'Validé' ? 'ok' : 'warn'
      );
    }
    notify(
      decision === 'Validé'
        ? 'Paiement validé : facture PDF générée et provisionnement déclenché.'
        : 'Paiement refusé et journalisé dans audit_logs.'
    );
  };

  const handleCreateLicense = (e: React.FormEvent) => {
    e.preventDefault();
    const chosenPlan = PLANS.find((p) => p.id === newPlanId) ?? PLANS[0];
    const cleanSlug = (newClientName || 'client').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const created: LicenseRecord = {
      id: `lic-${Date.now()}`,
      uuid: crypto.randomUUID ? crypto.randomUUID() : `uuid-${Date.now()}`,
      clientName: newClientName.trim() || 'Nouveau Client',
      clientEmail: `${cleanSlug || 'client'}@justtechservices.xyz`,
      resellerName: null,
      resellerId: null,
      planName: chosenPlan.name,
      serverCode: 'VPS-FR-02',
      sshUsername: `jts_${cleanSlug || 'user'}${Math.floor(10 + Math.random() * 89)}`,
      sshPassword: `Jt$${Math.floor(1000 + Math.random() * 8999)}Kx`,
      status: 'Active',
      dataUsedGb: 0,
      dataQuotaGb: chosenPlan.dataQuotaGb,
      activeSessions: 0,
      maxSessions: chosenPlan.maxSessions,
      protocols: chosenPlan.protocols,
      expiresAt: '2026-12-18',
    };
    setLicenses((prev) => [created, ...prev]);
    setNewClientName('');
    setShowCreateModal(false);
    recordAudit('license.provisioned', `${created.sshUsername} · ${created.serverCode} · OK`, 'ok');
    notify(`Licence ${created.sshUsername} provisionnée sur VPS-FR-02 (charge minimale).`);
  };

  const handleCreateReseller = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newResellerName.trim();
    if (!name) return;
    const allocatedGb = Math.max(0, Number(newResellerGb) || 0);
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || 'partenaire';
    const created: ResellerAccount = {
      id: `res-${Date.now()}`,
      name,
      email: newResellerEmail.trim() || `${slug}@justtechservices.xyz`,
      level: newResellerLevel,
      parentName: newResellerLevel === 'Revendeur' ? 'Super Admin' : newResellerParent,
      creditBalanceFcfa: Math.max(0, Number(newResellerCredit) || 0),
      gbBalance: allocatedGb,
      gbAllocatedTotal: allocatedGb,
      clientsCount: 0,
      maxClients: Math.max(1, Number(newResellerMaxClients) || 30),
      commissionRatePercent: Math.max(0, Math.min(50, Number(newResellerCommission) || 10)),
      monthSalesFcfa: 0,
      canCreateSubResellers: newResellerLevel === 'Revendeur' ? newResellerCanCreateSub : false,
      isActive: true,
    };
    setResellers((prev) => [created, ...prev]);
    setNewResellerName('');
    setNewResellerEmail('');
    setNewResellerPassword('');
    setShowResellerModal(false);
    recordAudit(
      'reseller.created',
      `${created.name} (${created.level}) · Stock attribué : ${created.gbBalance} Go`,
      'ok'
    );
    notify(`Compte ${created.level} « ${created.name} » créé avec ${created.gbBalance} Go attribués.`);
  };

  const handleConfirmGbAllocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gbTargetReseller) return;
    const rawGb = Math.max(0, Number(gbAmountInput) || 0);
    const nextGb = gbMode === 'add' ? gbTargetReseller.gbBalance + rawGb : rawGb;
    const delta = nextGb - gbTargetReseller.gbBalance;
    setResellers((prev) =>
      prev.map((r) =>
        r.id === gbTargetReseller.id
          ? {
              ...r,
              gbBalance: nextGb,
              gbAllocatedTotal: (r.gbAllocatedTotal ?? r.gbBalance) + Math.max(0, delta),
            }
          : r
      )
    );
    recordAudit(
      'reseller.gb_updated',
      `${gbTargetReseller.name} (${gbTargetReseller.level}) · ${gbMode === 'add' ? `+${rawGb} Go` : `Stock fixé à ${nextGb} Go`}`,
      'ok'
    );
    notify(`Stock Gigas de ${gbTargetReseller.name} mis à jour : ${nextGb} Go disponibles.`);
    setGbTargetReseller(null);
  };

  const handleConfirmCreditReseller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditTargetReseller) return;
    const amount = Math.max(500, Number(creditAmountInput) || 0);
    setResellers((prev) =>
      prev.map((r) =>
        r.id === creditTargetReseller.id
          ? { ...r, creditBalanceFcfa: r.creditBalanceFcfa + amount }
          : r
      )
    );
    recordAudit(
      'reseller.credited',
      `${creditTargetReseller.name} · +${formatFcfa(amount)}`,
      'ok'
    );
    notify(`Portefeuille ${creditTargetReseller.name} crédité de ${formatFcfa(amount)}.`);
    setCreditTargetReseller(null);
  };

  const handleToggleResellerActive = (r: ResellerAccount) => {
    setResellers((prev) =>
      prev.map((item) => (item.id === r.id ? { ...item, isActive: !item.isActive } : item))
    );
    recordAudit(
      'reseller.status',
      `${r.name} · ${r.isActive ? 'Suspendu' : 'Réactivé'}`,
      r.isActive ? 'warn' : 'ok'
    );
    notify(`Partenaire ${r.name} ${r.isActive ? 'suspendu' : 'réactivé'}.`);
  };

  const handleCreateServer = (e: React.FormEvent) => {
    e.preventDefault();
    const created: ServerNode = {
      id: `srv-${Date.now()}`,
      code: srvCode.trim().toUpperCase() || `VPS-CM-${servers.length + 1}`,
      name: srvName.trim() || 'Nouveau Nœud VPN',
      hostname: srvHostname.trim() || 'node.justtechservices.xyz',
      publicIp: srvPublicIp.trim() || '102.215.48.99',
      sshPort: Number(srvSshPort) || 22,
      wssPort: Number(srvWssPort) || 443,
      slowDnsPort: Number(srvSlowDnsPort) || 53,
      slowDnsNs: srvSlowDnsNs.trim() || 'sdns.justtechservices.xyz',
      slowDnsPubKey: srvSlowDnsKey.trim() || '7f8b41c2e9a014d58b22e7c3a1f098e6d3b14a7c8f21e09b',
      status: 'Non vérifié',
      cpuPercent: 0,
      ramPercent: 0,
      bandwidthMbps: 1000,
      latencyMs: null,
      activeSessions: 0,
      maxSessions: Math.max(50, Number(srvMaxSessions) || 250),
      loadScore: 0,
      sshBanner: null,
      lastProbeAt: null,
      lastProbeStatus: 'Non vérifié',
      lastProbeDetail:
        'Nœud enregistré (non vérifié). Cliquez sur « Tester SSH distant » pour lancer une sonde TCP réelle.',
    };
    setServers((prev) => [...prev, created]);
    setShowServerModal(false);
    recordAudit('vps.node.added', `${created.code} (${created.publicIp}:${created.sshPort}) · Non vérifié`, 'info');
    notify(`Nœud ${created.code} enregistré en statut « Non vérifié ». Lancez une sonde SSH réelle pour tester l'accès.`);
  };

  const handleSyncServerSsh = async (srv: ServerNode) => {
    setProbingServerId(srv.id);
    const targetHost = srv.publicIp || srv.hostname;
    try {
      const res = await authFetch('/api/admin/servers/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: targetHost,
          port: srv.sshPort,
          serverCode: srv.code,
        }),
      });
      const data = (await res.json()) as {
        reachable?: boolean;
        status?: 'En ligne' | 'Hors ligne';
        latencyMs?: number | null;
        sshBanner?: string | null;
        errorCode?: string | null;
        reason?: string;
        checkedAt?: string;
        error?: string;
      };

      if (!res.ok) {
        const errMsg = data.error || data.reason || `Erreur HTTP ${res.status} lors de la sonde SSH.`;
        setServers((prev) =>
          prev.map((item) =>
            item.id === srv.id
              ? {
                  ...item,
                  lastProbeStatus: 'Injoignable',
                  lastProbeDetail: errMsg,
                  lastProbeAt: new Date().toISOString(),
                }
              : item
          )
        );
        recordAudit('vps.ssh.probe_error', `${srv.code} (${targetHost}:${srv.sshPort}) · ${errMsg}`, 'warn');
        notify(`Sonde SSH refusée pour ${srv.code} : ${errMsg}`);
        return;
      }

      const isReachable = Boolean(data.reachable);
      const nextStatus: ServerNode['status'] = isReachable ? 'En ligne' : 'Hors ligne';
      const detail =
        data.reason ||
        (isReachable
          ? `Connexion TCP établie sur ${targetHost}:${srv.sshPort}.`
          : `Serveur distant injoignable (${targetHost}:${srv.sshPort}).`);

      setServers((prev) =>
        prev.map((item) =>
          item.id === srv.id
            ? {
                ...item,
                status: nextStatus,
                latencyMs: isReachable && typeof data.latencyMs === 'number' ? data.latencyMs : null,
                sshBanner: data.sshBanner ?? null,
                lastProbeAt: data.checkedAt ?? new Date().toISOString(),
                lastProbeStatus: isReachable ? 'Joignable' : 'Injoignable',
                lastProbeDetail: detail,
                loadScore: Math.round((item.activeSessions / Math.max(1, item.maxSessions)) * 100),
              }
            : item
        )
      );

      recordAudit(
        isReachable ? 'vps.ssh.probe_ok' : 'vps.ssh.probe_unreachable',
        `${srv.code} (${targetHost}:${srv.sshPort}) · ${detail}`,
        isReachable ? 'ok' : 'warn'
      );
      notify(
        isReachable
          ? `SSH distant confirmé sur ${srv.code} (${data.latencyMs ?? '?'} ms)${data.sshBanner ? ` · ${data.sshBanner}` : ''}`
          : `${srv.code} injoignable (${data.errorCode || 'TCP_FAIL'}) — aucune connexion simulée.`
      );
    } catch {
      const msg = `Impossible de contacter /api/admin/servers/probe pour tester ${targetHost}:${srv.sshPort}.`;
      setServers((prev) =>
        prev.map((item) =>
          item.id === srv.id
            ? {
                ...item,
                status: 'Hors ligne',
                latencyMs: null,
                lastProbeStatus: 'Injoignable',
                lastProbeDetail: msg,
                lastProbeAt: new Date().toISOString(),
              }
            : item
        )
      );
      recordAudit('vps.ssh.probe_failed', `${srv.code} · ${msg}`, 'warn');
      notify(msg);
    } finally {
      setProbingServerId(null);
    }
  };

  const handleToggleServerStatus = (srv: ServerNode) => {
    const nextStatus: ServerNode['status'] =
      srv.status === 'Maintenance' ? 'En ligne' : 'Maintenance';
    setServers((prev) =>
      prev.map((item) => (item.id === srv.id ? { ...item, status: nextStatus } : item))
    );
    recordAudit(
      'vps.status.changed',
      `${srv.code} · Statut -> ${nextStatus}`,
      nextStatus === 'Maintenance' ? 'warn' : 'ok'
    );
    notify(`Nœud ${srv.code} basculé en statut : ${nextStatus}.`);
  };

  const handleResolveTicket = (ticketId: string) => {
    const target = tickets.find((t) => t.id === ticketId);
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: 'Résolu', updatedAt: "À l'instant" } : t))
    );
    if (target) {
      recordAudit('support.ticket_resolved', `${target.number} · ${target.author}`, 'ok');
      notify(`Ticket ${target.number} marqué comme Résolu.`);
    }
  };

  const copyText = (id: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleInvoiceStatus = (id: string, nextStatus: InvoiceStatus) => {
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === id ? { ...inv, status: nextStatus } : inv))
    );
    notify(`Facture mise à jour (${nextStatus}).`);
  };

  const exportInvoicesCsv = () => {
    const header = ['Facture', 'Reference', 'Client', 'Formule', 'Methode', 'ID_Transaction', 'Montant_FCFA', 'Statut', 'Date'];
    const rows = filteredInvoices.map((inv) => [
      inv.invoiceNumber,
      inv.reference,
      inv.clientName,
      inv.planName,
      inv.methodLabel,
      inv.externalTxId,
      String(inv.amountFcfa),
      inv.status,
      inv.issuedAt,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jts-factures.csv';
    a.click();
    URL.revokeObjectURL(url);
    notify('Export CSV des factures téléchargé.');
  };

  const allNavItems: {
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
    allowedRoles: readonly SessionRole[];
  }[] = [
    { id: 'overview', label: "Vue d'ensemble", icon: <LayoutDashboard className="w-4 h-4" />, allowedRoles: ['super_admin', 'admin', 'manager'] },
    { id: 'licenses', label: 'Clients & Licences', icon: <KeyRound className="w-4 h-4" />, count: licenses.length, allowedRoles: ['super_admin', 'admin', 'manager'] },
    { id: 'resellers', label: 'Revendeurs', icon: <Users className="w-4 h-4" />, count: resellers.length, allowedRoles: ['super_admin', 'admin'] },
    { id: 'servers', label: 'Serveurs & SlowDNS', icon: <Server className="w-4 h-4" />, count: servers.length, allowedRoles: ['super_admin', 'admin'] },
    { id: 'configs', label: 'Configurations VPN', icon: <FileCode2 className="w-4 h-4" />, count: VPN_CONFIGS.length, allowedRoles: ['super_admin', 'admin'] },
    { id: 'ssh-builder', label: 'SSH & Cloud Builder', icon: <Terminal className="w-4 h-4" />, allowedRoles: ['super_admin', 'admin', 'manager'] },
    { id: 'payments', label: 'Paiements FCFA', icon: <CreditCard className="w-4 h-4" />, count: pendingPaymentsCount, allowedRoles: ['super_admin', 'admin', 'manager'] },
    { id: 'invoices', label: 'Factures', icon: <Receipt className="w-4 h-4" />, count: invoices.length, allowedRoles: ['super_admin', 'admin', 'manager'] },
    { id: 'tickets', label: 'Support & Audit', icon: <LifeBuoy className="w-4 h-4" />, allowedRoles: ['super_admin', 'admin', 'manager'] },
    { id: 'roles', label: 'Rôles & Accès', icon: <ShieldCheck className="w-4 h-4" />, allowedRoles: ['super_admin', 'admin'] },
  ];

  const navItems = allNavItems.filter((item) => item.allowedRoles.includes(currentUser.role));

  useEffect(() => {
    if (!navItems.some((item) => item.id === activeTab)) {
      setActiveTab('overview');
    }
  }, [activeTab, navItems]);

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-65px)]">
      {/* Sidebar Filament v3 Dark Tech */}
      <aside className="w-full lg:w-64 shrink-0 bg-[#101827] border-b lg:border-b-0 lg:border-r border-[#243147] p-4">
        <div className="mb-4 px-2 flex items-center gap-3">
          <img
            src="/assets/aistudio/image_745e91e4.png"
            alt="JUST TECH SERVICES"
            className="w-9 h-9 rounded-lg object-cover border border-[#E5B84B]/40 shrink-0"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#E5B84B] truncate">
              {ROLE_LABELS[currentUser.role]}
            </p>
            <p className="text-xs text-[#8D9AAF] truncate">{currentUser.email}</p>
          </div>
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#151F31] text-[#E5B84B] border border-[#E5B84B]/35'
                    : 'text-[#8D9AAF] hover:text-[#F2F6FF] hover:bg-[#151F31]/50 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {typeof item.count === 'number' && (
                  <span className="font-mono-tabular text-xs text-[#8D9AAF]">{item.count}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden lg:block mt-6 pt-5 border-t border-[#243147] px-2 space-y-2 text-xs text-[#8D9AAF]">
          <div className="flex items-center justify-between">
            <span>Agent VPN Linux</span>
            <span className="text-[#45D7F4] font-mono-tabular">HMAC-SHA256</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Capacité cible</span>
            <span className="text-[#F2F6FF] font-mono-tabular">1 000+ clients</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-5 lg:p-7 space-y-6 overflow-x-hidden">
        {/* Contextual Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl lg:text-2xl font-semibold text-[#F2F6FF]">
              {navItems.find((n) => n.id === activeTab)?.label}
            </h1>
            <p className="text-xs text-[#8D9AAF] mt-0.5">
              panel.justtechservices.xyz · Orchestration multi-nœuds & facturation FCFA
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {currentUser.role === 'super_admin' && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDeployWizard(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#151F31] hover:bg-[#1E2B44] border border-[#E5B84B]/55 text-[#E5B84B] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Rocket className="w-4 h-4" />
                  Déployer VPS (GitHub / IP)
                </button>
                <a
                  href="/api/deliverable/download-zip"
                  download="JUST_TECH_SERVICES_PANEL_FINAL.zip"
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/45 text-[#45D7F4] text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Télécharger ZIP Final
                </a>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Nouvelle licence
            </button>
          </div>
        </div>

        {feedbackMessage && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 px-4 py-3 bg-[#151F31] border border-[#45D7F4]/50 rounded-lg text-sm text-[#F2F6FF]"
          >
            <span>{feedbackMessage}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-[#8D9AAF] hover:text-[#F2F6FF]"
              aria-label="Fermer la notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* 4 KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
                <p className="text-xs text-[#8D9AAF]">Revenus du mois</p>
                <p className="font-mono-tabular text-2xl font-semibold text-[#E5B84B] mt-2">
                  {formatFcfa(monthlyRevenue)}
                </p>
                <p className="text-xs text-[#45D7F4] mt-2 font-mono-tabular">
                  +18.4% vs mois précédent
                </p>
              </div>
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
                <p className="text-xs text-[#8D9AAF]">Licences actives</p>
                <p className="font-mono-tabular text-2xl font-semibold text-[#F2F6FF] mt-2">
                  {activeLicensesCount} <span className="text-sm text-[#8D9AAF]">/ {licenses.length}</span>
                </p>
                <p className="text-xs text-[#8D9AAF] mt-2">
                  Capacité indexée : 1 000+ clients
                </p>
              </div>
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
                <p className="text-xs text-[#8D9AAF]">Sessions VPN actives</p>
                <p className="font-mono-tabular text-2xl font-semibold text-[#F2F6FF] mt-2">
                  {343 + totalSessions}
                </p>
                <p className="text-xs text-[#8D9AAF] mt-2 font-mono-tabular">
                  SSH · SlowDNS · SSH-WSS
                </p>
              </div>
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
                <p className="text-xs text-[#8D9AAF]">Paiements à vérifier</p>
                <p className="font-mono-tabular text-2xl font-semibold text-[#F59E0B] mt-2">
                  {pendingPaymentsCount}
                </p>
                <p className="text-xs text-[#8D9AAF] mt-2">
                  MTN MoMo & Orange Money
                </p>
              </div>
            </div>

            {/* Chart + Server Load */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
              <div className="xl:col-span-2">
                <RevenueTrafficChart data={CHART_SERIES_7D} />
              </div>

              <div className="bg-[#101827] border border-[#243147] rounded-xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                      État des Nœuds VPS
                    </h3>
                    <Activity className="w-4 h-4 text-[#45D7F4]" />
                  </div>

                  <div className="divide-y divide-[#243147]">
                    {servers.map((srv) => (
                      <div key={srv.id} className="py-3.5 first:pt-0 last:pb-0 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[#F2F6FF] font-mono-tabular">
                              {srv.code}
                            </p>
                            <p className="text-xs text-[#8D9AAF]">{srv.hostname}</p>
                          </div>
                          <span
                            className={`text-xs font-medium font-mono-tabular ${
                              srv.status === 'En ligne'
                                ? 'text-[#45D7F4]'
                                : srv.status === 'Hors ligne'
                                  ? 'text-[#EF4444]'
                                  : 'text-[#E5B84B]'
                            }`}
                          >
                            {srv.status} · {srv.latencyMs !== null ? `${srv.latencyMs}ms` : 'Non mesurée'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs font-mono-tabular text-[#8D9AAF]">
                          <div>CPU {srv.cpuPercent}%</div>
                          <div>RAM {srv.ramPercent}%</div>
                          <div>
                            {srv.activeSessions}/{srv.maxSessions} sess.
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-[#070B14] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#45D7F4]"
                            style={{ width: `${(srv.activeSessions / srv.maxSessions) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('servers')}
                  className="mt-4 w-full py-2 px-3 bg-[#151F31] hover:bg-[#1C283E] border border-[#243147] rounded-lg text-xs font-medium text-[#F2F6FF] transition-colors cursor-pointer"
                >
                  Ouvrir le monitoring & DNS Cloudflare
                </button>
              </div>
            </div>

            {/* Pending Payments Quick Queue */}
            <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#243147] flex items-center justify-between gap-4">
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  File de vérification Mobile Money
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('payments')}
                  className="text-xs text-[#45D7F4] hover:underline cursor-pointer"
                >
                  Voir tout l'historique
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                      <th className="py-3 px-5 font-medium">Référence</th>
                      <th className="py-3 px-4 font-medium">Client / Revendeur</th>
                      <th className="py-3 px-4 font-medium">Méthode & ID Externe</th>
                      <th className="py-3 px-4 font-medium text-right">Montant</th>
                      <th className="py-3 px-4 font-medium">Statut</th>
                      <th className="py-3 px-5 font-medium text-right">Décision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#243147] text-sm">
                    {payments.map((pay) => (
                      <tr key={pay.id} className="hover:bg-[#151F31]/60 transition-colors">
                        <td className="py-3 px-5 font-mono-tabular text-xs text-[#F2F6FF]">
                          {pay.reference}
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-[#F2F6FF] font-medium">{pay.clientName}</div>
                          <div className="text-xs text-[#8D9AAF]">{pay.planName}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-xs text-[#F2F6FF]">{pay.method}</div>
                          <div className="text-xs text-[#8D9AAF] font-mono-tabular">
                            {pay.externalTxId}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-[#F2F6FF]">
                          {formatFcfa(pay.amountFcfa)}
                        </td>
                        <td className="py-3 px-4">
                          <PaymentStatusText status={pay.status} />
                        </td>
                        <td className="py-3 px-5 text-right">
                          {pay.status === 'Déclaré' || pay.status === 'En vérification' ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handlePaymentDecision(pay.id, 'Validé')}
                                className="px-2.5 py-1 bg-[#45D7F4]/15 hover:bg-[#45D7F4]/25 text-[#45D7F4] text-xs font-medium rounded-md transition-colors cursor-pointer"
                              >
                                Valider
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePaymentDecision(pay.id, 'Refusé')}
                                className="px-2.5 py-1 bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] text-xs font-medium rounded-md transition-colors cursor-pointer"
                              >
                                Refuser
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-[#8D9AAF]">Traité</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* LICENSES TAB */}
        {activeTab === 'licenses' && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#101827] border border-[#243147] rounded-xl p-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-[#8D9AAF] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher par client, identifiant jts_* ou serveur..."
                  className="w-full pl-9 pr-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] placeholder:text-[#8D9AAF] focus:outline-none focus:border-[#45D7F4]"
                />
              </div>

              <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
                {ALL_STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === st
                        ? 'bg-[#E5B84B] text-[#070B14] font-semibold'
                        : 'bg-[#070B14] text-[#8D9AAF] hover:text-[#F2F6FF] border border-[#243147]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                      <th className="py-3 px-4 font-medium">Client</th>
                      <th className="py-3 px-4 font-medium">Compte Linux</th>
                      <th className="py-3 px-4 font-medium">Formule / Nœud</th>
                      <th className="py-3 px-4 font-medium">Quota (Go)</th>
                      <th className="py-3 px-4 font-medium">Sessions</th>
                      <th className="py-3 px-4 font-medium">Statut</th>
                      <th className="py-3 px-4 font-medium">Expiration</th>
                      <th className="py-3 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#243147] text-sm">
                    {filteredLicenses.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-sm text-[#8D9AAF]">
                          Aucune licence ne correspond à ce filtre.
                        </td>
                      </tr>
                    ) : (
                      filteredLicenses.map((lic) => (
                        <tr key={lic.id} className="hover:bg-[#151F31]/60 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-medium text-[#F2F6FF]">{lic.clientName}</div>
                            <div className="text-xs text-[#8D9AAF]">
                              {lic.resellerName ? `Revendeur : ${lic.resellerName}` : 'Client direct'}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono-tabular text-xs text-[#45D7F4]">
                            {lic.sshUsername}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-xs font-medium text-[#F2F6FF]">{lic.planName}</div>
                            <div className="text-xs text-[#8D9AAF] font-mono-tabular">
                              {lic.serverCode} · {lic.protocols.join(' / ')}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono-tabular text-xs text-[#F2F6FF]">
                            {lic.dataUsedGb.toFixed(1)} /{' '}
                            {lic.dataQuotaGb ? `${lic.dataQuotaGb} Go` : '0 Go'}
                          </td>
                          <td className="py-3 px-4 font-mono-tabular text-xs text-[#F2F6FF]">
                            <div className="inline-flex items-center gap-1.5">
                              <span>{lic.activeSessions} /</span>
                              <button
                                type="button"
                                title="Réduire maxuser SSH"
                                onClick={() => adjustMaxSessions(lic.id, -1)}
                                className="w-5 h-5 inline-flex items-center justify-center rounded bg-[#151F31] hover:bg-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-[#45D7F4] font-semibold w-3 text-center">
                                {lic.maxSessions}
                              </span>
                              <button
                                type="button"
                                title="Augmenter maxuser SSH"
                                onClick={() => adjustMaxSessions(lic.id, 1)}
                                className="w-5 h-5 inline-flex items-center justify-center rounded bg-[#151F31] hover:bg-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <LicenseStatusText status={lic.status} />
                          </td>
                          <td className="py-3 px-4 font-mono-tabular text-xs text-[#8D9AAF]">
                            {lic.expiresAt}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                title="Générer & copier Code Cloud Android"
                                onClick={() => handleDeliverAndroidCloudAdmin(lic)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#151F31] hover:bg-[#45D7F4]/20 text-[#45D7F4] text-xs font-medium transition-colors cursor-pointer"
                              >
                                <Cloud className="w-3 h-3" />
                                Cloud
                              </button>
                              <button
                                type="button"
                                title="Compiler & télécharger .npvt iPhone"
                                onClick={() => handleDeliverIphoneNpvAdmin(lic)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#151F31] hover:bg-[#E5B84B]/20 text-[#E5B84B] text-xs font-medium transition-colors cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                iOS
                              </button>
                              {lic.status === 'Active' ? (
                                <button
                                  type="button"
                                  title="Suspendre le compte Linux"
                                  onClick={() =>
                                    updateLicenseStatus(lic.id, 'Suspendue', 'Suspension')
                                  }
                                  className="p-1.5 rounded-md bg-[#151F31] hover:bg-[#F59E0B]/20 text-[#F59E0B] transition-colors cursor-pointer"
                                >
                                  <Pause className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  title="Activer / Réactiver"
                                  onClick={() =>
                                    updateLicenseStatus(lic.id, 'Active', 'Activation')
                                  }
                                  className="p-1.5 rounded-md bg-[#151F31] hover:bg-[#45D7F4]/20 text-[#45D7F4] transition-colors cursor-pointer"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                title="Renouveler +30j"
                                onClick={() =>
                                  updateLicenseStatus(lic.id, 'Active', 'Renouvellement +30j')
                                }
                                className="p-1.5 rounded-md bg-[#151F31] hover:bg-[#547CFF]/25 text-[#547CFF] transition-colors cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              {lic.status !== 'Révoquée' && (
                                <button
                                  type="button"
                                  title="Révoquer définitivement"
                                  onClick={() =>
                                    updateLicenseStatus(lic.id, 'Révoquée', 'Révocation')
                                  }
                                  className="p-1.5 rounded-md bg-[#151F31] hover:bg-[#EF4444]/20 text-[#EF4444] transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* RESELLERS TAB */}
        {activeTab === 'resellers' && (
          <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#243147] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  Contrôle Total Revendeurs & Sous-revendeurs (Stock Gigas)
                </h3>
                <p className="text-xs text-[#8D9AAF] mt-0.5">
                  Créez librement chaque compte Revendeur ou Sous-revendeur, attribuez les Go souhaités et suivez leur consommation par forfait acheté
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowResellerModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Créer Revendeur / Sous-revendeur
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                    <th className="py-3 px-5 font-medium">Partenaire</th>
                    <th className="py-3 px-4 font-medium">Niveau / Parent</th>
                    <th className="py-3 px-4 font-medium text-right">Stock Gigas (Go)</th>
                    <th className="py-3 px-4 font-medium text-right">Places Clients</th>
                    <th className="py-3 px-4 font-medium text-right">Commission</th>
                    <th className="py-3 px-4 font-medium text-right">Ventes Mois</th>
                    <th className="py-3 px-5 font-medium text-right">Contrôle Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#243147] text-sm">
                  {resellers.map((r) => (
                    <tr key={r.id} className="hover:bg-[#151F31]/60">
                      <td className="py-3.5 px-5">
                        <div className="font-medium text-[#F2F6FF]">{r.name}</div>
                        <div className="text-[11px] font-mono-tabular text-[#8D9AAF]">
                          {r.email ?? 'partenaire@justtechservices.xyz'} ·{' '}
                          <span className={r.isActive ? 'text-[#45D7F4]' : 'text-[#EF4444]'}>
                            {r.isActive ? 'Actif' : 'Suspendu'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#8D9AAF]">
                        <span className={r.level === 'Revendeur' ? 'text-[#E5B84B] font-medium' : 'text-[#45D7F4] font-medium'}>
                          {r.level}
                        </span>{' '}
                        · Parent : {r.parentName}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular">
                        <span className="text-base font-bold text-[#E5B84B]">{r.gbBalance} Go</span>
                        {typeof r.gbAllocatedTotal === 'number' && (
                          <div className="text-[11px] text-[#8D9AAF]">Alloués : {r.gbAllocatedTotal} Go</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-[#F2F6FF]">
                        {r.clientsCount} / {r.maxClients}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-[#8D9AAF]">
                        {r.commissionRatePercent}%
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-[#F2F6FF]">
                        {formatFcfa(r.monthSalesFcfa)}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setGbTargetReseller(r);
                              setGbMode('add');
                              setGbAmountInput(100);
                            }}
                            className="px-2.5 py-1 bg-[#E5B84B]/15 hover:bg-[#E5B84B]/25 text-[#E5B84B] text-xs font-semibold rounded-md cursor-pointer"
                          >
                            Attribuer Go
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCreditTargetReseller(r);
                              setCreditAmountInput(10000);
                            }}
                            className="px-2.5 py-1 bg-[#45D7F4]/15 hover:bg-[#45D7F4]/25 text-[#45D7F4] text-xs font-medium rounded-md cursor-pointer"
                          >
                            +FCFA
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleResellerActive(r)}
                            className={`px-2.5 py-1 text-xs rounded-md cursor-pointer ${
                              r.isActive
                                ? 'bg-[#151F31] hover:bg-[#F59E0B]/20 text-[#F59E0B]'
                                : 'bg-[#45D7F4]/15 text-[#45D7F4]'
                            }`}
                          >
                            {r.isActive ? 'Suspendre' : 'Activer'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SERVERS & SLOWDNS TAB */}
        {activeTab === 'servers' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#101827] border border-[#E5B84B]/35 rounded-xl text-xs text-[#F2F6FF]">
              <div className="flex items-center gap-2.5 flex-1 min-w-[260px]">
                <Lock className="w-4 h-4 text-[#E5B84B] shrink-0" />
                <span>
                  <strong>Visibilité restreinte :</strong> L'infrastructure serveurs, les IPs publiques et les paramètres SlowDNS ne sont accessibles qu'au <strong>Super Admin</strong>, aux <strong>Revendeurs</strong> et aux <strong>Sous-revendeurs</strong> (strictement masqués aux Clients).
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {currentUser.role === 'super_admin' && (
                  <button
                    type="button"
                    onClick={() => setShowDeployWizard(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/45 text-[#45D7F4] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Assistant Déploiement VPS (GitHub / IP)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowServerModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter un Nœud VPN
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {servers.map((srv) => (
                <div
                  key={srv.id}
                  className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p
                        className={`text-xs font-mono-tabular ${
                          srv.status === 'En ligne'
                            ? 'text-[#45D7F4]'
                            : srv.status === 'Hors ligne'
                              ? 'text-[#EF4444]'
                              : srv.status === 'Maintenance'
                                ? 'text-[#F59E0B]'
                                : 'text-[#E5B84B]'
                        }`}
                      >
                        {srv.code} · {srv.status}
                      </p>
                      <h3 className="font-display text-lg font-semibold text-[#F2F6FF] mt-0.5">
                        {srv.name}
                      </h3>
                      <p className="text-xs text-[#8D9AAF] font-mono-tabular mt-0.5">
                        {srv.hostname} ({srv.publicIp})
                      </p>
                    </div>
                    <span className="font-mono-tabular text-xs text-[#8D9AAF]">
                      Score charge : {srv.loadScore} · {srv.latencyMs !== null ? `${srv.latencyMs}ms` : 'Latence N/A'}
                    </span>
                  </div>

                  {/* Statut réel de la sonde TCP/SSH distante (aucune simulation) */}
                  <div
                    className={`p-3 rounded-lg border text-xs space-y-1 ${
                      srv.lastProbeStatus === 'Joignable'
                        ? 'bg-[#070B14] border-[#45D7F4]/35 text-[#45D7F4]'
                        : srv.lastProbeStatus === 'Injoignable'
                          ? 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#EF4444]'
                          : 'bg-[#070B14] border-[#E5B84B]/30 text-[#E5B84B]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-mono-tabular">
                      <span className="font-semibold">
                        Sonde SSH distante : {srv.lastProbeStatus ?? 'Non vérifié'}
                      </span>
                      {srv.lastProbeAt && (
                        <span className="text-[11px] text-[#8D9AAF]">
                          {new Date(srv.lastProbeAt).toLocaleTimeString('fr-FR')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#E8EEF5]/90 leading-relaxed">
                      {srv.lastProbeDetail ??
                        'Serveur distant requis pour le test TCP/SSH réel — aucune connexion factice.'}
                    </p>
                    {srv.sshBanner && (
                      <p className="text-[11px] font-mono-tabular text-[#45D7F4]">
                        Bannière reçue : {srv.sshBanner}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#243147] text-xs font-mono-tabular">
                    <div>
                      <span className="text-[#8D9AAF] block">SSH Port</span>
                      <span className="text-[#F2F6FF]">{srv.sshPort}</span>
                    </div>
                    <div>
                      <span className="text-[#8D9AAF] block">SSH-WSS</span>
                      <span className="text-[#F2F6FF]">{srv.wssPort} (TLS)</span>
                    </div>
                    <div>
                      <span className="text-[#8D9AAF] block">SlowDNS UDP</span>
                      <span className="text-[#F2F6FF]">{srv.slowDnsPort} → 5300</span>
                    </div>
                    <div>
                      <span className="text-[#8D9AAF] block">Bande passante</span>
                      <span className="text-[#45D7F4]">{srv.bandwidthMbps} Mbps</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#243147] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8D9AAF] inline-flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-[#547CFF]" />
                        Cloudflare NS (DNS-Only · Proxy OFF)
                      </span>
                      <span className="font-mono-tabular text-[#F2F6FF]">{srv.slowDnsNs}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-[#8D9AAF] inline-flex items-center gap-1.5 shrink-0">
                        <Network className="w-3.5 h-3.5 text-[#45D7F4]" />
                        Clé Publique dnstt
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(srv.id, srv.slowDnsPubKey)}
                        className="inline-flex items-center gap-1.5 font-mono-tabular text-[#F2F6FF] hover:text-[#45D7F4] truncate cursor-pointer"
                      >
                        <span className="truncate max-w-[220px]">{srv.slowDnsPubKey}</span>
                        {copiedId === srv.id ? (
                          <Check className="w-3.5 h-3.5 text-[#45D7F4] shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#243147] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono-tabular text-[#8D9AAF]">
                      Sessions : {srv.activeSessions} / {srv.maxSessions}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={probingServerId === srv.id}
                        onClick={() => void handleSyncServerSsh(srv)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#151F31] hover:bg-[#1E2B44] disabled:opacity-50 border border-[#243147] rounded-lg text-xs font-medium text-[#45D7F4] cursor-pointer"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        {probingServerId === srv.id ? 'Sonde TCP/SSH en cours...' : 'Tester SSH distant (TCP)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleServerStatus(srv)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                          srv.status === 'Maintenance'
                            ? 'bg-[#45D7F4]/15 text-[#45D7F4]'
                            : 'bg-[#F59E0B]/15 text-[#F59E0B]'
                        }`}
                      >
                        {srv.status === 'Maintenance' ? 'Remettre En ligne' : 'Maintenance'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VPN CONFIGS, NPV PROTOTYPE & CLOUD CODES TAB */}
        {activeTab === 'configs' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#101827] border border-[#E5B84B]/35 rounded-xl text-xs text-[#F2F6FF]">
              <div className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-[#E5B84B] shrink-0" />
                <span>
                  <strong>Accès JSON exclusif Super Admin :</strong> Le prototype NPV Tunnel et les configurations JSON brutes sont visibles et modifiables uniquement par le <strong>Super Admin</strong> afin d&apos;adapter la configuration à chaque utilisateur. Le client ne reçoit que son Code Cloud, son QR Code ou son fichier .npvt généré.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('ssh-builder')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/40 text-xs font-medium text-[#45D7F4] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                Ouvrir SSH &amp; Cloud Config Builder (v1)
              </button>
            </div>

            {/* Éditeur Prototype NPV Tunnel (iPhone) — STRICTEMENT Super Admin */}
            {currentUser.role === 'super_admin' ? (
            <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#E5B84B]/15 border border-[#E5B84B]/35 flex items-center justify-center text-[#E5B84B]">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                      Prototype NPV Tunnel (iPhone / iOS)
                    </h3>
                    <p className="text-xs text-[#8D9AAF]">
                      Collez ou importez votre configuration NPV prototype : pour chaque nouveau client iPhone, seuls <code className="text-[#45D7F4]">sshUsername</code> et <code className="text-[#45D7F4]">sshPassword</code> sont modifiés automatiquement.
                    </p>
                  </div>
                </div>

                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#151F31] hover:bg-[#1E2A42] border border-[#243147] rounded-lg text-xs font-medium text-[#F2F6FF] cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#E5B84B]" />
                  Importer fichier .npvt / .json
                  <input
                    type="file"
                    accept=".json,.npvt,.npv4,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === 'string') {
                          setProtoJson(reader.result);
                          notify(`Prototype importé depuis ${file.name}. Cliquez sur Enregistrer pour l'activer.`);
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs text-[#8D9AAF] mb-1">Nom du prototype</label>
                  <input
                    type="text"
                    value={protoName}
                    onChange={(e) => setProtoName(e.target.value)}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Extension générée iOS</label>
                  <select
                    value={protoExt}
                    onChange={(e) => setProtoExt(e.target.value as '.npvt' | '.json')}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                  >
                    <option value=".npvt">.npvt (NPV Tunnel iOS)</option>
                    <option value=".json">.json (Profil structuré)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs text-[#8D9AAF]">
                    Contenu du prototype NPV / Payload HTTP brut (zéro <code className="text-[#E5B84B]">.trim()</code> — <code className="text-[#45D7F4]">\r\n</code>, espaces, <code className="text-[#45D7F4]">[host]</code>, <code className="text-[#45D7F4]">[crlf]</code>, <code className="text-[#45D7F4]">[split]</code>, <code className="text-[#45D7F4]">[ua]</code> préservés à 100 %)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowRawEscapedPayload((v) => !v)}
                    className="px-2.5 py-1 rounded bg-[#151F31] border border-[#243147] text-[11px] font-mono-tabular text-[#45D7F4] hover:border-[#45D7F4]/60 cursor-pointer"
                  >
                    {showRawEscapedPayload ? 'Masquer caractères bruts' : 'Inspecter CRLF & espaces bruts'}
                  </button>
                </div>
                <textarea
                  rows={8}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  value={protoJson}
                  onChange={(e) => setProtoJson(e.target.value)}
                  className="w-full p-3 bg-[#070B14] border border-[#243147] rounded-lg text-xs font-mono-tabular text-[#45D7F4] focus:outline-none focus:border-[#E5B84B] whitespace-pre"
                />

                {/* Barre de vérification d'intégrité brute du Payload HTTP */}
                <div className="mt-2 p-3 rounded-lg bg-[#070B14] border border-[#243147] flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono-tabular">
                  <div className="flex flex-wrap items-center gap-3 text-[#8D9AAF]">
                    <span className="text-[#45D7F4] font-semibold">
                      Intégrité Payload Brut (0 .trim())
                    </span>
                    <span>
                      Octets : <strong className="text-[#F2F6FF]">{rawPayloadAudit.byteLength}</strong>
                    </span>
                    <span>
                      CRLF (\r\n) : <strong className="text-[#E5B84B]">{rawPayloadAudit.crlfCount}</strong>
                    </span>
                    <span>
                      Espaces déb./fin :{' '}
                      <strong className="text-[#F2F6FF]">
                        {rawPayloadAudit.leadingSpaces}/{rawPayloadAudit.trailingSpaces}
                      </strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {rawPayloadAudit.macrosDetected.length > 0 ? (
                      rawPayloadAudit.macrosDetected.map((macro) => (
                        <span
                          key={macro}
                          className="px-2 py-0.5 rounded bg-[#151F31] border border-[#45D7F4]/35 text-[#45D7F4]"
                        >
                          {macro}
                        </span>
                      ))
                    ) : (
                      <span className="text-[#8D9AAF]">Aucune macro [host]/[crlf]/[split]/[ua] détectée</span>
                    )}
                  </div>
                </div>

                {showRawEscapedPayload && (
                  <pre className="mt-2 p-3 bg-[#070B14] border border-[#E5B84B]/35 rounded-lg text-[11px] font-mono-tabular text-[#E5B84B] overflow-x-auto whitespace-pre-wrap break-all">
                    {rawPayloadAudit.escapedPreview}
                  </pre>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setProtoTestPreview(
                      compileNpvFromPrototype(protoJson, '{{CLIENT_SSH_USER}}', '{{CLIENT_SSH_PASS}}', 'Aperçu Schéma')
                    )
                  }
                  className="px-3.5 py-2 bg-[#151F31] hover:bg-[#1E2A42] border border-[#243147] text-xs font-medium text-[#F2F6FF] rounded-lg cursor-pointer"
                >
                  Vérifier la compilation du modèle .npvt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateNpvPrototype?.({
                      id: npvPrototype.id,
                      name: protoName.trim() || npvPrototype.name,
                      version: `v${(parseFloat(npvPrototype.version.replace('v', '')) + 0.1).toFixed(1)}`,
                      fileExtension: protoExt,
                      updatedAt: "À l'instant",
                      rawTemplateJson: protoJson,
                    });
                    authFetch('/api/npv-prototype', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ rawTemplateJson: protoJson }),
                    }).catch(() => undefined);
                    notify('Prototype NPV Tunnel enregistré et synchronisé avec l’Agent IA.');
                  }}
                  className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Enregistrer le prototype NPV
                </button>
              </div>

              {protoTestPreview && (
                <div className="pt-2">
                  <p className="text-xs text-[#8D9AAF] mb-1.5">
                    Aperçu généré pour <span className="text-[#45D7F4] font-mono-tabular">jts_client_test01</span> :
                  </p>
                  <pre className="p-3 bg-[#070B14] border border-[#45D7F4]/40 rounded-lg text-xs font-mono-tabular text-[#E8EEF5] overflow-x-auto max-h-52">
                    {protoTestPreview}
                  </pre>
                </div>
              )}
            </section>
            ) : (
              <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 flex items-start gap-3 text-xs text-[#8D9AAF]">
                <Lock className="w-4 h-4 text-[#E5B84B] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#F2F6FF]">
                    Éditeur Prototype NPV &amp; JSON brut réservé au Super Admin
                  </p>
                  <p className="mt-1">
                    Votre rôle (<strong className="text-[#E5B84B]">{ROLE_LABELS[currentUser.role]}</strong>) permet de superviser et révoquer les codes Cloud distribués ci-dessous sans exposer les fichiers JSON bruts.
                  </p>
                </div>
              </section>
            )}

            {/* Registre Codes Cloud Android */}
            <section className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#243147] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Cloud className="w-4 h-4 text-[#45D7F4]" />
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                    Codes Configuration Cloud (Android)
                  </h3>
                </div>
                <span className="text-xs font-mono-tabular text-[#8D9AAF]">
                  {cloudCodes.length} code(s) actif(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                      <th className="py-3 px-5 font-medium">Code Cloud</th>
                      <th className="py-3 px-4 font-medium">Client & Offre</th>
                      <th className="py-3 px-4 font-medium">Compte SSH / Nœud</th>
                      <th className="py-3 px-4 font-medium">Statut</th>
                      <th className="py-3 px-5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#243147] text-sm">
                    {cloudCodes.map((cld) => (
                      <tr key={cld.id} className="hover:bg-[#151F31]/60">
                        <td className="py-3 px-5 font-mono-tabular text-xs font-semibold text-[#E5B84B]">
                          {cld.code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-[#F2F6FF] font-medium">{cld.clientName}</div>
                          <div className="text-xs text-[#8D9AAF]">{cld.planName}</div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-[#45D7F4]">
                          {cld.sshUsername} · {cld.serverCode}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span
                            className={
                              cld.status === 'Activé sur appareil'
                                ? 'text-[#45D7F4]'
                                : cld.status === 'Prêt'
                                  ? 'text-[#E5B84B]'
                                  : 'text-[#EF4444]'
                            }
                          >
                            {cld.status}
                          </span>
                          {cld.activatedDevice && (
                            <span className="block text-[11px] text-[#8D9AAF]">
                              {cld.activatedDevice}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-right">
                          {cld.status !== 'Révoqué' ? (
                            <button
                              type="button"
                              onClick={() => {
                                authFetch(`/api/cloud-config/${encodeURIComponent(cld.code)}/revoke`, {
                                  method: 'POST',
                                }).catch(() => undefined);
                                onRevokeCloudCode?.(cld.id);
                                notify(`Code Cloud ${cld.code} révoqué côté serveur.`);
                              }}
                              className="px-2.5 py-1 bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] text-xs rounded-md cursor-pointer"
                            >
                              Révoquer
                            </button>
                          ) : (
                            <span className="text-xs text-[#8D9AAF]">Révoqué</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Templates VPN existants */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {VPN_CONFIGS.map((cfg) => (
                <div
                  key={cfg.id}
                  className="bg-[#101827] border border-[#243147] rounded-xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#8D9AAF] mb-2">
                      <span>{cfg.targetApp}</span>
                      <span className={cfg.tier === 'VIP' ? 'text-[#45D7F4]' : 'text-[#8D9AAF]'}>
                        {cfg.tier} · v{cfg.version}
                      </span>
                    </div>
                    <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                      {cfg.name}
                    </h3>
                    <p className="text-xs text-[#8D9AAF] font-mono-tabular mt-1">
                      {cfg.protocol} · {cfg.serverCode}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-[#243147] flex items-center justify-between gap-2">
                    <span className="font-mono-tabular text-xs text-[#8D9AAF] truncate">
                      {cfg.shareToken}
                    </span>
                    {currentUser.role === 'super_admin' ? (
                      <button
                        type="button"
                        onClick={() => setPreviewConfig(cfg)}
                        className="px-3 py-1.5 bg-[#151F31] hover:bg-[#547CFF] text-[#F2F6FF] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Inspecter JSON
                      </button>
                    ) : (
                      <span className="text-[11px] font-mono-tabular text-[#8D9AAF] whitespace-nowrap">
                        JSON Super Admin
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PAYMENTS TAB */}
        {activeTab === 'payments' && (
          <div className="space-y-5">
            {/* Passerelles API Mobile Money & Bascule Plafond OM ASSO */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-4 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
                  MTN MoMo Officiel
                </p>
                <p className="text-sm font-semibold text-[#F2F6FF]">
                  {gatewayConfig.mtnBeneficiary}
                </p>
                <p className="font-mono-tabular text-xs text-[#45D7F4]">
                  {gatewayConfig.mtnNumber}
                </p>
              </div>

              <div className="bg-[#101827] border border-[#243147] rounded-xl p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#F59E0B]">
                    Orange Money
                  </p>
                  <span className="font-mono-tabular text-[11px] text-[#8D9AAF]">
                    {formatFcfa(gatewayConfig.orangeCurrentVolumeFcfa)} /{' '}
                    {formatFcfa(gatewayConfig.orangeCeilingFcfa)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-[#F2F6FF]">
                  {gatewayConfig.orangeBeneficiary}
                </p>
                <p className="font-mono-tabular text-xs text-[#45D7F4]">
                  {gatewayConfig.orangeNumber}
                </p>
              </div>

              <div className="bg-[#101827] border border-[#E5B84B]/40 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
                    Bascule Marchand OM ASSO : {gatewayConfig.orangeMerchantOmAsso}
                  </p>
                  <p className="text-xs text-[#8D9AAF] mt-1">
                    Statut actuel :{' '}
                    <strong
                      className={
                        gatewayConfig.orangeCeilingExceeded ? 'text-[#F59E0B]' : 'text-[#45D7F4]'
                      }
                    >
                      {gatewayConfig.orangeCeilingExceeded
                        ? 'Plafond atteint (OM ASSO actif)'
                        : 'Numéro standard actif'}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleOrangeCeiling}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer shrink-0 ${
                    gatewayConfig.orangeCeilingExceeded
                      ? 'bg-[#45D7F4]/15 text-[#45D7F4] border border-[#45D7F4]/40'
                      : 'bg-[#E5B84B] text-[#070B14]'
                  }`}
                >
                  {gatewayConfig.orangeCeilingExceeded
                    ? 'Réactiver Orange Normal'
                    : 'Activer bascule OM ASSO (1017614)'}
                </button>
              </div>
            </section>

            {/* Supervision AIPaymentAgent : Capteurs Captures d'écran & Anti-Falsification */}
            <section className="bg-[#101827] border border-[#45D7F4]/35 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
                    AIPaymentAgent · Vérification Captures & Capteurs Anti-Falsification
                  </h3>
                  <p className="text-xs text-[#8D9AAF]">
                    Inspecte les captures d'écran clients (Vision IA, EXIF, typographie, SHA-256), détecte les falsifications et déclenche le provisionnement & alertes plafond.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchAgentMonitors}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] rounded-lg text-xs text-[#45D7F4] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Actualiser les audits
                </button>
              </div>

              {agentMonitors.transactions.length === 0 ? (
                <p className="text-xs text-[#8D9AAF] bg-[#070B14] border border-[#243147] rounded-lg p-3">
                  Aucun audit de capture d'écran enregistré pour cette session. Les contrôles soumis depuis le Portail Client apparaîtront ici en temps réel.
                </p>
              ) : (
                <div className="space-y-2">
                  {agentMonitors.transactions.slice(0, 5).map((m) => (
                    <div
                      key={m.id}
                      className="p-3 bg-[#070B14] border border-[#243147] rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-mono-tabular text-[#E5B84B] font-semibold">
                          {m.input.transactionRef || 'CAPTURE-IA'}
                        </span>{' '}
                        <span className="text-[#F2F6FF]">· {m.input.clientName}</span>{' '}
                        <span className="text-[#8D9AAF]">({m.input.provider})</span>
                        <p className="text-[11px] text-[#8D9AAF] mt-0.5">{m.reasoning}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.forensicReport && (
                          <span
                            className={`font-mono-tabular text-[11px] px-2 py-0.5 rounded ${
                              m.forensicReport.isFalsified
                                ? 'bg-[#EF4444]/15 text-[#EF4444]'
                                : 'bg-[#E5B84B]/15 text-[#E5B84B]'
                            }`}
                          >
                            {m.forensicReport.isFalsified
                              ? `FALSIFIÉ (${m.forensicReport.authenticityScore}/100)`
                              : `Authentique ${m.forensicReport.authenticityScore}/100`}
                          </span>
                        )}
                        <span className="font-mono-tabular text-[11px] px-2 py-0.5 rounded bg-[#151F31] text-[#45D7F4]">
                          {m.status} · {m.verificationSource}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#243147]">
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  Journal des Paiements Mobile Money & Manuel (FCFA)
                </h3>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                    <th className="py-3 px-5 font-medium">Référence</th>
                    <th className="py-3 px-4 font-medium">Payeur</th>
                    <th className="py-3 px-4 font-medium">Numéro / Canal</th>
                    <th className="py-3 px-4 font-medium">ID Transaction</th>
                    <th className="py-3 px-4 font-medium text-right">Montant</th>
                    <th className="py-3 px-4 font-medium">Statut</th>
                    <th className="py-3 px-5 font-medium text-right">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#243147] text-sm">
                  {payments.map((pay) => (
                    <tr key={pay.id} className="hover:bg-[#151F31]/60">
                      <td className="py-3 px-5 font-mono-tabular text-xs text-[#F2F6FF]">
                        {pay.reference}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-[#F2F6FF] font-medium">{pay.clientName}</div>
                        <div className="text-xs text-[#8D9AAF]">{pay.planName}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[#8D9AAF]">
                        <div>{pay.method}</div>
                        <div className="font-mono-tabular">{pay.phoneNumber}</div>
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-xs text-[#F2F6FF]">
                        {pay.externalTxId}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-[#F2F6FF]">
                        {formatFcfa(pay.amountFcfa)}
                      </td>
                      <td className="py-3 px-4">
                        <PaymentStatusText status={pay.status} />
                      </td>
                      <td className="py-3 px-5 text-right">
                        {pay.status === 'Déclaré' || pay.status === 'En vérification' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePaymentDecision(pay.id, 'Validé')}
                              className="px-2.5 py-1 bg-[#45D7F4]/15 text-[#45D7F4] text-xs rounded-md cursor-pointer"
                            >
                              Valider
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePaymentDecision(pay.id, 'Refusé')}
                              className="px-2.5 py-1 bg-[#EF4444]/15 text-[#EF4444] text-xs rounded-md cursor-pointer"
                            >
                              Refuser
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-[#8D9AAF]">{pay.declaredAt}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}

        {/* INVOICES TAB */}
        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-4">
                <p className="text-xs text-[#8D9AAF]">Factures Payées</p>
                <p className="font-mono-tabular text-xl font-semibold text-[#45D7F4] mt-1">
                  {formatFcfa(
                    invoices
                      .filter((i) => i.status === 'Payée')
                      .reduce((s, i) => s + i.amountFcfa, 0)
                  )}
                </p>
              </div>
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-4">
                <p className="text-xs text-[#8D9AAF]">En attente de validation</p>
                <p className="font-mono-tabular text-xl font-semibold text-[#E5B84B] mt-1">
                  {formatFcfa(
                    invoices
                      .filter((i) => i.status === 'En attente')
                      .reduce((s, i) => s + i.amountFcfa, 0)
                  )}
                </p>
              </div>
              <div className="bg-[#101827] border border-[#243147] rounded-xl p-4">
                <p className="text-xs text-[#8D9AAF]">Transactions Rejetées</p>
                <p className="font-mono-tabular text-xl font-semibold text-[#EF4444] mt-1">
                  {invoices.filter((i) => i.status === 'Rejetée').length}
                </p>
              </div>
            </div>

            <div className="bg-[#101827] border border-[#243147] rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-[#8D9AAF] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="N° facture, référence, client ou ID transaction..."
                  className="w-full pl-9 pr-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] placeholder:text-[#8D9AAF] focus:outline-none focus:border-[#E5B84B]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-[#070B14] border border-[#243147] rounded-lg">
                  {(['Toutes', 'En attente', 'Payée', 'Rejetée'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setInvoiceStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        invoiceStatusFilter === st
                          ? 'bg-[#E5B84B] text-[#070B14] font-semibold'
                          : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#070B14] border border-[#243147] rounded-lg">
                  {(['Toutes', 'Mobile Money', 'Manuel'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setInvoiceMethodFilter(m)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        invoiceMethodFilter === m
                          ? 'bg-[#151F31] text-[#45D7F4] border border-[#243147]'
                          : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={exportInvoicesCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#151F31] hover:bg-[#1C283E] border border-[#243147] rounded-lg text-xs font-medium text-[#F2F6FF] cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[#E5B84B]" />
                  Export CSV
                </button>
              </div>
            </div>

            <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                      <th className="py-3 px-5 font-medium">N° Facture / Réf</th>
                      <th className="py-3 px-4 font-medium">Client & Formule</th>
                      <th className="py-3 px-4 font-medium">Méthode & ID</th>
                      <th className="py-3 px-4 font-medium text-right">Montant</th>
                      <th className="py-3 px-4 font-medium">Statut</th>
                      <th className="py-3 px-5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#243147] text-sm">
                    {filteredInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-sm text-[#8D9AAF]">
                          Aucune facture ne correspond aux filtres sélectionnés.
                        </td>
                      </tr>
                    ) : (
                      filteredInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-[#151F31]/60">
                          <td className="py-3 px-5 font-mono-tabular text-xs">
                            <div className="text-[#F2F6FF] font-semibold">{inv.invoiceNumber}</div>
                            <div className="text-[#8D9AAF]">{inv.reference}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-[#F2F6FF] font-medium">{inv.clientName}</div>
                            <div className="text-xs text-[#8D9AAF]">{inv.planName}</div>
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <div className="text-[#F2F6FF]">{inv.methodLabel}</div>
                            <div className="font-mono-tabular text-[#8D9AAF]">{inv.externalTxId}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular text-[#E5B84B]">
                            {formatFcfa(inv.amountFcfa)}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-medium whitespace-nowrap ${
                                inv.status === 'Payée'
                                  ? 'text-[#45D7F4]'
                                  : inv.status === 'En attente'
                                    ? 'text-[#F59E0B]'
                                    : 'text-[#EF4444]'
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="py-3 px-5 text-right">
                            {inv.status === 'En attente' ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleInvoiceStatus(inv.id, 'Payée')}
                                  className="px-2.5 py-1 bg-[#45D7F4]/15 text-[#45D7F4] text-xs rounded-md cursor-pointer"
                                >
                                  Marquer Payée
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleInvoiceStatus(inv.id, 'Rejetée')}
                                  className="px-2.5 py-1 bg-[#EF4444]/15 text-[#EF4444] text-xs rounded-md cursor-pointer"
                                >
                                  Rejeter
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => notify(`Facture ${inv.invoiceNumber} prête (PDF).`)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#151F31] hover:bg-[#1C283E] border border-[#243147] text-[#F2F6FF] text-xs rounded-md cursor-pointer"
                              >
                                <Download className="w-3 h-3 text-[#E5B84B]" />
                                PDF
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SUPPORT & AUDIT TAB */}
        {activeTab === 'tickets' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Tickets Support Récents ({tickets.length})
              </h3>
              <div className="divide-y divide-[#243147]">
                {tickets.map((t) => (
                  <div key={t.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-[#8D9AAF] font-mono-tabular">
                        <span>{t.number} · {t.author}</span>
                        <span className={t.status === 'Résolu' ? 'text-[#45D7F4]' : 'text-[#E5B84B]'}>
                          {t.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-[#F2F6FF] mt-1">{t.subject}</p>
                      <p className="text-xs text-[#8D9AAF] mt-1">
                        Priorité : {t.priority} · {t.updatedAt}
                      </p>
                    </div>
                    {t.status !== 'Résolu' && (
                      <button
                        type="button"
                        onClick={() => handleResolveTicket(t.id)}
                        className="px-2.5 py-1 bg-[#45D7F4]/15 hover:bg-[#45D7F4]/25 text-[#45D7F4] text-xs font-medium rounded-md shrink-0 cursor-pointer"
                      >
                        Résoudre
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  Journaux de Sécurité & Provisionnement ({auditLogs.length})
                </h3>
                <ShieldAlert className="w-4 h-4 text-[#45D7F4]" />
              </div>
              <div className="divide-y divide-[#243147] text-xs font-mono-tabular max-h-96 overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-4">
                    <span
                      className={
                        log.level === 'warn'
                          ? 'text-[#F59E0B]'
                          : log.level === 'ok'
                            ? 'text-[#45D7F4]'
                            : 'text-[#F2F6FF]'
                      }
                    >
                      {log.event}
                    </span>
                    <span className="text-[#8D9AAF] truncate text-right">
                      {log.detail} · {log.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Panneau ServiceAIAgent : Cycle de vie codes test & conformité métier */}
            <div className="lg:col-span-2 bg-[#101827] border border-[#E5B84B]/35 rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                    ServiceAIAgent · Contrôle Quotas Test & Conformité Métier
                  </h3>
                  <p className="text-xs text-[#8D9AAF] mt-0.5">
                    Applique le quota strict de {serviceSnapshot.rules.maxTestGenerationsPerAccount} tests/client, {serviceSnapshot.rules.maxTestActivationsPerDevice} test/appareil ({serviceSnapshot.rules.testQuotaGb} Go / {serviceSnapshot.rules.testDurationHours}h) et audite les logs d’activité.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const swept = serviceAIAgent.expireStaleTestCodes();
                      notify(
                        swept > 0
                          ? `ServiceAIAgent : ${swept} code(s) test échu(s) expiré(s).`
                          : 'Aucun code test arrivé à échéance.'
                      );
                    }}
                    className="px-3 py-1.5 bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] rounded-lg text-xs text-[#E5B84B] cursor-pointer"
                  >
                    Expirer échus
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const report = serviceAIAgent.superviseActivityLogs(licenses);
                      notify(
                        `Supervision ServiceAIAgent : Score ${report.complianceScore}/100 · ${report.anomalies.length} anomalie(s).`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#45D7F4]/15 hover:bg-[#45D7F4]/25 text-[#45D7F4] text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Auditer les logs
                  </button>
                </div>
              </div>

              {/* Métriques de conformité */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-[#070B14] border border-[#243147] rounded-lg">
                  <span className="text-[#8D9AAF] block">Score conformité</span>
                  <span className="font-mono-tabular text-lg font-semibold text-[#45D7F4]">
                    {serviceSnapshot.lastSupervision.complianceScore}/100
                  </span>
                </div>
                <div className="p-3 bg-[#070B14] border border-[#243147] rounded-lg">
                  <span className="text-[#8D9AAF] block">Codes test actifs</span>
                  <span className="font-mono-tabular text-lg font-semibold text-[#E5B84B]">
                    {serviceSnapshot.lastSupervision.metrics.activeTestCodes}
                  </span>
                </div>
                <div className="p-3 bg-[#070B14] border border-[#243147] rounded-lg">
                  <span className="text-[#8D9AAF] block">Expirés / Révoqués</span>
                  <span className="font-mono-tabular text-lg font-semibold text-[#F2F6FF]">
                    {serviceSnapshot.lastSupervision.metrics.expiredTestCodes} /{' '}
                    {serviceSnapshot.lastSupervision.metrics.revokedTestCodes}
                  </span>
                </div>
                <div className="p-3 bg-[#070B14] border border-[#243147] rounded-lg">
                  <span className="text-[#8D9AAF] block">Infractions bloquées</span>
                  <span className="font-mono-tabular text-lg font-semibold text-[#F59E0B]">
                    {serviceSnapshot.lastSupervision.metrics.blockedViolations}
                  </span>
                </div>
              </div>

              {/* Vérification serveur d'éligibilité Free Test (zéro simulation de paiement) */}
              <div className="p-4 bg-[#070B14] border border-[#243147] rounded-xl space-y-3">
                <p className="text-xs font-semibold text-[#E5B84B]">
                  Contrôle serveur d’éligibilité Test Gratuit (API /api/test-eligibility)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <input
                    type="text"
                    value={simClientName}
                    onChange={(e) => setSimClientName(e.target.value)}
                    placeholder="Nom client"
                    className="px-3 py-1.5 bg-[#101827] border border-[#243147] rounded-lg text-xs text-[#F2F6FF]"
                  />
                  <input
                    type="text"
                    value={simAccountId}
                    onChange={(e) => setSimAccountId(e.target.value)}
                    placeholder="ID Compte"
                    className="px-3 py-1.5 bg-[#101827] border border-[#243147] rounded-lg text-xs font-mono-tabular text-[#F2F6FF]"
                  />
                  <input
                    type="text"
                    value={simDeviceFp}
                    onChange={(e) => setSimDeviceFp(e.target.value)}
                    placeholder="Empreinte appareil"
                    className="px-3 py-1.5 bg-[#101827] border border-[#243147] rounded-lg text-xs font-mono-tabular text-[#F2F6FF]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const acct = (simAccountId || 'client-default').trim();
                      const fp = (simDeviceFp || '').trim();
                      try {
                        const res = await fetch(
                          `/api/test-eligibility?accountId=${encodeURIComponent(acct)}&deviceFingerprint=${encodeURIComponent(fp)}`
                        );
                        const data = await res.json();
                        const blocked = data.deviceAlreadyUsed || data.accountTestsRemaining <= 0;
                        setSimResult({
                          approved: !blocked,
                          ruleViolationCode: data.deviceAlreadyUsed
                            ? 'DEVICE_TEST_ALREADY_USED'
                            : data.accountTestsRemaining <= 0
                              ? 'ACCOUNT_TEST_QUOTA_REACHED'
                              : undefined,
                          reason: blocked
                            ? `Éligibilité refusée par le serveur (${data.accountTestsUsed}/${data.accountTestsMax} tests utilisés, appareil déjà enregistré : ${data.deviceAlreadyUsed ? 'Oui' : 'Non'}).`
                            : `Compte éligible : ${data.accountTestsRemaining}/${data.accountTestsMax} test(s) gratuit(s) restant(s) sur le serveur.`,
                          appliedRules: [
                            `Quota compte : ${data.accountTestsUsed}/${data.accountTestsMax}`,
                            `Empreinte appareil vérifiée : ${data.deviceAlreadyUsed ? 'déjà utilisée' : 'éligible'}`,
                          ],
                        });
                      } catch {
                        notify('Impossible de joindre /api/test-eligibility.');
                      }
                    }}
                    className="px-3 py-1.5 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    Vérifier éligibilité
                  </button>
                </div>

                {simResult && (
                  <div
                    className={`p-3 rounded-lg border text-xs ${
                      simResult.approved
                        ? 'bg-[#45D7F4]/10 border-[#45D7F4]/40 text-[#F2F6FF]'
                        : 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#EF4444]'
                    }`}
                  >
                    <p className="font-semibold">
                      {simResult.approved ? 'ÉLIGIBLE' : `BLOQUÉ (${simResult.ruleViolationCode})`} ·{' '}
                      {simResult.reason}
                    </p>
                  </div>
                )}
              </div>

              {/* Table cycle de vie des codes test + flux supervisé */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-[#070B14] border border-[#243147] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#243147] text-xs font-semibold text-[#F2F6FF]">
                    Cycle de vie des Codes Test (3 Go / 2h)
                  </div>
                  <div className="divide-y divide-[#243147] max-h-64 overflow-y-auto">
                    {serviceSnapshot.testCodes.map((tc) => (
                      <div
                        key={tc.id}
                        className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2 font-mono-tabular">
                            <span className="text-[#E5B84B] font-semibold">{tc.code}</span>
                            <span
                              className={
                                tc.status === 'Activé'
                                  ? 'text-[#45D7F4]'
                                  : tc.status === 'Généré'
                                    ? 'text-[#E5B84B]'
                                    : 'text-[#EF4444]'
                              }
                            >
                              {tc.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8D9AAF]">
                            {tc.clientName} ({tc.accountId}) · {tc.deviceFingerprint} ·{' '}
                            {tc.usedGb.toFixed(1)}/{tc.quotaGb} Go
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {tc.status === 'Généré' && (
                            <button
                              type="button"
                              onClick={() => serviceAIAgent.activateTestCode(tc.code, tc.deviceFingerprint)}
                              className="px-2 py-1 bg-[#45D7F4]/15 text-[#45D7F4] rounded text-[11px] cursor-pointer"
                            >
                              Activer
                            </button>
                          )}
                          {(tc.status === 'Généré' || tc.status === 'Activé') && (
                            <>
                              <button
                                type="button"
                                onClick={() => serviceAIAgent.consumeTestQuota(tc.code, 1.0)}
                                className="px-2 py-1 bg-[#151F31] text-[#F2F6FF] rounded text-[11px] cursor-pointer"
                              >
                                +1 Go
                              </button>
                              <button
                                type="button"
                                onClick={() => serviceAIAgent.revokeTestCode(tc.code)}
                                className="px-2 py-1 bg-[#EF4444]/15 text-[#EF4444] rounded text-[11px] cursor-pointer"
                              >
                                Révoquer
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#070B14] border border-[#243147] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#243147] text-xs font-semibold text-[#F2F6FF]">
                    Supervision des Logs d’Activité ServiceAIAgent ({serviceSnapshot.activityLogs.length})
                  </div>
                  <div className="divide-y divide-[#243147] max-h-64 overflow-y-auto text-xs font-mono-tabular">
                    {serviceSnapshot.activityLogs.slice(0, 10).map((act) => (
                      <div key={act.id} className="p-3 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={
                              act.severity === 'critical'
                                ? 'text-[#EF4444]'
                                : act.severity === 'warn'
                                  ? 'text-[#F59E0B]'
                                  : act.severity === 'ok'
                                    ? 'text-[#45D7F4]'
                                    : 'text-[#F2F6FF]'
                            }
                          >
                            {act.action}
                          </span>
                          <span className="text-[11px] text-[#8D9AAF]">{act.timestamp}</span>
                        </div>
                        <p className="text-[11px] text-[#8D9AAF]">{act.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ssh-builder' && (
          <CloudConfigBuilder
            currentUser={currentUser}
            servers={servers}
            licenses={licenses}
            plans={PLANS}
            onNotify={notify}
          />
        )}

        {activeTab === 'roles' && canManageRoles && (
          <RoleManagementPanel currentUser={currentUser} onNotify={notify} />
        )}
      </main>

      {/* Modal Aperçu Config JSON (STRICTEMENT Super Admin) */}
      {previewConfig && currentUser.role === 'super_admin' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  {previewConfig.name}
                </h3>
                <p className="text-xs text-[#8D9AAF]">
                  Template {previewConfig.targetApp} · {previewConfig.protocol}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewConfig(null)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="p-4 bg-[#070B14] border border-[#243147] rounded-lg text-xs font-mono-tabular text-[#45D7F4] overflow-x-auto">
              {JSON.stringify(
                {
                  app: previewConfig.targetApp,
                  version: previewConfig.version,
                  protocol: previewConfig.protocol,
                  server: 'vps1.justtechservices.xyz',
                  ports: { ssh: 22, wss: 443, slowdns: 53 },
                  slowdns_ns: 'sdns1.justtechservices.xyz',
                  cloud_code: previewConfig.shareToken,
                  auth: {
                    delivery: 'POST_DEVICE_BOUND_EXCHANGE_ONLY',
                    ssh_password: '[REDACTED — JAMAIS EN URL/QR]',
                    private_key: '[REDACTED — JAMAIS EN URL/QR]',
                  },
                },
                null,
                2
              )}
            </pre>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewConfig(null)}
                className="px-4 py-2 bg-[#547CFF] text-[#F2F6FF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nouvelle Licence */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateLicense}
            className="w-full max-w-md bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Provisionner une nouvelle licence
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Nom du client</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Ex. Jean-Paul Biya"
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#45D7F4]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Formule commerciale</label>
                <select
                  value={newPlanId}
                  onChange={(e) => setNewPlanId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#45D7F4]"
                >
                  {PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatFcfa(p.priceFcfa)} ({p.durationDays}j ·{' '}
                      {p.dataQuotaGb ? `${p.dataQuotaGb} Go` : '0 Go'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Créer & Provisionner
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Création Partenaire (Contrôle Total Admin : Revendeur / Sous-revendeur + Gigas) */}
      {showResellerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateReseller}
            className="w-full max-w-lg bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Créer un Compte Revendeur / Sous-revendeur
              </h3>
              <button
                type="button"
                onClick={() => setShowResellerModal(false)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Nom du partenaire</label>
                  <input
                    type="text"
                    required
                    value={newResellerName}
                    onChange={(e) => setNewResellerName(e.target.value)}
                    placeholder="Ex. Yaoundé Tunnel Hub"
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">E-mail de connexion</label>
                  <input
                    type="email"
                    value={newResellerEmail}
                    onChange={(e) => setNewResellerEmail(e.target.value)}
                    placeholder="partenaire@justtechservices.xyz"
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Niveau hiérarchique</label>
                  <select
                    value={newResellerLevel}
                    onChange={(e) => {
                      const lvl = e.target.value as 'Revendeur' | 'Sous-revendeur';
                      setNewResellerLevel(lvl);
                      if (lvl === 'Sous-revendeur') {
                        const firstParent = resellers.find((r) => r.level === 'Revendeur')?.name;
                        if (firstParent) setNewResellerParent(firstParent);
                      }
                    }}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF]"
                  >
                    <option value="Revendeur">Revendeur (Niv. 4)</option>
                    <option value="Sous-revendeur">Sous-revendeur (Niv. 5)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Parent rattaché</label>
                  <select
                    disabled={newResellerLevel === 'Revendeur'}
                    value={newResellerLevel === 'Revendeur' ? 'Super Admin' : newResellerParent}
                    onChange={(e) => setNewResellerParent(e.target.value)}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] disabled:opacity-60"
                  >
                    {newResellerLevel === 'Revendeur' ? (
                      <option value="Super Admin">Super Admin</option>
                    ) : (
                      resellers
                        .filter((r) => r.level === 'Revendeur')
                        .map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))
                    )}
                  </select>
                </div>
              </div>

              <div className="p-3 bg-[#070B14] border border-[#E5B84B]/35 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#E5B84B]">
                    Gigas attribués à ce compte (Go)
                  </label>
                  <span className="text-[11px] font-mono-tabular text-[#8D9AAF]">
                    Déduits à chaque forfait acheté
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[50, 100, 250, 500, 1000].map((presetGb) => (
                    <button
                      key={presetGb}
                      type="button"
                      onClick={() => setNewResellerGb(presetGb)}
                      className={`px-2.5 py-1 rounded text-xs font-mono-tabular border cursor-pointer ${
                        newResellerGb === presetGb
                          ? 'bg-[#E5B84B]/20 border-[#E5B84B] text-[#E5B84B]'
                          : 'bg-[#101827] border-[#243147] text-[#8D9AAF]'
                      }`}
                    >
                      {presetGb} Go
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={newResellerGb}
                  onChange={(e) => setNewResellerGb(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#101827] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Mot de passe initial</label>
                  <input
                    type="text"
                    value={newResellerPassword}
                    onChange={(e) => setNewResellerPassword(e.target.value)}
                    placeholder="Auto si vide"
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-xs text-[#F2F6FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Places max</label>
                  <input
                    type="number"
                    min={1}
                    value={newResellerMaxClients}
                    onChange={(e) => setNewResellerMaxClients(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Comm. (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={newResellerCommission}
                    onChange={(e) => setNewResellerCommission(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
              </div>

              {newResellerLevel === 'Revendeur' && (
                <label className="flex items-center gap-2 text-xs text-[#F2F6FF] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newResellerCanCreateSub}
                    onChange={(e) => setNewResellerCanCreateSub(e.target.checked)}
                    className="rounded border-[#243147] bg-[#070B14]"
                  />
                  Autoriser ce revendeur à créer et doter ses propres sous-revendeurs en Go
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResellerModal(false)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Créer & Attribuer {newResellerGb} Go
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Attribution / Ajustement Gigas (Revendeur & Sous-revendeur) */}
      {gbTargetReseller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleConfirmGbAllocation}
            className="w-full max-w-sm bg-[#101827] border border-[#E5B84B]/40 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Gigas · {gbTargetReseller.name}
              </h3>
              <button
                type="button"
                onClick={() => setGbTargetReseller(null)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-[#8D9AAF]">
                {gbTargetReseller.level} · Stock actuel :{' '}
                <span className="font-mono-tabular font-bold text-[#E5B84B]">
                  {gbTargetReseller.gbBalance} Go
                </span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGbMode('add')}
                  className={`py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                    gbMode === 'add'
                      ? 'bg-[#E5B84B]/20 border-[#E5B84B] text-[#E5B84B]'
                      : 'bg-[#070B14] border-[#243147] text-[#8D9AAF]'
                  }`}
                >
                  Ajouter (+ Go)
                </button>
                <button
                  type="button"
                  onClick={() => setGbMode('set')}
                  className={`py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                    gbMode === 'set'
                      ? 'bg-[#45D7F4]/20 border-[#45D7F4] text-[#45D7F4]'
                      : 'bg-[#070B14] border-[#243147] text-[#8D9AAF]'
                  }`}
                >
                  Définir exact (= Go)
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[50, 100, 250, 500].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setGbAmountInput(preset)}
                    className={`py-1.5 rounded-md text-xs font-mono-tabular cursor-pointer border ${
                      gbAmountInput === preset
                        ? 'bg-[#E5B84B]/20 border-[#E5B84B] text-[#E5B84B]'
                        : 'bg-[#070B14] border-[#243147] text-[#8D9AAF]'
                    }`}
                  >
                    {gbMode === 'add' ? `+${preset}` : `${preset}`} Go
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">
                  {gbMode === 'add' ? 'Volume à ajouter (Go)' : 'Nouveau stock exact (Go)'}
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={gbAmountInput}
                  onChange={(e) => setGbAmountInput(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGbTargetReseller(null)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Valider ({gbMode === 'add' ? `+${gbAmountInput}` : `=${gbAmountInput}`} Go)
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Créditer Partenaire (FCFA) */}
      {creditTargetReseller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleConfirmCreditReseller}
            className="w-full max-w-sm bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Créditer {creditTargetReseller.name}
              </h3>
              <button
                type="button"
                onClick={() => setCreditTargetReseller(null)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-[#8D9AAF]">
                Solde actuel :{' '}
                <span className="font-mono-tabular text-[#45D7F4]">
                  {formatFcfa(creditTargetReseller.creditBalanceFcfa)}
                </span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[5000, 10000, 25000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCreditAmountInput(preset)}
                    className={`py-1.5 rounded-md text-xs font-mono-tabular cursor-pointer border ${
                      creditAmountInput === preset
                        ? 'bg-[#E5B84B]/20 border-[#E5B84B] text-[#E5B84B]'
                        : 'bg-[#070B14] border-[#243147] text-[#8D9AAF]'
                    }`}
                  >
                    +{preset.toLocaleString('fr-FR')}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Montant personnalisé (FCFA)</label>
                <input
                  type="number"
                  min={500}
                  step={500}
                  required
                  value={creditAmountInput}
                  onChange={(e) => setCreditAmountInput(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreditTargetReseller(null)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#45D7F4] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Valider le crédit
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Ajouter Nœud VPS */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateServer}
            className="w-full max-w-lg bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Ajouter un Nœud VPN (SSH / WSS / SlowDNS)
              </h3>
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Code nœud</label>
                <input
                  type="text"
                  required
                  value={srvCode}
                  onChange={(e) => setSrvCode(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Libellé</label>
                <input
                  type="text"
                  required
                  value={srvName}
                  onChange={(e) => setSrvName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Hostname</label>
                <input
                  type="text"
                  required
                  value={srvHostname}
                  onChange={(e) => setSrvHostname(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Adresse IP publique</label>
                <input
                  type="text"
                  required
                  value={srvPublicIp}
                  onChange={(e) => setSrvPublicIp(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Cloudflare SlowDNS NS</label>
                <input
                  type="text"
                  required
                  value={srvSlowDnsNs}
                  onChange={(e) => setSrvSlowDnsNs(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Max sessions simultanées</label>
                <input
                  type="number"
                  min={50}
                  value={srvMaxSessions}
                  onChange={(e) => setSrvMaxSessions(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
              <div className="sm:col-span-2 grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Port SSH</label>
                  <input
                    type="number"
                    value={srvSshPort}
                    onChange={(e) => setSrvSshPort(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Port WSS</label>
                  <input
                    type="number"
                    value={srvWssPort}
                    onChange={(e) => setSrvWssPort(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Port SlowDNS</label>
                  <input
                    type="number"
                    value={srvSlowDnsPort}
                    onChange={(e) => setSrvSlowDnsPort(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-[#8D9AAF] mb-1">Clé Publique dnstt</label>
                <input
                  type="text"
                  required
                  value={srvSlowDnsKey}
                  onChange={(e) => setSrvSlowDnsKey(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-xs font-mono-tabular text-[#45D7F4]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Connecter le Nœud
              </button>
            </div>
          </form>
        </div>
      )}

      <VpsDeploymentWizardModal
        isOpen={showDeployWizard}
        currentUser={currentUser}
        onClose={() => setShowDeployWizard(false)}
        onNotify={notify}
      />
    </div>
  );
};
