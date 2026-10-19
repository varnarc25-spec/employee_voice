<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Appeal { id: string; reportId: string; status: string; createdAt: string }
const items = ref<Appeal[]>([]);
const error = ref("");

async function load(): Promise<void> {
  items.value = await api<Appeal[]>("/api/v1/admin/appeals");
}

async function decide(id: string, decision: "accept" | "deny"): Promise<void> {
  await api(`/api/v1/admin/appeals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
  await load();
}

onMounted(async () => {
  try { await load(); } catch (caught) { error.value = caught instanceof Error ? caught.message : "Could not load appeals."; }
});
</script>

<template>
  <section>
    <h1>Appeals</h1>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="items.length === 0">No appeals are waiting.</p>
    <article v-for="item in items" :key="item.id" class="card">
      <p>Report {{ item.reportId }} · {{ item.status }}</p>
      <div class="row">
        <button type="button" @click="decide(item.id, 'accept')">Accept and restore</button>
        <button class="secondary" type="button" @click="decide(item.id, 'deny')">Deny</button>
      </div>
    </article>
  </section>
</template>
