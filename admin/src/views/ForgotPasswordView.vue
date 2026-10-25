<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { loadDevToken, requestPasswordReset } from "../api";

const router = useRouter();
const email = ref("business@varnarc.com");
const message = ref("");
const error = ref("");
const sent = ref(false);
const localDev = import.meta.env.DEV;

async function send(): Promise<void> {
  error.value = "";
  message.value = "";
  try {
    message.value = await requestPasswordReset(email.value);
    sent.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not send the reset link.";
  }
}

async function openLocalLink(): Promise<void> {
  error.value = "";
  try {
    const token = await loadDevToken("password_reset");
    await router.push({ path: "/reset-password", hash: `#token=${encodeURIComponent(token)}` });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not open the reset link.";
  }
}
</script>

<template>
  <div class="login-screen">
    <main class="login-card">
      <h1>Forgot password</h1>
      <p class="hint">Enter the staff email for this admin account.</p>
      <form @submit.prevent="send">
        <label for="email">
          Email
          <input id="email" v-model="email" type="email" autocomplete="username" required>
        </label>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit">Send reset link</button>
        <button v-if="sent && localDev" class="secondary" type="button" @click="openLocalLink">Open the local reset link</button>
      </form>
      <p class="login-links"><router-link to="/login">Back to sign in</router-link></p>
    </main>
  </div>
</template>
