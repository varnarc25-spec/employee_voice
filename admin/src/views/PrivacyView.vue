<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface RequestItem { id: string; type: string; status: string; maskedEmail: string | null; requestedAt: string }
interface Retention { magicLinks: number; sessions: number; evidenceRows: number; notifications: number }
const items = ref<RequestItem[]>([]);
const result = ref("");
const error = ref("");

async function load(): Promise<void> {
  items.value = await api<RequestItem[]>("/api/v1/admin/privacy-requests");
}

async function complete(id: string): Promise<void> {
  await api(`/api/v1/admin/privacy-requests/${id}/complete`, { method: "POST" });
  await load();
}

async function runRetention(): Promise<void> {
  const report = await api<Retention>("/api/v1/admin/retention/run", { method: "POST" });
  result.value = `Cleared ${report.magicLinks} sign-in links, ${report.sessions} sessions, ${report.evidenceRows} evidence fields, ${report.notifications} notifications.`;
}

onMounted(async () => {
  try { await load(); } catch (caught) { error.value = caught instanceof Error ? caught.message : "Could not load privacy requests."; }
});
</script>

<template>
  <section>
    <h1>Privacy requests</h1>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <article v-for="item in items" :key="item.id" class="card">
      <p>{{ item.type }} · {{ item.status }} · {{ item.maskedEmail || "no email stored" }}</p>
      <button v-if="item.status === 'pending'" type="button" @click="complete(item.id)">Complete</button>
    </article>
    <h2>Retention</h2>
    <button type="button" @click="runRetention">Run retention now</button>
    <p role="status">{{ result }}</p>
  </section>
</template>
