<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";

interface ReportRow {
  id: string;
  sectionLabel: string;
  stateName: string | null;
  label: string;
  url: string | null;
  sourceUrl: string;
  fileCount: number;
}
interface SectionFacet {
  section: string;
  label: string;
  count: number;
}
interface ReportPage {
  items: ReportRow[];
  total: number;
  page: number;
  pageCount: number;
  sections: SectionFacet[];
  jurisdictions: string[];
}

const route = useRoute();
const router = useRouter();
const pageData = ref<ReportPage | null>(null);
const error = ref("");
const loading = ref(false);
const section = ref("");
const jurisdiction = ref("");
const search = ref("");

const sourceUrl = computed(() => pageData.value?.items[0]?.sourceUrl ?? "https://www.eci.gov.in/statistical-reports");

function textQuery(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function load(): Promise<void> {
  error.value = "";
  loading.value = true;
  try {
    const query = new URLSearchParams({ page: textQuery(route.query.page) || "1", pageSize: "50" });
    if (textQuery(route.query.section)) query.set("section", textQuery(route.query.section));
    if (textQuery(route.query.jurisdiction)) query.set("jurisdiction", textQuery(route.query.jurisdiction));
    if (textQuery(route.query.search)) query.set("search", textQuery(route.query.search));
    pageData.value = await api<ReportPage>(`/api/v1/admin/election-reports?${query.toString()}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load election reports.";
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  const query: Record<string, string> = {};
  if (section.value) query.section = section.value;
  if (jurisdiction.value) query.jurisdiction = jurisdiction.value;
  if (search.value.trim()) query.search = search.value.trim();
  void router.push({ path: "/elections", query });
}

function go(page: number): void {
  void router.push({ path: "/elections", query: { ...route.query, page: page > 1 ? String(page) : undefined } });
}

watch(() => route.query, () => {
  section.value = textQuery(route.query.section);
  jurisdiction.value = textQuery(route.query.jurisdiction);
  search.value = textQuery(route.query.search);
  void load();
}, { immediate: false });

onMounted(() => {
  section.value = textQuery(route.query.section);
  jurisdiction.value = textQuery(route.query.jurisdiction);
  search.value = textQuery(route.query.search);
  void load();
});
</script>

<template>
  <section>
    <h1>Statistical reports</h1>
    <p class="banner">
      Election Commission of India statistical reports and the files listed on each page.
      Source: <a :href="sourceUrl" target="_blank" rel="noreferrer">{{ sourceUrl }}</a>
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <form class="filters" @submit.prevent="applyFilters">
      <label>
        Election
        <select v-model="section">
          <option value="">All elections</option>
          <option v-for="item in pageData?.sections ?? []" :key="item.section" :value="item.section">
            {{ item.label }} ({{ item.count }})
          </option>
        </select>
      </label>
      <label>
        State
        <select v-model="jurisdiction">
          <option value="">All states</option>
          <option v-for="name in pageData?.jurisdictions ?? []" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label>
        Search
        <input v-model="search" type="search" placeholder="Report name" />
      </label>
      <button type="submit">Filter</button>
    </form>
    <p v-if="loading">Loading…</p>
    <template v-else>
      <p>{{ pageData?.total ?? 0 }} reports</p>
      <table>
        <thead>
          <tr><th>Election</th><th>State</th><th>Report</th><th>Files</th><th>Source</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in pageData?.items ?? []" :key="row.id">
            <td>{{ row.sectionLabel }}</td>
            <td>{{ row.stateName || "—" }}</td>
            <td><router-link class="signout" :to="`/elections/${row.id}`">{{ row.label }}</router-link></td>
            <td><router-link class="signout" :to="`/elections/${row.id}`">{{ row.fileCount }}</router-link></td>
            <td>
              <a v-if="row.url" class="signout" :href="row.url" target="_blank" rel="noreferrer">Open</a>
              <span v-else>No file on ECI page</span>
            </td>
          </tr>
          <tr v-if="(pageData?.items.length ?? 0) === 0"><td colspan="5">No reports match these filters.</td></tr>
        </tbody>
      </table>
      <div v-if="(pageData?.pageCount ?? 1) > 1" class="pager">
        <button class="secondary" type="button" :disabled="(pageData?.page ?? 1) <= 1" @click="go((pageData?.page ?? 1) - 1)">Previous</button>
        <span>Page {{ pageData?.page }} of {{ pageData?.pageCount }}</span>
        <button class="secondary" type="button" :disabled="(pageData?.page ?? 1) >= (pageData?.pageCount ?? 1)" @click="go((pageData?.page ?? 1) + 1)">Next</button>
      </div>
    </template>
  </section>
</template>
