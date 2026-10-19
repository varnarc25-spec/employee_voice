<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Poll { id: string; question: string; status: string; resultsVisible: boolean }
const items = ref<Poll[]>([]);
const error = ref("");

async function load(): Promise<void> {
  items.value = await api<Poll[]>("/api/v1/admin/polls");
}

async function close(id: string): Promise<void> {
  await api(`/api/v1/admin/polls/${id}/close`, { method: "POST" });
  await load();
}

onMounted(async () => {
  try { await load(); } catch (caught) { error.value = caught instanceof Error ? caught.message : "Could not load polls."; }
});
</script>

<template>
  <section>
    <h1>Polls</h1>
    <p class="banner">Results stay hidden until a poll is closed and at least five ballots exist. Choices are not shown with member names.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <article v-for="item in items" :key="item.id" class="card">
      <p>{{ item.question }}</p>
      <p>{{ item.status }} · results {{ item.resultsVisible ? "visible" : "hidden" }}</p>
      <button v-if="item.status === 'open'" type="button" @click="close(item.id)">Close poll</button>
    </article>
  </section>
</template>
