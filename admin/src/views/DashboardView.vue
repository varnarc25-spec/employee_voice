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
const staffEmail = ref("");
const staffPassword = ref("");
const staffName = ref("");
const staffRole = ref("Moderator");
const staffMessage = ref("");

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

async function addStaff(): Promise<void> {
  staffMessage.value = "";
  try {
    await api("/api/v1/admin/roles", {
      method: "POST",
      body: JSON.stringify({
        email: staffEmail.value,
        password: staffPassword.value,
        displayName: staffName.value || null,
        role: staffRole.value,
      }),
    });
    staffMessage.value = "Staff user created.";
    staffEmail.value = "";
    staffPassword.value = "";
    staffName.value = "";
  } catch (caught) {
    staffMessage.value = caught instanceof Error ? caught.message : "Could not add that staff account.";
  }
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
    <form v-if="session.isAdmin" @submit.prevent="addStaff">
      <h2>Create office user</h2>
      <label for="staff-email">Email</label>
      <input id="staff-email" v-model="staffEmail" type="email" required>
      <label for="staff-password">Password</label>
      <input id="staff-password" v-model="staffPassword" type="password" minlength="8" autocomplete="new-password" required>
      <label for="staff-name">Display name</label>
      <input id="staff-name" v-model="staffName">
      <label for="staff-role">Role</label>
      <select id="staff-role" v-model="staffRole">
        <option value="Moderator">Moderator</option>
        <option value="VerificationReviewer">Verification reviewer</option>
      </select>
      <p>Super admin is reserved for business@varnarc.com.</p>
      <button type="submit">Create user</button>
      <p role="status">{{ staffMessage }}</p>
    </form>
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
