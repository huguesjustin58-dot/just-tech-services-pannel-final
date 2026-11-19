import React, { FormEvent, useState } from 'react';
import { ArrowLeft, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { loginWithCredentials } from '../services/authClient';
import { AuthenticatedUser, ROLE_LABELS } from '../types/panel';

interface AdminAuthGateProps {
  zone: 'admin' | 'reseller';
  currentUser: AuthenticatedUser | null;
  onAuthenticated: (user: AuthenticatedUser) => void;
  onReturnToClientPortal: () => void;
  onLogout: () => Promise<void>;
}

/**
 * Porte d'accès isolée pour /admin (Super Admin, Admin, Manager) et /reseller (Reseller).
 * Ne monte jamais le workspace protégé tant que le serveur n'a pas validé un rôle autorisé.
 */
export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({
  zone,
  currentUser,
  onAuthenticated,
  onReturnToClientPortal,
  onLogout,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAdminZone = zone === 'admin';
  const title = isAdminZone
    ? 'Espace Administration Sécurisé'
    : 'Espace Partenaire Revendeur';
  const subtitle = isAdminZone
    ? 'Accès strictement isolé — réservé aux rôles Super Admin, Admin et Manager.'
    : 'Accès strictement isolé — réservé aux comptes Revendeurs et Sous-revendeurs agréés.';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await loginWithCredentials(email.trim(), password, zone);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPassword('');
      onAuthenticated(result.user);
    } finally {
      setSubmitting(false);
    }
  };

  // Si l'utilisateur est déjà connecté avec un rôle non autorisé (ex: Client tentant /admin)
  if (currentUser) {
    return (
      <div className="min-h-[calc(100vh-110px)] bg-[#070B14] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg rounded-2xl border border-[#EF4444]/40 bg-[#101827] p-7 shadow-2xl">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-mono-tabular uppercase tracking-wider text-[#EF4444]">
                HTTP 403 · Isolation RBAC active
              </p>
              <h1 className="font-display text-xl font-semibold text-[#F2F6FF]">
                Accès refusé à la zone {isAdminZone ? 'Administration' : 'Revendeur'}
              </h1>
              <p className="text-sm text-[#8D9AAF] leading-relaxed">
                Votre session active appartient au rôle{' '}
                <span className="text-[#45D7F4] font-semibold">
                  {ROLE_LABELS[currentUser.role]}
                </span>{' '}
                ({currentUser.email}). Cette zone est strictement séparée de la vue client et
                vérifiée côté serveur.
              </p>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[#243147] flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onReturnToClientPortal}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#151F31] hover:bg-[#1B2840] border border-[#243147] text-xs font-medium text-[#F2F6FF] cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-[#45D7F4]" />
              Retour au Portail Client
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold cursor-pointer transition-colors"
            >
              Changer de compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-110px)] bg-[#070B14] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#243147] bg-[#101827] p-7 shadow-2xl">
        <div className="flex items-center gap-3.5 mb-6">
          <img
            src="/assets/aistudio/image_745e91e4.png"
            alt="JUST TECH SERVICES"
            className="w-11 h-11 rounded-xl object-cover border border-[#E5B84B]/45 bg-[#070B14] shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#E5B84B] shrink-0" />
              <span className="text-[11px] font-mono-tabular uppercase tracking-wider text-[#E5B84B]">
                {isAdminZone ? 'Zone Staff Isolée · /admin' : 'Zone Partenaire · /reseller'}
              </span>
            </div>
            <h1 className="font-display text-lg font-semibold text-[#F2F6FF] mt-0.5 truncate">
              {title}
            </h1>
          </div>
        </div>

        <p className="text-xs text-[#8D9AAF] leading-relaxed mb-6">{subtitle}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8D9AAF] mb-1.5">
              Adresse e-mail professionnelle
            </label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                isAdminZone
                  ? 'huguesjustin58@gmail.com'
                  : 'reseller@justtechservices.xyz'
              }
              className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3.5 py-2.5 text-sm text-[#F2F6FF] placeholder-[#8D9AAF]/50 focus:border-[#45D7F4] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8D9AAF] mb-1.5">
              Mot de passe
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3.5 py-2.5 text-sm text-[#F2F6FF] placeholder-[#8D9AAF]/50 focus:border-[#45D7F4] focus:outline-none"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3.5 py-2.5 text-xs text-[#EF4444]"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-60 text-[#070B14] text-sm font-semibold cursor-pointer transition-colors"
          >
            <Lock className="w-4 h-4" />
            {submitting ? 'Vérification serveur...' : 'Ouvrir la session sécurisée'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#243147] flex items-center justify-between text-xs">
          <span className="text-[#8D9AAF]">Session signée HMAC-SHA256</span>
          <button
            type="button"
            onClick={onReturnToClientPortal}
            className="inline-flex items-center gap-1.5 text-[#45D7F4] hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Portail Client
          </button>
        </div>
      </div>
    </div>
  );
};
