import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as {
  readFile: (file: string, options: { cellDates: boolean; dense: boolean }) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, options: { header: number; defval: string; raw: boolean }) => unknown[][];
  };
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", "election_data");

type IndexEntry = {
  path: string;
  title: string;
  url: string;
  section: string;
  state: string;
  report: string;
};

type ParsedSheet = {
  title: string;
  columns: string[];
  rows: Record<string, string>[];
};

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function trimRow(row: unknown[]): string[] {
  const cells = row.map(cellText);
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function filled(row: string[]): string[] {
  return row.filter((cell) => cell.length > 0);
}

function numeric(value: string): boolean {
  return /^-?\d[\d,.\s%]*$/.test(value);
}

function fillsNewColumns(previous: string[], next: string[]): boolean {
  const width = Math.max(previous.length, next.length);
  let added = 0;
  for (let index = 0; index < width; index += 1) {
    if (!(previous[index] ?? "") && (next[index] ?? "")) added += 1;
  }
  return added >= 2 && filled(next).length > filled(previous).length;
}

function looksLikeHeader(row: string[]): boolean {
  const cells = filled(row);
  if (cells.length < 2) return false;
  const first = cells[0] ?? "";
  if (/^\d+$/.test(first)) return false;
  const text = cells.filter((cell) => !numeric(cell)).length;
  return text >= Math.ceil(cells.length * 0.6);
}

function mergeHeaders(rows: string[][]): string[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  const parents = normalized.slice(0, -1).map((row) => {
    let last = "";
    return row.map((cell) => {
      if (cell) last = cell;
      return last;
    });
  });
  const leaf = normalized[normalized.length - 1] ?? [];
  return leaf.map((cell, index) => {
    const above = parents
      .map((row) => row[index] ?? "")
      .filter((value, position, all) => value && all.indexOf(value) === position);
    return [...above, cell].filter(Boolean).join(" / ") || `Column ${index + 1}`;
  });
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

export function parseMatrix(matrix: unknown[][]): ParsedSheet {
  const rows = matrix.map(trimRow).filter((row) => filled(row).length > 0);
  if (!rows.length) return { title: "", columns: [], rows: [] };
  const headerAt = rows.findIndex(looksLikeHeader);
  if (headerAt < 0) {
    const width = Math.max(...rows.map((row) => row.length));
    const columns = Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
    return {
      title: filled(rows[0]).join(" "),
      columns,
      rows: rows.map((row) => recordFrom(columns, row)).filter((row) => Object.keys(row).length > 0),
    };
  }
  const headerRows = [rows[headerAt]];
  let cursor = headerAt + 1;
  while (
    cursor < rows.length &&
    headerRows.length < 3 &&
    looksLikeHeader(rows[cursor]) &&
    fillsNewColumns(headerRows[headerRows.length - 1], rows[cursor])
  ) {
    headerRows.push(rows[cursor]);
    cursor += 1;
  }
  const columns = uniqueNames(mergeHeaders(headerRows));
  const title = rows.slice(0, headerAt).map((row) => filled(row).join(" ")).filter(Boolean)[0] ?? "";
  const body = rows.slice(cursor).map((row) => recordFrom(columns, row)).filter((row) => Object.keys(row).length > 0);
  return { title, columns, rows: body };
}

function recordFrom(columns: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  columns.forEach((name, index) => {
    const value = row[index] ?? "";
    if (value) record[name] = value;
  });
  for (let index = columns.length; index < row.length; index += 1) {
    const value = row[index] ?? "";
    if (value) record[`Column ${index + 1}`] = value;
  }
  return record;
}

async function insertRows(client: pg.PoolClient, sheetId: string, rows: Record<string, string>[]): Promise<void> {
  const size = 400;
  for (let offset = 0; offset < rows.length; offset += size) {
    const batch = rows.slice(offset, offset + size);
    await client.query(
      `INSERT INTO election_workbook_rows (sheet_id, row_number, cells)
       SELECT * FROM unnest($1::uuid[], $2::int[], $3::jsonb[])`,
      [
        batch.map(() => sheetId),
        batch.map((_, index) => offset + index + 1),
        batch.map((row) => JSON.stringify(row)),
      ],
    );
  }
}

async function main(): Promise<void> {
  const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8")) as { files: IndexEntry[] };
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  const filesByUrl = new Map<string, string>();
  const fileRows = await client.query<{ id: string; xlsx_url: string }>(
    "SELECT id, xlsx_url FROM election_statistical_report_files WHERE deleted_at IS NULL AND xlsx_url IS NOT NULL",
  );
  for (const row of fileRows.rows) filesByUrl.set(row.xlsx_url, row.id);

  await client.query("TRUNCATE election_workbook_sheets CASCADE");
  let sheets = 0;
  let storedRows = 0;
  const failed: { path: string; error: string }[] = [];
  const files = index.files;
  for (const [position, entry] of files.entries()) {
    const fullPath = path.join(root, entry.path);
    try {
      const workbook = XLSX.readFile(fullPath, { cellDates: false, dense: false });
      await client.query("BEGIN");
      for (const sheetName of workbook.SheetNames) {
        const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          header: 1,
          defval: "",
          raw: false,
        }) as unknown[][];
        const parsed = parseMatrix(matrix);
        const id = crypto.randomUUID();
        await client.query(
          `INSERT INTO election_workbook_sheets
             (id, report_file_id, relative_path, sheet_name, section, state_name, report_label, source_title, source_url, sheet_title, columns, row_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
          [
            id,
            filesByUrl.get(entry.url) ?? null,
            entry.path,
            sheetName,
            entry.section,
            entry.state,
            entry.report,
            entry.title,
            entry.url,
            parsed.title || null,
            JSON.stringify(parsed.columns),
            parsed.rows.length,
          ],
        );
        await insertRows(client, id, parsed.rows);
        sheets += 1;
        storedRows += parsed.rows.length;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      failed.push({ path: entry.path, error: error instanceof Error ? error.message : "import failed" });
    }
    if ((position + 1) % 25 === 0 || position + 1 === files.length) {
      console.warn(`Imported ${position + 1}/${files.length} files, ${sheets} sheets, ${storedRows} rows`);
    }
  }
  client.release();
  await pool.end();
  console.log(JSON.stringify({ files: files.length, sheets, rows: storedRows, failed: failed.length }, null, 2));
  if (failed.length) {
    console.warn(failed.slice(0, 15));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
