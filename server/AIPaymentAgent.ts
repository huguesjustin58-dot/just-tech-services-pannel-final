import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';

export type PaymentProvider = 'MTN Mobile Money' | 'Orange Money' | 'Orange OM ASSO' | 'Gratuit';
export type TransactionLifecycleStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';
export type AgentAlertType =
  | 'ORANGE_CEILING_WARNING'
  | 'ORANGE_CEILING_REACHED'
  | 'PROVISIONING_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'FORGERY_DETECTED';

export interface PaymentEndpointConfig {
  mtn: {
    beneficiary: string;
    number: string;
  };
  orange: {
    beneficiary: string;
    number: string;
    merchantOmAsso: string;
    ceilingFcfa: number;
    warningThresholdRatio: number;
  };
}

export interface MonitoredTransactionInput {
  planId: string;
  planName: string;
  planCategory: 'NPV TUNNEL' | 'OFFRE TEST GRATUIT';
  expectedAmountFcfa: number;
  provider: PaymentProvider;
  payerPhone: string;
  transactionRef: string;
  smsProof?: string;
  screenshotBase64?: string;
  screenshotMimeType?: string;
  clientName: string;
  accountId: string;
  deviceFingerprint: string;
  platform: 'pending' | 'android' | 'iphone';
  prototypeJson?: string;
}

export interface ForensicSensorsReport {
  typographyAndAlignment: string;
  uiConsistency: string;
  metadataAndReplay: string;
  beneficiaryAndAmountMatch: string;
}

export interface ForensicReport {
  screenshotSha256: string | null;
  authenticityScore: number;
  isFalsified: boolean;
  extractedTxId: string;
  extractedRecipient: string;
  binaryTamperFlags: string[];
  forensicSensors: ForensicSensorsReport;
}

export interface ProvisionedOutcome {
  deliveryToken: string;
  sshUsername: string;
  sshPassword: string;
  platform: 'pending' | 'android' | 'iphone';
  cloudCode?: string | null;
  cloudRecord?: unknown;
  npvFilename?: string | null;
  npvFileContent?: string | null;
}

export interface MonitoredTransaction {
  id: string;
  input: MonitoredTransactionInput;
  status: TransactionLifecycleStatus;
  verificationSource: 'AI_SCREENSHOT_FORENSICS' | 'AI_PROOF_AUDIT';
  createdAt: string;
  lastCheckedAt: string | null;
  reasoning: string;
  fraudRisk: string;
  detectedAmountFcfa: number;
  forensicReport?: ForensicReport;
  provisionedOutcome?: ProvisionedOutcome;
}

export interface AgentAlert {
  id: string;
  type: AgentAlertType;
  category: 'payment' | 'server' | 'expiration';
  title: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

export interface AIPaymentAgentHooks {
  getGeminiClient: () => GoogleGenAI;
  getOrangeCurrentVolume: () => number;
  isOrangeCeilingManual: () => boolean;
  onProvisionService: (
    tx: MonitoredTransactionInput,
    aiReasoning: string
  ) => Promise<ProvisionedOutcome>;
  onAlert?: (alert: AgentAlert) => void;
}

export class AIPaymentAgent {
  private readonly config: PaymentEndpointConfig;
  private readonly hooks: AIPaymentAgentHooks;
  private readonly monitoredTransactions = new Map<string, MonitoredTransaction>();
  private readonly usedScreenshotHashes = new Map<
    string,
    { accountId: string; clientName: string; txRef: string; usedAt: string }
  >();
  private readonly alerts: AgentAlert[] = [];
  private ceilingWarningEmitted = false;
  private ceilingReachedEmitted = false;

  constructor(config: PaymentEndpointConfig, hooks: AIPaymentAgentHooks) {
    this.config = config;
    this.hooks = hooks;
  }

  public isOrangeCeilingExceeded(): boolean {
    return (
      this.hooks.isOrangeCeilingManual() ||
      this.hooks.getOrangeCurrentVolume() >= this.config.orange.ceilingFcfa
    );
  }

  public getMonitoredTransactions(): MonitoredTransaction[] {
    return Array.from(this.monitoredTransactions.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  public getAlerts(): AgentAlert[] {
    return [...this.alerts];
  }

  /**
   * Évalue les seuils Orange Money et déclenche des alertes automatiques vers l'Admin / NotificationsCenter.
   */
  public evaluateCeilingAlerts(): AgentAlert | null {
    const current = this.hooks.getOrangeCurrentVolume();
    const ceiling = this.config.orange.ceilingFcfa;
    const ratio = ceiling > 0 ? current / ceiling : 0;

    if (this.isOrangeCeilingExceeded()) {
      if (!this.ceilingReachedEmitted) {
        this.ceilingReachedEmitted = true;
        return this.pushAlert({
          type: 'ORANGE_CEILING_REACHED',
          category: 'payment',
          title: `Plafond Orange atteint (${this.config.orange.number})`,
          detail: `Volume ${current.toLocaleString('fr-FR')} / ${ceiling.toLocaleString('fr-FR')} FCFA. Bascule automatique activée vers Paiement Marchand OM ASSO : ${this.config.orange.merchantOmAsso}.`,
        });
      }
      return null;
    }

    // Réinitialise le drapeau si le plafond repasse sous le seuil
    this.ceilingReachedEmitted = false;

    if (ratio >= this.config.orange.warningThresholdRatio) {
      if (!this.ceilingWarningEmitted) {
        this.ceilingWarningEmitted = true;
        return this.pushAlert({
          type: 'ORANGE_CEILING_WARNING',
          category: 'payment',
          title: `Alerte seuil Orange Money (${Math.round(ratio * 100)}%)`,
          detail: `Le compte ${this.config.orange.beneficiary} (${this.config.orange.number}) approche du plafond (${current.toLocaleString('fr-FR')} / ${ceiling.toLocaleString('fr-FR')} FCFA). Préparez le relais OM ASSO ${this.config.orange.merchantOmAsso}.`,
        });
      }
    } else {
      this.ceilingWarningEmitted = false;
    }

    return null;
  }

  /**
   * Vérifie la preuve de paiement (capture d'écran + capteurs anti-falsification Gemini AI)
   * puis déclenche le provisionnement automatique.
   */
  public async verifyAndProvision(input: MonitoredTransactionInput): Promise<{
    approved: boolean;
    monitored: MonitoredTransaction;
    useOmMerchantFallback?: boolean;
    merchantCode?: string;
  }> {
    const hasScreenshot = Boolean(input.screenshotBase64 && input.screenshotBase64.trim().length > 0);
    const id = `mon_${crypto.randomBytes(6).toString('hex')}`;
    const monitor: MonitoredTransaction = {
      id,
      input,
      status: 'PENDING',
      verificationSource: hasScreenshot ? 'AI_SCREENSHOT_FORENSICS' : 'AI_PROOF_AUDIT',
      createdAt: new Date().toISOString(),
      lastCheckedAt: null,
      reasoning: 'Analyse par les capteurs IA en cours.',
      fraudRisk: 'En cours',
      detectedAmountFcfa: input.expectedAmountFcfa,
    };
    this.monitoredTransactions.set(id, monitor);

    const evaluated = await this.checkAndProcessTransaction(monitor);
    if (
      !evaluated.approved &&
      input.provider === 'Orange Money' &&
      this.isOrangeCeilingExceeded()
    ) {
      return {
        approved: false,
        monitored: evaluated.monitored,
        useOmMerchantFallback: true,
        merchantCode: this.config.orange.merchantOmAsso,
      };
    }
    return evaluated;
  }

  /**
   * Capteurs binaires et anti-rejeu avant analyse visuelle Gemini :
   * 1. Vérifie la signature magique réelle du fichier image (PNG / JPEG / WebP).
   * 2. Calcule le SHA-256 pour bloquer la réutilisation d'une même capture (replay attack).
   * 3. Scanne les métadonnées/EXIF à la recherche de logiciels de retouche (Photoshop, Canva, GIMP, PicsArt, Pixellab...).
   */
  private runBinaryAndReplaySensors(
    rawBase64: string,
    mimeType?: string
  ): {
    valid: boolean;
    cleanBase64: string;
    resolvedMimeType: string;
    sha256: string;
    replayConflict?: { accountId: string; clientName: string; txRef: string; usedAt: string };
    tamperFlags: string[];
    errorReason?: string;
  } {
    const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '').trim();
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const resolvedMimeType =
      mimeType && allowedMimes.includes(mimeType.toLowerCase())
        ? mimeType.toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : mimeType.toLowerCase()
        : 'image/jpeg';

    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length < 64) {
      return {
        valid: false,
        cleanBase64,
        resolvedMimeType,
        sha256: '',
        tamperFlags: ['Fichier image invalide ou vide (< 64 octets)'],
        errorReason: 'Capture d’écran invalide ou corrompue.',
      };
    }
    if (buffer.length > 6 * 1024 * 1024) {
      return {
        valid: false,
        cleanBase64,
        resolvedMimeType,
        sha256: '',
        tamperFlags: ['Image trop volumineuse (> 6 Mo)'],
        errorReason: 'La capture d’écran dépasse la limite maximale de 6 Mo.',
      };
    }

    const isPng =
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isPng && !isJpeg && !isWebp) {
      return {
        valid: false,
        cleanBase64,
        resolvedMimeType,
        sha256: '',
        tamperFlags: ['En-tête binaire non conforme (fichier maquillé non-image)'],
        errorReason:
          'Capteur binaire : le fichier fourni ne correspond pas à une image PNG, JPEG ou WebP authentique.',
      };
    }

    const detectedMime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const replayConflict = this.usedScreenshotHashes.get(sha256);

    const tamperFlags: string[] = [];
    const metadataWindow = buffer
      .subarray(0, Math.min(buffer.length, 65536))
      .toString('latin1')
      .toLowerCase();
    const editingSignatures = [
      { key: 'adobe photoshop', label: 'Adobe Photoshop' },
      { key: 'photoshop', label: 'Photoshop' },
      { key: 'canva', label: 'Canva' },
      { key: 'gimp', label: 'GIMP' },
      { key: 'picsart', label: 'PicsArt' },
      { key: 'pixellab', label: 'PixelLab' },
      { key: 'snapseed', label: 'Snapseed' },
      { key: 'photopea', label: 'Photopea' },
      { key: 'lightroom', label: 'Adobe Lightroom' },
      { key: 'coreldraw', label: 'CorelDRAW' },
    ];
    for (const sig of editingSignatures) {
      if (metadataWindow.includes(sig.key)) {
        tamperFlags.push(`Signature logicielle détectée dans les métadonnées : ${sig.label}`);
      }
    }

    return {
      valid: true,
      cleanBase64,
      resolvedMimeType: detectedMime,
      sha256,
      replayConflict,
      tamperFlags,
    };
  }

  private async checkAndProcessTransaction(
    monitor: MonitoredTransaction
  ): Promise<{ approved: boolean; monitored: MonitoredTransaction }> {
    const { input } = monitor;
    monitor.lastCheckedAt = new Date().toISOString();

    // 1. Vérifier plafond Orange Money avant validation
    if (input.provider === 'Orange Money' && this.isOrangeCeilingExceeded()) {
      monitor.status = 'FAILED';
      monitor.reasoning = `Plafond Orange Money atteint sur le ${this.config.orange.number} (${this.config.orange.beneficiary}). Bascule requise vers OM ASSO ${this.config.orange.merchantOmAsso}.`;
      monitor.fraudRisk = 'N/A (Plafond)';
      this.evaluateCeilingAlerts();
      return { approved: false, monitored: monitor };
    }

    const hasScreenshot = Boolean(input.screenshotBase64 && input.screenshotBase64.trim().length > 0);
    monitor.verificationSource = hasScreenshot ? 'AI_SCREENSHOT_FORENSICS' : 'AI_PROOF_AUDIT';

    // 2. Capteurs anti-falsification binaires & anti-rejeu sur capture d'écran
    let binaryCheck: ReturnType<AIPaymentAgent['runBinaryAndReplaySensors']> | null = null;
    if (hasScreenshot && input.screenshotBase64) {
      binaryCheck = this.runBinaryAndReplaySensors(
        input.screenshotBase64,
        input.screenshotMimeType
      );

      if (!binaryCheck.valid) {
        monitor.status = 'FAILED';
        monitor.fraudRisk = 'Critique (Falsifié)';
        monitor.reasoning = binaryCheck.errorReason || 'Capture invalide.';
        monitor.forensicReport = {
          screenshotSha256: null,
          authenticityScore: 0,
          isFalsified: true,
          extractedTxId: '',
          extractedRecipient: '',
          binaryTamperFlags: binaryCheck.tamperFlags,
          forensicSensors: {
            typographyAndAlignment: 'Non analysé (fichier corrompu)',
            uiConsistency: 'Rejet binaire',
            metadataAndReplay: binaryCheck.tamperFlags.join(' ; '),
            beneficiaryAndAmountMatch: 'Non validé',
          },
        };
        this.pushAlert({
          type: 'FORGERY_DETECTED',
          category: 'payment',
          title: 'Tentative de fichier maquillé bloquée',
          detail: `${input.clientName} : ${monitor.reasoning}`,
        });
        return { approved: false, monitored: monitor };
      }

      if (binaryCheck.replayConflict) {
        monitor.status = 'FAILED';
        monitor.fraudRisk = 'Critique (Falsifié)';
        monitor.reasoning = `Capture d'écran déjà utilisée auparavant (rejeu détecté · SHA-256 ${binaryCheck.sha256.slice(0, 12)}..., initialement soumise par ${binaryCheck.replayConflict.clientName}).`;
        monitor.forensicReport = {
          screenshotSha256: binaryCheck.sha256,
          authenticityScore: 5,
          isFalsified: true,
          extractedTxId: binaryCheck.replayConflict.txRef,
          extractedRecipient: '',
          binaryTamperFlags: [
            `Doublon cryptographique SHA-256 détecté (utilisé le ${binaryCheck.replayConflict.usedAt})`,
            ...binaryCheck.tamperFlags,
          ],
          forensicSensors: {
            typographyAndAlignment: 'Capture dupliquée',
            uiConsistency: 'Rejeu frauduleux de preuve déjà consommée',
            metadataAndReplay: `BLOQUÉ : empreinte ${binaryCheck.sha256.slice(0, 16)} déjà enregistrée.`,
            beneficiaryAndAmountMatch: 'Rejeté pour double dépense',
          },
        };
        this.pushAlert({
          type: 'FORGERY_DETECTED',
          category: 'payment',
          title: 'Alerte Anti-Fraude : Réutilisation de capture bloquée',
          detail: `${input.clientName} a soumis une capture d'écran déjà utilisée (${binaryCheck.replayConflict.txRef}).`,
        });
        return { approved: false, monitored: monitor };
      }
    } else if (input.planCategory !== 'OFFRE TEST GRATUIT' && !input.transactionRef.trim() && !input.smsProof?.trim()) {
      monitor.status = 'FAILED';
      monitor.fraudRisk = 'Élevé';
      monitor.reasoning =
        'Veuillez importer la capture d’écran du paiement (ou saisir une référence/SMS valide) pour que nos capteurs IA puissent vérifier la transaction.';
      return { approved: false, monitored: monitor };
    }

    // 4. Audit Multimodal Gemini Vision + Capteurs Anti-Falsification (gemini-4-hydrogen)
    const ai = this.hooks.getGeminiClient();
    const forensicPrompt = `
Tu es AIPaymentAgent équipé de capteurs d'expertise documentaire et anti-falsification pour JUST TECH SERVICES TUNNEL (Cameroun).
${hasScreenshot ? 'Analyse l’IMAGE DE CAPTURE D’ÉCRAN ci-jointe avec tes capteurs forensiques visuels.' : 'Analyse les données textuelles de transaction ci-dessous.'}

CONFIGURATION OFFICIELLE DES BÉNÉFICIAIRES :
- MTN Mobile Money : ${this.config.mtn.beneficiary} (${this.config.mtn.number})
- Orange Money : ${this.config.orange.beneficiary} (${this.config.orange.number})
- Orange Marchand OM ASSO : ${this.config.orange.merchantOmAsso}
- Plafond Orange atteint : ${this.isOrangeCeilingExceeded() ? 'OUI (seul OM ASSO 1017614 ou MTN MoMo est autorisé)' : 'NON'}

COMMANDE CLIENT ATTENDUE :
- Client : ${input.clientName} (Compte ${input.accountId})
- Offre : ${input.planCategory} — ${input.planName} (${input.expectedAmountFcfa} FCFA)
- Canal déclaré : ${input.provider}
- Payeur : ${input.payerPhone}
- Référence saisie (si fournie) : ${input.transactionRef || 'À extraire depuis la capture'}
- Texte SMS complémentaire : ${input.smsProof || 'Aucun'}
- Capteurs binaires EXIF/métadonnées : ${binaryCheck ? (binaryCheck.tamperFlags.length ? binaryCheck.tamperFlags.join(' | ') : 'Aucune signature Photoshop/Canva détectée dans l’en-tête binaire') : 'Pas d’image jointe'}

MISSION DES CAPTEURS ANTI-FALSIFICATION (OBLIGATOIRE SI CAPTURE JOINTE) :
1. **Capteur Typographie & Compression** : vérifie si les chiffres du montant, l'heure, l'ID de transaction ou le nom du bénéficiaire présentent des polices différentes, un mauvais alignement vertical/horizontal, des couleurs d'arrière-plan incompatibles ou des artefacts de copier-coller / effacement autour du texte.
2. **Capteur Cohérence UI Opérateur** : vérifie si l'interface correspond fidèlement à un vrai reçu **Orange Money / Max it**, **MTN MoMo / MyMTN**, ou un vrai **SMS opérateur** (et non un montage grossier, un modèle vierge rempli, ou un texte sans en-tête système réaliste).
3. **Capteur Bénéficiaire & Montant** : vérifie que le destinataire visible sur l'image correspond au canal (${this.config.mtn.beneficiary} / ${this.config.mtn.number} OU ${this.config.orange.beneficiary} / ${this.config.orange.number} OU marchand OM ASSO ${this.config.orange.merchantOmAsso}) et que le montant envoyé est >= ${input.expectedAmountFcfa} FCFA, avec un statut réussi ("Effectué", "Succès", "Transfert réussi", "Transaction ID", etc. — rejeter si "Échec", "En attente", "Solde insuffisant" ou simple aperçu avant validation).
4. **Capteur Métadonnées / Anti-Rejeu** : tiens compte de l'analyse EXIF binaire ci-dessus (si Photoshop/Canva/PixelLab/PicsArt est détecté, pénalise fortement le score et rejette sauf preuve irréfutable que c'est impossible).
5. Donne un score d'authenticité de 0 à 100 (` + '`authenticityScore`' + `). Mets ` + '`isFalsified: true`' + ` et ` + '`approved: false`' + ` dès le moindre doute sérieux de trucage, montage, capture non-paiement (ex: photo aléatoire), mauvais montant ou mauvais destinataire.
6. Si c'est l'OFFRE TEST GRATUIT (0 FCFA) sans capture requise, valide normalement si les règles serveur sont respectées.

Retourne strictement le JSON structuré en français.
`;

    const contentsPayload =
      hasScreenshot && binaryCheck
        ? {
            parts: [
              {
                inlineData: {
                  mimeType: binaryCheck.resolvedMimeType,
                  data: binaryCheck.cleanBase64,
                },
              },
              { text: forensicPrompt },
            ],
          }
        : forensicPrompt;

    const aiResponse = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: contentsPayload,
      config: {
        systemInstruction:
          'Tu es AIPaymentAgent Forensique pour JUST TECH SERVICES. Tu inspectes les captures Mobile Money avec une rigueur anti-fraude maximale et retournes uniquement du JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            approved: { type: Type.BOOLEAN },
            isFalsified: { type: Type.BOOLEAN },
            authenticityScore: { type: Type.NUMBER },
            fraudRisk: { type: Type.STRING },
            reasoning: { type: Type.STRING },
            detectedAmountFcfa: { type: Type.NUMBER },
            extractedTxId: { type: Type.STRING },
            extractedRecipient: { type: Type.STRING },
            typographyAndAlignment: { type: Type.STRING },
            uiConsistency: { type: Type.STRING },
            metadataAndReplay: { type: Type.STRING },
            beneficiaryAndAmountMatch: { type: Type.STRING },
          },
          required: [
            'approved',
            'isFalsified',
            'authenticityScore',
            'fraudRisk',
            'reasoning',
            'detectedAmountFcfa',
            'extractedTxId',
            'extractedRecipient',
            'typographyAndAlignment',
            'uiConsistency',
            'metadataAndReplay',
            'beneficiaryAndAmountMatch',
          ],
        },
      },
    });

    const verdict = JSON.parse((aiResponse.text ?? '{}').trim()) as {
      approved: boolean;
      isFalsified: boolean;
      authenticityScore: number;
      fraudRisk: string;
      reasoning: string;
      detectedAmountFcfa: number;
      extractedTxId: string;
      extractedRecipient: string;
      typographyAndAlignment: string;
      uiConsistency: string;
      metadataAndReplay: string;
      beneficiaryAndAmountMatch: string;
    };

    const scoreClamped = Math.max(0, Math.min(100, Math.round(verdict.authenticityScore ?? 0)));
    const hardRejectedBySensors =
      !verdict.approved ||
      verdict.isFalsified ||
      (hasScreenshot && scoreClamped < 65);

    monitor.reasoning = verdict.reasoning;
    monitor.fraudRisk = verdict.isFalsified ? 'Critique (Falsifié)' : verdict.fraudRisk;
    monitor.detectedAmountFcfa = verdict.detectedAmountFcfa;
    monitor.forensicReport = {
      screenshotSha256: binaryCheck?.sha256 ?? null,
      authenticityScore: scoreClamped,
      isFalsified: Boolean(verdict.isFalsified || (hasScreenshot && scoreClamped < 65)),
      extractedTxId: verdict.extractedTxId || input.transactionRef,
      extractedRecipient: verdict.extractedRecipient || '',
      binaryTamperFlags: binaryCheck?.tamperFlags ?? [],
      forensicSensors: {
        typographyAndAlignment: verdict.typographyAndAlignment,
        uiConsistency: verdict.uiConsistency,
        metadataAndReplay: verdict.metadataAndReplay,
        beneficiaryAndAmountMatch: verdict.beneficiaryAndAmountMatch,
      },
    };

    if (hardRejectedBySensors) {
      monitor.status = 'FAILED';
      this.pushAlert({
        type: monitor.forensicReport.isFalsified ? 'FORGERY_DETECTED' : 'PAYMENT_FAILED',
        category: 'payment',
        title: monitor.forensicReport.isFalsified
          ? `Document falsifié détecté (${scoreClamped}/100)`
          : `Paiement rejeté par AIPaymentAgent`,
        detail: `${input.clientName} · ${verdict.extractedTxId || input.transactionRef || 'Capture'} : ${verdict.reasoning}`,
      });
      return { approved: false, monitored: monitor };
    }

    // Enregistre l'empreinte SHA-256 pour empêcher toute réutilisation future de la capture
    if (binaryCheck?.sha256) {
      this.usedScreenshotHashes.set(binaryCheck.sha256, {
        accountId: input.accountId,
        clientName: input.clientName,
        txRef: verdict.extractedTxId || input.transactionRef || 'CAPTURE-IA',
        usedAt: new Date().toISOString(),
      });
    }

    // 5. Succès validé -> déclenche le provisionnement automatique & vérifie les seuils de plafond
    monitor.status = 'SUCCESSFUL';
    monitor.provisionedOutcome = await this.hooks.onProvisionService(input, verdict.reasoning);

    this.pushAlert({
      type: 'PROVISIONING_SUCCEEDED',
      category: 'payment',
      title: `Provisionnement auto déclenché (${input.planName})`,
      detail: `${input.clientName} · ${input.expectedAmountFcfa.toLocaleString('fr-FR')} FCFA validés${hasScreenshot ? ` (Authenticité ${scoreClamped}/100)` : ''}. Accès SSH ${monitor.provisionedOutcome.sshUsername} prêt.`,
    });

    this.evaluateCeilingAlerts();

    return { approved: true, monitored: monitor };
  }

  private pushAlert(payload: Omit<AgentAlert, 'id' | 'timestamp' | 'read'>): AgentAlert {
    const alert: AgentAlert = {
      id: `alt_${crypto.randomBytes(5).toString('hex')}`,
      ...payload,
      timestamp: new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      read: false,
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > 50) {
      this.alerts.length = 50;
    }
    this.hooks.onAlert?.(alert);
    return alert;
  }
}
