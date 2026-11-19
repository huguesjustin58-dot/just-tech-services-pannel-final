import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Server, Wifi } from 'lucide-react';
import { INITIAL_SERVERS } from '../data/maquetteData';

export const GlobalStatusBar: React.FC = () => {
  const [selectedServerIdx, setSelectedServerIdx] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [apiStatus, setApiStatus] = useState<'Connecté' | 'Synchronisation...' | 'Hors ligne'>(
    'Synchronisation...'
  );
  const [lastCheck, setLastCheck] = useState<string>('—');

  const activeServer = INITIAL_SERVERS[selectedServerIdx] ?? INITIAL_SERVERS[0];

  const probeBackendHealth = useCallback(async () => {
    setApiStatus('Synchronisation...');
    const started = performance.now();
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setLatencyMs(elapsed);
      setApiStatus('Connecté');
      setLastCheck(
        new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    } catch {
      setLatencyMs(null);
      setApiStatus('Hors ligne');
      setLastCheck(
        new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    }
  }, []);

  useEffect(() => {
    void probeBackendHealth();
    const interval = window.setInterval(() => {
      void probeBackendHealth();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [probeBackendHealth]);

  return (
    <footer className="bg-[#101827] border-t border-[#243147] px-5 lg:px-7 py-2.5 text-xs text-[#8D9AAF]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5">
          {/* Nœud VPN surveillé */}
          <button
            type="button"
            onClick={() => setSelectedServerIdx((i) => (i + 1) % INITIAL_SERVERS.length)}
            className="inline-flex items-center gap-2 hover:text-[#F2F6FF] transition-colors cursor-pointer"
            title="Changer de nœud VPN surveillé"
          >
            <Server className="w-3.5 h-3.5 text-[#E5B84B] shrink-0" />
            <span>Nœud VPN :</span>
            <span className="font-mono-tabular font-medium text-[#F2F6FF]">
              {activeServer.code}
            </span>
            <span
              className={`font-medium ${
                activeServer.status === 'En ligne'
                  ? 'text-[#45D7F4]'
                  : activeServer.status === 'Hors ligne'
                    ? 'text-[#EF4444]'
                    : 'text-[#E5B84B]'
              }`}
            >
              ({activeServer.status === 'Non vérifié' ? 'Sonde SSH distante requise' : activeServer.status})
            </span>
          </button>

          {/* Latence HTTP réelle mesurée vers /api/health */}
          <div className="inline-flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[#45D7F4] shrink-0" />
            <span>Latence API :</span>
            <span className="font-mono-tabular font-medium text-[#F2F6FF]">
              {latencyMs !== null ? `${latencyMs} ms` : '—'}
            </span>
          </div>

          {/* État réel du Backend API */}
          <div className="inline-flex items-center gap-2">
            <Wifi
              className={`w-3.5 h-3.5 shrink-0 ${
                apiStatus === 'Hors ligne' ? 'text-[#EF4444]' : 'text-[#45D7F4]'
              }`}
            />
            <span>Backend API :</span>
            <span
              className={`font-mono-tabular ${
                apiStatus === 'Hors ligne' ? 'text-[#EF4444]' : 'text-[#45D7F4]'
              }`}
            >
              /api/health · {apiStatus}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden sm:inline font-mono-tabular text-[11px] text-[#8D9AAF]">
            Relevé {lastCheck}
          </span>
          <button
            type="button"
            onClick={() => void probeBackendHealth()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#151F31] hover:bg-[#1C283E] border border-[#243147] rounded-md text-[11px] font-medium text-[#F2F6FF] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3 text-[#E5B84B]" />
            Sonder
          </button>
        </div>
      </div>
    </footer>
  );
};
