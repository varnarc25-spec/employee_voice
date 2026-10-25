<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Member {
  id: string;
  email: string | null;
  displayName: string;
  city: string | null;
  status: string;
  verificationStatus: string;
  roles: string[];
  createdAt: string;
}

interface ProfileView {
  id: string;
  email: string | null;
  status: string;
  createdAt: string;
  roles: string[];
  profile: {
    displayName: string;
    city: string | null;
    experienceBand: string;
    industry: string;
    location: {
      stateName: string | null;
      districtName: string | null;
      subDistrictName: string | null;
      villageName: string | null;
    };
  };
  verification: { status: string; method: string | null };
}

const members = ref<Member[]>([]);
const employees = ref<Member[]>([]);
const profile = ref<ProfileView | null>(null);
const error = ref("");
const busyId = ref("");

async function load(): Promise<void> {
  error.value = "";
  try {
    const body = await api<{ members: Member[]; employees: Member[] }>("/api/v1/admin/members");
    members.value = body.members;
    employees.value = body.employees;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load members.";
  }
}

async function openProfile(id: string): Promise<void> {
  error.value = "";
  try {
    profile.value = await api<ProfileView>(`/api/v1/admin/members/${id}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not open that profile.";
  }
}

async function decide(id: string, decision: "approve" | "reject"): Promise<void> {
  busyId.value = id;
  error.value = "";
  try {
    await api(`/api/v1/admin/members/${id}/verification`, { method: "POST", body: JSON.stringify({ decision }) });
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not update that member.";
  } finally {
    busyId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <section>
    <h1>Members</h1>
    <p class="banner">People who sign in from the app appear under Members. Staff accounts, including the super admin, are listed under Employees.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <h2>Members</h2>
    <p v-if="members.length === 0">No members yet.</p>
    <table v-else>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Place</th>
          <th>Account</th>
          <th>Verification</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="member in members" :key="member.id">
          <td>{{ member.displayName }}</td>
          <td>{{ member.email || "No email" }}</td>
          <td>{{ member.city || "—" }}</td>
          <td>{{ member.status }}</td>
          <td>{{ member.verificationStatus }}</td>
          <td>
            <div class="row">
              <button class="secondary" type="button" @click="openProfile(member.id)">Profile</button>
              <button type="button" :disabled="busyId === member.id" @click="decide(member.id, 'approve')">Verify</button>
              <button class="secondary" type="button" :disabled="busyId === member.id" @click="decide(member.id, 'reject')">Reject</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <h2>Employees</h2>
    <p v-if="employees.length === 0">No employees yet.</p>
    <table v-else>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Roles</th>
          <th>Account</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="employee in employees" :key="employee.id">
          <td>{{ employee.displayName }}</td>
          <td>{{ employee.email || "No email" }}</td>
          <td>{{ employee.roles.join(", ") }}</td>
          <td>{{ employee.status }}</td>
          <td><button class="secondary" type="button" @click="openProfile(employee.id)">Profile</button></td>
        </tr>
      </tbody>
    </table>
    <article v-if="profile" class="card">
      <h2>{{ profile.profile.displayName }}</h2>
      <p>Email: {{ profile.email || "No email" }}</p>
      <p>Account: {{ profile.status }}</p>
      <p>Verification: {{ profile.verification.status }}</p>
      <p>City: {{ profile.profile.city || "—" }}</p>
      <p>Experience: {{ profile.profile.experienceBand }}</p>
      <p>Industry: {{ profile.profile.industry }}</p>
      <p>State: {{ profile.profile.location.stateName || "—" }}</p>
      <p>District: {{ profile.profile.location.districtName || "—" }}</p>
      <p>Sub-district: {{ profile.profile.location.subDistrictName || "—" }}</p>
      <p>Village: {{ profile.profile.location.villageName || "—" }}</p>
      <p v-if="profile.roles.length">Roles: {{ profile.roles.join(", ") }}</p>
    </article>
  </section>
</template>
