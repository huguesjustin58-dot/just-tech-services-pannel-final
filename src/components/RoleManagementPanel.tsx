import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Check,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { authFetch } from '../services/authClient';
import {
  AuthenticatedUser,
  ManagedUserRecord,
  ROLE_LABELS,
  SecurityAuditEvent,
  SessionRole,
} from '../types/panel';

interface RoleManagementPanelProps {
  currentUser: AuthenticatedUser;
  onNotify: (msg: string) => void;
}

const ALL_SIX_ROLES: readonly SessionRole[] = [
  'super_admin',
  'admin',
  'manager',
  'reseller',
  'sub_reseller',
  'client',
];

const ROLE_SCOPE_SUMMARY: Record<
  SessionRole,
  {
    zone: string;
    capabilities: string;
    accentClass: string;
  }
> = {
  super_admin: {
    zone: '/admin (Complet)',
    capabilities: 'Autorité totale : Infrastructure, Templates SSH, Cloud Configs, Rôles Super Admin/Admin, Audit.',
    accentClass: 'text-[#E5B84B] border-[#E5B84B]/40 bg-[#E5B84B]/10',
  },
  admin: {
    zone: '/admin (Gestion)',
    capabilities: 'Licences, Revendeurs, Serveurs, Templates SSH, Cloud Configs et comptes Manager/Revendeurs/Client.',
    accentClass: 'text-[#45D7F4] border-[#45D7F4]/40 bg-[#45D7F4]/10',
  },
  manager: {
    zone: '/admin (Opérations)',
    capabilities: 'Licences, Cloud Configs clients (≤ 100 Go), Paiements FCFA, Factures et Support (sans Infrastructure).',
    accentClass: 'text-[#547CFF] border-[#547CFF]/40 bg-[#547CFF]/10',
  },
  reseller: {
    zone: '/reseller (Isolé)',
    capabilities: 'Stock Gigas, sous-revendeurs et Cloud Configs depuis Templates (≤ 60 Go) pour ses propres clients.',
    accentClass: 'text-[#E8EEF5] border-[#243147] bg-[#151F31]',
  },
  sub_reseller: {
    zone: '/reseller (Restreint)',
    capabilities: 'Cloud Configs depuis Templates verrouillés (≤ 25 Go) uniquement pour ses propres clients.',
    accentClass: 'text-[#45D7F4] border-[#243147] bg-[#0B1220]',
  },
  client: {
    zone: '/ (Portail Client)',
    capabilities: 'Souscription forfaits, Agent IA paiement, import via Code Cloud JTS-XXXX-XXXX / QR Code.',
    accentClass: 'text-[#8D9AAF] border-[#243147] bg-[#070B14]',
  },
};

export const RoleManagementPanel: React.FC<RoleManagementPanelProps> = ({
  currentUser,
  onNotify,
}) => {
  const [users, setUsers] = useState<ManagedUserRecord[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<SessionRole>('manager');
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = currentUser.role === 'super_admin';
  const assignableRoles: SessionRole[] = isSuperAdmin
    ? ['super_admin', 'admin', 'manager', 'reseller', 'sub_reseller', 'client']
    : ['manager', 'reseller', 'sub_reseller', 'client'];

  const loadRbacData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, logsRes] = await Promise.all([
        authFetch('/api/admin/users', { cache: 'no-store' }),
        authFetch('/api/admin/security-logs', { cache: 'no-store' }),
      ]);

      if (!usersRes.ok) {
        const errData = (await usersRes.json().catch(() => ({}))) as { error?: string };
        setError(errData.error || 'Impossible de charger les comptes RBAC.');
        return;
      }

      const usersData = (await usersRes.json()) as { users: ManagedUserRecord[] };
      setUsers(usersData.users ?? []);

      if (logsRes.ok) {
        const logsData = (await logsRes.json()) as { logs: SecurityAuditEvent[] };
        setSecurityLogs(logsData.logs ?? []);
      }
    } catch {
      setError('Erreur réseau lors du chargement des rôles serveur.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRbacData();
  }, [loadRbacData]);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const data = (await res.json()) as { user?: ManagedUserRecord; error?: string };
      if (!res.ok || !data.user) {
        setError(data.error || 'Création refusée par le serveur.');
        return;
      }
      setShowCreateModal(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('manager');
      onNotify(`Compte ${data.user.email} créé avec le rôle ${ROLE_LABELS[data.user.role]}.`);
      await loadRbacData();
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (target: ManagedUserRecord, nextRole: SessionRole) => {
    if (nextRole === target.role) return;
    setError(null);
    const res = await authFetch(`/api/admin/users/${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nextRole }),
    });
    const data = (await res.json()) as { user?: ManagedUserRecord; error?: string };
    if (!res.ok || !data.user) {
      setError(data.error || 'Modification du rôle refusée.');
      return;
    }
    onNotify(
      `Rôle mis à jour pour ${data.user.email} : ${ROLE_LABELS[data.user.role]} (sessions précédentes révoquées).`
    );
    await loadRbacData();
  };

  const handleToggleActive = async (target: ManagedUserRecord) => {
    setError(null);
    const res = await authFetch(`/api/admin/users/${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !target.isActive }),
    });
    const data = (await res.json()) as { user?: ManagedUserRecord; error?: string };
    if (!res.ok || !data.user) {
      setError(data.error || 'Changement de statut refusé.');
      return;
    }
    onNotify(
      data.user.isActive
        ? `Compte ${data.user.email} réactivé.`
        : `Compte ${data.user.email} suspendu et sessions révoquées.`
    );
    await loadRbacData();
  };

  return (
    <div className="space-y-6">
      {/* Matrice des 5 rôles */}
      <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F2F6FF] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#E5B84B]" />
              Matrice RBAC — 6 Rôles &amp; Isolation Stricte
            </h2>
            <p className="text-xs text-[#8D9AAF] mt-0.5">
              Vérification cryptographique côté serveur (cookie HttpOnly + Bearer HMAC-SHA256).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadRbacData()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#151F31] hover:bg-[#1B2840] border border-[#243147] text-xs font-medium text-[#F2F6FF] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#45D7F4] ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Nouveau compte
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {ALL_SIX_ROLES.map((role) => {
            const meta = ROLE_SCOPE_SUMMARY[role];
            const count = users.filter((u) => u.role === role).length;
            return (
              <div
                key={role}
                className="rounded-xl border border-[#243147] bg-[#070B14] p-3.5 flex flex-col justify-between gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${meta.accentClass}`}
                  >
                    {ROLE_LABELS[role]}
                  </span>
                  <span className="font-mono-tabular text-xs text-[#8D9AAF]">
                    {count} compte{count > 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-[11px] font-mono-tabular text-[#45D7F4]">{meta.zone}</p>
                <p className="text-xs text-[#8D9AAF] leading-relaxed">{meta.capabilities}</p>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 text-xs text-[#EF4444]"
        >
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table des comptes & rôles */}
      <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#243147] flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#F2F6FF]">
              Comptes & Attribution des Rôles
            </h3>
            <p className="text-xs text-[#8D9AAF] mt-0.5">
              Toute modification de rôle ou suspension révoque immédiatement les sessions actives.
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-[#45D7F4]">
            Connecté : {ROLE_LABELS[currentUser.role]}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#070B14] text-[#8D9AAF] border-b border-[#243147]">
              <tr>
                <th className="px-5 py-3 font-medium">Utilisateur</th>
                <th className="px-4 py-3 font-medium">Rôle RBAC</th>
                <th className="px-4 py-3 font-medium">Zone autorisée</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Dernière connexion</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#243147]/70">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                const lockedByHierarchy =
                  !isSuperAdmin && (u.role === 'super_admin' || u.role === 'admin');
                const canModify = !isSelf && !lockedByHierarchy;

                return (
                  <tr key={u.id} className="hover:bg-[#151F31]/40">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-[#F2F6FF]">
                        {u.name}{' '}
                        {isSelf && (
                          <span className="ml-1.5 text-[10px] font-mono-tabular text-[#E5B84B]">
                            (Vous)
                          </span>
                        )}
                      </p>
                      <p className="text-[#8D9AAF] font-mono-tabular">{u.email}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      {canModify ? (
                        <select
                          aria-label={`Rôle de ${u.email}`}
                          value={u.role}
                          onChange={(e) => void handleRoleChange(u, e.target.value as SessionRole)}
                          className="rounded-lg border border-[#243147] bg-[#070B14] px-2.5 py-1.5 text-xs text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                        >
                          {assignableRoles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-semibold ${ROLE_SCOPE_SUMMARY[u.role].accentClass}`}
                        >
                          <Lock className="w-3 h-3" />
                          {ROLE_LABELS[u.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono-tabular text-[#45D7F4]">
                      {ROLE_SCOPE_SUMMARY[u.role].zone}
                    </td>
                    <td className="px-4 py-3.5">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 text-[#45D7F4] font-medium">
                          <Check className="w-3.5 h-3.5" />
                          Actif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#EF4444] font-medium">
                          <X className="w-3.5 h-3.5" />
                          Suspendu
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono-tabular text-[#8D9AAF]">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Jamais'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {canModify ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(u)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                            u.isActive
                              ? 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20'
                              : 'border-[#45D7F4]/40 bg-[#45D7F4]/10 text-[#45D7F4] hover:bg-[#45D7F4]/20'
                          }`}
                        >
                          {u.isActive ? (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              Suspendre
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              Réactiver
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#8D9AAF]">Protégé</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Journal d'audit sécurité serveur */}
      <div className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#243147] flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-[#F2F6FF] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#45D7F4]" />
            Journal d'Audit Sécurité RBAC (Serveur)
          </h3>
          <span className="font-mono-tabular text-xs text-[#8D9AAF]">
            {securityLogs.length} événement{securityLogs.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="divide-y divide-[#243147]/60 max-h-72 overflow-y-auto">
          {securityLogs.length === 0 ? (
            <p className="px-5 py-6 text-xs text-[#8D9AAF]">
              Aucun événement de sécurité enregistré pour cette session serveur.
            </p>
          ) : (
            securityLogs.map((log) => (
              <div
                key={log.id}
                className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono-tabular text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        log.outcome === 'ALLOWED'
                          ? 'text-[#45D7F4] border-[#45D7F4]/30 bg-[#45D7F4]/10'
                          : 'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/10'
                      }`}
                    >
                      {log.outcome}
                    </span>
                    <span className="font-mono-tabular text-[#F2F6FF]">{log.action}</span>
                    <span className="text-[#8D9AAF]">· {log.actorEmail}</span>
                  </div>
                  <p className="text-[#8D9AAF]">{log.detail}</p>
                </div>
                <span className="font-mono-tabular text-[11px] text-[#8D9AAF]">
                  {new Date(log.timestamp).toLocaleTimeString('fr-FR')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modale de création de compte */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Créer un compte utilisateur"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B14]/80 backdrop-blur-sm px-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#243147] bg-[#101827] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
                  Nouveau compte RBAC
                </h3>
                <p className="text-xs text-[#8D9AAF] mt-0.5">
                  Mot de passe haché côté serveur (scrypt + sel unique).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-[#8D9AAF] hover:text-[#F2F6FF] rounded-lg"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Nom complet</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Samuel Eto'o"
                  className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3 py-2 text-sm text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Adresse e-mail</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="manager2@justtechservices.xyz"
                  className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3 py-2 text-sm text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">
                  Mot de passe (8 caractères min.)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3 py-2 text-sm text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">Rôle attribué</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as SessionRole)}
                  className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3 py-2 text-sm text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]} — {ROLE_SCOPE_SUMMARY[r].zone}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-60 text-[#070B14] text-xs font-semibold cursor-pointer"
                >
                  {saving ? 'Création...' : 'Créer le compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
