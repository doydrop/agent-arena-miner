# Adapting this agent when the official guide changes

The evidence guide and starter were due on 25 Nov 2026. This repo was written against `@gensyn-ai/gensyn-delphi-sdk` **2.4.0** (EvidenceClient landed in 2.2.0, terms in 2.3.0). If the published guide disagrees with the code, change the Delphi layer first and leave the dashboard alone.

The only file that imports the SDK is `src/delphi/client.ts`. The beliefs that file encodes are listed in `src/delphi/assumptions.ts`.

## 1. Base URL

`DELPHI_API_URL` in `.env`. The default is `https://api.delphi.fyi/v1` because the key page in the brief (`https://api-access.delphi.fyi/`) issues mainnet keys.

The official starter instead requires you to pass `DELPHI_API_URL` yourself (`https://<Delphi app domain>/v1`). If the guide names a different host, change the value in `.env` only. The client sends that string as `EvidenceClient`'s `baseUrl`.

## 2. Market list

`src/watcher/markets.ts`

- `fetchMarkets` requests `{COMPETITION_SITE_URL}/markets.json`.
- `parseMarketFeed` accepts either an array or `{ markets: [...] }`, which is what `examples/evidence-starter` reads.
- `normalizeMarket` maps these aliases:
  - address: `address`, `marketAddress`, `id`
  - question: `question`, `title`, `name`
  - odds: `odds.yes`, `yesPrice`, `impliedProbability`, `probability` (a number above 1 is treated as a percent)
  - forecaster: `forecaster.yes`, `forecasterYes`, `aiProbability`, `forecast` — used only when market odds are missing
  - cutoff: `evidenceCutoffAt`, `evidence_cutoff`, `cutoff`, `evidenceCutoff`
  - close: `closesAt`, `closeTime`, `resolvesAt`, `tradingDeadline`
  - pot: `rewardPotUsd`, `rewardPot`, `pot`, `judgementPot`
  - sources: `dataSources`, `sources`, `links`

If a field is renamed, add the new name in `normalizeMarket`. Do not scatter the rename through the picker.

## 3. Submit, terms, idempotency

`src/delphi/client.ts`, class `SdkGateway`.

Current calls:

- `getTerms()` then `acceptTerms(version)` only when `ACCEPT_TERMS` equals `terms.version`
- `getEntryState(market)` and `listSubmissions({ market })` before a send
- `submitEvidence({ note, links, files, marketAddress, idempotencyKey })`
- `waitForSubmission(id)` after a send

`src/submit/submit.ts` writes the idempotency key into `data/ledger.json` **before** `gateway.submit`. If the method is renamed, change `SdkGateway.submit` only, and keep passing the stored key.

There is no side field in SDK 2.4.0. `src/note.ts` `buildNote` writes `Side: YES` or `Side: NO` into the note. If the API adds a side argument, add it in `SdkGateway.submit` and stop relying on the sentence in the note.

`termsAccepted` on `submitEvidence` is deprecated and ignored. Do not send it.

## 4. Headers and the key

The SDK sets `Authorization: Bearer`, `X-Agent-Id`, `X-Agent-Harness`, and `X-Agent-Model` from:

- `DELPHI_API_ACCESS_KEY` (fallback `DELPHI_API_KEY`)
- `AGENT_ID`, `AGENT_HARNESS`, `AGENT_MODEL`

Nothing in the repo should print those values. `src/redact.ts` strips them from errors. Keep new logs on the `Logger` from `createLogger`.

## 5. Caps, files, and the PDF

- 3 submissions per market and the 10 / 3 qualification totals live in `src/delphi/assumptions.ts` and are applied by `src/picker/pick.ts` and `src/gates/quality.ts`.
- Allowed extensions: pdf, png, jpg, jpeg, csv, txt. Enforced in `evaluateGates`.
- `ATTACH_EVIDENCE_PDF` (default `true`) is read in `src/config.ts`. `src/pdf/evidence-pdf.ts` `syncEvidencePdf` writes one page and refuses to be the 4th file.
- The 3-slot indicator is `marketSlots` in `src/picker/pick.ts`. The dashboard reads `slots` / `slotsRemaining` from `src/state.ts`. It is the submission cap, not the file cap. File slots are separate and labeled "Files".

## 6. Feedback

SDK 2.4.0 has no feedback method. `pnpm feedback` writes `data/feedback-draft.md`. `pnpm feedback --send` POSTs to `DELPHI_FEEDBACK_URL` only when that variable and the API key are both set. The key is a header, not part of the body. If Delphi adds a client method, call it from `SdkGateway.feedback` and leave `src/feedback/feedback.ts` as the file writer.

## 7. Sample data

`src/watcher/fixtures.ts` is fiction for the dry-run with no key. `seedSample` copies it into `data/`. Sample drafts are refused in `submitApproved` even if `--live` is passed. Do not point sample addresses at real markets.

## 8. Check after a change

```bash
pnpm install
pnpm test
pnpm exec tsc --noEmit
pnpm start --dry-run
```

Dry-run must still open http://127.0.0.1:3737 with no API key. Live sending still requires `DELPHI_API_ACCESS_KEY`, `--live`, and accepted terms.
