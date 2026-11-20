import fs from "node:fs/promises";
import path from "node:path";
import { ASSUMPTIONS } from "./assumptions.js";
import type { AppConfig } from "../config.js";
import { redactSecrets } from "../redact.js";

/**
 * The only module that talks to Delphi.
 * Other files depend on DelphiGateway. They do not import the SDK.
 */

export interface TermsSnapshot {
  ok: boolean;
  version: string | null;
  url: string | null;
  acceptedAt: string | null;
  detail: string;
}

export interface RemoteReceipt {
  remoteId: string | null;
  status: string;
  verdict: string | null;
  reason: string | null;
  reward: string | null;
  zeroPayReason: string | null;
  requestId: string | null;
}

export interface SubmitPayload {
  marketAddress: string;
  note: string;
  links: string[];
  files: { path: string; name: string; type: string }[];
  idempotencyKey: string;
}

export interface DelphiGateway {
  mode: "dry-run" | "live";
  terms(): Promise<TermsSnapshot>;
  preflight(input: { marketAddress: string; note: string; links: string[] }): Promise<{ ok: boolean; message: string }>;
  submit(input: SubmitPayload): Promise<RemoteReceipt>;
  wait(remoteId: string): Promise<RemoteReceipt | null>;
  feedback(message: string): Promise<{ sent: boolean; detail: string }>;
}

interface SdkModule {
  EvidenceClient: new (config: {
    baseUrl: string;
    apiKey: string;
    agentId?: string;
    agentHarness?: string;
    agentModel?: string;
  }) => SdkEvidence;
  EvidenceApiError: new (...args: never[]) => Error & { code?: string; status?: number };
  TermsNotAcceptedError: new (...args: never[]) => Error & { terms?: { version: string; url: string } };
}

interface SdkEvidence {
  getTerms(): Promise<{ data: { version: string; url: string; acceptedAt: string | null } }>;
  acceptTerms(version: string): Promise<{ data: { version: string; acceptedAt: string } }>;
  getEntryState(market: string): Promise<{ data: { canSubmit: boolean; reason?: string; remainingOnMarket: number } }>;
  listSubmissions(query?: { market?: string }): Promise<{ data: { items: { note?: string | null; links?: string[] }[] } }>;
  submitEvidence(input: {
    note: string;
    links?: string[];
    files?: Blob[];
    marketAddress?: string;
    idempotencyKey?: string;
  }): Promise<{ data: SdkSubmission; meta?: { requestId?: string } }>;
  waitForSubmission(id: string, opts?: { timeoutMs?: number }): Promise<{ data: SdkSubmission }>;
}

interface SdkSubmission {
  id: string;
  status: string;
  markets?: {
    verdict?: string | null;
    reason?: string | null;
    bounty?: { amount?: string; state?: string } | null;
    zeroPayReason?: string;
  }[];
}

function safe(config: AppConfig, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, config.secrets);
}

function friendly(code: string | undefined, fallback: string): string {
  switch (code) {
    case "unauthorized":
      return "Delphi refused the API key (401). Check DELPHI_API_ACCESS_KEY in .env.";
    case "terms_not_accepted":
      return "The evidence terms are not accepted yet. Open the terms URL, then set ACCEPT_TERMS to that version.";
    case "cap_reached":
      return "Delphi says this market has already used its submission cap.";
    case "rate_limited":
      return "Delphi asked us to slow down. Wait a few minutes and approve again. The same idempotency key will be reused.";
    case "market_not_found":
      return "Delphi does not know that market address.";
    case "idempotency_conflict":
      return "That idempotency key was already used for a different submission. Leave this draft as it is and check the ledger.";
    default:
      return fallback;
  }
}

export function createDryGateway(): DelphiGateway {
  const idle: TermsSnapshot = {
    ok: true,
    version: null,
    url: null,
    acceptedAt: null,
    detail: "Dry-run does not call Delphi.",
  };
  return {
    mode: "dry-run",
    async terms() {
      return idle;
    },
    async preflight() {
      return { ok: true, message: "Dry-run." };
    },
    async submit() {
      throw new Error("Dry-run refused to send a submission.");
    },
    async wait() {
      return null;
    },
    async feedback() {
      return {
        sent: false,
        detail: `The SDK ${ASSUMPTIONS.sdkVersion} has no feedback method. The note was saved on this computer.`,
      };
    },
  };
}

class SdkGateway implements DelphiGateway {
  mode = "live" as const;

  constructor(
    private readonly sdk: SdkEvidence,
    private readonly config: AppConfig,
  ) {}

  async terms(): Promise<TermsSnapshot> {
    try {
      const { data } = await this.sdk.getTerms();
      if (data.acceptedAt) {
        return {
          ok: true,
          version: data.version,
          url: data.url,
          acceptedAt: data.acceptedAt,
          detail: `Terms ${data.version} are already accepted.`,
        };
      }
      if (this.config.acceptTerms && this.config.acceptTerms === data.version) {
        const accepted = await this.sdk.acceptTerms(data.version);
        return {
          ok: true,
          version: accepted.data.version,
          url: data.url,
          acceptedAt: accepted.data.acceptedAt,
          detail: `Accepted terms ${accepted.data.version}.`,
        };
      }
      return {
        ok: false,
        version: data.version,
        url: data.url,
        acceptedAt: null,
        detail: `Read the terms at ${data.url} and set ACCEPT_TERMS=${data.version} in .env, then start again.`,
      };
    } catch (error) {
      return {
        ok: false,
        version: null,
        url: null,
        acceptedAt: null,
        detail: `Could not read the terms. ${safe(this.config, error)}`,
      };
    }
  }

  async preflight(input: { marketAddress: string; note: string; links: string[] }): Promise<{ ok: boolean; message: string }> {
    const terms = await this.terms();
    if (!terms.ok) return { ok: false, message: terms.detail };
    try {
      const entry = await this.sdk.getEntryState(input.marketAddress);
      if (!entry.data.canSubmit) {
        return { ok: false, message: entry.data.reason || "Delphi says this market is not open for a submission." };
      }
      if (entry.data.remainingOnMarket <= 0) {
        return { ok: false, message: "Delphi says there are no submissions left on this market." };
      }
      const listed = await this.sdk.listSubmissions({ market: input.marketAddress });
      const noteKey = input.note.trim().toLowerCase();
      const repeat = (listed.data.items ?? []).some((item) => {
        const sameNote = (item.note ?? "").trim().toLowerCase() === noteKey;
        const sameLink = (item.links ?? []).some((link) => input.links.includes(link));
        return sameNote || sameLink;
      });
      if (repeat) return { ok: false, message: "Delphi already has this note or link on the market." };
      return { ok: true, message: "Ready to send." };
    } catch (error) {
      const code = (error as { code?: string }).code;
      return { ok: false, message: friendly(code, safe(this.config, error)) };
    }
  }

  async submit(input: SubmitPayload): Promise<RemoteReceipt> {
    const files: Blob[] = [];
    for (const file of input.files.slice(0, ASSUMPTIONS.maxFilesPerSubmission)) {
      const bytes = await fs.readFile(file.path);
      files.push(new File([new Uint8Array(bytes)], file.name, { type: file.type || "application/octet-stream" }));
    }
    try {
      const { data, meta } = await this.sdk.submitEvidence({
        note: input.note,
        links: input.links,
        files,
        marketAddress: input.marketAddress,
        idempotencyKey: input.idempotencyKey,
      });
      return toReceipt(data, meta?.requestId ?? null);
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new Error(friendly(code, safe(this.config, error)));
    }
  }

  async wait(remoteId: string): Promise<RemoteReceipt | null> {
    try {
      const { data } = await this.sdk.waitForSubmission(remoteId, { timeoutMs: 90_000 });
      return toReceipt(data, null);
    } catch (error) {
      return {
        remoteId,
        status: "judging",
        verdict: null,
        reason: safe(this.config, error),
        reward: null,
        zeroPayReason: null,
        requestId: null,
      };
    }
  }

  async feedback(message: string): Promise<{ sent: boolean; detail: string }> {
    if (!this.config.feedbackUrl) {
      return {
        sent: false,
        detail: `SDK ${ASSUMPTIONS.sdkVersion} has no feedback method. Set DELPHI_FEEDBACK_URL if Delphi publishes one. The note is saved locally.`,
      };
    }
    const response = await fetch(this.config.feedbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        "x-agent-id": this.config.agentId,
      },
      body: JSON.stringify({
        agentId: this.config.agentId,
        harness: this.config.agentHarness,
        message,
      }),
    });
    if (!response.ok) {
      return { sent: false, detail: `The feedback URL returned ${response.status}. The note is still saved locally.` };
    }
    return { sent: true, detail: "Feedback was posted. The API key was not included in the body." };
  }
}

function toReceipt(data: SdkSubmission, requestId: string | null): RemoteReceipt {
  const market = data.markets?.[0];
  const bounty = market?.bounty;
  return {
    remoteId: data.id,
    status: data.status,
    verdict: market?.verdict ?? null,
    reason: market?.reason ?? null,
    reward: bounty?.amount ?? null,
    zeroPayReason: market?.zeroPayReason ?? null,
    requestId,
  };
}

export async function createGateway(config: AppConfig): Promise<DelphiGateway> {
  if (!config.live) return createDryGateway();
  if (!config.apiKey) {
    throw new Error("Live mode needs DELPHI_API_ACCESS_KEY in .env. Nothing was sent.");
  }
  let sdk: SdkModule;
  try {
    sdk = (await import("@gensyn-ai/gensyn-delphi-sdk")) as unknown as SdkModule;
  } catch (error) {
    throw new Error(
      `Could not load ${ASSUMPTIONS.sdk}. Run pnpm install in this folder. ${safe(config, error)} See docs/ADAPTING.md.`,
    );
  }
  if (typeof sdk.EvidenceClient !== "function") {
    throw new Error(
      `This install of ${ASSUMPTIONS.sdk} has no EvidenceClient. docs/ADAPTING.md explains where to reconnect it.`,
    );
  }
  const client = new sdk.EvidenceClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
    agentId: config.agentId,
    agentHarness: config.agentHarness,
    agentModel: config.agentModel || undefined,
  });
  return new SdkGateway(client, config);
}

export function absoluteFile(dataDir: string, relative: string): string {
  const abs = path.resolve(dataDir, relative);
  const root = path.resolve(dataDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("A file path escaped the data folder.");
  }
  return abs;
}
