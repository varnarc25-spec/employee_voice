import { pool, query } from "./db.js";

const origin = "https://www.india.gov.in";
const webCategories = [
  ["sg", "State / UT Government"],
  ["ug", "Union Government"],
  ["jud", "Judiciary"],
  ["leg", "Legislature"],
  ["int", "Indian Missions Abroad"],
  ["apx", "Apex Bodies"],
] as const;
const contactTypes = [
  ["E002", "Ministries"],
  ["E003", "Departments"],
  ["E053", "Independent Departments"],
] as const;

type DirectoryRow = {
  sourceId: string;
  category: string;
  organizationType: string | null;
  title: string;
  stateCode: number | null;
  stateName: string | null;
  stateId: string | null;
  website: string | null;
  contact: string | null;
  alias: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function post(path: string, body: unknown, headers?: Record<string, string>): Promise<unknown> {
  let response: Response | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", origin, ...headers },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    if (attempt === 3) throw new Error(`${path} failed: ${response.status}`);
  }
  throw new Error(path);
}

async function saveWeb(rows: DirectoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = rows.reduce<string[][]>((lists, row) => {
    [row.sourceId, row.category, row.organizationType ?? "", row.title, row.stateCode ? String(row.stateCode) : "", row.stateName ?? "", row.stateId ?? "", row.website ?? "", row.contact ?? "", row.alias ?? ""]
      .forEach((value, index) => lists[index]?.push(value));
    return lists;
  }, [[], [], [], [], [], [], [], [], [], []]);
  await query(
    `INSERT INTO web_directory_entries (
       source_id, category, organization_type, title, state_lgd_code, state_name, state_code, website_url, contact_url, alias
     )
     SELECT id, category, NULLIF(kind, ''), title, NULLIF(state_code, '')::integer, NULLIF(state_name, ''), NULLIF(state_id, ''), NULLIF(website, ''), NULLIF(contact, ''), NULLIF(alias, '')
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
       AS x(id, category, kind, title, state_code, state_name, state_id, website, contact, alias)
     ON CONFLICT (source_id) DO UPDATE SET
       category = EXCLUDED.category,
       organization_type = EXCLUDED.organization_type,
       title = EXCLUDED.title,
       state_lgd_code = EXCLUDED.state_lgd_code,
       state_name = EXCLUDED.state_name,
       state_code = EXCLUDED.state_code,
       website_url = EXCLUDED.website_url,
       contact_url = EXCLUDED.contact_url,
       alias = EXCLUDED.alias,
       updated_at = now()`,
    columns,
  );
}

async function main(): Promise<void> {
  const portals = await query<{ state_lgd_code: number; state_code: string | null }>("SELECT state_lgd_code, state_code FROM state_government_portals");
  const stateByCode = new Map(portals.filter((row) => row.state_code).map((row) => [row.state_code as string, row.state_lgd_code]));
  const webIds = new Set<string>();
  for (const [category] of webCategories) {
    let page = 1;
    let total = 1;
    while ((page - 1) * 500 < total) {
      const body = await post("/directory/web-directory/api", {
        dataval: {
          clientvalue: "client",
          mustvalue: [{ fieldName: "category", fieldValue: category }],
          pageno: page,
          pageSize: 500,
          shouldvalue: [],
          querytype: "WebdirectoryCategorydetalsList",
        },
      }) as { resultdata?: { data?: { getIgodWebDirectoryByFilters?: { total?: number; results?: Record<string, unknown>[] } } } };
      const list = body.resultdata?.data?.getIgodWebDirectoryByFilters;
      const results = list?.results ?? [];
      total = list?.total ?? 0;
      if (results.length === 0) break;
      const rows: DirectoryRow[] = [];
      for (const item of results) {
        const sourceId = text(item.npi_sanitized_id);
        const title = text(item.title);
        if (!sourceId || !title || webIds.has(sourceId)) continue;
        webIds.add(sourceId);
        const stateId = text(item.state_id);
        rows.push({
          sourceId,
          category,
          organizationType: text(item.organization_type),
          title,
          stateCode: stateId ? stateByCode.get(stateId) ?? null : null,
          stateName: text(item.stateName),
          stateId,
          website: text(item.url),
          contact: text(item.url_1),
          alias: text(item.npiAlias),
        });
      }
      await saveWeb(rows);
      console.log(JSON.stringify({ category, page, total, stored: webIds.size }));
      page += 1;
    }
  }

  const states = await query<{ lgd_code: number }>("SELECT lgd_code FROM lgd_states ORDER BY sort_order");
  for (const state of states) {
    const body = await post("/alldistrictigodservice", {
      mustFilter: [{ fieldName: "state_lgd_code", fieldValue: String(state.lgd_code) }],
      pageSize: 200,
      pageNumber: 1,
    }, { "x-aa-key": "830af17e315924228e1ab008f3476b8bc530d1c859ab24159a75d7d628400671" }) as {
      result?: { data?: { getIgodDistrict?: { total?: number; results?: Record<string, unknown>[] } } };
    };
    const results = body.result?.data?.getIgodDistrict?.results ?? [];
    const rows: DirectoryRow[] = [];
    for (const item of results) {
      const lgd = text(item.lgd_code);
      const title = text(item.title);
      if (!lgd || !title) continue;
      const sourceId = `district:${lgd}`;
      if (webIds.has(sourceId)) continue;
      webIds.add(sourceId);
      rows.push({
        sourceId,
        category: "dist",
        organizationType: "district",
        title,
        stateCode: state.lgd_code,
        stateName: text(item.stateName),
        stateId: text(item.state_id),
        website: text(item.url),
        contact: null,
        alias: text(item.npiAlias),
      });
    }
    await saveWeb(rows);
  }

  const contactIds: string[] = [];
  for (const [organizationType] of contactTypes) {
    let page = 1;
    let total = 1;
    let received = 0;
    while ((page - 1) * 200 < total) {
      const body = await post("/directory/contact-directory/api", {
        dataval: {
          clientvalue: "client1",
          mustvalue: [{ fieldName: "organization_type", fieldValue: organizationType }],
          from: "A",
          to: "Z",
          pageno: page,
          pageSize: 200,
          shouldvalue: [],
          querytype: "GetMinstriesAndDepartment",
        },
      }) as { resultdata?: { data?: { getCentralMinAndDept?: { total?: number; results?: Record<string, unknown>[] } } } };
      const list = body.resultdata?.data?.getCentralMinAndDept;
      const results = list?.results ?? [];
      total = list?.total ?? 0;
      if (results.length === 0) break;
      received += results.length;
      for (const item of results) {
        const sourceId = text(item.npi_sanitized_id);
        const title = text(item.title);
        const alias = text(item.npiAlias);
        if (!sourceId || !title || contactIds.includes(sourceId)) continue;
        contactIds.push(sourceId);
        await query(
          `INSERT INTO contact_directory_entries (source_id, organization_type, title, alias, page_url)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_id) DO UPDATE SET
             organization_type = EXCLUDED.organization_type,
             title = EXCLUDED.title,
             alias = EXCLUDED.alias,
             page_url = EXCLUDED.page_url,
             updated_at = now()`,
          [sourceId, text(item.organization_type) ?? organizationType, title, alias, alias ? `${origin}/directory/contact-directory/central/${alias}` : null],
        );
      }
      page += 1;
    }
    console.log(JSON.stringify({ contact: organizationType, total, received }));
  }
  await query("DELETE FROM web_directory_entries WHERE NOT (source_id = ANY($1::text[]))", [[...webIds]]);
  await query("DELETE FROM contact_directory_entries WHERE NOT (source_id = ANY($1::text[]))", [contactIds]);
  console.log(JSON.stringify({ web: webIds.size, contact: contactIds.length }));
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exitCode = 1;
});
