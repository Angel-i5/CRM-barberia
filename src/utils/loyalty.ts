import { Client, CRMSettings, RewardTier } from '../types';

/**
 * Programa de fidelización por NIVELES.
 *
 * Ejemplo por defecto:
 *   - 5 cortes  → 20% de descuento
 *   - 10 cortes → Corte gratis (cierra el ciclo y la tarjeta vuelve a 0)
 *
 * Cada cliente acumula `cycleVisits`. Al canjear un nivel intermedio se
 * registra en `claimedTiers` (ej. "5") para no poder canjearlo dos veces.
 * Al canjear el ÚLTIMO nivel el ciclo se reinicia (cycleVisits = 0).
 */

export const DEFAULT_REWARD_TIERS: RewardTier[] = [
  { visits: 5, type: 'discount', discountPercent: 20, title: '20% de descuento en tu próximo corte' },
  { visits: 10, type: 'free', title: 'Corte de cabello gratis' }
];

/** Limpia, ordena y valida una lista de niveles. Nunca devuelve una lista vacía. */
export function normalizeTiers(tiers?: RewardTier[] | null): RewardTier[] {
  if (!Array.isArray(tiers)) return DEFAULT_REWARD_TIERS.map(t => ({ ...t }));

  const seen = new Set<number>();
  const clean: RewardTier[] = [];

  for (const raw of tiers) {
    if (!raw) continue;
    const visits = Math.floor(Number(raw.visits));
    if (!Number.isFinite(visits) || visits < 1 || visits > 100 || seen.has(visits)) continue;
    seen.add(visits);

    const type = raw.type === 'free' || raw.type === 'custom' ? raw.type : 'discount';
    const pct = Math.min(100, Math.max(1, Math.round(Number(raw.discountPercent) || 0)));
    const tier: RewardTier = {
      visits,
      type,
      title: String(raw.title || '').trim()
    };
    if (type === 'discount') {
      tier.discountPercent = pct || 10;
    }
    if (!tier.title) {
      tier.title =
        type === 'discount'
          ? `${tier.discountPercent}% de descuento`
          : type === 'free'
          ? 'Corte gratis'
          : 'Premio especial';
    }
    clean.push(tier);
  }

  clean.sort((a, b) => a.visits - b.visits);
  return clean.length > 0 ? clean : DEFAULT_REWARD_TIERS.map(t => ({ ...t }));
}

/** Niveles ya normalizados de la configuración. */
export function getTiers(settings: Pick<CRMSettings, 'rewardTiers'>): RewardTier[] {
  return normalizeTiers(settings.rewardTiers);
}

/** Último nivel = el que completa y reinicia el ciclo. */
export function getFinalTier(settings: Pick<CRMSettings, 'rewardTiers'>): RewardTier {
  const tiers = getTiers(settings);
  return tiers[tiers.length - 1];
}

/**
 * Mantiene sincronizados los campos heredados (`loyaltyTargetVisits`,
 * `rewardBenefit`) con los niveles. Así la tarjeta, la hoja de Sheets y el
 * resto de pantallas siguen funcionando con una sola fuente de verdad.
 */
export function withDerivedLoyaltyFields(settings: CRMSettings): CRMSettings {
  const tiers = normalizeTiers(settings.rewardTiers);
  const last = tiers[tiers.length - 1];
  return {
    ...settings,
    rewardTiers: tiers,
    loyaltyTargetVisits: last.visits,
    rewardBenefit: last.title
  };
}

/** Umbrales de niveles ya canjeados en el ciclo actual. */
export function getClaimedTiers(client: Pick<Client, 'claimedTiers'>): number[] {
  const raw = client.claimedTiers;
  if (raw === undefined || raw === null || raw === '') return [];
  return String(raw)
    .split(',')
    .map(s => Math.floor(Number(s.trim())))
    .filter(n => Number.isFinite(n) && n > 0);
}

/** Niveles desbloqueados (visitas alcanzadas) que todavía no se han canjeado. */
export function getUnlockedTiers(
  client: Pick<Client, 'cycleVisits' | 'claimedTiers'>,
  settings: Pick<CRMSettings, 'rewardTiers'>
): RewardTier[] {
  const claimed = new Set(getClaimedTiers(client));
  const cycle = client.cycleVisits || 0;
  return getTiers(settings).filter(t => cycle >= t.visits && !claimed.has(t.visits));
}

/** ¿Tiene al menos un premio listo para canjear? */
export function hasRewardReady(
  client: Pick<Client, 'cycleVisits' | 'claimedTiers'>,
  settings: Pick<CRMSettings, 'rewardTiers'>
): boolean {
  return getUnlockedTiers(client, settings).length > 0;
}

/** Siguiente nivel por alcanzar (el primero no canjeado con más visitas que las actuales). */
export function getNextTier(
  client: Pick<Client, 'cycleVisits' | 'claimedTiers'>,
  settings: Pick<CRMSettings, 'rewardTiers'>
): RewardTier | null {
  const claimed = new Set(getClaimedTiers(client));
  const cycle = client.cycleVisits || 0;
  return getTiers(settings).find(t => t.visits > cycle && !claimed.has(t.visits)) || null;
}

/** Etiqueta corta para chips y para la tarjeta: "-20%", "GRATIS", "PREMIO". */
export function tierShortLabel(tier: RewardTier): string {
  if (tier.type === 'discount') return `-${tier.discountPercent || 0}%`;
  if (tier.type === 'free') return 'GRATIS';
  return 'PREMIO';
}

/** Descripción completa: "A las 5 visitas · 20% de descuento". */
export function describeTier(tier: RewardTier): string {
  return `A las ${tier.visits} visitas · ${tier.title}`;
}

/** Importe a cobrar al aplicar un premio a un servicio. */
export function applyTierToAmount(amount: number, tier: RewardTier | null | undefined): number {
  const base = Number(amount) || 0;
  if (!tier) return base;
  if (tier.type === 'free') return 0;
  if (tier.type === 'discount') {
    const pct = Math.min(100, Math.max(0, tier.discountPercent || 0));
    return Math.round(base * (1 - pct / 100) * 100) / 100;
  }
  return base; // 'custom' → premio manual, no cambia el importe
}

/**
 * Devuelve el cliente actualizado tras canjear un nivel.
 *  - Nivel intermedio: se marca como canjeado, el ciclo continúa.
 *  - Último nivel: el ciclo vuelve a 0 y se limpian los canjes.
 */
export function claimTier(
  client: Client,
  tier: RewardTier,
  settings: Pick<CRMSettings, 'rewardTiers'>
): Client {
  const final = getFinalTier(settings);
  if (tier.visits >= final.visits) {
    return { ...client, cycleVisits: 0, claimedTiers: '' };
  }
  const claimed = new Set(getClaimedTiers(client));
  claimed.add(tier.visits);
  return {
    ...client,
    claimedTiers: Array.from(claimed)
      .sort((a, b) => a - b)
      .join(',')
  };
}

/** Niveles que se cruzaron al pasar de `before` a `after` visitas (para avisar "¡desbloqueó premio!"). */
export function tiersCrossed(
  before: number,
  after: number,
  settings: Pick<CRMSettings, 'rewardTiers'>
): RewardTier[] {
  return getTiers(settings).filter(t => before < t.visits && after >= t.visits);
}
