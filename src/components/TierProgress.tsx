import React from 'react';
import { Check, Gift } from 'lucide-react';
import { Client, CRMSettings } from '../types';
import { getClaimedTiers, getFinalTier, getTiers, tierShortLabel } from '../utils/loyalty';

interface TierProgressProps {
  client: Pick<Client, 'cycleVisits' | 'claimedTiers'>;
  settings: Pick<CRMSettings, 'rewardTiers'>;
}

/**
 * Barra de progreso del ciclo con un marcador por cada premio
 * (ej. "-20%" en la visita 5 y "GRATIS" en la 10).
 * Verde = listo para canjear · ✓ = ya canjeado.
 */
export const TierProgress: React.FC<TierProgressProps> = ({ client, settings }) => {
  const tiers = getTiers(settings);
  const final = getFinalTier(settings).visits;
  const cycle = Math.min(client.cycleVisits || 0, final);
  const claimed = new Set(getClaimedTiers(client));
  const pct = Math.min(100, (cycle / final) * 100);

  return (
    <div className="pt-1 pb-6">
      <div className="relative h-2 rounded-full bg-[#1b1f2a]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
        {tiers.map(t => {
          const reached = (client.cycleVisits || 0) >= t.visits;
          const done = claimed.has(t.visits);
          const left = (t.visits / final) * 100;
          return (
            <div
              key={t.visits}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${left}%` }}
            >
              <span
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  done
                    ? 'bg-slate-600 border-slate-400 text-white'
                    : reached
                    ? 'bg-emerald-500 border-emerald-300 text-slate-950'
                    : 'bg-[#14171d] border-amber-700/70 text-amber-600'
                }`}
              >
                {done ? <Check className="w-3 h-3" /> : <Gift className="w-3 h-3" />}
              </span>
              <span
                className={`absolute top-6 text-[9px] font-bold whitespace-nowrap ${
                  done ? 'text-slate-500' : reached ? 'text-emerald-400' : 'text-amber-500/80'
                }`}
              >
                {t.visits} · {tierShortLabel(t)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
