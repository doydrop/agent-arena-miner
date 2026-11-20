import { describe, expect, it } from "vitest";
import {
  bandProbability,
  enforceOneSide,
  marketSlots,
  pickMarkets,
  qualificationOf,
  type MarketHistory,
} from "../src/picker/pick.js";
import type { PickerMarket, Side } from "../src/types.js";

const NOW = Date.parse("2026-11-24T02:15:00.000Z");

function market(overrides: Partial<PickerMarket> = {}): PickerMarket {
  return {
    address: "0xmarket",
    question: "Will the sample question resolve yes?",
    shortName: "Sample",
    status: "open",
    oddsYes: 0.5,
    forecasterYes: null,
    evidenceCutoffAt: "2026-12-01T00:00:00.000Z",
    closesAt: "2026-12-02T00:00:00.000Z",
    rewardPotUsd: 100,
    dataSources: [],
    ...overrides,
  };
}

describe("market slots", () => {
  it("shows used and remaining slots out of 3", () => {
    expect(marketSlots(0)).toEqual({ used: 0, remaining: 3, slots: [false, false, false] });
    expect(marketSlots(2)).toEqual({ used: 2, remaining: 1, slots: [true, true, false] });
    expect(marketSlots(3)).toEqual({ used: 3, remaining: 0, slots: [true, true, true] });
    expect(marketSlots(-4).used).toBe(0);
    expect(marketSlots(9).remaining).toBe(0);
  });
});

describe("pickMarkets", () => {
  it("keeps the 20 to 80 percent band and drops the edges outside it", () => {
    const picked = pickMarkets(
      [market({ address: "low", oddsYes: 0.19 }), market({ address: "edge", oddsYes: 0.2 }), market({ address: "high", oddsYes: 0.8 }), market({ address: "out", oddsYes: 0.81 })],
      [],
      NOW,
    );
    expect(picked.map((item) => item.market.address)).toEqual(["edge", "high"]);
  });

  it("treats a percent-shaped odds value as a percent", () => {
    expect(bandProbability(market({ oddsYes: 37 }))).toBeCloseTo(0.37);
    const picked = pickMarkets([market({ oddsYes: 37 })], [], NOW);
    expect(picked).toHaveLength(1);
  });

  it("uses the forecaster only when market odds are missing", () => {
    const missing = pickMarkets([market({ oddsYes: Number.NaN, forecasterYes: 0.44 })], [], NOW);
    expect(missing).toHaveLength(1);
    const oddsWin = pickMarkets([market({ oddsYes: 0.91, forecasterYes: 0.5 })], [], NOW);
    expect(oddsWin).toHaveLength(0);
  });

  it("drops markets that are closed or past the evidence cutoff", () => {
    const picked = pickMarkets(
      [
        market({ address: "closed", status: "settled" }),
        market({ address: "past", evidenceCutoffAt: "2026-11-24T02:15:00.000Z" }),
        market({ address: "soon", evidenceCutoffAt: "2026-11-24T02:15:00.001Z" }),
      ],
      [],
      NOW,
    );
    expect(picked.map((item) => item.market.address)).toEqual(["soon"]);
  });

  it("stops at 3 submissions and will not pick the other side", () => {
    const history: MarketHistory[] = [
      { address: "full", sent: 3, judged: 3, side: "YES", conflict: false },
      { address: "split", sent: 2, judged: 2, side: null, conflict: true },
      { address: "yes-side", sent: 1, judged: 1, side: "YES", conflict: false },
    ];
    const picked = pickMarkets(
      [market({ address: "full" }), market({ address: "split" }), market({ address: "yes-side" })],
      history,
      NOW,
    );
    expect(picked.map((item) => item.market.address)).toEqual(["yes-side"]);
    expect(picked[0].side).toBe("YES");
    expect(picked[0].remaining).toBe(2);
  });

  it("ranks an uncovered market first while qualification still needs 3 markets", () => {
    const history: MarketHistory[] = [
      { address: "known", sent: 2, judged: 2, side: "YES", conflict: false },
      { address: "other", sent: 2, judged: 2, side: "NO", conflict: false },
    ];
    const picked = pickMarkets(
      [
        market({ address: "known", question: "Known market" }),
        market({ address: "fresh", question: "Fresh market" }),
      ],
      history,
      NOW,
    );
    expect(picked[0].market.address).toBe("fresh");
  });

  it("prefers odds near 50 percent and a closer cutoff", () => {
    const center = pickMarkets(
      [market({ address: "edge", oddsYes: 0.22 }), market({ address: "center", oddsYes: 0.5 })],
      [],
      NOW,
    );
    expect(center[0].market.address).toBe("center");
    const urgent = pickMarkets(
      [
        market({ address: "later", evidenceCutoffAt: "2026-12-20T00:00:00.000Z" }),
        market({ address: "sooner", evidenceCutoffAt: "2026-11-25T00:00:00.000Z" }),
      ],
      [],
      NOW,
    );
    expect(urgent[0].market.address).toBe("sooner");
  });
});

describe("one side and coverage", () => {
  it("drops the opposite side and, with no history, keeps the stronger side only", () => {
    const history: MarketHistory[] = [{ address: "locked", sent: 1, judged: 1, side: "YES", conflict: false }];
    const kept = enforceOneSide(
      [
        { marketAddress: "locked", side: "NO" as Side, score: 5 },
        { marketAddress: "locked", side: "YES" as Side, score: 1 },
        { marketAddress: "open", side: "NO" as Side, score: 1 },
        { marketAddress: "open", side: "YES" as Side, score: 4 },
      ],
      history,
    );
    expect(kept.filter((item) => item.marketAddress === "locked").map((item) => item.side)).toEqual(["YES"]);
    expect(kept.filter((item) => item.marketAddress === "open").map((item) => item.side)).toEqual(["YES"]);
  });

  it("counts judged submissions toward 10/3 and sent submissions toward the cap", () => {
    const coverage = qualificationOf(
      [
        { marketAddress: "a", countsTowardCap: true, countsAsJudged: true },
        { marketAddress: "a", countsTowardCap: true, countsAsJudged: true },
        { marketAddress: "b", countsTowardCap: true, countsAsJudged: false },
        { marketAddress: "c", countsTowardCap: false, countsAsJudged: false },
      ],
      [
        { address: "a", name: "Alpha" },
        { address: "b", name: "Beta" },
        { address: "c", name: "Gamma" },
      ],
    );
    expect(coverage.submissions).toBe(2);
    expect(coverage.markets).toBe(1);
    expect(coverage.submissionsGoal).toBe(10);
    expect(coverage.marketsGoal).toBe(3);
    expect(coverage.perMarket.find((row) => row.name === "Alpha")).toMatchObject({ used: 2, remaining: 1 });
    expect(coverage.perMarket.find((row) => row.name === "Beta")).toMatchObject({ used: 1, remaining: 2 });
    expect(coverage.perMarket.find((row) => row.name === "Gamma")?.used).toBe(0);
  });
});
