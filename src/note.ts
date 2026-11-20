import type { DraftLink, Side } from "./types.js";

/**
 * ASSUMPTION: submitEvidence has no side field (SDK 2.4.0).
 * The side is written into the note. See docs/ADAPTING.md if the API adds one.
 */
export function buildNote(input: {
  publishedAt: string | null;
  side: Side | null;
  quote: string;
  links: Pick<DraftLink, "url">[];
}): string {
  const date = input.publishedAt ? input.publishedAt.slice(0, 10) : "an unknown date";
  const side = input.side ?? "UNSET";
  const urls = input.links.map((link) => link.url).filter(Boolean);
  return [`As of ${date}. Side: ${side}.`, input.quote.trim(), "Source:", ...urls].join("\n");
}
