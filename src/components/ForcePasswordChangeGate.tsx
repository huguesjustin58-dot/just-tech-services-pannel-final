import React, { FormEvent, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { changeAccountPassword } from '../services/authClient';
import { AuthenticatedUser, ROLE_LABELS } from '../types/panel';

interface ForcePasswordChangeGateProps {
  user: AuthenticatedUser;
  onPasswordChanged: (updatedUser: AuthenticatedUser) => void;
  onLogout: () => Promise<void>;
}

export const ForcePasswordChangeGate: React.FC<ForcePasswordChangeGateProps> = ({
  user,
  onPasswordChanged,
  onLogout,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMinLen = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasDigitOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(newPassword);
  const differsFromCurrent = newPassword.length > 0 && newPassword !== currentPassword;
  const matchesConfirm = newPassword.length > 0 && newPassword === confirmPassword;

  const canSubmit =
    !submitting &&
    currentPassword.length > 0 &&
    hasMinLen &&
    hasUpper &&
    hasLower &&
    hasDigitOrSymbol &&
    differsFromCurrent &&
    matchesConfirm;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!matchesConfirm) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await changeAccountPassword(currentPassword, newPassword, confirmPassword);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onPasswordChanged(result.user);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-110px)] bg-[#070B14] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-[#E5B84B]/45 bg-[#101827] p-7 shadow-2xl space-y-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-[#E5B84B]/15 border border-[#E5B84B]/40 text-[#E5B84B] shrink-0">
            <KeyRound className="w-6 h-6" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-mono-tabular uppercase tracking-wider text-[#E5B84B]">
              Sécurité Première Connexion · {ROLE_LABELS[user.role]}
            </p>
            <h1 className="font-display text-xl font-semibold text-[#F2F6FF]">
              Changement de mot de passe obligatoire
            </h1>
            <p className="text-xs text-[#8D9AAF] leading-relaxed">
              Connecté en tant que <strong className="text-[#45D7F4]">{user.email}</strong>. Pour activer
              votre accès complet {ROLE_LABELS[user.role]}, veuillez remplacer le mot de passe initial par
              un mot de passe personnel sécurisé.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8D9AAF] mb-1.5">
              Mot de passe initial actuel
            </label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Saisissez votre mot de passe initial"
                className="w-full rounded-lg border border-[#243147] bg-[#070B14] pl-3.5 pr-10 py-2.5 text-sm text-[#F2F6FF] placeholder-[#8D9AAF]/50 focus:border-[#45D7F4] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? 'Masquer' : 'Afficher'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8D9AAF] mb-1.5">
              Nouveau mot de passe sécurisé
            </label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 caractères (Maj, min, chiffre/symbole)"
                className="w-full rounded-lg border border-[#243147] bg-[#070B14] pl-3.5 pr-10 py-2.5 text-sm text-[#F2F6FF] placeholder-[#8D9AAF]/50 focus:border-[#45D7F4] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Masquer' : 'Afficher'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#8D9AAF] mb-1.5">
              Confirmer le nouveau mot de passe
            </label>
            <input
              type={showNew ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Répétez le nouveau mot de passe"
              className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3.5 py-2.5 text-sm text-[#F2F6FF] placeholder-[#8D9AAF]/50 focus:border-[#45D7F4] focus:outline-none"
            />
          </div>

          {/* Critères de robustesse */}
          <div className="rounded-xl border border-[#243147] bg-[#070B14] p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            {[
              { ok: hasMinLen, label: '8 caractères minimum' },
              { ok: hasUpper && hasLower, label: 'Majuscule + minuscule' },
              { ok: hasDigitOrSymbol, label: 'Chiffre ou symbole (@, #, !...)' },
              { ok: differsFromCurrent && matchesConfirm, label: 'Différent de l’initial & confirmé' },
            ].map((rule) => (
              <div
                key={rule.label}
                className={`flex items-center gap-1.5 ${
                  rule.ok ? 'text-[#45D7F4]' : 'text-[#8D9AAF]'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{rule.label}</span>
              </div>
            ))}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3.5 py-2.5 text-xs text-[#EF4444] flex items-center gap-2"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => void onLogout()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Déconnexion
            </button>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-50 text-[#070B14] text-xs font-semibold cursor-pointer transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              {submitting ? 'Mise à jour sécurisée...' : 'Enregistrer et accéder à la console'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ForcePasswordChangeGate;
