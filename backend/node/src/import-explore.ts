import { pool, query } from "./db.js";

const origin = "https://www.india.gov.in";

const hindiStates: Record<string, string> = {
  राजस्थान: "Rajasthan",
  "उत्तर प्रदेश": "Uttar Pradesh",
  "मध्य प्रदेश": "Madhya Pradesh",
  महाराष्ट्र: "Maharashtra",
  गुजरात: "Gujarat",
  बिहार: "Bihar",
  झारखंड: "Jharkhand",
  उत्तराखंड: "Uttarakhand",
  "हिमाचल प्रदेश": "Himachal Pradesh",
  हरियाणा: "Haryana",
  पंजाब: "Punjab",
  कर्नाटक: "Karnataka",
  केरल: "Kerala",
  "तमिल नाडु": "Tamil Nadu",
  तेलंगाना: "Telangana",
  "आंध्र प्रदेश": "Andhra Pradesh",
  "आन्ध्र प्रदेश": "Andhra Pradesh",
  ओडिशा: "Odisha",
  छत्तीसगढ़: "Chhattisgarh",
  असम: "Assam",
  "पश्चिम बंगाल": "West Bengal",
  गोवा: "Goa",
  सिक्किम: "Sikkim",
  मणिपुर: "Manipur",
  मेघालय: "Meghalaya",
  मिजोरम: "Mizoram",
  नागालैंड: "Nagaland",
  त्रिपुरा: "Tripura",
  "अरुणाचल प्रदेश": "Arunachal Pradesh",
};

const facts: { path: string; title: string; group: string }[] = [
  { path: "/explore-india/facts-of-india/india-at-a-glance", title: "India at a glance", group: "Facts of India" },
  { path: "/explore-india/facts-of-india/demographic-background", title: "Demographic background", group: "Facts of India" },
  { path: "/explore-india/facts-of-india/states-ut-districts", title: "States, UTs and districts", group: "Facts of India" },
  { path: "/explore-india/facts-of-india/independence-day", title: "Independence Day", group: "Facts of India" },
  { path: "/explore-india/facts-of-india/republic-day", title: "Republic Day", group: "Facts of India" },
  { path: "/explore-india/facts-of-india/national-identity", title: "National identity", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/national-flag", title: "National flag", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/state-emblem", title: "State emblem", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/national-anthem", title: "National anthem", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/national-song", title: "National song", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/national-calendar", title: "National calendar", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/national-animal", title: "National animal", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/national-bird", title: "National bird", group: "National identity" },
  { path: "/explore-india/facts-of-india/national-identity/currency-symbol", title: "Currency symbol", group: "National identity" },
  { path: "/explore-india/facts-of-india/physical-background/physical-features", title: "Physical features", group: "Physical background" },
  { path: "/explore-india/facts-of-india/physical-background/geological-structure", title: "Geological structure", group: "Physical background" },
  { path: "/explore-india/facts-of-india/physical-background/rivers", title: "Rivers", group: "Physical background" },
  { path: "/explore-india/facts-of-india/physical-background/climate", title: "Climate", group: "Physical background" },
  { path: "/explore-india/facts-of-india/physical-background/flora", title: "Flora", group: "Physical background" },
  { path: "/explore-india/facts-of-india/physical-background/fauna", title: "Fauna", group: "Physical background" },
  { path: "/explore-india/facts-of-india/the-polity/the-union", title: "The Union", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/the-states", title: "The states", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/union-territories", title: "Union territories", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/citizenship", title: "Citizenship", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/fundamental-rights", title: "Fundamental rights", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/fundamental-duties", title: "Fundamental duties", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/directive-principle-of-state-policy", title: "Directive principles", group: "The polity" },
  { path: "/explore-india/facts-of-india/the-polity/local-government", title: "Local government", group: "The polity" },
];

function placeKey(value: string): string {
  return value
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(/^the\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

async function main(): Promise<void> {
  const states = await query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_states");
  const byName = new Map(states.map((row) => [placeKey(row.name_en), row.lgd_code]));
  const unmapped = new Set<string>();
  function stateCode(name: string | null | undefined): number | null {
    const raw = (name ?? "").trim();
    if (!raw) return null;
    const english = hindiStates[raw] ?? raw;
    const code = byName.get(placeKey(english));
    if (!code) unmapped.add(raw);
    return code ?? null;
  }

  const placeIds: string[] = [];
  let placePage = 1;
  let placeTotal = 0;
  for (;;) {
    const payload = await post("/explore-india/travel-and-tourism/service", {
      termMatches: [], npiFilters: [], categories: [], pageNumber: placePage, pageSize: 200,
    }) as { result: { data: { getTouristAggregation: { total: number; results: { touristHits: Record<string, unknown>[] } } } } };
    const block = payload.result.data.getTouristAggregation;
    placeTotal = block.total;
    const hits = block.results?.touristHits ?? [];
    if (hits.length === 0) break;
    for (const hit of hits) {
      const id = String(hit.id ?? "");
      if (!id || placeIds.includes(id)) continue;
      placeIds.push(id);
      const alias = hit.npiAlias ? String(hit.npiAlias) : null;
      const stateName = hit.stateName ? String(hit.stateName).trim() : null;
      await query(
        `INSERT INTO explore_places (source_id, title, state_name, state_lgd_code, district_name, categories, image_url, page_url, external_url, alias)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
         ON CONFLICT (source_id) DO UPDATE SET title = EXCLUDED.title, state_name = EXCLUDED.state_name, state_lgd_code = EXCLUDED.state_lgd_code,
           district_name = EXCLUDED.district_name, categories = EXCLUDED.categories, image_url = EXCLUDED.image_url, page_url = EXCLUDED.page_url,
           external_url = EXCLUDED.external_url, alias = EXCLUDED.alias, updated_at = now()`,
        [
          id,
          String(hit.title ?? "").trim(),
          stateName,
          stateCode(stateName),
          hit.districtName ? String(hit.districtName).trim() : null,
          JSON.stringify(Array.isArray(hit.placeCategoryName) ? hit.placeCategoryName : []),
          hit.image ? String(hit.image) : null,
          alias ? `${origin}/explore-india/travel-and-tourism/details/${alias}` : null,
          hit.url ? String(hit.url) : null,
          alias,
        ],
      );
    }
    if (placePage * 200 >= placeTotal || placePage >= 30) break;
    placePage += 1;
  }

  const dishIds: string[] = [];
  let dishPage = 1;
  let dishTotal = 0;
  for (;;) {
    const payload = await post("/explore-india/culinary-delights/service", {
      termMatches: [], categories: [], pageNumber: dishPage, pageSize: 200,
    }) as { result: { data: { getCulinaryAggregation: { total: number; results: { culinaryHits: Record<string, unknown>[] } } } } };
    const block = payload.result.data.getCulinaryAggregation;
    dishTotal = block.total;
    const hits = block.results?.culinaryHits ?? [];
    if (hits.length === 0) break;
    for (const hit of hits) {
      const id = String(hit.id ?? "");
      if (!id || dishIds.includes(id)) continue;
      dishIds.push(id);
      const alias = hit.npiAlias ? String(hit.npiAlias) : null;
      const stateName = hit.stateName ? String(hit.stateName).trim() : null;
      await query(
        `INSERT INTO explore_dishes (source_id, title, state_name, state_lgd_code, district_name, categories, image_url, page_url, external_url, alias)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
         ON CONFLICT (source_id) DO UPDATE SET title = EXCLUDED.title, state_name = EXCLUDED.state_name, state_lgd_code = EXCLUDED.state_lgd_code,
           district_name = EXCLUDED.district_name, categories = EXCLUDED.categories, image_url = EXCLUDED.image_url, page_url = EXCLUDED.page_url,
           external_url = EXCLUDED.external_url, alias = EXCLUDED.alias, updated_at = now()`,
        [
          id, String(hit.title ?? "").trim(), stateName, stateCode(stateName),
          hit.districtName ? String(hit.districtName).trim() : null,
          JSON.stringify(Array.isArray(hit.placeCategoryName) ? hit.placeCategoryName : []),
          hit.image ? String(hit.image) : null,
          alias ? `${origin}/explore-india/culinary-delights/details/${alias}` : null,
          hit.url ? String(hit.url) : null,
          alias,
        ],
      );
    }
    if (dishPage * 200 >= dishTotal || dishPage >= 10) break;
    dishPage += 1;
  }

  const sectors = await fetch(`${origin}/explore-india/odop/getodopsectors`).then((response) => response.json()) as {
    result: { data: { getSector: { results: { sectorId: number; sectorName: string }[] } } };
  };
  for (const sector of sectors.result.data.getSector.results) {
    await query(
      `INSERT INTO explore_odop_sectors (sector_id, sector_name) VALUES ($1, $2)
       ON CONFLICT (sector_id) DO UPDATE SET sector_name = EXCLUDED.sector_name, updated_at = now()`,
      [sector.sectorId, sector.sectorName],
    );
  }

  const productIds: string[] = [];
  let productPage = 1;
  let productTotal = 0;
  for (;;) {
    const payload = await post("/explore-india/odop/getodopproducts", {
      mustFilter: [], shouldFilter: [], pageNumber: productPage, pageSize: 200,
    }) as { result: { data: { getProductByFilter: { total: number; results: Record<string, unknown>[] } } } };
    const block = payload.result.data.getProductByFilter;
    productTotal = block.total;
    if (block.results.length === 0) break;
    for (const hit of block.results) {
      const id = String(hit.docId ?? hit.alias ?? "");
      if (!id || productIds.includes(id)) continue;
      productIds.push(id);
      const alias = hit.alias ? String(hit.alias) : null;
      const stateName = hit.stateName ? String(hit.stateName).trim() : null;
      const sector = hit.odopSector as { sectorId?: number; sectorName?: string } | null;
      await query(
        `INSERT INTO explore_odop_products (source_id, title, description, state_name, state_lgd_code, district_name, sector_id, sector_name, category, gi_status, image_url, page_url, gem_links, alias)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
         ON CONFLICT (source_id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, state_name = EXCLUDED.state_name,
           state_lgd_code = EXCLUDED.state_lgd_code, district_name = EXCLUDED.district_name, sector_id = EXCLUDED.sector_id, sector_name = EXCLUDED.sector_name,
           category = EXCLUDED.category, gi_status = EXCLUDED.gi_status, image_url = EXCLUDED.image_url, page_url = EXCLUDED.page_url, gem_links = EXCLUDED.gem_links,
           alias = EXCLUDED.alias, updated_at = now()`,
        [
          id, String(hit.title ?? "").trim(), hit.description ? String(hit.description) : null, stateName, stateCode(stateName),
          hit.districtName ? String(hit.districtName).trim() : null,
          sector?.sectorId ?? null, sector?.sectorName ?? null,
          hit.odopCategory ? String(hit.odopCategory) : null,
          Boolean(hit.gi_status),
          hit.imageUrl ? String(hit.imageUrl) : null,
          alias ? `${origin}/explore-india/odop/details/${alias}` : null,
          JSON.stringify(Array.isArray(hit.gemLink) ? hit.gemLink : []),
          alias,
        ],
      );
    }
    if (productPage * 200 >= productTotal || productPage >= 15) break;
    productPage += 1;
  }

  const factPaths: string[] = [];
  for (const fact of facts) {
    factPaths.push(fact.path);
    await query(
      `INSERT INTO explore_fact_topics (path, title, group_title, page_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (path) DO UPDATE SET title = EXCLUDED.title, group_title = EXCLUDED.group_title, page_url = EXCLUDED.page_url, updated_at = now()`,
      [fact.path, fact.title, fact.group, `${origin}${fact.path}`],
    );
  }

  if (placeIds.length > 3000) await query("DELETE FROM explore_places WHERE NOT (source_id = ANY($1::text[]))", [placeIds]);
  if (dishIds.length >= dishTotal && dishTotal > 0) await query("DELETE FROM explore_dishes WHERE NOT (source_id = ANY($1::text[]))", [dishIds]);
  if (productIds.length >= productTotal && productTotal > 0) await query("DELETE FROM explore_odop_products WHERE NOT (source_id = ANY($1::text[]))", [productIds]);
  await query("DELETE FROM explore_fact_topics WHERE NOT (path = ANY($1::text[]))", [factPaths]);

  console.log(JSON.stringify({
    places: { reported: placeTotal, stored: placeIds.length },
    dishes: { reported: dishTotal, stored: dishIds.length },
    sectors: sectors.result.data.getSector.results.length,
    products: { reported: productTotal, stored: productIds.length },
    facts: factPaths.length,
    unmappedStates: [...unmapped],
  }));
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
