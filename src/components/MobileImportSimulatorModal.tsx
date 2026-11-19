import React, { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react';
import { authFetch } from '../services/authClient';
import { CloudDistributionItemDto } from '../types/sshCloudConfig';

export interface MobileImportSimulatorModalProps {
  isOpen: boolean;
  initialCloudCode: string;
  activeRecord?: CloudDistributionItemDto | null;
  canRevoke: boolean;
  canViewRawJson?: boolean;
  onClose: () => void;
  onRecordUpdated?: (updated: CloudDistributionItemDto) => void;
  onNotify?: (msg: string) => void;
}

interface SimulatorResponseState {
  httpStatus: number;
  ok: boolean;
  method: 'POST' | 'GET';
  endpoint: string;
  latencyMs: number;
  receivedAt: string;
  rawJsonText: string;
  parsed: Record<string, unknown> | null;
}

export const MobileImportSimulatorModal: React.FC<MobileImportSimulatorModalProps> = ({
  isOpen,
  initialCloudCode,
  activeRecord,
  canRevoke,
  canViewRawJson = false,
  onClose,
  onRecordUpdated,
  onNotify = () => undefined,
}) => {
  const [cloudCodeInput, setCloudCodeInput] = useState(initialCloudCode);
  const [deviceIdInput, setDeviceIdInput] = useState('AND-JTS-TUNNEL-94F2');
  const [requestMode, setRequestMode] = useState<'POST' | 'GET'>('POST');
  const [loading, setLoading] = useState(false);
  const [mutatingStatus, setMutatingStatus] = useState(false);
  const [response, setResponse] = useState<SimulatorResponseState | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const runResolve = async (targetCode: string, mode: 'POST' | 'GET' = requestMode) => {
    const clean = targetCode.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    const effectiveMode = canViewRawJson ? mode : 'POST';
    const endpoint = `/api/v1/cloud/resolve/${encodeURIComponent(clean)}`;
    const started = performance.now();
    try {
      const res =
        effectiveMode === 'POST'
          ? await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-JTS-Device-ID': deviceIdInput.trim() || 'AND-JTS-SIM',
              },
              body: JSON.stringify({
                device_id: deviceIdInput.trim() || 'AND-JTS-SIM',
                client_app: 'JUST_TECH_SERVICES_TUNNEL',
                schema_version: 1,
              }),
            })
          : await authFetch(endpoint, {
              method: 'GET',
              headers: {
                'X-JTS-Device-ID': deviceIdInput.trim() || 'super-admin-inspector',
              },
            });

      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      const text = await res.text();
      let parsed: Record<string, unknown> | null = null;
      let pretty = text;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
        pretty = JSON.stringify(parsed, null, 2);
      } catch {
        // Garde le texte brut si réponse non-JSON
      }

      setResponse({
        httpStatus: res.status,
        ok: res.ok,
        method: mode,
        endpoint,
        latencyMs,
        receivedAt: new Date().toLocaleTimeString('fr-FR'),
        rawJsonText: pretty,
        parsed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur réseau';
      setResponse({
        httpStatus: 0,
        ok: false,
        method: mode,
        endpoint,
        latencyMs: 0,
        receivedAt: new Date().toLocaleTimeString('fr-FR'),
        rawJsonText: JSON.stringify({ status: 'error', error: msg }, null, 2),
        parsed: { status: 'error', error: msg },
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const nextCode = initialCloudCode.trim().toUpperCase();
      setCloudCodeInput(nextCode);
      setResponse(null);
      if (nextCode) {
        void runResolve(nextCode, 'POST');
      }
    }
  }, [isOpen, initialCloudCode]);

  if (!isOpen) return null;

  const isRevoked =
    activeRecord?.cloudCode === cloudCodeInput.trim().toUpperCase() &&
    (activeRecord.config.cloud.status === 'revoked' || !activeRecord.config.cloud.enabled);

  const handleToggleRevoke = async () => {
    const clean = cloudCodeInput.trim().toUpperCase();
    if (!clean) return;
    setMutatingStatus(true);
    const action = isRevoked ? 'activate' : 'revoke';
    try {
      const res = await authFetch(`/api/v1/cloud/configs/${encodeURIComponent(clean)}/${action}`, {
        method: 'POST',
      });
      const data = (await res.json()) as { record?: CloudDistributionItemDto; error?: string };
      if (!res.ok || !data.record) {
        onNotify(data.error || 'Action refusée par le serveur RBAC.');
        return;
      }
      onRecordUpdated?.(data.record);
      onNotify(
        action === 'revoke'
          ? `Code Cloud ${clean} révoqué — résolution immédiatement bloquée (HTTP 410).`
          : `Code Cloud ${clean} réactivé pour la résolution API.`
      );
      await runResolve(clean, requestMode);
    } finally {
      setMutatingStatus(false);
    }
  };

  const resolvedPayloadObj =
    response?.ok && response.parsed && typeof response.parsed.payload === 'object'
      ? (response.parsed.payload as { content?: string })
      : null;
  const resolvedRawPayload = typeof resolvedPayloadObj?.content === 'string' ? resolvedPayloadObj.content : '';
  const resolvedCrlfCount =
    (resolvedRawPayload.match(/\r\n/g)?.length ?? 0) +
    (resolvedRawPayload.match(/\[crlf\]/gi)?.length ?? 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Simulateur d'Import Mobile — Test Contrat API JUST TECH SERVICES TUNNEL"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B14]/85 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-[#243147] bg-[#101827] shadow-2xl overflow-hidden">
        {/* En-tête Modale */}
        <div className="px-6 py-4 border-b border-[#243147] flex items-center justify-between gap-4 bg-[#070B14]/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-[#151F31] border border-[#45D7F4]/40 text-[#45D7F4] shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-mono text-[#45D7F4] uppercase tracking-wider">
                Test Contrat API · /api/v1/cloud/resolve/&#123;cloud_code&#125;
              </p>
              <h2 className="font-display text-lg font-semibold text-[#F2F6FF] truncate">
                Simulateur d&apos;Import Mobile — JUST TECH SERVICES TUNNEL
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le simulateur"
            className="p-2 rounded-lg text-[#8D9AAF] hover:text-[#F2F6FF] hover:bg-[#151F31] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps scrollable */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Barre de requête simulée */}
          <div className="bg-[#070B14] border border-[#243147] rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1.5">
                  Code Cloud (<code className="text-[#45D7F4]">cloud_code</code>)
                </label>
                <input
                  type="text"
                  value={cloudCodeInput}
                  onChange={(e) => setCloudCodeInput(e.target.value.toUpperCase())}
                  placeholder="JTS-XXXX-XXXX"
                  className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#E5B84B]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1.5">
                  Identifiant Appareil (<code className="text-[#45D7F4]">device_id</code>)
                </label>
                <input
                  type="text"
                  value={deviceIdInput}
                  onChange={(e) => setDeviceIdInput(e.target.value)}
                  placeholder="AND-JTS-TUNNEL-94F2"
                  className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs text-[#F2F6FF]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1.5">Mode d&apos;appel API</label>
                {canViewRawJson ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRequestMode('POST')}
                      className={`px-2.5 py-2 rounded-lg border text-xs font-mono cursor-pointer ${
                        requestMode === 'POST'
                          ? 'bg-[#151F31] border-[#45D7F4] text-[#45D7F4]'
                          : 'bg-[#101827] border-[#243147] text-[#8D9AAF]'
                      }`}
                    >
                      POST (App Mobile)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestMode('GET')}
                      className={`px-2.5 py-2 rounded-lg border text-xs font-mono cursor-pointer ${
                        requestMode === 'GET'
                          ? 'bg-[#151F31] border-[#E5B84B] text-[#E5B84B]'
                          : 'bg-[#101827] border-[#243147] text-[#8D9AAF]'
                      }`}
                    >
                      GET (Super Admin)
                    </button>
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-lg bg-[#101827] border border-[#243147] text-xs font-mono text-[#45D7F4]">
                    POST (Vérification statut Tunnel)
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#243147]">
              <p className="text-xs font-mono text-[#8D9AAF] truncate">
                <span className="text-[#45D7F4]">{requestMode}</span>{' '}
                /api/v1/cloud/resolve/{cloudCodeInput.trim().toUpperCase() || '{cloud_code}'}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {canRevoke && (
                  <button
                    type="button"
                    disabled={mutatingStatus || !cloudCodeInput.trim()}
                    onClick={() => void handleToggleRevoke()}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                      isRevoked
                        ? 'bg-[#151F31] border-[#45D7F4]/50 text-[#45D7F4] hover:bg-[#1E2B44]'
                        : 'bg-[#EF4444]/10 border-[#EF4444]/45 text-[#EF4444] hover:bg-[#EF4444]/20'
                    }`}
                  >
                    {isRevoked ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        Réactiver ce code
                      </>
                    ) : (
                      <>
                        <Ban className="w-3.5 h-3.5" />
                        Révoquer / Désactiver
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  disabled={loading || !cloudCodeInput.trim()}
                  onClick={() => void runResolve(cloudCodeInput, requestMode)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#45D7F4] hover:bg-[#32C5E2] disabled:opacity-50 text-[#070B14] text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  {loading ? 'Résolution...' : 'Résoudre le code Cloud'}
                </button>
              </div>
            </div>
          </div>

          {/* Résultat de la résolution */}
          {response && (
            <div className="space-y-4">
              {/* Bandeau Statut HTTP */}
              <div
                className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                  response.ok
                    ? 'bg-[#070B14] border-[#45D7F4]/45'
                    : 'bg-[#EF4444]/10 border-[#EF4444]/45'
                }`}
              >
                <div className="flex items-center gap-3">
                  {response.ok ? (
                    <CheckCircle2 className="w-5 h-5 text-[#45D7F4] shrink-0" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0" />
                  )}
                  <div>
                    <p className="text-xs font-mono font-semibold text-[#F2F6FF]">
                      HTTP {response.httpStatus} ·{' '}
                      {response.ok
                        ? 'CONTRAT JSON V1 RÉSOLU — PRÊT POUR IMPORT TUNNEL'
                        : String(response.parsed?.code || 'RESOLUTION_BLOCKED')}
                    </p>
                    <p className="text-xs text-[#8D9AAF] mt-0.5">
                      {response.ok
                        ? response.method === 'POST'
                          ? 'Handshake mobile validé : JUST TECH SERVICES TUNNEL reçoit le profil SSH exact.'
                          : 'Requête GET publique : les secrets SSH restent automatiquement masqués.'
                        : String(
                            response.parsed?.error ||
                              'Résolution rejetée par le serveur.'
                          )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-[#8D9AAF]">
                  <span>{response.latencyMs} ms</span>
                  <span>{response.receivedAt}</span>
                </div>
              </div>

              {/* Contrôle intégrité du Payload brut si résolu */}
              {response.ok && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-[#070B14] border border-[#243147]">
                    <span className="text-[#8D9AAF] block">Protocole résolu</span>
                    <span className="font-mono text-[#45D7F4] font-semibold">
                      {String(response.parsed?.protocol || '—')}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#070B14] border border-[#243147]">
                    <span className="text-[#8D9AAF] block">Payload brut préservé</span>
                    <span className="font-mono text-[#F2F6FF] tabular-nums">
                      {resolvedRawPayload.length} car. · {resolvedCrlfCount} CRLF/[crlf]
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#070B14] border border-[#243147]">
                    <span className="text-[#8D9AAF] block">Confidentialité QR / URL</span>
                    <span className="text-[#E5B84B] inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Zero-Secret URI
                    </span>
                  </div>
                </div>
              )}

              {/* Sortie JSON brute exacte : strictement réservée au Super Admin */}
              {canViewRawJson ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#E8EEF5] inline-flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-[#45D7F4]" />
                      Payload JSON exact reçu par JUST TECH SERVICES TUNNEL (Super Admin)
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(response.rawJsonText);
                        setCopiedPayload(true);
                        setTimeout(() => setCopiedPayload(false), 1500);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs text-[#F2F6FF] cursor-pointer"
                    >
                      {copiedPayload ? (
                        <Check className="w-3.5 h-3.5 text-[#45D7F4]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-[#45D7F4]" />
                      )}
                      {copiedPayload ? 'Copié' : 'Copier JSON'}
                    </button>
                  </div>

                  <pre
                    className={`p-4 rounded-xl border bg-[#070B14] font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[340px] whitespace-pre ${
                      response.ok
                        ? 'border-[#243147] text-[#45D7F4]'
                        : 'border-[#EF4444]/40 text-[#EF4444]'
                    }`}
                  >
                    {response.rawJsonText}
                  </pre>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-[#243147] bg-[#070B14] flex items-start gap-3 text-xs text-[#8D9AAF]">
                  <Lock className="w-4 h-4 text-[#E5B84B] shrink-0 mt-0.5" />
                  <p>
                    <strong className="text-[#F2F6FF]">Contrat JSON protégé (Super Admin uniquement) :</strong>{' '}
                    la vérification du statut HTTP et la révocation du code Cloud restent actives pour votre rôle, mais la structure JSON brute est réservée exclusivement au Super Admin pour adapter les configurations.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileImportSimulatorModal;
