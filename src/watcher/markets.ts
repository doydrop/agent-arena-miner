import type { PickerMarket } from "../types.js";

/**
 * ASSUMPTION: /markets.json is either an array or { markets: [...] }.
 * The starter reads address, question, status, odds.yes, evidenceCutoffAt, dataSources.
 * Aliases below cover likely renames. Unknown records are skipped, not invented.
 */
export function normalizeMarket(raw: unknown): PickerMarket | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const address = text(row.address ?? row.marketAddress ?? row.id);
  const question = text(row.question ?? row.title ?? row.name);
  if (!address || !question) return null;
  const odds = row.odds && typeof row.odds === "object" ? (row.odds as Record<string, unknown>) : {};
  const forecaster =
    row.forecaster && typeof row.forecaster === "object" ? (row.forecaster as Record<string, unknown>) : {};
  const oddsYes = number(odds.yes ?? row.yesPrice ?? row.impliedProbability ?? row.probability);
  const forecasterYes = number(forecaster.yes ?? row.forecasterYes ?? row.aiProbability ?? row.forecast);
  const sources = array(row.dataSources ?? row.sources ?? row.links);
  const short = text(row.shortName) || question.replace(/^Will (the |it )?/i, "").slice(0, 32);
  return {
    address,
    question,
    shortName: short,
    status: text(row.status) || "open",
    oddsYes: oddsYes ?? Number.NaN,
    forecasterYes,
    evidenceCutoffAt: text(row.evidenceCutoffAt ?? row.evidence_cutoff ?? row.cutoff ?? row.evidenceCutoff) || "",
    closesAt: text(row.closesAt ?? row.closeTime ?? row.resolvesAt ?? row.tradingDeadline) || null,
    rewardPotUsd: number(row.rewardPotUsd ?? row.rewardPot ?? row.pot ?? row.judgementPot),
    dataSources: sources,
  };
}

export function parseMarketFeed(body: unknown): PickerMarket[] {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { markets?: unknown }).markets)
      ? (body as { markets: unknown[] }).markets
      : [];
  return rows.map(normalizeMarket).filter((market): market is PickerMarket => market != null);
}

export async function fetchMarkets(siteUrl: string, fetchImpl: typeof fetch = fetch): Promise<PickerMarket[]> {
  const url = new URL("/markets.json", siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET /markets.json failed (${response.status}).`);
  return parseMarketFeed(await response.json());
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function array(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
