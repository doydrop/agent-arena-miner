import { ASSUMPTIONS } from "../delphi/assumptions.js";
import type { Draft, GateCheck, GateHistoryItem, GateReport } from "../types.js";

const ALLOWED = new Set<string>(ASSUMPTIONS.allowedFileExtensions);

export function hostKind(url: string): "x" | "reddit" | "web" {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) {
      return "x";
    }
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
    return "web";
  } catch {
    return "web";
  }
}

export function needsScreenshot(draft: Pick<Draft, "requiresScreenshot" | "kind" | "links">): boolean {
  if (draft.requiresScreenshot) return true;
  if (draft.kind === "x" || draft.kind === "reddit" || draft.kind === "paywall") return true;
  return draft.links.some((link) => hostKind(link.url) !== "web");
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameMarket(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function check(id: string, label: string, ok: boolean, detail: string): GateCheck {
  return { id, label, ok, detail };
}

export function evaluateGates(draft: Draft, history: GateHistoryItem[]): GateReport {
  const checks: GateCheck[] = [];
  const quote = draft.quote.trim();
  checks.push(
    check(
      "quote",
      "Quote included",
      quote.length >= 40,
      quote.length >= 40 ? "The excerpt is long enough to stand on its own." : "Paste a quote of at least 40 characters.",
    ),
  );

  const dated = Date.parse(draft.publishedAt ?? "");
  checks.push(
    check(
      "date",
      "Dated source",
      Number.isFinite(dated),
      Number.isFinite(dated) ? `Dated ${draft.publishedAt?.slice(0, 10)}.` : "Add the date the source was published.",
    ),
  );

  const primary = draft.links[0]?.url ?? "";
  checks.push(
    check(
      "url",
      "Source URL",
      isHttp(primary),
      isHttp(primary) ? primary : "Add an http or https link to the source.",
    ),
  );

  const shot = needsScreenshot(draft);
  const hasShot = draft.files.some((file) => file.role === "screenshot");
  if (shot && hasShot) {
    checks.push(
      check(
        "fetch",
        "Plain fetch",
        true,
        "X, Reddit, and paywalled pages usually fail a plain fetch. The screenshot and the pasted quote stand in for it.",
      ),
    );
  } else if (draft.plainFetch === "ok") {
    checks.push(check("fetch", "Plain fetch", true, "The URL opened with one plain fetch."));
  } else {
    checks.push(
      check(
        "fetch",
        "Plain fetch",
        false,
        "This URL did not open with a plain fetch. The judge will not open a browser either.",
      ),
    );
  }

  checks.push(
    check(
      "screenshot",
      "Screenshot",
      !shot || hasShot,
      !shot
        ? "This source does not need a screenshot."
        : hasShot
          ? "A screenshot is attached."
          : "Attach a screenshot that shows the URL and the date.",
    ),
  );

  const quoteKey = normalizeText(quote);
  const duplicate = history.some((item) => {
    if (!item.countsTowardCap) return false;
    const pastQuote = normalizeText(item.quote || item.note);
    const sameQuote = quoteKey.length >= 40 && (pastQuote === quoteKey || pastQuote.includes(quoteKey));
    const sameLink = draft.links.some((link) =>
      item.links.some((past) => past.replace(/\/+$/, "").toLowerCase() === link.url.replace(/\/+$/, "").toLowerCase()),
    );
    return sameQuote || sameLink;
  });
  checks.push(
    check(
      "dedupe",
      "New information",
      !duplicate,
      duplicate
        ? "This quote or link is already in a submission you sent."
        : "This is not a repeat of your past submissions.",
    ),
  );

  const past = history.filter((item) => item.countsTowardCap && sameMarket(item.marketAddress, draft.marketAddress));
  const sides = new Set(past.map((item) => item.side));
  let sideOk = draft.side === "YES" || draft.side === "NO";
  let sideDetail = sideOk ? `Filed on ${draft.side} only.` : "Pick YES or NO. One draft takes one side.";
  if (sideOk && sides.size > 1) {
    sideOk = false;
    sideDetail = "This market already has submissions on both sides. They cancel out, so this draft stays here.";
  } else if (sideOk && sides.size === 1 && !sides.has(draft.side!)) {
    sideOk = false;
    sideDetail = `You already submitted ${[...sides][0]} on this market. Stay on that side.`;
  }
  checks.push(check("side", "One side", sideOk, sideDetail));

  const underCap = past.length < ASSUMPTIONS.maxSubmissionsPerMarket;
  checks.push(
    check(
      "cap",
      "Market cap",
      underCap,
      underCap
        ? `${past.length} of ${ASSUMPTIONS.maxSubmissionsPerMarket} submissions used on this market.`
        : "This market already has 3 submissions. The cap is full.",
    ),
  );

  const tooMany = draft.files.length > ASSUMPTIONS.maxFilesPerSubmission;
  const badExt = draft.files.find((file) => !ALLOWED.has((file.name.split(".").pop() ?? "").toLowerCase()));
  checks.push(
    check(
      "files",
      "Files",
      !tooMany && !badExt,
      tooMany
        ? "A submission can carry at most 3 files. Remove one."
        : badExt
          ? `${badExt.name} is not a pdf, png, jpg, csv, or txt file.`
          : `${draft.files.length} of ${ASSUMPTIONS.maxFilesPerSubmission} files attached.`,
    ),
  );

  const quoteInNote = quoteKey.length >= 40 && normalizeText(draft.note).includes(quoteKey.slice(0, 40));
  checks.push(
    check(
      "note",
      "Note carries the quote",
      quote.length < 40 || quoteInNote,
      quoteInNote || quote.length < 40
        ? "The note that would be sent includes the quote."
        : "The note must include the quote. Rebuild it from the fields.",
    ),
  );

  return { ok: checks.every((item) => item.ok), checks };
}

export function historyFromSubmissions(
  submissions: {
    marketAddress: string;
    side: GateHistoryItem["side"];
    quote?: string;
    note: string;
    links: string[];
    countsTowardCap: boolean;
  }[],
): GateHistoryItem[] {
  return submissions.map((row) => ({
    marketAddress: row.marketAddress,
    side: row.side,
    quote: row.quote ?? "",
    note: row.note,
    links: row.links,
    countsTowardCap: row.countsTowardCap,
  }));
}
