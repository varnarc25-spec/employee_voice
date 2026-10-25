import { pool, query } from "./db.js";

const origin = "https://www.india.gov.in";

type ServiceHit = {
  title?: string;
  owner?: string;
  description?: string;
  maturity?: string;
  imageUrl?: string | null;
  npiAlias?: string;
  url?: string;
  keywords?: unknown;
  serviceKeywordOld?: unknown;
  npiMinistryDepartment?: unknown;
  npiStateDepartment?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
}

function placeKey(value: string): string {
  return value.toLowerCase().replace(/\s*\((ut|nct)\)\s*$/i, "").replace(/&/g, " and ").replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();
}

async function post(body: unknown): Promise<unknown> {
  const response = await fetch(`${origin}/services/api`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", origin },
    body: JSON.stringify({ dataval: body }),
  });
  if (!response.ok) throw new Error(`Services API failed: ${response.status}`);
  return response.json();
}

async function servicePage(owner: "Central" | "State", stateName: string | null, page: number): Promise<{ total: number; hits: ServiceHit[] }> {
  const params = new URLSearchParams({ fieldName: stateName ? "npiStateDepartment" : "owner", fieldValue: stateName ?? owner, pageNumber: String(page), pageSize: "500" });
  const path = owner === "Central" ? "/services/ministry/services/getministryServices" : "/services/state/services/getstateServices";
  const response = await fetch(`${origin}${path}?${params}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  const body = await response.json() as { result?: { data?: { getServicesbyCategory?: { total?: number; results?: { servicesList?: ServiceHit[] } } } } };
  const list = body.result?.data?.getServicesbyCategory;
  if (!list) return { total: 0, hits: [] };
  return { total: list.total ?? 0, hits: list.results?.servicesList ?? [] };
}

async function main(): Promise<void> {
  const states = await query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_states");
  const stateByName = new Map(states.map((state) => [placeKey(state.name_en), state.lgd_code]));
  const categories = await post({ querytype: "getAllCategory", variables: { npiFilter: [] } }) as {
    resultdata?: { data?: { getAllCategory?: { results?: { id?: string; npiAlias?: string; title?: string }[] } } };
  };
  for (const category of categories.resultdata?.data?.getAllCategory?.results ?? []) {
    if (!category.id || !category.npiAlias || !category.title) continue;
    await query(
      `INSERT INTO government_service_categories (source_id, alias, title)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_id) DO UPDATE SET alias = EXCLUDED.alias, title = EXCLUDED.title, updated_at = now()`,
      [category.id, category.npiAlias, category.title],
    );
  }

  const flagship = new Set<string>();
  let flagPage = 1;
  let flagTotal = 1;
  while ((flagPage - 1) * 100 < flagTotal) {
    const body = await post({ querytype: "getFlagship", variables: { npiFilter: [], pageNumber: flagPage, pageSize: 100 } }) as {
      resultdata?: { data?: { getFlagship?: { total?: number; results?: { npiAlias?: string }[] } } };
    };
    const list = body.resultdata?.data?.getFlagship;
    flagTotal = list?.total ?? 0;
    for (const item of list?.results ?? []) if (item.npiAlias) flagship.add(item.npiAlias);
    flagPage += 1;
  }

  const aliases = new Set<string>();
  async function save(owner: "Central" | "State", stateName: string | null): Promise<number> {
    const first = await servicePage(owner, stateName, 1);
    const pages = Math.min(20, Math.max(1, Math.ceil(first.total / 500)));
    for (let page = 1; page <= pages; page += 1) {
      const batch = page === 1 ? first : await servicePage(owner, stateName, page);
      if (batch.hits.length === 0) break;
      const columns: string[][] = [[], [], [], [], [], [], [], [], [], [], [], []];
      for (const hit of batch.hits) {
        const alias = text(hit.npiAlias);
        const title = text(hit.title);
        if (!alias || !title || aliases.has(alias)) continue;
        aliases.add(alias);
        const stateNames = names(hit.npiStateDepartment);
        const matched = [...new Set(stateNames.map((name) => stateByName.get(placeKey(name))).filter((code): code is number => Boolean(code)))];
        const values = [
          alias,
          title,
          text(hit.description) ?? "",
          text(hit.url) ?? "",
          `${origin}/services/details/${alias}`,
          text(hit.maturity) ?? "",
          text(hit.owner) ?? owner,
          JSON.stringify(names(hit.npiMinistryDepartment)),
          JSON.stringify(stateNames),
          matched.length === 1 ? String(matched[0]) : "",
          JSON.stringify([...names(hit.keywords), ...names(hit.serviceKeywordOld)]),
          text(hit.imageUrl) ?? "",
        ];
        values.forEach((value, index) => columns[index]?.push(value));
      }
      if ((columns[0]?.length ?? 0) === 0) continue;
      await query(
        `INSERT INTO government_services (
           alias, title, description, service_url, page_url, maturity, owner, ministries, state_names, state_lgd_code, keywords, image_url, is_flagship
         )
         SELECT alias, title, NULLIF(description, ''), NULLIF(service_url, ''), page_url, NULLIF(maturity, ''), owner, ministries::jsonb, state_names::jsonb, NULLIF(state_code, '')::integer, keywords::jsonb, NULLIF(image_url, ''), alias = ANY($13::text[])
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[])
           AS x(alias, title, description, service_url, page_url, maturity, owner, ministries, state_names, state_code, keywords, image_url)
         ON CONFLICT (alias) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           service_url = EXCLUDED.service_url,
           page_url = EXCLUDED.page_url,
           maturity = EXCLUDED.maturity,
           owner = EXCLUDED.owner,
           ministries = EXCLUDED.ministries,
           state_names = EXCLUDED.state_names,
           state_lgd_code = EXCLUDED.state_lgd_code,
           keywords = EXCLUDED.keywords,
           image_url = EXCLUDED.image_url,
           is_flagship = EXCLUDED.is_flagship,
           updated_at = now()`,
        [...columns, [...flagship]],
      );
    }
    return first.total;
  }

  const central = await save("Central", null);
  console.log(JSON.stringify({ owner: "Central", reported: central, stored: aliases.size }));
  const stateCatalog = await save("State", null);
  console.log(JSON.stringify({ owner: "State", reported: stateCatalog, stored: aliases.size }));
  const serviceNames = new Map<string, string>([["The Dadra And Nagar Haveli And Daman And Diu", "Dadra and Nagar Haveli and Daman and Diu"]]);
  for (const state of states) {
    const reported = await save("State", serviceNames.get(state.name_en) ?? state.name_en);
    console.log(JSON.stringify({ state: state.name_en, reported, stored: aliases.size }));
  }
  await query("UPDATE government_services SET is_flagship = alias = ANY($1::text[])", [[...flagship]]);

  const links = await post({ querytype: "getServicesLinks" }) as {
    resultdata?: { data?: { getServicesLinks?: { data?: { id?: string; attributes?: { title?: string; redirect_url?: string; Links?: { id?: number; title?: string; redirect_url?: string }[] } }[] } } };
  };
  const linkIds: string[] = [];
  for (const group of links.resultdata?.data?.getServicesLinks?.data ?? []) {
    const groupTitle = text(group.attributes?.title);
    const groupUrl = text(group.attributes?.redirect_url);
    if (!group.id || !groupTitle || !groupUrl) continue;
    linkIds.push(`group:${group.id}`);
    await query(
      `INSERT INTO government_service_links (source_id, group_title, title, page_url)
       VALUES ($1, $2, $2, $3)
       ON CONFLICT (source_id) DO UPDATE SET group_title = EXCLUDED.group_title, title = EXCLUDED.title, page_url = EXCLUDED.page_url, updated_at = now()`,
      [`group:${group.id}`, groupTitle, groupUrl.startsWith("http") ? groupUrl : `${origin}${groupUrl}`],
    );
    for (const link of group.attributes?.Links ?? []) {
      const title = text(link.title);
      const url = text(link.redirect_url);
      if (!link.id || !title || !url) continue;
      linkIds.push(`link:${link.id}`);
      await query(
        `INSERT INTO government_service_links (source_id, group_title, title, page_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_id) DO UPDATE SET group_title = EXCLUDED.group_title, title = EXCLUDED.title, page_url = EXCLUDED.page_url, updated_at = now()`,
        [`link:${link.id}`, groupTitle, title, url.startsWith("http") ? url : `${origin}${url}`],
      );
    }
  }
  await query("DELETE FROM government_services WHERE NOT (alias = ANY($1::text[]))", [[...aliases]]);
  await query("DELETE FROM government_service_links WHERE NOT (source_id = ANY($1::text[]))", [linkIds]);
  console.log(JSON.stringify({ services: aliases.size, flagship: flagship.size, links: linkIds.length }));
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exitCode = 1;
});
