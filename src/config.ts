import path from "node:path";
import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  root: string;
  dataDir: string;
  apiKey: string;
  apiUrl: string;
  siteUrl: string;
  agentId: string;
  agentHarness: string;
  agentModel: string;
  owner: string;
  acceptTerms: string;
  feedbackUrl: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  live: boolean;
  preferSample: boolean;
  attachPdf: boolean;
  port: number;
  host: string;
  openBrowser: boolean;
  help: boolean;
  feedback: boolean;
  feedbackSend: boolean;
  feedbackText: string;
  resetSample: boolean;
  secrets: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function flagBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export function loadConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  options: { loadEnvFile?: boolean } = {},
): AppConfig {
  if (options.loadEnvFile !== false) {
    loadDotenv({ path: path.join(cwd, ".env") });
  }
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg.startsWith("--")) flags.add(arg);
    else rest.push(arg);
  }

  const live = flags.has("--live");
  const dryFlag = flags.has("--dry-run");
  if (live && dryFlag) {
    throw new ConfigError("Use either --live or --dry-run. The default, with no flag, is a dry-run.");
  }
  if (live && flags.has("--sample")) {
    throw new ConfigError("Sample data cannot be combined with --live. Nothing was sent.");
  }

  const apiKey = (env.DELPHI_API_ACCESS_KEY || env.DELPHI_API_KEY || "").trim();
  const llmApiKey = (env.LLM_API_KEY || "").trim();
  const port = Number(env.PORT || 3737);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError("PORT must be a whole number from 0 to 65535.");
  }

  const secrets = [apiKey, llmApiKey].filter((value) => value.length >= 6);

  return {
    root: cwd,
    dataDir: path.resolve(cwd, env.DATA_DIR || "data"),
    apiKey,
    apiUrl: (env.DELPHI_API_URL || "https://api.delphi.fyi/v1").trim().replace(/\/+$/, ""),
    siteUrl: (env.COMPETITION_SITE_URL || "").trim().replace(/\/+$/, ""),
    agentId: (env.AGENT_ID || "evidence-miner").trim() || "evidence-miner",
    agentHarness: (env.AGENT_HARNESS || "evidence-mining-agent").trim() || "evidence-mining-agent",
    agentModel: (env.AGENT_MODEL || "").trim(),
    owner: (env.AGENT_OWNER || "POCONG").trim() || "POCONG",
    acceptTerms: (env.ACCEPT_TERMS || "").trim(),
    feedbackUrl: (env.DELPHI_FEEDBACK_URL || "").trim(),
    llmApiKey,
    llmBaseUrl: (env.LLM_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
    llmModel: (env.LLM_MODEL || "gpt-4o-mini").trim(),
    live,
    preferSample: flags.has("--sample") || apiKey.length === 0,
    attachPdf: flagBool(env.ATTACH_EVIDENCE_PDF, true),
    port,
    host: "127.0.0.1",
    openBrowser: !flags.has("--no-open"),
    help: flags.has("--help") || flags.has("-h"),
    feedback: flags.has("--feedback"),
    feedbackSend: flags.has("--send"),
    feedbackText: rest.join(" ").trim(),
    resetSample: flags.has("--reset-sample"),
    secrets,
  };
}

export function helpText(): string {
  return [
    "Evidence Mining",
    "",
    "pnpm start                 scan, research, and open the dashboard (dry-run)",
    "pnpm start --dry-run       same thing, written out",
    "pnpm start --live          send only the drafts you approve, after the terms are accepted",
    "pnpm start --sample        force the built-in sample markets",
    "pnpm start --reset-sample  restore the sample queue",
    "pnpm start --no-open       do not try to open a browser",
    "pnpm feedback              write a feedback note under data/",
    "pnpm feedback --send       also POST it when DELPHI_FEEDBACK_URL is set",
    "",
    "Dry-run is the default. A dry-run never POSTs a submission.",
    "The API key is read from DELPHI_API_ACCESS_KEY and is never printed.",
  ].join("\n");
}
