/**
 * Everything the rest of the program believes about Delphi.
 * When the official guide (published 25 Nov 2026) disagrees, change this file
 * and src/delphi/client.ts. The map is in docs/ADAPTING.md.
 *
 * Checked against @gensyn-ai/gensyn-delphi-sdk 2.4.0 (published 2026-11-19)
 * and examples/evidence-starter. EvidenceClient arrived in 2.2.0; terms in
 * 2.3.0; the fields below are the 2.4.0 surface. 2.2.0 itself is not on npm.
 */
export const ASSUMPTIONS = {
  sdk: "@gensyn-ai/gensyn-delphi-sdk",
  sdkVersion: "2.4.0",
  /**
   * Mainnet evidence API. The brief points at https://api-access.delphi.fyi/,
   * which issues mainnet keys. The starter instead requires DELPHI_API_URL.
   * Override with DELPHI_API_URL. The value includes /v1.
   */
  defaultApiUrl: "https://api.delphi.fyi/v1",
  /** Header names the brief and the SDK both send. */
  headers: {
    auth: "Authorization: Bearer",
    agentId: "X-Agent-Id",
    harness: "X-Agent-Harness",
    model: "X-Agent-Model",
    idempotency: "Idempotency-Key",
  },
  /**
   * submitEvidence({ note, links, files, marketAddress, idempotencyKey }).
   * Passing idempotencyKey is required for a safe retry. The SDK mints a new
   * UUID when the field is omitted.
   */
  submitMethod: "submitEvidence",
  /** No side argument exists. The note text carries "Side: YES" or "Side: NO". */
  sideInNote: true,
  /** getTerms() then acceptTerms(version). submitEvidence does not send termsAccepted. */
  termsMethods: ["getTerms", "acceptTerms"],
  /** Env name the starter reads before it will call acceptTerms. */
  acceptTermsEnv: "ACCEPT_TERMS",
  marketsPath: "/markets.json",
  /**
   * Starter shape: address, question, status, odds.yes, odds.no, evidenceCutoffAt, dataSources.
   * odds.yes may be 0..1 or a percent. Extra aliases are accepted in the watcher.
   * Forecaster probability is used only when market odds are missing.
   */
  oddsBand: [0.2, 0.8],
  maxSubmissionsPerMarket: 3,
  maxFilesPerSubmission: 3,
  allowedFileExtensions: ["pdf", "png", "jpg", "jpeg", "csv", "txt"],
  qualifySubmissions: 10,
  qualifyMarkets: 3,
  /** EvidenceClient in 2.4.0 has no feedback method. */
  feedbackEndpoint: null,
  /** Sample mode pretends the clock is this instant so the fixture never expires. */
  sampleNow: "2026-11-24T02:15:00.000Z",
} as const;
