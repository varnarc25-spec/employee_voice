<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Interest {
  id: string;
  maskedEmail: string;
  status: string;
  purpose: string;
  textVersion: string;
  createdAt: string;
  withdrawnAt: string | null;
}
const items = ref<Interest[]>([]);
const error = ref("");
onMounted(async () => {
  try {
    items.value = await api<Interest[]>("/api/v1/admin/organizing-interests");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load consent records.";
  }
});
</script>

<template>
  <section>
    <h1>Organizing interest</h1>
    <p class="banner">These records are not a trade-union membership register. Emails are masked. There is no bulk export.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <table v-else>
      <thead><tr><th>Account</th><th>Status</th><th>Version</th><th>Recorded</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.maskedEmail }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.textVersion }}</td>
          <td>{{ item.createdAt }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
