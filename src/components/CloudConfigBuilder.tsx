import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FileJson,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Unlock,
  Upload,
  UserCheck,
} from 'lucide-react';
import { authFetch } from '../services/authClient';
import {
  AuthenticatedUser,
  LicenseRecord,
  PlanOffer,
  ROLE_LABELS,
  ServerNode,
  SessionRole,
} from '../types/panel';
import {
  BYTES_PER_GIGABYTE,
  CloudConfigStatus,
  CloudDistributionItemDto,
  INITIAL_SSH_TEMPLATES,
  PROTOCOL_MAP,
  SSH_PROTOCOLS,
  SshAuthType,
  SshCloudConfigV1,
  SshConfigTemplate,
  SshTunnelProtocol,
  applyProtocolSelection,
  buildCloudDistributionLinks,
  buildSshCloudConfigV1Object,
  createDefaultSshCloudConfig,
  duplicateSshCloudConfig,
  extractTemplateFromConfig,
  generateCloudCodeV1,
  generateConfigId,
  getSshBuilderRbacPolicy,
  instantiateConfigFromTemplate,
  serializeJtsTunnelConfigV1,
  validateSshCloudConfigV1,
} from '../types/sshCloudConfig';
import { MobileImportSimulatorModal } from './MobileImportSimulatorModal';
import { RawPayloadEditor } from './RawPayloadEditor';

export type {
  CloudConfigStatus,
  SshAuthType,
  SshCloudConfigV1,
  SshConfigTemplate,
  SshTunnelProtocol,
} from '../types/sshCloudConfig';
export { PAYLOAD_QUICK_TAGS, SSH_PROTOCOLS } from '../types/sshCloudConfig';

export interface CloudConfigBuilderProps {
  currentUser?: AuthenticatedUser | null;
  servers?: ServerNode[];
  licenses?: LicenseRecord[];
  plans?: PlanOffer[];
  onNotify?: (message: string) => void;
}

const TEMPLATES_STORAGE_KEY = 'jts_ssh_templates_v1';
const SAVED_CONFIGS_STORAGE_KEY = 'jts_ssh_saved_configs_v1';
const QUOTA_PRESETS_GB = [3, 5, 10, 20, 40, 60, 100];
const DURATION_PRESETS = ['2h', '5d', '7d', '10d', '15d', '20d', '30d'];

function loadStoredTemplates(): SshConfigTemplate[] {
  if (typeof window === 'undefined') return INITIAL_SSH_TEMPLATES;
  try {
    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return INITIAL_SSH_TEMPLATES;
    const parsed = JSON.parse(raw) as SshConfigTemplate[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_SSH_TEMPLATES;
  } catch {
    return INITIAL_SSH_TEMPLATES;
  }
}

function loadStoredConfigs(): SshCloudConfigV1[] {
  if (typeof window === 'undefined') return [createDefaultSshCloudConfig('SSH_WSS')];
  try {
    const raw = window.localStorage.getItem(SAVED_CONFIGS_STORAGE_KEY);
    if (!raw) return [createDefaultSshCloudConfig('SSH_WSS')];
    const parsed = JSON.parse(raw) as SshCloudConfigV1[];
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : [createDefaultSshCloudConfig('SSH_WSS')];
  } catch {
    return [createDefaultSshCloudConfig('SSH_WSS')];
  }
}

function formatPlanDurationCode(plan: PlanOffer): string {
  if (plan.durationHours < 24) {
    return `${plan.durationHours}h`;
  }
  return `${plan.durationDays}d`;
}

export const CloudConfigBuilder: React.FC<CloudConfigBuilderProps> = ({
  currentUser = null,
  servers = [],
  licenses = [],
  plans = [],
  onNotify = () => undefined,
}) => {
  const activeRole: SessionRole = currentUser?.role ?? 'super_admin';
  const rbac = useMemo(() => getSshBuilderRbacPolicy(activeRole), [activeRole]);
  const isResellerScoped = activeRole === 'reseller' || activeRole === 'sub_reseller';

  const [templates, setTemplates] = useState<SshConfigTemplate[]>(loadStoredTemplates);
  const [savedConfigs, setSavedConfigs] = useState<SshCloudConfigV1[]>(loadStoredConfigs);

  // Registre serveur autoritaire (/api/v1/cloud/configs) filtré par RBAC
  const [cloudRecords, setCloudRecords] = useState<CloudDistributionItemDto[]>([]);
  const [activeCloudRecord, setActiveCloudRecord] = useState<CloudDistributionItemDto | null>(null);
  const [publishingCloud, setPublishingCloud] = useState(false);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);

  // Modale Simulateur d'Import Mobile (Test Contrat API)
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [simulatorTargetCode, setSimulatorTargetCode] = useState('');

  // Mode Template : obligatoire pour Reseller/Sub Reseller ; optionnel avec Mode Avancé pour Staff
  const [activeTemplate, setActiveTemplate] = useState<SshConfigTemplate | null>(() => {
    if (isResellerScoped) {
      return loadStoredTemplates()[0] ?? INITIAL_SSH_TEMPLATES[0] ?? null;
    }
    return null;
  });
  const [advancedUnlocked, setAdvancedUnlocked] = useState(false);

  const [config, setConfig] = useState<SshCloudConfigV1>(() => {
    if (isResellerScoped) {
      const tpl = loadStoredTemplates()[0] ?? INITIAL_SSH_TEMPLATES[0];
      return instantiateConfigFromTemplate(tpl, {
        duration: '7d',
        quotaBytes: Math.min(10, rbac.maxQuotaGb ?? 10) * BYTES_PER_GIGABYTE,
      });
    }
    const initial = loadStoredConfigs();
    return structuredClone(initial[0] ?? createDefaultSshCloudConfig('SSH_WSS'));
  });

  // Attribution client & offre en mode Template / Revendeur
  const [selectedClientName, setSelectedClientName] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');

  // Enregistrement inline d'un nouveau Template SSH (zéro window.prompt)
  const [savingTemplateOpen, setSavingTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const [redactPreviewSecrets, setRedactPreviewSecrets] = useState(true);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchServerCloudConfigs = useCallback(async () => {
    if (!rbac.canAccessBuilder) return;
    try {
      const res = await authFetch('/api/v1/cloud/configs', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { configs?: CloudDistributionItemDto[] };
      const list = Array.isArray(data.configs) ? data.configs : [];
      setCloudRecords(list);
      setActiveCloudRecord((prev) => {
        if (prev) {
          const refreshed = list.find((item) => item.cloudCode === prev.cloudCode);
          if (refreshed) return refreshed;
        }
        return list[0] ?? null;
      });
    } catch {
      // Ignore transient offline error
    }
  }, [rbac.canAccessBuilder]);

  useEffect(() => {
    void fetchServerCloudConfigs();
  }, [fetchServerCloudConfigs]);

  useEffect(() => {
    if (!rbac.canRevealSecretsLocally && !redactPreviewSecrets) {
      setRedactPreviewSecrets(true);
    }
  }, [rbac.canRevealSecretsLocally, redactPreviewSecrets]);

  useEffect(() => {
    if (!rbac.canCreateCustomProtocolConfig && !activeTemplate && templates.length > 0) {
      setActiveTemplate(templates[0]);
      setAdvancedUnlocked(false);
    }
  }, [rbac.canCreateCustomProtocolConfig, activeTemplate, templates]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    } catch {
      // Ignore quota storage errors
    }
  }, [templates]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_CONFIGS_STORAGE_KEY, JSON.stringify(savedConfigs));
    } catch {
      // Ignore quota storage errors
    }
  }, [savedConfigs]);

  const isNetworkLocked = Boolean(
    !rbac.canCreateCustomProtocolConfig || (activeTemplate && (!advancedUnlocked || !rbac.canUnlockAdvancedMode))
  );
  const activeCap = PROTOCOL_MAP[config.protocol];
  const validationIssues = useMemo(() => validateSshCloudConfigV1(config), [config]);

  const effectiveRedactPreview = rbac.canRevealSecretsLocally ? redactPreviewSecrets : true;

  const schemaV1Object = useMemo(
    () => buildSshCloudConfigV1Object(config, { redactSecrets: effectiveRedactPreview }),
    [config, effectiveRedactPreview]
  );

  const schemaV1Json = useMemo(() => JSON.stringify(schemaV1Object, null, 2), [schemaV1Object]);

  const quotaGbDisplay = useMemo(
    () => Number((config.subscription.quota_bytes / BYTES_PER_GIGABYTE).toFixed(2)),
    [config.subscription.quota_bytes]
  );

  const allowedPlans = useMemo(() => {
    if (rbac.maxQuotaGb === null) return plans;
    return plans.filter((p) => (p.dataQuotaGb ?? 0) <= rbac.maxQuotaGb!);
  }, [plans, rbac.maxQuotaGb]);

  const allowedQuotaPresetsGb = useMemo(() => {
    if (rbac.maxQuotaGb === null) return QUOTA_PRESETS_GB;
    return QUOTA_PRESETS_GB.filter((gb) => gb <= rbac.maxQuotaGb!);
  }, [rbac.maxQuotaGb]);

  const activeLayersList = useMemo(() => {
    const layers = ['SSH'];
    if (activeCap.usesProxy) layers.push('Proxy');
    if (activeCap.usesTls) layers.push('TLS/SNI');
    if (activeCap.usesWebsocket) layers.push('WebSocket');
    if (activeCap.usesSlowDns) layers.push('SlowDNS');
    if (activeCap.usesPayload) layers.push('Payload brut');
    return layers;
  }, [activeCap]);

  const uniqueClientNames = useMemo(() => {
    const names = new Set<string>();
    for (const lic of licenses) {
      if (lic.clientName) names.add(lic.clientName);
    }
    return Array.from(names);
  }, [licenses]);

  const canActorRevokeRecord = (record: CloudDistributionItemDto | null | undefined): boolean => {
    if (!record) return false;
    if (rbac.canRevokeAnyConfig) return true;
    if (!rbac.canRevokeOwnConfig) return false;
    if (!currentUser) return false;
    return record.ownerUserId === currentUser.id;
  };

  const copyInlineValue = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      onNotify(`${label} copié dans le presse-papiers.`);
      setTimeout(() => setCopiedField((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      onNotify('Copie presse-papiers indisponible.');
    }
  };

  const openSimulatorForCode = (code: string) => {
    const clean = code.trim().toUpperCase();
    setSimulatorTargetCode(clean);
    setSimulatorOpen(true);
  };

  const handleSelectProtocol = (nextProtocol: SshTunnelProtocol) => {
    setConfig((prev) => applyProtocolSelection(prev, nextProtocol));
  };

  const handleApplyServerNode = (srv: ServerNode) => {
    setConfig((prev) => ({
      ...prev,
      server: {
        ...prev.server,
        host: srv.hostname,
        port:
          prev.protocol === 'SSH_WSS' || prev.protocol.includes('TLS')
            ? srv.wssPort
            : srv.sshPort,
      },
      slowdns: {
        ...prev.slowdns,
        nameserver: srv.slowDnsNs,
        public_key: srv.slowDnsPubKey,
      },
    }));
    onNotify(`Paramètres serveur pré-remplis depuis ${srv.code} (${srv.hostname}).`);
  };

  const triggerDownloadConfig = (target: SshCloudConfigV1, extension: '.json' | '.jts') => {
    const serialized = serializeJtsTunnelConfigV1(target, {
      redactSecrets: effectiveRedactPreview,
    });
    const mime =
      extension === '.json'
        ? 'application/json;charset=utf-8'
        : 'application/vnd.justtech.tunnel+json;charset=utf-8';
    const blob = new Blob([serialized], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${target.config_id.toLowerCase()}${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(
      `Fichier ${target.config_id.toLowerCase()}${extension} généré (contrat JUST TECH SERVICES TUNNEL v1).`
    );
  };

  const handleExportJsonClipboard = async (target: SshCloudConfigV1) => {
    const serialized = serializeJtsTunnelConfigV1(target, {
      redactSecrets: effectiveRedactPreview,
    });
    try {
      await navigator.clipboard.writeText(serialized);
      setCopiedJson(true);
      onNotify(
        effectiveRedactPreview
          ? `Export JSON v1 (${target.config_id}) copié avec secrets masqués.`
          : `Export JSON v1 complet (${target.config_id}) copié dans le presse-papiers.`
      );
      setTimeout(() => setCopiedJson(false), 1600);
    } catch {
      onNotify('Copie presse-papiers indisponible.');
    }
  };

  const handleSaveAndPublishCloud = async () => {
    if (!rbac.canPublishCloudConfig) {
      onNotify(`Action non autorisée pour le rôle ${rbac.roleLabel}.`);
      return;
    }

    if (rbac.requiresClientAttribution && !selectedClientName.trim()) {
      onNotify('Attribution client requise : sélectionnez ou saisissez un de vos clients avant publication.');
      return;
    }

    if (
      rbac.maxQuotaGb !== null &&
      config.subscription.quota_bytes > rbac.maxQuotaGb * BYTES_PER_GIGABYTE
    ) {
      onNotify(
        `Plafond RBAC dépassé : votre rôle ${rbac.roleLabel} est limité à ${rbac.maxQuotaGb} Go par configuration.`
      );
      return;
    }

    setPublishingCloud(true);
    try {
      const res = await authFetch('/api/v1/cloud/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          assignedClientName: selectedClientName.trim(),
        }),
      });
      const data = (await res.json()) as {
        record?: CloudDistributionItemDto;
        error?: string;
      };

      if (!res.ok || !data.record) {
        onNotify(data.error || `Publication Cloud refusée (HTTP ${res.status}).`);
        return;
      }

      const published = data.record;
      const syncedSnapshot: SshCloudConfigV1 = {
        ...structuredClone(config),
        cloud: {
          ...config.cloud,
          enabled: published.config.cloud.enabled,
          cloud_code: published.cloudCode,
          status: published.config.cloud.status,
        },
      };

      setConfig(syncedSnapshot);
      setActiveCloudRecord(published);
      setCloudRecords((prev) => [
        published,
        ...prev.filter((item) => item.cloudCode !== published.cloudCode),
      ]);
      setSavedConfigs((prev) => {
        const idx = prev.findIndex((c) => c.config_id === syncedSnapshot.config_id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = syncedSnapshot;
          return updated;
        }
        return [syncedSnapshot, ...prev];
      });

      onNotify(
        `Config Cloud publiée : ${published.cloudCode} · Lien API & QR Code zéro-secret prêts.`
      );
    } catch {
      onNotify("Impossible de joindre l'API /api/v1/cloud/configs.");
    } finally {
      setPublishingCloud(false);
    }
  };

  const handleToggleRevokeCloudCode = async (target: CloudDistributionItemDto) => {
    if (!canActorRevokeRecord(target)) {
      onNotify("Accès refusé : vous ne pouvez révoquer que vos propres configurations Cloud.");
      return;
    }
    const isCurrentlyRevoked =
      target.config.cloud.status === 'revoked' || !target.config.cloud.enabled;
    const action = isCurrentlyRevoked ? 'activate' : 'revoke';

    setRevokingCode(target.cloudCode);
    try {
      const res = await authFetch(
        `/api/v1/cloud/configs/${encodeURIComponent(target.cloudCode)}/${action}`,
        { method: 'POST' }
      );
      const data = (await res.json()) as { record?: CloudDistributionItemDto; error?: string };
      if (!res.ok || !data.record) {
        onNotify(data.error || 'Opération refusée par le serveur RBAC.');
        return;
      }
      const updated = data.record;
      setCloudRecords((prev) =>
        prev.map((item) => (item.cloudCode === updated.cloudCode ? updated : item))
      );
      if (activeCloudRecord?.cloudCode === updated.cloudCode) {
        setActiveCloudRecord(updated);
      }
      if (config.cloud.cloud_code === updated.cloudCode) {
        setConfig((prev) => ({
          ...prev,
          cloud: {
            ...prev.cloud,
            enabled: updated.config.cloud.enabled,
            status: updated.config.cloud.status,
          },
        }));
      }
      onNotify(
        action === 'revoke'
          ? `Code Cloud ${updated.cloudCode} révoqué — résolution API immédiatement bloquée (HTTP 410).`
          : `Code Cloud ${updated.cloudCode} réactivé.`
      );
    } finally {
      setRevokingCode(null);
    }
  };

  const handleDuplicateConfig = (source: SshCloudConfigV1) => {
    if (!rbac.canDuplicateConfig) {
      onNotify(`Duplication non autorisée pour le rôle ${rbac.roleLabel}.`);
      return;
    }
    const cloned = duplicateSshCloudConfig(source);
    setSavedConfigs((prev) => [cloned, ...prev]);
    setConfig(structuredClone(cloned));
    if (rbac.canCreateCustomProtocolConfig) {
      setActiveTemplate(null);
      setAdvancedUnlocked(false);
    }
    onNotify(
      `Configuration dupliquée : ${cloned.config_id} (code ${cloned.cloud.cloud_code}) créé sans modifier l'originale (${source.config_id}).`
    );
  };

  const handleResetNew = () => {
    setSelectedClientName('');
    setSelectedPlanId('');
    if (!rbac.canCreateCustomProtocolConfig && templates.length > 0) {
      const tpl = activeTemplate ?? templates[0];
      setActiveTemplate(tpl);
      setAdvancedUnlocked(false);
      setConfig(
        instantiateConfigFromTemplate(tpl, {
          duration: '7d',
          quotaBytes: Math.min(10, rbac.maxQuotaGb ?? 10) * BYTES_PER_GIGABYTE,
        })
      );
      onNotify(`Nouveau brouillon client initialisé depuis le template « ${tpl.name} ».`);
      return;
    }
    setActiveTemplate(null);
    setAdvancedUnlocked(false);
    setConfig(createDefaultSshCloudConfig(config.protocol));
    onNotify('Nouveau brouillon SSH & Cloud Config v1 initialisé.');
  };

  const handleSaveAsTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rbac.canManageTemplates) {
      onNotify(`La création de Templates SSH est réservée aux rôles Super Admin et Admin.`);
      return;
    }
    const tpl = extractTemplateFromConfig(config, newTemplateName);
    setTemplates((prev) => [tpl, ...prev]);
    setSavingTemplateOpen(false);
    setNewTemplateName('');
    onNotify(`Template SSH « ${tpl.name} » enregistré (${tpl.protocol} · ${tpl.host}:${tpl.port}).`);
  };

  const handleCreateFromTemplate = (tpl: SshConfigTemplate) => {
    const matchedPlan = allowedPlans.find((p) => p.id === selectedPlanId);
    const defaultGb = Math.min(matchedPlan?.dataQuotaGb ?? 20, rbac.maxQuotaGb ?? 20);
    const instantiated = instantiateConfigFromTemplate(tpl, {
      clientName: selectedClientName || undefined,
      planName: matchedPlan?.name,
      duration: matchedPlan ? formatPlanDurationCode(matchedPlan) : '30d',
      quotaBytes: defaultGb * BYTES_PER_GIGABYTE,
    });
    setConfig(instantiated);
    setActiveTemplate(tpl);
    setAdvancedUnlocked(false);
    onNotify(
      rbac.canUnlockAdvancedMode
        ? `Création depuis le template « ${tpl.name} » : paramètres réseau verrouillés (Mode Avancé disponible).`
        : `Template « ${tpl.name} » chargé (paramètres réseau verrouillés selon votre rôle ${rbac.roleLabel}).`
    );
  };

  const handleApplyClientAttribution = (clientNameValue: string) => {
    setSelectedClientName(clientNameValue);
    const matchedLicense = licenses.find(
      (l) => l.clientName.toLowerCase() === clientNameValue.trim().toLowerCase()
    );
    const matchedPlan = plans.find((p) => p.id === selectedPlanId);
    setConfig((prev) => {
      const nextName =
        clientNameValue.trim() && matchedPlan
          ? `${clientNameValue.trim()} — ${matchedPlan.name}`
          : clientNameValue.trim()
            ? `${clientNameValue.trim()} — ${activeTemplate?.name ?? prev.protocol}`
            : prev.config_name;
      const remarksParts = [
        activeTemplate ? `Template: ${activeTemplate.name}` : null,
        clientNameValue.trim() ? `Client: ${clientNameValue.trim()}` : null,
        matchedPlan ? `Offre: ${matchedPlan.name}` : null,
      ].filter(Boolean);
      return {
        ...prev,
        config_name: nextName,
        remarks: remarksParts.length > 0 ? remarksParts.join(' · ') : prev.remarks,
        authentication: {
          ...prev.authentication,
          username: matchedLicense?.sshUsername || prev.authentication.username,
        },
      };
    });
  };

  const handleApplyPlanAttribution = (planIdValue: string) => {
    setSelectedPlanId(planIdValue);
    const plan = plans.find((p) => p.id === planIdValue);
    if (!plan) return;
    const durationCode = formatPlanDurationCode(plan);
    const quotaBytes = (plan.dataQuotaGb ?? 20) * BYTES_PER_GIGABYTE;
    setConfig((prev) => {
      const remarksParts = [
        activeTemplate ? `Template: ${activeTemplate.name}` : null,
        selectedClientName.trim() ? `Client: ${selectedClientName.trim()}` : null,
        `Offre: ${plan.name} (${plan.durationLabel})`,
      ].filter(Boolean);
      return {
        ...prev,
        config_name: selectedClientName.trim()
          ? `${selectedClientName.trim()} — ${plan.name}`
          : `${plan.name} — ${activeTemplate?.name ?? prev.protocol}`,
        remarks: remarksParts.join(' · '),
        subscription: {
          duration: durationCode,
          quota_bytes: quotaBytes,
        },
      };
    });
    onNotify(`Offre « ${plan.name} » appliquée (${durationCode} · ${plan.dataQuotaGb ?? 20} Go).`);
  };

  const handleImportJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      try {
        const parsed = JSON.parse(reader.result) as Partial<SshCloudConfigV1>;
        if (parsed.schema_version !== 1 || parsed.provider !== 'JUST_TECH_SERVICES') {
          onNotify('Fichier rejeté : attendu schema_version: 1 et provider: "JUST_TECH_SERVICES".');
          return;
        }
        const proto =
          parsed.protocol && parsed.protocol in PROTOCOL_MAP ? parsed.protocol : config.protocol;
        const base = createDefaultSshCloudConfig(proto);
        setActiveTemplate(null);
        setAdvancedUnlocked(false);
        setConfig({
          ...base,
          ...parsed,
          schema_version: 1,
          provider: 'JUST_TECH_SERVICES',
          protocol: proto,
          server: { ...base.server, ...(parsed.server ?? {}) },
          proxy: { ...base.proxy, ...(parsed.proxy ?? {}) },
          authentication: { ...base.authentication, ...(parsed.authentication ?? {}) },
          // Préservation 100 % brute du payload importé (aucun .trim())
          payload: {
            content:
              typeof parsed.payload?.content === 'string'
                ? parsed.payload.content
                : base.payload.content,
          },
          tls: { ...base.tls, ...(parsed.tls ?? {}) },
          websocket: { ...base.websocket, ...(parsed.websocket ?? {}) },
          slowdns: { ...base.slowdns, ...(parsed.slowdns ?? {}) },
          subscription: { ...base.subscription, ...(parsed.subscription ?? {}) },
          cloud: { ...base.cloud, ...(parsed.cloud ?? {}) },
        });
        onNotify(`Schéma JSON v1 importé depuis ${file.name} (Payload brut préservé).`);
      } catch {
        onNotify('Fichier JSON invalide : impossible de parser la configuration v1.');
      }
    };
    reader.readAsText(file);
  };

  if (!rbac.canAccessBuilder) {
    return (
      <div className="bg-[#101827] border border-[#EF4444]/40 rounded-xl p-6 flex items-start gap-4">
        <ShieldAlert className="w-6 h-6 text-[#EF4444] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-xs font-mono text-[#EF4444] uppercase">Contrôle d&apos;accès RBAC</p>
          <h2 className="font-display text-lg font-semibold text-[#F2F6FF]">
            Accès SSH &amp; Cloud Config Builder restreint ({rbac.roleLabel})
          </h2>
          <p className="text-sm text-[#8D9AAF]">{rbac.scopeSummary}</p>
        </div>
      </div>
    );
  }

  const displayedLinks = activeCloudRecord
    ? { resolveUrl: activeCloudRecord.resolveUrl, importUri: activeCloudRecord.importUri }
    : buildCloudDistributionLinks(config.cloud.cloud_code || 'JTS-0000-0000');

  return (
    <div className="space-y-6">
      {/* En-tête du module + Bandeau RBAC actif */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#243147] pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#8D9AAF] font-mono tabular-nums">
            <span className="text-[#45D7F4] font-medium">schema_version: 1</span>
            <span aria-hidden="true">·</span>
            <span>JUST_TECH_SERVICES</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#E5B84B] font-semibold">RBAC : {rbac.roleLabel}</span>
            {rbac.maxQuotaGb !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#E8EEF5]">Plafond ≤ {rbac.maxQuotaGb} Go</span>
              </>
            )}
            {activeTemplate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#45D7F4]">Template : {activeTemplate.name}</span>
              </>
            )}
          </div>
          <h2 className="font-display text-xl font-semibold text-[#F2F6FF]">
            SSH &amp; Cloud Config Builder
          </h2>
          <p className="text-sm text-[#8D9AAF] max-w-2xl">{rbac.scopeSummary}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              openSimulatorForCode(
                activeCloudRecord?.cloudCode || config.cloud.cloud_code || 'JTS-WSS1-84A2'
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#101827] hover:bg-[#151F31] border border-[#45D7F4]/50 text-xs font-medium text-[#45D7F4] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Simulateur Mobile API
          </button>

          {rbac.canManageTemplates && (
            <button
              type="button"
              onClick={() => {
                setNewTemplateName(`Template ${config.protocol} — ${config.server.host}`);
                setSavingTemplateOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#101827] hover:bg-[#151F31] border border-[#E5B84B]/45 text-xs font-medium text-[#E5B84B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Enregistrer comme Template
            </button>
          )}

          {rbac.canExportJson && (
            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#101827] hover:bg-[#151F31] border border-[#243147] text-xs font-medium text-[#E8EEF5] transition-colors whitespace-nowrap shrink-0 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-[#45D7F4]" />
              Importer .json / .jts
              <input
                type="file"
                accept=".json,.jts"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportJsonFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}

          <button
            type="button"
            onClick={handleResetNew}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#101827] hover:bg-[#151F31] border border-[#243147] text-xs font-medium text-[#E8EEF5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#45D7F4]" />
            Nouvelle config
          </button>

          <button
            type="button"
            disabled={publishingCloud}
            onClick={() => void handleSaveAndPublishCloud()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#45D7F4] hover:bg-[#32C5E2] disabled:opacity-60 text-[#070B14] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Cloud className="w-3.5 h-3.5" />
            {publishingCloud ? 'Publication Cloud...' : 'Enregistrer & Publier Cloud'}
          </button>
        </div>
      </div>

      {/* Formulaire inline pour enregistrer la config courante comme Template SSH */}
      {savingTemplateOpen && (
        <form
          onSubmit={handleSaveAsTemplate}
          className="bg-[#101827] border border-[#E5B84B]/45 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4"
        >
          <div className="flex-1 min-w-[240px] space-y-1.5">
            <label className="block text-xs font-medium text-[#E5B84B]">
              Nom du Template SSH (capture host, port, udpgw_port, protocol, payload brut, sni, ws_path, slowdns)
            </label>
            <input
              type="text"
              required
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="Ex. Template VIP WSS — Douala"
              className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#E5B84B] focus:outline-none rounded-lg text-sm text-[#F2F6FF]"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSavingTemplateOpen(false)}
              className="px-3.5 py-2 rounded-lg bg-[#070B14] border border-[#243147] text-xs text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold cursor-pointer"
            >
              Sauvegarder le Template
            </button>
          </div>
        </form>
      )}

      {/* Bibliothèque Templates SSH (création rapide verrouillée) */}
      <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#E5B84B]" />
            <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
              Templates SSH ({templates.length})
            </h3>
          </div>
          <span className="text-xs text-[#8D9AAF]">
            Sélectionnez un template pour verrouiller les paramètres réseau et provisionner un client en quelques secondes
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {templates.map((tpl) => {
            const isCurrent = activeTemplate?.id === tpl.id;
            return (
              <div
                key={tpl.id}
                className={`p-4 rounded-lg border flex flex-col justify-between gap-3 transition-colors ${
                  isCurrent
                    ? 'bg-[#151F31] border-[#E5B84B]/60'
                    : 'bg-[#070B14] border-[#243147]'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-[#45D7F4]">{tpl.protocol}</span>
                    <span className="font-mono text-[11px] text-[#8D9AAF]">{tpl.id}</span>
                  </div>
                  <p className="text-sm font-semibold text-[#F2F6FF] truncate">{tpl.name}</p>
                  <p className="text-xs font-mono text-[#8D9AAF] truncate">
                    {tpl.host}:{tpl.port} · UDPGW {tpl.udpgw_port}
                    {tpl.sni ? ` · SNI ${tpl.sni}` : ''}
                    {tpl.ws_enabled && tpl.ws_path ? ` · ${tpl.ws_path}` : ''}
                    {tpl.slowdns.enabled ? ` · NS ${tpl.slowdns.nameserver}` : ''}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#243147]">
                  <button
                    type="button"
                    onClick={() => handleCreateFromTemplate(tpl)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/40 text-xs font-medium text-[#45D7F4] whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Créer depuis ce Template
                  </button>
                  {rbac.canDeleteTemplates && (
                    <button
                      type="button"
                      onClick={() => {
                        setTemplates((prev) => prev.filter((item) => item.id !== tpl.id));
                        if (activeTemplate?.id === tpl.id) {
                          setActiveTemplate(null);
                          setAdvancedUnlocked(false);
                        }
                        onNotify(`Template « ${tpl.name} » supprimé.`);
                      }}
                      title="Supprimer ce template"
                      className="p-1.5 text-[#8D9AAF] hover:text-[#EF4444] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Disposition 2 colonnes : Formulaire dynamique à gauche, Aperçu JSON v1 & Actions à droite */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)] gap-6 items-start">
        {/* COLONNE GAUCHE : MODE TEMPLATE RAPIDE OU FORMULAIRE COMPLET */}
        <div className="space-y-6">
          {/* Bandeau Template Actif avec Verrouillage Réseau & Bouton Mode Avancé */}
          {activeTemplate && (
            <section className="bg-[#101827] border border-[#E5B84B]/50 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-mono text-[#E5B84B] flex items-center gap-1.5">
                    {isNetworkLocked ? (
                      <Lock className="w-3.5 h-3.5" />
                    ) : (
                      <Unlock className="w-3.5 h-3.5 text-[#45D7F4]" />
                    )}
                    {isNetworkLocked
                      ? 'Paramètres réseau du Template verrouillés'
                      : 'Mode Avancé actif — Paramètres réseau déverrouillés'}
                  </p>
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                    Template : {activeTemplate.name}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  {rbac.canUnlockAdvancedMode ? (
                    <button
                      type="button"
                      onClick={() => setAdvancedUnlocked((v) => !v)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap cursor-pointer ${
                        advancedUnlocked
                          ? 'bg-[#151F31] border-[#E5B84B] text-[#E5B84B]'
                          : 'bg-[#151F31] border-[#45D7F4]/50 text-[#45D7F4]'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      {advancedUnlocked ? 'Reverrouiller réseau' : 'Mode Avancé'}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#070B14] border border-[#243147] text-[11px] font-mono text-[#8D9AAF]">
                      <Lock className="w-3 h-3 text-[#E5B84B]" />
                      Réseau protégé ({rbac.roleLabel})
                    </span>
                  )}
                  {rbac.canCreateCustomProtocolConfig && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTemplate(null);
                        setAdvancedUnlocked(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#070B14] border border-[#243147] text-xs text-[#8D9AAF] hover:text-[#F2F6FF] whitespace-nowrap cursor-pointer"
                    >
                      Quitter Template
                    </button>
                  )}
                </div>
              </div>

              {/* Résumé lecture seule des paramètres réseau verrouillés */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#243147] text-xs font-mono tabular-nums">
                <div>
                  <span className="text-[#8D9AAF] block">Protocole</span>
                  <span className="text-[#45D7F4]">{config.protocol}</span>
                </div>
                <div>
                  <span className="text-[#8D9AAF] block">Serveur</span>
                  <span className="text-[#F2F6FF] truncate block">
                    {config.server.host}:{config.server.port}
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9AAF] block">UDPGW</span>
                  <span className="text-[#F2F6FF]">
                    {config.server.udpgw_port} ({config.server.udpgw_dns})
                  </span>
                </div>
                <div>
                  <span className="text-[#8D9AAF] block">Couche dédiée</span>
                  <span className="text-[#F2F6FF] truncate block">
                    {config.slowdns.enabled
                      ? `SlowDNS · ${config.slowdns.nameserver}`
                      : config.websocket.enabled
                        ? `WSS · ${config.websocket.path}`
                        : config.tls.enabled
                          ? `SNI · ${config.tls.sni}`
                          : config.payload.content
                            ? `Payload (${config.payload.content.length} car.)`
                            : 'Direct'}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* MODE TEMPLATE VERROUILLÉ : Champs prioritaires mis en avant (Attribution Client/Offre, config_name, ssh_username, ssh_password, quota_bytes, duration) */}
          {isNetworkLocked && (
            <section className="bg-[#101827] border border-[#45D7F4]/40 rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-[#F2F6FF] flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-[#45D7F4]" />
                  Création Rapide Client depuis Template
                </h3>
                <span className="text-xs font-mono text-[#8D9AAF]">
                  ID : <strong className="text-[#45D7F4]">{config.config_id}</strong>
                </span>
              </div>

              {/* Attribution Client & Offre */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1.5">
                    Attribution Client{' '}
                    {rbac.requiresClientAttribution ? (
                      <span className="text-[#E5B84B]">(obligatoire · vos clients uniquement)</span>
                    ) : (
                      '(existant ou libre)'
                    )}
                  </label>
                  <input
                    type="text"
                    list="jts-builder-clients-list"
                    required={rbac.requiresClientAttribution}
                    value={selectedClientName}
                    onChange={(e) => handleApplyClientAttribution(e.target.value)}
                    placeholder={
                      uniqueClientNames[0] ? `Ex. ${uniqueClientNames[0]}` : 'Nom du client...'
                    }
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg text-sm text-[#F2F6FF]"
                  />
                  <datalist id="jts-builder-clients-list">
                    {uniqueClientNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1.5">
                    Attribution Offre / Pass (auto-remplit durée &amp; quota)
                  </label>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => handleApplyPlanAttribution(e.target.value)}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg text-sm text-[#F2F6FF]"
                  >
                    <option value="">Sélectionner une offre autorisée...</option>
                    {allowedPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {plan.durationLabel} ({plan.dataQuotaGb ?? 0} Go)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* config_name + ssh_username + ssh_password */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-[#243147]">
                <div className="md:col-span-3">
                  <label className="block text-xs text-[#8D9AAF] mb-1.5">
                    Nom de la configuration (<code className="text-[#45D7F4]">config_name</code>)
                  </label>
                  <input
                    type="text"
                    value={config.config_name}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, config_name: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg text-sm text-[#F2F6FF]"
                  />
                </div>

                <div className="md:col-span-1">
                  <label className="block text-xs text-[#8D9AAF] mb-1.5">
                    Utilisateur SSH (<code className="text-[#45D7F4]">ssh_username</code>)
                  </label>
                  <input
                    type="text"
                    value={config.authentication.username}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        authentication: { ...prev.authentication, username: e.target.value },
                      }))
                    }
                    placeholder="jts_client01"
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs text-[#8D9AAF] mb-1.5">
                    Mot de passe SSH (<code className="text-[#45D7F4]">ssh_password</code>)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type={showSshPassword ? 'text' : 'password'}
                      value={config.authentication.password}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          authentication: { ...prev.authentication, password: e.target.value },
                        }))
                      }
                      placeholder="••••••••••••"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSshPassword((v) => !v)}
                      title={showSshPassword ? 'Masquer' : 'Afficher'}
                      className="px-2.5 py-2 rounded-lg bg-[#151F31] border border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF] shrink-0 cursor-pointer"
                    >
                      {showSshPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* duration & quota_bytes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#243147]">
                <div className="space-y-2">
                  <label className="block text-xs text-[#8D9AAF]">
                    Durée (<code className="text-[#45D7F4]">duration</code>)
                  </label>
                  <input
                    type="text"
                    value={config.subscription.duration}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        subscription: { ...prev.subscription, duration: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {DURATION_PRESETS.map((dur) => (
                      <button
                        key={dur}
                        type="button"
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            subscription: { ...prev.subscription, duration: dur },
                          }))
                        }
                        className={`px-2 py-1 rounded text-[11px] font-mono border cursor-pointer ${
                          config.subscription.duration === dur
                            ? 'bg-[#151F31] border-[#45D7F4] text-[#45D7F4]'
                            : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
                        }`}
                      >
                        {dur}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label className="text-[#8D9AAF]">
                      Quota (<code className="text-[#45D7F4]">quota_bytes</code>)
                    </label>
                    <span className="font-mono tabular-nums text-[#E5B84B]">{quotaGbDisplay} Go</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={rbac.maxQuotaGb !== null ? rbac.maxQuotaGb * BYTES_PER_GIGABYTE : undefined}
                    value={config.subscription.quota_bytes}
                    onChange={(e) => {
                      const raw = Math.max(0, Number(e.target.value) || 0);
                      const maxBytes =
                        rbac.maxQuotaGb !== null ? rbac.maxQuotaGb * BYTES_PER_GIGABYTE : raw;
                      setConfig((prev) => ({
                        ...prev,
                        subscription: {
                          ...prev.subscription,
                          quota_bytes: Math.min(raw, maxBytes),
                        },
                      }));
                    }}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono tabular-nums text-xs text-[#F2F6FF]"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {allowedQuotaPresetsGb.map((gb) => {
                      const bytes = gb * BYTES_PER_GIGABYTE;
                      return (
                        <button
                          key={gb}
                          type="button"
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              subscription: { ...prev.subscription, quota_bytes: bytes },
                            }))
                          }
                          className={`px-2 py-1 rounded text-[11px] font-mono border cursor-pointer ${
                            config.subscription.quota_bytes === bytes
                              ? 'bg-[#151F31] border-[#45D7F4] text-[#45D7F4]'
                              : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
                          }`}
                        >
                          {gb} Go
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* SECTIONS RÉSEAU COMPLÈTES (affichées hors mode Template verrouillé OU lorsque Mode Avancé est déverrouillé) */}
          {!isNetworkLocked && (
            <>
              {/* 1. Identité & Sélection du Protocole */}
              <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                    01. Protocole &amp; Identité
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-[#8D9AAF]">
                    Couches actives :{' '}
                    <strong className="text-[#45D7F4]">{activeLayersList.join(' + ')}</strong>
                  </span>
                </div>

                {/* Sélecteur des 10 protocoles */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[#8D9AAF]">
                    Protocole de tunnelisation ({SSH_PROTOCOLS.length} modes)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {SSH_PROTOCOLS.map((proto) => {
                      const selected = config.protocol === proto.id;
                      return (
                        <button
                          key={proto.id}
                          type="button"
                          onClick={() => handleSelectProtocol(proto.id)}
                          className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                            selected
                              ? 'bg-[#151F31] border-[#45D7F4] text-[#45D7F4]'
                              : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF] hover:border-[#344663]'
                          }`}
                        >
                          <span className="block font-mono text-[11px] font-semibold truncate">
                            {proto.id}
                          </span>
                          <span className="block text-[11px] text-[#8D9AAF] truncate mt-0.5">
                            {proto.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-[#8D9AAF] pt-1">
                    {activeCap.summary}
                    {config.protocol === 'SSH_DIRECT' && (
                      <span className="text-[#45D7F4]">
                        {' '}
                        — Champs Proxy, TLS/SNI, WebSocket, SlowDNS et Payload masqués automatiquement.
                      </span>
                    )}
                  </p>
                </div>

                {/* Identifiants de la configuration */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#243147]">
                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Identifiant (<code className="text-[#45D7F4]">config_id</code>)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.config_id}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, config_id: e.target.value }))
                        }
                        className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                      />
                      <button
                        type="button"
                        title="Générer un nouvel identifiant"
                        onClick={() =>
                          setConfig((prev) => ({ ...prev, config_id: generateConfigId() }))
                        }
                        className="px-2.5 py-2 rounded-lg bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-[#45D7F4] shrink-0 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Nom de la configuration (<code className="text-[#45D7F4]">config_name</code>)
                    </label>
                    <input
                      type="text"
                      value={config.config_name}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, config_name: e.target.value }))
                      }
                      placeholder="Ex. JUST TECH VIP — Douala WSS"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg text-sm text-[#F2F6FF]"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Remarques / Notes opérateur (<code className="text-[#45D7F4]">remarks</code>)
                    </label>
                    <input
                      type="text"
                      value={config.remarks}
                      onChange={(e) => setConfig((prev) => ({ ...prev, remarks: e.target.value }))}
                      placeholder="Notes affichées dans le client JUST TECH SERVICES TUNNEL"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg text-sm text-[#F2F6FF]"
                    />
                  </div>
                </div>
              </section>

              {/* 2. Serveur SSH & UDPGW */}
              <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF] flex items-center gap-2">
                    <Server className="w-4 h-4 text-[#45D7F4]" />
                    02. Serveur SSH &amp; UDPGW
                  </h3>
                  {servers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-[#8D9AAF]">Pré-remplir :</span>
                      {servers.map((srv) => (
                        <button
                          key={srv.id}
                          type="button"
                          onClick={() => handleApplyServerNode(srv)}
                          className="px-2.5 py-1 rounded-md bg-[#070B14] hover:bg-[#151F31] border border-[#243147] hover:border-[#45D7F4]/50 font-mono text-[11px] text-[#45D7F4] transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {srv.code}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Hôte / IP (<code className="text-[#45D7F4]">server.host</code>)
                    </label>
                    <input
                      type="text"
                      value={config.server.host}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          server: { ...prev.server, host: e.target.value },
                        }))
                      }
                      placeholder="vps1.justtechservices.xyz"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Port (<code className="text-[#45D7F4]">server.port</code>)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={config.server.port}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          server: { ...prev.server, port: Number(e.target.value) || 0 },
                        }))
                      }
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono tabular-nums text-xs text-[#F2F6FF]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Port UDPGW (<code className="text-[#45D7F4]">udpgw_port</code>)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={config.server.udpgw_port}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          server: { ...prev.server, udpgw_port: Number(e.target.value) || 7300 },
                        }))
                      }
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono tabular-nums text-xs text-[#F2F6FF]"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      DNS UDPGW (<code className="text-[#45D7F4]">udpgw_dns</code>)
                    </label>
                    <input
                      type="text"
                      value={config.server.udpgw_dns}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          server: { ...prev.server, udpgw_dns: e.target.value },
                        }))
                      }
                      placeholder="8.8.8.8"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                    />
                  </div>
                </div>
              </section>

              {/* 3. Couches dynamiques selon le protocole (Proxy / TLS / WebSocket / SlowDNS / Payload) */}
              {(activeCap.usesProxy ||
                activeCap.usesTls ||
                activeCap.usesWebsocket ||
                activeCap.usesSlowDns ||
                activeCap.usesPayload) && (
                <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                      03. Couches Transport — {config.protocol}
                    </h3>
                    <span className="text-xs text-[#8D9AAF]">
                      Champs filtrés automatiquement pour ce protocole
                    </span>
                  </div>

                  {/* PROXY HTTP */}
                  {activeCap.usesProxy && (
                    <div className="space-y-3 pt-1">
                      <h4 className="text-xs font-semibold text-[#45D7F4]">
                        Relais Proxy HTTP (<code className="text-[#E8EEF5]">proxy</code>)
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-[#8D9AAF] mb-1.5">
                            Hôte Proxy (<code className="text-[#45D7F4]">proxy.host</code>)
                          </label>
                          <input
                            type="text"
                            value={config.proxy.host}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                proxy: { ...prev.proxy, host: e.target.value },
                              }))
                            }
                            placeholder="proxy.operateur.cm ou IP"
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#8D9AAF] mb-1.5">
                            Port Proxy (<code className="text-[#45D7F4]">proxy.port</code>)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={config.proxy.port}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                proxy: { ...prev.proxy, port: Number(e.target.value) || 0 },
                              }))
                            }
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono tabular-nums text-xs text-[#F2F6FF]"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TLS / SNI */}
                  {activeCap.usesTls && (
                    <div className="space-y-3 pt-4 first:pt-1 border-t first:border-t-0 border-[#243147]">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold text-[#45D7F4]">
                          Couche SSL / TLS (<code className="text-[#E8EEF5]">tls</code>)
                        </h4>
                        <label className="inline-flex items-center gap-2 text-xs text-[#E8EEF5] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.tls.enabled}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                tls: { ...prev.tls, enabled: e.target.checked },
                              }))
                            }
                            className="accent-[#45D7F4]"
                          />
                          TLS activé
                        </label>
                      </div>
                      <div>
                        <label className="block text-xs text-[#8D9AAF] mb-1.5">
                          Server Name Indication (<code className="text-[#45D7F4]">tls.sni</code>)
                        </label>
                        <input
                          type="text"
                          disabled={!config.tls.enabled}
                          value={config.tls.sni}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              tls: { ...prev.tls, sni: e.target.value },
                            }))
                          }
                          placeholder="cdn.justtechservices.xyz"
                          className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg font-mono text-xs text-[#F2F6FF]"
                        />
                      </div>
                    </div>
                  )}

                  {/* WEBSOCKET (WSS) */}
                  {activeCap.usesWebsocket && (
                    <div className="space-y-3 pt-4 first:pt-1 border-t first:border-t-0 border-[#243147]">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold text-[#45D7F4]">
                          WebSocket (<code className="text-[#E8EEF5]">websocket</code>)
                        </h4>
                        <label className="inline-flex items-center gap-2 text-xs text-[#E8EEF5] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.websocket.enabled}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                websocket: { ...prev.websocket, enabled: e.target.checked },
                              }))
                            }
                            className="accent-[#45D7F4]"
                          />
                          WebSocket activé
                        </label>
                      </div>
                      <div>
                        <label className="block text-xs text-[#8D9AAF] mb-1.5">
                          Chemin WebSocket (<code className="text-[#45D7F4]">websocket.path</code>)
                        </label>
                        <input
                          type="text"
                          disabled={!config.websocket.enabled}
                          value={config.websocket.path}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              websocket: { ...prev.websocket, path: e.target.value },
                            }))
                          }
                          placeholder="/wss"
                          className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg font-mono text-xs text-[#F2F6FF]"
                        />
                      </div>
                    </div>
                  )}

                  {/* SLOWDNS */}
                  {activeCap.usesSlowDns && (
                    <div className="space-y-3 pt-4 first:pt-1 border-t first:border-t-0 border-[#243147]">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold text-[#45D7F4]">
                          SlowDNS / dnstt (<code className="text-[#E8EEF5]">slowdns</code>)
                        </h4>
                        <label className="inline-flex items-center gap-2 text-xs text-[#E8EEF5] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.slowdns.enabled}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                slowdns: { ...prev.slowdns, enabled: e.target.checked },
                              }))
                            }
                            className="accent-[#45D7F4]"
                          />
                          SlowDNS activé
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-[#8D9AAF] mb-1.5">
                            Nameserver NS (<code className="text-[#45D7F4]">slowdns.nameserver</code>)
                          </label>
                          <input
                            type="text"
                            disabled={!config.slowdns.enabled}
                            value={config.slowdns.nameserver}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                slowdns: { ...prev.slowdns, nameserver: e.target.value },
                              }))
                            }
                            placeholder="sdns1.justtechservices.xyz"
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg font-mono text-xs text-[#F2F6FF]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#8D9AAF] mb-1.5">
                            Serveur DNS (<code className="text-[#45D7F4]">slowdns.dns_server</code>)
                          </label>
                          <input
                            type="text"
                            disabled={!config.slowdns.enabled}
                            value={config.slowdns.dns_server}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                slowdns: { ...prev.slowdns, dns_server: e.target.value },
                              }))
                            }
                            placeholder="8.8.8.8:53"
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg font-mono text-xs text-[#F2F6FF]"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs text-[#8D9AAF] mb-1.5">
                            Clé Publique dnstt (<code className="text-[#45D7F4]">slowdns.public_key</code>)
                          </label>
                          <input
                            type="text"
                            disabled={!config.slowdns.enabled}
                            value={config.slowdns.public_key}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                slowdns: { ...prev.slowdns, public_key: e.target.value },
                              }))
                            }
                            placeholder="Clé hexadécimale dnstt"
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg font-mono text-xs text-[#F2F6FF]"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ÉDITEUR DE PAYLOAD BRUT */}
                  {activeCap.usesPayload && (
                    <div className="pt-4 first:pt-1 border-t first:border-t-0 border-[#243147]">
                      <RawPayloadEditor
                        value={config.payload.content}
                        onChange={(nextContent) =>
                          setConfig((prev) => ({
                            ...prev,
                            payload: { content: nextContent },
                          }))
                        }
                        onNotify={onNotify}
                      />
                    </div>
                  )}
                </section>
              )}

              {/* 4. Authentification SSH */}
              <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF] flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#45D7F4]" />
                    04. Authentification SSH
                  </h3>
                  <span className="text-xs text-[#8D9AAF]">
                    Jamais exposée dans les URL de partage ni QR codes publics
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Méthode (<code className="text-[#45D7F4]">authentication.type</code>)
                    </label>
                    <select
                      value={config.authentication.type}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          authentication: {
                            ...prev.authentication,
                            type: e.target.value as SshAuthType,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg text-xs text-[#F2F6FF]"
                    >
                      <option value="password">Mot de passe (password)</option>
                      <option value="private_key">Clé privée SSH (private_key)</option>
                      <option value="password_and_key">Mot de passe + Clé privée</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Utilisateur (<code className="text-[#45D7F4]">username</code>)
                    </label>
                    <input
                      type="text"
                      value={config.authentication.username}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          authentication: { ...prev.authentication, username: e.target.value },
                        }))
                      }
                      placeholder="jts_client01"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                    />
                  </div>

                  {(config.authentication.type === 'password' ||
                    config.authentication.type === 'password_and_key') && (
                    <div>
                      <label className="block text-xs text-[#8D9AAF] mb-1.5">
                        Mot de passe (<code className="text-[#45D7F4]">password</code>)
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type={showSshPassword ? 'text' : 'password'}
                          value={config.authentication.password}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              authentication: { ...prev.authentication, password: e.target.value },
                            }))
                          }
                          placeholder="••••••••••••"
                          className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSshPassword((v) => !v)}
                          title={showSshPassword ? 'Masquer' : 'Afficher'}
                          className="px-2.5 py-2 rounded-lg bg-[#151F31] border border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF] shrink-0 cursor-pointer"
                        >
                          {showSshPassword ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {(config.authentication.type === 'private_key' ||
                  config.authentication.type === 'password_and_key') && (
                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Clé privée PEM / OpenSSH (<code className="text-[#45D7F4]">private_key</code>)
                    </label>
                    <textarea
                      rows={4}
                      spellCheck={false}
                      value={config.authentication.private_key}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          authentication: { ...prev.authentication, private_key: e.target.value },
                        }))
                      }
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      className="w-full p-3 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF] whitespace-pre overflow-x-auto"
                    />
                  </div>
                )}
              </section>

              {/* 5. Abonnement & Diffusion Cloud */}
              <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
                <h3 className="font-display text-base font-semibold text-[#F2F6FF] flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-[#45D7F4]" />
                  05. Abonnement &amp; Liaison Cloud
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Durée */}
                  <div className="space-y-2">
                    <label className="block text-xs text-[#8D9AAF]">
                      Durée (<code className="text-[#45D7F4]">subscription.duration</code>)
                    </label>
                    <input
                      type="text"
                      value={config.subscription.duration}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          subscription: { ...prev.subscription, duration: e.target.value },
                        }))
                      }
                      placeholder="30d"
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {DURATION_PRESETS.map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              subscription: { ...prev.subscription, duration: dur },
                            }))
                          }
                          className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                            config.subscription.duration === dur
                              ? 'bg-[#151F31] border-[#45D7F4] text-[#45D7F4]'
                              : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
                          }`}
                        >
                          {dur}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quota Bytes */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <label className="text-[#8D9AAF]">
                        Quota (<code className="text-[#45D7F4]">subscription.quota_bytes</code>)
                      </label>
                      <span className="font-mono tabular-nums text-[#E5B84B]">
                        {quotaGbDisplay} Go
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={config.subscription.quota_bytes}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          subscription: {
                            ...prev.subscription,
                            quota_bytes: Math.max(0, Number(e.target.value) || 0),
                          },
                        }))
                      }
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono tabular-nums text-xs text-[#F2F6FF]"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {QUOTA_PRESETS_GB.map((gb) => {
                        const bytes = gb * BYTES_PER_GIGABYTE;
                        return (
                          <button
                            key={gb}
                            type="button"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                subscription: { ...prev.subscription, quota_bytes: bytes },
                              }))
                            }
                            className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                              config.subscription.quota_bytes === bytes
                                ? 'bg-[#151F31] border-[#45D7F4] text-[#45D7F4]'
                                : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
                            }`}
                          >
                            {gb} Go
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Cloud Config */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-[#243147] items-end">
                  <div>
                    <label className="inline-flex items-center gap-2 text-xs text-[#F2F6FF] cursor-pointer py-2">
                      <input
                        type="checkbox"
                        checked={config.cloud.enabled}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            cloud: { ...prev.cloud, enabled: e.target.checked },
                          }))
                        }
                        className="accent-[#45D7F4]"
                      />
                      Diffusion Cloud (<code className="text-[#45D7F4]">cloud.enabled</code>)
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Code Cloud (<code className="text-[#45D7F4]">cloud_code</code>)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        disabled={!config.cloud.enabled}
                        value={config.cloud.cloud_code}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            cloud: { ...prev.cloud, cloud_code: e.target.value },
                          }))
                        }
                        className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg font-mono text-xs text-[#E5B84B]"
                      />
                      <button
                        type="button"
                        disabled={!config.cloud.enabled}
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            cloud: { ...prev.cloud, cloud_code: generateCloudCodeV1() },
                          }))
                        }
                        title="Générer un nouveau cloud_code révocable"
                        className="px-2.5 py-2 rounded-lg bg-[#151F31] border border-[#243147] text-[#45D7F4] disabled:opacity-50 shrink-0 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[#8D9AAF] mb-1.5">
                      Statut Cloud (<code className="text-[#45D7F4]">cloud.status</code>)
                    </label>
                    <select
                      disabled={!config.cloud.enabled}
                      value={config.cloud.status}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          cloud: { ...prev.cloud, status: e.target.value as CloudConfigStatus },
                        }))
                      }
                      className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none disabled:opacity-50 rounded-lg text-xs text-[#F2F6FF]"
                    >
                      <option value="active">active</option>
                      <option value="draft">draft</option>
                      <option value="revoked">revoked</option>
                      <option value="expired">expired</option>
                    </select>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        {/* COLONNE DROITE : DISTRIBUTION CLOUD & QR, SORTIE JSON V1 & REGISTRE CLOUD */}
        <div className="space-y-5 xl:sticky xl:top-20">
          {/* Carte Distribution Cloud Config (JTS-XXXX-XXXX, lien resolve, URI jts://, QR Code zéro-secret, Simulateur & Révocation) */}
          <section className="bg-[#101827] border border-[#45D7F4]/40 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#E5B84B]" />
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  Distribution Cloud &amp; QR Code
                </h3>
              </div>
              {activeCloudRecord ? (
                <span
                  className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                    activeCloudRecord.config.cloud.status === 'active' &&
                    activeCloudRecord.config.cloud.enabled
                      ? 'bg-[#45D7F4]/10 border-[#45D7F4]/40 text-[#45D7F4]'
                      : 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#EF4444]'
                  }`}
                >
                  {activeCloudRecord.config.cloud.status.toUpperCase()}
                </span>
              ) : (
                <span className="font-mono text-[11px] text-[#8D9AAF]">Non publié</span>
              )}
            </div>

            {activeCloudRecord ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-[#070B14] border border-[#243147] rounded-xl p-4">
                  <div className="p-2 bg-[#F2F6FF] rounded-lg shrink-0">
                    <img
                      src={activeCloudRecord.qrDataUrl}
                      alt={`QR Code sécurisé ${activeCloudRecord.cloudCode}`}
                      className="w-28 h-28 block"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2 w-full">
                    <div>
                      <span className="text-[11px] text-[#8D9AAF] block">
                        Identifiant unique Cloud
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-base font-bold text-[#E5B84B] tracking-wider">
                          {activeCloudRecord.cloudCode}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void copyInlineValue('code', activeCloudRecord.cloudCode, 'Code Cloud')
                          }
                          className="p-1.5 rounded bg-[#151F31] border border-[#243147] text-[#45D7F4] hover:text-[#F2F6FF] cursor-pointer"
                          title="Copier le code Cloud"
                        >
                          {copiedField === 'code' ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-[#8D9AAF] leading-relaxed">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#45D7F4] inline mr-1 -mt-0.5" />
                      QR Code zéro-secret : encode uniquement{' '}
                      <code className="text-[#45D7F4]">jts://import?code={activeCloudRecord.cloudCode}</code>{' '}
                      (jamais le mot de passe SSH).
                    </p>
                  </div>
                </div>

                {/* Liens API & Deep Link */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#070B14] border border-[#243147]">
                    <div className="min-w-0">
                      <span className="text-[10px] text-[#8D9AAF] uppercase block">
                        Endpoint Résolution API
                      </span>
                      <p className="font-mono text-[11px] text-[#45D7F4] truncate">
                        {displayedLinks.resolveUrl}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void copyInlineValue('url', displayedLinks.resolveUrl, 'Lien API Resolve')
                      }
                      className="p-1.5 rounded bg-[#151F31] border border-[#243147] text-[#E8EEF5] hover:text-[#45D7F4] shrink-0 cursor-pointer"
                      title="Copier l'URL de résolution"
                    >
                      {copiedField === 'url' ? (
                        <Check className="w-3.5 h-3.5 text-[#45D7F4]" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#070B14] border border-[#243147]">
                    <div className="min-w-0">
                      <span className="text-[10px] text-[#8D9AAF] uppercase block">
                        URI Mobile JUST TECH SERVICES TUNNEL
                      </span>
                      <p className="font-mono text-[11px] text-[#E5B84B] truncate">
                        {displayedLinks.importUri}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void copyInlineValue('uri', displayedLinks.importUri, 'URI jts://')
                      }
                      className="p-1.5 rounded bg-[#151F31] border border-[#243147] text-[#E8EEF5] hover:text-[#E5B84B] shrink-0 cursor-pointer"
                      title="Copier l'URI jts://"
                    >
                      {copiedField === 'uri' ? (
                        <Check className="w-3.5 h-3.5 text-[#E5B84B]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Actions Simulateur & Révocation immédiate */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openSimulatorForCode(activeCloudRecord.cloudCode)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#45D7F4] hover:bg-[#32C5E2] text-[#070B14] text-xs font-semibold whitespace-nowrap cursor-pointer"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Simulateur d&apos;Import Mobile
                  </button>

                  {canActorRevokeRecord(activeCloudRecord) && (
                    <button
                      type="button"
                      disabled={revokingCode === activeCloudRecord.cloudCode}
                      onClick={() => void handleToggleRevokeCloudCode(activeCloudRecord)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                        activeCloudRecord.config.cloud.status === 'revoked' ||
                        !activeCloudRecord.config.cloud.enabled
                          ? 'bg-[#151F31] border-[#45D7F4]/50 text-[#45D7F4]'
                          : 'bg-[#EF4444]/10 border-[#EF4444]/45 text-[#EF4444] hover:bg-[#EF4444]/20'
                      }`}
                    >
                      {activeCloudRecord.config.cloud.status === 'revoked' ||
                      !activeCloudRecord.config.cloud.enabled ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          Réactiver
                        </>
                      ) : (
                        <>
                          <Ban className="w-3.5 h-3.5" />
                          Révoquer / Désactiver
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#070B14] border border-[#243147] text-xs text-[#8D9AAF] space-y-2">
                <p>
                  Cliquez sur <strong className="text-[#45D7F4]">Enregistrer &amp; Publier Cloud</strong>{' '}
                  pour générer un identifiant unique <code className="text-[#E5B84B]">JTS-XXXX-XXXX</code>,
                  un lien d&apos;importation API et un QR Code sécurisé sans secret en clair.
                </p>
              </div>
            )}
          </section>

          {/* Panneau Sortie JSON v1 (EXCLUSIVEMENT Super Admin) */}
          {rbac.canViewRawJson ? (
            <section className="bg-[#101827] border border-[#E5B84B]/40 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-[#E5B84B]" />
                  <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                    Sortie JSON v1 (Super Admin)
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {rbac.canDuplicateConfig && (
                    <button
                      type="button"
                      onClick={() => handleDuplicateConfig(config)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#E8EEF5] whitespace-nowrap cursor-pointer"
                    >
                      <CopyPlus className="w-3.5 h-3.5 text-[#E5B84B]" />
                      Duplicate Config
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleExportJsonClipboard(config)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#F2F6FF] whitespace-nowrap cursor-pointer"
                  >
                    {copiedJson ? (
                      <Check className="w-3.5 h-3.5 text-[#45D7F4]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#45D7F4]" />
                    )}
                    {copiedJson ? 'Copié' : 'Export JSON'}
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerDownloadConfig(config, '.jts')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#E5B84B]/45 text-xs font-medium text-[#E5B84B] whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .jts
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerDownloadConfig(config, '.json')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/45 text-xs font-medium text-[#45D7F4] whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .json
                  </button>
                </div>
              </div>

              <p className="text-xs text-[#8D9AAF]">
                Visible uniquement par le <strong className="text-[#E5B84B]">Super Admin</strong> pour adapter la configuration JSON à chaque utilisateur. Invisible côté Client et Revendeur.
              </p>

              {/* Garde sécurité secrets */}
              <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-[#070B14] border border-[#243147] text-xs">
                <div className="flex items-center gap-2 text-[#E8EEF5]">
                  {effectiveRedactPreview ? (
                    <ShieldCheck className="w-4 h-4 text-[#45D7F4] shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 text-[#E5B84B] shrink-0" />
                  )}
                  <span>
                    {effectiveRedactPreview
                      ? 'Secrets SSH masqués (partage sûr)'
                      : 'Export privé local (secrets inclus)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setRedactPreviewSecrets((v) => !v)}
                  className="text-[11px] font-medium text-[#45D7F4] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {redactPreviewSecrets ? 'Inclure secrets localement' : 'Masquer secrets'}
                </button>
              </div>

              {/* Validation protocole */}
              {validationIssues.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-[#45D7F4]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Contrat JUST TECH SERVICES TUNNEL v1 valide ({config.protocol}).</span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#070B14] border border-[#E5B84B]/40 space-y-1.5">
                  <p className="text-xs font-medium text-[#E5B84B] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {validationIssues.length} champ(s) à compléter pour {config.protocol}
                  </p>
                  <ul className="space-y-1 text-[11px] text-[#8D9AAF] font-mono">
                    {validationIssues.map((issue) => (
                      <li key={issue.field}>
                        {issue.field} — {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Prévisualisation JSON monospace */}
              <pre className="p-4 bg-[#070B14] border border-[#243147] rounded-lg font-mono text-[11px] leading-relaxed text-[#45D7F4] overflow-x-auto max-h-[360px] whitespace-pre">
                {schemaV1Json}
              </pre>
            </section>
          ) : (
            <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#E5B84B]" />
                  <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
                    Validation &amp; Confidentialité JSON
                  </h3>
                </div>
                {rbac.canDuplicateConfig && (
                  <button
                    type="button"
                    onClick={() => handleDuplicateConfig(config)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#E8EEF5] whitespace-nowrap cursor-pointer"
                  >
                    <CopyPlus className="w-3.5 h-3.5 text-[#E5B84B]" />
                    Duplicate Config
                  </button>
                )}
              </div>

              {validationIssues.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-[#45D7F4]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Configuration prête pour publication Cloud ({config.protocol}).</span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#070B14] border border-[#E5B84B]/40 space-y-1.5">
                  <p className="text-xs font-medium text-[#E5B84B] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {validationIssues.length} champ(s) à compléter
                  </p>
                  <ul className="space-y-1 text-[11px] text-[#8D9AAF] font-mono">
                    {validationIssues.map((issue) => (
                      <li key={issue.field}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-[#8D9AAF] leading-relaxed">
                L&apos;inspection et l&apos;exportation du fichier JSON brut sont strictement réservés au{' '}
                <strong className="text-[#E5B84B]">Super Admin</strong>. Utilisez le{' '}
                <strong className="text-[#45D7F4]">Code Cloud</strong> ou le{' '}
                <strong className="text-[#45D7F4]">QR Code</strong> ci-dessus pour livrer le client.
              </p>
            </section>
          )}

          {/* Registre Cloud distribué filtré RBAC (/api/v1/cloud/configs) */}
          <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
                Configurations Cloud distribuées ({cloudRecords.length})
              </h3>
              <span className="text-[11px] font-mono text-[#8D9AAF]">
                {isResellerScoped ? 'Vos clients uniquement' : 'Périmètre global'}
              </span>
            </div>

            {cloudRecords.length === 0 ? (
              <p className="text-xs text-[#8D9AAF]">
                Aucune configuration Cloud distribuée dans votre périmètre RBAC ({rbac.roleLabel}).
              </p>
            ) : (
              <div className="divide-y divide-[#243147]">
                {cloudRecords.map((rec) => {
                  const isSelected = activeCloudRecord?.cloudCode === rec.cloudCode;
                  const isRevoked =
                    rec.config.cloud.status === 'revoked' || !rec.config.cloud.enabled;
                  return (
                    <div key={rec.cloudCode} className="py-3 first:pt-0 last:pb-0 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveCloudRecord(rec);
                            setConfig(structuredClone(rec.config));
                            if (rec.assignedClientName) {
                              setSelectedClientName(rec.assignedClientName);
                            }
                            onNotify(`Configuration Cloud ${rec.cloudCode} sélectionnée.`);
                          }}
                          className="text-left min-w-0 flex-1 cursor-pointer group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-[#E5B84B]">
                              {rec.cloudCode}
                            </span>
                            <span
                              className={`text-[10px] font-mono ${
                                isRevoked ? 'text-[#EF4444]' : 'text-[#45D7F4]'
                              }`}
                            >
                              {isRevoked ? 'RÉVOQUÉ' : 'ACTIF'}
                            </span>
                            <span className="text-[10px] font-mono text-[#8D9AAF]">
                              · {rec.resolveCount} résol.
                            </span>
                          </div>
                          <p
                            className={`text-xs font-medium truncate mt-0.5 ${
                              isSelected
                                ? 'text-[#45D7F4]'
                                : 'text-[#F2F6FF] group-hover:text-[#45D7F4]'
                            }`}
                          >
                            {rec.config.config_name || rec.configId}
                          </p>
                          <p className="text-[11px] text-[#8D9AAF] truncate">
                            {rec.assignedClientName ? `Client: ${rec.assignedClientName} · ` : ''}
                            {rec.config.protocol} · {ROLE_LABELS[rec.ownerRole]}
                          </p>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveCloudRecord(rec);
                            openSimulatorForCode(rec.cloudCode);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#45D7F4]/40 text-[11px] font-medium text-[#45D7F4] whitespace-nowrap cursor-pointer"
                        >
                          <Smartphone className="w-3 h-3" />
                          Tester API
                        </button>

                        {canActorRevokeRecord(rec) && (
                          <button
                            type="button"
                            disabled={revokingCode === rec.cloudCode}
                            onClick={() => void handleToggleRevokeCloudCode(rec)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                              isRevoked
                                ? 'bg-[#070B14] border-[#45D7F4]/35 text-[#45D7F4]'
                                : 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#EF4444]'
                            }`}
                          >
                            {isRevoked ? (
                              <>
                                <RotateCcw className="w-3 h-3" />
                                Réactiver
                              </>
                            ) : (
                              <>
                                <Ban className="w-3 h-3" />
                                Révoquer
                              </>
                            )}
                          </button>
                        )}

                        {rbac.canDuplicateConfig && (
                          <button
                            type="button"
                            onClick={() => handleDuplicateConfig(rec.config)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#243147] text-[11px] font-medium text-[#E5B84B] whitespace-nowrap cursor-pointer"
                          >
                            <CopyPlus className="w-3 h-3" />
                            Duplicate
                          </button>
                        )}

                        {rbac.canExportJson && (
                          <>
                            <button
                              type="button"
                              onClick={() => triggerDownloadConfig(rec.config, '.jts')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#E5B84B]/35 text-[11px] font-mono text-[#E5B84B] whitespace-nowrap cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              .jts
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerDownloadConfig(rec.config, '.json')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#45D7F4]/35 text-[11px] font-mono text-[#45D7F4] whitespace-nowrap cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              .json
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Brouillons locaux enregistrés (Staff uniquement si différent) */}
          {rbac.canCreateCustomProtocolConfig && (
            <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
                  Brouillons locaux ({savedConfigs.length})
                </h3>
                <span className="text-[11px] text-[#8D9AAF]">Duplication &amp; Export rapide</span>
              </div>

              <div className="divide-y divide-[#243147]">
                {savedConfigs.map((item) => {
                  const isEditing = item.config_id === config.config_id;
                  return (
                    <div key={item.config_id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfig(structuredClone(item));
                            setActiveTemplate(null);
                            setAdvancedUnlocked(false);
                            onNotify(`Configuration ${item.config_id} chargée dans l'éditeur.`);
                          }}
                          className="text-left min-w-0 flex-1 cursor-pointer group"
                        >
                          <p
                            className={`text-xs font-medium truncate ${
                              isEditing
                                ? 'text-[#45D7F4]'
                                : 'text-[#F2F6FF] group-hover:text-[#45D7F4]'
                            }`}
                          >
                            {item.config_name || item.config_id}
                          </p>
                          <p className="text-[11px] font-mono text-[#8D9AAF] truncate">
                            {item.config_id} · {item.protocol} · {item.server.host}:{item.server.port}
                          </p>
                        </button>
                        {rbac.canDeleteSavedConfig && (
                          <button
                            type="button"
                            onClick={() =>
                              setSavedConfigs((prev) =>
                                prev.filter((c) => c.config_id !== item.config_id)
                              )
                            }
                            title="Supprimer ce brouillon"
                            className="p-1 text-[#8D9AAF] hover:text-[#EF4444] cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDuplicateConfig(item)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#243147] text-[11px] font-medium text-[#E5B84B] whitespace-nowrap cursor-pointer"
                        >
                          <CopyPlus className="w-3 h-3" />
                          Duplicate Config
                        </button>
                        {rbac.canExportJson && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleExportJsonClipboard(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#243147] text-[11px] font-medium text-[#E8EEF5] whitespace-nowrap cursor-pointer"
                            >
                              <Copy className="w-3 h-3 text-[#45D7F4]" />
                              Export JSON
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerDownloadConfig(item, '.jts')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#E5B84B]/35 text-[11px] font-mono text-[#E5B84B] whitespace-nowrap cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              .jts
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerDownloadConfig(item, '.json')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#070B14] hover:bg-[#151F31] border border-[#45D7F4]/35 text-[11px] font-mono text-[#45D7F4] whitespace-nowrap cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              .json
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Modale Simulateur d'Import Mobile (Test Contrat API) */}
      <MobileImportSimulatorModal
        isOpen={simulatorOpen}
        initialCloudCode={simulatorTargetCode}
        activeRecord={
          cloudRecords.find((r) => r.cloudCode === simulatorTargetCode) ?? activeCloudRecord
        }
        canRevoke={canActorRevokeRecord(
          cloudRecords.find((r) => r.cloudCode === simulatorTargetCode) ?? activeCloudRecord
        )}
        canViewRawJson={rbac.canViewRawJson}
        onClose={() => setSimulatorOpen(false)}
        onRecordUpdated={(updated) => {
          setCloudRecords((prev) =>
            prev.map((item) => (item.cloudCode === updated.cloudCode ? updated : item))
          );
          if (activeCloudRecord?.cloudCode === updated.cloudCode) {
            setActiveCloudRecord(updated);
          }
          if (config.cloud.cloud_code === updated.cloudCode) {
            setConfig((prev) => ({
              ...prev,
              cloud: {
                ...prev.cloud,
                enabled: updated.config.cloud.enabled,
                status: updated.config.cloud.status,
              },
            }));
          }
        }}
        onNotify={onNotify}
      />
    </div>
  );
};

export default CloudConfigBuilder;
