import fs from "node:fs/promises";
import path from "node:path";
import type { Draft, NoteRecord, PickerMarket, SubmissionRecord } from "../types.js";

export interface LastScan {
  at: string;
  openMarkets: number;
  picked: number;
  sources: number;
  sample: boolean;
}

interface LedgerFile {
  version: 1;
  seeded: boolean;
  sample: boolean;
  drafts: Draft[];
  submissions: SubmissionRecord[];
  notes: NoteRecord[];
  markets: PickerMarket[];
  lastScan: LastScan | null;
}

export class Ledger {
  version = 1 as const;
  seeded = false;
  sample = false;
  drafts: Draft[] = [];
  submissions: SubmissionRecord[] = [];
  notes: NoteRecord[] = [];
  markets: PickerMarket[] = [];
  lastScan: LastScan | null = null;

  constructor(readonly file: string | null) {}

  static async open(dir: string): Promise<Ledger> {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "ledger.json");
    const ledger = new Ledger(file);
    try {
      const raw = await fs.readFile(file, "utf8");
      ledger.load(JSON.parse(raw) as LedgerFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    return ledger;
  }

  get dir(): string {
    return this.file ? path.dirname(this.file) : process.cwd();
  }

  load(data: LedgerFile): void {
    this.version = 1;
    this.seeded = Boolean(data.seeded);
    this.sample = Boolean(data.sample);
    this.drafts = data.drafts ?? [];
    this.submissions = data.submissions ?? [];
    this.notes = data.notes ?? [];
    this.markets = data.markets ?? [];
    this.lastScan = data.lastScan ?? null;
  }

  toJSON(): LedgerFile {
    return {
      version: 1,
      seeded: this.seeded,
      sample: this.sample,
      drafts: this.drafts,
      submissions: this.submissions,
      notes: this.notes,
      markets: this.markets,
      lastScan: this.lastScan,
    };
  }

  async save(): Promise<void> {
    if (!this.file) return;
    const json = JSON.stringify(this.toJSON(), null, 2);
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, json);
    await fs.rename(tmp, this.file);
  }

  async reset(): Promise<void> {
    this.seeded = false;
    this.sample = false;
    this.drafts = [];
    this.submissions = [];
    this.notes = [];
    this.markets = [];
    this.lastScan = null;
    if (this.file) {
      await fs.rm(path.join(this.dir, "files"), { recursive: true, force: true });
    }
    await this.save();
  }

  draft(id: string): Draft | undefined {
    return this.drafts.find((item) => item.id === id);
  }
}
