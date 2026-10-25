<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface SchemeRow {
  lgdCode: number;
  stateName: string;
  stateKind: string;
  sourceName: string | null;
  schemeKind: string | null;
  schemeUrl: string | null;
  schemes: unknown[];
}
interface SchemePage {
  sourceUrl: string;
  items: SchemeRow[];
}

const page = ref<SchemePage | null>(null);
const error = ref("");
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    page.value = await api<SchemePage>("/api/v1/admin/scheme-links");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load scheme links.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <h1>State schemes</h1>
    <p class="banner">
      myScheme links mapped to the states table. People with a state on their profile open their state's page. Everyone else opens the main list.
      <a v-if="page" class="signout" :href="page.sourceUrl" target="_blank" rel="noreferrer">Main schemes link</a>
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading">Loading…</p>
    <table v-else-if="page">
      <thead>
        <tr><th>LGD code</th><th>State</th><th>Kind</th><th>myScheme name</th><th>Schemes</th><th>Link</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in page.items" :key="row.lgdCode">
          <td>{{ row.lgdCode }}</td>
          <td>{{ row.stateName }}</td>
          <td>{{ row.stateKind }}</td>
          <td>{{ row.sourceName || "Not mapped" }}</td>
          <td>{{ row.schemes.length }}</td>
          <td>
            <a v-if="row.schemeUrl" class="signout" :href="row.schemeUrl" target="_blank" rel="noreferrer">Open</a>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
