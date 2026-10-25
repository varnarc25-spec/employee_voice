<script setup lang="ts">
import { ref } from "vue";
import { changePassword } from "../api";

const currentPassword = ref("");
const password = ref("");
const confirm = ref("");
const message = ref("");
const error = ref("");

async function save(): Promise<void> {
  error.value = "";
  message.value = "";
  if (password.value !== confirm.value) {
    error.value = "The two passwords do not match.";
    return;
  }
  try {
    await changePassword(currentPassword.value, password.value);
    currentPassword.value = "";
    password.value = "";
    confirm.value = "";
    message.value = "Password updated.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not reset the password.";
  }
}
</script>

<template>
  <section>
    <h1>Reset password</h1>
    <form class="card" @submit.prevent="save">
      <label for="current-password">Current password</label>
      <input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required>
      <label for="new-password">New password</label>
      <input id="new-password" v-model="password" type="password" autocomplete="new-password" minlength="8" required>
      <label for="confirm-password">Confirm password</label>
      <input id="confirm-password" v-model="confirm" type="password" autocomplete="new-password" minlength="8" required>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit">Reset password</button>
    </form>
  </section>
</template>
