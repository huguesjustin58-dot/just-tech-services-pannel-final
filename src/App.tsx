/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Copy, Eye, EyeOff, LogIn, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { AdminAuthGate } from './components/AdminAuthGate';
import { AdminWorkspace } from './components/AdminWorkspace';
import { ClientWorkspace } from './components/ClientWorkspace';
import { DesignSystemView } from './components/DesignSystemView';
import { ForcePasswordChangeGate } from './components/ForcePasswordChangeGate';
import { GlobalStatusBar } from './components/GlobalStatusBar';
import { NotificationsCenter } from './components/NotificationsCenter';
import { ProtectedRoleWrapper } from './components/ProtectedRoleWrapper';
import { ResellerWorkspace } from './components/ResellerWorkspace';
import { INITIAL_CLOUD_CODES, INITIAL_NPV_PROTOTYPE } from './data/maquetteData';
import {
  fetchCurrentSession,
  loginWithCredentials,
  logoutSession,
} from './services/authClient';
import {
  ADMIN_STAFF_ROLES,
  AuthenticatedUser,
  CloudActivationRecord,
  NpvPrototype,
  RESELLER_ZONE_ROLES,
  ROLE_LABELS,
  RoleWorkspace,
  SessionRole,
} from './types/panel';

type AppRouteZone = 'client' | 'admin' | 'reseller';

function resolveZoneFromPath(pathname: string): AppRouteZone {
  const clean = pathname.toLowerCase();
  if (clean === '/admin' || clean.startsWith('/admin/')) {
    return 'admin';
  }
  if (clean === '/reseller' || clean.startsWith('/reseller/')) {
    return 'reseller';
  }
  return 'client';
}

const CSS_TOKENS_EXPORT = `:root {
  --jts-night: #070B14;
  --jts-panel: #101827;
  --jts-panel-raised: #151F31;
  --jts-gold: #E5B84B;
  --jts-gold-hover: #D4A136;
  --jts-platinum: #E8EEF5;
  --jts-cyan: #45D7F4;
  --jts-blue: #547CFF;
  --jts-muted: #8D9AAF;
  --jts-white: #F2F6FF;
  --jts-stroke: #243147;
}`;

interface RoleNavLink {
  id: RoleWorkspace;
  label: string;
  allowedRoles: readonly SessionRole[];
}

const ADMIN_NAV_LINKS: readonly RoleNavLink[] = [
  { id: 'admin', label: 'Console Admin', allowedRoles: ['super_admin', 'admin', 'manager'] },
  { id: 'design-system', label: 'Design System', allowedRoles: ['super_admin', 'admin'] },
];

export default function App() {
  const [routeZone, setRouteZone] = useState<AppRouteZone>(() =>
    resolveZoneFromPath(window.location.pathname)
  );
  // Source unique et autoritaire du rôle : session vérifiée côté serveur (/api/auth/me)
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [adminDesignSystemOpen, setAdminDesignSystemOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tokensCopied, setTokensCopied] = useState(false);

  // Modale de connexion Portail Client (sans exposer d'accès admin dans le DOM client)
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [npvPrototype, setNpvPrototype] = useState<NpvPrototype>(INITIAL_NPV_PROTOTYPE);
  const [cloudCodes, setCloudCodes] = useState<CloudActivationRecord[]>(INITIAL_CLOUD_CODES);

  const effectiveRole: SessionRole = authUser?.role ?? 'client';
  const isAuthorizedAdminStaff = Boolean(authUser && ADMIN_STAFF_ROLES.includes(authUser.role));
  const isAuthorizedReseller = Boolean(authUser && RESELLER_ZONE_ROLES.includes(authUser.role));

  const navigateToZone = (zone: AppRouteZone) => {
    const targetPath = zone === 'admin' ? '/admin' : zone === 'reseller' ? '/reseller' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setRouteZone(zone);
    setAdminDesignSystemOpen(false);
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    let active = true;
    void fetchCurrentSession().then((user) => {
      if (!active) return;
      setAuthUser(user);
      setSessionLoading(false);
    });

    const onPopState = () => {
      setRouteZone(resolveZoneFromPath(window.location.pathname));
      setAdminDesignSystemOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      active = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    if (!authUser || (authUser.role !== 'super_admin' && authUser.role !== 'admin')) {
      setAdminDesignSystemOpen(false);
    }
  }, [authUser]);

  const handleGenerateCloudCode = (
    clientName: string,
    planName: string,
    sshUsername: string,
    explicitCode?: string
  ): CloudActivationRecord => {
    const seg1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const seg2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const created: CloudActivationRecord = {
      id: `cld-${Date.now()}`,
      code: explicitCode || `JTS-CLD-${seg1}-${seg2}`,
      clientName,
      planName,
      sshUsername,
      serverCode: 'VPS-CM-01',
      status: 'Prêt',
      createdAt: "À l'instant",
    };
    setCloudCodes((prev) => [created, ...prev]);
    return created;
  };

  const handleRevokeCloudCode = (id: string) => {
    setCloudCodes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'Révoqué' } : c))
    );
  };

  const handleCopyTokens = () => {
    navigator.clipboard?.writeText(CSS_TOKENS_EXPORT);
    setTokensCopied(true);
    setTimeout(() => setTokensCopied(false), 1800);
  };

  const handleAuthenticatedUser = (user: AuthenticatedUser) => {
    setAuthUser(user);
    setAuthModalOpen(false);
    setAuthPassword('');
    setAuthError(null);

    if (ADMIN_STAFF_ROLES.includes(user.role)) {
      navigateToZone('admin');
    } else if (RESELLER_ZONE_ROLES.includes(user.role)) {
      navigateToZone('reseller');
    } else {
      navigateToZone('client');
    }
  };

  const handleClientModalLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const email = authEmail.trim().toLowerCase();
    const password = authPassword;

    if (!email || !password) {
      setAuthError('Veuillez renseigner votre adresse e-mail et votre mot de passe.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const result = await loginWithCredentials(email, password);
      if (!result.ok) {
        setAuthError(result.error);
        return;
      }
      handleAuthenticatedUser(result.user);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logoutSession();
    setAuthUser(null);
    setAdminDesignSystemOpen(false);
    setMobileMenuOpen(false);
    if (routeZone !== 'client') {
      navigateToZone('client');
    }
  };

  // Liens de navigation strictement cloisonnés par zone & rôle serveur
  const visibleAdminLinks =
    routeZone === 'admin' && isAuthorizedAdminStaff
      ? ADMIN_NAV_LINKS.filter((link) => link.allowedRoles.includes(effectiveRole))
      : [];

  return (
    <div className="min-h-screen bg-[#070B14] text-[#F2F6FF] flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 bg-[#070B14]/95 backdrop-blur border-b border-[#243147]">
        <div className="px-5 lg:px-7 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand mark with official logo + single-line wordmark */}
          <button
            type="button"
            onClick={() => {
              if (routeZone === 'admin' && isAuthorizedAdminStaff) {
                setAdminDesignSystemOpen(false);
              } else {
                navigateToZone('client');
              }
            }}
            className="flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer group"
          >
            <img
              src="/assets/aistudio/image_745e91e4.png"
              alt="Logo JUST TECH SERVICES"
              className="w-9 h-9 rounded-lg object-cover border border-[#E5B84B]/45 bg-[#101827] shrink-0"
            />
            <span className="font-display text-base lg:text-lg font-bold tracking-tight text-[#F2F6FF] group-hover:text-[#E5B84B] transition-colors">
              JUST TECH SERVICES
            </span>
          </button>

          {/* Zone 2: Navigation strictement isolée — la vue Client ne contient jamais de liens Admin */}
          <nav className="hidden md:flex items-center gap-6">
            {routeZone === 'client' && (
              <span className="py-2 text-sm font-medium text-[#E5B84B] border-b-2 border-[#E5B84B] whitespace-nowrap shrink-0">
                Portail Client
              </span>
            )}

            {routeZone === 'reseller' && isAuthorizedReseller && (
              <span className="py-2 text-sm font-medium text-[#E5B84B] border-b-2 border-[#E5B84B] whitespace-nowrap shrink-0">
                Espace Revendeur
              </span>
            )}

            {routeZone === 'admin' &&
              isAuthorizedAdminStaff &&
              visibleAdminLinks.map((link) => {
                const isActive =
                  link.id === 'design-system'
                    ? adminDesignSystemOpen
                    : !adminDesignSystemOpen && link.id === 'admin';
                return (
                  <ProtectedRoleWrapper
                    key={link.id}
                    sessionRole={effectiveRole}
                    allowedRoles={link.allowedRoles}
                  >
                    <button
                      type="button"
                      onClick={() => setAdminDesignSystemOpen(link.id === 'design-system')}
                      className={`py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                        isActive
                          ? 'text-[#E5B84B] border-[#E5B84B]'
                          : 'text-[#8D9AAF] border-transparent hover:text-[#E5B84B] hover:border-[#E5B84B]/40'
                      }`}
                    >
                      {link.label}
                    </button>
                  </ProtectedRoleWrapper>
                );
              })}
          </nav>

          {/* Zone 3: Session authentication + protected admin tools (exclusivement dans /admin) */}
          <div className="flex items-center gap-3 shrink-0">
            {routeZone === 'admin' && isAuthorizedAdminStaff && (
              <ProtectedRoleWrapper
                sessionRole={effectiveRole}
                allowedRoles={['super_admin', 'admin']}
              >
                <button
                  type="button"
                  onClick={handleCopyTokens}
                  className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-[#101827] hover:bg-[#151F31] border border-[#E5B84B]/40 text-xs font-medium text-[#F2F6FF] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {tokensCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#E5B84B]" />
                      Tokens copiés
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#E5B84B]" />
                      Copier Tokens CSS
                    </>
                  )}
                </button>
              </ProtectedRoleWrapper>
            )}

            {isAuthorizedAdminStaff && (routeZone === 'admin' || routeZone === 'client') && (
              <button
                type="button"
                onClick={() => navigateToZone(routeZone === 'admin' ? 'client' : 'admin')}
                className="inline-flex items-center gap-2 px-3 py-2 bg-[#101827] hover:bg-[#151F31] border border-[#45D7F4]/40 text-xs font-semibold text-[#45D7F4] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                aria-label={routeZone === 'admin' ? 'Ouvrir le portail client' : 'Retourner à l’administration'}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                {routeZone === 'admin' ? 'Portail client' : 'Administration'}
              </button>
            )}

            {authUser && (
              <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#101827] border border-[#243147] text-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-[#45D7F4]" />
                <span className="text-[#F2F6FF] font-medium max-w-[140px] truncate">
                  {authUser.name}
                </span>
                <span className="text-[#E5B84B] font-mono-tabular">
                  {ROLE_LABELS[authUser.role]}
                </span>
              </div>
            )}

            {!authUser ? (
              routeZone === 'client' ? (
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null);
                    setAuthModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#101827] hover:bg-[#151F31] border border-[#45D7F4]/40 text-xs font-medium text-[#F2F6FF] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#45D7F4]" />
                  Connexion
                </button>
              ) : null
            ) : (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#101827] hover:bg-[#151F31] border border-[#243147] text-xs font-medium text-[#8D9AAF] hover:text-[#F2F6FF] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 text-[#E5B84B]" />
                Déconnexion
              </button>
            )}

            {routeZone === 'admin' && isAuthorizedAdminStaff && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen((o) => !o)}
                className="md:hidden p-2 text-[#8D9AAF] hover:text-[#F2F6FF] border border-[#243147] rounded-lg"
                aria-label="Ouvrir le menu de navigation"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Nav Drawer (Staff Admin uniquement) */}
        {mobileMenuOpen && routeZone === 'admin' && isAuthorizedAdminStaff && (
          <div className="md:hidden border-t border-[#243147] bg-[#101827] px-5 py-3 flex flex-col gap-1">
            {visibleAdminLinks.map((link) => {
              const isActive =
                link.id === 'design-system'
                  ? adminDesignSystemOpen
                  : !adminDesignSystemOpen && link.id === 'admin';
              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => {
                    setAdminDesignSystemOpen(link.id === 'design-system');
                    setMobileMenuOpen(false);
                  }}
                  className={`text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive
                      ? 'bg-[#151F31] text-[#E5B84B]'
                      : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Floating Top-Right Notifications Center (Staff / Reseller authentifiés uniquement) */}
      {(isAuthorizedAdminStaff || isAuthorizedReseller) && routeZone !== 'client' && (
        <NotificationsCenter />
      )}

      {/* Active Workspace Viewport — séparation stricte entre /, /admin et /reseller */}
      <div className="flex-1">
        {authUser?.mustChangePassword ? (
          <ForcePasswordChangeGate
            user={authUser}
            onPasswordChanged={(updatedUser) => {
              setAuthUser(updatedUser);
              if (ADMIN_STAFF_ROLES.includes(updatedUser.role)) {
                navigateToZone('admin');
              } else if (RESELLER_ZONE_ROLES.includes(updatedUser.role)) {
                navigateToZone('reseller');
              }
            }}
            onLogout={handleLogout}
          />
        ) : (
          <>
            {routeZone === 'client' && (
              <ClientWorkspace
                currentUser={authUser}
                npvPrototype={npvPrototype}
                latestCloudCode={cloudCodes.find((c) => c.status !== 'Révoqué') ?? null}
                onGenerateCloudCode={handleGenerateCloudCode}
              />
            )}

            {routeZone === 'admin' &&
              (sessionLoading ? (
                <div className="min-h-[calc(100vh-110px)] flex items-center justify-center text-xs text-[#8D9AAF]">
                  Vérification de la session d&apos;administration...
                </div>
              ) : isAuthorizedAdminStaff && authUser ? (
                <ProtectedRoleWrapper
                  sessionRole={authUser.role}
                  allowedRoles={ADMIN_STAFF_ROLES}
                >
                  {adminDesignSystemOpen &&
                  (authUser.role === 'super_admin' || authUser.role === 'admin') ? (
                    <DesignSystemView />
                  ) : (
                    <AdminWorkspace
                      currentUser={authUser}
                      npvPrototype={npvPrototype}
                      onUpdateNpvPrototype={setNpvPrototype}
                      cloudCodes={cloudCodes}
                      onRevokeCloudCode={handleRevokeCloudCode}
                      onGenerateCloudCode={handleGenerateCloudCode}
                    />
                  )}
                </ProtectedRoleWrapper>
              ) : (
                <AdminAuthGate
                  zone="admin"
                  currentUser={authUser}
                  onAuthenticated={handleAuthenticatedUser}
                  onReturnToClientPortal={() => navigateToZone('client')}
                  onLogout={handleLogout}
                />
              ))}

            {routeZone === 'reseller' &&
              (sessionLoading ? (
                <div className="min-h-[calc(100vh-110px)] flex items-center justify-center text-xs text-[#8D9AAF]">
                  Vérification de la session revendeur...
                </div>
              ) : isAuthorizedReseller && authUser ? (
                <ProtectedRoleWrapper
                  sessionRole={authUser.role}
                  allowedRoles={RESELLER_ZONE_ROLES}
                >
                  <ResellerWorkspace
                    currentUser={authUser}
                    npvPrototype={npvPrototype}
                    onGenerateCloudCode={handleGenerateCloudCode}
                  />
                </ProtectedRoleWrapper>
              ) : (
                <AdminAuthGate
                  zone="reseller"
                  currentUser={authUser}
                  onAuthenticated={handleAuthenticatedUser}
                  onReturnToClientPortal={() => navigateToZone('client')}
                  onLogout={handleLogout}
                />
              ))}
          </>
        )}
      </div>

      {/* Modale de connexion standard (Portail Client — zéro fuite de route admin) */}
      {authModalOpen && routeZone === 'client' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Connexion à votre compte JUST TECH SERVICES"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B14]/80 backdrop-blur-sm px-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#243147] bg-[#101827] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#F2F6FF]">
                  Connexion Compte
                </h2>
                <p className="text-xs text-[#8D9AAF] mt-0.5">
                  Identifiez-vous pour accéder à votre espace personnel.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="p-1.5 text-[#8D9AAF] hover:text-[#F2F6FF] rounded-lg"
                aria-label="Fermer la fenêtre de connexion"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleClientModalLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#8D9AAF] mb-1">
                  Adresse e-mail
                </label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="client@justtechservices.xyz"
                  className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3 py-2 text-sm text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#8D9AAF] mb-1">
                  Mot de passe
                </label>
                <div className="relative">
                  <input
                    type={showAuthPassword ? 'text' : 'password'}
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-lg border border-[#243147] bg-[#070B14] px-3 py-2 pr-10 text-sm text-[#F2F6FF] focus:border-[#45D7F4] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAuthPassword((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-[#8D9AAF] hover:text-[#F2F6FF]"
                    aria-label={showAuthPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    aria-pressed={showAuthPassword}
                  >
                    {showAuthPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {authError && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                  {authError}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-[#8D9AAF] hover:text-[#F2F6FF] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] disabled:opacity-60 text-[#070B14] text-xs font-semibold cursor-pointer transition-colors"
                >
                  {authSubmitting ? 'Connexion...' : 'Se connecter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Real-Time Infrastructure Status Bar */}
      <GlobalStatusBar />
    </div>
  );
}
