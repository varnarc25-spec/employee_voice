<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Item {
  id: string;
  method: string;
  status: string;
  maskedEvidence: string | null;
  emailDomain: string | null;
  createdAt: string;
}

const items = ref<Item[]>([]);
const revealed = ref<Record<string, string>>({});
const error = ref("");

async function load(): Promise<void> {
  error.value = "";
  try {
    items.value = await api<Item[]>("/api/v1/admin/verifications?status=pending");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load the queue.";
  }
}

async function reveal(id: string): Promise<void> {
  const body = await api<{ evidence: string }>(`/api/v1/admin/verifications/${id}/reveal`, { method: "POST" });
  revealed.value = { ...revealed.value, [id]: body.evidence };
}

async function decide(id: string, decision: "approve" | "reject"): Promise<void> {
  await api(`/api/v1/admin/verifications/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
  await load();
}

onMounted(load);
</script>

<template>
  <section>
    <h1>Verification queue</h1>
    <p class="banner">Evidence is masked until you reveal it. Revealing is audited. No identity documents are stored. A work-email check does not prove current employment.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="items.length === 0">Nothing is waiting.</p>
    <article v-for="item in items" :key="item.id" class="card">
      <p>{{ item.method }} · {{ item.status }} · {{ item.emailDomain || "no domain" }}</p>
      <p>Masked: {{ item.maskedEvidence || "none" }}</p>
      <p v-if="revealed[item.id]">Revealed: {{ revealed[item.id] }}</p>
      <div class="row">
        <button class="secondary" type="button" @click="reveal(item.id)">Reveal evidence</button>
        <button type="button" @click="decide(item.id, 'approve')">Approve</button>
        <button class="secondary" type="button" @click="decide(item.id, 'reject')">Reject</button>
      </div>
    </article>
  </section>
</template>
