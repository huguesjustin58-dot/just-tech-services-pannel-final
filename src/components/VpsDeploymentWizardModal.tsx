import React, { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { authFetch } from '../services/authClient';
import { AuthenticatedUser } from '../types/panel';

interface VpsDeploymentWizardModalProps {
  isOpen: boolean;
  currentUser: AuthenticatedUser;
  onClose: () => void;
  onNotify?: (message: string) => void;
}

interface SshProbeResultDto {
  ok: boolean;
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

function extractRootDomain(domainInput: string): string {
  const clean = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length >= 3 && (parts[0] === 'panel' || parts[0] === 'www' || parts[0] === 'vpn')) {
    return parts.slice(1).join('.');
  }
  return clean || 'justtechservices.xyz';
}

export const VpsDeploymentWizardModal: React.FC<VpsDeploymentWizardModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onNotify,
}) => {
  const [accessMode, setAccessMode] = useState<'domain' | 'ip'>('domain');
  const [customDomain, setCustomDomain] = useState('panel.justtechservices.xyz');
  const [vpsIp, setVpsIp] = useState('203.0.113.10');
  const [vpsPort, setVpsPort] = useState(22);
  const [vpsUser, setVpsUser] = useState('root');
  const [githubRepoUrl, setGithubRepoUrl] = useState(
    'https://github.com/votre-compte/just-tech-services-panel.git'
  );

  const rootDomain = useMemo(() => extractRootDomain(customDomain), [customDomain]);
  const [slowDnsNs, setSlowDnsNs] = useState('sdns1.justtechservices.xyz');

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<SshProbeResultDto | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen || currentUser.role !== 'super_admin') {
    return null;
  }

  const cleanIp = vpsIp.trim() || '203.0.113.10';
  const cleanUser = vpsUser.trim() || 'root';
  const cleanPort = Number.isInteger(vpsPort) && vpsPort > 0 ? vpsPort : 22;
  const cleanPanelDomain = customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || `panel.${rootDomain}`;
  const cleanSlowDnsNs = slowDnsNs.trim().toLowerCase() || `sdns1.${rootDomain}`;
  const dnsHostTarget = `dns.${rootDomain}`;

  const effectiveHost = accessMode === 'domain' ? cleanPanelDomain : cleanIp;
  const effectiveScheme = accessMode === 'domain' ? 'https' : 'http';
  const publicBaseUrl = `${effectiveScheme}://${effectiveHost}`;

  const handleDomainChange = (nextDomain: string) => {
    setCustomDomain(nextDomain);
    const nextRoot = extractRootDomain(nextDomain);
    setSlowDnsNs(`sdns1.${nextRoot}`);
  };

  const copyText = async (text: string, id: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify?.(`${label} copié dans le presse-papiers.`);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 2200);
    } catch {
      onNotify?.('Impossible de copier automatiquement.');
    }
  };

  const handleProbeVpsSsh = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const targetToProbe = accessMode === 'domain' && cleanIp === '203.0.113.10' ? cleanPanelDomain : cleanIp;
      const res = await authFetch('/api/admin/servers/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: targetToProbe, port: cleanPort }),
      });
      const data = (await res.json()) as SshProbeResultDto;
      setProbeResult(data);
      if (data.reachable) {
        onNotify?.(
          `VPS ${targetToProbe}:${cleanPort} en ligne (${data.latencyMs} ms · ${data.sshBanner || 'SSH OK'}).`
        );
      } else {
        onNotify?.(data.reason || `VPS ${targetToProbe}:${cleanPort} injoignable.`);
      }
    } catch {
      onNotify?.('Erreur lors du test TCP/SSH vers le VPS.');
    } finally {
      setProbing(false);
    }
  };

  // Enregistrements DNS à créer chez le registrar / Cloudflare pour le domaine + SlowDNS
  const dnsRecords = [
    {
      type: 'A',
      name: cleanPanelDomain,
      target: cleanIp,
      proxyMode: 'DNS Only (Nuage Gris)',
      purpose: 'Panel HTTPS (Let’s Encrypt) + Tunnel SSH / WebSocket (:80, :443/ws) + TLS (:8443)',
    },
    {
      type: 'A',
      name: dnsHostTarget,
      target: cleanIp,
      proxyMode: 'DNS Only (Nuage Gris)',
      purpose: 'Serveur hôte de référence pour le tunnel SlowDNS (dnstt)',
    },
    {
      type: 'NS',
      name: cleanSlowDnsNs,
      target: dnsHostTarget,
      proxyMode: 'DNS Only (Nuage Gris)',
      purpose: 'Délégation NS SlowDNS (:5300/udp) pour les configs SSH_SLOWDNS',
    },
  ];

  // Commande 1-clic à exécuter sur le VPS pour générer la clé SSH dédiée à GitHub Actions
  const sshKeygenCommand = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && \\
ssh-keygen -t ed25519 -C "jts-github-actions-deploy" -f ~/.ssh/jts_github_actions -N "" -q && \\
cat ~/.ssh/jts_github_actions.pub >> ~/.ssh/authorized_keys && \\
chmod 600 ~/.ssh/authorized_keys && \\
echo "================ COPIEZ TOUT LE BLOC CI-DESSOUS DANS LE SECRET GITHUB VPS_SSH_KEY ================" && \\
cat ~/.ssh/jts_github_actions && \\
echo "=================================================================================================="`;

  // Commandes Git pour pousser le ZIP décompressé vers GitHub et lancer le déploiement automatique
  const gitPushCommands = `# 1. Décompressez l'archive téléchargée JUST_TECH_SERVICES_PANEL_FINAL.zip puis ouvrez le dossier :
unzip JUST_TECH_SERVICES_PANEL_FINAL.zip
cd JUST_TECH_SERVICES_PANEL_FINAL

# 2. Initialisez Git et poussez vers votre dépôt GitHub (déclenche automatiquement le déploiement VPS + HTTPS) :
git init
git branch -M main
git add -A
git commit -m "Deploy JUST TECH SERVICES PANEL + VPN Stack on ${effectiveHost}"
git remote add origin ${githubRepoUrl.trim() || 'https://github.com/votre-compte/just-tech-services-panel.git'}
git push -u origin main --force`;

  // Commande alternative de déploiement direct depuis un terminal local vers le VPS par SSH
  const directVpsCommand = `# Déploiement direct sur votre VPS (${cleanUser}@${cleanIp}:${cleanPort}) avec Domaine & HTTPS Let's Encrypt :
scp -P ${cleanPort} JUST_TECH_SERVICES_PANEL_FINAL.zip ${cleanUser}@${cleanIp}:/tmp/
ssh -p ${cleanPort} ${cleanUser}@${cleanIp} "apt-get update -qq && apt-get install -y -qq unzip && \\
  rm -rf /tmp/jts_extract && unzip -q /tmp/JUST_TECH_SERVICES_PANEL_FINAL.zip -d /tmp/jts_extract && \\
  cd /tmp/jts_extract/JUST_TECH_SERVICES_PANEL_FINAL && \\
  tar -czf /tmp/jts-release.tar.gz . && \\
  JTS_PANEL_DOMAIN='${effectiveHost}' \\
  JTS_SLOWDNS_NS_DOMAIN='${cleanSlowDnsNs}' \\
  JTS_SUPERADMIN_EMAIL='huguesjustin58@gmail.com' \\
  JTS_SUPERADMIN_PASSWORD='@Moddingjust' \\
  JTS_DEPLOY_VPN_STACK='true' \\
  JTS_ENABLE_SSL='${accessMode === 'domain' ? 'true' : 'false'}' \\
  bash deliverable/deploy-scripts/vps-deploy-panel-and-vpn.sh /tmp/jts-release.tar.gz"`;

  const downloadWorkflowYaml = () => {
    const yamlContent = `name: Deploy JUST TECH SERVICES Panel & VPN to VPS

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci --no-audit --no-fund || npm install --no-audit --no-fund
      - run: |
          npm run lint
          npm run build
      - run: |
          chmod +x deliverable/deploy-scripts/*.sh
          tar -czf /tmp/jts-release.tar.gz --exclude='node_modules' --exclude='.git' --exclude='deliverable/dist' .
      - name: Upload & Deploy to VPS (${effectiveHost})
        env:
          VPS_HOST: \${{ secrets.VPS_HOST || '${cleanIp}' }}
          VPS_USER: \${{ secrets.VPS_USER || '${cleanUser}' }}
          VPS_PORT: \${{ secrets.VPS_PORT || '${cleanPort}' }}
          VPS_SSH_KEY: \${{ secrets.VPS_SSH_KEY }}
          JTS_PANEL_DOMAIN: \${{ secrets.JTS_PANEL_DOMAIN || '${effectiveHost}' }}
          JTS_SLOWDNS_NS_DOMAIN: \${{ secrets.JTS_SLOWDNS_NS_DOMAIN || '${cleanSlowDnsNs}' }}
        run: |
          mkdir -p ~/.ssh
          echo "\${VPS_SSH_KEY}" > ~/.ssh/jts_vps_key
          chmod 600 ~/.ssh/jts_vps_key
          scp -i ~/.ssh/jts_vps_key -P "\${VPS_PORT}" -o StrictHostKeyChecking=no /tmp/jts-release.tar.gz deliverable/deploy-scripts/vps-deploy-panel-and-vpn.sh "\${VPS_USER}@\${VPS_HOST}:/tmp/"
          ssh -i ~/.ssh/jts_vps_key -p "\${VPS_PORT}" -o StrictHostKeyChecking=no "\${VPS_USER}@\${VPS_HOST}" \\
            "sudo JTS_PANEL_DOMAIN='\${JTS_PANEL_DOMAIN}' JTS_SLOWDNS_NS_DOMAIN='\${JTS_SLOWDNS_NS_DOMAIN}' JTS_SUPERADMIN_EMAIL='huguesjustin58@gmail.com' JTS_SUPERADMIN_PASSWORD='@Moddingjust' JTS_DEPLOY_VPN_STACK='true' JTS_ENABLE_SSL='${accessMode === 'domain' ? 'true' : 'false'}' bash /tmp/vps-deploy-panel-and-vpn.sh /tmp/jts-release.tar.gz"
`;
    const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deploy-vps.yml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onNotify?.('Workflow GitHub Actions deploy-vps.yml téléchargé.');
  };

  const githubSecretsList = [
    {
      name: 'VPS_HOST',
      value: cleanIp,
      required: 'Obligatoire',
      desc: 'Adresse IPv4 publique de votre VPS Ubuntu / Debian',
    },
    {
      name: 'VPS_SSH_KEY',
      value: '-----BEGIN OPENSSH PRIVATE KEY----- ...',
      required: 'Obligatoire',
      desc: "Clé privée SSH générée à l'Étape 2 sur votre VPS",
    },
    {
      name: 'JTS_PANEL_DOMAIN',
      value: effectiveHost,
      required: accessMode === 'domain' ? 'Recommandé' : 'Optionnel',
      desc: 'Votre nom de domaine pointé vers le VPS (active automatiquement HTTPS Let’s Encrypt)',
    },
    {
      name: 'JTS_SLOWDNS_NS_DOMAIN',
      value: cleanSlowDnsNs,
      required: 'Optionnel',
      desc: 'Sous-domaine NS pour le serveur SlowDNS dnstt (:5300/udp)',
    },
    {
      name: 'VPS_USER',
      value: cleanUser,
      required: 'Optionnel',
      desc: 'Utilisateur SSH root ou sudo (défaut : root)',
    },
    {
      name: 'VPS_PORT',
      value: String(cleanPort),
      required: 'Optionnel',
      desc: 'Port SSH de votre VPS (défaut : 22)',
    },
    {
      name: 'JTS_SUPERADMIN_EMAIL',
      value: 'huguesjustin58@gmail.com',
      required: 'Optionnel',
      desc: 'Compte Super Admin principal configuré au bootstrap',
    },
    {
      name: 'JTS_SUPERADMIN_PASSWORD',
      value: '@Moddingjust',
      required: 'Optionnel',
      desc: 'Mot de passe initial (changement obligatoire au 1er login)',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Assistant de Déploiement 1-Clic VPS et GitHub Actions"
    >
      <div className="w-full max-w-5xl rounded-xl border border-[#243147] bg-[#101827] shadow-2xl overflow-hidden my-8">
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-[#151F31] border-b border-[#243147]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-[#E5B84B]/15 border border-[#E5B84B]/40 text-[#E5B84B]">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-[#E5B84B] font-mono-tabular">
                <span>SUPER ADMIN ONLY</span>
                <span aria-hidden="true">·</span>
                <span>CI/CD GITHUB ACTIONS → VPS</span>
                <span aria-hidden="true">·</span>
                <span>DOMAINE + HTTPS LET&apos;S ENCRYPT</span>
              </div>
              <h2 className="font-display text-lg font-semibold text-[#F2F6FF]">
                Assistant de Déploiement 1-Clic — Panel + Stack VPN sur votre Domaine &amp; VPS
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href="/api/deliverable/download-zip"
              download="JUST_TECH_SERVICES_PANEL_FINAL.zip"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Télécharger ZIP Final
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-[#070B14] hover:bg-[#1E2B44] text-[#8D9AAF] hover:text-[#F2F6FF] border border-[#243147] cursor-pointer"
              aria-label="Fermer l'assistant de déploiement"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Wizard Body */}
        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* ÉTAPE 1 : Nom de Domaine, Enregistrements DNS & Test TCP/SSH du VPS */}
          <section className="rounded-xl border border-[#243147] bg-[#070B14] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono-tabular text-[#45D7F4]">
                  01. VOTRE NOM DE DOMAINE, DNS &amp; ADRESSE IP DU VPS
                </p>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF] mt-0.5">
                  Renseignez votre nom de domaine et l&apos;adresse IP de votre VPS
                </h3>
              </div>

              {/* Mode Selector: Domain + HTTPS vs Direct IP */}
              <div className="flex items-center gap-1 p-1 bg-[#101827] border border-[#243147] rounded-lg">
                <button
                  type="button"
                  onClick={() => setAccessMode('domain')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    accessMode === 'domain'
                      ? 'bg-[#E5B84B] text-[#070B14] font-semibold'
                      : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                  }`}
                >
                  Mode Nom de Domaine + HTTPS (Recommandé)
                </button>
                <button
                  type="button"
                  onClick={() => setAccessMode('ip')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    accessMode === 'ip'
                      ? 'bg-[#E5B84B] text-[#070B14] font-semibold'
                      : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                  }`}
                >
                  Mode Adresse IP Directe
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-xs text-[#E5B84B] font-medium mb-1">
                  Votre Nom de Domaine (Panel &amp; VPN)
                </label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => handleDomainChange(e.target.value)}
                  placeholder="panel.votredomaine.xyz"
                  className="w-full px-3 py-2 bg-[#101827] border border-[#E5B84B]/50 focus:border-[#E5B84B] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">
                  Adresse IPv4 de votre VPS
                </label>
                <input
                  type="text"
                  value={vpsIp}
                  onChange={(e) => setVpsIp(e.target.value)}
                  placeholder="203.0.113.10"
                  className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">
                  Sous-domaine NS SlowDNS
                </label>
                <input
                  type="text"
                  value={slowDnsNs}
                  onChange={(e) => setSlowDnsNs(e.target.value)}
                  placeholder={`sdns1.${rootDomain}`}
                  className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8D9AAF] mb-1">
                  Utilisateur &amp; Port SSH VPS
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={vpsUser}
                    onChange={(e) => setVpsUser(e.target.value)}
                    placeholder="root"
                    className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none"
                  />
                  <input
                    type="number"
                    value={vpsPort}
                    onChange={(e) => setVpsPort(Number(e.target.value))}
                    min={1}
                    max={65535}
                    className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] rounded-lg text-sm font-mono-tabular text-[#F2F6FF] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Table des Enregistrements DNS à configurer chez le Registrar / Cloudflare */}
            {accessMode === 'domain' && (
              <div className="rounded-lg border border-[#243147] bg-[#101827] p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#F2F6FF]">
                    <Globe className="w-4 h-4 text-[#45D7F4]" />
                    <span>
                      Enregistrements DNS à créer chez votre fournisseur de domaine (Cloudflare,
                      Namecheap, Hostinger, OVH...)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-[#E5B84B]">
                    Important : Désactivez le proxy Cloudflare (DNS Only / Nuage Gris)
                  </span>
                </div>

                <div className="overflow-x-auto rounded border border-[#243147]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#151F31] border-b border-[#243147] text-[11px] font-mono-tabular uppercase text-[#8D9AAF]">
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Nom / Hôte</th>
                        <th className="py-2 px-3">Valeur / Cible</th>
                        <th className="py-2 px-3">Mode Proxy</th>
                        <th className="py-2 px-3">Usage</th>
                        <th className="py-2 px-3 text-right">Copier</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#243147] bg-[#070B14]">
                      {dnsRecords.map((rec) => (
                        <tr key={`${rec.type}-${rec.name}`}>
                          <td className="py-2 px-3 font-mono-tabular font-semibold text-[#E5B84B]">
                            {rec.type}
                          </td>
                          <td className="py-2 px-3 font-mono-tabular text-[#F2F6FF]">{rec.name}</td>
                          <td className="py-2 px-3 font-mono-tabular text-[#45D7F4]">
                            {rec.target}
                          </td>
                          <td className="py-2 px-3 font-mono-tabular text-[#28D17C]">
                            {rec.proxyMode}
                          </td>
                          <td className="py-2 px-3 text-[#8D9AAF]">{rec.purpose}</td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                void copyText(
                                  `${rec.type} ${rec.name} -> ${rec.target}`,
                                  `dns-${rec.name}`,
                                  `Enregistrement ${rec.type} ${rec.name}`
                                )
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-[11px] text-[#F2F6FF] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {copiedId === `dns-${rec.name}` ? (
                                <Check className="w-3 h-3 text-[#28D17C]" />
                              ) : (
                                <Copy className="w-3 h-3 text-[#45D7F4]" />
                              )}
                              {copiedId === `dns-${rec.name}` ? 'Copié' : 'Copier'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Live SSH Probe Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-[#8D9AAF]">
                <Server className="w-4 h-4 text-[#45D7F4]" />
                <span>
                  URL HTTPS du Panel :{' '}
                  <strong className="font-mono-tabular text-[#45D7F4]">{publicBaseUrl}</strong> ·
                  Console Super Admin :{' '}
                  <strong className="font-mono-tabular text-[#E5B84B]">
                    {publicBaseUrl}/admin
                  </strong>
                </span>
              </div>

              <button
                type="button"
                disabled={probing}
                onClick={() => void handleProbeVpsSsh()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/45 text-[#45D7F4] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {probing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Activity className="w-3.5 h-3.5" />
                )}
                {probing
                  ? `Sondage TCP ${cleanIp}:${cleanPort}...`
                  : `Tester la connexion SSH (${cleanIp}:${cleanPort})`}
              </button>
            </div>

            {probeResult && (
              <div
                className={`rounded-lg border px-4 py-3 text-xs font-mono-tabular flex flex-wrap items-center justify-between gap-2 ${
                  probeResult.reachable
                    ? 'border-[#28D17C]/45 bg-[#28D17C]/10 text-[#28D17C]'
                    : 'border-[#F59E0B]/45 bg-[#F59E0B]/10 text-[#F59E0B]'
                }`}
              >
                <span>
                  {probeResult.reachable
                    ? `VPS EN LIGNE (${probeResult.host}:${probeResult.port}) · Latence : ${probeResult.latencyMs} ms · Bannière : ${probeResult.sshBanner || 'SSH-2.0'}`
                    : `${probeResult.reason}`}
                </span>
                <span>{probeResult.status}</span>
              </div>
            )}
          </section>

          {/* ÉTAPE 2 : Générer la clé SSH de déploiement sur le VPS */}
          <section className="rounded-xl border border-[#243147] bg-[#070B14] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono-tabular text-[#45D7F4]">
                  02. CLÉ SSH DE DÉPLOIEMENT SUR VOTRE VPS
                </p>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF] mt-0.5">
                  Exécutez cette commande une seule fois sur votre VPS ({cleanUser}@{cleanIp})
                </h3>
                <p className="text-xs text-[#8D9AAF] mt-0.5">
                  Elle génère une clé Ed25519 dédiée à GitHub Actions, l&apos;autorise sur le VPS
                  et affiche la clé privée à copier dans le secret{' '}
                  <span className="font-mono-tabular text-[#E5B84B]">VPS_SSH_KEY</span>.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  void copyText(sshKeygenCommand, 'cmd-ssh-keygen', 'Commande de génération SSH')
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#F2F6FF] whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedId === 'cmd-ssh-keygen' ? (
                  <Check className="w-3.5 h-3.5 text-[#28D17C]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#45D7F4]" />
                )}
                {copiedId === 'cmd-ssh-keygen' ? 'Copié !' : 'Copier la commande VPS'}
              </button>
            </div>

            <pre className="p-3.5 rounded-lg bg-[#101827] border border-[#243147] text-xs font-mono-tabular text-[#45D7F4] overflow-x-auto leading-relaxed">
              {sshKeygenCommand}
            </pre>
          </section>

          {/* ÉTAPE 3 : Secrets GitHub Actions à configurer */}
          <section className="rounded-xl border border-[#243147] bg-[#070B14] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono-tabular text-[#45D7F4]">
                  03. SECRETS GITHUB ACTIONS POUR VOTRE DOMAINE &amp; VPS
                </p>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF] mt-0.5">
                  Ajoutez ces secrets dans votre dépôt GitHub → Settings → Secrets and variables →
                  Actions
                </h3>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#28D17C] font-mono-tabular">
                <KeyRound className="w-3.5 h-3.5" />
                <span>Certificat HTTPS Let&apos;s Encrypt généré automatiquement</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#243147]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#151F31] border-b border-[#243147] text-[11px] font-mono-tabular uppercase text-[#8D9AAF]">
                    <th className="py-2.5 px-3.5">Nom du Secret</th>
                    <th className="py-2.5 px-3.5">Statut</th>
                    <th className="py-2.5 px-3.5">Valeur à renseigner</th>
                    <th className="py-2.5 px-3.5">Rôle</th>
                    <th className="py-2.5 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#243147] text-xs bg-[#101827]">
                  {githubSecretsList.map((sec) => (
                    <tr key={sec.name} className="hover:bg-[#151F31]/60">
                      <td className="py-2.5 px-3.5 font-mono-tabular font-semibold text-[#E5B84B]">
                        {sec.name}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono-tabular text-[#F2F6FF]">
                        {sec.required}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono-tabular text-[#45D7F4]">
                        {sec.value}
                      </td>
                      <td className="py-2.5 px-3.5 text-[#8D9AAF]">{sec.desc}</td>
                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(
                              sec.name === 'VPS_SSH_KEY' ? sec.name : sec.value,
                              `sec-${sec.name}`,
                              sec.name
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-[11px] text-[#F2F6FF] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copiedId === `sec-${sec.name}` ? (
                            <Check className="w-3 h-3 text-[#28D17C]" />
                          ) : (
                            <Copy className="w-3 h-3 text-[#45D7F4]" />
                          )}
                          {copiedId === `sec-${sec.name}` ? 'Copié' : 'Copier'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ÉTAPE 4 : Déclencher le déploiement GitHub Actions (ou SSH direct) */}
          <section className="rounded-xl border border-[#243147] bg-[#070B14] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono-tabular text-[#45D7F4]">
                  04. LANCEMENT DU DÉPLOIEMENT &amp; ACCÈS HTTPS SUR VOTRE DOMAINE
                </p>
                <h3 className="font-display text-base font-semibold text-[#F2F6FF] mt-0.5">
                  Poussez le code sur GitHub (ou lancez le déploiement direct SSH)
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadWorkflowYaml}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/45 text-xs font-medium text-[#45D7F4] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Télécharger deploy-vps.yml
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(gitPushCommands, 'cmd-git-push', 'Commandes Git Push')
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5B84B] hover:bg-[#D4A136] text-[#070B14] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedId === 'cmd-git-push' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedId === 'cmd-git-push' ? 'Copié !' : 'Copier Commandes Git Push'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#8D9AAF] mb-1">
                URL de votre dépôt GitHub (pour générer la commande git remote add origin)
              </label>
              <input
                type="text"
                value={githubRepoUrl}
                onChange={(e) => setGithubRepoUrl(e.target.value)}
                placeholder="https://github.com/votre-compte/just-tech-services-panel.git"
                className="w-full px-3 py-2 bg-[#101827] border border-[#243147] focus:border-[#45D7F4] rounded-lg text-xs font-mono-tabular text-[#F2F6FF] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-[#8D9AAF]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#F2F6FF]">
                    <Terminal className="w-3.5 h-3.5 text-[#E5B84B]" />
                    Option A — Déploiement automatique via GitHub Actions
                  </span>
                </div>
                <pre className="p-3.5 rounded-lg bg-[#101827] border border-[#243147] text-xs font-mono-tabular text-[#F2F6FF] overflow-x-auto leading-relaxed">
                  {gitPushCommands}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-[#8D9AAF]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#F2F6FF]">
                    <Terminal className="w-3.5 h-3.5 text-[#45D7F4]" />
                    Option B — Déploiement direct en 1 commande SSH sur le VPS
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        directVpsCommand,
                        'cmd-direct-vps',
                        'Commande de déploiement direct VPS'
                      )
                    }
                    className="inline-flex items-center gap-1 text-[#45D7F4] hover:underline cursor-pointer"
                  >
                    {copiedId === 'cmd-direct-vps' ? 'Copié !' : 'Copier'}
                  </button>
                </div>
                <pre className="p-3.5 rounded-lg bg-[#101827] border border-[#243147] text-xs font-mono-tabular text-[#45D7F4] overflow-x-auto leading-relaxed">
                  {directVpsCommand}
                </pre>
              </div>
            </div>

            {/* Summary of Live Endpoints on the Domain */}
            <div className="rounded-lg border border-[#28D17C]/35 bg-[#101827] p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#28D17C]">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  Points d&apos;accès HTTPS &amp; VPN actifs dès la fin du workflow sur{' '}
                  {effectiveHost}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono-tabular">
                <div className="p-2.5 rounded bg-[#070B14] border border-[#243147]">
                  <p className="text-[#8D9AAF] text-[11px]">Portail Client Public (HTTPS)</p>
                  <a
                    href={publicBaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#45D7F4] hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    {publicBaseUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="p-2.5 rounded bg-[#070B14] border border-[#243147]">
                  <p className="text-[#8D9AAF] text-[11px]">
                    Console Super Admin (huguesjustin58@gmail.com)
                  </p>
                  <a
                    href={`${publicBaseUrl}/admin`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#E5B84B] hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    {publicBaseUrl}/admin
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="p-2.5 rounded bg-[#070B14] border border-[#243147]">
                  <p className="text-[#8D9AAF] text-[11px]">Hôte Tunnel SSH / WSS / SlowDNS</p>
                  <p className="text-[#28D17C] mt-0.5">
                    {effectiveHost} (:22, :80/ws, :443/ws, :8443) · NS: {cleanSlowDnsNs}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
