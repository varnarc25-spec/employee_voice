import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..", "election_data");
const sectionNames: Record<string, string> = {
  LOK_SABHA: "Lok Sabha",
  STATE_ASSEMBLY: "State assembly",
  BYE_ELECTION: "Bye election",
  FORMER_STATE: "Former state",
  REFERENCE: "Reference",
};

type Row = {
  id: string;
  title: string;
  xlsx_url: string;
  sort_order: number;
  section: string;
  label: string;
  jurisdiction: string | null;
  state_name: string | null;
};

function safeName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return cleaned || "file";
}

function extensionOf(url: string): string {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match ? `.${match[1].toLowerCase()}` : ".xlsx";
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const rows = await pool.query<Row>(
  `SELECT f.id, f.title, f.xlsx_url, f.sort_order, r.section, r.label, r.jurisdiction, s.name AS state_name
   FROM election_statistical_report_files f
   JOIN election_statistical_reports r ON r.id = f.report_id
   LEFT JOIN election_states s ON s.id = f.state_id
   WHERE f.deleted_at IS NULL AND f.xlsx_url IS NOT NULL
   ORDER BY r.section, r.sort_order, f.sort_order`,
);
await pool.end();

fs.mkdirSync(root, { recursive: true });
const used = new Set<string>();
let saved = 0;
let skipped = 0;
const failed: { title: string; url: string; error: string }[] = [];
const index: { path: string; title: string; url: string; section: string; state: string; report: string }[] = [];

await mapPool(rows.rows, 6, async (row, position) => {
  const section = sectionNames[row.section] ?? row.section;
  const state = safeName(row.state_name || row.jurisdiction || "National");
  const report = safeName(row.label);
  const ext = extensionOf(row.xlsx_url);
  const base = `${String(row.sort_order + 1).padStart(2, "0")} ${safeName(row.title)}`;
  const directory = path.join(root, safeName(section), state, report);
  let filename = `${base}${ext}`;
  let target = path.join(directory, filename);
  let suffix = 2;
  while (used.has(target)) {
    filename = `${base} ${suffix}${ext}`;
    target = path.join(directory, filename);
    suffix += 1;
  }
  used.add(target);
  const relative = path.relative(root, target);
  index.push({
    path: relative,
    title: row.title,
    url: row.xlsx_url,
    section,
    state: row.state_name || row.jurisdiction || "National",
    report: row.label,
  });
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    skipped += 1;
    return;
  }
  try {
    const response = await fetch(row.xlsx_url, {
      headers: { "User-Agent": "EmployeeVoiceElectionData/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/html") || bytes.subarray(0, 15).toString("utf8").toLowerCase().includes("<!doctype")) {
      throw new Error("Response was HTML, not a spreadsheet");
    }
    if (bytes.length === 0) throw new Error("Empty file");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, bytes);
    saved += 1;
  } catch (error) {
    failed.push({ title: row.title, url: row.xlsx_url, error: error instanceof Error ? error.message : "download failed" });
  }
  if ((position + 1) % 50 === 0) {
    console.warn(`Downloaded ${position + 1}/${rows.rows.length}`);
  }
});

fs.writeFileSync(path.join(root, "index.json"), JSON.stringify({ saved, skipped, failed: failed.length, files: index, errors: failed }, null, 2));
console.log(JSON.stringify({ directory: root, total: rows.rows.length, saved, skipped, failed: failed.length }, null, 2));
if (failed.length) {
  console.warn(failed.slice(0, 10));
  process.exitCode = 1;
}
