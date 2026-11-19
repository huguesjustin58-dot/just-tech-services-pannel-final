import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Camera,
  Check,
  Cloud,
  Copy,
  Download,
  Flame,
  Gift,
  Lock,
  MessageSquarePlus,
  ScanSearch,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import {
  PAYMENT_ACCOUNTS,
  PLANS,
  compileNpvFromPrototype,
  formatFcfa,
} from '../data/maquetteData';
import {
  AuthenticatedUser,
  CloudActivationRecord,
  CloudConfigBundle,
  DeliveryPlatform,
  NpvPrototype,
  PaymentGatewayConfig,
  PlanOffer,
} from '../types/panel';
import { CloudConfigGeneratorCard } from './CloudConfigGeneratorCard';
import { LicenseStatusText } from './StatusText';
import { serviceAIAgent } from '../services/ServiceAIAgent';

interface ClientForensicReport {
  screenshotSha256: string | null;
  authenticityScore: number;
  isFalsified: boolean;
  extractedTxId: string;
  extractedRecipient: string;
  binaryTamperFlags: string[];
  forensicSensors: {
    typographyAndAlignment: string;
    uiConsistency: string;
    metadataAndReplay: string;
    beneficiaryAndAmountMatch: string;
  };
}

interface ClientWorkspaceProps {
  currentUser: AuthenticatedUser | null;
  npvPrototype: NpvPrototype;
  latestCloudCode: CloudActivationRecord | null;
  onGenerateCloudCode: (
    clientName: string,
    planName: string,
    sshUsername: string,
    explicitCode?: string
  ) => CloudActivationRecord;
}

function getOrCreateDeviceFingerprint(): string {
  const key = 'jts_device_fp_v1';
  let fp = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  if (!fp) {
    fp = `DEV-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, fp);
    }
  }
  return fp;
}

export const ClientWorkspace: React.FC<ClientWorkspaceProps> = ({
  currentUser,
  npvPrototype,
  latestCloudCode,
  onGenerateCloudCode,
}) => {
  const accountId = currentUser?.id ?? '';
  const clientName = currentUser?.name || 'Client JTS';
  const [deviceFingerprint] = useState<string>(() => getOrCreateDeviceFingerprint());

  const [selectedPlan, setSelectedPlan] = useState<PlanOffer>(
    () => PLANS.find((p) => p.id === 'npv-5000') ?? PLANS[0]
  ); // NPV 60 Go par défaut
  const [activeExpiry] = useState('2026-12-18');
  const [dataUsedGb] = useState(14.2);
  const [sshCredentials, setSshCredentials] = useState({
    username: '',
    password: '',
  });

  // État passerelles paiement & plafond Orange OM ASSO
  const [paymentConfig, setPaymentConfig] = useState<PaymentGatewayConfig>({
    ...PAYMENT_ACCOUNTS,
    orangeCeilingFcfa: 1500000,
    orangeCurrentVolumeFcfa: 0,
    orangeCeilingReachedManual: false,
    orangeCeilingExceeded: false,
  });

  // État anti-abus Offre Test Gratuit (1 test/appareil, 2 générations max/compte)
  const [accountTestsUsed, setAccountTestsUsed] = useState(0);
  const [deviceAlreadyTested, setDeviceAlreadyTested] = useState(false);

  const [selectedPlatform, setSelectedPlatform] = useState<DeliveryPlatform | null>(null);
  const [activeCloudCode, setActiveCloudCode] = useState<CloudActivationRecord | null>(
    latestCloudCode
  );
  const [activeCloudBundle, setActiveCloudBundle] = useState<CloudConfigBundle | null>(null);
  const [cloudBundleLoading, setCloudBundleLoading] = useState(false);
  const [cloudBundleError, setCloudBundleError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Tunnel Checkout : Étape 1 (Paiement / Agent IA) -> Étape 2 (Sélection OS Android vs iPhone après validation)
  const [checkoutPlan, setCheckoutPlan] = useState<PlanOffer | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<'payment' | 'os_select'>('payment');
  const [paymentMethod, setPaymentMethod] = useState<
    'MTN Mobile Money' | 'Orange Money' | 'Orange OM ASSO'
  >('MTN Mobile Money');
  const [payerPhone, setPayerPhone] = useState('+237 677 00 00 00');
  const [txId, setTxId] = useState('');
  const [smsProof, setSmsProof] = useState('');
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotMimeType, setScreenshotMimeType] = useState<string | null>(null);
  const [screenshotFileName, setScreenshotFileName] = useState<string | null>(null);
  const [forensicReport, setForensicReport] = useState<ClientForensicReport | null>(null);
  const [agentVerifying, setAgentVerifying] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentVerdictReason, setAgentVerdictReason] = useState<string | null>(null);
  const [deliveryToken, setDeliveryToken] = useState<string | null>(null);
  const [osGenerating, setOsGenerating] = useState(false);
  const [deliveredOs, setDeliveredOs] = useState<DeliveryPlatform | null>(null);

  // Assistant Agent IA Client
  const [showAgentChat, setShowAgentChat] = useState(false);
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentMessages, setAgentMessages] = useState<
    { role: 'user' | 'assistant'; text: string }[]
  >([
    {
      role: 'assistant',
      text: "Bonjour, je suis l'Agent IA JUST TECH SERVICES. Je vérifie vos paiements MTN MoMo / Orange Money (ou OM ASSO 1017614), contrôle l'éligibilité de votre Test Gratuit et génère vos accès Android ou iPhone.",
    },
  ]);

  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [clientMessage, setClientMessage] = useState<string | null>(null);

  const notify = (msg: string) => {
    setClientMessage(msg);
    setTimeout(() => setClientMessage(null), 4500);
  };

  useEffect(() => {
    fetch('/api/payment-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPaymentConfig(data);
      })
      .catch(() => undefined);

    fetch(
      `/api/test-eligibility?accountId=${encodeURIComponent(accountId)}&deviceFingerprint=${encodeURIComponent(deviceFingerprint)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setAccountTestsUsed(data.accountTestsUsed ?? 0);
          setDeviceAlreadyTested(Boolean(data.deviceAlreadyUsed));
        }
      })
      .catch(() => undefined);
  }, [accountId, deviceFingerprint]);

  const copyValue = (key: string, value: string, label: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
    notify(`${label} copié dans le presse-papiers.`);
  };

  const openCheckoutForPlan = async (plan: PlanOffer) => {
    setAgentError(null);
    setAgentVerdictReason(null);
    setForensicReport(null);
    setScreenshotPreview(null);
    setScreenshotBase64(null);
    setScreenshotMimeType(null);
    setScreenshotFileName(null);
    setDeliveryToken(null);
    setDeliveredOs(null);
    setTxId('');
    setSmsProof('');

    // Rafraîchit le statut plafond Orange Money & éligibilité test en temps réel
    try {
      const cfgRes = await fetch('/api/payment-config');
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as PaymentGatewayConfig;
        setPaymentConfig(cfg);
        if (cfg.orangeCeilingExceeded && paymentMethod === 'Orange Money') {
          setPaymentMethod('Orange OM ASSO');
        }
      }
    } catch {
      // Garde l'état local si hors ligne
    }

    setCheckoutPlan(plan);
    setCheckoutStep('payment');
  };

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAgentError('Format refusé : importez une capture d’écran PNG, JPG ou WebP.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setAgentError('Image trop volumineuse (max 6 Mo).');
      return;
    }
    setAgentError(null);
    setForensicReport(null);
    setScreenshotFileName(file.name);
    setScreenshotMimeType(file.type);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const cleanBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setScreenshotPreview(dataUrl);
      setScreenshotBase64(cleanBase64);
    };
    reader.readAsDataURL(file);
  };

  const handleValidatePaymentWithAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutPlan) return;

    // Règle locale immédiate pour Test Gratuit
    if (checkoutPlan.category === 'OFFRE TEST GRATUIT') {
      if (deviceAlreadyTested) {
        setAgentError(
          "Cet appareil a déjà activé l'Offre Test Gratuit (1 seule activation autorisée par appareil)."
        );
        return;
      }
      if (accountTestsUsed >= 2) {
        setAgentError(
          'Votre compte client a atteint la limite maximale de 2 générations de code test.'
        );
        return;
      }
    } else if (!screenshotBase64 && txId.trim().length < 5 && smsProof.trim().length < 10) {
      setAgentError(
        "Importez la capture d'écran de votre paiement (ou saisissez l'ID de transaction / SMS) pour lancer la vérification IA."
      );
      return;
    }

    if (paymentMethod === 'Orange Money' && paymentConfig.orangeCeilingExceeded) {
      setPaymentMethod('Orange OM ASSO');
      setAgentError(
        `Plafond atteint sur le ${paymentConfig.orangeNumber} (${paymentConfig.orangeBeneficiary}). Utilisez le Paiement Marchand Orange (OM ASSO) : ${paymentConfig.orangeMerchantOmAsso}.`
      );
      return;
    }

    setAgentVerifying(true);
    setAgentError(null);
    setForensicReport(null);

    try {
      // Étape 1 : Inspection multimodale anti-falsification + validation via AIPaymentAgent (Gemini)
      const res = await fetch('/api/agent/verify-and-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: checkoutPlan.id,
          platform: 'pending',
          paymentMethod:
            checkoutPlan.category === 'OFFRE TEST GRATUIT' ? 'Gratuit' : paymentMethod,
          payerPhone,
          transactionRef:
            checkoutPlan.category === 'OFFRE TEST GRATUIT'
              ? `TEST-${deviceFingerprint}`
              : txId,
          smsProof,
          screenshotBase64,
          screenshotMimeType,
          clientName: clientName,
          accountId,
          deviceFingerprint,
          prototypeJson: npvPrototype.rawTemplateJson,
        }),
      });

      const data = await res.json();
      if (data.forensicReport) {
        setForensicReport(data.forensicReport);
      }

      if (!res.ok || !data.approved) {
        if (data.useOmMerchantFallback) {
          setPaymentMethod('Orange OM ASSO');
        }
        setAgentError(data.reason || data.error || 'Vérification refusée par l’Agent IA.');
        return;
      }

      // Paiement validé ! Passage au composant de sélection d'OS (Android / iPhone)
      setSelectedPlan(checkoutPlan);
      setDeliveryToken(data.deliveryToken ?? null);
      setActiveCloudBundle(data.cloudRecord ?? null);
      setAgentVerdictReason(data.reasoning || 'Paiement validé par l’Agent IA JUST TECH.');
      if (data.sshUsername && data.sshPassword) {
        setSshCredentials({
          username: data.sshUsername,
          password: data.sshPassword,
        });
      }
      if (checkoutPlan.category === 'OFFRE TEST GRATUIT') {
        setAccountTestsUsed((c) => Math.min(2, c + 1));
        setDeviceAlreadyTested(true);
        serviceAIAgent.issueTestCode({
          accountId,
          clientName: clientName,
          deviceFingerprint,
          platform: selectedPlatform ?? 'android',
          explicitCode: data.cloudCode ?? undefined,
        });
      } else {
        serviceAIAgent.logActivity({
          category: 'subscription',
          action: 'subscription.validated',
          actor: clientName,
          target: checkoutPlan.name,
          severity: 'ok',
          detail: `${checkoutPlan.name} (${checkoutPlan.priceFcfa} FCFA) validé via ${paymentMethod}.`,
        });
      }
      setCheckoutStep('os_select');
    } catch (err) {
      setAgentError(
        err instanceof Error ? err.message : "Impossible de contacter l'Agent IA serveur."
      );
    } finally {
      setAgentVerifying(false);
    }
  };

  const handleGenerateRealCloudBundle = async (overridePlan?: PlanOffer, overrideUsedGb?: number) => {
    const plan = overridePlan ?? selectedPlan;
    const usedGb = overrideUsedGb ?? dataUsedGb;
    setCloudBundleLoading(true);
    setCloudBundleError(null);
    try {
      const res = await fetch('/api/cloud-config/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          planName: `${plan.name} (${plan.durationLabel})`,
          clientName: clientName,
          dataQuotaGb: plan.dataQuotaGb ?? 3,
          dataUsedGb: usedGb,
          durationHours: plan.durationHours,
          expiresAt: `${activeExpiry}T23:59:59Z`,
          maxSessions: plan.maxSessions,
          serverCode: 'VPS-CM-01',
          licenseStatus: 'Active',
          sshUsername: sshCredentials.username,
          sshPassword: sshCredentials.password,
        }),
      });
      const data = (await res.json()) as { status?: string; bundle?: CloudConfigBundle; error?: string };
      if (!res.ok || !data.bundle) {
        setCloudBundleError(data.error || 'Impossible de générer la configuration Cloud.');
        return;
      }
      setActiveCloudBundle(data.bundle);
      const created = onGenerateCloudCode(
        clientName,
        data.bundle.planName,
        sshCredentials.username,
        data.bundle.code
      );
      setActiveCloudCode(created);
      notify(
        `Configuration Cloud ${data.bundle.code} générée (quota ${data.bundle.quota.remainingGb} Go restants, zéro secret dans le QR/lien).`
      );
    } catch {
      setCloudBundleError('Serveur de génération Cloud momentanément indisponible.');
    } finally {
      setCloudBundleLoading(false);
    }
  };

  const handleDownloadPrivateNpvt = async () => {
    if (!activeCloudBundle) {
      await handleGenerateRealCloudBundle();
      return;
    }
    setCloudBundleLoading(true);
    setCloudBundleError(null);
    try {
      const res = await fetch(
        `/api/cloud-config/${encodeURIComponent(activeCloudBundle.code)}/download-npvt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: activeCloudBundle.exchangeToken,
            prototypeJson: npvPrototype.rawTemplateJson,
          }),
        }
      );
      const data = (await res.json()) as { filename?: string; content?: string; error?: string };
      if (!res.ok || !data.content) {
        setCloudBundleError(data.error || 'Téléchargement .npvt refusé par le serveur.');
        return;
      }
      const blob = new Blob([data.content], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || activeCloudBundle.npvtFilename;
      a.click();
      URL.revokeObjectURL(url);
      notify(`Fichier privé ${data.filename || activeCloudBundle.npvtFilename} téléchargé en POST sécurisé.`);
    } catch {
      setCloudBundleError('Erreur réseau lors du téléchargement privé .npvt.');
    } finally {
      setCloudBundleLoading(false);
    }
  };

  const handleSelectPostPaymentOs = async (os: DeliveryPlatform) => {
    setOsGenerating(true);
    setDeliveredOs(os);
    setSelectedPlatform(os);

    try {
      const res = await fetch('/api/delivery/select-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryToken,
          platform: os,
          prototypeJson: npvPrototype.rawTemplateJson,
          planId: selectedPlan.id,
          planName: `${selectedPlan.name} (${selectedPlan.durationLabel})`,
          clientName: clientName,
          dataQuotaGb: selectedPlan.dataQuotaGb ?? 3,
          dataUsedGb,
          expiresAt: `${activeExpiry}T23:59:59Z`,
          maxSessions: selectedPlan.maxSessions,
          serverCode: 'VPS-CM-01',
          licenseStatus: 'Active',
          sshUsername: sshCredentials.username,
          sshPassword: sshCredentials.password,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.cloudRecord && data.cloudRecord.qrDataUrl) {
          setActiveCloudBundle(data.cloudRecord as CloudConfigBundle);
        }
        if (os === 'android' && data.cloudRecord) {
          const created = onGenerateCloudCode(
            clientName,
            `${selectedPlan.name} (${selectedPlan.durationLabel})`,
            data.sshUsername || sshCredentials.username,
            data.cloudRecord.code
          );
          setActiveCloudCode(created);
          notify(
            `Clé Cloud Android ${created.code} générée avec QR sécurisé (zéro mot de passe exposé).`
          );
          return;
        }
        if (os === 'iphone' && data.npvFileContent) {
          const blob = new Blob([data.npvFileContent], {
            type: 'application/json;charset=utf-8',
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = data.npvFilename || `justtech-${sshCredentials.username}-iphone.npvt`;
          a.click();
          URL.revokeObjectURL(url);
          notify(
            `Fichier .npvt iPhone généré depuis le prototype avec votre pass et quota réel (${data.sshUsername || sshCredentials.username}).`
          );
          return;
        }
        notify('Le serveur n’a pas retourné le pass attendu. Recommencez la vérification.');
        return;
      } else {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        notify(errData.error || 'Génération refusée par le serveur.');
        return;
      }
    } catch {
      notify('Impossible de délivrer le pass depuis le serveur. Réessayez après avoir vérifié votre paiement.');
    } finally {
      setOsGenerating(false);
    }
  };
  const handleSendAgentMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = agentInput.trim();
    if (!prompt || agentLoading) return;

    setAgentMessages((prev) => [...prev, { role: 'user', text: prompt }]);
    setAgentInput('');
    setAgentLoading(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, accountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAgentMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `Erreur Agent IA : ${data.error || 'Indisponible.'}` },
        ]);
      } else {
        setAgentMessages((prev) => [...prev, { role: 'assistant', text: data.reply }]);
      }
    } catch {
      setAgentMessages((prev) => [
        ...prev,
        { role: 'assistant', text: "Erreur réseau lors de l'appel à l'Agent IA." },
      ]);
    } finally {
      setAgentLoading(false);
    }
  };

  const npvPlans = PLANS.filter((p) => p.category === 'NPV TUNNEL');
  const freeTestPlan = PLANS.find((p) => p.category === 'OFFRE TEST GRATUIT')!;

  const usagePercent = selectedPlan.dataQuotaGb
    ? Math.min(100, Math.round((dataUsedGb / selectedPlan.dataQuotaGb) * 100))
    : 12;

  return (
    <div className="max-w-6xl mx-auto p-5 lg:p-7 space-y-7">
      {/* Boutique Header (Visibilité Client stricte : Tarifs + Pass actif, zéro serveur/IP exposé) */}
      <section className="bg-gradient-to-br from-[#101827] via-[#0C1322] to-[#070B14] border border-[#E5B84B]/35 rounded-2xl p-6 lg:p-7">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <img
              src="/assets/aistudio/image_745e91e4.png"
              alt="JUST TECH SERVICES"
              className="w-12 h-12 rounded-xl object-cover border border-[#E5B84B]/50 shrink-0"
            />
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#E5B84B]">
                <Flame className="w-3.5 h-3.5" />
                <span>JUST TECH SERVICES TUNNEL · ANDROID & iPHONE</span>
              </div>
              <h1 className="font-display text-xl lg:text-2xl font-semibold text-[#F2F6FF] mt-0.5">
                Boutique Offres VPN & Activation Automatisée par Agent IA
              </h1>
              <p className="text-xs text-[#8D9AAF] mt-1">
                Paiement MTN MoMo / Orange Money vérifié par IA, puis livraison instantanée sur Android (Cloud) ou iPhone (.npvt).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowAgentChat((s) => !s)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/40 text-[#45D7F4] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Bot className="w-4 h-4" />
              Agent IA ({showAgentChat ? 'Masquer' : 'Ouvrir'})
            </button>
            <button
              type="button"
              onClick={() => setShowTicketModal(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#101827] hover:bg-[#151F31] border border-[#243147] text-[#F2F6FF] text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              <MessageSquarePlus className="w-4 h-4 text-[#8D9AAF]" />
              Support
            </button>
          </div>
        </div>

        {/* Barre Pass Actif */}
        <div className="mt-6 pt-5 border-t border-[#243147]/80 grid grid-cols-1 md:grid-cols-3 gap-5 items-center">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-[#F2F6FF]">
                Pass actif : {selectedPlan.name}
              </span>
              <LicenseStatusText status="Active" />
            </div>
            <p className="text-xs text-[#8D9AAF] mt-1 font-mono-tabular">
              Validité {selectedPlan.durationLabel} · Expire le {activeExpiry}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono-tabular">
              <span className="text-[#8D9AAF]">Consommation</span>
              <span className="text-[#F2F6FF]">
                {dataUsedGb.toFixed(1)} Go / {selectedPlan.dataQuotaGb ?? 0} Go
              </span>
            </div>
            <div className="w-full h-2 bg-[#070B14] border border-[#243147] rounded-full overflow-hidden">
              <div className="h-full bg-[#45D7F4]" style={{ width: `${usagePercent}%` }} />
            </div>
          </div>

          <div className="flex items-center md:justify-end gap-2 text-xs text-[#8D9AAF]">
            <Lock className="w-3.5 h-3.5 text-[#E5B84B] shrink-0" />
            <span>
              Tests gratuits compte :{' '}
              <strong className="text-[#F2F6FF] font-mono-tabular">{accountTestsUsed}/2</strong> ·
              Appareil :{' '}
              <strong className={deviceAlreadyTested ? 'text-[#F59E0B]' : 'text-[#45D7F4]'}>
                {deviceAlreadyTested ? 'Utilisé' : 'Disponible'}
              </strong>
            </span>
          </div>
        </div>
      </section>

      {clientMessage && (
        <div
          role="status"
          className="px-4 py-3 bg-[#151F31] border border-[#E5B84B]/60 rounded-lg text-sm text-[#F2F6FF]"
        >
          {clientMessage}
        </div>
      )}

      {/* Assistant Agent IA (optionnel repliable) */}
      {showAgentChat && (
        <section className="bg-[#101827] border border-[#45D7F4]/40 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Bot className="w-5 h-5 text-[#45D7F4]" />
              <div>
                <h2 className="font-display text-sm font-semibold text-[#F2F6FF]">
                  Agent IA Autonome · Vérification & Assistance
                </h2>
                <p className="text-xs text-[#8D9AAF]">
                  Collez un SMS MTN MoMo / Orange Money ou posez une question sur les offres et codes Cloud / .npvt.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAgentChat(false)}
              className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-2.5 p-3 bg-[#070B14] border border-[#243147] rounded-xl text-xs">
            {agentMessages.map((m, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-lg ${
                  m.role === 'user'
                    ? 'bg-[#151F31] text-[#F2F6FF] ml-8 border border-[#243147]'
                    : 'bg-[#0C1322] text-[#E8EEF5] mr-8 border border-[#45D7F4]/25'
                }`}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#E5B84B] mb-1">
                  {m.role === 'user' ? 'Vous' : 'Agent IA JUST TECH'}
                </span>
                {m.text}
              </div>
            ))}
          </div>

          <form onSubmit={handleSendAgentMessage} className="flex gap-2">
            <input
              type="text"
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
              placeholder="Ex. Vérifie mon paiement OM de 3000 FCFA sur 698057856..."
              className="flex-1 px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-xs text-[#F2F6FF] focus:outline-none focus:border-[#45D7F4]"
            />
            <button
              type="submit"
              disabled={agentLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#45D7F4] hover:bg-[#2EC6E6] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {agentLoading ? 'Analyse...' : 'Envoyer'}
            </button>
          </form>
        </section>
      )}

      {/* Numéros Officiels Mobile Money + Alerte Plafond OM ASSO */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#101827] border border-[#E5B84B]/40 rounded-xl p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
              MTN Mobile Money
            </p>
            <p className="text-sm font-semibold text-[#F2F6FF] mt-0.5">
              {paymentConfig.mtnBeneficiary}
            </p>
            <p className="font-mono-tabular text-xs text-[#45D7F4] mt-0.5">
              {paymentConfig.mtnNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyValue('mtn', paymentConfig.mtnNumber, 'Numéro MTN MoMo')}
            className="p-2 bg-[#151F31] border border-[#243147] rounded-lg text-[#E5B84B] cursor-pointer"
            title="Copier le numéro MTN MoMo"
          >
            {copiedKey === 'mtn' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <div
          className={`rounded-xl p-4 border flex items-center justify-between gap-3 ${
            paymentConfig.orangeCeilingExceeded
              ? 'bg-[#101827]/60 border-[#243147] opacity-75'
              : 'bg-[#101827] border-[#F59E0B]/45'
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#F59E0B]">
                Orange Money
              </p>
              {paymentConfig.orangeCeilingExceeded && (
                <span className="text-[10px] font-mono-tabular text-[#EF4444]">
                  Plafond atteint
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-[#F2F6FF] mt-0.5">
              {paymentConfig.orangeBeneficiary}
            </p>
            <p className="font-mono-tabular text-xs text-[#45D7F4] mt-0.5">
              {paymentConfig.orangeNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyValue('om', paymentConfig.orangeNumber, 'Numéro Orange Money')}
            className="p-2 bg-[#151F31] border border-[#243147] rounded-lg text-[#F59E0B] cursor-pointer"
            title="Copier le numéro Orange Money"
          >
            {copiedKey === 'om' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <div
          className={`rounded-xl p-4 border flex items-center justify-between gap-3 ${
            paymentConfig.orangeCeilingExceeded
              ? 'bg-[#151F31] border-[#E5B84B]'
              : 'bg-[#101827] border-[#243147]'
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E5B84B]">
              {paymentConfig.orangeCeilingExceeded
                ? 'Recommandé (Plafond atteint) · OM ASSO'
                : 'Paiement Marchand Orange · OM ASSO'}
            </p>
            <p className="text-sm font-semibold text-[#F2F6FF] mt-0.5">
              Code Marchand :{' '}
              <span className="font-mono-tabular text-[#E5B84B]">
                {paymentConfig.orangeMerchantOmAsso}
              </span>
            </p>
            <p className="font-mono-tabular text-[11px] text-[#8D9AAF] mt-0.5">
              USSD : #150*47*{paymentConfig.orangeMerchantOmAsso}#
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              copyValue('omasso', paymentConfig.orangeMerchantOmAsso, 'Code OM ASSO 1017614')
            }
            className="p-2 bg-[#070B14] border border-[#243147] rounded-lg text-[#E5B84B] cursor-pointer"
            title="Copier le code marchand OM ASSO"
          >
            {copiedKey === 'omasso' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </section>

      {/* CATALOGUE OFFICIEL : 1. NPV TUNNEL */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-[#F2F6FF]">
            NPV TUNNEL — Forfaits Data (Android & iPhone)
          </h2>
          <span className="text-xs text-[#8D9AAF]">6 formules au choix</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {npvPlans.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-xl border p-5 flex items-center justify-between gap-4 transition-colors ${
                plan.isVip
                  ? 'bg-gradient-to-r from-[#151F31] to-[#101827] border-[#E5B84B]/50'
                  : 'bg-[#101827] border-[#243147] hover:border-[#45D7F4]/40'
              }`}
            >
              <div>
                <p className="font-mono-tabular text-xl font-bold text-[#E5B84B]">
                  {formatFcfa(plan.priceFcfa)}
                </p>
                <p className="text-sm font-semibold text-[#F2F6FF] mt-0.5">
                  {plan.dataQuotaGb} Go / {plan.durationLabel}
                </p>
                <p className="text-xs text-[#8D9AAF] mt-1">{plan.maxSessions} appareil(s) max</p>
              </div>
              <button
                type="button"
                onClick={() => openCheckoutForPlan(plan)}
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer shrink-0"
              >
                Commander
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CATALOGUE OFFICIEL : 2. OFFRE TEST GRATUIT (3 Go / 2 heures) + Règles Anti-Abus */}
      <section className="bg-[#101827] border border-[#45D7F4]/40 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-[#45D7F4]/15 border border-[#45D7F4]/35 flex items-center justify-center text-[#45D7F4] shrink-0">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
                OFFRE TEST GRATUIT — 3 Go / 2 heures
              </h2>
              <span className="text-xs font-mono-tabular text-[#45D7F4]">0 FCFA</span>
            </div>
            <p className="text-xs text-[#8D9AAF] mt-1">
              Règles strictes contrôlées par l'Agent IA : <strong>1 seul test & activation par appareil</strong>, et maximum <strong>2 générations de code test par compte client</strong> (actuellement : {accountTestsUsed}/2).
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={deviceAlreadyTested || accountTestsUsed >= 2}
          onClick={() => openCheckoutForPlan(freeTestPlan)}
          className="px-5 py-2.5 bg-[#45D7F4] hover:bg-[#2EC6E6] disabled:bg-[#151F31] disabled:text-[#8D9AAF] text-[#070B14] text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
        >
          {deviceAlreadyTested
            ? 'Test déjà utilisé sur cet appareil'
            : accountTestsUsed >= 2
              ? 'Limite 2/2 atteinte sur ce compte'
              : 'Tester gratuitement (3 Go / 2h)'}
        </button>
      </section>

      {/* Affiche uniquement la configuration réellement délivrée après validation. */}
      {activeCloudBundle && (
        <CloudConfigGeneratorCard
          bundle={activeCloudBundle}
          loading={cloudBundleLoading}
          error={cloudBundleError}
          planName={activeCloudBundle.planName}
          quotaTotalGb={activeCloudBundle.quota.totalGb}
          quotaUsedGb={activeCloudBundle.quota.usedGb}
          maxSessions={activeCloudBundle.maxSessions}
          npvPrototype={npvPrototype}
          onGenerateBundle={() => handleGenerateRealCloudBundle()}
          onDownloadNpvt={handleDownloadPrivateNpvt}
          onCopy={copyValue}
          copiedKey={copiedKey}
        />
      )}

      {/* MODAL CHECKOUT -> VALIDATION AGENT IA -> COMPOSANT SELECTION OS (ANDROID / IPHONE) */}
      {checkoutPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg bg-[#101827] border border-[#243147] rounded-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#E5B84B]">
                  {checkoutStep === 'payment'
                    ? checkoutPlan.category === 'OFFRE TEST GRATUIT'
                      ? 'Vérification Agent IA · Offre Test Gratuit'
                      : 'Étape 1 / 2 · Paiement Mobile Money & Vérification IA'
                    : 'Étape 2 / 2 · Sélection d’OS après validation'}
                </p>
                <h3 className="font-display text-lg font-semibold text-[#F2F6FF] mt-0.5">
                  {checkoutPlan.name} —{' '}
                  {checkoutPlan.priceFcfa === 0 ? 'Gratuit (3 Go / 2h)' : formatFcfa(checkoutPlan.priceFcfa)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutPlan(null)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {agentError && (
              <div className="p-3 bg-[#EF4444]/15 border border-[#EF4444]/45 rounded-xl space-y-2 text-xs text-[#F2F6FF]">
                <div className="flex items-start gap-2.5">
                  {forensicReport?.isFalsified ? (
                    <ShieldAlert className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                  )}
                  <span>{agentError}</span>
                </div>

                {forensicReport && (
                  <div className="p-2.5 bg-[#070B14]/85 border border-[#EF4444]/30 rounded-lg space-y-1 text-[11px] text-[#E8EEF5]">
                    <div className="flex items-center justify-between font-mono-tabular">
                      <span className="text-[#EF4444] font-semibold">
                        Capteurs Anti-Falsification : {forensicReport.isFalsified ? 'FALSIFIÉ' : 'REJETÉ'}
                      </span>
                      <span>Score : {forensicReport.authenticityScore}/100</span>
                    </div>
                    <p><strong className="text-[#8D9AAF]">Typo / Pixels :</strong> {forensicReport.forensicSensors.typographyAndAlignment}</p>
                    <p><strong className="text-[#8D9AAF]">Cohérence UI :</strong> {forensicReport.forensicSensors.uiConsistency}</p>
                    <p><strong className="text-[#8D9AAF]">EXIF / Anti-Rejeu :</strong> {forensicReport.forensicSensors.metadataAndReplay}</p>
                    <p><strong className="text-[#8D9AAF]">Bénéficiaire / Montant :</strong> {forensicReport.forensicSensors.beneficiaryAndAmountMatch}</p>
                  </div>
                )}
              </div>
            )}

            {checkoutStep === 'payment' ? (
              <form onSubmit={handleValidatePaymentWithAi} className="space-y-4">
                {checkoutPlan.category !== 'OFFRE TEST GRATUIT' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(['MTN Mobile Money', 'Orange Money', 'Orange OM ASSO'] as const).map(
                        (method) => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setPaymentMethod(method)}
                            className={`py-2 px-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                              paymentMethod === method
                                ? 'bg-[#151F31] border-[#E5B84B] text-[#E5B84B]'
                                : 'bg-[#070B14] border-[#243147] text-[#8D9AAF]'
                            }`}
                          >
                            {method}
                          </button>
                        )
                      )}
                    </div>

                    <div className="p-3.5 bg-[#070B14] border border-[#243147] rounded-xl text-xs space-y-1">
                      {paymentMethod === 'MTN Mobile Money' && (
                        <>
                          <p className="text-[#8D9AAF]">
                            Envoyez <strong className="text-[#E5B84B]">{formatFcfa(checkoutPlan.priceFcfa)}</strong> sur MTN MoMo :
                          </p>
                          <p className="font-mono-tabular text-sm font-semibold text-[#F2F6FF]">
                            {paymentConfig.mtnBeneficiary} · {paymentConfig.mtnNumber}
                          </p>
                        </>
                      )}
                      {paymentMethod === 'Orange Money' && (
                        <>
                          <p className="text-[#8D9AAF]">
                            Envoyez <strong className="text-[#E5B84B]">{formatFcfa(checkoutPlan.priceFcfa)}</strong> sur Orange Money :
                          </p>
                          <p className="font-mono-tabular text-sm font-semibold text-[#F2F6FF]">
                            {paymentConfig.orangeBeneficiary} · {paymentConfig.orangeNumber}
                          </p>
                          {paymentConfig.orangeCeilingExceeded && (
                            <p className="text-[#F59E0B] pt-1">
                              Plafond atteint sur ce numéro. Passez sur{' '}
                              <button
                                type="button"
                                onClick={() => setPaymentMethod('Orange OM ASSO')}
                                className="underline font-semibold cursor-pointer"
                              >
                                Orange OM ASSO ({paymentConfig.orangeMerchantOmAsso})
                              </button>
                              .
                            </p>
                          )}
                        </>
                      )}
                      {paymentMethod === 'Orange OM ASSO' && (
                        <>
                          <p className="text-[#8D9AAF]">
                            Paiement Marchand Orange (<strong className="text-[#E5B84B]">OM ASSO</strong>) :
                          </p>
                          <p className="font-mono-tabular text-sm font-semibold text-[#E5B84B]">
                            Code Marchand : {paymentConfig.orangeMerchantOmAsso} (#150*47*{paymentConfig.orangeMerchantOmAsso}#)
                          </p>
                        </>
                      )}
                    </div>

                    {/* Zone Capture d'écran + Capteurs Anti-Falsification IA */}
                    <div className="p-3.5 bg-[#070B14] border border-[#45D7F4]/40 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-[#45D7F4]">
                          <Camera className="w-4 h-4" />
                          <span>Capture d'écran du paiement (Vérification IA anti-falsification)</span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono-tabular text-[#E5B84B]">
                          <ScanSearch className="w-3.5 h-3.5" />
                          Capteurs Anti-Falsification
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8D9AAF]">
                        Importez la capture de votre reçu (Orange Money / Max it / MTN MoMo / SMS). L'Agent IA inspecte la typographie, l'UI, les métadonnées EXIF et l'empreinte SHA-256 pour détecter tout trucage.
                      </p>

                      {screenshotPreview ? (
                        <div className="flex items-center justify-between gap-3 p-2.5 bg-[#101827] border border-[#243147] rounded-lg">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={screenshotPreview}
                              alt="Aperçu capture paiement"
                              className="w-14 h-14 object-cover rounded border border-[#45D7F4]/40 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-[#F2F6FF] truncate">
                                {screenshotFileName}
                              </p>
                              <p className="text-[11px] text-[#45D7F4]">
                                Prête pour scan forensique IA
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setScreenshotPreview(null);
                              setScreenshotBase64(null);
                              setScreenshotMimeType(null);
                              setScreenshotFileName(null);
                            }}
                            className="px-2.5 py-1 bg-[#151F31] hover:bg-[#EF4444]/20 text-xs text-[#8D9AAF] hover:text-[#EF4444] rounded cursor-pointer shrink-0"
                          >
                            Retirer
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center justify-center gap-2 py-3 px-4 bg-[#101827] hover:bg-[#151F31] border border-dashed border-[#45D7F4]/50 rounded-lg text-xs text-[#45D7F4] font-medium cursor-pointer transition-colors">
                          <Upload className="w-4 h-4" />
                          <span>Importer la capture d'écran (PNG, JPG, WebP)</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleScreenshotChange}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#8D9AAF] mb-1">Votre numéro payeur</label>
                          <input
                            type="text"
                            required
                            value={payerPhone}
                            onChange={(e) => setPayerPhone(e.target.value)}
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#8D9AAF] mb-1">
                            ID de transaction {screenshotBase64 ? '(auto si capture)' : ''}
                          </label>
                          <input
                            type="text"
                            required={!screenshotBase64}
                            value={txId}
                            onChange={(e) => setTxId(e.target.value)}
                            placeholder="Ex. MP261118.1510.A84910"
                            className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-[#8D9AAF] mb-1">
                          Preuve SMS Mobile Money (optionnel)
                        </label>
                        <textarea
                          rows={2}
                          value={smsProof}
                          onChange={(e) => setSmsProof(e.target.value)}
                          placeholder="Collez ici le SMS de confirmation reçu si vous n'avez pas de capture..."
                          className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-xs text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-4 bg-[#070B14] border border-[#45D7F4]/40 rounded-xl text-xs space-y-2">
                    <p className="text-[#F2F6FF] font-semibold">
                      Contrôle d'éligibilité Offre Test Gratuit (3 Go / 2 heures)
                    </p>
                    <p className="text-[#8D9AAF]">
                      Empreinte appareil : <code className="text-[#45D7F4]">{deviceFingerprint}</code>
                    </p>
                    <p className="text-[#8D9AAF]">
                      Quotas compte : <strong className="text-[#F2F6FF]">{accountTestsUsed} / 2</strong> générations utilisées · Appareil :{' '}
                      <strong className={deviceAlreadyTested ? 'text-[#EF4444]' : 'text-[#45D7F4]'}>
                        {deviceAlreadyTested ? 'Déjà utilisé' : '1er test autorisé'}
                      </strong>
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCheckoutPlan(null)}
                    className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={agentVerifying}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    <Bot className="w-4 h-4" />
                    {agentVerifying
                      ? 'Scan Capteurs IA...'
                      : checkoutPlan.category === 'OFFRE TEST GRATUIT'
                        ? 'Vérifier & Choisir mon OS'
                        : 'Analyser Capture & Valider'}
                  </button>
                </div>
              </form>
            ) : (
              /* COMPOSANT SÉLECTION D'OS POST-VALIDATION (ANDROID / IPHONE) */
              <div className="space-y-4">
                {agentVerdictReason && (
                  <div className="p-3 bg-[#45D7F4]/10 border border-[#45D7F4]/35 rounded-xl text-xs text-[#E8EEF5] space-y-1.5">
                    <div className="flex items-start gap-2">
                      <Bot className="w-4 h-4 text-[#45D7F4] shrink-0 mt-0.5" />
                      <span>{agentVerdictReason}</span>
                    </div>
                    {forensicReport && (
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] font-mono-tabular text-[#45D7F4]">
                        <span>Authenticité : {forensicReport.authenticityScore}/100</span>
                        {forensicReport.extractedTxId && (
                          <span>ID extrait : {forensicReport.extractedTxId}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-[#8D9AAF]">
                  Paiement confirmé ! Choisissez votre système pour générer automatiquement votre configuration :
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={osGenerating}
                    onClick={() => handleSelectPostPaymentOs('android')}
                    className={`p-4 rounded-xl border text-left space-y-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      deliveredOs === 'android'
                        ? 'bg-[#151F31] border-[#45D7F4]'
                        : 'bg-[#070B14] border-[#243147] hover:border-[#45D7F4]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[#45D7F4]">
                      <Cloud className="w-5 h-5" />
                      <span className="text-[11px] font-mono-tabular">ANDROID</span>
                    </div>
                    <p className="font-display text-sm font-semibold text-[#F2F6FF]">
                      Clé Configuration Cloud
                    </p>
                    <p className="text-xs text-[#8D9AAF]">
                      Génère une clé Cloud à activer avec internet dans l'app Android.
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={osGenerating}
                    onClick={() => handleSelectPostPaymentOs('iphone')}
                    className={`p-4 rounded-xl border text-left space-y-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      deliveredOs === 'iphone'
                        ? 'bg-[#151F31] border-[#E5B84B]'
                        : 'bg-[#070B14] border-[#243147] hover:border-[#E5B84B]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[#E5B84B]">
                      <Download className="w-5 h-5" />
                      <span className="text-[11px] font-mono-tabular">iPHONE (.npvt)</span>
                    </div>
                    <p className="font-display text-sm font-semibold text-[#F2F6FF]">
                      Fichier NPV Tunnel
                    </p>
                    <p className="text-xs text-[#8D9AAF]">
                      Génère & télécharge le .npvt avec SSH user/pass injectés dynamiquement.
                    </p>
                  </button>
                </div>

                {deliveredOs === 'android' && activeCloudCode && (
                  <div className="p-4 bg-[#070B14] border border-[#45D7F4]/50 rounded-xl space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] text-[#8D9AAF]">
                          Clé Configuration Cloud Android · Zéro secret en clair
                        </p>
                        <code className="font-mono-tabular text-base font-bold text-[#E5B84B]">
                          {activeCloudCode.code}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyValue('modal-cld', activeCloudCode.code, 'Clé Cloud')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#151F31] border border-[#243147] rounded-lg text-xs text-[#F2F6FF] cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5 text-[#45D7F4]" />
                        Copier
                      </button>
                    </div>
                    {activeCloudBundle?.qrDataUrl && (
                      <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-[#243147]">
                        <img
                          src={activeCloudBundle.qrDataUrl}
                          alt={`QR Cloud ${activeCloudBundle.code}`}
                          className="w-28 h-28 rounded-lg border border-[#45D7F4]/40 shrink-0"
                        />
                        <div className="space-y-1.5 min-w-0 text-[11px]">
                          <p className="text-[#45D7F4] font-semibold">
                            Quota lié : {activeCloudBundle.quota.remainingGb} / {activeCloudBundle.quota.totalGb} Go restants
                          </p>
                          <p className="text-[#8D9AAF] break-all font-mono-tabular">
                            {activeCloudBundle.importUri}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {deliveredOs === 'iphone' && (
                  <div className="p-3 bg-[#070B14] border border-[#E5B84B]/50 rounded-xl text-xs text-[#F2F6FF]">
                    Fichier <code className="text-[#E5B84B]">justtech-{sshCredentials.username}-iphone.npvt</code> téléchargé. Importez-le directement dans <strong>NPV Tunnel</strong> sur iPhone.
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setCheckoutPlan(null)}
                    className="px-4 py-2 bg-[#E5B84B] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Fermer
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Ticket Support */}
      {showTicketModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowTicketModal(false);
              setTicketSubject('');
              notify('Demande support enregistrée.');
            }}
            className="w-full max-w-md bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Support JUST TECH SERVICES
              </h3>
              <button
                type="button"
                onClick={() => setShowTicketModal(false)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-[#8D9AAF] mb-1">Votre question</label>
              <input
                type="text"
                required
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                placeholder="Ex. Activation Android Cloud ou fichier .npvt"
                className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#E5B84B]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTicketModal(false)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Envoyer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
