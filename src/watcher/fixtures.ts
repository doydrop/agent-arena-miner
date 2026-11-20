import fs from "node:fs/promises";
import path from "node:path";
import { ASSUMPTIONS } from "../delphi/assumptions.js";
import type { Ledger } from "../ledger/store.js";
import { buildNote } from "../note.js";
import { syncEvidencePdf } from "../pdf/evidence-pdf.js";
import type { Draft, NoteRecord, PickerMarket, SubmissionRecord } from "../types.js";

export const SAMPLE_NOW = Date.parse(ASSUMPTIONS.sampleNow);

const RAIN_QUOTE =
  "The fictional weather desk recorded rainfall above the seasonal average for 12 days running, and the 7-day outlook is still wet.";
const LEAGUE_QUOTE =
  "Example Team is 8 points off the pace, with 4 matches left. The key player is out and the remaining fixture list is harder than the leader's.";
const GAME_QUOTE =
  "Studio Fictional announced a trailer and a release date of 18 Mar 2027 on its official blog. The source is a public X post, so the quote is pasted here with a screenshot.";
const COFFEE_QUOTE =
  "A market report says stocks and outstanding contracts are still priced under $4. The source is paywalled, so the screenshot is not attached and Approve stays locked.";

function market(
  address: string,
  question: string,
  shortName: string,
  oddsYes: number,
  evidenceCutoffAt: string,
  status = "open",
): PickerMarket {
  return {
    address,
    question,
    shortName,
    status,
    oddsYes,
    forecasterYes: oddsYes,
    evidenceCutoffAt,
    closesAt: evidenceCutoffAt,
    rewardPotUsd: 120,
    dataSources: [],
  };
}

export function sampleMarkets(): PickerMarket[] {
  const later = "2026-12-20T17:00:00.000Z";
  const past = "2026-10-01T00:00:00.000Z";
  return [
    market("sample:fictional-city", "Will it rain across Fictional City on 30 Nov 2026?", "Fictional City", 0.37, "2026-11-30T17:00:00.000Z"),
    market("sample:imaginary-league", "Will Example Team win the Imaginary League 2026 season?", "Imaginary League", 0.62, "2026-12-05T17:00:00.000Z"),
    market("sample:imaginary-island", 'Will the game "Imaginary Island" release in Q1 2027?', "Imaginary Island", 0.44, "2026-12-08T17:00:00.000Z"),
    market("sample:world-coffee", "Will the world coffee price be above $4/lb in Dec 2026?", "World coffee", 0.71, "2026-12-02T17:00:00.000Z"),
    market("sample:out-1", "Will the sample coin finish the day above 5 percent?", "Sample coin A", 0.05, later),
    market("sample:out-2", "Will the sample coin finish the day above 9 percent?", "Sample coin B", 0.09, later),
    market("sample:out-3", "Will the sample coin finish the day above 12 percent?", "Sample coin C", 0.12, later),
    market("sample:out-4", "Will the sample coin finish the day above 15 percent?", "Sample coin D", 0.15, later),
    market("sample:out-5", "Will the sample index close above 88 percent?", "Sample index A", 0.88, later),
    market("sample:out-6", "Will the sample index close above 92 percent?", "Sample index B", 0.92, later),
    market("sample:out-7", "Will the sample index close above 96 percent?", "Sample index C", 0.96, later),
    market("sample:out-8", "Will the sample index close above 99 percent?", "Sample index D", 0.99, later),
    market("sample:late-1", "Will the expired sample question A still be open?", "Expired A", 0.41, past),
    market("sample:late-2", "Will the expired sample question B still be open?", "Expired B", 0.52, past),
    market("sample:late-3", "Will the expired sample question C still be open?", "Expired C", 0.48, past),
    market("sample:late-4", "Will the expired sample question D still be open?", "Expired D", 0.6, past),
    market("sample:late-5", "Will the expired sample question E still be open?", "Expired E", 0.33, past),
    market("sample:late-6", "Will the expired sample question F still be open?", "Expired F", 0.7, past),
  ];
}

function draft(input: {
  id: string;
  market: PickerMarket;
  side: "YES" | "NO";
  quote: string;
  rationale: string;
  links: { url: string; label: string }[];
  host: string;
  kind: Draft["kind"];
  requiresScreenshot: boolean;
  plainFetch: Draft["plainFetch"];
  preview?: Draft["preview"];
  collectedLabel: string;
}): Draft {
  const publishedAt = "2026-11-24T02:14:00.000Z";
  return {
    id: input.id,
    marketAddress: input.market.address,
    question: input.market.question,
    shortName: input.market.shortName,
    side: input.side,
    oddsYes: input.market.oddsYes,
    quote: input.quote,
    rationale: input.rationale,
    links: input.links,
    sourceHost: input.host,
    publishedAt,
    collectedLabel: input.collectedLabel,
    kind: input.kind,
    requiresScreenshot: input.requiresScreenshot,
    plainFetch: input.plainFetch,
    files: [],
    preview: input.preview ?? null,
    sample: true,
    status: "pending",
    idempotencyKey: null,
    pdfSkipped: null,
    createdAt: publishedAt,
    note: buildNote({
      publishedAt,
      side: input.side,
      quote: input.quote,
      links: input.links,
    }),
  };
}

export function sampleDrafts(markets: PickerMarket[]): Draft[] {
  const by = (address: string) => markets.find((item) => item.address === address)!;
  return [
    draft({
      id: "draft-rain",
      market: by("sample:fictional-city"),
      side: "YES",
      quote: RAIN_QUOTE,
      rationale:
        "The fictional weather desk published a dated rainfall total and a 7-day outlook. Filed on YES because the excerpt describes rain continuing. Sample text, not a real forecast.",
      links: [
        { url: "https://news-example.invalid/fictional-city-rain", label: "news-example.invalid" },
        { url: "https://weather-example.invalid/outlook", label: "weather-example.invalid" },
      ],
      host: "news-example.invalid",
      kind: "sample",
      requiresScreenshot: false,
      plainFetch: "ok",
      collectedLabel: "24 Nov 09:14 WIB",
    }),
    draft({
      id: "draft-league",
      market: by("sample:imaginary-league"),
      side: "NO",
      quote: LEAGUE_QUOTE,
      rationale:
        "The excerpt says Example Team is 8 points behind with a harder remaining list. Filed on NO. Sample text, not a real league table.",
      links: [
        { url: "https://league-example.invalid/table", label: "league-example.invalid" },
        { url: "https://score-example.invalid/example-team", label: "score-example.invalid" },
      ],
      host: "league-example.invalid",
      kind: "sample",
      requiresScreenshot: false,
      plainFetch: "ok",
      collectedLabel: "24 Nov 09:14 WIB",
    }),
    draft({
      id: "draft-game",
      market: by("sample:imaginary-island"),
      side: "YES",
      quote: GAME_QUOTE,
      rationale:
        "The excerpt names a release date of 18 Mar 2027. The source is X, so the quote and a screenshot are both attached. Sample text, not a real post.",
      links: [{ url: "https://x.com/studiofictional/status/sample", label: "x.com/studiofictional" }],
      host: "x.com/studiofictional",
      kind: "x",
      requiresScreenshot: true,
      plainFetch: "not_required",
      collectedLabel: "24 Nov 09:15 WIB",
      preview: {
        kicker: "Sample post",
        title: "Studio Fictional",
        body: "Imaginary Island releases 18 March 2027. The full trailer is on our blog.",
        footer: "screenshot.invalid",
      },
    }),
    draft({
      id: "draft-coffee",
      market: by("sample:world-coffee"),
      side: "NO",
      quote: COFFEE_QUOTE,
      rationale:
        "The excerpt says reported prices are still under $4. The source is paywalled, so Approve stays locked until a screenshot is attached. Sample text, not a real price.",
      links: [{ url: "https://market-example.invalid/coffee-dec-2026", label: "market-example.invalid" }],
      host: "market-example.invalid",
      kind: "paywall",
      requiresScreenshot: true,
      plainFetch: "ok",
      collectedLabel: "24 Nov 09:15 WIB",
    }),
  ];
}

function submission(
  id: string,
  market: PickerMarket,
  side: "YES" | "NO",
  note: string,
): SubmissionRecord {
  return {
    id,
    draftId: null,
    marketAddress: market.address,
    question: market.question,
    shortName: market.shortName,
    side,
    note,
    links: [],
    idempotencyKey: null,
    remoteId: null,
    status: "judged",
    verdict: "sample",
    reason: "Sample receipt. Not a real Delphi judgement.",
    reward: null,
    zeroPayReason: null,
    sample: true,
    countsTowardCap: true,
    countsAsJudged: true,
    createdAt: "2026-11-22T02:00:00.000Z",
    error: null,
  };
}

export function sampleSubmissions(markets: PickerMarket[]): SubmissionRecord[] {
  const city = markets[0];
  const league = markets[1];
  return [
    submission("sub-city-1", city, "YES", "Sample receipt. An earlier fictional note about weekend showers was judged in this demo."),
    submission("sub-city-2", city, "YES", "Sample receipt. A second fictional note about river levels was judged in this demo."),
    submission("sub-league-1", league, "NO", "Sample receipt. An earlier fictional note about the points gap was judged in this demo."),
    submission("sub-league-2", league, "NO", "Sample receipt. A second fictional note about the missing player was judged in this demo."),
  ];
}

export function sampleNotes(drafts: Draft[]): NoteRecord[] {
  const notes: NoteRecord[] = [];
  for (const item of drafts) {
    item.links.forEach((link, index) => {
      notes.push({
        id: `note-${item.id}-${index + 1}`,
        marketAddress: item.marketAddress,
        shortName: item.shortName,
        title: item.question,
        quote: index === 0 ? item.quote : `Extra sample source for ${item.shortName}. Not a separate submission.`,
        url: link.url,
        publishedAt: item.publishedAt,
        sample: true,
        createdAt: item.createdAt,
      });
    });
  }
  return notes;
}

export async function seedSample(ledger: Ledger, root: string, attachPdf: boolean): Promise<void> {
  const markets = sampleMarkets();
  const drafts = sampleDrafts(markets);
  const game = drafts.find((item) => item.id === "draft-game");
  if (game) {
    const relative = "files/draft-game-screenshot.png";
    const source = path.join(root, "public", "sample-post.png");
    await fs.mkdir(path.join(ledger.dir, "files"), { recursive: true });
    await fs.copyFile(source, path.join(ledger.dir, relative));
    game.files.push({
      id: "screenshot",
      role: "screenshot",
      name: "sample-post.png",
      type: "image/png",
      path: relative,
    });
  }
  for (const item of drafts) await syncEvidencePdf(item, ledger.dir, attachPdf);
  ledger.markets = markets;
  ledger.drafts = drafts;
  ledger.submissions = sampleSubmissions(markets);
  ledger.notes = sampleNotes(drafts);
  ledger.sample = true;
  ledger.seeded = true;
  ledger.lastScan = {
    at: new Date().toISOString(),
    openMarkets: markets.length,
    picked: drafts.length,
    sources: ledger.notes.length,
    sample: true,
  };
  await ledger.save();
}
