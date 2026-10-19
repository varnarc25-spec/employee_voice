<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Item { id: string; targetType: string; reason: string; status: string; createdAt: string }
interface Detail { summary: Item; details: string | null; content: string | null; contentStatus: string }

const items = ref<Item[]>([]);
const detail = ref<Detail | null>(null);
const error = ref("");

async function load(): Promise<void> {
  items.value = await api<Item[]>("/api/v1/admin/reports?status=open");
}

async function openReport(id: string): Promise<void> {
  detail.value = await api<Detail>(`/api/v1/admin/reports/${id}`);
}

async function decide(decision: "remove" | "dismiss" | "escalate"): Promise<void> {
  if (!detail.value) return;
  await api(`/api/v1/admin/reports/${detail.value.summary.id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
  detail.value = null;
  await load();
}

onMounted(async () => {
  try { await load(); } catch (caught) { error.value = caught instanceof Error ? caught.message : "Could not load reports."; }
});
</script>

<template>
  <section>
    <h1>Moderation queue</h1>
    <p class="banner">Opening a report is audited. Decisions are remove, dismiss, or escalate. Escalated reports are decided by an administrator.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="items.length === 0">No open reports.</p>
    <table v-if="items.length">
      <thead><tr><th>Reason</th><th>Target</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.reason }}</td>
          <td>{{ item.targetType }}</td>
          <td><button type="button" @click="openReport(item.id)">Open</button></td>
        </tr>
      </tbody>
    </table>
    <article v-if="detail" class="card">
      <h2>Report</h2>
      <p>{{ detail.details || "No extra detail." }}</p>
      <p>{{ detail.content }}</p>
      <div class="row">
        <button type="button" @click="decide('remove')">Remove</button>
        <button class="secondary" type="button" @click="decide('dismiss')">Dismiss</button>
        <button class="secondary" type="button" @click="decide('escalate')">Escalate</button>
      </div>
    </article>
  </section>
</template>
