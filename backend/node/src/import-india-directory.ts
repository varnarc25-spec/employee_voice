import crypto from "node:crypto";
import { pool, query } from "./db.js";

const origin = "https://www.india.gov.in";

type UtilityHit = {
  title?: string;
  category?: string[];
  address?: string;
  phone?: string;
  email?: string;
  stateName?: string;
  districtName?: string;
};

type Portal = {
  stateName?: string;
  title?: string;
  url?: string;
  state_id?: string;
  state_or_ut?: string;
  state_lgd_code?: string;
  facebook_url?: string | null;
  twitter_url?: string | null;
  linkedin_url?: string | null;
};

type Holiday = {
  id?: number;
  attributes?: { alias?: string; title?: string; date?: string; holiday_type?: string };
};

function decode(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function post(path: string, body: unknown): Promise<unknown> {
  let response: Response | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    if (attempt === 3) throw new Error(`${path} failed: ${response.status}`);
  }
  throw new Error(`${path} failed`);
}

async function storePortals(): Promise<number> {
  const body = await post("/directory/contact-directory/api", {
    dataval: { pageno: 1, pageSize: 100, querytype: "All_States" },
  }) as { resultdata?: { data?: { getIgodAllState?: { results?: Portal[] } } } };
  const rows = body.resultdata?.data?.getIgodAllState?.results ?? [];
  let stored = 0;
  for (const row of rows) {
    const stateCode = Number(row.state_lgd_code);
    const title = decode(row.title);
    const url = decode(row.url);
    if (!Number.isInteger(stateCode) || !title || !url) continue;
    await query(
      `INSERT INTO state_government_portals (
         state_lgd_code, state_name, title, portal_url, state_code, kind, facebook_url, twitter_url, linkedin_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (state_lgd_code) DO UPDATE SET
         state_name = EXCLUDED.state_name,
         title = EXCLUDED.title,
         portal_url = EXCLUDED.portal_url,
         state_code = EXCLUDED.state_code,
         kind = EXCLUDED.kind,
         facebook_url = EXCLUDED.facebook_url,
         twitter_url = EXCLUDED.twitter_url,
         linkedin_url = EXCLUDED.linkedin_url,
         updated_at = now()`,
      [stateCode, decode(row.stateName), title, url, row.state_id ?? null, row.state_or_ut ?? null, row.facebook_url, row.twitter_url, row.linkedin_url],
    );
    stored += 1;
  }
  return stored;
}

async function storeHolidays(): Promise<number> {
  const body = await post("/calendar/api", {
    dataval: { querytype: "getCentralHolidays", variables: { year: 2026 } },
  }) as { resultdata?: { data?: { getCentralHolidays?: { data?: Holiday[] } } } };
  const rows = body.resultdata?.data?.getCentralHolidays?.data ?? [];
  let stored = 0;
  const ids: number[] = [];
  for (const row of rows) {
    const sourceId = row.id;
    const title = decode(row.attributes?.title);
    const date = row.attributes?.date;
    if (!sourceId || !title || !date) continue;
    ids.push(sourceId);
    await query(
      `INSERT INTO central_holidays (year, source_id, alias, title, holiday_date, holiday_type)
       VALUES (2026, $1, $2, $3, $4, $5)
       ON CONFLICT (year, source_id) DO UPDATE SET
         alias = EXCLUDED.alias,
         title = EXCLUDED.title,
         holiday_date = EXCLUDED.holiday_date,
         holiday_type = EXCLUDED.holiday_type,
         updated_at = now()`,
      [sourceId, decode(row.attributes?.alias), title, date, row.attributes?.holiday_type ?? ""],
    );
    stored += 1;
  }
  await query("DELETE FROM central_holidays WHERE year = 2026 AND NOT (source_id = ANY($1::int[]))", [ids]);
  return stored;
}

type UtilityFilter = { fieldName: string; fieldValue: string };
const utilityCategories = ["Banks", "Hospitals", "Colleges/Universities", "Schools", "Municipality", "Electricity", "NGOs", "Postals"];

function placeKey(value: string): string {
  return value.toLowerCase().replace(/\s*\((ut|nct)\)\s*$/i, "").replace(/&/g, " and ").replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();
}

async function utilityPage(filters: UtilityFilter[], categories: string[], page: number, pageSize: number): Promise<{ total: number; hits: UtilityHit[] }> {
  const body = await post("/directory/public-utilities/service", {
    termMatches: filters,
    categories,
    pageNumber: page,
    pageSize,
  }) as { result?: { data?: { getPublicAggregation?: { total?: number; results?: { publicUtilityHits?: UtilityHit[] } } } } };
  const aggregation = body.result?.data?.getPublicAggregation;
  return { total: aggregation?.total ?? 0, hits: aggregation?.results?.publicUtilityHits ?? [] };
}

async function storeUtilities(): Promise<{ stored: number; removed: number; unmappedStates: string[] }> {
  const states = await query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_states");
  const districts = await query<{ lgd_code: number; state_lgd_code: number }>("SELECT lgd_code, state_lgd_code FROM lgd_districts");
  const stateByName = new Map(states.map((state) => [placeKey(state.name_en), state.lgd_code]));
  const districtsByState = new Map<number, number[]>();
  for (const district of districts) {
    const list = districtsByState.get(district.state_lgd_code) ?? [];
    list.push(district.lgd_code);
    districtsByState.set(district.state_lgd_code, list);
  }
  const hashes = new Set<string>();
  const unmapped = new Set<string>();
  const pageSize = 500;

  async function saveHits(hits: UtilityHit[]): Promise<void> {
    const columns: string[][] = [[], [], [], [], [], [], [], [], []];
    const seen = new Set<string>();
    for (const hit of hits) {
      const title = decode(hit.title);
      if (!title) continue;
      const stateName = decode(hit.stateName);
      const districtName = decode(hit.districtName);
      const address = decode(hit.address);
      const phone = decode(hit.phone);
      const email = decode(hit.email);
      const category = (hit.category ?? []).map((value) => decode(value)).filter(Boolean);
      const stateCode = stateByName.get(placeKey(stateName));
      if (stateName && !stateCode) unmapped.add(stateName);
      const contentHash = crypto.createHash("sha256").update(JSON.stringify({ title, stateName, districtName, address, category, phone, email })).digest("hex");
      if (seen.has(contentHash) || hashes.has(contentHash)) continue;
      seen.add(contentHash);
      hashes.add(contentHash);
      [contentHash, stateCode ? String(stateCode) : "", stateName, districtName, title, JSON.stringify(category), address, phone, email]
        .forEach((value, index) => columns[index]?.push(value));
    }
    if (columns[0]?.length === 0) return;
    await query(
      `INSERT INTO public_utilities (
         content_hash, state_lgd_code, state_name, district_name, title, category, address, phone, email
       )
       SELECT h, NULLIF(s, '')::integer, NULLIF(sn, ''), NULLIF(dn, ''), t, c::jsonb, NULLIF(a, ''), NULLIF(p, ''), NULLIF(e, '')
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
         AS x(h, s, sn, dn, t, c, a, p, e)
       ON CONFLICT (content_hash) DO UPDATE SET
         state_lgd_code = EXCLUDED.state_lgd_code,
         state_name = EXCLUDED.state_name,
         district_name = EXCLUDED.district_name,
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         updated_at = now()`,
      columns,
    );
  }

  async function saveSlice(filters: UtilityFilter[], categories: string[]): Promise<number> {
    const first = await utilityPage(filters, categories, 1, pageSize);
    if (first.total > 9500) return first.total;
    await saveHits(first.hits);
    const pages = Math.ceil(first.total / pageSize);
    for (let page = 2; page <= pages; page += 1) {
      const next = await utilityPage(filters, categories, page, pageSize);
      if (next.hits.length === 0) break;
      await saveHits(next.hits);
    }
    return first.total;
  }

  for (const state of states) {
    const stateFilter = [{ fieldName: "state_lgd_code", fieldValue: String(state.lgd_code) }];
    const total = await saveSlice(stateFilter, []);
    if (total > 9500) {
      for (const districtCode of districtsByState.get(state.lgd_code) ?? []) {
        const districtTotal = await saveSlice([{ fieldName: "district_lgd_code", fieldValue: String(districtCode) }], []);
        if (districtTotal > 9500) {
          for (const category of utilityCategories) {
            await saveSlice([{ fieldName: "district_lgd_code", fieldValue: String(districtCode) }], [category]);
          }
        }
      }
      for (const category of utilityCategories) await saveSlice(stateFilter, [category]);
    }
    console.log(JSON.stringify({ state: state.name_en, reported: total, stored: hashes.size }));
  }
  const removed = hashes.size >= 70000
    ? await query<{ content_hash: string }>("DELETE FROM public_utilities WHERE NOT (content_hash = ANY($1::text[])) RETURNING content_hash", [[...hashes]])
    : [];
  return { stored: hashes.size, removed: removed.length, unmappedStates: [...unmapped] };
}

async function main(): Promise<void> {
  const portals = await storePortals();
  const holidays = await storeHolidays();
  const utilities = await storeUtilities();
  console.log(JSON.stringify({ portals, holidays, utilities: { stored: utilities.stored, removed: utilities.removed, unmappedStates: utilities.unmappedStates } }));
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exitCode = 1;
});
