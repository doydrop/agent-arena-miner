import type { AppConfig } from "./config.js";
import type { Logger } from "./redact.js";
import { evaluateGates, historyFromSubmissions, needsScreenshot } from "./gates/quality.js";
import type { Ledger } from "./ledger/store.js";
import { enforceOneSide, pickMarkets, qualificationOf, type MarketHistory } from "./picker/pick.js";
import { syncEvidencePdf } from "./pdf/evidence-pdf.js";
import { researchMarkets } from "./researcher/research.js";
import type { Draft, RunReport, RunStep, SubmissionRecord } from "./types.js";
import { fetchMarkets } from "./watcher/markets.js";
import { seedSample } from "./watcher/fixtures.js";

export async function runPipeline(options: {
  config: AppConfig;
  ledger: Ledger;
  log: Logger;
  fetchImpl?: typeof fetch;
}): Promise<RunReport> {
  const { config, ledger } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = new Date();
  let sample = config.preferSample;
  let fallback: string | null = null;

  if (!sample && !config.siteUrl) {
    if (config.live) {
      throw new Error("Set COMPETITION_SITE_URL in .env before --live. Nothing was sent.");
    }
    sample = true;
    fallback = "COMPETITION_SITE_URL is empty, so this run is using the sample set.";
  }
  if (sample && config.live) {
    throw new Error("Refusing to go live on sample data. Nothing was sent.");
  }

  if (sample) {
    if (ledger.seeded && !ledger.sample) {
      fallback =
        fallback ??
        "The saved queue came from a live market list, so the sample set was left out.";
    } else if (!ledger.seeded || !ledger.sample) {
      await seedSample(ledger, config.root, config.attachPdf);
    } else {
      for (const draft of ledger.drafts) await syncEvidencePdf(draft, ledger.dir, config.attachPdf);
      await ledger.save();
    }
    return buildReport(config, ledger, ledger.sample, fallback, started);
  }

  if (ledger.sample) {
    ledger.drafts = [];
    ledger.submissions = [];
    ledger.notes = [];
    ledger.markets = [];
    ledger.sample = false;
    ledger.seeded = true;
    await ledger.save();
    options.log.info("Cleared the sample queue before reading live markets.");
  }

  let markets: Awaited<ReturnType<typeof fetchMarkets>> = [];
  try {
    markets = await fetchMarkets(config.siteUrl, fetchImpl);
  } catch (error) {
    if (config.live) {
      const message = error instanceof Error ? error.message : "Could not read markets.";
      throw new Error(`${message} Nothing was sent.`);
    }
    const reason = error instanceof Error ? error.message : "network error";
    if (!ledger.seeded || ledger.sample) {
      if (!ledger.sample) await seedSample(ledger, config.root, config.attachPdf);
      return buildReport(
        config,
        ledger,
        true,
        `The market list could not be read (${reason}). Showing the sample set.`,
        started,
      );
    }
    return buildReport(
      config,
      ledger,
      false,
      `The market list could not be read (${reason}). The saved queue was left as it is.`,
      started,
    );
  }

  const history = pickerHistory(ledger.submissions);
  const picked = pickMarkets(markets, history, Date.now());
  const pending = new Set(
    ledger.drafts.filter((draft) => draft.status === "pending").map((draft) => draft.marketAddress.toLowerCase()),
  );
  const todo = picked.filter((pick) => !pending.has(pick.market.address.toLowerCase()) && pick.remaining > 0);
  const research = await researchMarkets(todo, {
    fetchImpl,
    llm: config.llmApiKey
      ? { apiKey: config.llmApiKey, baseUrl: config.llmBaseUrl, model: config.llmModel }
      : null,
  });
  const oneSide = enforceOneSide(
    research.drafts.map((draft) => ({ ...draft, score: 1 })),
    history,
  );
  for (const draft of oneSide) {
    if (ledger.drafts.some((existing) => existing.id === draft.id && existing.status === "pending")) continue;
    await syncEvidencePdf(draft, ledger.dir, config.attachPdf);
    ledger.drafts.push(draft);
  }
  ledger.notes.push(...research.notes);
  ledger.markets = markets;
  ledger.sample = false;
  ledger.seeded = true;
  const openMarkets = markets.filter((market) => market.status === "open").length;
  ledger.lastScan = {
    at: started.toISOString(),
    openMarkets,
    picked: picked.length,
    sources: research.notes.length,
    sample: false,
  };
  await ledger.save();

  const report = buildReport(config, ledger, false, null, started);
  report.steps = liveSteps(started, openMarkets, picked.length, research, oneSide.length);
  return report;
}

function liveSteps(
  started: Date,
  openMarkets: number,
  picked: number,
  research: { notes: unknown[]; skippedSocial: number; empty: number },
  drafted: number,
): RunStep[] {
  const at = clock(started);
  const social =
    research.skippedSocial > 0
      ? ` Skipped ${research.skippedSocial} X or Reddit links. Paste those yourself, with a screenshot.`
      : "";
  const empty =
    research.empty > 0 ? ` ${research.empty} markets had no dated public excerpt. Nothing was invented.` : "";
  return [
    { at, title: "Scan markets", detail: `${openMarkets} open markets, read from the competition list.`, state: "done" },
    {
      at,
      title: "Pick markets",
      detail: `${picked} candidates, odds 20–80%, one side per market. The rest were skipped.`,
      state: "done",
    },
    {
      at,
      title: "Research evidence",
      detail: `Free sources. ${research.notes.length} notes, ${drafted} new drafts.${social}${empty}`,
      state: "done",
    },
    {
      at,
      title: "Quality gate",
      detail: "A URL has to open once with no browser. X, Reddit, and paywalls need a quote and a screenshot.",
      state: "done",
    },
    {
      at,
      title: "Review queue",
      detail: "Drafts are waiting at the dashboard. Nothing is sent until you approve, and only in live mode.",
      state: "wait",
    },
  ];
}

export function buildReport(
  config: AppConfig,
  ledger: Ledger,
  sample: boolean,
  fallback: string | null,
  started = new Date(),
): RunReport {
  const history = historyFromSubmissions(ledger.submissions);
  const pending = ledger.drafts.filter((draft) => draft.status === "pending");
  const candidates = pending.map((draft) => {
    const gates = evaluateGates(draft, history);
    const needsShot = needsScreenshot(draft) && !draft.files.some((file) => file.role === "screenshot");
    const tone = gates.ok ? "ok" : "warn";
    const status = gates.ok ? "ready for review" : needsShot ? "needs screenshot" : "held at the gate";
    return {
      question: draft.question,
      side: draft.side,
      oddsYes: draft.oddsYes,
      evidence: draft.links.length,
      status,
      tone: tone as "ok" | "warn",
    };
  });
  const names = namesFor(ledger);
  const coverage = qualificationOf(ledger.submissions, names);
  const ready = pending.filter((draft) => evaluateGates(draft, history).ok).length;
  const at = clock(started);
  const steps: RunStep[] = [
    {
      at,
      title: "Scan markets",
      detail: sample
        ? `${ledger.lastScan?.openMarkets ?? ledger.markets.length} open markets in the sample set`
        : `${ledger.lastScan?.openMarkets ?? 0} open markets, read from the competition list`,
      state: "done",
    },
    {
      at,
      title: "Pick markets",
      detail: `${pending.length} candidates, odds 20–80%, one side per market. The rest were skipped.`,
      state: "done",
    },
    {
      at,
      title: "Research evidence",
      detail: sample
        ? `Sample pack: ${ledger.notes.length} sources across ${ledger.drafts.length} drafts. No network calls.`
        : `Free sources. ${ledger.notes.length} notes on file.`,
      state: "done",
    },
    {
      at,
      title: "Quality gate",
      detail: "A URL has to open once with no browser. X, Reddit, and paywalls need a quote and a screenshot.",
      state: "done",
    },
    {
      at,
      title: "Review queue",
      detail: `${pending.length} candidates are waiting at the dashboard. Nothing has been sent.`,
      state: "wait",
    },
  ];
  return {
    sample,
    dryRun: !config.live,
    fallbackReason: fallback,
    openMarkets: ledger.lastScan?.openMarkets ?? ledger.markets.length,
    steps,
    candidates,
    coverage,
    sourceCount: ledger.notes.length,
    dashboardUrl: `http://${config.host}:${config.port}`,
    blocked: pending.length - ready,
    ready,
  };
}

function namesFor(ledger: Ledger): { address: string; name: string }[] {
  const names: { address: string; name: string }[] = [];
  for (const draft of ledger.drafts) names.push({ address: draft.marketAddress, name: draft.shortName });
  for (const row of ledger.submissions) names.push({ address: row.marketAddress, name: row.shortName });
  for (const market of ledger.markets) names.push({ address: market.address, name: market.shortName });
  return names;
}

function pickerHistory(submissions: SubmissionRecord[]): MarketHistory[] {
  const map = new Map<string, MarketHistory>();
  for (const row of submissions) {
    if (!row.countsTowardCap && !row.countsAsJudged) continue;
    const key = row.marketAddress.toLowerCase();
    let item = map.get(key);
    if (!item) {
      item = { address: row.marketAddress, sent: 0, judged: 0, side: null, conflict: false };
      map.set(key, item);
    }
    if (row.countsTowardCap) {
      item.sent += 1;
      if (item.side && item.side !== row.side) item.conflict = true;
      else item.side = row.side;
    }
    if (row.countsAsJudged) item.judged += 1;
  }
  return [...map.values()];
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function pendingDraft(ledger: Ledger, id: string): Draft | undefined {
  return ledger.drafts.find((draft) => draft.id === id && draft.status === "pending");
}
