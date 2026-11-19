import React from 'react';
import { PLANS, formatFcfa } from '../data/maquetteData';
import { LicenseStatusText } from './StatusText';
import { LicenseStatus } from '../types/panel';

const PALETTE = [
  { name: 'Obsidian Night', hex: '#070B14', usage: 'Arrière-plan principal (60%)' },
  { name: 'Panel Surface', hex: '#101827', usage: 'Cartes, sidebar, tableaux (30%)' },
  { name: 'Panel Raised', hex: '#151F31', usage: 'Surfaces surélevées, hover, modales' },
  { name: 'Brand Gold', hex: '#E5B84B', usage: 'Identité JH, CTA principaux, revenus FCFA' },
  { name: 'Platinum Silver', hex: '#E8EEF5', usage: 'Monogramme, valeurs clés, titres' },
  { name: 'Network Cyan', hex: '#45D7F4', usage: 'Télémétrie VPN, quotas actifs, SlowDNS' },
  { name: 'Muted Slate', hex: '#8D9AAF', usage: 'Labels, métadonnées, légendes' },
  { name: 'Hairline Stroke', hex: '#243147', usage: 'Séparateurs et bordures 1px' },
];

const STATUSES: LicenseStatus[] = [
  'En attente',
  'En provisionnement',
  'Active',
  'Suspendue',
  'Quota épuisé',
  'Expirée',
  'Révoquée',
];

export const DesignSystemView: React.FC = () => {
  return (
    <div className="max-w-6xl mx-auto p-5 lg:p-7 space-y-8">
      {/* Official Brand Identity Card featuring the uploaded logo */}
      <section className="bg-[#101827] border border-[#E5B84B]/35 rounded-xl p-6 flex flex-col md:flex-row items-center gap-6">
        <div className="w-36 h-36 rounded-xl overflow-hidden border border-[#E5B84B]/50 bg-[#070B14] shrink-0">
          <img
            src="/assets/aistudio/image_745e91e4.png"
            alt="Logo officiel JUST TECH SERVICES"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="space-y-3 text-center md:text-left">
          <p className="text-xs font-medium text-[#E5B84B]">
            Identité Visuelle Officielle · Adaptée au Panel
          </p>
          <h1 className="font-display text-2xl font-semibold text-[#F2F6FF]">
            JUST TECH SERVICES — Solutions digitales, avenir illimité.
          </h1>
          <p className="text-sm text-[#8D9AAF] max-w-2xl">
            Direction artistique alignée sur le monogramme officiel JH : fond Obsidienne profond
            (#070B14), Or brossé (#E5B84B) pour les actions et revenus FCFA, Argent Platine
            (#E8EEF5) pour la lisibilité et Cyan Réseau (#45D7F4) pour la télémétrie SSH/SlowDNS.
          </p>
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-1 text-xs text-[#E8EEF5]">
            <span>Innovation</span>
            <span className="text-[#E5B84B]" aria-hidden="true">|</span>
            <span>Fiabilité</span>
            <span className="text-[#E5B84B]" aria-hidden="true">|</span>
            <span>Satisfaction</span>
            <span className="text-[#243147]" aria-hidden="true">·</span>
            <span className="text-[#8D9AAF]">Sécurité & Performance · Support 24/7</span>
          </div>
        </div>
      </section>

      {/* Palette */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
          Palette Harmonisée Or, Platine & Obsidienne
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PALETTE.map((token) => (
            <div
              key={token.hex}
              className="bg-[#101827] border border-[#243147] rounded-xl p-4 space-y-3"
            >
              <div
                className="h-12 w-full rounded-lg border border-[#243147]"
                style={{ backgroundColor: token.hex }}
              />
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#F2F6FF]">{token.name}</span>
                  <span className="font-mono-tabular text-xs text-[#E5B84B]">{token.hex}</span>
                </div>
                <p className="text-xs text-[#8D9AAF] mt-1">{token.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Typography & Statuses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
            Hiérarchie Typographique (2+1)
          </h2>
          <div className="divide-y divide-[#243147] text-sm">
            <div className="py-3 first:pt-0">
              <span className="text-xs text-[#8D9AAF]">Display / Titres · Plus Jakarta Sans</span>
              <p className="font-display text-xl font-semibold text-[#F2F6FF] mt-1">
                Orchestration Réseau & Abonnements
              </p>
            </div>
            <div className="py-3">
              <span className="text-xs text-[#8D9AAF]">Corps & Tableaux · DM Sans</span>
              <p className="text-sm text-[#E8EEF5] mt-1">
                Interface fluide pour Super Admin, Revendeur cloisonné et Client mobile-first.
              </p>
            </div>
            <div className="py-3 last:pb-0">
              <span className="text-xs text-[#8D9AAF]">Métriques & Réseau · JetBrains Mono</span>
              <p className="font-mono-tabular text-sm text-[#E5B84B] mt-1">
                1 354 000 FCFA · 194.163.142.88:443 · jts_fmbarga92
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[#101827] border border-[#243147] rounded-xl p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
            7 États Normalisés de Licence
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STATUSES.map((status) => (
              <div
                key={status}
                className="flex items-center justify-between px-3 py-2.5 bg-[#070B14] border border-[#243147] rounded-lg"
              >
                <LicenseStatusText status={status} />
                <span className="font-mono-tabular text-[11px] text-[#8D9AAF]">État OS</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Pricing Matrix Preview */}
      <section className="bg-[#101827] border border-[#243147] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#243147]">
          <h2 className="font-display text-base font-semibold text-[#F2F6FF]">
            Grille Commerciale des Formules (FCFA)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#243147] text-xs text-[#8D9AAF]">
                <th className="py-3 px-5 font-medium">Formule</th>
                <th className="py-3 px-4 font-medium">Public cible</th>
                <th className="py-3 px-4 font-medium text-right">Prix Public</th>
                <th className="py-3 px-4 font-medium text-right">Tarif Revendeur</th>
                <th className="py-3 px-4 font-medium text-right">Quota / Durée</th>
                <th className="py-3 px-5 font-medium">Protocoles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#243147] text-sm">
              {PLANS.map((plan) => (
                <tr key={plan.id} className="hover:bg-[#151F31]/60">
                  <td className="py-3 px-5 font-medium text-[#F2F6FF]">
                    {plan.isVip ? <span className="text-[#E5B84B]">{plan.name}</span> : plan.name}
                  </td>
                  <td className="py-3 px-4 text-xs text-[#8D9AAF]">{plan.audience}</td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-[#F2F6FF]">
                    {formatFcfa(plan.priceFcfa)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-[#E5B84B]">
                    {formatFcfa(plan.resellerPriceFcfa)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-xs text-[#F2F6FF]">
                    {plan.dataQuotaGb ?? 0} Go · {plan.durationLabel} · {plan.maxSessions} sess.
                  </td>
                  <td className="py-3 px-5 text-xs text-[#8D9AAF]">
                    {plan.protocols.join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
