import { pool, query } from "./db.js";

const searchUrl = "https://reports.myscheme.gov.in/api/apisetu/search/schemes";

type SchemeFields = {
  slug?: string;
  schemeName?: string;
  schemeShortTitle?: string;
  nodalDepartmentName?: string;
  nodalMinistryName?: string;
  schemeCategory?: unknown;
  briefDescription?: string;
  tags?: unknown;
  schemeCloseDate?: string | null;
  level?: string;
  beneficiaryState?: unknown;
};

type SearchPage = {
  data?: {
    hits?: {
      page?: { total?: number; size?: number };
      items?: { fields?: SchemeFields }[];
    };
  };
};

type SchemeRow = {
  stateCode: number | null;
  slug: string;
  name: string;
  shortTitle: string | null;
  department: string | null;
  ministry: string | null;
  category: unknown[];
  description: string | null;
  tags: unknown[];
  closeDate: string | null;
  level: string;
};

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function catalog(): Promise<SchemeFields[]> {
  const found: SchemeFields[] = [];
  let from = 0;
  let total = 1;
  while (from < total) {
    const url = new URL(searchUrl);
    url.searchParams.set("lang", "en");
    url.searchParams.set("q", "[]");
    url.searchParams.set("keyword", "");
    url.searchParams.set("sort", "");
    url.searchParams.set("from", String(from));
    url.searchParams.set("size", "100");
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetch(url, {
        headers: { accept: "application/json", referer: "https://reports.myscheme.gov.in/search" },
      });
      if (response.ok) break;
      if (attempt === 3) throw new Error(`Scheme catalog failed at ${from}: ${response.status}`);
    }
    const body = await response!.json() as SearchPage;
    const hits = body.data?.hits;
    const items = hits?.items ?? [];
    total = hits?.page?.total ?? found.length;
    if (items.length === 0) break;
    found.push(...items.map((item) => item.fields ?? {}));
    from += hits?.page?.size || items.length;
  }
  return found;
}

async function save(row: SchemeRow): Promise<void> {
  const values = [
    row.stateCode,
    row.slug,
    row.name,
    row.shortTitle,
    row.department,
    row.ministry,
    JSON.stringify(row.category),
    row.description,
    JSON.stringify(row.tags),
    row.closeDate,
    row.level,
    `https://www.myscheme.gov.in/schemes/${row.slug}`,
  ];
  const sql = row.stateCode === null
    ? `INSERT INTO government_schemes (
         state_lgd_code, slug, scheme_name, short_title, department_name, ministry_name,
         category, description, tags, close_date, level, scheme_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12)
       ON CONFLICT (slug) WHERE state_lgd_code IS NULL DO UPDATE SET
         scheme_name = EXCLUDED.scheme_name,
         short_title = EXCLUDED.short_title,
         department_name = EXCLUDED.department_name,
         ministry_name = EXCLUDED.ministry_name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         tags = EXCLUDED.tags,
         close_date = EXCLUDED.close_date,
         level = EXCLUDED.level,
         scheme_url = EXCLUDED.scheme_url,
         updated_at = now()`
    : `INSERT INTO government_schemes (
         state_lgd_code, slug, scheme_name, short_title, department_name, ministry_name,
         category, description, tags, close_date, level, scheme_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12)
       ON CONFLICT (state_lgd_code, slug) WHERE state_lgd_code IS NOT NULL DO UPDATE SET
         scheme_name = EXCLUDED.scheme_name,
         short_title = EXCLUDED.short_title,
         department_name = EXCLUDED.department_name,
         ministry_name = EXCLUDED.ministry_name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         tags = EXCLUDED.tags,
         close_date = EXCLUDED.close_date,
         level = EXCLUDED.level,
         scheme_url = EXCLUDED.scheme_url,
         updated_at = now()`;
  await query(sql, values);
}

async function main(): Promise<void> {
  const states = await query<{ lgd_code: number; source_name: string }>(
    "SELECT state_lgd_code AS lgd_code, source_name FROM state_scheme_links",
  );
  const stateByName = new Map(states.map((state) => [state.source_name, state.lgd_code]));
  const items = await catalog();
  const stateSlugs = new Map<number, Set<string>>();
  for (const state of states) stateSlugs.set(state.lgd_code, new Set());
  const centralSlugs = new Set<string>();
  const unmapped = new Set<string>();
  let stored = 0;
  for (const scheme of items) {
    const slug = text(scheme.slug);
    const name = text(scheme.schemeName);
    if (!slug || !name) continue;
    const beneficiaries = list(scheme.beneficiaryState).map((value) => text(value)).filter((value): value is string => Boolean(value));
    const statesNamed = beneficiaries.filter((value) => value !== "All");
    const level = text(scheme.level) ?? "State";
    const rowBase = {
      slug,
      name,
      shortTitle: text(scheme.schemeShortTitle),
      department: text(scheme.nodalDepartmentName),
      ministry: text(scheme.nodalMinistryName),
      category: list(scheme.schemeCategory),
      description: text(scheme.briefDescription),
      tags: list(scheme.tags),
      closeDate: text(scheme.schemeCloseDate),
      level,
    };
    if (level === "Central" || statesNamed.length === 0) {
      await save({ ...rowBase, stateCode: null });
      centralSlugs.add(slug);
      stored += 1;
      continue;
    }
    for (const stateName of statesNamed) {
      const stateCode = stateByName.get(stateName);
      if (!stateCode) {
        unmapped.add(stateName);
        continue;
      }
      await save({ ...rowBase, stateCode });
      stateSlugs.get(stateCode)?.add(slug);
      stored += 1;
    }
  }
  let removed = 0;
  for (const [stateCode, slugs] of stateSlugs) {
    const gone = await query<{ slug: string }>(
      `DELETE FROM government_schemes
       WHERE state_lgd_code = $1 AND NOT (slug = ANY($2::text[]))
       RETURNING slug`,
      [stateCode, [...slugs]],
    );
    removed += gone.length;
  }
  const goneCentral = await query<{ slug: string }>(
    `DELETE FROM government_schemes
     WHERE state_lgd_code IS NULL AND NOT (slug = ANY($1::text[]))
     RETURNING slug`,
    [[...centralSlugs]],
  );
  removed += goneCentral.length;
  const counts = await query<{ level: string; rows: number }>(
    "SELECT COALESCE(level, 'unknown') AS level, count(*)::int AS rows FROM government_schemes GROUP BY level ORDER BY level",
  );
  console.log(JSON.stringify({
    catalog: items.length,
    stored,
    removed,
    central: centralSlugs.size,
    unmapped: [...unmapped],
    counts,
  }));
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exitCode = 1;
});
