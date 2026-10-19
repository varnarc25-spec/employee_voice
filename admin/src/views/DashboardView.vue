<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

interface Bucket { key: string; count: number }
interface Analytics {
  generatedAt: string;
  minCohort: number;
  activeAccounts: number | null;
  activeOrganizingInterests: number | null;
  postsByCategory: Bucket[];
  verificationsByStatus: Bucket[];
  omittedBuckets: number;
}

const session = useSession();
const analytics = ref<Analytics | null>(null);
const error = ref("");
const orgName = ref("");
const orgDomain = ref("");
const orgMessage = ref("");

onMounted(async () => {
  if (!session.isAdmin) return;
  try {
    analytics.value = await api<Analytics>("/api/v1/admin/analytics");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load analytics.";
  }
});

function showCount(value: number | null): string {
  return value === null ? "Hidden because the group is smaller than 5" : String(value);
}

async function addOrg(): Promise<void> {
  orgMessage.value = "";
  try {
    await api("/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ name: orgName.value, emailDomain: orgDomain.value }),
    });
    orgMessage.value = "Domain added for work-email checks. That check still does not prove current employment.";
    orgName.value = "";
    orgDomain.value = "";
  } catch (caught) {
    orgMessage.value = caught instanceof Error ? caught.message : "Could not add the domain.";
  }
}
</script>

<template>
  <section>
    <h1>Dashboard</h1>
    <p class="banner">Counts below 5 are hidden. There is no export of member identities or organizing-interest lists.</p>
    <p v-if="!session.isAdmin">Open the queue your role allows. Analytics are limited to administrators.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="analytics" class="card">
      <p>Active accounts: {{ showCount(analytics.activeAccounts) }}</p>
      <p>Active organizing interest: {{ showCount(analytics.activeOrganizingInterests) }}</p>
      <p>Buckets hidden: {{ analytics.omittedBuckets }}</p>
      <h2>Posts</h2>
      <ul>
        <li v-for="bucket in analytics.postsByCategory" :key="bucket.key">{{ bucket.key }}: {{ bucket.count }}</li>
      </ul>
    </div>
    <form v-if="session.isAdmin" @submit.prevent="addOrg">
      <h2>Allowlisted work-email domain</h2>
      <label for="org-name">Organization name, internal only</label>
      <input id="org-name" v-model="orgName" required>
      <label for="org-domain">Email domain</label>
      <input id="org-domain" v-model="orgDomain" required>
      <button type="submit">Add domain</button>
      <p role="status">{{ orgMessage }}</p>
    </form>
  </section>
</template>
