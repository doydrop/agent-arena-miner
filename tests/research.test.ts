import { describe, expect, it } from "vitest";
import { pickMarkets } from "../src/picker/pick.js";
import {
  extractQuote,
  gdeltDate,
  htmlToText,
  keywords,
  looksPaywalled,
  researchMarkets,
} from "../src/researcher/research.js";
import { parseMarketFeed } from "../src/watcher/markets.js";
import { sampleMarkets, SAMPLE_NOW } from "../src/watcher/fixtures.js";
import type { PickerMarket } from "../src/types.js";

describe("research helpers", () => {
  it("extracts a dated sentence and ignores a paywall boilerplate quote", () => {
    const text = "Intro. On January 2, 2026 the agency published the October figure at 3.1 percent for the sample city. Tail.";
    expect(extractQuote(text, ["figure"])).toMatch(/3\.1 percent/);
    expect(looksPaywalled("Please subscribe to continue reading this story.")).toBe(true);
    expect(gdeltDate("20261116T120000Z")).toBe("2026-11-16T00:00:00.000Z");
    expect(keywords("Will the sample city publish a figure?").length).toBeGreaterThan(0);
    expect(htmlToText("<p>Hello&amp;there</p>")).toBe("Hello&there");
  });

  it("copies a quote from a public page and invents nothing when the page has no date", async () => {
    const page = "https://agency.example/october";
    const html = "<p>On January 2, 2026 the agency published the October figure at 3.1 percent for the sample city.</p>";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href === page) return new Response(html, { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const market: PickerMarket = {
      address: "0xcity",
      question: "Will the sample city publish a figure?",
      shortName: "City",
      status: "open",
      oddsYes: 0.4,
      forecasterYes: null,
      evidenceCutoffAt: "2026-12-01T00:00:00.000Z",
      closesAt: null,
      rewardPotUsd: 10,
      dataSources: [page],
    };
    const found = await researchMarkets(pickMarkets([market], [], SAMPLE_NOW), { fetchImpl, llm: null });
    expect(found.drafts).toHaveLength(1);
    expect(found.drafts[0].quote).toMatch(/3\.1 percent/);
    expect(found.drafts[0].sample).toBe(false);
    expect(found.drafts[0].note).toContain(found.drafts[0].quote);

    const undated = await researchMarkets(
      pickMarkets([{ ...market, dataSources: ["https://agency.example/undated"] }], [], SAMPLE_NOW),
      {
        fetchImpl: (async (input: RequestInfo | URL) => {
          const href = String(input);
          if (href.endsWith("/undated")) return new Response("<p>The agency published the October figure at 3.1 percent for the sample city yesterday.</p>", { status: 200 });
          return new Response("no", { status: 404 });
        }) as typeof fetch,
        llm: null,
      },
    );
    expect(undated.drafts).toHaveLength(0);
    expect(undated.empty).toBe(1);
  });
});

describe("market feed", () => {
  it("reads the starter shape and a few likely aliases", () => {
    const parsed = parseMarketFeed({
      markets: [
        { address: "0x1", question: "Will it happen?", status: "open", odds: { yes: 37, no: 63 }, evidenceCutoffAt: "2026-12-01T00:00:00.000Z", dataSources: ["https://example.invalid/a"] },
        { marketAddress: "0x2", title: "Alias question", yesPrice: 0.4, evidence_cutoff: "2026-12-02T00:00:00.000Z" },
      ],
    });
    expect(parsed[0].oddsYes).toBe(37);
    expect(parsed[0].dataSources).toEqual(["https://example.invalid/a"]);
    expect(parsed[1].address).toBe("0x2");
    expect(parsed[1].oddsYes).toBe(0.4);
    expect(parsed[1].evidenceCutoffAt).toBe("2026-12-02T00:00:00.000Z");
  });

  it("picks four sample markets and skips the other fourteen", () => {
    const markets = sampleMarkets();
    expect(markets).toHaveLength(18);
    const picked = pickMarkets(markets, [], SAMPLE_NOW);
    expect(picked.map((item) => item.market.shortName)).toEqual([
      "Imaginary Island",
      "Fictional City",
      "Imaginary League",
      "World coffee",
    ]);
  });
});
