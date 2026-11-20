import React, { useState } from 'react';
import { ChartPoint } from '../types/panel';
import { formatFcfa } from '../data/maquetteData';

interface RevenueTrafficChartProps {
  data: ChartPoint[];
}

export const RevenueTrafficChart: React.FC<RevenueTrafficChartProps> = ({ data }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number>(Math.max(0, data.length - 1));

  if (data.length === 0) {
    return (
      <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
        <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
          Revenus & trafic réseau · 7 jours
        </h3>
        <p className="mt-4 rounded-lg border border-[#243147] bg-[#070B14] p-5 text-sm text-[#8D9AAF]">
          Aucune donnée réelle de trafic ou de revenu n’est enregistrée pour cette période.
          Le trafic VPN restera indiqué comme non mesuré tant qu’une source de télémétrie ne sera pas connectée.
        </p>
      </div>
    );
  }
  const [activeSeries, setActiveSeries] = useState<'both' | 'revenue' | 'traffic'>('both');

  const width = 680;
  const height = 220;
  const padX = 36;
  const padTop = 20;
  const padBottom = 30;
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;

  const maxRev = Math.max(...data.map((d) => d.revenueFcfa), 1) * 1.15;
  const maxTraffic = Math.max(...data.map((d) => d.trafficGb), 1) * 1.15;

  const getX = (index: number) =>
    padX + (data.length <= 1 ? 0 : (index / (data.length - 1)) * chartW);
  const getRevY = (val: number) => padTop + chartH - (val / maxRev) * chartH;
  const getTrafficY = (val: number) => padTop + chartH - (val / maxTraffic) * chartH;

  const revLine = data
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getRevY(pt.revenueFcfa).toFixed(1)}`)
    .join(' ');
  const revArea = `${revLine} L ${getX(data.length - 1).toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${getX(0).toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`;

  const trafficLine = data
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getTrafficY(pt.trafficGb).toFixed(1)}`)
    .join(' ');

  const currentPoint = data[hoveredIdx] ?? data[data.length - 1];

  return (
    <div className="bg-[#101827] border border-[#243147] rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-display text-base font-semibold text-[#F2F6FF]">
            Revenus FCFA & Trafic Réseau (7 jours)
          </h3>
          <p className="text-xs text-[#8D9AAF] mt-0.5 font-mono-tabular">
            {currentPoint.label} · <span className="text-[#E5B84B]">{formatFcfa(currentPoint.revenueFcfa)}</span> ·{' '}
            <span className="text-[#45D7F4]">{currentPoint.trafficGb} Go</span> consommés
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#070B14] border border-[#243147] rounded-lg">
          <button
            type="button"
            onClick={() => setActiveSeries('both')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSeries === 'both'
                ? 'bg-[#151F31] text-[#F2F6FF]'
                : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
            }`}
          >
            Combiné
          </button>
          <button
            type="button"
            onClick={() => setActiveSeries('revenue')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSeries === 'revenue'
                ? 'bg-[#151F31] text-[#E5B84B]'
                : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
            }`}
          >
            Revenus
          </button>
          <button
            type="button"
            onClick={() => setActiveSeries('traffic')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSeries === 'traffic'
                ? 'bg-[#151F31] text-[#45D7F4]'
                : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
            }`}
          >
            Trafic Go
          </button>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-56 min-w-[460px] select-none"
          role="img"
          aria-label="Graphique des revenus FCFA et du trafic en Go"
        >
          <defs>
            <linearGradient id="jtsGoldArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E5B84B" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#E5B84B" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((step) => {
            const y = padTop + chartH * step;
            return (
              <line
                key={step}
                x1={padX}
                y1={y}
                x2={width - padX}
                y2={y}
                stroke="#243147"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
            );
          })}

          {(activeSeries === 'both' || activeSeries === 'revenue') && (
            <>
              <path d={revArea} fill="url(#jtsGoldArea)" />
              <path
                d={revLine}
                fill="none"
                stroke="#E5B84B"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {(activeSeries === 'both' || activeSeries === 'traffic') && (
            <path
              d={trafficLine}
              fill="none"
              stroke="#45D7F4"
              strokeWidth="2.25"
              strokeDasharray={activeSeries === 'both' ? '5 4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {data.map((pt, i) => {
            const x = getX(i);
            const isActive = i === hoveredIdx;
            return (
              <g key={pt.label}>
                {isActive && (
                  <line
                    x1={x}
                    y1={padTop}
                    x2={x}
                    y2={padTop + chartH}
                    stroke="#243147"
                    strokeWidth="1.5"
                  />
                )}
                {(activeSeries === 'both' || activeSeries === 'revenue') && (
                  <circle
                    cx={x}
                    cy={getRevY(pt.revenueFcfa)}
                    r={isActive ? 5 : 3}
                    fill="#070B14"
                    stroke="#E5B84B"
                    strokeWidth="2"
                  />
                )}
                {(activeSeries === 'both' || activeSeries === 'traffic') && (
                  <circle
                    cx={x}
                    cy={getTrafficY(pt.trafficGb)}
                    r={isActive ? 5 : 3}
                    fill="#070B14"
                    stroke="#45D7F4"
                    strokeWidth="2"
                  />
                )}
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill={isActive ? '#F2F6FF' : '#8D9AAF'}
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {pt.label}
                </text>
                <rect
                  x={x - chartW / data.length / 2}
                  y={padTop}
                  width={chartW / data.length}
                  height={chartH + padBottom}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(i)}
                  onClick={() => setHoveredIdx(i)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-6 mt-2 pt-3 border-t border-[#243147] text-xs text-[#8D9AAF]">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#E5B84B] inline-block" />
          Revenus journaliers (FCFA)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-[#45D7F4] inline-block" />
          Volume réseau cumulé (Go)
        </span>
      </div>
    </div>
  );
};
