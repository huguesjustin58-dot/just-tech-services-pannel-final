import React, { useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Download,
  KeyRound,
  Link2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { CloudConfigBundle, NpvPrototype } from '../types/panel';

interface CloudConfigGeneratorCardProps {
  bundle: CloudConfigBundle | null;
  loading: boolean;
  error: string | null;
  planName: string;
  quotaTotalGb: number;
  quotaUsedGb: number;
  maxSessions: number;
  npvPrototype: NpvPrototype;
  onGenerateBundle: () => Promise<void>;
  onDownloadNpvt: () => Promise<void>;
  onCopy: (key: string, value: string, label: string) => void;
  copiedKey: string | null;
}

type BundleFormatTab = 'token' | 'qr' | 'npvt';

export const CloudConfigGeneratorCard: React.FC<CloudConfigGeneratorCardProps> = ({
  bundle,
  loading,
  error,
  planName,
  quotaTotalGb,
  quotaUsedGb,
  maxSessions,
  npvPrototype,
  onGenerateBundle,
  onDownloadNpvt,
  onCopy,
  copiedKey,
}) => {
  const [formatTab, setFormatTab] = useState<BundleFormatTab>('qr');

  const effectiveTotalGb = bundle?.quota.totalGb ?? quotaTotalGb;
  const effectiveUsedGb = bundle?.quota.usedGb ?? quotaUsedGb;
  const effectiveRemainingGb =
    bundle?.quota.remainingGb ?? Math.max(0, Number((quotaTotalGb - quotaUsedGb).toFixed(2)));
  const effectivePercent =
    bundle?.quota.usagePercent ??
    (quotaTotalGb > 0 ? Math.min(100, Math.round((quotaUsedGb / quotaTotalGb) * 100)) : 100);
  const quotaExhausted = bundle ? bundle.quota.exhausted : effectiveRemainingGb <= 0;

  return (
    <section className="bg-[#101827] border border-[#243147] rounded-2xl p-6 space-y-5">
      {/* En-tête + badge zéro secret */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-[#45D7F4]" />
            <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
              Générateur de Configurations Cloud (QR Code · Lien · Token · .npvt)
            </h2>
          </div>
          <p className="text-xs text-[#8D9AAF] mt-1">
            Synchronisé en temps réel sur votre pass actif (<strong className="text-[#F2F6FF]">{planName}</strong>) et votre quota client restant.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#070B14] border border-[#45D7F4]/35 text-[11px] font-medium text-[#45D7F4]">
            <ShieldCheck className="w-3.5 h-3.5" />
            Zéro mot de passe / clé privée (cloud_code + import_token révocable)
          </span>
          <button
            type="button"
            disabled={loading || quotaExhausted}
            onClick={() => void onGenerateBundle()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-50 text-[#070B14] text-xs font-semibold cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {bundle ? 'Régénérer la config Cloud' : 'Générer ma config Cloud'}
          </button>
        </div>
      </div>

      {/* Bandeau Pass & Quota Client Réel */}
      <div className="p-4 rounded-xl bg-[#070B14] border border-[#243147] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[#8D9AAF]">
              Pass lié : <strong className="text-[#E5B84B]">{bundle?.planName ?? planName}</strong>
            </span>
            <span className="text-[#8D9AAF]">
              Sessions max : <strong className="text-[#F2F6FF] font-mono-tabular">{bundle?.maxSessions ?? maxSessions}</strong>
            </span>
            {bundle && (
              <span className="text-[#8D9AAF]">
                Nœud : <strong className="text-[#45D7F4] font-mono-tabular">{bundle.serverCode}</strong>
              </span>
            )}
          </div>
          <span
            className={`font-mono-tabular font-semibold ${
              quotaExhausted ? 'text-[#EF4444]' : 'text-[#45D7F4]'
            }`}
          >
            {effectiveUsedGb.toFixed(1)} Go utilisés / {effectiveTotalGb} Go · Restant : {effectiveRemainingGb.toFixed(1)} Go
          </span>
        </div>

        <div className="w-full h-2 rounded-full bg-[#151F31] overflow-hidden">
          <div
            className={`h-full transition-all ${
              quotaExhausted
                ? 'bg-[#EF4444]'
                : effectivePercent >= 85
                  ? 'bg-[#E5B84B]'
                  : 'bg-[#45D7F4]'
            }`}
            style={{ width: `${effectivePercent}%` }}
          />
        </div>

        {quotaExhausted && (
          <p className="text-xs text-[#EF4444]">
            Quota épuisé : la génération et l&apos;échange de configurations Cloud sont automatiquement bloqués côté serveur jusqu&apos;au renouvellement du pass.
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="px-4 py-3 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/40 text-xs text-[#EF4444]"
        >
          {error}
        </div>
      )}

      {/* Sélecteur de formats client : QR & Lien / Code Cloud & Token / .npvt */}
      <div className="flex flex-wrap gap-2 border-b border-[#243147] pb-3">
        {(
          [
            { id: 'qr', label: 'QR Code & Lien URI', icon: <QrCode className="w-3.5 h-3.5" /> },
            { id: 'token', label: 'Code Cloud & Token', icon: <KeyRound className="w-3.5 h-3.5" /> },
            { id: 'npvt', label: 'Fichier .npvt (iOS)', icon: <Smartphone className="w-3.5 h-3.5" /> },
          ] as const
        ).map((tab) => {
          const active = formatTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFormatTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                active
                  ? 'bg-[#151F31] border-[#E5B84B] text-[#E5B84B]'
                  : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {!bundle ? (
        <div className="p-6 rounded-xl bg-[#070B14] border border-dashed border-[#243147] text-center space-y-3">
          <p className="text-xs text-[#8D9AAF]">
            Cliquez sur <strong className="text-[#E5B84B]">Générer ma config Cloud</strong> pour émettre un pack synchronisé avec votre pass actif et votre quota restant (sans exposer votre mot de passe SSH).
          </p>
        </div>
      ) : (
        <>
          {/* Onglet 1 : QR Code & Lien URI Opaque */}
          {formatTab === 'qr' && (
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 items-center">
              <div className="p-3 rounded-xl bg-[#070B14] border border-[#45D7F4]/40 flex flex-col items-center gap-2">
                <img
                  src={bundle.qrDataUrl}
                  alt={`QR Code sécurisé ${bundle.code}`}
                  className="w-44 h-44 rounded-lg"
                />
                <span className="text-[11px] font-mono-tabular text-[#45D7F4]">
                  {bundle.code}
                </span>
              </div>

              <div className="space-y-3 min-w-0">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[#F2F6FF] flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-[#45D7F4]" />
                    Lien d&apos;importation opaque (JUST TECH SERVICES TUNNEL)
                  </p>
                  <p className="text-[11px] text-[#8D9AAF]">
                    Contient uniquement <code className="text-[#E5B84B]">cloud_code</code> et <code className="text-[#45D7F4]">import_token</code> révocable, échangeables en <code className="text-[#45D7F4]">POST</code> avec <code className="text-[#45D7F4]">device_id</code>. Aucun mot de passe SSH ni clé privée n&apos;est exposé dans ce lien ou ce QR code.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-[#070B14] border border-[#243147] flex items-center justify-between gap-2">
                  <code className="font-mono-tabular text-xs text-[#E5B84B] break-all">
                    {bundle.importUri}
                  </code>
                  <button
                    type="button"
                    onClick={() => onCopy('cloud-uri', bundle.importUri, 'Lien Cloud sécurisé')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#151F31] border border-[#243147] text-xs text-[#F2F6FF] shrink-0 cursor-pointer"
                  >
                    {copiedKey === 'cloud-uri' ? (
                      <Check className="w-3.5 h-3.5 text-[#45D7F4]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#E5B84B]" />
                    )}
                    Copier
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-tabular text-[#8D9AAF]">
                  <span>
                    Protocoles vérifiés :{' '}
                    <strong className="text-[#45D7F4]">
                      {bundle.operationalProtocols.join(' · ').toUpperCase()}
                    </strong>
                  </span>
                  <span>
                    Expiration pass :{' '}
                    <strong className="text-[#F2F6FF]">
                      {new Date(bundle.expiresAt).toLocaleDateString('fr-FR')}
                    </strong>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Onglet 2 : Code Cloud & Jeton d'échange courte durée */}
          {formatTab === 'token' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-[#070B14] border border-[#243147] space-y-2">
                <p className="text-xs text-[#8D9AAF]">Code d&apos;activation Cloud</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono-tabular text-base font-bold text-[#E5B84B]">
                    {bundle.code}
                  </code>
                  <button
                    type="button"
                    onClick={() => onCopy('cloud-code', bundle.code, 'Code Cloud')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#151F31] border border-[#243147] rounded text-xs text-[#F2F6FF] cursor-pointer"
                  >
                    {copiedKey === 'cloud-code' ? (
                      <Check className="w-3.5 h-3.5 text-[#45D7F4]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#E5B84B]" />
                    )}
                    Copier
                  </button>
                </div>
                <p className="text-[11px] text-[#8D9AAF]">
                  Statut serveur : <strong className="text-[#45D7F4]">{bundle.status}</strong>
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#070B14] border border-[#243147] space-y-2">
                <p className="text-xs text-[#8D9AAF]">Jeton <code className="text-[#45D7F4]">import_token</code> révocable (24h · POST uniquement)</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono-tabular text-xs text-[#45D7F4] truncate">
                    {bundle.exchangeToken}
                  </code>
                  <button
                    type="button"
                    onClick={() => onCopy('cloud-token', bundle.exchangeToken, 'Token d’échange')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#151F31] border border-[#243147] rounded text-xs text-[#F2F6FF] shrink-0 cursor-pointer"
                  >
                    {copiedKey === 'cloud-token' ? (
                      <Check className="w-3.5 h-3.5 text-[#45D7F4]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#45D7F4]" />
                    )}
                    Copier
                  </button>
                </div>
                <p className="text-[11px] text-[#8D9AAF]">
                  Valide jusqu&apos;au{' '}
                  <span className="font-mono-tabular text-[#F2F6FF]">
                    {new Date(bundle.tokenExpiresAt).toLocaleString('fr-FR')}
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Onglet 3 : Fichier privé .npvt (téléchargement POST direct, jamais en URL/QR) */}
          {formatTab === 'npvt' && (
            <div className="p-4 rounded-xl bg-[#070B14] border border-[#E5B84B]/35 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <p className="text-sm font-semibold text-[#F2F6FF] flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#E5B84B]" />
                  Fichier NPV Tunnel ({bundle.npvtFilename}) · {npvPrototype.version}
                </p>
                <p className="text-xs text-[#8D9AAF]">
                  Compilé côté serveur en <code className="text-[#45D7F4]">POST</code> privé (<code className="text-[#45D7F4]">Cache-Control: no-store</code>) avec vos quotas réels ({bundle.quota.remainingGb} Go restants). Aucun mot de passe n&apos;est transmis par URL ou QR code.
                </p>
              </div>
              <button
                type="button"
                disabled={loading || quotaExhausted}
                onClick={() => void onDownloadNpvt()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-50 text-[#070B14] text-xs font-semibold cursor-pointer shrink-0"
              >
                <Download className="w-4 h-4" />
                Télécharger mon .npvt privé
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
