<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { resetPassword } from "../api";

const router = useRouter();
const token = ref(new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "");
const password = ref("");
const confirm = ref("");
const error = ref("");

async function save(): Promise<void> {
  error.value = "";
  if (password.value !== confirm.value) {
    error.value = "The two passwords do not match.";
    return;
  }
  try {
    await resetPassword(token.value, password.value);
    await router.push("/login");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not reset the password.";
  }
}
</script>

<template>
  <div class="login-screen">
    <main class="login-card">
      <h1>Reset password</h1>
      <p class="hint">Choose a new password for this staff account.</p>
      <form @submit.prevent="save">
        <label for="password">
          New password
          <input id="password" v-model="password" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <label for="confirm">
          Confirm password
          <input id="confirm" v-model="confirm" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <p v-if="!token" class="error" role="alert">Request a reset link before setting a new password.</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit" :disabled="!token">Reset password</button>
      </form>
      <p class="login-links"><router-link to="/forgot-password">Forgot password?</router-link></p>
    </main>
  </div>
</template>
