import { buildNote } from "../note.js";
import type { Draft, NoteRecord, PickerMarket, Side } from "../types.js";
import type { PickedMarket } from "../picker/pick.js";

export interface ResearchOptions {
  fetchImpl?: typeof fetch;
  llm?: { apiKey: string; baseUrl: string; model: string } | null;
  now?: Date;
}

export interface ResearchResult {
  drafts: Draft[];
  notes: NoteRecord[];
  skippedSocial: number;
  empty: number;
}

const STOP = new Set(
  "will the a an of to in on for and or be is are was were by from at as it this that with above below over under win lose before after during into than then per".split(
    " ",
  ),
);

export function keywords(question: string): string[] {
  return question
    .replace(/[?]/g, "")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9'-]/gi, ""))
    .filter((word) => word.length > 2 && !STOP.has(word.toLowerCase()))
    .slice(0, 8);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksPaywalled(text: string): boolean {
  const value = text.toLowerCase();
  return [
    "subscribe to continue",
    "subscribe to read",
    "sign in to continue",
    "log in to read",
    "this article is for subscribers",
    "you've reached your limit",
    "register to continue",
  ].some((phrase) => value.includes(phrase));
}

export function extractQuote(text: string, keys: string[]): string | null {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 420);
  const keyed = sentences.find((sentence) => keys.some((key) => sentence.toLowerCase().includes(key.toLowerCase())));
  return keyed ?? sentences[0] ?? null;
}

export function findDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return `${iso[1]}T00:00:00.000Z`;
  const month = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/,
  );
  if (month) {
    const parsed = Date.parse(month[0]);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function social(url: string): "x" | "reddit" | null {
  const host = hostOf(url);
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
  return null;
}

interface Hit {
  url: string;
  title: string;
  quote: string;
  publishedAt: string;
  kind: Draft["kind"];
  requiresScreenshot: boolean;
  plainFetch: Draft["plainFetch"];
  rationale: string;
  side: Side | null;
}

export async function researchMarkets(picks: PickedMarket[], options: ResearchOptions = {}): Promise<ResearchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const drafts: Draft[] = [];
  const notes: NoteRecord[] = [];
  let skippedSocial = 0;
  let empty = 0;

  for (const pick of picks.slice(0, 4)) {
    const keys = keywords(pick.market.question);
    const hits = await collectHits(pick.market, keys, fetchImpl, options.llm ?? null);
    skippedSocial += hits.skippedSocial;
    if (hits.hits.length === 0) {
      empty += 1;
      continue;
    }
    const primary = hits.hits[0];
    const links = hits.hits.slice(0, 2).map((hit) => ({ url: hit.url, label: hostOf(hit.url) }));
    const side = pick.side ?? primary.side;
    const draft: Draft = {
      id: `draft-${slug(pick.market.address)}`,
      marketAddress: pick.market.address,
      question: pick.market.question,
      shortName: pick.market.shortName,
      side,
      oddsYes: pick.probability,
      quote: primary.quote,
      rationale: primary.rationale,
      links,
      sourceHost: hostOf(primary.url),
      publishedAt: primary.publishedAt,
      collectedLabel: localLabel(now),
      kind: primary.kind,
      requiresScreenshot: primary.requiresScreenshot,
      plainFetch: primary.plainFetch,
      files: [],
      preview: null,
      sample: false,
      status: "pending",
      idempotencyKey: null,
      pdfSkipped: null,
      createdAt: now.toISOString(),
      note: "",
    };
    draft.note = buildNote(draft);
    drafts.push(draft);
    for (const [index, hit] of hits.hits.slice(0, 2).entries()) {
      notes.push({
        id: `note-${draft.id}-${index + 1}`,
        marketAddress: draft.marketAddress,
        shortName: draft.shortName,
        title: hit.title || draft.question,
        quote: hit.quote,
        url: hit.url,
        publishedAt: hit.publishedAt,
        sample: false,
        createdAt: now.toISOString(),
      });
    }
  }

  return { drafts, notes, skippedSocial, empty };
}

async function collectHits(
  market: PickerMarket,
  keys: string[],
  fetchImpl: typeof fetch,
  llm: ResearchOptions["llm"],
): Promise<{ hits: Hit[]; skippedSocial: number }> {
  const hits: Hit[] = [];
  let skippedSocial = 0;
  const query = keys.slice(0, 6).join(" ");
  if (!query) return { hits, skippedSocial };

  const candidates: { url: string; title: string; date: string | null; kind: Draft["kind"] }[] = [];
  candidates.push(...(await wikipedia(query, fetchImpl)));
  candidates.push(...(await gdelt(query, fetchImpl)));
  candidates.push(...(await googleNews(query, fetchImpl)));
  for (const source of market.dataSources) {
    if (social(source)) {
      skippedSocial += 1;
      continue;
    }
    candidates.push({ url: source, title: hostOf(source), date: null, kind: "official" });
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (hits.length >= 2) break;
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    if (social(candidate.url)) {
      skippedSocial += 1;
      continue;
    }
    const hit = await readCandidate(candidate, keys, fetchImpl, llm, market.question);
    if (hit) hits.push(hit);
  }
  return { hits, skippedSocial };
}

async function readCandidate(
  candidate: { url: string; title: string; date: string | null; kind: Draft["kind"] },
  keys: string[],
  fetchImpl: typeof fetch,
  llm: ResearchOptions["llm"],
  question: string,
): Promise<Hit | null> {
  let response: Response;
  try {
    response = await fetchImpl(candidate.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "text/html,application/json,text/plain,*/*" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const raw = (await response.text()).slice(0, 200_000);
  const text = htmlToText(raw);
  const paywalled = looksPaywalled(text);
  let quote = extractQuote(text, keys);
  let sideNote = "";
  let suggested: Side | null = null;
  if (llm && quote) {
    const helped = await summarize(llm, fetchImpl, question, text);
    if (helped?.quote && collapse(text).includes(collapse(helped.quote))) {
      quote = helped.quote;
      suggested = helped.side;
      sideNote = helped.side ? ` The model read the excerpt as ${helped.side}.` : "";
    }
  }
  if (!quote) return null;
  if (paywalled && looksPaywalled(quote)) return null;
  const publishedAt = candidate.date || findDate(raw) || findDate(text);
  if (!publishedAt) return null;
  return {
    url: candidate.url,
    title: candidate.title,
    quote,
    publishedAt,
    kind: paywalled ? "paywall" : candidate.kind,
    requiresScreenshot: paywalled,
    plainFetch: "ok",
    side: suggested,
    rationale: paywalled
      ? `The page opened, and it asks a reader to subscribe or sign in. The excerpt was copied from the text that was visible. Attach a screenshot that shows the URL and the date before you approve.${sideNote}`
      : `The excerpt is copied from the page. The date is taken from the page itself. Basic mode does not decide the truth of the market.${sideNote} Read the quote and set YES or NO before you approve.`,
  };
}

function collapse(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function wikipedia(query: string, fetchImpl: typeof fetch): Promise<{ url: string; title: string; date: string | null; kind: Draft["kind"] }[]> {
  try {
    const search = new URL("https://en.wikipedia.org/w/api.php");
    search.searchParams.set("action", "query");
    search.searchParams.set("list", "search");
    search.searchParams.set("srsearch", query);
    search.searchParams.set("srlimit", "2");
    search.searchParams.set("utf8", "1");
    search.searchParams.set("format", "json");
    const response = await fetchImpl(search, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { query?: { search?: { title: string }[] } };
    const titles = body.query?.search?.map((row) => row.title) ?? [];
    const found = [];
    for (const title of titles) {
      const page = new URL("https://en.wikipedia.org/w/api.php");
      page.searchParams.set("action", "query");
      page.searchParams.set("prop", "revisions|info");
      page.searchParams.set("rvprop", "timestamp");
      page.searchParams.set("inprop", "url");
      page.searchParams.set("titles", title);
      page.searchParams.set("format", "json");
      const info = await fetchImpl(page, { signal: AbortSignal.timeout(8000) });
      if (!info.ok) continue;
      const json = (await info.json()) as {
        query?: { pages?: Record<string, { fullurl?: string; revisions?: { timestamp: string }[] }> };
      };
      const entry = Object.values(json.query?.pages ?? {})[0];
      if (!entry?.fullurl) continue;
      found.push({
        url: entry.fullurl,
        title,
        date: entry.revisions?.[0]?.timestamp ?? null,
        kind: "wikipedia" as const,
      });
    }
    return found;
  } catch {
    return [];
  }
}

async function gdelt(query: string, fetchImpl: typeof fetch): Promise<{ url: string; title: string; date: string | null; kind: Draft["kind"] }[]> {
  try {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("maxrecords", "5");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { articles?: { url?: string; title?: string; seendate?: string }[] };
    return (body.articles ?? [])
      .filter((article) => article.url)
      .slice(0, 3)
      .map((article) => ({
        url: article.url!,
        title: article.title || hostOf(article.url!),
        date: gdeltDate(article.seendate),
        kind: "gdelt" as const,
      }));
  } catch {
    return [];
  }
}

export function gdeltDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
}

async function googleNews(query: string, fetchImpl: typeof fetch): Promise<{ url: string; title: string; date: string | null; kind: Draft["kind"] }[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4);
    const found = [];
    for (const item of items) {
      const block = item[1];
      const title = decode(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const source = block.match(/<source[^>]*url="([^"]+)"/i)?.[1];
      const link = decode(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
      const pub = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
      const article = source || link;
      if (!article || article.includes("news.google.com")) continue;
      const parsed = Date.parse(pub);
      found.push({
        url: article,
        title: title || hostOf(article),
        date: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
        kind: "rss" as const,
      });
    }
    return found;
  } catch {
    return [];
  }
}

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

async function summarize(
  llm: { apiKey: string; baseUrl: string; model: string },
  fetchImpl: typeof fetch,
  question: string,
  pageText: string,
): Promise<{ quote: string; side: Side | null } | null> {
  try {
    const response = await fetchImpl(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract one verbatim excerpt from the source. Do not invent words. Reply with JSON only: {\"quote\":\"...\",\"side\":\"YES\"|\"NO\"|null}. side is null when the excerpt does not clearly support one side. The quote must appear in the source.",
          },
          {
            role: "user",
            content: `Market: ${question}\n\nSource text:\n${pageText.slice(0, 6000)}`,
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? "";
    const json = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? "null") as { quote?: string; side?: string } | null;
    if (!json?.quote) return null;
    const side = json.side === "YES" || json.side === "NO" ? json.side : null;
    return { quote: json.quote, side };
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "market";
}

function localLabel(now: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${now.getDate()} ${months[now.getMonth()]} ${hh}:${mm}`;
}
