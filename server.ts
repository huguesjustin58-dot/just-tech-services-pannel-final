import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AIPaymentAgent,
  MonitoredTransactionInput,
  PaymentProvider,
  ProvisionedOutcome,
} from './server/AIPaymentAgent.js';
import {
  AuthenticatedRequest,
  RbacAuthService,
  SessionRole,
} from './server/authRbac.js';
import {
  CloudConfigEngine,
  PublicCloudBundleResponse,
} from './server/cloudConfigEngine.js';
import { SshCloudConfigRegistry } from './server/sshCloudRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface PlanCatalogItem {
  id: string;
  category: 'NPV TUNNEL' | 'OFFRE TEST GRATUIT';
  name: string;
  priceFcfa: number;
  durationLabel: string;
  durationHours: number;
  dataQuotaGb: number | null;
  maxSessions: number;
}

const OFFICIAL_PLANS: PlanCatalogItem[] = [
  // NPV TUNNEL (Gigas & Prix FCFA)
  { id: 'npv-500', category: 'NPV TUNNEL', name: 'NPV 5 Go', priceFcfa: 500, durationLabel: '5 jours', durationHours: 120, dataQuotaGb: 5, maxSessions: 1 },
  { id: 'npv-1000', category: 'NPV TUNNEL', name: 'NPV 10 Go', priceFcfa: 1000, durationLabel: '7 jours', durationHours: 168, dataQuotaGb: 10, maxSessions: 1 },
  { id: 'npv-2000', category: 'NPV TUNNEL', name: 'NPV 20 Go', priceFcfa: 2000, durationLabel: '10 jours', durationHours: 240, dataQuotaGb: 20, maxSessions: 2 },
  { id: 'npv-2500', category: 'NPV TUNNEL', name: 'NPV 25 Go', priceFcfa: 2500, durationLabel: '12 jours', durationHours: 288, dataQuotaGb: 25, maxSessions: 2 },
  { id: 'npv-4000', category: 'NPV TUNNEL', name: 'NPV 40 Go', priceFcfa: 4000, durationLabel: '15 jours', durationHours: 360, dataQuotaGb: 40, maxSessions: 2 },
  { id: 'npv-5000', category: 'NPV TUNNEL', name: 'NPV 60 Go', priceFcfa: 5000, durationLabel: '20 jours', durationHours: 480, dataQuotaGb: 60, maxSessions: 3 },
  // OFFRE TEST GRATUIT
  { id: 'free-test-3gb', category: 'OFFRE TEST GRATUIT', name: 'Test Gratuit 3 Go', priceFcfa: 0, durationLabel: '2 heures', durationHours: 2, dataQuotaGb: 3, maxSessions: 1 },
];

function resolvePhoneNumber(envVal: string | undefined, fallback = ''): string {
  if (!envVal) return fallback;
  const digits = envVal.replace(/\D/g, '');
  return digits.length >= 6 ? envVal : fallback;
}

// État serveur autoritaire des passerelles Mobile Money, plafond Orange, codes Cloud et anti-abus Test Gratuit
const paymentGatewayState = {
  mtnBeneficiary: process.env.MTN_MOMO_BENEFICIARY || '',
  mtnNumber: resolvePhoneNumber(process.env.MTN_MOMO_NUMBER),
  orangeBeneficiary: process.env.ORANGE_MONEY_BENEFICIARY || '',
  orangeNumber: resolvePhoneNumber(process.env.ORANGE_MONEY_NUMBER),
  orangeMerchantOmAsso: process.env.ORANGE_MERCHANT_OM_ASSO || '',
  orangeCeilingFcfa: Math.max(0, Number(process.env.ORANGE_MONTHLY_CEILING_FCFA || 1500000)),
  orangeCurrentVolumeFcfa: Math.max(0, Number(process.env.ORANGE_CURRENT_VOLUME_FCFA || 0)),
  orangeCeilingReachedManual: false,
};

const deviceTestRegistry = new Map<string, { accountId: string; code: string; platform: string; createdAt: string }>();
const accountTestGenerations = new Map<string, number>();

interface ServerCreditTransaction {
  id: string;
  idempotencyKey: string;
  userId: string;
  actorId: string;
  type: 'gb_allocation' | 'gb_plan_debit' | 'gb_transfer_out' | 'gb_transfer_in';
  gbDelta: number;
  gbBefore: number;
  gbAfter: number;
  description: string;
  createdAt: string;
}

const cloudEngine = new CloudConfigEngine();
const sshCloudRegistry = new SshCloudConfigRegistry();
const serverCreditTransactions: ServerCreditTransaction[] = [];
const serverPartnerGbBalances = new Map<string, number>();
const serverCreditIdempotency = new Map<string, ServerCreditTransaction>();

const defaultTunnelHost = process.env.JTS_DEFAULT_SERVER_HOST || (() => {
  try {
    return new URL(process.env.APP_URL || '').hostname;
  } catch {
    return '';
  }
})();
const defaultSlowDnsNs = process.env.JTS_SLOWDNS_NS_DOMAIN || '';
const defaultSlowDnsPubKey = process.env.JTS_SLOWDNS_PUBKEY || '';

let activeNpvPrototypeJson = JSON.stringify(
  {
    name: 'JUST TECH SERVICES TUNNEL VIP',
    connectionMode: 'SSH_WSS_SLOWDNS',
    sshHost: defaultTunnelHost,
    sshPort: 22,
    wssPort: 443,
    sshUsername: '{{SSH_USERNAME}}',
    sshPassword: '{{SSH_PASSWORD}}',
    sni: process.env.JTS_DEFAULT_SNI || defaultTunnelHost,
    payload: `GET wss://${process.env.JTS_DEFAULT_SNI || defaultTunnelHost}/wss HTTP/1.1[crlf]Host: ${defaultTunnelHost}[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]`,
    slowDns: {
      enabled: Boolean(defaultSlowDnsNs && defaultSlowDnsPubKey),
      dnsServer: '8.8.8.8:53',
      nameserver: defaultSlowDnsNs,
      publicKey: defaultSlowDnsPubKey,
    },
    generator: 'JUST TECH SERVICES AI COMPILER',
  },
  null,
  2
);

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY non configurée sur le serveur.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isOrangeCeilingExceeded(): boolean {
  return (
    paymentGatewayState.orangeCeilingReachedManual ||
    paymentGatewayState.orangeCurrentVolumeFcfa >= paymentGatewayState.orangeCeilingFcfa
  );
}

interface RemoteSshProbeResult {
  reachable: boolean;
  status: 'En ligne' | 'Hors ligne';
  latencyMs: number | null;
  sshBanner: string | null;
  errorCode: string | null;
  reason: string;
  host: string;
  port: number;
  checkedAt: string;
}

/**
 * Sonde TCP/SSH réelle vers un serveur distant via net.Socket.
 * Ne simule JAMAIS de fausse connexion réussie : renvoie le code erreur réseau exact en cas d'échec.
 */
function probeRemoteSshTcp(host: string, port: number, timeoutMs = 3500): Promise<RemoteSshProbeResult> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const checkedAt = new Date().toISOString();
    let settled = false;
    let connected = false;
    let connectLatencyMs: number | null = null;
    let bannerTimer: NodeJS.Timeout | null = null;

    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    const finalize = (result: RemoteSshProbeResult) => {
      if (settled) return;
      settled = true;
      if (bannerTimer) clearTimeout(bannerTimer);
      socket.destroy();
      resolve(result);
    };

    socket.once('connect', () => {
      connected = true;
      connectLatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
      // Attend brièvement la bannière SSH-2.0 du démon OpenSSH distant
      bannerTimer = setTimeout(() => {
        finalize({
          reachable: true,
          status: 'En ligne',
          latencyMs: connectLatencyMs,
          sshBanner: null,
          errorCode: null,
          reason: `Port TCP ${port} joignable (${connectLatencyMs} ms), mais aucune bannière SSH reçue sous 1200 ms.`,
          host,
          port,
          checkedAt,
        });
      }, 1200);
    });

    socket.once('data', (chunk) => {
      const firstLine = chunk
        .toString('utf8')
        .split(/\r?\n/)[0]
        .replace(/[^\x20-\x7E]/g, '')
        .slice(0, 120);
      finalize({
        reachable: true,
        status: 'En ligne',
        latencyMs: connectLatencyMs ?? Math.max(1, Math.round(performance.now() - startedAt)),
        sshBanner: firstLine || null,
        errorCode: null,
        reason: firstLine
          ? `Connexion TCP établie (${connectLatencyMs} ms) · Bannière SSH confirmée.`
          : `Port TCP ${port} ouvert (${connectLatencyMs} ms).`,
        host,
        port,
        checkedAt,
      });
    });

    socket.once('timeout', () => {
      if (connected) {
        finalize({
          reachable: true,
          status: 'En ligne',
          latencyMs: connectLatencyMs,
          sshBanner: null,
          errorCode: null,
          reason: `Port TCP ${port} joignable (${connectLatencyMs} ms), pas de bannière SSH détectée.`,
          host,
          port,
          checkedAt,
        });
        return;
      }
      finalize({
        reachable: false,
        status: 'Hors ligne',
        latencyMs: null,
        sshBanner: null,
        errorCode: 'ETIMEDOUT',
        reason: `Serveur distant injoignable (${host}:${port}) : délai d'attente dépassé (${timeoutMs} ms / ETIMEDOUT).`,
        host,
        port,
        checkedAt,
      });
    });

    socket.once('error', (err: NodeJS.ErrnoException) => {
      const code = err.code || 'NETWORK_ERROR';
      finalize({
        reachable: false,
        status: 'Hors ligne',
        latencyMs: null,
        sshBanner: null,
        errorCode: code,
        reason: `Serveur distant injoignable (${host}:${port}) : ${code} (${err.message}).`,
        host,
        port,
        checkedAt,
      });
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur socket TCP';
      finalize({
        reachable: false,
        status: 'Hors ligne',
        latencyMs: null,
        sshBanner: null,
        errorCode: 'CONNECT_EXCEPTION',
        reason: `Échec initialisation sonde TCP (${host}:${port}) : ${msg}`,
        host,
        port,
        checkedAt,
      });
    }
  });
}

function compileNpvFromPrototype(rawPrototype: string, sshUsername: string, sshPassword: string, clientLabel: string): string {
  try {
    const parsed = JSON.parse(rawPrototype) as Record<string, unknown>;
    const clone = structuredClone(parsed);

    const replaceCreds = (obj: Record<string, unknown>) => {
      for (const key of Object.keys(obj)) {
        const lower = key.toLowerCase();
        const val = obj[key];
        if (typeof val === 'string') {
          if (lower === 'sshusername' || lower === 'ssh_username' || lower === 'username' || lower === 'user') {
            obj[key] = sshUsername;
          } else if (lower === 'sshpassword' || lower === 'ssh_password' || lower === 'password' || lower === 'pass') {
            obj[key] = sshPassword;
          } else if (lower === 'payload' || lower === 'http_payload' || lower === 'httppayload') {
            // Préservation 100 % brute du Payload HTTP (CRLF \r\n, espaces, [host], [crlf], [split], [ua])
            obj[key] = val;
          } else {
            obj[key] = val
              .replace(/\{\{SSH_USERNAME\}\}/g, sshUsername)
              .replace(/\{\{SSH_PASSWORD\}\}/g, sshPassword);
          }
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          replaceCreds(val as Record<string, unknown>);
        }
      }
    };

    replaceCreds(clone);
    if (!('sshUsername' in clone) && !('username' in clone)) clone.sshUsername = sshUsername;
    if (!('sshPassword' in clone) && !('password' in clone)) clone.sshPassword = sshPassword;
    clone.issuedFor = clientLabel;
    return JSON.stringify(clone, null, 2);
  } catch {
    // Mode brut sans .trim() : 100 % des espaces, CRLF \r\n et balises préservés
    return rawPrototype
      .replace(/\{\{SSH_USERNAME\}\}/g, sshUsername)
      .replace(/\{\{SSH_PASSWORD\}\}/g, sshPassword);
  }
}

function createRandomCredentials(prefixSeed: string) {
  const clean = prefixSeed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'client';
  const suffix = crypto.randomBytes(2).toString('hex');
  const sshUsername = `jts_${clean}${suffix}`;
  const sshPassword = `Jts#${crypto.randomBytes(4).toString('hex')}`;
  return { sshUsername, sshPassword };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const authRbac = new RbacAuthService();
  app.use(authRbac.attachSessionMiddleware);

  // 0a. Authentification & Isolation RBAC stricte (5 rôles : Super Admin, Admin, Manager, Reseller, Client)
  app.post('/api/auth/register', (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const { name = '', email = '', password = '' } = req.body ?? {};
    const registration = authRbac.registerClient({
      name: String(name),
      email: String(email),
      password: String(password),
    });
    if (!registration.ok) {
      res.status(registration.status).json({ authenticated: false, error: registration.error });
      return;
    }

    // Sign the new client in immediately; public registration can never choose a privileged role.
    const result = authRbac.authenticate(registration.user.email, String(password), 'client');
    if (!result.ok) {
      res.status(result.status).json({ authenticated: false, error: result.error });
      return;
    }
    authRbac.setSessionCookie(req, res, result.token);
    res.status(201).json({
      authenticated: true,
      user: result.user,
      token: result.token,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const { email = '', password = '', zone } = req.body ?? {};
    const expectedZone =
      zone === 'admin' || zone === 'reseller' || zone === 'client' ? zone : undefined;

    const result = authRbac.authenticate(String(email), String(password), expectedZone);
    if (!result.ok) {
      res.status(result.status).json({ authenticated: false, error: result.error });
      return;
    }

    authRbac.setSessionCookie(req, res, result.token);
    res.json({
      authenticated: true,
      user: result.user,
      token: result.token,
    });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    authRbac.revokeSession(req.authTokenId, req.authUser);
    authRbac.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    if (!req.authUser) {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user: req.authUser });
  });

  app.post('/api/auth/change-password', (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Authentification requise.' });
      return;
    }
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body ?? {};
    const result = authRbac.changePassword(
      req.authUser,
      String(currentPassword),
      String(newPassword),
      String(confirmPassword)
    );
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }
    authRbac.setSessionCookie(req, res, result.token);
    res.json({
      ok: true,
      user: result.user,
      token: result.token,
    });
  });

  // 0b. Gestion des Rôles & Comptes (strictement réservée Super Admin & Admin)
  app.get(
    '/api/admin/users',
    authRbac.requireRoles(['super_admin', 'admin']),
    (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      res.json({ users: authRbac.listUsers() });
    }
  );

  app.post(
    '/api/admin/users',
    authRbac.requireRoles(['super_admin', 'admin']),
    (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const { name = '', email = '', password = '', role = 'client' } = req.body ?? {};
      const result = authRbac.createUser(req.authUser!, {
        name: String(name),
        email: String(email),
        password: String(password),
        role: String(role) as SessionRole,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json({ user: result.user });
    }
  );

  app.patch(
    '/api/admin/users/:id',
    authRbac.requireRoles(['super_admin', 'admin']),
    (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const { role, isActive } = req.body ?? {};
      const result = authRbac.updateUser(req.authUser!, String(req.params.id), {
        role: role !== undefined ? (String(role) as SessionRole) : undefined,
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ user: result.user });
    }
  );

  app.get(
    '/api/admin/security-logs',
    authRbac.requireRoles(['super_admin', 'admin']),
    (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      res.json({ logs: authRbac.getSecurityLogs() });
    }
  );

  const paymentAgent = new AIPaymentAgent(
    {
      mtn: {
        beneficiary: paymentGatewayState.mtnBeneficiary,
        number: paymentGatewayState.mtnNumber,
      },
      orange: {
        beneficiary: paymentGatewayState.orangeBeneficiary,
        number: paymentGatewayState.orangeNumber,
        merchantOmAsso: paymentGatewayState.orangeMerchantOmAsso,
        ceilingFcfa: paymentGatewayState.orangeCeilingFcfa,
        warningThresholdRatio: 0.85,
      },
    },
    {
      getGeminiClient,
      getOrangeCurrentVolume: () => paymentGatewayState.orangeCurrentVolumeFcfa,
      isOrangeCeilingManual: () => paymentGatewayState.orangeCeilingReachedManual,
      onProvisionService: async (tx: MonitoredTransactionInput): Promise<ProvisionedOutcome> => {
        const plan = OFFICIAL_PLANS.find((p) => p.id === tx.planId) ?? OFFICIAL_PLANS[5] ?? OFFICIAL_PLANS[0];
        const { sshUsername, sshPassword } = createRandomCredentials(tx.clientName);
        const deliveryToken = `deliv_${crypto.randomBytes(12).toString('hex')}`;
        let cloudRecord: PublicCloudBundleResponse | null = null;
        let npvFileContent: string | null = null;
        let npvFilename: string | null = null;

        const issued = await cloudEngine.issueBundle({
          planId: plan.id,
          planName: `${plan.name} (${plan.durationLabel})`,
          clientName: tx.clientName,
          dataQuotaGb: plan.dataQuotaGb ?? 3,
          dataUsedGb: 0,
          durationHours: plan.durationHours,
          maxSessions: plan.maxSessions,
          serverCode: 'VPS-CM-01',
          sshUsername,
          sshPassword,
          licenseStatus: 'Active',
        });

        if (!issued.ok) {
          throw new Error(issued.error || 'Impossible de créer le pass Cloud après validation.');
        }
        cloudRecord = issued.bundle;
        pendingDeliveriesStore.set(deliveryToken, {
          token: deliveryToken,
          plan,
          clientName: tx.clientName,
          sshUsername,
          sshPassword,
          cloudRecord: issued.bundle,
          createdAt: Date.now(),
        });

        if (tx.platform === 'iphone') {
          const activeProto =
            typeof tx.prototypeJson === 'string' && tx.prototypeJson.length > 0
              ? tx.prototypeJson
              : activeNpvPrototypeJson;
          const compiled = cloudEngine.compilePrivateNpvt(issued.bundle.code, activeProto, issued.bundle.exchangeToken);
          if (compiled.ok) {
            npvFileContent = compiled.content;
            npvFilename = compiled.filename;
          }
        }

        if (plan.category === 'OFFRE TEST GRATUIT') {
          const used = accountTestGenerations.get(tx.accountId) ?? 0;
          accountTestGenerations.set(tx.accountId, used + 1);
          deviceTestRegistry.set(tx.deviceFingerprint, {
            accountId: tx.accountId,
            code: cloudRecord?.code ?? npvFilename ?? sshUsername,
            platform: tx.platform === 'pending' ? 'pending-os' : tx.platform,
            createdAt: new Date().toISOString(),
          });
        } else if (tx.provider === 'Orange Money' || tx.provider === 'Orange OM ASSO') {
          paymentGatewayState.orangeCurrentVolumeFcfa += plan.priceFcfa;
        }

        return {
          deliveryToken,
          sshUsername,
          sshPassword,
          platform: tx.platform,
          cloudCode: cloudRecord?.code ?? null,
          cloudRecord,
          npvFilename,
          npvFileContent,
        };
      },
    }
  );

  // 1. Configuration paiement & plafond Orange Money
  app.get('/api/payment-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      mtnBeneficiary: paymentGatewayState.mtnBeneficiary,
      mtnNumber: paymentGatewayState.mtnNumber,
      orangeBeneficiary: paymentGatewayState.orangeBeneficiary,
      orangeNumber: paymentGatewayState.orangeNumber,
      orangeMerchantOmAsso: paymentGatewayState.orangeMerchantOmAsso,
      orangeCeilingExceeded: isOrangeCeilingExceeded(),
    });
  });

  app.post(
    '/api/payment-config',
    authRbac.requireRoles(['super_admin', 'admin']),
    (req, res) => {
      const { orangeCeilingReachedManual, orangeCurrentVolumeFcfa, orangeCeilingFcfa } = req.body ?? {};
      if (typeof orangeCeilingReachedManual === 'boolean') {
        paymentGatewayState.orangeCeilingReachedManual = orangeCeilingReachedManual;
      }
      if (typeof orangeCurrentVolumeFcfa === 'number' && orangeCurrentVolumeFcfa >= 0) {
        paymentGatewayState.orangeCurrentVolumeFcfa = orangeCurrentVolumeFcfa;
      }
      if (typeof orangeCeilingFcfa === 'number' && orangeCeilingFcfa > 0) {
        paymentGatewayState.orangeCeilingFcfa = orangeCeilingFcfa;
      }
      const emittedAlert = paymentAgent.evaluateCeilingAlerts();
      res.json({
        ...paymentGatewayState,
        orangeCeilingExceeded: isOrangeCeilingExceeded(),
        emittedAlert,
      });
    }
  );

  // 2. Synchronisation du Prototype NPV / Payload HTTP Brut Super Admin (zéro .trim(), 100 % brut, Super Admin uniquement)
  app.post(
    '/api/npv-prototype',
    authRbac.requireRoles(['super_admin']),
    (req, res) => {
      const { rawTemplateJson } = req.body ?? {};
      if (typeof rawTemplateJson === 'string' && rawTemplateJson.length > 0) {
        activeNpvPrototypeJson = rawTemplateJson;
      }
      res.json({
        ok: true,
        preservedByteLength: Buffer.byteLength(activeNpvPrototypeJson, 'utf8'),
        preservedCharLength: activeNpvPrototypeJson.length,
      });
    }
  );

  // 2b. Sonde TCP/SSH réelle vers un serveur VPS distant (jamais simulée)
  app.post(
    '/api/admin/servers/probe',
    authRbac.requireRoles(['super_admin', 'admin', 'manager']),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const rawHost = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
      const rawPort = Number(req.body?.port ?? 22);
      const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 22;

      if (!rawHost || !/^[a-zA-Z0-9.:-]+$/.test(rawHost)) {
        res.status(400).json({
          ok: false,
          reachable: false,
          status: 'Hors ligne',
          latencyMs: null,
          sshBanner: null,
          errorCode: 'INVALID_HOST',
          reason: 'Adresse hôte ou IP du serveur distant invalide.',
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      const probe = await probeRemoteSshTcp(rawHost, port, 3500);
      res.json({ ok: true, ...probe });
    }
  );

  // 3. Éligibilité Test Gratuit (1 par appareil, 2 générations max par compte client)
  app.get('/api/test-eligibility', (req: AuthenticatedRequest, res) => {
    if (!req.authUser || req.authUser.role !== 'client') {
      res.status(401).json({ error: 'Connectez-vous à votre compte client pour vérifier votre éligibilité.' });
      return;
    }
    const accountId = req.authUser.id;
    const deviceFingerprint = String(req.query.deviceFingerprint || '');
    const usedOnAccount = accountTestGenerations.get(accountId) ?? 0;
    const deviceClaim = deviceFingerprint ? deviceTestRegistry.get(deviceFingerprint) : undefined;

    res.json({
      accountId,
      accountTestsUsed: usedOnAccount,
      accountTestsMax: 2,
      accountTestsRemaining: Math.max(0, 2 - usedOnAccount),
      deviceAlreadyUsed: Boolean(deviceClaim),
      deviceClaim: deviceClaim ?? null,
    });
  });

  // 0. Sonde santé réelle (zéro latence simulée)
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      activeCloudCodes: cloudEngine.size,
      creditTransactionsCount: serverCreditTransactions.length,
      timestamp: new Date().toISOString(),
    });
  });

  // 3b. Journal immuable credit_transactions & débit atomique partenaire
  app.get(
    '/api/credit-transactions',
    authRbac.requireRoles(['super_admin', 'admin', 'manager', 'reseller']),
    (_req, res) => {
      res.json({
        transactions: serverCreditTransactions.slice(0, 100),
      });
    }
  );

  app.post(
    '/api/reseller/atomic-debit',
    authRbac.requireRoles(['super_admin', 'admin', 'reseller']),
    (req, res) => {
    const { partnerId, actorId, gbDelta, idempotencyKey, description, initialGbBalance } = req.body ?? {};
    const cleanKey = String(idempotencyKey || '').trim();
    const cleanPartner = String(partnerId || '').trim();
    const delta = Number(gbDelta);

    if (!cleanKey || !cleanPartner || !Number.isFinite(delta) || delta === 0) {
      res.status(400).json({ error: 'Paramètres de transaction invalides (partnerId, idempotencyKey, gbDelta requis).' });
      return;
    }

    const existing = serverCreditIdempotency.get(cleanKey);
    if (existing) {
      res.json({ idempotentReplay: true, transaction: existing });
      return;
    }

    const currentBalance = serverPartnerGbBalances.has(cleanPartner)
      ? (serverPartnerGbBalances.get(cleanPartner) as number)
      : Math.max(0, Number(initialGbBalance) || 0);
    const nextBalance = currentBalance + delta;

    if (nextBalance < 0) {
      res.status(422).json({
        error: `Stock de Gigas insuffisant (${currentBalance} Go disponibles pour ${Math.abs(delta)} Go requis).`,
      });
      return;
    }

    serverPartnerGbBalances.set(cleanPartner, nextBalance);
    const tx: ServerCreditTransaction = {
      id: `ctx_${crypto.randomBytes(6).toString('hex')}`,
      idempotencyKey: cleanKey,
      userId: cleanPartner,
      actorId: String(actorId || cleanPartner),
      type: delta > 0 ? 'gb_allocation' : 'gb_plan_debit',
      gbDelta: delta,
      gbBefore: currentBalance,
      gbAfter: nextBalance,
      description: String(description || 'Opération stock Gigas'),
      createdAt: new Date().toISOString(),
    };
    serverCreditIdempotency.set(cleanKey, tx);
    serverCreditTransactions.unshift(tx);
    res.status(201).json({ transaction: tx, remainingGbBalance: nextBalance });
  });

  // 4. Module Génération Configurations Cloud (JSON / Lien URI / Token / QR / .npvt)
  //    Connecté aux pass et quotas clients réels · ZÉRO secret/mot de passe en clair dans QR ou liens publics
  app.post('/api/cloud-config/generate', authRbac.requireRoles(['super_admin', 'admin', 'manager', 'reseller', 'sub_reseller']), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    try {
      const {
        planId,
        planName,
        clientName = 'Franck Mbarga',
        dataQuotaGb,
        dataUsedGb = 0,
        durationHours,
        expiresAt,
        maxSessions,
        serverCode = 'VPS-CM-01',
        serverHost,
        licenseStatus = 'Active',
        sshUsername: reqUser,
        sshPassword: reqPass,
      } = req.body ?? {};

      const matchedPlan =
        OFFICIAL_PLANS.find((p) => p.id === planId) ??
        OFFICIAL_PLANS.find((p) => p.name.toLowerCase() === String(planName || '').toLowerCase()) ??
        OFFICIAL_PLANS[0];

      const resolvedQuotaGb =
        typeof dataQuotaGb === 'number' && Number.isFinite(dataQuotaGb)
          ? dataQuotaGb
          : (matchedPlan.dataQuotaGb ?? 5);
      const resolvedUsedGb =
        typeof dataUsedGb === 'number' && Number.isFinite(dataUsedGb) ? dataUsedGb : 0;
      const resolvedDurationHours =
        typeof durationHours === 'number' && durationHours > 0
          ? durationHours
          : matchedPlan.durationHours;
      const resolvedMaxSessions =
        typeof maxSessions === 'number' && maxSessions > 0 ? maxSessions : matchedPlan.maxSessions;

      const generatedCreds = createRandomCredentials(String(clientName));
      const sshUsername =
        typeof reqUser === 'string' && reqUser.trim().length >= 3
          ? reqUser.trim()
          : generatedCreds.sshUsername;
      const sshPassword =
        typeof reqPass === 'string' && reqPass.trim().length >= 4
          ? reqPass.trim()
          : generatedCreds.sshPassword;

      const result = await cloudEngine.issueBundle({
        planId: matchedPlan.id,
        planName:
          typeof planName === 'string' && planName.trim()
            ? planName.trim()
            : `${matchedPlan.name} (${matchedPlan.durationLabel})`,
        clientName: String(clientName).trim() || 'Client JTS',
        dataQuotaGb: resolvedQuotaGb,
        dataUsedGb: resolvedUsedGb,
        durationHours: resolvedDurationHours,
        expiresAt: typeof expiresAt === 'string' ? expiresAt : undefined,
        maxSessions: resolvedMaxSessions,
        serverCode: String(serverCode || 'VPS-CM-01'),
        serverHost: typeof serverHost === 'string' ? serverHost : undefined,
        licenseStatus: String(licenseStatus || 'Active'),
        sshUsername,
        sshPassword,
      });

      if (!result.ok) {
        res.status(result.status).json({ status: 'error', error: result.error });
        return;
      }

      res.status(201).json({ status: 'ok', bundle: result.bundle });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur génération configuration Cloud.';
      res.status(500).json({ status: 'error', error: message });
    }
  });

  // 4b. Aperçu manifeste JSON (STRICTEMENT Super Admin — jamais visible côté client)
  app.get(
    '/api/cloud-config/:code/manifest',
    authRbac.requireRoles(['super_admin']),
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const rec = cloudEngine.getInternal(String(req.params.code || ''));
      if (!rec) {
        res.status(404).json({ status: 'error', error: 'Code Cloud introuvable.' });
        return;
      }
      res.json(cloudEngine.toPublicBundle(rec).publicJsonManifest);
    }
  );

  // 4c. Téléchargement privé .npvt (POST uniquement, jamais exposé en URL/QR)
  app.post('/api/cloud-config/:code/download-npvt', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const code = String(req.params.code || '');
    const token =
      typeof req.body?.import_token === 'string'
        ? req.body.import_token
        : typeof req.body?.token === 'string'
          ? req.body.token
          : undefined;
    const rawProto =
      typeof req.body?.prototypeJson === 'string' && req.body.prototypeJson.length > 0
        ? req.body.prototypeJson
        : activeNpvPrototypeJson;

    if (!token) {
      res.status(401).json({ status: 'error', error: "Jeton d'échange requis." });
      return;
    }
    const compiled = cloudEngine.compilePrivateNpvt(code, rawProto, token);
    if (!compiled.ok) {
      res.status(compiled.status).json({ status: 'error', error: compiled.error });
      return;
    }

    res.json({
      status: 'ok',
      filename: compiled.filename,
      content: compiled.content,
    });
  });

  // 4d. Liste, synchronisation quota et révocation serveur (Staff uniquement)
  app.get(
    '/api/admin/cloud-configs',
    authRbac.requireRoles(['super_admin', 'admin', 'manager']),
    (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      res.json({ bundles: cloudEngine.listPublicBundles() });
    }
  );

  app.patch(
    '/api/cloud-config/:code/quota',
    authRbac.requireRoles(['super_admin', 'admin', 'manager']),
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const usedGb = Number(req.body?.usedGb);
      const totalGb = req.body?.totalGb !== undefined ? Number(req.body.totalGb) : undefined;
      if (!Number.isFinite(usedGb) || usedGb < 0) {
        res.status(400).json({ error: 'usedGb numérique >= 0 requis.' });
        return;
      }
      const updated = cloudEngine.updateQuota(String(req.params.code || ''), usedGb, totalGb);
      if (!updated) {
        res.status(404).json({ error: 'Code Cloud introuvable.' });
        return;
      }
      res.json({ status: 'ok', bundle: updated });
    }
  );

  app.post(
    '/api/cloud-config/:code/revoke',
    authRbac.requireRoles(['super_admin', 'admin', 'manager']),
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const revoked = cloudEngine.revoke(String(req.params.code || ''));
      if (!revoked) {
        res.status(404).json({ error: 'Code Cloud introuvable.' });
        return;
      }
      res.json({ status: 'ok', bundle: revoked });
    }
  );

  // 4e. Contrat strict Panel <-> Mobile JUST TECH SERVICES TUNNEL v2.0 (POST uniquement, zéro secret en URL)
  app.get(['/api/cloud-config/:code', '/api/v1/cloud-config/:code'], (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store, private');
    res.status(405).json({
      status: 'error',
      error: 'Méthode GET interdite. Utilisez POST avec device_id pour échanger un Code Cloud.',
    });
  });

  app.post(['/api/cloud-config/:code', '/api/v1/cloud-config/:code'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const code = String(req.params.code || '');
    const deviceId = String(req.body?.device_id || req.body?.deviceId || '');
    const deviceName = String(
      req.body?.device_name || req.body?.deviceName || req.headers['user-agent'] || 'JUST TECH SERVICES TUNNEL'
    );
    const token =
      typeof req.body?.import_token === 'string'
        ? req.body.import_token
        : typeof req.body?.token === 'string'
          ? req.body.token
          : undefined;

    const result = cloudEngine.redeemForDevice(code, deviceId, { deviceName, token });
    if (!result.ok) {
      res.status(result.status).json({
        status: 'error',
        code: result.code,
        error: result.error,
      });
      return;
    }

    res.json(result.payload);
  });

  // 4f. Système Cloud Config v1 & Résolution API (/api/v1/cloud/*) avec contrôle d'accès RBAC 6 rôles
  const resolveRequestOrigin = (req: express.Request): string => {
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto =
      typeof protoHeader === 'string' && protoHeader.length > 0
        ? protoHeader.split(',')[0].trim()
        : req.protocol || 'https';
    const host = req.get('host') || 'panel.justtechservices.xyz';
    return `${proto}://${host}`;
  };

  app.get(
    '/api/v1/cloud/configs',
    authRbac.requireRoles(['super_admin', 'admin', 'manager', 'reseller', 'sub_reseller']),
    (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const origin = resolveRequestOrigin(req);
      const configs = sshCloudRegistry.listForActor(req.authUser!, origin);
      res.json({
        status: 'ok',
        role: req.authUser!.role,
        count: configs.length,
        configs,
      });
    }
  );

  app.post(
    '/api/v1/cloud/configs',
    authRbac.requireRoles(['super_admin', 'admin', 'manager', 'reseller', 'sub_reseller']),
    async (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      try {
        const origin = resolveRequestOrigin(req);
        const { config: incomingConfig, assignedClientName, forceNewCloudCode } = req.body ?? {};
        const result = await sshCloudRegistry.upsertConfig(req.authUser!, incomingConfig, {
          origin,
          assignedClientName: typeof assignedClientName === 'string' ? assignedClientName : '',
          forceNewCloudCode: Boolean(forceNewCloudCode),
        });

        if (!result.ok) {
          authRbac.recordAudit({
            actorEmail: req.authUser!.email,
            actorRole: req.authUser!.role,
            action: 'cloud_v1.publish_denied',
            target: String(incomingConfig?.config_id || 'unknown'),
            outcome: 'DENIED',
            detail: result.error,
          });
          res.status(result.status).json({ status: 'error', code: result.code, error: result.error });
          return;
        }

        authRbac.recordAudit({
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.role,
          action: 'cloud_v1.published',
          target: result.record.cloudCode,
          outcome: 'ALLOWED',
          detail: `Config ${result.record.configId} (${result.record.config.protocol}) publiée pour ${result.record.assignedClientName || 'usage général'}.`,
        });

        res.status(201).json({
          status: 'ok',
          record: result.record,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur publication Cloud Config v1.';
        res.status(500).json({ status: 'error', error: msg });
      }
    }
  );

  app.post(
    '/api/v1/cloud/configs/:code/revoke',
    authRbac.requireRoles(['super_admin', 'admin', 'manager', 'reseller', 'sub_reseller']),
    (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const origin = resolveRequestOrigin(req);
      const code = String(req.params.code || '');
      const result = sshCloudRegistry.setStatus(req.authUser!, code, 'revoked', origin);
      if (!result.ok) {
        authRbac.recordAudit({
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.role,
          action: 'cloud_v1.revoke_denied',
          target: code,
          outcome: 'DENIED',
          detail: result.error,
        });
        res.status(result.status).json({ status: 'error', error: result.error });
        return;
      }

      authRbac.recordAudit({
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: 'cloud_v1.revoked',
        target: result.record.cloudCode,
        outcome: 'ALLOWED',
        detail: `Code Cloud ${result.record.cloudCode} révoqué — résolution API immédiatement bloquée.`,
      });
      res.json({ status: 'ok', record: result.record });
    }
  );

  app.post(
    '/api/v1/cloud/configs/:code/activate',
    authRbac.requireRoles(['super_admin', 'admin', 'manager', 'reseller', 'sub_reseller']),
    (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const origin = resolveRequestOrigin(req);
      const code = String(req.params.code || '');
      const result = sshCloudRegistry.setStatus(req.authUser!, code, 'active', origin);
      if (!result.ok) {
        res.status(result.status).json({ status: 'error', error: result.error });
        return;
      }

      authRbac.recordAudit({
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: 'cloud_v1.reactivated',
        target: result.record.cloudCode,
        outcome: 'ALLOWED',
        detail: `Code Cloud ${result.record.cloudCode} réactivé pour la résolution API.`,
      });
      res.json({ status: 'ok', record: result.record });
    }
  );

  app.delete(
    '/api/v1/cloud/configs/:code',
    authRbac.requireRoles(['super_admin', 'admin', 'manager']),
    (req: AuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      const code = String(req.params.code || '');
      const result = sshCloudRegistry.deleteConfig(req.authUser!, code);
      if (!result.ok) {
        res.status(result.status).json({ status: 'error', error: result.error });
        return;
      }
      res.json({ status: 'ok', deleted: code.toUpperCase() });
    }
  );

  // Contrat API de résolution JUST TECH SERVICES TUNNEL
  // GET : inspection JSON v1 STRICTEMENT réservée au Super Admin (jamais exposée en clair au client via navigateur)
  app.get(
    '/api/v1/cloud/resolve/:code',
    authRbac.requireRoles(['super_admin']),
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const code = String(req.params.code || '');
      const result = sshCloudRegistry.resolveCloudCode(code, {
        deviceId:
          typeof req.headers['x-jts-device-id'] === 'string'
            ? req.headers['x-jts-device-id']
            : 'super-admin-inspector',
        includeSecretsForMobileHandshake: false,
      });

      if (!result.ok) {
        res.status(result.status).json({
          status: 'error',
          code: result.errorCode,
          cloud_code: result.cloudCode,
          revoked_at: result.revokedAt ?? null,
          error: result.error,
        });
        return;
      }

      res.json({
        ...result.payload,
        _meta: {
          resolved_at: result.resolvedAt,
          resolve_count: result.resolveCount,
          delivery_mode: result.deliveryMode,
          notice:
            'Inspection GET Super Admin : secrets SSH masqués. L’app mobile JUST TECH SERVICES TUNNEL utilise POST avec device_id.',
        },
      });
    }
  );

  // POST : Handshake applicatif mobile JUST TECH SERVICES TUNNEL (renvoie le contrat JSON v1 exact)
  app.post('/api/v1/cloud/resolve/:code', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const code = String(req.params.code || '');
    const deviceId = String(req.body?.device_id || req.headers['x-jts-device-id'] || '').trim();
    const redactSecrets = Boolean(req.body?.redact_secrets);

    if (!deviceId) {
      res.status(400).json({
        status: 'error',
        code: 'DEVICE_ID_REQUIRED',
        error: 'Le champ device_id est requis pour le handshake mobile JUST TECH SERVICES TUNNEL.',
      });
      return;
    }

    const result = sshCloudRegistry.resolveCloudCode(code, {
      deviceId,
      includeSecretsForMobileHandshake: !redactSecrets,
    });

    if (!result.ok) {
      res.status(result.status).json({
        status: 'error',
        code: result.errorCode,
        cloud_code: result.cloudCode,
        revoked_at: result.revokedAt ?? null,
        error: result.error,
      });
      return;
    }

    res.json(result.payload);
  });

interface PendingDelivery {
  token: string;
  plan: PlanCatalogItem;
  clientName: string;
  sshUsername: string;
  sshPassword: string;
  cloudRecord: PublicCloudBundleResponse;
  createdAt: number;
}

const pendingDeliveriesStore = new Map<string, PendingDelivery>();

  // 5. Agent IA Autonome (AIPaymentAgent + Gemini gemini-4-hydrogen) :
  //    Interroge l'API opérateur configurée, vérifie les règles Free Test & OM ASSO,
  //    puis déclenche le provisionnement automatique Android Cloud / iPhone .npvt
  app.post('/api/agent/verify-and-provision', async (req: AuthenticatedRequest, res) => {
    try {
      const {
        planId,
        platform = 'pending',
        paymentMethod,
        payerPhone = '',
        transactionRef = '',
        smsProof = '',
        screenshotBase64,
        screenshotMimeType,
        clientName = 'Client JUST TECH',
        accountId = 'client-default',
        deviceFingerprint = 'unknown-device',
        prototypeJson,
      } = req.body ?? {};

      const plan = OFFICIAL_PLANS.find((p) => p.id === planId);
      if (!plan) {
        res.status(400).json({ error: 'Forfait introuvable dans le catalogue officiel.' });
        return;
      }

      if (platform !== 'pending' && platform !== 'android' && platform !== 'iphone') {
        res.status(400).json({ error: 'Plateforme invalide : choisissez android, iphone ou pending.' });
        return;
      }

      if (plan.category === 'OFFRE TEST GRATUIT' && (!req.authUser || req.authUser.role !== 'client')) {
        res.status(401).json({ approved: false, code: 'CLIENT_LOGIN_REQUIRED', error: 'Connectez-vous à votre compte client pour demander un test gratuit.' });
        return;
      }
      const verifiedAccountId = plan.category === 'OFFRE TEST GRATUIT' ? req.authUser!.id : String(accountId);
      const usedOnAccount = accountTestGenerations.get(verifiedAccountId) ?? 0;
      const existingDeviceTest = deviceTestRegistry.get(deviceFingerprint);

      // Garde-fous durs côté serveur pour Test Gratuit
      if (plan.category === 'OFFRE TEST GRATUIT') {
        if (existingDeviceTest) {
          res.status(403).json({
            approved: false,
            code: 'DEVICE_TEST_ALREADY_USED',
            reason:
              "Refus Agent IA : Cet appareil a déjà effectué ou activé l'Offre Test Gratuit (1 seule activation autorisée par appareil).",
            remainingAccountTests: Math.max(0, 2 - usedOnAccount),
            deviceAlreadyUsed: true,
          });
          return;
        }
        if (usedOnAccount >= 2) {
          res.status(403).json({
            approved: false,
            code: 'ACCOUNT_TEST_LIMIT_REACHED',
            reason:
              'Refus Agent IA : Ce compte client a atteint la limite maximale de 2 générations de code test gratuit.',
            remainingAccountTests: 0,
            deviceAlreadyUsed: false,
          });
          return;
        }
      }

      const provider: PaymentProvider =
        plan.category === 'OFFRE TEST GRATUIT'
          ? 'Gratuit'
          : (paymentMethod as PaymentProvider) || 'MTN Mobile Money';

      const result = await paymentAgent.verifyAndProvision({
        planId: plan.id,
        planName: plan.name,
        planCategory: plan.category,
        expectedAmountFcfa: plan.priceFcfa,
        provider,
        payerPhone,
        transactionRef,
        smsProof,
        screenshotBase64,
        screenshotMimeType,
        clientName,
        accountId: verifiedAccountId,
        deviceFingerprint,
        platform,
        prototypeJson,
      });

      if (result.useOmMerchantFallback) {
        res.status(409).json({
          approved: false,
          code: 'ORANGE_CEILING_REACHED_USE_OM_ASSO',
          useOmMerchantFallback: true,
          merchantCode: result.merchantCode,
          reason: result.monitored.reasoning,
        });
        return;
      }

      if (!result.approved || !result.monitored.provisionedOutcome) {
        res.status(422).json({
          approved: false,
          code: result.monitored.forensicReport?.isFalsified ? 'FORGERY_DETECTED' : 'AGENT_REJECTED',
          reason: result.monitored.reasoning,
          fraudRisk: result.monitored.fraudRisk,
          forensicReport: result.monitored.forensicReport ?? null,
          monitorId: result.monitored.id,
        });
        return;
      }

      const outcome = result.monitored.provisionedOutcome;
      res.json({
        approved: true,
        monitorId: result.monitored.id,
        verificationSource: result.monitored.verificationSource,
        deliveryToken: outcome.deliveryToken,
        platform,
        plan,
        reasoning: result.monitored.reasoning,
        fraudRisk: result.monitored.fraudRisk,
        forensicReport: result.monitored.forensicReport ?? null,
        sshUsername: outcome.sshUsername,
        sshPassword: outcome.sshPassword,
        cloudCode: outcome.cloudCode ?? null,
        cloudRecord: outcome.cloudRecord ?? null,
        npvFilename: outcome.npvFilename ?? null,
        npvFileContent: outcome.npvFileContent ?? null,
        remainingAccountTests: Math.max(0, 2 - (accountTestGenerations.get(verifiedAccountId) ?? usedOnAccount)),
        deviceAlreadyUsed: deviceTestRegistry.has(deviceFingerprint),
        orangeCeilingExceeded: isOrangeCeilingExceeded(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur Agent IA serveur.';
      res.status(500).json({ approved: false, error: message });
    }
  });

  // 5c. Supervision AIPaymentAgent : historique des audits anti-falsification & captures
  app.get(
    '/api/agent/monitors',
    authRbac.requireRoles(['super_admin', 'admin', 'manager']),
    (_req, res) => {
      res.json({
        transactions: paymentAgent.getMonitoredTransactions(),
      });
    }
  );

  // 5e. Alertes automatiques AIPaymentAgent (plafond Orange, provisionnements, échecs)
  app.get('/api/agent/alerts', authRbac.requireRoles(['super_admin', 'admin', 'manager']), (_req, res) => {
    res.json({
      alerts: paymentAgent.getAlerts(),
      orangeCeilingExceeded: paymentAgent.isOrangeCeilingExceeded(),
    });
  });

  // 5b. Sélection d'OS post-paiement (Android Cloud Key vs iPhone .npvt depuis prototype)
  app.post('/api/delivery/select-os', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const deliveryToken = typeof req.body?.deliveryToken === 'string' ? req.body.deliveryToken.trim() : '';
    const platform = req.body?.platform;

    if (platform !== 'android' && platform !== 'iphone') {
      res.status(400).json({ error: 'Plateforme invalide : choisissez android ou iphone.' });
      return;
    }

    const pending = deliveryToken ? pendingDeliveriesStore.get(deliveryToken) : undefined;
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      if (deliveryToken) pendingDeliveriesStore.delete(deliveryToken);
      res.status(410).json({ error: 'Validation expirée ou absente. Reprenez la vérification du paiement.' });
      return;
    }
    // Un jeton de livraison ne peut être consommé qu'une seule fois.
    pendingDeliveriesStore.delete(deliveryToken);

    if (platform === 'android') {
      res.json({
        platform: 'android',
        cloudRecord: pending.cloudRecord,
        sshUsername: pending.sshUsername,
      });
      return;
    }

    const activeProto =
      typeof req.body?.prototypeJson === 'string' && req.body.prototypeJson.length > 0
        ? req.body.prototypeJson
        : activeNpvPrototypeJson;
    const compiled = cloudEngine.compilePrivateNpvt(pending.cloudRecord.code, activeProto, pending.cloudRecord.exchangeToken);
    if (!compiled.ok) {
      res.status(compiled.status).json({ error: compiled.error });
      return;
    }
    res.json({
      platform: 'iphone',
      cloudRecord: pending.cloudRecord,
      npvFilename: compiled.filename,
      npvFileContent: compiled.content,
      sshUsername: pending.sshUsername,
    });
  });

  // 6. Assistant Chat Agent IA (vérification manuelle, support règles, OM ASSO)
  app.post('/api/agent/chat', async (req, res) => {
    try {
      const { message, accountId = 'client-default' } = req.body ?? {};
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message requis.' });
        return;
      }

      const ai = getGeminiClient();
      const usedTests = accountTestGenerations.get(accountId) ?? 0;
      const context = `
Tu es l'Agent IA officiel de JUST TECH SERVICES TUNNEL (Android & iPhone).
Catalogue officiel (Gigas & Prix FCFA) :
- NPV TUNNEL : 500 FCFA (5Go/5j), 1000 FCFA (10Go/7j), 2000 FCFA (20Go/10j), 2500 FCFA (25Go/12j), 4000 FCFA (40Go/15j), 5000 FCFA (60Go/20j).
- OFFRE TEST GRATUIT : 3 Go / 2 heures (1 seul test par appareil, 2 générations max par compte client ; ce compte en est à ${usedTests}/2).
Paiements officiels :
- MTN MoMo : ${paymentGatewayState.mtnBeneficiary} (${paymentGatewayState.mtnNumber})
- Orange Money : ${paymentGatewayState.orangeBeneficiary} (${paymentGatewayState.orangeNumber})
- Si plafond Orange atteint (état actuel : ${isOrangeCeilingExceeded() ? 'PLAFOND ATTEINT' : 'Normal'}) : Paiement Marchand Orange OM ASSO code ${paymentGatewayState.orangeMerchantOmAsso}.
Livraison après paiement : Android -> Code Cloud ; iPhone -> Fichier .npvt généré automatiquement.
Réponds en français de façon claire, précise et directe.`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: message,
          config: { systemInstruction: context },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCapacityError =
          /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(errorMessage);
        if (!isCapacityError) throw error;

        // Retry transient capacity/rate-limit errors with Google's lower-cost Flash-Lite model.
        response = await ai.models.generateContent({
          model: 'gemini-3.5-flash-lite',
          contents: message,
          config: { systemInstruction: context },
        });
      }

      res.json({ reply: response.text ?? '' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erreur Agent IA.';
      res.status(500).json({ error: msg });
    }
  });

  // 7. Téléchargement direct de l'archive finale ZIP & SHA-256
  const zipFilePath = path.resolve(__dirname, 'deliverable', 'dist', 'JUST_TECH_SERVICES_PANEL_FINAL.zip');
  const shaFilePath = path.resolve(__dirname, 'deliverable', 'dist', 'JUST_TECH_SERVICES_PANEL_FINAL.zip.sha256');

  app.get(['/api/deliverable/download-zip', '/JUST_TECH_SERVICES_PANEL_FINAL.zip'], (_req, res) => {
    if (!fs.existsSync(zipFilePath)) {
      res.status(404).json({ error: 'Archive ZIP non générée.' });
      return;
    }
    res.download(zipFilePath, 'JUST_TECH_SERVICES_PANEL_FINAL.zip');
  });

  app.get('/JUST_TECH_SERVICES_PANEL_FINAL.zip.sha256', (_req, res) => {
    if (!fs.existsSync(shaFilePath)) {
      res.status(404).json({ error: 'Empreinte SHA-256 introuvable.' });
      return;
    }
    res.sendFile(shaFilePath);
  });

  // Vite middleware en dev ou fichiers statiques dist en production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JUST TECH SERVICES Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
