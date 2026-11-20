import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { absoluteFile, type DelphiGateway, type TermsSnapshot } from "../delphi/client.js";
import type { AppConfig } from "../config.js";
import { buildNote } from "../note.js";
import { syncEvidencePdf } from "../pdf/evidence-pdf.js";
import { runPipeline } from "../pipeline.js";
import { redactSecrets, type Logger } from "../redact.js";
import type { Ledger } from "../ledger/store.js";
import { toPublicState } from "../state.js";
import { applyReceipt, rejectDraft, submitApproved } from "../submit/submit.js";
import type { Side } from "../types.js";

const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/queue": { file: "index.html", type: "text/html; charset=utf-8" },
  "/ledger": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

export async function startDashboard(options: {
  config: AppConfig;
  ledger: Ledger;
  gateway: DelphiGateway;
  log: Logger;
  run: typeof runPipeline;
}): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const { config, ledger, gateway, log } = options;
  const publicDir = path.join(config.root, "src", "server", "public");
  const fontDir = path.join(config.root, "public", "fonts");
  let termsCache: { at: number; value: TermsSnapshot } | null = null;

  const terms = async (): Promise<TermsSnapshot> => {
    if (termsCache && Date.now() - termsCache.at < 60_000) return termsCache.value;
    const value = await gateway.terms();
    termsCache = { at: Date.now(), value };
    return value;
  };

  const stateJson = async () => redactSecrets(JSON.stringify(await toPublicState(config, ledger, await terms())), config.secrets);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      if (req.method === "GET" && pathname === "/api/health") {
        return json(res, 200, { product: "evidence-miner", ok: true });
      }
      if (req.method === "GET" && pathname === "/api/state") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(await stateJson());
        return;
      }
      if (req.method === "POST" && pathname === "/api/scan") {
        await options.run({ config, ledger, log });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(await stateJson());
        return;
      }
      const draftMatch = pathname.match(/^\/api\/drafts\/([^/]+)(?:\/(approve|reject|edit|screenshot|files))?(?:\/([^/]+))?$/);
      if (draftMatch) {
        const id = draftMatch[1];
        const action = draftMatch[2] ?? "";
        const extra = draftMatch[3] ?? "";
        const draft = ledger.draft(id);
        if (!draft) return json(res, 404, { message: "That draft is not on this computer." });
        if (req.method === "GET" && action === "files") {
          const file = draft.files.find((item) => item.id === extra);
          if (!file) return json(res, 404, { message: "That file is not attached." });
          const bytes = await fs.readFile(absoluteFile(ledger.dir, file.path));
          res.writeHead(200, { "content-type": file.type, "content-disposition": `inline; filename="${file.name}"` });
          res.end(bytes);
          return;
        }
        if (req.method === "POST" && action === "approve") {
          const outcome = await submitApproved({ draft, ledger, gateway, live: config.live });
          if (outcome.sent && outcome.remoteId) {
            const remoteId = outcome.remoteId;
            void gateway.wait(remoteId).then(async (receipt) => {
              if (!receipt) return;
              applyReceipt(ledger, remoteId, receipt);
              await ledger.save();
            }).catch((error) => log.error(error instanceof Error ? error.message : String(error)));
          }
          return json(res, outcome.ok ? 200 : 400, { message: outcome.message, sent: outcome.sent });
        }
        if (req.method === "POST" && action === "reject") {
          if (draft.status !== "pending") return json(res, 400, { message: "This draft was already decided." });
          const message = await rejectDraft(draft, ledger);
          return json(res, 200, { message });
        }
        if (req.method === "POST" && action === "edit") {
          if (draft.status !== "pending") return json(res, 400, { message: "This draft was already decided." });
          const body = JSON.parse((await readBody(req, 1_000_000)).toString("utf8")) as Record<string, unknown>;
          applyEdit(draft, body);
          await syncEvidencePdf(draft, ledger.dir, config.attachPdf);
          await ledger.save();
          return json(res, 200, { message: "Saved. The gates were checked again." });
        }
        if (req.method === "POST" && action === "screenshot") {
          if (draft.status !== "pending") return json(res, 400, { message: "This draft was already decided." });
          const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
          if (type !== "image/png" && type !== "image/jpeg") {
            return json(res, 400, { message: "Attach a PNG or JPG screenshot." });
          }
          const others = draft.files.filter((file) => file.role !== "screenshot");
          if (others.length >= 3) {
            return json(res, 400, { message: "This draft already has 3 files. The PDF counts. Remove one first." });
          }
          const bytes = await readBody(req, 5_000_000);
          const ext = type === "image/png" ? "png" : "jpg";
          const relative = `files/${draft.id}-screenshot.${ext}`;
          await fs.mkdir(path.join(ledger.dir, "files"), { recursive: true });
          await fs.writeFile(absoluteFile(ledger.dir, relative), bytes);
          draft.files = others.concat({
            id: "screenshot",
            role: "screenshot",
            name: safeName(req.headers["x-filename"], `screenshot.${ext}`),
            type,
            path: relative,
          });
          await syncEvidencePdf(draft, ledger.dir, config.attachPdf);
          await ledger.save();
          return json(res, 200, { message: "Screenshot attached." });
        }
        if (req.method === "DELETE" && action === "screenshot") {
          draft.files = draft.files.filter((file) => file.role !== "screenshot");
          await syncEvidencePdf(draft, ledger.dir, config.attachPdf);
          await ledger.save();
          return json(res, 200, { message: "Screenshot removed." });
        }
      }
      if (req.method === "GET" && pathname.startsWith("/fonts/")) {
        const name = path.basename(pathname);
        if (!name.endsWith(".ttf")) return json(res, 404, { message: "Not found." });
        const bytes = await fs.readFile(path.join(fontDir, name));
        res.writeHead(200, { "content-type": "font/ttf", "cache-control": "public, max-age=86400" });
        res.end(bytes);
        return;
      }
      if (req.method === "GET" && STATIC[pathname]) {
        const asset = STATIC[pathname];
        const bytes = await fs.readFile(path.join(publicDir, asset.file));
        res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
        res.end(bytes);
        return;
      }
      json(res, 404, { message: "Not found." });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : "Something went wrong.", config.secrets);
      log.error(message);
      if (!res.headersSent) json(res, 500, { message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  config.port = port;
  return {
    port,
    url: `http://${config.host}:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function applyEdit(draft: { side: Side | null; quote: string; rationale: string; publishedAt: string | null; links: { url: string; label: string }[]; sourceHost: string; note: string }, body: Record<string, unknown>): void {
  if (body.side === "YES" || body.side === "NO") draft.side = body.side;
  if (typeof body.quote === "string") draft.quote = body.quote.trim();
  if (typeof body.rationale === "string") draft.rationale = body.rationale.trim();
  if (typeof body.publishedAt === "string" && body.publishedAt.trim()) {
    const parsed = Date.parse(body.publishedAt);
    if (Number.isFinite(parsed)) draft.publishedAt = new Date(parsed).toISOString();
  }
  if (Array.isArray(body.links)) {
    const links = body.links
      .filter((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item.trim()))
      .slice(0, 6)
      .map((url) => ({ url: url.trim(), label: hostOf(url.trim()) }));
    if (links.length > 0) {
      draft.links = links;
      draft.sourceHost = links[0].label;
    }
  }
  if (body.rebuildNote === false && typeof body.note === "string" && body.note.trim()) {
    draft.note = body.note;
  } else {
    draft.note = buildNote(draft);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function safeName(header: string | string[] | undefined, fallback: string): string {
  const raw = Array.isArray(header) ? header[0] : header;
  const cleaned = (raw ?? fallback).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  return cleaned || fallback;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("That upload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
