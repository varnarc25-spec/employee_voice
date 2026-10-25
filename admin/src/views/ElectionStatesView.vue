<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface ElectionState {
  id: string;
  name: string;
  reportCount: number;
  fileCount: number;
}

const states = ref<ElectionState[]>([]);
const error = ref("");
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    states.value = await api<ElectionState[]>("/api/v1/admin/election-reports/states");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load states.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <h1>Election states</h1>
    <p class="banner">States named in statistical-report headings and file titles.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading">Loading…</p>
    <table v-else>
      <thead>
        <tr><th>State</th><th>Reports</th><th>Files</th></tr>
      </thead>
      <tbody>
        <tr v-for="state in states" :key="state.id">
          <td>
            <router-link class="signout" :to="{ path: '/elections', query: { jurisdiction: state.name } }">{{ state.name }}</router-link>
          </td>
          <td>{{ state.reportCount }}</td>
          <td>{{ state.fileCount }}</td>
        </tr>
        <tr v-if="states.length === 0"><td colspan="3">No states stored yet.</td></tr>
      </tbody>
    </table>
  </section>
</template>
