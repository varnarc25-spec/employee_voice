<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";

const title = ref("");
const body = ref("");
const message = ref("");

async function publish(): Promise<void> {
  message.value = "";
  try {
    await api("/api/v1/admin/announcements", { method: "POST", body: JSON.stringify({ title: title.value, body: body.value }) });
    message.value = "Announcement saved. Push notifications, if enabled, use a generic preview.";
    title.value = "";
    body.value = "";
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : "Could not publish.";
  }
}
</script>

<template>
  <section>
    <h1>Announcement</h1>
    <form @submit.prevent="publish">
      <label for="title">Title</label>
      <input id="title" v-model="title" required>
      <label for="body">Body</label>
      <textarea id="body" v-model="body" rows="5" required></textarea>
      <button type="submit">Publish</button>
    </form>
    <p role="status">{{ message }}</p>
  </section>
</template>
