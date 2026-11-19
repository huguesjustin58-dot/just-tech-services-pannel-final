import {
  INITIAL_NPV_PROTOTYPE,
  INITIAL_SERVERS,
  PAYMENT_ACCOUNTS,
  PLANS,
  compileNpvFromPrototype,
} from '../data/maquetteData';
import {
  CloudActivationRecord,
  DeliveryPlatform,
  LicenseRecord,
  NpvPrototype,
  PlanOffer,
  ServerNode,
} from '../types/panel';

export type TestCodeStatus = 'Généré' | 'Activé' | 'Expiré' | 'Révoqué';

export type ActivityCategory =
  | 'subscription'
  | 'test_lifecycle'
  | 'compliance'
  | 'security';

export type ActivitySeverity = 'ok' | 'info' | 'warn' | 'critical';

export interface BusinessRulesConfig {
  maxTestGenerationsPerAccount: number;
  maxTestActivationsPerDevice: number;
  testQuotaGb: number;
  testDurationHours: number;
  maxSshSessionsCap: number;
  orangeCeilingFcfa: number;
}

export interface TestCodeRecord {
  id: string;
  code: string;
  accountId: string;
  clientName: string;
  deviceFingerprint: string;
  platform: DeliveryPlatform;
  status: TestCodeStatus;
  quotaGb: number;
  usedGb: number;
  sshUsername: string;
  serverCode: string;
  createdAtMs: number;
  expiresAtMs: number;
  createdAtLabel: string;
  expiresAtLabel: string;
  activatedAtLabel?: string;
  revokedReason?: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  action: string;
  actor: string;
  target: string;
  severity: ActivitySeverity;
  ruleId?: string;
  detail: string;
}

export interface SubscriptionSimulationInput {
  planId: string;
  clientName: string;
  accountId: string;
  deviceFingerprint: string;
  platform: DeliveryPlatform;
  paymentChannel: 'MTN Mobile Money' | 'Orange Money' | 'Orange OM ASSO' | 'Gratuit';
  declaredAmountFcfa?: number;
  transactionRef?: string;
  smsProof?: string;
  hasScreenshotProof?: boolean;
  orangeCeilingExceeded?: boolean;
  servers?: ServerNode[];
  prototype?: NpvPrototype;
}

export interface SubscriptionSimulationResult {
  approved: boolean;
  ruleViolationCode?:
    | 'PLAN_NOT_FOUND'
    | 'ACCOUNT_TEST_QUOTA_REACHED'
    | 'DEVICE_TEST_ALREADY_USED'
    | 'ORANGE_CEILING_USE_OM_ASSO'
    | 'AMOUNT_MISMATCH'
    | 'MISSING_PAYMENT_PROOF'
    | 'NO_AVAILABLE_VPS_NODE';
  reason: string;
  selectedServer?: ServerNode;
  sshUsername?: string;
  sshPassword?: string;
  cloudCode?: string;
  npvFilename?: string;
  npvContent?: string;
  testCodeRecord?: TestCodeRecord;
  appliedRules: string[];
}

export interface PaymentVerificationInput {
  planId: string;
  clientName: string;
  accountId: string;
  deviceFingerprint: string;
  paymentChannel: 'MTN Mobile Money' | 'Orange Money' | 'Orange OM ASSO' | 'Gratuit';
  declaredAmountFcfa?: number;
  transactionRef?: string;
  smsProof?: string;
  hasScreenshotProof?: boolean;
  orangeCeilingExceeded?: boolean;
}

export interface PaymentVerificationResult {
  verified: boolean;
  status: 'PAID' | 'PENDING_PROOF' | 'REJECTED' | 'CEILING_FALLBACK';
  ruleViolationCode?: SubscriptionSimulationResult['ruleViolationCode'];
  reason: string;
  appliedRules: string[];
  recommendedMerchantCode?: string;
}

export interface CompiledIphoneNpvArtifact {
  filename: string;
  extension: '.npvt' | '.json';
  content: string;
}

export interface ComplianceAnomaly {
  id: string;
  ruleId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  target: string;
  message: string;
  autoRemediated: boolean;
}

export interface SupervisionReport {
  auditedAt: string;
  compliant: boolean;
  complianceScore: number;
  rulesChecked: string[];
  anomalies: ComplianceAnomaly[];
  metrics: {
    totalLogs: number;
    blockedViolations: number;
    totalTestCodes: number;
    activeTestCodes: number;
    expiredTestCodes: number;
    revokedTestCodes: number;
    trackedAccounts: number;
    trackedDevices: number;
  };
}

export interface ServiceAIAgentSnapshot {
  rules: BusinessRulesConfig;
  testCodes: TestCodeRecord[];
  activityLogs: ActivityLogEntry[];
  lastSupervision: SupervisionReport;
}

const DEFAULT_RULES: BusinessRulesConfig = {
  maxTestGenerationsPerAccount: 2,
  maxTestActivationsPerDevice: 1,
  testQuotaGb: 3,
  testDurationHours: 2,
  maxSshSessionsCap: 8,
  orangeCeilingFcfa: 1500000,
};

function formatShortTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export class ServiceAIAgent {
  private readonly rules: BusinessRulesConfig;
  private testCodes: TestCodeRecord[] = [];
  private activityLogs: ActivityLogEntry[] = [];
  private blockedViolationsCount = 0;
  private readonly listeners = new Set<(snapshot: ServiceAIAgentSnapshot) => void>();

  // Compteurs persistants par compte client et par empreinte appareil
  private readonly accountGenerationCounts = new Map<string, number>();
  private readonly deviceActivationMap = new Map<string, string>();

  constructor(
    rules: Partial<BusinessRulesConfig> = {},
    seedInitialState = true
  ) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    if (seedInitialState) {
      this.seedBaseline();
    }
  }

  private seedBaseline(): void {
    const now = Date.now();
    const activeSeed: TestCodeRecord = {
      id: 'tst-seed-1',
      code: 'JTS-TST-4A91-K2',
      accountId: 'client-yfotso14',
      clientName: 'Yannick Fotso',
      deviceFingerprint: 'DEV-YFOTSO-88A1',
      platform: 'android',
      status: 'Activé',
      quotaGb: this.rules.testQuotaGb,
      usedGb: 1.4,
      sshUsername: 'jts_tst_yfotso',
      serverCode: 'VPS-CM-01',
      createdAtMs: now - 35 * 60 * 1000,
      expiresAtMs: now + 85 * 60 * 1000,
      createdAtLabel: formatShortTime(now - 35 * 60 * 1000),
      expiresAtLabel: formatShortTime(now + 85 * 60 * 1000),
      activatedAtLabel: formatShortTime(now - 30 * 60 * 1000),
    };

    const expiredSeed: TestCodeRecord = {
      id: 'tst-seed-2',
      code: 'JTS-TST-7C02-M9',
      accountId: 'client-setoh33',
      clientName: 'Samuel Etoh',
      deviceFingerprint: 'DEV-SETOH-19F4',
      platform: 'iphone',
      status: 'Expiré',
      quotaGb: this.rules.testQuotaGb,
      usedGb: 3.0,
      sshUsername: 'jts_tst_setoh',
      serverCode: 'VPS-FR-02',
      createdAtMs: now - 4 * 3600 * 1000,
      expiresAtMs: now - 2 * 3600 * 1000,
      createdAtLabel: formatShortTime(now - 4 * 3600 * 1000),
      expiresAtLabel: formatShortTime(now - 2 * 3600 * 1000),
      activatedAtLabel: formatShortTime(now - 3.8 * 3600 * 1000),
    };

    this.testCodes = [activeSeed, expiredSeed];
    this.accountGenerationCounts.set(activeSeed.accountId, 1);
    this.accountGenerationCounts.set(expiredSeed.accountId, 1);
    this.deviceActivationMap.set(activeSeed.deviceFingerprint, activeSeed.code);
    this.deviceActivationMap.set(expiredSeed.deviceFingerprint, expiredSeed.code);

    this.activityLogs = [
      {
        id: 'act-seed-1',
        timestamp: formatShortTime(now - 30 * 60 * 1000),
        category: 'test_lifecycle',
        action: 'test_code.activated',
        actor: activeSeed.clientName,
        target: activeSeed.code,
        severity: 'ok',
        ruleId: 'QUOTA_2_TESTS_PER_ACCOUNT',
        detail: `Activation 3 Go / 2h sur ${activeSeed.deviceFingerprint} (1/2 tests compte).`,
      },
      {
        id: 'act-seed-2',
        timestamp: formatShortTime(now - 2 * 3600 * 1000),
        category: 'test_lifecycle',
        action: 'test_code.expired',
        actor: 'ServiceAIAgent',
        target: expiredSeed.code,
        severity: 'info',
        ruleId: 'TEST_EXPIRATION_HYGIENE',
        detail: `Quota 3.0/3.0 Go atteint pour ${expiredSeed.clientName} — verrouillage SSH exécuté.`,
      },
      {
        id: 'act-seed-3',
        timestamp: formatShortTime(now - 15 * 60 * 1000),
        category: 'subscription',
        action: 'subscription.validated',
        actor: 'ServiceAIAgent',
        target: 'Franck Mbarga',
        severity: 'ok',
        ruleId: 'PROVISIONING_LOWEST_LOAD',
        detail: 'Formule NPV 60 Go (5 000 FCFA) validée sur VPS-CM-01.',
      },
    ];
  }

  public subscribe(listener: (snapshot: ServiceAIAgentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((cb) => cb(snap));
  }

  public getRules(): BusinessRulesConfig {
    return { ...this.rules };
  }

  public getTestCodes(): TestCodeRecord[] {
    return this.testCodes.map((t) => ({ ...t }));
  }

  public getActivityLogs(): ActivityLogEntry[] {
    return [...this.activityLogs];
  }

  public getSnapshot(licenses?: LicenseRecord[]): ServiceAIAgentSnapshot {
    return {
      rules: this.getRules(),
      testCodes: this.getTestCodes(),
      activityLogs: this.getActivityLogs(),
      lastSupervision: this.evaluateCompliance(licenses),
    };
  }

  /**
   * Enregistre un événement dans les logs d'activité supervisés par ServiceAIAgent.
   */
  public logActivity(
    entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>
  ): ActivityLogEntry {
    const created: ActivityLogEntry = {
      id: generateId('act'),
      timestamp: formatShortTime(Date.now()),
      ...entry,
    };
    this.activityLogs = [created, ...this.activityLogs.slice(0, 99)];
    this.emit();
    return created;
  }

  /**
   * Vérifie l'éligibilité stricte d'un compte client et d'un appareil pour l'Offre Test Gratuit.
   */
  public checkTestEligibility(accountId: string, deviceFingerprint: string): {
    eligible: boolean;
    accountTestsUsed: number;
    accountTestsRemaining: number;
    deviceAlreadyUsed: boolean;
    boundDeviceCode: string | null;
    blockingReason?: string;
  } {
    const accountTestsUsed = this.accountGenerationCounts.get(accountId) ?? 0;
    const boundDeviceCode = this.deviceActivationMap.get(deviceFingerprint) ?? null;
    const deviceAlreadyUsed = Boolean(boundDeviceCode);

    let blockingReason: string | undefined;
    if (deviceAlreadyUsed) {
      blockingReason = `Appareil bloqué : ce terminal (${deviceFingerprint}) a déjà utilisé un test (${boundDeviceCode}). Limite : ${this.rules.maxTestActivationsPerDevice} test/appareil.`;
    } else if (accountTestsUsed >= this.rules.maxTestGenerationsPerAccount) {
      blockingReason = `Quota client épuisé : le compte ${accountId} a déjà généré ${accountTestsUsed}/${this.rules.maxTestGenerationsPerAccount} codes test.`;
    }

    return {
      eligible: !blockingReason,
      accountTestsUsed,
      accountTestsRemaining: Math.max(
        0,
        this.rules.maxTestGenerationsPerAccount - accountTestsUsed
      ),
      deviceAlreadyUsed,
      boundDeviceCode,
      blockingReason,
    };
  }

  /**
   * Enforces the strict Free Test limits:
   * - max 2 free test generations per client account
   * - max 1 free test activation per device fingerprint
   */
  public enforceFreeTestRules(accountId: string, deviceFingerprint: string) {
    return this.checkTestEligibility(accountId, deviceFingerprint);
  }

  /**
   * Verifies payment status using internal business rules, submitted proof
   * (screenshot/reference/SMS), price integrity, OM ASSO fallback, and free-test limits.
   */
  public verifyPaymentStatus(input: PaymentVerificationInput): PaymentVerificationResult {
    const appliedRules: string[] = [];
    const plan = PLANS.find((p) => p.id === input.planId);

    if (!plan) {
      this.blockedViolationsCount += 1;
      this.logActivity({
        category: 'compliance',
        action: 'payment.plan_not_found',
        actor: input.clientName,
        target: input.planId,
        severity: 'warn',
        ruleId: 'CATALOG_INTEGRITY',
        detail: `Offre inconnue (${input.planId}) refusée par ServiceAIAgent.`,
      });
      return {
        verified: false,
        status: 'REJECTED',
        ruleViolationCode: 'PLAN_NOT_FOUND',
        reason: `Forfait "${input.planId}" introuvable dans le catalogue officiel JUST TECH SERVICES.`,
        appliedRules,
      };
    }

    appliedRules.push('CATALOG_VERIFIED');

    if (plan.category === 'OFFRE TEST GRATUIT') {
      const eligibility = this.enforceFreeTestRules(input.accountId, input.deviceFingerprint);
      appliedRules.push('QUOTA_2_TESTS_PER_ACCOUNT', 'ONE_TEST_PER_DEVICE');

      if (!eligibility.eligible) {
        this.blockedViolationsCount += 1;
        const code = eligibility.deviceAlreadyUsed
          ? 'DEVICE_TEST_ALREADY_USED'
          : 'ACCOUNT_TEST_QUOTA_REACHED';
        this.logActivity({
          category: 'compliance',
          action: 'test_code.blocked',
          actor: input.clientName,
          target: `${input.accountId} / ${input.deviceFingerprint}`,
          severity: 'critical',
          ruleId: eligibility.deviceAlreadyUsed
            ? 'ONE_TEST_PER_DEVICE'
            : 'QUOTA_2_TESTS_PER_ACCOUNT',
          detail: eligibility.blockingReason || 'Limite test gratuit atteinte.',
        });
        return {
          verified: false,
          status: 'REJECTED',
          ruleViolationCode: code,
          reason: eligibility.blockingReason || 'Non éligible au test gratuit.',
          appliedRules,
        };
      }

      return {
        verified: true,
        status: 'PAID',
        reason: `Offre Test Gratuit autorisée (${eligibility.accountTestsRemaining} génération(s) restante(s) sur ce compte).`,
        appliedRules,
      };
    }

    appliedRules.push('ORANGE_CEILING_OM_ASSO', 'PAID_PROOF_REQUIRED');

    if (input.paymentChannel === 'Orange Money' && input.orangeCeilingExceeded) {
      this.blockedViolationsCount += 1;
      this.logActivity({
        category: 'compliance',
        action: 'payment.orange_ceiling_redirect',
        actor: input.clientName,
        target: PAYMENT_ACCOUNTS.orangeNumber,
        severity: 'warn',
        ruleId: 'ORANGE_CEILING_OM_ASSO',
        detail: `Plafond Orange atteint -> redirection imposée vers OM ASSO ${PAYMENT_ACCOUNTS.orangeMerchantOmAsso}.`,
      });
      return {
        verified: false,
        status: 'CEILING_FALLBACK',
        ruleViolationCode: 'ORANGE_CEILING_USE_OM_ASSO',
        recommendedMerchantCode: PAYMENT_ACCOUNTS.orangeMerchantOmAsso,
        reason: `Le numéro Orange Money (${PAYMENT_ACCOUNTS.orangeNumber}) a atteint son plafond. Basculez vers le paiement marchand OM ASSO : ${PAYMENT_ACCOUNTS.orangeMerchantOmAsso}.`,
        appliedRules,
      };
    }

    if (
      typeof input.declaredAmountFcfa === 'number' &&
      input.declaredAmountFcfa < plan.priceFcfa
    ) {
      this.blockedViolationsCount += 1;
      this.logActivity({
        category: 'compliance',
        action: 'subscription.amount_mismatch',
        actor: input.clientName,
        target: plan.name,
        severity: 'warn',
        ruleId: 'PRICE_INTEGRITY',
        detail: `Montant insuffisant : ${input.declaredAmountFcfa} FCFA reçus vs ${plan.priceFcfa} FCFA attendus.`,
      });
      return {
        verified: false,
        status: 'REJECTED',
        ruleViolationCode: 'AMOUNT_MISMATCH',
        reason: `Montant insuffisant pour ${plan.name} : ${plan.priceFcfa} FCFA requis (${input.declaredAmountFcfa} FCFA déclarés).`,
        appliedRules,
      };
    }

    const hasRef = Boolean(input.transactionRef && input.transactionRef.trim().length >= 5);
    const hasSms = Boolean(input.smsProof && input.smsProof.trim().length >= 10);
    if (!input.hasScreenshotProof && !hasRef && !hasSms) {
      this.blockedViolationsCount += 1;
      this.logActivity({
        category: 'security',
        action: 'subscription.missing_proof',
        actor: input.clientName,
        target: plan.name,
        severity: 'warn',
        ruleId: 'PAID_PROOF_REQUIRED',
        detail: 'Tentative de validation sans capture d’écran, SMS ni référence valide.',
      });
      return {
        verified: false,
        status: 'PENDING_PROOF',
        ruleViolationCode: 'MISSING_PAYMENT_PROOF',
        reason:
          'Preuve de paiement requise : fournissez une capture d’écran, une référence (>= 5 car.) ou un SMS opérateur.',
        appliedRules,
      };
    }

    return {
      verified: true,
      status: 'PAID',
      reason: `Paiement de ${plan.priceFcfa.toLocaleString('fr-FR')} FCFA vérifié pour ${plan.name} via ${input.paymentChannel}.`,
      appliedRules,
    };
  }

  /**
   * Generates a unique Android Cloud Configuration Key (JTS-CLD-XXXX-XXXX)
   * so clients can activate their tunnel inside the Android VPN app.
   */
  public generateAndroidCloudCode(params: {
    clientName: string;
    planName: string;
    sshUsername: string;
    serverCode?: string;
    explicitCode?: string;
  }): CloudActivationRecord {
    const seg1 = Math.random().toString(36).slice(2, 6).toUpperCase();
    const seg2 = Math.random().toString(36).slice(2, 6).toUpperCase();
    const record: CloudActivationRecord = {
      id: generateId('cld'),
      code: params.explicitCode || `JTS-CLD-${seg1}-${seg2}`,
      clientName: params.clientName,
      planName: params.planName,
      sshUsername: params.sshUsername,
      serverCode: params.serverCode || 'VPS-CM-01',
      status: 'Prêt',
      createdAt: formatShortTime(Date.now()),
    };

    this.logActivity({
      category: 'subscription',
      action: 'cloud_code.generated',
      actor: 'ServiceAIAgent',
      target: record.code,
      severity: 'ok',
      detail: `Code Cloud Android ${record.code} généré pour ${record.clientName} (${record.sshUsername} · ${record.serverCode}).`,
    });

    return record;
  }

  /**
   * Builds client-specific .npvt/.json file contents for iPhone NPV Tunnel
   * by injecting dynamic sshUsername and sshPassword into the Super Admin prototype.
   */
  public buildIphoneNpvContent(params: {
    sshUsername: string;
    sshPassword: string;
    clientName: string;
    prototype?: NpvPrototype;
  }): CompiledIphoneNpvArtifact {
    const proto = params.prototype ?? INITIAL_NPV_PROTOTYPE;
    const content = compileNpvFromPrototype(
      proto.rawTemplateJson,
      params.sshUsername,
      params.sshPassword,
      params.clientName
    );
    const filename = `justtech-${params.sshUsername}-iphone${proto.fileExtension}`;

    this.logActivity({
      category: 'subscription',
      action: 'iphone_npv.built',
      actor: 'ServiceAIAgent',
      target: filename,
      severity: 'ok',
      detail: `Profil iPhone ${filename} compilé depuis ${proto.name} (${proto.version}) pour ${params.clientName}.`,
    });

    return {
      filename,
      extension: proto.fileExtension,
      content,
    };
  }

  /**
   * Sélectionne automatiquement le nœud VPS en ligne le moins chargé ayant des sessions disponibles.
   */
  public selectOptimalServer(servers: ServerNode[] = INITIAL_SERVERS): ServerNode | null {
    const verifiedOnline = servers
      .filter((s) => s.status === 'En ligne' && s.activeSessions < s.maxSessions)
      .sort(
        (a, b) =>
          a.loadScore - b.loadScore ||
          (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER)
      );
    if (verifiedOnline.length > 0) {
      return verifiedOnline[0];
    }
    const availableFallback = servers
      .filter((s) => s.status === 'Non vérifié' && s.activeSessions < s.maxSessions)
      .sort((a, b) => a.loadScore - b.loadScore);
    return availableFallback[0] ?? null;
  }

  /**
   * Simule la validation complète d'un abonnement (vérification paiement, plafond OM ASSO,
   * quotas test gratuit, sélection du nœud VPS et génération Android Cloud / iPhone .npvt).
   */
  public simulateSubscriptionValidation(
    input: SubscriptionSimulationInput
  ): SubscriptionSimulationResult {
    const paymentCheck = this.verifyPaymentStatus({
      planId: input.planId,
      clientName: input.clientName,
      accountId: input.accountId,
      deviceFingerprint: input.deviceFingerprint,
      paymentChannel: input.paymentChannel,
      declaredAmountFcfa: input.declaredAmountFcfa,
      transactionRef: input.transactionRef,
      smsProof: input.smsProof,
      hasScreenshotProof: input.hasScreenshotProof,
      orangeCeilingExceeded: input.orangeCeilingExceeded,
    });

    if (!paymentCheck.verified) {
      return {
        approved: false,
        ruleViolationCode: paymentCheck.ruleViolationCode,
        reason: paymentCheck.reason,
        appliedRules: paymentCheck.appliedRules,
      };
    }

    const plan = PLANS.find((p) => p.id === input.planId)!;
    const appliedRules = [...paymentCheck.appliedRules];

    // Sélection du nœud VPS disponible le moins chargé
    const server = this.selectOptimalServer(input.servers ?? INITIAL_SERVERS);
    if (!server) {
      this.logActivity({
        category: 'compliance',
        action: 'provisioning.no_capacity',
        actor: 'ServiceAIAgent',
        target: input.clientName,
        severity: 'critical',
        ruleId: 'PROVISIONING_LOWEST_LOAD',
        detail: 'Aucun nœud VPS en ligne avec capacité disponible.',
      });
      return {
        approved: false,
        ruleViolationCode: 'NO_AVAILABLE_VPS_NODE',
        reason: 'Aucun nœud VPS en ligne n’a de sessions disponibles actuellement.',
        appliedRules,
      };
    }
    appliedRules.push('PROVISIONING_LOWEST_LOAD');

    // Offre Test Gratuit -> émission et suivi du cycle de vie via issueTestCode
    if (plan.category === 'OFFRE TEST GRATUIT') {
      const issued = this.issueTestCode({
        accountId: input.accountId,
        clientName: input.clientName,
        deviceFingerprint: input.deviceFingerprint,
        platform: input.platform,
        serverCode: server.code,
      });
      if (!issued.ok || !issued.record) {
        return {
          approved: false,
          ruleViolationCode: 'ACCOUNT_TEST_QUOTA_REACHED',
          reason: issued.error || 'Échec de génération du code test.',
          appliedRules,
        };
      }

      const sshPass = `Tst#${Math.floor(1000 + Math.random() * 8999)}`;
      const npvArtifact =
        input.platform === 'iphone'
          ? this.buildIphoneNpvContent({
              sshUsername: issued.record.sshUsername,
              sshPassword: sshPass,
              clientName: input.clientName,
              prototype: input.prototype,
            })
          : undefined;

      return {
        approved: true,
        reason: `Test Gratuit 3 Go / 2h validé (${issued.remainingAccountTests} génération(s) restante(s) sur ce compte).`,
        selectedServer: server,
        sshUsername: issued.record.sshUsername,
        sshPassword: sshPass,
        cloudCode: input.platform === 'android' ? issued.record.code : undefined,
        npvFilename: npvArtifact?.filename,
        npvContent: npvArtifact?.content,
        testCodeRecord: issued.record,
        appliedRules,
      };
    }

    // Abonnement payant -> génération identifiants & artefact OS
    const cleanSlug =
      input.clientName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'client';
    const sshUsername = `jts_${cleanSlug}${Math.floor(10 + Math.random() * 89)}`;
    const sshPassword = `Jts#${Math.floor(1000 + Math.random() * 8999)}Kx`;

    const cloudRecord =
      input.platform === 'android'
        ? this.generateAndroidCloudCode({
            clientName: input.clientName,
            planName: `${plan.name} (${plan.durationLabel})`,
            sshUsername,
            serverCode: server.code,
          })
        : undefined;

    const npvArtifact =
      input.platform === 'iphone'
        ? this.buildIphoneNpvContent({
            sshUsername,
            sshPassword,
            clientName: input.clientName,
            prototype: input.prototype,
          })
        : undefined;

    this.logActivity({
      category: 'subscription',
      action: 'subscription.simulated_ok',
      actor: input.clientName,
      target: `${plan.name} · ${server.code}`,
      severity: 'ok',
      ruleId: 'PROVISIONING_LOWEST_LOAD',
      detail: `Validation simulée (${input.paymentChannel}) -> ${
        input.platform === 'android'
          ? `Cloud ${cloudRecord?.code}`
          : `iOS .npvt (${sshUsername})`
      }.`,
    });

    return {
      approved: true,
      reason: `Abonnement ${plan.name} (${plan.priceFcfa.toLocaleString('fr-FR')} FCFA) validé via ${input.paymentChannel} sur ${server.code}.`,
      selectedServer: server,
      sshUsername,
      sshPassword,
      cloudCode: cloudRecord?.code,
      npvFilename: npvArtifact?.filename,
      npvContent: npvArtifact?.content,
      appliedRules,
    };
  }

  /**
   * Émet un nouveau code de test (3 Go / 2h) en appliquant le quota strict :
   * 2 générations max par compte client & 1 test max par appareil.
   */
  public issueTestCode(params: {
    accountId: string;
    clientName: string;
    deviceFingerprint: string;
    platform: DeliveryPlatform;
    serverCode?: string;
    explicitCode?: string;
  }): {
    ok: boolean;
    record?: TestCodeRecord;
    error?: string;
    remainingAccountTests: number;
  } {
    const eligibility = this.checkTestEligibility(params.accountId, params.deviceFingerprint);
    if (!eligibility.eligible) {
      this.blockedViolationsCount += 1;
      this.logActivity({
        category: 'test_lifecycle',
        action: 'test_code.issue_denied',
        actor: params.clientName,
        target: params.accountId,
        severity: 'critical',
        ruleId: eligibility.deviceAlreadyUsed
          ? 'ONE_TEST_PER_DEVICE'
          : 'QUOTA_2_TESTS_PER_ACCOUNT',
        detail: eligibility.blockingReason || 'Quota de test dépassé.',
      });
      return {
        ok: false,
        error: eligibility.blockingReason,
        remainingAccountTests: eligibility.accountTestsRemaining,
      };
    }

    const now = Date.now();
    const expiresMs = now + this.rules.testDurationHours * 3600 * 1000;
    const randA = Math.random().toString(36).slice(2, 6).toUpperCase();
    const randB = Math.random().toString(36).slice(2, 4).toUpperCase();
    const code = params.explicitCode || `JTS-TST-${randA}-${randB}`;
    const clean =
      params.clientName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 7) || 'cli';

    const record: TestCodeRecord = {
      id: generateId('tst'),
      code,
      accountId: params.accountId,
      clientName: params.clientName,
      deviceFingerprint: params.deviceFingerprint,
      platform: params.platform,
      status: 'Généré',
      quotaGb: this.rules.testQuotaGb,
      usedGb: 0,
      sshUsername: `jts_tst_${clean}${Math.floor(10 + Math.random() * 89)}`,
      serverCode: params.serverCode || 'VPS-CM-01',
      createdAtMs: now,
      expiresAtMs: expiresMs,
      createdAtLabel: formatShortTime(now),
      expiresAtLabel: formatShortTime(expiresMs),
    };

    const nextCount = eligibility.accountTestsUsed + 1;
    this.accountGenerationCounts.set(params.accountId, nextCount);
    this.deviceActivationMap.set(params.deviceFingerprint, record.code);
    this.testCodes = [record, ...this.testCodes];

    this.logActivity({
      category: 'test_lifecycle',
      action: 'test_code.issued',
      actor: params.clientName,
      target: record.code,
      severity: 'ok',
      ruleId: 'QUOTA_2_TESTS_PER_ACCOUNT',
      detail: `Code test ${record.code} (${params.platform}) généré — quota compte ${nextCount}/${this.rules.maxTestGenerationsPerAccount}, appareil ${params.deviceFingerprint}.`,
    });

    return {
      ok: true,
      record,
      remainingAccountTests: Math.max(0, this.rules.maxTestGenerationsPerAccount - nextCount),
    };
  }

  /**
   * Active un code test sur un appareil en vérifiant qu'il n'est ni expiré, ni révoqué,
   * ni utilisé sur un autre terminal.
   */
  public activateTestCode(
    code: string,
    deviceFingerprint?: string
  ): { ok: boolean; record?: TestCodeRecord; error?: string } {
    const idx = this.testCodes.findIndex((t) => t.code === code);
    if (idx === -1) {
      return { ok: false, error: `Code test ${code} introuvable.` };
    }
    const target = this.testCodes[idx];
    if (target.status === 'Révoqué') {
      return { ok: false, error: `Le code ${code} a été révoqué.` };
    }
    if (target.status === 'Expiré' || Date.now() >= target.expiresAtMs || target.usedGb >= target.quotaGb) {
      this.testCodes[idx] = { ...target, status: 'Expiré' };
      this.emit();
      return { ok: false, error: `Le code ${code} est expiré (limite 2h / 3 Go atteinte).` };
    }
    if (deviceFingerprint && deviceFingerprint !== target.deviceFingerprint) {
      this.blockedViolationsCount += 1;
      this.logActivity({
        category: 'security',
        action: 'test_code.device_mismatch',
        actor: deviceFingerprint,
        target: code,
        severity: 'critical',
        ruleId: 'ONE_TEST_PER_DEVICE',
        detail: `Tentative d'activation de ${code} sur un autre appareil (${deviceFingerprint} ≠ ${target.deviceFingerprint}).`,
      });
      return {
        ok: false,
        error: `Refus : ${code} est verrouillé sur l'appareil ${target.deviceFingerprint}.`,
      };
    }

    const updated: TestCodeRecord = {
      ...target,
      status: 'Activé',
      activatedAtLabel: formatShortTime(Date.now()),
    };
    this.testCodes[idx] = updated;
    this.logActivity({
      category: 'test_lifecycle',
      action: 'test_code.activated',
      actor: updated.clientName,
      target: updated.code,
      severity: 'ok',
      ruleId: 'ONE_TEST_PER_DEVICE',
      detail: `Tunnel test ${updated.code} activé sur ${updated.deviceFingerprint}.`,
    });

    return { ok: true, record: updated };
  }

  /**
   * Simule une consommation data sur un code test et le passe automatiquement en 'Expiré' à 3 Go.
   */
  public consumeTestQuota(code: string, deltaGb = 1.0): TestCodeRecord | null {
    const idx = this.testCodes.findIndex((t) => t.code === code);
    if (idx === -1) return null;
    const current = this.testCodes[idx];
    if (current.status === 'Expiré' || current.status === 'Révoqué') return current;

    const nextUsed = Math.min(current.quotaGb, Number((current.usedGb + deltaGb).toFixed(2)));
    const exhausted = nextUsed >= current.quotaGb;
    const updated: TestCodeRecord = {
      ...current,
      status: exhausted ? 'Expiré' : current.status === 'Généré' ? 'Activé' : current.status,
      usedGb: nextUsed,
      activatedAtLabel: current.activatedAtLabel ?? formatShortTime(Date.now()),
    };
    this.testCodes[idx] = updated;

    this.logActivity({
      category: 'test_lifecycle',
      action: exhausted ? 'test_code.quota_exhausted' : 'test_code.traffic_tick',
      actor: updated.clientName,
      target: updated.code,
      severity: exhausted ? 'warn' : 'info',
      ruleId: 'TEST_EXPIRATION_HYGIENE',
      detail: exhausted
        ? `Quota ${updated.quotaGb} Go atteint sur ${updated.code} -> expiration automatique.`
        : `Trafic test ${updated.code} : ${updated.usedGb}/${updated.quotaGb} Go.`,
    });

    return updated;
  }

  /**
   * Expire tous les codes de test ayant dépassé 2h ou 3 Go.
   */
  public expireStaleTestCodes(referenceNowMs = Date.now()): number {
    let expiredCount = 0;
    this.testCodes = this.testCodes.map((t) => {
      if (
        (t.status === 'Généré' || t.status === 'Activé') &&
        (referenceNowMs >= t.expiresAtMs || t.usedGb >= t.quotaGb)
      ) {
        expiredCount += 1;
        return { ...t, status: 'Expiré' };
      }
      return t;
    });

    if (expiredCount > 0) {
      this.logActivity({
        category: 'test_lifecycle',
        action: 'test_code.sweep_expired',
        actor: 'ServiceAIAgent',
        target: `${expiredCount} code(s)`,
        severity: 'info',
        ruleId: 'TEST_EXPIRATION_HYGIENE',
        detail: `${expiredCount} code(s) test arrivés à échéance (2h / 3 Go) basculés en statut Expiré.`,
      });
    } else {
      this.emit();
    }
    return expiredCount;
  }

  /**
   * Révoque manuellement un code de test.
   */
  public revokeTestCode(code: string, reason = 'Révocation manuelle Administrateur'): TestCodeRecord | null {
    const idx = this.testCodes.findIndex((t) => t.code === code);
    if (idx === -1) return null;
    const updated: TestCodeRecord = {
      ...this.testCodes[idx],
      status: 'Révoqué',
      revokedReason: reason,
    };
    this.testCodes[idx] = updated;
    this.logActivity({
      category: 'test_lifecycle',
      action: 'test_code.revoked',
      actor: 'Super Admin',
      target: updated.code,
      severity: 'warn',
      ruleId: 'ADMIN_REVOCATION',
      detail: `${updated.code} (${updated.clientName}) révoqué : ${reason}.`,
    });
    return updated;
  }

  private evaluateCompliance(licenses?: LicenseRecord[]): SupervisionReport {
    const anomalies: ComplianceAnomaly[] = [];
    const now = Date.now();
    const rulesChecked = [
      'QUOTA_2_TESTS_PER_ACCOUNT',
      'ONE_TEST_PER_DEVICE',
      'TEST_EXPIRATION_HYGIENE',
      'SSH_MAXUSER_LIMIT',
      'ORANGE_CEILING_OM_ASSO',
    ];

    // 1. Vérifier quota de 2 tests par compte client
    for (const [accountId, count] of this.accountGenerationCounts.entries()) {
      if (count > this.rules.maxTestGenerationsPerAccount) {
        anomalies.push({
          id: `anom-acc-${accountId}`,
          ruleId: 'QUOTA_2_TESTS_PER_ACCOUNT',
          severity: 'HIGH',
          target: accountId,
          message: `Le compte ${accountId} possède ${count} générations (max autorisé : ${this.rules.maxTestGenerationsPerAccount}).`,
          autoRemediated: false,
        });
      }
    }

    // 2. Vérifier unicité des appareils actifs sur les codes test
    const seenDevices = new Map<string, number>();
    for (const t of this.testCodes) {
      seenDevices.set(t.deviceFingerprint, (seenDevices.get(t.deviceFingerprint) ?? 0) + 1);
      if (
        (t.status === 'Généré' || t.status === 'Activé') &&
        (now >= t.expiresAtMs || t.usedGb >= t.quotaGb)
      ) {
        anomalies.push({
          id: `anom-exp-${t.code}`,
          ruleId: 'TEST_EXPIRATION_HYGIENE',
          severity: 'MEDIUM',
          target: t.code,
          message: `Le code test ${t.code} (${t.clientName}) a dépassé son échéance et doit être expiré.`,
          autoRemediated: false,
        });
      }
    }
    for (const [fp, cnt] of seenDevices.entries()) {
      if (cnt > this.rules.maxTestActivationsPerDevice) {
        anomalies.push({
          id: `anom-dev-${fp}`,
          ruleId: 'ONE_TEST_PER_DEVICE',
          severity: 'HIGH',
          target: fp,
          message: `Empreinte appareil ${fp} associée à ${cnt} codes test (max ${this.rules.maxTestActivationsPerDevice}).`,
          autoRemediated: false,
        });
      }
    }

    // 3. Vérifier conformité SSH maxSessions sur les licences du panel
    if (licenses) {
      for (const lic of licenses) {
        if (lic.status === 'Active' && lic.activeSessions > lic.maxSessions) {
          anomalies.push({
            id: `anom-sess-${lic.id}`,
            ruleId: 'SSH_MAXUSER_LIMIT',
            severity: 'HIGH',
            target: lic.sshUsername,
            message: `${lic.sshUsername} dépasse maxuser (${lic.activeSessions}/${lic.maxSessions} sessions).`,
            autoRemediated: false,
          });
        }
      }
    }

    const activeCount = this.testCodes.filter(
      (t) => t.status === 'Généré' || t.status === 'Activé'
    ).length;
    const expiredCount = this.testCodes.filter((t) => t.status === 'Expiré').length;
    const revokedCount = this.testCodes.filter((t) => t.status === 'Révoqué').length;

    const penalty = anomalies.reduce(
      (sum, a) => sum + (a.severity === 'HIGH' ? 20 : a.severity === 'MEDIUM' ? 10 : 5),
      0
    );
    const complianceScore = Math.max(0, 100 - penalty);

    return {
      auditedAt: formatShortTime(now),
      compliant: anomalies.length === 0,
      complianceScore,
      rulesChecked,
      anomalies,
      metrics: {
        totalLogs: this.activityLogs.length,
        blockedViolations: this.blockedViolationsCount,
        totalTestCodes: this.testCodes.length,
        activeTestCodes: activeCount,
        expiredTestCodes: expiredCount,
        revokedTestCodes: revokedCount,
        trackedAccounts: this.accountGenerationCounts.size,
        trackedDevices: this.deviceActivationMap.size,
      },
    };
  }

  /**
   * Lance une passe complète de supervision sur les logs d'activité, corrige automatiquement
   * les codes test expirés et retourne le rapport de conformité métier.
   */
  public superviseActivityLogs(licenses?: LicenseRecord[]): SupervisionReport {
    const swept = this.expireStaleTestCodes();
    const report = this.evaluateCompliance(licenses);

    this.logActivity({
      category: 'compliance',
      action: 'supervision.audit_completed',
      actor: 'ServiceAIAgent',
      target: `Score ${report.complianceScore}/100`,
      severity: report.compliant ? 'ok' : 'warn',
      ruleId: 'COMPLIANCE_AUDIT',
      detail: `Audit terminé : ${report.anomalies.length} anomalie(s), ${swept} code(s) test expiré(s) nettoyé(s), ${report.metrics.blockedViolations} infraction(s) bloquée(s).`,
    });

    return report;
  }
}

export const serviceAIAgent = new ServiceAIAgent();
