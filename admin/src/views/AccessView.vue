<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Organization {
  id: string;
  name: string;
  emailDomain: string;
  allowlisted: boolean;
}

const orgName = ref("");
const orgDomain = ref("");
const orgMessage = ref("");
const staffEmail = ref("");
const staffPassword = ref("");
const staffName = ref("");
const staffRole = ref("Moderator");
const staffMessage = ref("");
const organizations = ref<Organization[]>([]);
const error = ref("");

async function loadOrgs(): Promise<void> {
  organizations.value = await api<Organization[]>("/api/v1/admin/organizations");
}

onMounted(async () => {
  try {
    await loadOrgs();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load allowlisted domains.";
  }
});

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
    await loadOrgs();
  } catch (caught) {
    orgMessage.value = caught instanceof Error ? caught.message : "Could not add the domain.";
  }
}
</script>

<template>
  <section>
    <h1>Staff and domains</h1>
    <p class="banner">Create moderator and reviewer accounts here. Super admin stays reserved. Work-email domains only help a verification check; they do not prove current employment.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <form @submit.prevent="addStaff">
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
    <form @submit.prevent="addOrg">
      <h2>Allowlisted work-email domain</h2>
      <label for="org-name">Organization name, internal only</label>
      <input id="org-name" v-model="orgName" required>
      <label for="org-domain">Email domain</label>
      <input id="org-domain" v-model="orgDomain" required>
      <button type="submit">Add domain</button>
      <p role="status">{{ orgMessage }}</p>
    </form>
    <h2>Domains on file</h2>
    <ul v-if="organizations.length">
      <li v-for="org in organizations" :key="org.id">
        {{ org.name }} · {{ org.emailDomain }}<span v-if="org.allowlisted"> · allowlisted</span>
      </li>
    </ul>
    <p v-else>No domains loaded.</p>
  </section>
</template>
