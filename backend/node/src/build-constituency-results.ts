import pg from "pg";
import { config } from "./config.js";

type ResultRow = {
  stateLgdCode: number;
  acNo: number;
  kind: "assembly" | "lok_sabha" | "bye";
  year: number;
  electionName: string;
  constituencyName: string;
  winnerName: string;
  party: string | null;
};

function placeKey(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function electionYear(value: string): number | null {
  const years = [...value.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return years.length ? Math.max(...years) : null;
}

function votes(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function byeAcNumber(fileName: string): number | null {
  const patterns = [
    /[A-Za-z]\s*-\s*(\d{1,3})\s*-/,
    /,\s*(\d{1,3})\s*-/,
    /(?:^|[\s/])(\d{1,3})\s*-\s*[A-Za-z]/,
  ];
  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  const states = await client.query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_states");
  const stateByKey = new Map(states.rows.map((state) => [placeKey(state.name_en), state.lgd_code]));
  const segments = await client.query<{ state_lgd_code: number; ac_no: number; ac_name: string }>(
    "SELECT state_lgd_code, ac_no, ac_name FROM assembly_segments",
  );
  const acNames = new Map(segments.rows.map((row) => [`${row.state_lgd_code}:${row.ac_no}`, row.ac_name]));
  const results = new Map<string, ResultRow>();

  const assembly = await client.query<{
    state_name: string;
    report_label: string;
    ac_no: string;
    constituency: string | null;
    winner: string | null;
    party: string | null;
  }>(
    `SELECT s.state_name, s.report_label,
            r.cells->>'AC No.' AS ac_no,
            r.cells->>'CONSTITUENCY' AS constituency,
            r.cells->>'WINNER / Name' AS winner,
            r.cells->>'WINNER / PARTY' AS party
     FROM election_workbook_rows r
     JOIN election_workbook_sheets s ON s.id = r.sheet_id
     WHERE s.section = 'State assembly'
       AND s.source_title ILIKE '%successful%'
       AND r.cells->>'WINNER / Name' IS NOT NULL
       AND r.cells->>'AC No.' ~ '^[0-9]+$'`,
  );
  for (const row of assembly.rows) {
    const stateLgdCode = stateByKey.get(placeKey(row.state_name));
    const year = electionYear(row.report_label);
    const acNo = Number(row.ac_no);
    if (!stateLgdCode || !year || !row.winner || !acNames.has(`${stateLgdCode}:${acNo}`)) continue;
    const key = `${stateLgdCode}:${acNo}:assembly:${year}`;
    const current = results.get(key);
    const preferThis = !current || (row.report_label.includes("Including") && !current.electionName.includes("Including"));
    if (preferThis) {
      results.set(key, {
        stateLgdCode,
        acNo,
        kind: "assembly",
        year,
        electionName: `${row.state_name} Legislative Assembly, ${year}`,
        constituencyName: row.constituency || acNames.get(`${stateLgdCode}:${acNo}`) || String(acNo),
        winnerName: row.winner,
        party: row.party,
      });
    }
  }

  const lokSabha = await client.query<{
    state_lgd_code: number;
    ac_no: number;
    ac_name: string;
    pc_name: string;
    winning_candidate: string;
    winning_party: string;
  }>(
    `SELECT a.state_lgd_code, a.ac_no, a.ac_name, c.name AS pc_name, res.winning_candidate, res.winning_party
     FROM assembly_segments a
     JOIN lok_sabha_constituencies c ON c.state_lgd_code = a.state_lgd_code AND c.pc_no = a.pc_no
     JOIN lok_sabha_results res ON res.state_lgd_code = a.state_lgd_code AND res.pc_no = a.pc_no`,
  );
  for (const row of lokSabha.rows) {
    results.set(`${row.state_lgd_code}:${row.ac_no}:lok_sabha:2024`, {
      stateLgdCode: row.state_lgd_code,
      acNo: row.ac_no,
      kind: "lok_sabha",
      year: 2024,
      electionName: "Lok Sabha, 2024",
      constituencyName: row.pc_name,
      winnerName: row.winning_candidate,
      party: row.winning_party,
    });
  }

  const byeRows = await client.query<{ relative_path: string; cells: Record<string, string> }>(
    `SELECT s.relative_path, r.cells
     FROM election_workbook_rows r
     JOIN election_workbook_sheets s ON s.id = r.sheet_id
     WHERE s.section = 'Bye election' AND r.cells ? 'CANDIDATES' AND r.cells ? 'Column 10'`,
  );
  const byeBest = new Map<string, ResultRow & { votes: number }>();
  for (const row of byeRows.rows) {
    const parts = row.relative_path.split("/");
    const stateName = parts[1] ?? "";
    const period = parts[2] ?? "";
    const fileName = parts[3] ?? "";
    if (!stateName || stateName === "National") continue;
    const stateLgdCode = stateByKey.get(placeKey(stateName));
    const year = electionYear(period);
    const acNo = byeAcNumber(fileName);
    const winner = row.cells.CANDIDATES;
    const total = votes(row.cells["Column 10"]);
    if (!stateLgdCode || !year || !acNo || !winner || total == null) continue;
    if (!/^[A-Za-z]/.test(winner) || winner.length < 4) continue;
    if (!acNames.has(`${stateLgdCode}:${acNo}`)) continue;
    const key = `${stateLgdCode}:${acNo}:bye:${year}`;
    const current = byeBest.get(key);
    if (!current || total > current.votes) {
      byeBest.set(key, {
        stateLgdCode,
        acNo,
        kind: "bye",
        year,
        electionName: `${stateName} bye-election, ${year}`,
        constituencyName: acNames.get(`${stateLgdCode}:${acNo}`) || fileName,
        winnerName: winner,
        party: row.cells.TOTAL && !/^\d[\d,]*$/.test(row.cells.TOTAL) ? row.cells.TOTAL : null,
        votes: total,
      });
    }
  }
  for (const [key, row] of byeBest) {
    results.set(key, {
      stateLgdCode: row.stateLgdCode,
      acNo: row.acNo,
      kind: row.kind,
      year: row.year,
      electionName: row.electionName,
      constituencyName: row.constituencyName,
      winnerName: row.winnerName,
      party: row.party,
    });
  }

  const rows = [...results.values()];
  await client.query("BEGIN");
  await client.query("TRUNCATE constituency_election_results");
  const size = 400;
  for (let offset = 0; offset < rows.length; offset += size) {
    const batch = rows.slice(offset, offset + size);
    await client.query(
      `INSERT INTO constituency_election_results
         (state_lgd_code, ac_no, kind, year, election_name, constituency_name, winner_name, party)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[])`,
      [
        batch.map((row) => row.stateLgdCode),
        batch.map((row) => row.acNo),
        batch.map((row) => row.kind),
        batch.map((row) => row.year),
        batch.map((row) => row.electionName),
        batch.map((row) => row.constituencyName),
        batch.map((row) => row.winnerName),
        batch.map((row) => row.party),
      ],
    );
  }
  await client.query("COMMIT");
  const summary = await client.query<{ kind: string; count: string }>(
    "SELECT kind, count(*)::text AS count FROM constituency_election_results GROUP BY kind ORDER BY kind",
  );
  console.log(JSON.stringify({ stored: rows.length, byKind: summary.rows }, null, 2));
  client.release();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
