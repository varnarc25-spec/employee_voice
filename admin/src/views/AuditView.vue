<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Audit { id: string; actorId: string | null; action: string; entityType: string; createdAt: string; metadataJson: string | null }
const items = ref<Audit[]>([]);
const error = ref("");
onMounted(async () => {
  try {
    items.value = await api<Audit[]>("/api/v1/admin/audit-logs");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load the audit log.";
  }
});
</script>

<template>
  <section>
    <h1>Audit log</h1>
    <p class="banner">Entries store actions and ids. Post bodies, poll choices, and verification evidence are not copied here.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <table v-else>
      <thead><tr><th>When</th><th>Action</th><th>Entity</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.createdAt }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.entityType }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
