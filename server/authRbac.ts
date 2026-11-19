import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';

export type SessionRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'reseller'
  | 'sub_reseller'
  | 'client';

export type RbacPermission =
  | 'admin.access'
  | 'roles.manage'
  | 'roles.assign_super_admin'
  | 'servers.manage'
  | 'configs.manage'
  | 'cloud.templates.manage'
  | 'cloud.configs.create'
  | 'cloud.configs.revoke_all'
  | 'cloud.configs.revoke_own'
  | 'payments.manage'
  | 'payments.gateway_config'
  | 'resellers.manage'
  | 'licenses.manage'
  | 'tickets.manage'
  | 'design_system.view'
  | 'reseller.access'
  | 'client.access';

export const VALID_ROLES: readonly SessionRole[] = [
  'super_admin',
  'admin',
  'manager',
  'reseller',
  'sub_reseller',
  'client',
];

export const ADMIN_STAFF_ROLES: readonly SessionRole[] = ['super_admin', 'admin', 'manager'];
export const RESELLER_ZONE_ROLES: readonly SessionRole[] = ['reseller', 'sub_reseller'];

export const ROLE_PERMISSIONS: Record<SessionRole, RbacPermission[]> = {
  super_admin: [
    'admin.access',
    'roles.manage',
    'roles.assign_super_admin',
    'servers.manage',
    'configs.manage',
    'cloud.templates.manage',
    'cloud.configs.create',
    'cloud.configs.revoke_all',
    'cloud.configs.revoke_own',
    'payments.manage',
    'payments.gateway_config',
    'resellers.manage',
    'licenses.manage',
    'tickets.manage',
    'design_system.view',
  ],
  admin: [
    'admin.access',
    'roles.manage',
    'servers.manage',
    'configs.manage',
    'cloud.templates.manage',
    'cloud.configs.create',
    'cloud.configs.revoke_all',
    'cloud.configs.revoke_own',
    'payments.manage',
    'payments.gateway_config',
    'resellers.manage',
    'licenses.manage',
    'tickets.manage',
    'design_system.view',
  ],
  manager: [
    'admin.access',
    'licenses.manage',
    'cloud.configs.create',
    'cloud.configs.revoke_all',
    'cloud.configs.revoke_own',
    'payments.manage',
    'tickets.manage',
  ],
  reseller: ['reseller.access', 'cloud.configs.create', 'cloud.configs.revoke_own'],
  sub_reseller: ['reseller.access', 'cloud.configs.create', 'cloud.configs.revoke_own'],
  client: ['client.access'],
};

interface InternalUserRecord {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  salt: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PublicUserRecord {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  isActive: boolean;
  mustChangePassword: boolean;
  permissions: RbacPermission[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SecurityAuditEvent {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: SessionRole | 'anonymous';
  action: string;
  target: string;
  outcome: 'ALLOWED' | 'DENIED';
  detail: string;
}

interface ActiveSession {
  tokenId: string;
  userId: string;
  expiresAt: number;
}

export interface AuthenticatedRequest extends Request {
  authUser?: PublicUserRecord | null;
  authTokenId?: string | null;
}

const SESSION_COOKIE_NAME = 'jts_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 heures
const INTERNAL_SESSION_KEY = crypto.randomBytes(32).toString('hex');

function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const effectiveSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, effectiveSalt, 64).toString('hex');
  return { salt: effectiveSalt, hash: derived };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function signSessionToken(tokenId: string, userId: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ tid: tokenId, uid: userId, exp: expiresAt })).toString('base64url');
  const sig = crypto.createHmac('sha256', INTERNAL_SESSION_KEY).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(rawToken: string): { tid: string; uid: string; exp: number } | null {
  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', INTERNAL_SESSION_KEY).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tid: string;
      uid: string;
      exp: number;
    };
    if (!decoded.tid || !decoded.uid || typeof decoded.exp !== 'number') return null;
    if (decoded.exp <= Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

export class RbacAuthService {
  private readonly users = new Map<string, InternalUserRecord>();
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly securityLogs: SecurityAuditEvent[] = [];
  private readonly stateFilePath = path.resolve(process.cwd(), 'data', 'auth-state.json');

  constructor() {
    this.seedDefaultAccounts();
    this.loadPersistedOverrides();
  }

  private seedDefaultAccounts() {
    const defaults: Array<{
      id: string;
      name: string;
      email: string;
      role: SessionRole;
      password: string;
      mustChangePassword: boolean;
    }> = [
      {
        id: 'usr-superadmin',
        name: 'Justin Hugues (Super Admin)',
        email: (process.env.JTS_SUPERADMIN_EMAIL || 'huguesjustin58@gmail.com').toLowerCase(),
        role: 'super_admin',
        password: process.env.JTS_SUPERADMIN_PASSWORD || '@Moddingjust',
        mustChangePassword: true,
      },
      {
        id: 'usr-admin',
        name: 'Aline Nguema (Admin)',
        email: (process.env.JTS_ADMIN_EMAIL || 'admin@justtechservices.xyz').toLowerCase(),
        role: 'admin',
        password: process.env.JTS_ADMIN_PASSWORD || 'Admin2026!',
        mustChangePassword: false,
      },
      {
        id: 'usr-manager',
        name: 'Patrick Essomba (Manager)',
        email: (process.env.JTS_MANAGER_EMAIL || 'manager@justtechservices.xyz').toLowerCase(),
        role: 'manager',
        password: process.env.JTS_MANAGER_PASSWORD || 'Manager2026!',
        mustChangePassword: false,
      },
      {
        id: 'usr-reseller',
        name: 'KamerNet Telecom (Revendeur)',
        email: (process.env.JTS_RESELLER_EMAIL || 'reseller@justtechservices.xyz').toLowerCase(),
        role: 'reseller',
        password: process.env.JTS_RESELLER_PASSWORD || 'Reseller2026!',
        mustChangePassword: false,
      },
      {
        id: 'usr-subreseller',
        name: 'Douala Express Net (Sous-revendeur)',
        email: (process.env.JTS_SUB_RESELLER_EMAIL || 'subreseller@justtechservices.xyz').toLowerCase(),
        role: 'sub_reseller',
        password: process.env.JTS_SUB_RESELLER_PASSWORD || 'SubReseller2026!',
        mustChangePassword: false,
      },
      {
        id: 'usr-client',
        name: 'Franck Mbarga (Client)',
        email: 'client@justtechservices.xyz',
        role: 'client',
        password: process.env.JTS_CLIENT_PASSWORD || 'Client2026!',
        mustChangePassword: false,
      },
    ];

    const now = new Date().toISOString();
    for (const acc of defaults) {
      const { salt, hash } = hashPassword(acc.password);
      this.users.set(acc.id, {
        id: acc.id,
        name: acc.name,
        email: acc.email,
        role: acc.role,
        salt,
        passwordHash: hash,
        isActive: true,
        mustChangePassword: acc.mustChangePassword,
        createdAt: now,
        lastLoginAt: null,
      });
    }
  }

  private loadPersistedOverrides(): void {
    try {
      if (!fs.existsSync(this.stateFilePath)) return;
      const raw = fs.readFileSync(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(raw) as { users?: InternalUserRecord[] };
      if (!Array.isArray(parsed.users)) return;
      for (const saved of parsed.users) {
        if (!saved?.id || !saved?.email || !saved?.salt || !saved?.passwordHash) continue;
        // Preserve updated password hashes & mustChangePassword flags across restarts
        const existing = this.users.get(saved.id);
        if (existing && existing.email === saved.email) {
          existing.salt = saved.salt;
          existing.passwordHash = saved.passwordHash;
          existing.mustChangePassword = Boolean(saved.mustChangePassword);
          existing.isActive = typeof saved.isActive === 'boolean' ? saved.isActive : existing.isActive;
          existing.role = VALID_ROLES.includes(saved.role) ? saved.role : existing.role;
          existing.lastLoginAt = saved.lastLoginAt ?? existing.lastLoginAt;
        } else if (!existing) {
          this.users.set(saved.id, {
            ...saved,
            mustChangePassword: Boolean(saved.mustChangePassword),
          });
        }
      }
    } catch {
      // Ignore corrupt/missing runtime state file
    }
  }

  private persistState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.stateFilePath,
        JSON.stringify({ users: Array.from(this.users.values()) }, null, 2),
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch {
      // Non-fatal in read-only filesystems
    }
  }

  public toPublicUser(user: InternalUserRecord): PublicUserRecord {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      permissions: [...ROLE_PERMISSIONS[user.role]],
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  public recordAudit(entry: Omit<SecurityAuditEvent, 'id' | 'timestamp'>): void {
    this.securityLogs.unshift({
      id: `sec_${crypto.randomBytes(5).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (this.securityLogs.length > 200) {
      this.securityLogs.length = 200;
    }
  }

  public getSecurityLogs(): SecurityAuditEvent[] {
    return [...this.securityLogs];
  }

  public listUsers(): PublicUserRecord[] {
    return Array.from(this.users.values())
      .sort((a, b) => VALID_ROLES.indexOf(a.role) - VALID_ROLES.indexOf(b.role))
      .map((u) => this.toPublicUser(u));
  }

  public findUserByEmail(email: string): InternalUserRecord | undefined {
    const clean = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === clean) return u;
    }
    return undefined;
  }

  public authenticate(
    email: string,
    password: string,
    expectedZone?: 'admin' | 'reseller' | 'client'
  ): { ok: true; user: PublicUserRecord; token: string } | { ok: false; status: number; error: string } {
    const cleanEmail = email.trim().toLowerCase();
    const record = this.findUserByEmail(cleanEmail);

    if (!record || !verifyPassword(password, record.salt, record.passwordHash)) {
      this.recordAudit({
        actorEmail: cleanEmail || 'inconnu',
        actorRole: 'anonymous',
        action: 'auth.login_failed',
        target: expectedZone ? `/auth/${expectedZone}` : '/api/auth/login',
        outcome: 'DENIED',
        detail: 'Identifiants invalides.',
      });
      return { ok: false, status: 401, error: 'Adresse e-mail ou mot de passe incorrect.' };
    }

    if (!record.isActive) {
      this.recordAudit({
        actorEmail: record.email,
        actorRole: record.role,
        action: 'auth.login_suspended',
        target: '/api/auth/login',
        outcome: 'DENIED',
        detail: 'Compte désactivé par un administrateur.',
      });
      return { ok: false, status: 403, error: 'Ce compte a été désactivé par un administrateur.' };
    }

    if (expectedZone === 'admin' && !ADMIN_STAFF_ROLES.includes(record.role)) {
      this.recordAudit({
        actorEmail: record.email,
        actorRole: record.role,
        action: 'admin.zone_violation',
        target: '/admin',
        outcome: 'DENIED',
        detail: `Tentative d'accès à l'espace Administration par le rôle "${record.role}".`,
      });
      return {
        ok: false,
        status: 403,
        error: "Accès refusé : votre rôle n'est pas autorisé à accéder à l'espace d'administration.",
      };
    }

    if (expectedZone === 'reseller' && !RESELLER_ZONE_ROLES.includes(record.role)) {
      this.recordAudit({
        actorEmail: record.email,
        actorRole: record.role,
        action: 'reseller.zone_violation',
        target: '/reseller',
        outcome: 'DENIED',
        detail: `Tentative d'accès à l'espace Revendeur par le rôle "${record.role}".`,
      });
      return {
        ok: false,
        status: 403,
        error: "Accès refusé : espace réservé aux comptes Revendeurs et Sous-revendeurs.",
      };
    }

    record.lastLoginAt = new Date().toISOString();
    const tokenId = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(tokenId, { tokenId, userId: record.id, expiresAt });
    const token = signSessionToken(tokenId, record.id, expiresAt);

    this.recordAudit({
      actorEmail: record.email,
      actorRole: record.role,
      action: 'auth.login_success',
      target: expectedZone ? `/${expectedZone}` : '/api/auth/login',
      outcome: 'ALLOWED',
      detail: `Session ouverte pour le rôle ${record.role}.`,
    });

    return { ok: true, user: this.toPublicUser(record), token };
  }

  public resolveSessionFromRequest(req: Request): { user: PublicUserRecord; tokenId: string } | null {
    const authHeader = req.headers.authorization;
    let rawToken: string | null = null;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      rawToken = authHeader.slice(7).trim();
    } else {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies[SESSION_COOKIE_NAME]) {
        rawToken = cookies[SESSION_COOKIE_NAME];
      }
    }

    if (!rawToken) return null;
    const verified = verifySessionToken(rawToken);
    if (!verified) return null;

    const session = this.sessions.get(verified.tid);
    if (!session || session.userId !== verified.uid || session.expiresAt <= Date.now()) {
      this.sessions.delete(verified.tid);
      return null;
    }

    const record = this.users.get(session.userId);
    if (!record || !record.isActive) {
      this.sessions.delete(verified.tid);
      return null;
    }

    return { user: this.toPublicUser(record), tokenId: verified.tid };
  }

  public revokeSession(tokenId: string | null | undefined, actor?: PublicUserRecord | null): void {
    if (tokenId) {
      this.sessions.delete(tokenId);
    }
    if (actor) {
      this.recordAudit({
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'auth.logout',
        target: '/api/auth/logout',
        outcome: 'ALLOWED',
        detail: 'Déconnexion explicite et révocation de session.',
      });
    }
  }

  public changePassword(
    actor: PublicUserRecord,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string
  ): { ok: true; user: PublicUserRecord; token: string } | { ok: false; status: number; error: string } {
    const record = this.users.get(actor.id);
    if (!record || !record.isActive) {
      return { ok: false, status: 404, error: 'Compte utilisateur introuvable ou inactif.' };
    }

    if (!verifyPassword(currentPassword, record.salt, record.passwordHash)) {
      this.recordAudit({
        actorEmail: record.email,
        actorRole: record.role,
        action: 'auth.password_change_failed',
        target: '/api/auth/change-password',
        outcome: 'DENIED',
        detail: 'Mot de passe actuel invalide.',
      });
      return { ok: false, status: 400, error: 'Le mot de passe actuel est incorrect.' };
    }

    if (newPassword !== confirmPassword) {
      return { ok: false, status: 400, error: 'Les nouveaux mots de passe ne correspondent pas.' };
    }

    if (newPassword === currentPassword) {
      return {
        ok: false,
        status: 400,
        error: 'Le nouveau mot de passe doit être différent du mot de passe initial.',
      };
    }

    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasDigitOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(newPassword);
    if (newPassword.length < 8 || !hasUpper || !hasLower || !hasDigitOrSymbol) {
      return {
        ok: false,
        status: 400,
        error:
          'Le nouveau mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre ou symbole.',
      };
    }

    const { salt, hash } = hashPassword(newPassword);
    record.salt = salt;
    record.passwordHash = hash;
    record.mustChangePassword = false;
    this.persistState();

    // Révoquer les anciennes sessions de cet utilisateur puis émettre un nouveau jeton frais
    for (const [tid, sess] of this.sessions.entries()) {
      if (sess.userId === record.id) {
        this.sessions.delete(tid);
      }
    }

    const tokenId = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(tokenId, { tokenId, userId: record.id, expiresAt });
    const token = signSessionToken(tokenId, record.id, expiresAt);

    this.recordAudit({
      actorEmail: record.email,
      actorRole: record.role,
      action: 'auth.password_changed',
      target: '/api/auth/change-password',
      outcome: 'ALLOWED',
      detail: 'Mot de passe modifié avec succès et session renouvelée.',
    });

    return { ok: true, user: this.toPublicUser(record), token };
  }

  public createUser(
    actor: PublicUserRecord,
    input: { name: string; email: string; password: string; role: SessionRole }
  ): { ok: true; user: PublicUserRecord } | { ok: false; status: number; error: string } {
    const cleanName = input.name.trim();
    const cleanEmail = input.email.trim().toLowerCase();
    const cleanPassword = input.password;

    if (!cleanName || !cleanEmail.includes('@') || cleanPassword.length < 8) {
      return {
        ok: false,
        status: 400,
        error: 'Nom, adresse e-mail valide et mot de passe (8 caractères minimum) requis.',
      };
    }

    if (!VALID_ROLES.includes(input.role)) {
      return { ok: false, status: 400, error: 'Rôle invalide.' };
    }

    if (actor.role !== 'super_admin' && (input.role === 'super_admin' || input.role === 'admin')) {
      this.recordAudit({
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'rbac.privilege_escalation_blocked',
        target: cleanEmail,
        outcome: 'DENIED',
        detail: `Un ${actor.role} ne peut pas créer de compte ${input.role}.`,
      });
      return {
        ok: false,
        status: 403,
        error: 'Seul un Super Admin peut créer un compte Super Admin ou Admin.',
      };
    }

    if (this.findUserByEmail(cleanEmail)) {
      return { ok: false, status: 409, error: 'Un compte existe déjà avec cette adresse e-mail.' };
    }

    const id = `usr-${crypto.randomBytes(5).toString('hex')}`;
    const { salt, hash } = hashPassword(cleanPassword);
    const created: InternalUserRecord = {
      id,
      name: cleanName,
      email: cleanEmail,
      role: input.role,
      salt,
      passwordHash: hash,
      isActive: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    this.users.set(id, created);
    this.persistState();

    this.recordAudit({
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'rbac.user_created',
      target: cleanEmail,
      outcome: 'ALLOWED',
      detail: `Compte créé avec le rôle ${input.role}.`,
    });

    return { ok: true, user: this.toPublicUser(created) };
  }

  public updateUser(
    actor: PublicUserRecord,
    targetId: string,
    patch: { role?: SessionRole; isActive?: boolean }
  ): { ok: true; user: PublicUserRecord } | { ok: false; status: number; error: string } {
    const target = this.users.get(targetId);
    if (!target) {
      return { ok: false, status: 404, error: 'Utilisateur introuvable.' };
    }

    if (actor.role !== 'super_admin' && (target.role === 'super_admin' || target.role === 'admin')) {
      this.recordAudit({
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'rbac.unauthorized_modify_blocked',
        target: target.email,
        outcome: 'DENIED',
        detail: `Tentative de modification d'un compte ${target.role} par ${actor.role}.`,
      });
      return {
        ok: false,
        status: 403,
        error: 'Seul un Super Admin peut modifier un compte Super Admin ou Admin.',
      };
    }

    if (patch.role !== undefined) {
      if (!VALID_ROLES.includes(patch.role)) {
        return { ok: false, status: 400, error: 'Rôle cible invalide.' };
      }
      if (actor.role !== 'super_admin' && (patch.role === 'super_admin' || patch.role === 'admin')) {
        return {
          ok: false,
          status: 403,
          error: 'Élévation vers Super Admin ou Admin réservée au Super Admin.',
        };
      }
      if (target.id === actor.id && patch.role !== target.role) {
        return {
          ok: false,
          status: 400,
          error: 'Vous ne pouvez pas modifier votre propre rôle actif.',
        };
      }
    }

    if (patch.isActive === false && target.id === actor.id) {
      return {
        ok: false,
        status: 400,
        error: 'Vous ne pouvez pas désactiver votre propre compte.',
      };
    }

    // Protéger le dernier Super Admin actif
    const willLoseSuperAdmin =
      target.role === 'super_admin' &&
      ((patch.role !== undefined && patch.role !== 'super_admin') || patch.isActive === false);
    if (willLoseSuperAdmin) {
      const otherActiveSuperAdmins = Array.from(this.users.values()).filter(
        (u) => u.id !== target.id && u.role === 'super_admin' && u.isActive
      );
      if (otherActiveSuperAdmins.length === 0) {
        return {
          ok: false,
          status: 409,
          error: 'Impossible de rétrograder ou désactiver le dernier Super Admin actif.',
        };
      }
    }

    const previousRole = target.role;
    const previousActive = target.isActive;
    if (patch.role !== undefined) target.role = patch.role;
    if (typeof patch.isActive === 'boolean') target.isActive = patch.isActive;

    // Si compte désactivé ou rôle modifié, révoquer ses sessions actives pour forcer la ré-évaluation immédiate
    if (!target.isActive || previousRole !== target.role) {
      for (const [tid, sess] of this.sessions.entries()) {
        if (sess.userId === target.id) {
          this.sessions.delete(tid);
        }
      }
    }

    this.recordAudit({
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'rbac.user_updated',
      target: target.email,
      outcome: 'ALLOWED',
      detail: `Rôle: ${previousRole} → ${target.role} | Statut: ${previousActive ? 'Actif' : 'Suspendu'} → ${target.isActive ? 'Actif' : 'Suspendu'}`,
    });

    this.persistState();
    return { ok: true, user: this.toPublicUser(target) };
  }

  public setSessionCookie(req: Request, res: Response, token: string): void {
    const host = String(req.headers.host || '');
    const isLocalHttp =
      !req.secure &&
      req.headers['x-forwarded-proto'] !== 'https' &&
      (host.startsWith('localhost') || host.startsWith('127.0.0.1'));
    const cookieParts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      isLocalHttp ? 'SameSite=Lax' : 'SameSite=None; Secure',
    ];
    res.setHeader('Set-Cookie', cookieParts.join('; '));
  }

  public clearSessionCookie(req: Request, res: Response): void {
    const host = String(req.headers.host || '');
    const isLocalHttp =
      !req.secure &&
      req.headers['x-forwarded-proto'] !== 'https' &&
      (host.startsWith('localhost') || host.startsWith('127.0.0.1'));
    const cookieParts = [
      `${SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'Max-Age=0',
      isLocalHttp ? 'SameSite=Lax' : 'SameSite=None; Secure',
    ];
    res.setHeader('Set-Cookie', cookieParts.join('; '));
  }

  public attachSessionMiddleware = (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    const resolved = this.resolveSessionFromRequest(req);
    req.authUser = resolved?.user ?? null;
    req.authTokenId = resolved?.tokenId ?? null;
    next();
  };

  public requireRoles = (allowedRoles: readonly SessionRole[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      const user = req.authUser;
      if (!user) {
        this.recordAudit({
          actorEmail: 'anonymous',
          actorRole: 'anonymous',
          action: 'rbac.unauthenticated_access',
          target: `${req.method} ${req.path}`,
          outcome: 'DENIED',
          detail: `Requête non authentifiée bloquée (rôles requis : ${allowedRoles.join(', ')}).`,
        });
        res.status(401).json({
          error: 'Authentification requise pour accéder à cette ressource.',
          code: 'UNAUTHENTICATED',
        });
        return;
      }

      if (user.mustChangePassword) {
        this.recordAudit({
          actorEmail: user.email,
          actorRole: user.role,
          action: 'auth.password_change_required',
          target: `${req.method} ${req.path}`,
          outcome: 'DENIED',
          detail: 'Changement de mot de passe initial obligatoire avant accès aux ressources protégées.',
        });
        res.status(403).json({
          error: 'Changement de mot de passe obligatoire requis lors de la première connexion.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
        return;
      }

      if (!allowedRoles.includes(user.role)) {
        this.recordAudit({
          actorEmail: user.email,
          actorRole: user.role,
          action: 'rbac.forbidden_access',
          target: `${req.method} ${req.path}`,
          outcome: 'DENIED',
          detail: `Rôle "${user.role}" refusé (autorisés : ${allowedRoles.join(', ')}).`,
        });
        res.status(403).json({
          error: `Accès refusé pour le rôle "${user.role}".`,
          code: 'FORBIDDEN_ROLE',
        });
        return;
      }

      next();
    };
  };
}
