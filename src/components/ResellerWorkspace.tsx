import React, { useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Cloud,
  Database,
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import {
  INITIAL_LEDGER,
  INITIAL_LICENSES,
  INITIAL_NPV_PROTOTYPE,
  INITIAL_SERVERS,
  PLANS,
  RESELLERS,
  compileNpvFromPrototype,
  formatFcfa,
} from '../data/maquetteData';
import {
  AuthenticatedUser,
  CloudActivationRecord,
  LedgerEntry,
  LicenseRecord,
  NpvPrototype,
  ROLE_LABELS,
  ResellerAccount,
} from '../types/panel';
import { CloudConfigBuilder } from './CloudConfigBuilder';
import { LicenseStatusText } from './StatusText';

interface ResellerWorkspaceProps {
  currentUser?: AuthenticatedUser;
  npvPrototype?: NpvPrototype;
  onGenerateCloudCode?: (
    clientName: string,
    planName: string,
    sshUsername: string,
    explicitCode?: string
  ) => CloudActivationRecord;
}

export const ResellerWorkspace: React.FC<ResellerWorkspaceProps> = ({
  currentUser,
  npvPrototype = INITIAL_NPV_PROTOTYPE,
  onGenerateCloudCode,
}) => {
  const [activeSection, setActiveSection] = useState<'stock' | 'cloud-builder'>('stock');
  const isSubResellerAccount = currentUser?.role === 'sub_reseller';
  const purchasablePlans = PLANS.filter((p) => p.category === 'NPV TUNNEL' && (p.dataQuotaGb ?? 0) > 0);

  const [gbBalance, setGbBalance] = useState(250);
  const [clientsCount, setClientsCount] = useState(38);
  const maxClients = 100;

  const [subResellers, setSubResellers] = useState<ResellerAccount[]>(
    RESELLERS.filter((r) => r.level === 'Sous-revendeur' && r.parentName === 'KmerConnect Pro')
  );
  // Permet de basculer entre le compte Revendeur (Niv. 4) et ses Sous-revendeurs (Niv. 5) pour acheter des forfaits en Go
  const [activeBuyerId, setActiveBuyerId] = useState<string>('self');

  const [showSubResellerModal, setShowSubResellerModal] = useState(false);
  const [subName, setSubName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [subInitialGb, setSubInitialGb] = useState(30);
  const [subMaxClients, setSubMaxClients] = useState(25);
  const [subCommission, setSubCommission] = useState(8);
  const [transferTargetSub, setTransferTargetSub] = useState<ResellerAccount | null>(null);
  const [transferGbAmount, setTransferGbAmount] = useState(20);

  // Cloisonnement strict : licences gérées par le revendeur KmerConnect Pro et ses sous-revendeurs
  const [myLicenses, setMyLicenses] = useState<LicenseRecord[]>(
    INITIAL_LICENSES.filter((l) => l.resellerId === 'res-1')
  );
  const [ledger, setLedger] = useState<LedgerEntry[]>(INITIAL_LEDGER);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [clientName, setClientName] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(purchasablePlans[1]?.id ?? purchasablePlans[0].id);
  const [toast, setToast] = useState<string | null>(null);

  const selectedPlan = purchasablePlans.find((p) => p.id === selectedPlanId) ?? purchasablePlans[0];
  const requiredGb = selectedPlan.dataQuotaGb ?? 0;

  const activeSubReseller =
    activeBuyerId === 'self' ? null : subResellers.find((s) => s.id === activeBuyerId) ?? null;
  const activeActorGb = activeSubReseller ? activeSubReseller.gbBalance : gbBalance;
  const activeActorName = activeSubReseller ? `${activeSubReseller.name} (Sous-revendeur)` : 'KmerConnect Pro (Revendeur)';

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const handleDeliverAndroidCloud = async (lic: LicenseRecord) => {
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
        notify(data?.error || `Génération Cloud refusée pour ${lic.clientName}.`);
        return;
      }
      const explicitCode: string | undefined = data?.cloudRecord?.code;
      const importUri: string | undefined = data?.cloudRecord?.importUri;
      const rec = onGenerateCloudCode?.(lic.clientName, lic.planName, lic.sshUsername, explicitCode);
      const code = rec?.code ?? explicitCode ?? '';
      navigator.clipboard?.writeText(importUri || code);
      notify(`Lien Cloud sécurisé ${code} généré & copié pour ${lic.clientName} (zéro mot de passe exposé).`);
    } catch {
      notify('Impossible de contacter le serveur de génération Cloud.');
    }
  };

  const handleDeliverIphoneNpv = (lic: LicenseRecord) => {
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
    notify(`Fichier NPV Tunnel iPhone généré (${npvPrototype.version}) pour ${lic.clientName}.`);
  };

  const handleIssueLicense = (e: React.FormEvent) => {
    e.preventDefault();
    if (requiredGb <= 0) return;

    if (activeSubReseller) {
      if (activeSubReseller.gbBalance < requiredGb) {
        notify(
          `Stock Gigas insuffisant pour ${activeSubReseller.name} (${activeSubReseller.gbBalance} Go disponibles, ${requiredGb} Go requis).`
        );
        return;
      }
      if (activeSubReseller.clientsCount >= activeSubReseller.maxClients) {
        notify(`Plafond clients atteint pour ${activeSubReseller.name}.`);
        return;
      }
    } else {
      if (gbBalance < requiredGb) {
        notify(
          `Stock de Gigas insuffisant (${gbBalance} Go disponibles pour ${requiredGb} Go requis). Demandez une dotation à l'Admin.`
        );
        return;
      }
      if (clientsCount >= maxClients) {
        notify('Plafond de places clients atteint.');
        return;
      }
    }

    const nextGb = activeActorGb - requiredGb;
    const clean = (clientName || 'client').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const username = `jts_${clean || 'cli'}${Math.floor(10 + Math.random() * 89)}`;

    const created: LicenseRecord = {
      id: `lic-res-${Date.now()}`,
      uuid: `uuid-${Date.now()}`,
      clientName: clientName.trim() || 'Client Partenaire',
      clientEmail: `${clean || 'client'}@kmerconnect.cm`,
      resellerName: activeSubReseller ? activeSubReseller.name : 'KmerConnect Pro',
      resellerId: 'res-1',
      planName: selectedPlan.name,
      serverCode: 'VPS-FR-02',
      sshUsername: username,
      sshPassword: `Km$${Math.floor(1000 + Math.random() * 8999)}Tz`,
      status: 'Active',
      dataUsedGb: 0,
      dataQuotaGb: requiredGb,
      activeSessions: 0,
      maxSessions: selectedPlan.maxSessions,
      protocols: selectedPlan.protocols,
      expiresAt: '2026-12-18',
    };

    const newEntry: LedgerEntry = {
      id: `led-${Date.now()}`,
      date: "À l'instant",
      type: 'Achat forfait (Go)',
      description: `${activeSubReseller ? `[${activeSubReseller.name}] ` : ''}Achat ${selectedPlan.name} (${formatFcfa(selectedPlan.priceFcfa)}) · ${username}`,
      amountFcfa: -selectedPlan.priceFcfa,
      balanceAfterFcfa: 0,
      gbDelta: -requiredGb,
      balanceAfterGb: nextGb,
    };

    if (activeSubReseller) {
      setSubResellers((prev) =>
        prev.map((s) =>
          s.id === activeSubReseller.id
            ? { ...s, gbBalance: nextGb, clientsCount: s.clientsCount + 1 }
            : s
        )
      );
    } else {
      setGbBalance(nextGb);
      setClientsCount((c) => c + 1);
    }

    setMyLicenses((prev) => [created, ...prev]);
    setLedger((prev) => [newEntry, ...prev]);
    setClientName('');
    setShowIssueModal(false);
    notify(
      `Forfait ${selectedPlan.name} payé avec ${requiredGb} Go (${activeActorName}) · Reste : ${nextGb} Go.`
    );
  };

  const handleRenew = (lic: LicenseRecord) => {
    const plan =
      purchasablePlans.find((p) => p.name === lic.planName || p.dataQuotaGb === lic.dataQuotaGb) ??
      purchasablePlans[0];
    const costGb = plan.dataQuotaGb ?? 5;
    if (gbBalance < costGb) {
      notify(`Stock insuffisant pour renouveler (${gbBalance} Go disponibles, ${costGb} Go requis).`);
      return;
    }
    const nextGb = gbBalance - costGb;
    setGbBalance(nextGb);
    setMyLicenses((prev) =>
      prev.map((item) =>
        item.id === lic.id
          ? { ...item, status: 'Active', dataUsedGb: 0, expiresAt: '2027-01-11' }
          : item
      )
    );
    setLedger((prev) => [
      {
        id: `led-ren-${Date.now()}`,
        date: "À l'instant",
        type: 'Renouvellement',
        description: `Renouvellement ${plan.name} · ${lic.sshUsername} (${formatFcfa(plan.priceFcfa)})`,
        amountFcfa: -plan.priceFcfa,
        balanceAfterFcfa: 0,
        gbDelta: -costGb,
        balanceAfterGb: nextGb,
      },
      ...prev,
    ]);
    notify(`Licence ${lic.sshUsername} renouvelée (-${costGb} Go · Reste ${nextGb} Go).`);
  };

  const handleCreateSubReseller = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = subName.trim();
    if (!cleanName) return;
    const allocatedGb = Math.max(0, Number(subInitialGb) || 0);
    if (allocatedGb > gbBalance) {
      notify(`Stock de Gigas insuffisant (${gbBalance} Go disponibles) pour doter ${allocatedGb} Go.`);
      return;
    }
    const nextGb = gbBalance - allocatedGb;
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'sub';
    const created: ResellerAccount = {
      id: `res-sub-${Date.now()}`,
      name: cleanName,
      email: subEmail.trim() || `${slug}@justtechservices.xyz`,
      level: 'Sous-revendeur',
      parentName: 'KmerConnect Pro',
      creditBalanceFcfa: 0,
      gbBalance: allocatedGb,
      gbAllocatedTotal: allocatedGb,
      clientsCount: 0,
      maxClients: Math.max(1, Number(subMaxClients) || 25),
      commissionRatePercent: Math.max(0, Math.min(40, Number(subCommission) || 8)),
      monthSalesFcfa: 0,
      canCreateSubResellers: false,
      isActive: true,
    };
    setGbBalance(nextGb);
    setSubResellers((prev) => [created, ...prev]);
    if (allocatedGb > 0) {
      setLedger((prev) => [
        {
          id: `led-sub-${Date.now()}`,
          date: "À l'instant",
          type: 'Transfert sous-revendeur',
          description: `Attribution initiale · ${created.name} (Niv. 5)`,
          amountFcfa: 0,
          balanceAfterFcfa: 0,
          gbDelta: -allocatedGb,
          balanceAfterGb: nextGb,
        },
        ...prev,
      ]);
    }
    setSubName('');
    setSubEmail('');
    setShowSubResellerModal(false);
    notify(`Sous-revendeur ${created.name} créé avec ${allocatedGb} Go attribués.`);
  };

  const handleTransferToSubReseller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTargetSub) return;
    const amountGb = Math.max(1, Number(transferGbAmount) || 0);
    if (amountGb > gbBalance) {
      notify(`Stock personnel insuffisant (${gbBalance} Go disponibles) pour transférer ${amountGb} Go.`);
      return;
    }
    const nextGb = gbBalance - amountGb;
    setGbBalance(nextGb);
    setSubResellers((prev) =>
      prev.map((s) =>
        s.id === transferTargetSub.id
          ? {
              ...s,
              gbBalance: s.gbBalance + amountGb,
              gbAllocatedTotal: (s.gbAllocatedTotal ?? s.gbBalance) + amountGb,
            }
          : s
      )
    );
    setLedger((prev) => [
      {
        id: `led-trf-${Date.now()}`,
        date: "À l'instant",
        type: 'Transfert sous-revendeur',
        description: `Transfert Gigas vers ${transferTargetSub.name}`,
        amountFcfa: 0,
        balanceAfterFcfa: 0,
        gbDelta: -amountGb,
        balanceAfterGb: nextGb,
      },
      ...prev,
    ]);
    notify(`${amountGb} Go transférés vers ${transferTargetSub.name} (Reste : ${nextGb} Go).`);
    setTransferTargetSub(null);
  };

  return (
    <div className="max-w-7xl mx-auto p-5 lg:p-7 space-y-6">
      {/* Header & Isolated Context */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/image_745e91e4.png"
            alt="JUST TECH SERVICES"
            className="w-10 h-10 rounded-lg object-cover border border-[#E5B84B]/40 shrink-0"
          />
          <div>
            <p className="text-xs font-medium text-[#E5B84B]">
              Espace Revendeur & Sous-revendeur · Paiement des forfaits par Stock Gigas (Go)
            </p>
            <h1 className="font-display text-xl lg:text-2xl font-semibold text-[#F2F6FF] mt-0.5">
              Gestion des Clients, Stock Gigas & Sous-revendeurs
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Compte acheteur actif"
            value={activeBuyerId}
            onChange={(e) => setActiveBuyerId(e.target.value)}
            className="px-3 py-2 bg-[#101827] border border-[#243147] rounded-lg text-xs text-[#F2F6FF]"
          >
            <option value="self">Agir comme : KmerConnect Pro ({gbBalance} Go)</option>
            {subResellers.map((sub) => (
              <option key={sub.id} value={sub.id}>
                Agir comme : {sub.name} ({sub.gbBalance} Go)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowIssueModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Acheter un forfait (Go)
          </button>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className="px-4 py-3 bg-[#151F31] border border-[#45D7F4]/50 rounded-lg text-sm text-[#F2F6FF]"
        >
          {toast}
        </div>
      )}

      {/* Sélecteur d'onglets Partenaire (Stock & Licences vs Cloud Config Builder RBAC) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243147] pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSection('stock')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              activeSection === 'stock'
                ? 'bg-[#151F31] border-[#E5B84B]/60 text-[#E5B84B]'
                : 'bg-[#101827] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Stock Gigas &amp; Mes Clients ({myLicenses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('cloud-builder')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              activeSection === 'cloud-builder'
                ? 'bg-[#151F31] border-[#45D7F4]/60 text-[#45D7F4]'
                : 'bg-[#101827] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Cloud Config Builder ({currentUser ? ROLE_LABELS[currentUser.role] : 'Reseller'})
          </button>
        </div>
        <span className="text-xs font-mono text-[#8D9AAF]">
          {isSubResellerAccount
            ? 'Périmètre Sub Reseller : Templates verrouillés · ≤ 25 Go · Vos clients uniquement'
            : 'Périmètre Reseller : Templates verrouillés · ≤ 60 Go · Vos clients uniquement'}
        </span>
      </div>

      {activeSection === 'cloud-builder' ? (
        <CloudConfigBuilder
          currentUser={currentUser}
          servers={INITIAL_SERVERS}
          licenses={myLicenses}
          plans={purchasablePlans}
          onNotify={notify}
        />
      ) : (
        <>
      {/* 3 Wallet & Quota Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#101827] border border-[#E5B84B]/40 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-[#8D9AAF]">
            <span>Stock Gigas Disponible ({activeSubReseller ? 'Sous-revendeur' : 'Revendeur'})</span>
            <Database className="w-4 h-4 text-[#E5B84B]" />
          </div>
          <p className="font-mono-tabular text-3xl font-bold text-[#E5B84B] mt-2">
            {activeActorGb} <span className="text-base font-medium">Go</span>
          </p>
          <p className="text-xs text-[#8D9AAF] mt-2">
            Chaque forfait acheté déduit exactement son volume en Go de ce solde
          </p>
        </div>

        <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-[#8D9AAF]">
            <span>Plafond Places Clients</span>
            <Users className="w-4 h-4 text-[#547CFF]" />
          </div>
          <p className="font-mono-tabular text-2xl font-semibold text-[#F2F6FF] mt-2">
            {activeSubReseller ? activeSubReseller.clientsCount : clientsCount}{' '}
            <span className="text-sm text-[#8D9AAF]">
              / {activeSubReseller ? activeSubReseller.maxClients : maxClients}
            </span>
          </p>
          <div className="w-full h-1.5 bg-[#070B14] rounded-full overflow-hidden mt-3">
            <div
              className="h-full bg-[#547CFF]"
              style={{
                width: `${Math.min(
                  100,
                  ((activeSubReseller ? activeSubReseller.clientsCount : clientsCount) /
                    (activeSubReseller ? activeSubReseller.maxClients : maxClients)) *
                    100
                )}%`,
              }}
            />
          </div>
        </div>

        <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-[#8D9AAF]">
            <span>Sous-revendeurs Rattachés</span>
            <KeyRound className="w-4 h-4 text-[#45D7F4]" />
          </div>
          <p className="font-mono-tabular text-2xl font-semibold text-[#F2F6FF] mt-2">
            {subResellers.length} compte(s)
          </p>
          <p className="text-xs text-[#8D9AAF] mt-2">
            Stock cumulé sous-revendeurs :{' '}
            <strong className="text-[#45D7F4] font-mono-tabular">
              {subResellers.reduce((acc, s) => acc + s.gbBalance, 0)} Go
            </strong>
          </p>
        </div>
      </div>

      {/* Main Split: Isolated Licenses + Immutable Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#243147] flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
              Mes Licences Clients ({myLicenses.length})
            </h2>
            <span className="text-xs text-[#8D9AAF]">Achat direct par solde Gigas</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                  <th className="py-3 px-5 font-medium">Client</th>
                  <th className="py-3 px-4 font-medium">Identifiant</th>
                  <th className="py-3 px-4 font-medium">Formule</th>
                  <th className="py-3 px-4 font-medium">Quota</th>
                  <th className="py-3 px-4 font-medium">Statut</th>
                  <th className="py-3 px-5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#243147] text-sm">
                {myLicenses.map((lic) => (
                  <tr key={lic.id} className="hover:bg-[#151F31]/60">
                    <td className="py-3 px-5">
                      <div className="font-medium text-[#F2F6FF]">{lic.clientName}</div>
                      {lic.resellerName && (
                        <div className="text-[11px] text-[#8D9AAF]">{lic.resellerName}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-[#45D7F4]">
                      {lic.sshUsername}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#8D9AAF]">{lic.planName}</td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-[#F2F6FF]">
                      {lic.dataUsedGb.toFixed(1)} / {lic.dataQuotaGb ?? 0} Go
                    </td>
                    <td className="py-3 px-4">
                      <LicenseStatusText status={lic.status} />
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDeliverAndroidCloud(lic)}
                          title="Générer Code Cloud Android"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-[#151F31] hover:bg-[#45D7F4]/20 text-[#45D7F4] text-xs font-medium rounded-md transition-colors cursor-pointer"
                        >
                          <Cloud className="w-3 h-3" />
                          Cloud
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeliverIphoneNpv(lic)}
                          title="Télécharger NPV Tunnel iPhone"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-[#151F31] hover:bg-[#E5B84B]/20 text-[#E5B84B] text-xs font-medium rounded-md transition-colors cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          iOS
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRenew(lic)}
                          title="Renouveler en Go"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#151F31] hover:bg-[#547CFF] text-[#F2F6FF] text-xs font-medium rounded-md transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Renouv.
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Serveurs & Configurations visibles pour Revendeur / Sous-revendeur (masqués aux Clients) */}
          <div className="p-5 border-t border-[#243147] bg-[#0C1322]/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F2F6FF]">
                <Server className="w-4 h-4 text-[#E5B84B]" />
                <span>Serveurs VPN & Prototype NPV autorisés (Revendeur & Sous-revendeur)</span>
              </div>
              <span className="text-[11px] font-mono-tabular text-[#8D9AAF]">
                Prototype actif : {npvPrototype.name} ({npvPrototype.version})
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INITIAL_SERVERS.map((srv) => (
                <div
                  key={srv.id}
                  className="p-3 bg-[#101827] border border-[#243147] rounded-lg flex items-center justify-between text-xs font-mono-tabular"
                >
                  <div>
                    <p className="text-[#F2F6FF] font-semibold">
                      {srv.code} · {srv.name}
                    </p>
                    <p className="text-[#8D9AAF] mt-0.5">
                      {srv.hostname} ·{' '}
                      {srv.latencyMs !== null ? `Latence ${srv.latencyMs}ms` : srv.status}
                    </p>
                  </div>
                  <span className="text-[#45D7F4]">
                    {srv.activeSessions}/{srv.maxSessions} sess.
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Sous-revendeurs rattachés (Niveau 5) */}
          <div className="p-5 border-t border-[#243147] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
                  Mes Sous-revendeurs rattachés (Niveau 5 · {subResellers.length})
                </h3>
                <p className="text-xs text-[#8D9AAF]">
                  Allouez des Gigas depuis votre stock ({gbBalance} Go) ; ils achètent leurs forfaits avec leurs Go
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubResellerModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#E5B84B] rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Créer un Sous-revendeur
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {subResellers.map((sub) => (
                <div
                  key={sub.id}
                  className="p-3.5 bg-[#070B14] border border-[#243147] rounded-lg flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-medium text-[#F2F6FF]">{sub.name}</p>
                    <p className="text-xs font-mono-tabular text-[#8D9AAF] mt-0.5">
                      Stock : <span className="text-[#E5B84B] font-semibold">{sub.gbBalance} Go</span> ·{' '}
                      {sub.clientsCount}/{sub.maxClients} clients · {sub.commissionRatePercent}%
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTransferTargetSub(sub);
                      setTransferGbAmount(20);
                    }}
                    className="px-2.5 py-1.5 bg-[#E5B84B]/15 hover:bg-[#E5B84B]/25 text-[#E5B84B] text-xs font-medium rounded-md shrink-0 cursor-pointer"
                  >
                    + Allouer Go
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
              Grand Livre des Gigas (Go)
            </h2>
            <span className="text-xs text-[#8D9AAF]">Immuable</span>
          </div>

          <div className="divide-y divide-[#243147]">
            {ledger.map((entry) => {
              const deltaGb = entry.gbDelta ?? 0;
              const isCredit = deltaGb > 0;
              return (
                <div key={entry.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1 font-medium text-[#F2F6FF]">
                      {isCredit ? (
                        <ArrowDownRight className="w-3.5 h-3.5 text-[#45D7F4]" />
                      ) : (
                        <ArrowUpRight className="w-3.5 h-3.5 text-[#E5B84B]" />
                      )}
                      {entry.type}
                    </span>
                    <span
                      className={`font-mono-tabular font-semibold ${
                        isCredit ? 'text-[#45D7F4]' : 'text-[#E5B84B]'
                      }`}
                    >
                      {deltaGb > 0 ? `+${deltaGb} Go` : `${deltaGb} Go`}
                    </span>
                  </div>
                  <p className="text-xs text-[#8D9AAF]">{entry.description}</p>
                  <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#8D9AAF]">
                    <span>{entry.date}</span>
                    <span>
                      Reste :{' '}
                      {typeof entry.balanceAfterGb === 'number'
                        ? `${entry.balanceAfterGb} Go`
                        : formatFcfa(entry.balanceAfterFcfa)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal Achat Forfait par Gigas (Revendeur / Sous-revendeur) */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleIssueLicense}
            className="w-full max-w-md bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Acheter un forfait avec votre Stock Gigas
              </h3>
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Compte acheteur</label>
                <select
                  value={activeBuyerId}
                  onChange={(e) => setActiveBuyerId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF]"
                >
                  <option value="self">Revendeur · KmerConnect Pro ({gbBalance} Go)</option>
                  {subResellers.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      Sous-revendeur · {sub.name} ({sub.gbBalance} Go)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Nom du client final</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex. Kevin Ndongo"
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#45D7F4]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Forfait (Gigas & Prix)</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF] focus:outline-none focus:border-[#45D7F4]"
                >
                  {purchasablePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.dataQuotaGb} Go / {p.durationLabel} — {formatFcfa(p.priceFcfa)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-[#070B14] border border-[#243147] rounded-lg text-xs space-y-1.5 font-mono-tabular">
                <div className="flex justify-between">
                  <span className="text-[#8D9AAF]">Stock Gigas actuel</span>
                  <span className="text-[#F2F6FF]">{activeActorGb} Go</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8D9AAF]">Déduction du forfait</span>
                  <span className="text-[#E5B84B]">- {requiredGb} Go</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-[#243147]">
                  <span className="text-[#8D9AAF]">Solde après achat</span>
                  <span className={activeActorGb >= requiredGb ? 'text-[#45D7F4]' : 'text-[#EF4444]'}>
                    {activeActorGb - requiredGb} Go
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={activeActorGb < requiredGb}
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-50 text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer disabled:cursor-not-allowed"
              >
                Déduire {requiredGb} Go & Provisionner
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Créer Sous-revendeur (Niveau 5) avec attribution de Gigas */}
      {showSubResellerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateSubReseller}
            className="w-full max-w-md bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Nouveau Sous-revendeur (Niveau 5)
              </h3>
              <button
                type="button"
                onClick={() => setShowSubResellerModal(false)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Nom du sous-revendeur</label>
                <input
                  type="text"
                  required
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder="Ex. Bafoussam Fast VPN"
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">E-mail (optionnel)</label>
                <input
                  type="email"
                  value={subEmail}
                  onChange={(e) => setSubEmail(e.target.value)}
                  placeholder="sub@justtechservices.xyz"
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm text-[#F2F6FF]"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Gigas alloués (Go)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={subInitialGb}
                    onChange={(e) => setSubInitialGb(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Places clients</label>
                  <input
                    type="number"
                    min={1}
                    value={subMaxClients}
                    onChange={(e) => setSubMaxClients(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8D9AAF] mb-1">Comm. (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={subCommission}
                    onChange={(e) => setSubCommission(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                  />
                </div>
              </div>
              <p className="text-xs text-[#8D9AAF]">
                Les {subInitialGb} Go attribués seront déduits de votre stock ({gbBalance} Go disponibles).
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSubResellerModal(false)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Créer & Attribuer {subInitialGb} Go
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Transfert Gigas vers Sous-revendeur */}
      {transferTargetSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleTransferToSubReseller}
            className="w-full max-w-sm bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                Allouer des Gigas à {transferTargetSub.name}
              </h3>
              <button
                type="button"
                onClick={() => setTransferTargetSub(null)}
                className="text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-[#8D9AAF]">
                Votre stock : <span className="font-mono-tabular text-[#E5B84B]">{gbBalance} Go</span> · Actuel sous-revendeur :{' '}
                <span className="font-mono-tabular text-[#45D7F4]">{transferTargetSub.gbBalance} Go</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[10, 25, 50].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTransferGbAmount(preset)}
                    className={`py-1.5 rounded-md text-xs font-mono-tabular cursor-pointer border ${
                      transferGbAmount === preset
                        ? 'bg-[#E5B84B]/20 border-[#E5B84B] text-[#E5B84B]'
                        : 'bg-[#070B14] border-[#243147] text-[#8D9AAF]'
                    }`}
                  >
                    +{preset} Go
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Volume personnalisé (Go)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={transferGbAmount}
                  onChange={(e) => setTransferGbAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#070B14] border border-[#243147] rounded-lg text-sm font-mono-tabular text-[#F2F6FF]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTransferTargetSub(null)}
                className="px-4 py-2 bg-[#151F31] text-[#8D9AAF] text-xs font-medium rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E5B84B] text-[#070B14] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Transférer +{transferGbAmount} Go
              </button>
            </div>
          </form>
        </div>
      )}
        </>
      )}
    </div>
  );
};
