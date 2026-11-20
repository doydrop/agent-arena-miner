import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ConfigError, helpText, loadConfig } from "./config.js";
import { renderReport, stripColor } from "./cli/render.js";
import { createGateway } from "./delphi/client.js";
import { writeFeedback } from "./feedback/feedback.js";
import { Ledger } from "./ledger/store.js";
import { runPipeline } from "./pipeline.js";
import { createLogger } from "./redact.js";
import { startDashboard } from "./server/dashboard.js";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`This program needs Node.js 20 or newer. You have ${process.versions.node}.`);
  process.exit(1);
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2));
  const log = createLogger(config.secrets);
  if (config.help) {
    console.log(helpText());
    return;
  }
  if (config.feedback) {
    const gateway = await createGateway({
      ...config,
      live: Boolean(config.feedbackSend && config.feedbackUrl && config.apiKey),
    });
    const result = await writeFeedback(config, gateway, config.feedbackText);
    log.info(result.detail);
    log.info(result.file);
    return;
  }

  if (config.live && !config.apiKey) {
    throw new ConfigError("Live mode needs DELPHI_API_ACCESS_KEY in the .env file. Nothing was sent.");
  }

  if (config.port !== 0 && (await dashboardIsRunning(config.host, config.port))) {
    const response = await fetch(`http://${config.host}:${config.port}/api/scan`, { method: "POST" });
    if (!response.ok) throw new Error("The dashboard is already open, and the new scan did not run.");
    log.info(`The dashboard is already open at http://${config.host}:${config.port}`);
    log.info("Another scan was sent there. Nothing was posted to Delphi by this command.");
    return;
  }

  const ledger = await Ledger.open(config.dataDir);
  if (config.resetSample) {
    await ledger.reset();
    log.info("Cleared the saved queue.");
  }
  const gateway = await createGateway(config);
  const report = await runPipeline({ config, ledger, log });
  const command = process.argv.slice(2).join(" ");
  const shown = command ? `pnpm start ${command}` : "pnpm start";
  const rendered = renderReport(report, { command: shown, cwd: config.root, owner: config.owner });
  process.stdout.write(`${rendered}\n`);
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(path.join(config.dataDir, "last-run.txt"), stripColor(rendered));

  const server = await startDashboard({
    config,
    ledger,
    gateway,
    log,
    run: (opts) => runPipeline(opts),
  });
  log.info(`Dashboard: ${server.url}`);
  if (config.openBrowser) openBrowser(server.url);
}

function openBrowser(url: string): void {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is already printed.
  }
}

async function dashboardIsRunning(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(700) });
    if (!response.ok) return false;
    const body = (await response.json()) as { product?: string };
    return body.product === "evidence-miner";
  } catch {
    return false;
  }
}

main().catch((error) => {
  const configSecrets = [process.env.DELPHI_API_ACCESS_KEY ?? "", process.env.DELPHI_API_KEY ?? "", process.env.LLM_API_KEY ?? ""];
  const message = error instanceof Error ? error.message : String(error);
  let safe = message;
  for (const secret of configSecrets) {
    if (secret.length >= 6) safe = safe.split(secret).join("[redacted]");
  }
  console.error(safe);
  console.error("The README has a troubleshooting section. Nothing was sent unless a receipt is already in the ledger.");
  process.exit(1);
});
