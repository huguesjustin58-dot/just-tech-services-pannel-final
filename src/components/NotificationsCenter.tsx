import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  ServerCrash,
  X,
} from 'lucide-react';

export interface SystemNotification {
  id: string;
  category: 'expiration' | 'payment' | 'server';
  title: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

const INITIAL_NOTIFICATIONS: SystemNotification[] = [
  {
    id: 'notif-1',
    category: 'expiration',
    title: 'Expiration imminente (48h)',
    detail: 'Licence jts_adiallo18 (Premium) · Expire le 28/11 · Alerte Telegram envoyée',
    timestamp: 'Il y a 4 min',
    read: false,
  },
  {
    id: 'notif-2',
    category: 'payment',
    title: 'Paiement Mobile Money validé',
    detail: 'Réf JTS-202611-0889 · 7 800 FCFA crédités et facture FAC-0889 générée',
    timestamp: 'Il y a 19 min',
    read: false,
  },
  {
    id: 'notif-3',
    category: 'server',
    title: 'Alerte charge SlowDNS · VPS-CM-01',
    detail: 'Pic de 214/500 sessions · Load balancer bascule les nouvelles licences sur VPS-FR-02',
    timestamp: 'Il y a 37 min',
    read: false,
  },
  {
    id: 'notif-4',
    category: 'payment',
    title: 'Déclaration MTN MoMo en attente',
    detail: 'Doris Kamga · 6 000 FCFA (#MP261118.1412.B89412) prêt pour vérification',
    timestamp: 'Il y a 1 h',
    read: true,
  },
];

export const NotificationsCenter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<SystemNotification[]>(INITIAL_NOTIFICATIONS);

  useEffect(() => {
    let active = true;
    const syncAlerts = async () => {
      try {
        const res = await fetch('/api/agent/alerts');
        if (!res.ok || !active) return;
        const data = (await res.json()) as { alerts?: SystemNotification[] };
        const incoming = data.alerts ?? [];
        if (incoming.length === 0) return;
        setItems((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const fresh = incoming.filter((a) => !existingIds.has(a.id));
          return fresh.length > 0 ? [...fresh, ...prev] : prev;
        });
      } catch {
        // Ignore network errors during background alert sync
      }
    };
    void syncAlerts();
    const timer = setInterval(syncAlerts, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const unreadCount = items.filter((item) => !item.read).length;

  const markAllRead = () => {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
  };

  const markOneRead = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read: true } : item))
    );
  };

  const renderIcon = (category: SystemNotification['category']) => {
    switch (category) {
      case 'expiration':
        return <Clock className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />;
      case 'payment':
        return <CheckCircle2 className="w-4 h-4 text-[#45D7F4] shrink-0 mt-0.5" />;
      case 'server':
        return <ServerCrash className="w-4 h-4 text-[#E5B84B] shrink-0 mt-0.5" />;
    }
  };

  return (
    <div className="fixed top-[74px] right-4 lg:right-7 z-40">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-2 bg-[#101827]/95 backdrop-blur hover:bg-[#151F31] border border-[#E5B84B]/40 rounded-xl text-xs font-medium text-[#F2F6FF] shadow-lg transition-colors cursor-pointer"
        aria-expanded={isOpen}
        aria-label="Ouvrir le centre de notifications système"
      >
        <Bell className="w-4 h-4 text-[#E5B84B]" />
        <span className="hidden sm:inline">Notifications</span>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-[#E5B84B] text-[#070B14] font-mono-tabular text-[11px] font-bold">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-2 w-[calc(100vw-2rem)] sm:w-96 bg-[#101827] border border-[#243147] rounded-xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#243147] flex items-center justify-between gap-2 bg-[#151F31]">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
                Logs Système & Alertes
              </h3>
              <p className="text-[11px] text-[#8D9AAF] font-mono-tabular">
                {unreadCount} non lu(s) · Expirations, Paiements, Serveurs
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-[#E5B84B] hover:bg-[#101827] rounded-md transition-colors cursor-pointer"
                  title="Tout marquer comme lu"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Tout lire
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
                aria-label="Fermer le panneau de notifications"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-[#243147]">
            {items.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#8D9AAF] flex flex-col items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-[#8D9AAF]" />
                Aucune alerte récente.
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => markOneRead(item.id)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                    item.read ? 'bg-[#101827] opacity-75' : 'bg-[#151F31]/65 hover:bg-[#151F31]'
                  }`}
                >
                  {renderIcon(item.category)}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#F2F6FF] truncate">
                        {item.title}
                      </span>
                      <span className="text-[11px] font-mono-tabular text-[#8D9AAF] shrink-0">
                        {item.timestamp}
                      </span>
                    </div>
                    <p className="text-xs text-[#8D9AAF] leading-relaxed">{item.detail}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
