<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";

interface ReportFile {
  id: string;
  title: string;
  stateName: string | null;
  pdfUrl: string | null;
  pdfSize: string | null;
  xlsxUrl: string | null;
  xlsxSize: string | null;
  sheetCount: number;
  rowCount: number;
}
interface ReportDetail {
  id: string;
  sectionLabel: string;
  stateName: string | null;
  pageHeading: string | null;
  label: string;
  url: string | null;
  files: ReportFile[];
}

const route = useRoute();
const report = ref<ReportDetail | null>(null);
const error = ref("");
const loading = ref(false);

async function load(): Promise<void> {
  error.value = "";
  loading.value = true;
  report.value = null;
  try {
    report.value = await api<ReportDetail>(`/api/v1/admin/election-reports/${String(route.params.id)}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load this report.";
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.id, () => void load());
onMounted(load);
</script>

<template>
  <section>
    <p><router-link class="signout" to="/elections">All reports</router-link></p>
    <h1>{{ report?.pageHeading || report?.label || "Statistical report" }}</h1>
    <p v-if="report" class="banner">{{ report.sectionLabel }}<template v-if="report.stateName"> · {{ report.stateName }}</template></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading">Loading…</p>
    <table v-else-if="report">
      <thead>
        <tr><th>State</th><th>File</th><th>PDF</th><th>Data</th></tr>
      </thead>
      <tbody>
        <tr v-for="file in report.files" :key="file.id">
          <td>{{ file.stateName || "—" }}</td>
          <td>{{ file.title }}</td>
          <td>
            <a v-if="file.pdfUrl" class="signout" :href="file.pdfUrl" target="_blank" rel="noreferrer">PDF<template v-if="file.pdfSize"> · {{ file.pdfSize }}</template></a>
            <span v-else>—</span>
          </td>
          <td>
            <div class="row">
              <router-link v-if="file.sheetCount" class="signout" :to="`/elections/${report.id}/files/${file.id}`">
                View {{ file.rowCount.toLocaleString("en-IN") }} rows<template v-if="file.sheetCount > 1"> · {{ file.sheetCount }} sheets</template>
              </router-link>
              <span v-else>Not loaded</span>
              <a v-if="file.xlsxUrl" class="signout" :href="file.xlsxUrl" target="_blank" rel="noreferrer">Download</a>
            </div>
          </td>
        </tr>
        <tr v-if="report.files.length === 0"><td colspan="4">This page has no file list yet.</td></tr>
      </tbody>
    </table>
  </section>
</template>
