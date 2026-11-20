import { ASSUMPTIONS } from "../delphi/assumptions.js";
import type { MarketCoverage, PickerMarket, Qualification, Side } from "../types.js";

export interface MarketHistory {
  address: string;
  sent: number;
  judged: number;
  side: Side | null;
  conflict: boolean;
}

export interface PickedMarket {
  market: PickerMarket;
  score: number;
  /** Locked when this market already has sent submissions. Null means research may propose one side. */
  side: Side | null;
  remaining: number;
  probability: number;
}

export interface PickLimits {
  oddsMin: number;
  oddsMax: number;
  maxPerMarket: number;
  qualifyMarkets: number;
}

export const DEFAULT_LIMITS: PickLimits = {
  oddsMin: ASSUMPTIONS.oddsBand[0],
  oddsMax: ASSUMPTIONS.oddsBand[1],
  maxPerMarket: ASSUMPTIONS.maxSubmissionsPerMarket,
  qualifyMarkets: ASSUMPTIONS.qualifyMarkets,
};

export function marketSlots(used: number, max = DEFAULT_LIMITS.maxPerMarket): {
  used: number;
  remaining: number;
  slots: boolean[];
} {
  const safe = Number.isFinite(used) ? Math.floor(used) : 0;
  const filled = Math.max(0, Math.min(max, safe));
  return {
    used: filled,
    remaining: max - filled,
    slots: Array.from({ length: max }, (_, index) => index < filled),
  };
}

/** Market odds decide the band. The forecaster probability is used only when odds are missing. */
export function bandProbability(market: PickerMarket): number | null {
  const odds = normalizeProbability(market.oddsYes);
  if (odds != null) return odds;
  return normalizeProbability(market.forecasterYes);
}

function normalizeProbability(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const scaled = value > 1 ? value / 100 : value;
  if (scaled < 0 || scaled > 1) return null;
  return scaled;
}

export function pickMarkets(
  markets: PickerMarket[],
  history: MarketHistory[],
  now: number,
  limits: PickLimits = DEFAULT_LIMITS,
): PickedMarket[] {
  const judgedMarkets = new Set(history.filter((row) => row.judged > 0).map((row) => row.address.toLowerCase()));
  const needCoverage = judgedMarkets.size < limits.qualifyMarkets;
  const picked: PickedMarket[] = [];

  for (const market of markets) {
    if (market.status !== "open") continue;
    const cutoff = Date.parse(market.evidenceCutoffAt);
    if (!Number.isFinite(cutoff) || cutoff <= now) continue;
    const probability = bandProbability(market);
    if (probability == null || probability < limits.oddsMin || probability > limits.oddsMax) continue;

    const hist = history.find((row) => row.address.toLowerCase() === market.address.toLowerCase());
    if (hist?.conflict) continue;
    const sent = hist?.sent ?? 0;
    if (sent >= limits.maxPerMarket) continue;

    const hoursLeft = (cutoff - now) / 3_600_000;
    const center = 1 - Math.abs(probability - 0.5) / 0.5;
    const urgency = 1 / (1 + hoursLeft / 24);
    const coverageBoost = needCoverage && (hist?.judged ?? 0) === 0 ? 2 : 0;
    const pot =
      market.rewardPotUsd != null && market.rewardPotUsd > 0
        ? Math.min(0.3, Math.log10(market.rewardPotUsd + 1) / 10)
        : 0;
    const score = center * 2 + urgency + coverageBoost + pot;

    picked.push({
      market,
      score,
      side: hist?.side ?? null,
      remaining: limits.maxPerMarket - sent,
      probability,
    });
  }

  picked.sort(
    (a, b) => b.score - a.score || a.market.question.localeCompare(b.market.question),
  );
  return picked;
}

export function enforceOneSide<T extends { marketAddress: string; side: Side | null; score: number }>(
  items: T[],
  history: MarketHistory[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.marketAddress.toLowerCase();
    const hist = history.find((row) => row.address.toLowerCase() === key);
    if (hist?.conflict) continue;
    if (hist?.side && item.side && item.side !== hist.side) continue;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const kept: T[] = [];
  for (const list of groups.values()) {
    const sides = [...new Set(list.map((item) => item.side).filter((side): side is Side => side != null))];
    if (sides.length <= 1) {
      kept.push(...list);
      continue;
    }
    let bestSide: Side = sides[0];
    let bestScore = -Infinity;
    for (const side of sides) {
      const score = Math.max(...list.filter((item) => item.side === side).map((item) => item.score));
      if (score > bestScore) {
        bestScore = score;
        bestSide = side;
      }
    }
    kept.push(...list.filter((item) => item.side === bestSide));
  }
  return kept;
}

export function qualificationOf(
  submissions: { marketAddress: string; countsTowardCap: boolean; countsAsJudged: boolean }[],
  names: { address: string; name: string }[],
): Qualification {
  const cap = new Map<string, number>();
  const judged = new Map<string, number>();
  for (const row of submissions) {
    const key = row.marketAddress.toLowerCase();
    if (row.countsTowardCap) cap.set(key, (cap.get(key) ?? 0) + 1);
    if (row.countsAsJudged) judged.set(key, (judged.get(key) ?? 0) + 1);
  }

  const order: { key: string; name: string; address: string }[] = [];
  const seen = new Set<string>();
  const push = (address: string, name: string) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    order.push({ key, name, address });
  };
  for (const entry of names) push(entry.address, entry.name);
  for (const key of cap.keys()) push(key, key);

  const perMarket: MarketCoverage[] = order.map((entry) => ({
    address: entry.address,
    name: entry.name,
    ...marketSlots(cap.get(entry.key) ?? 0),
  }));

  let judgedSubmissions = 0;
  for (const count of judged.values()) judgedSubmissions += count;

  return {
    submissions: judgedSubmissions,
    submissionsGoal: ASSUMPTIONS.qualifySubmissions,
    markets: judged.size,
    marketsGoal: ASSUMPTIONS.qualifyMarkets,
    perMarket,
  };
}
