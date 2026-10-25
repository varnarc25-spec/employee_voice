<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";

interface SheetSummary {
  id: string;
  name: string;
  title: string | null;
  rowCount: number;
}
interface WorkbookFile {
  id: string;
  title: string;
  stateName: string | null;
  reportLabel: string;
  sectionLabel: string;
  pageHeading: string | null;
  sheets: SheetSummary[];
}
interface SheetPage {
  id: string;
  name: string;
  title: string | null;
  columns: string[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  rows: string[][];
}

const route = useRoute();
const router = useRouter();
const file = ref<WorkbookFile | null>(null);
const sheet = ref<SheetPage | null>(null);
const error = ref("");
const loadingFile = ref(false);
const loadingSheet = ref(false);
const sheetSearch = ref("");

const reportId = computed(() => String(route.params.id));
const fileId = computed(() => String(route.params.fileId));
const selectedSheetId = computed(() => (typeof route.query.sheet === "string" ? route.query.sheet : ""));
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1));
const search = computed(() => (typeof route.query.search === "string" ? route.query.search : ""));
const rowSearch = ref("");

const visibleSheets = computed(() => {
  const query = sheetSearch.value.trim().toLowerCase();
  const matches = (file.value?.sheets ?? []).filter((item) => {
    if (!query) return true;
    return item.name.toLowerCase().includes(query) || (item.title ?? "").toLowerCase().includes(query);
  });
  return { total: matches.length, items: matches.slice(0, 40) };
});

function textQuery(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function loadFile(): Promise<void> {
  error.value = "";
  loadingFile.value = true;
  sheet.value = null;
  try {
    file.value = await api<WorkbookFile>(`/api/v1/admin/election-reports/${reportId.value}/files/${fileId.value}`);
    if (file.value.sheets.length === 1 && !selectedSheetId.value) {
      await router.replace({ query: { sheet: file.value.sheets[0].id } });
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load this spreadsheet.";
  } finally {
    loadingFile.value = false;
  }
}

async function loadSheet(): Promise<void> {
  if (!selectedSheetId.value) {
    sheet.value = null;
    return;
  }
  loadingSheet.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: "50" });
    if (search.value) query.set("search", search.value);
    sheet.value = await api<SheetPage>(`/api/v1/admin/election-reports/${reportId.value}/files/${fileId.value}/sheets/${selectedSheetId.value}?${query.toString()}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load this sheet.";
  } finally {
    loadingSheet.value = false;
  }
}

function openSheet(id: string): void {
  void router.push({ query: { sheet: id } });
}

function applyRowSearch(): void {
  if (!selectedSheetId.value) return;
  const query: Record<string, string> = { sheet: selectedSheetId.value };
  const term = rowSearch.value.trim();
  if (term) query.search = term;
  void router.push({ query });
}

function go(nextPage: number): void {
  void router.push({ query: { ...route.query, page: nextPage > 1 ? String(nextPage) : undefined } });
}

watch(() => [route.params.id, route.params.fileId], () => {
  sheetSearch.value = "";
  rowSearch.value = textQuery(route.query.search);
  void loadFile();
});

watch(() => [route.query.sheet, route.query.page, route.query.search], () => {
  rowSearch.value = textQuery(route.query.search);
  void loadSheet();
});

onMounted(() => {
  rowSearch.value = textQuery(route.query.search);
  void loadFile().then(() => loadSheet());
});
</script>

<template>
  <section>
    <p><router-link class="signout" :to="`/elections/${reportId}`">Back to report</router-link></p>
    <h1>{{ file?.title || "Spreadsheet" }}</h1>
    <p v-if="file" class="banner">{{ file.sectionLabel }}<template v-if="file.stateName"> · {{ file.stateName }}</template> · {{ file.reportLabel }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loadingFile">Loading…</p>
    <template v-else-if="file">
      <p v-if="file.sheets.length === 0">This file was downloaded, but no rows were stored.</p>
      <template v-else>
        <form v-if="file.sheets.length > 1" class="filters" @submit.prevent>
          <label>
            Sheet
            <input v-model="sheetSearch" type="search" placeholder="Constituency or sheet name" />
          </label>
        </form>
        <ul v-if="file.sheets.length > 1" class="sheet-list">
          <li v-for="item in visibleSheets.items" :key="item.id">
            <button type="button" :class="{ active: item.id === selectedSheetId }" @click="openSheet(item.id)">
              {{ item.name }}<template v-if="item.title && item.title !== item.name"> · {{ item.title }}</template>
              · {{ item.rowCount.toLocaleString("en-IN") }} rows
            </button>
          </li>
          <li v-if="visibleSheets.items.length === 0"><p>No sheet matches.</p></li>
        </ul>
        <p v-if="visibleSheets.total > visibleSheets.items.length">Showing 40 of {{ visibleSheets.total }} sheets. Narrow the search.</p>

        <p v-if="!selectedSheetId">Choose a sheet to see its rows.</p>
        <p v-else-if="loadingSheet">Loading rows…</p>
        <template v-else-if="sheet">
          <h2>{{ sheet.name }}<template v-if="sheet.title && sheet.title !== sheet.name"> · {{ sheet.title }}</template></h2>
          <form class="filters" @submit.prevent="applyRowSearch">
            <label>
              Search rows
              <input v-model="rowSearch" type="search" placeholder="Name, party, constituency" />
            </label>
            <button type="submit">Search</button>
          </form>
          <p>{{ sheet.total.toLocaleString("en-IN") }} rows</p>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th v-for="column in sheet.columns" :key="column">{{ column }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in sheet.rows" :key="index">
                  <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
                </tr>
                <tr v-if="sheet.rows.length === 0"><td :colspan="Math.max(sheet.columns.length, 1)">No rows match.</td></tr>
              </tbody>
            </table>
          </div>
          <div v-if="sheet.pageCount > 1" class="pager">
            <button class="secondary" type="button" :disabled="sheet.page <= 1" @click="go(sheet.page - 1)">Previous</button>
            <span>Page {{ sheet.page }} of {{ sheet.pageCount }}</span>
            <button class="secondary" type="button" :disabled="sheet.page >= sheet.pageCount" @click="go(sheet.page + 1)">Next</button>
          </div>
        </template>
      </template>
    </template>
  </section>
</template>
