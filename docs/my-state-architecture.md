# My State architecture

Sprint 1 records what already exists and adds the civic tables the dashboard still lacks. The running API is `backend/node`. It applies `backend/node/src/schema.sql` on startup. `apps/api` and `apps/web` are skeletons and are not on this path. The admin UI is the Vue app in `admin/`. The member app is Flutter in `mobile/`.

## Reused tables

| Need | Existing table |
| --- | --- |
| States and union territories | `lgd_states` |
| Districts, sub-districts, villages | `lgd_districts`, `lgd_sub_districts`, `lgd_villages` |
| Member home state | `employee_profiles.state_lgd_code` |
| Lok Sabha constituencies and results | `lok_sabha_constituencies`, `lok_sabha_candidates`, `lok_sabha_results` |
| Assembly segment votes | `assembly_segments`, `assembly_segment_votes` |
| Constituency winners already imported | `constituency_election_results` |
| Party abbreviations from the Lok Sabha list | `lok_sabha_parties` |
| ECI statistical workbooks | `election_statistical_reports` and related file, sheet, and row tables |
| Scheme catalog and state links | `scheme_catalogs`, `state_scheme_links`, `government_schemes` |
| Places, food, products, facts | `explore_places`, `explore_dishes`, `explore_odop_products`, `explore_fact_topics` |
| Polls | `polls` and ballot tables |
| Staff actions | `audit_logs`, `admin_roles` |

Do not add a second states table. Mandals, taluks, tehsils, and blocks are not the same unit, and this schema does not collapse them into `lgd_sub_districts`.

## New tables

`civic_sources`, `civic_elections`, `civic_election_party_seats`, `civic_parties`, `civic_party_state_units`, `civic_governments`, `civic_manifestos`, `civic_promises`, `civic_promise_reviews`, `civic_budgets`, and `civic_import_jobs`.

Public reads must use `publication_status = 'published'`. Draft and review rows stay out of the member API. A promise status change is written to `civic_promise_reviews` with an evidence summary. No seed rows invent a chief minister, a seat total, a benefit amount, or a manifesto promise.

## Still not in this sprint

Public dashboard endpoints, the Flutter My State layout, the Next.js state pages, the admin import center, and scheduled sync. Those wait until published rows exist to return. Empty states are the correct response until a reviewer publishes a sourced record.
