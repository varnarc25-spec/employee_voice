<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { consumeLink, loadDevToken, requestLink } from "../api";

const router = useRouter();
const email = ref("");
const token = ref(new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "");
const adult = ref(false);
const terms = ref(false);
const message = ref("");
const error = ref("");

async function sendLink(): Promise<void> {
  error.value = "";
  if (!adult.value || !terms.value) {
    error.value = "Confirm that you are 18 or older and that you agree to the draft terms.";
    return;
  }
  try {
    message.value = await requestLink(email.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not send the link.";
  }
}

async function signIn(): Promise<void> {
  error.value = "";
  try {
    await consumeLink(token.value.trim());
    await router.push("/");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not sign in.";
  }
}

async function useLocalMailbox(): Promise<void> {
  error.value = "";
  try {
    token.value = await loadDevToken();
    message.value = "Loaded the latest local sign-in token. This button only works when the API is in Development.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Local mailbox is unavailable.";
  }
}
</script>

<template>
  <div class="admin-app">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Employee Voice Admin</div>
      </div>
    </header>
    <main class="login-card">
    <p class="banner">Employee Voice India admin. Independent community tools. Not a government service and not a trade union.</p>
    <h1>Staff sign-in</h1>
    <p>There is no password. Ask for an email link, then paste the token. The link fragment is not sent to the API when this page loads.</p>
    <form @submit.prevent="sendLink">
      <label for="email">Email</label>
      <input id="email" v-model="email" type="email" autocomplete="username" required>
      <label><input v-model="adult" type="checkbox"> I am 18 or older</label>
      <label><input v-model="terms" type="checkbox"> I agree to the draft terms and privacy notice</label>
      <button type="submit">Email me a sign-in link</button>
    </form>
    <form @submit.prevent="signIn">
      <label for="token">Sign-in token</label>
      <textarea id="token" v-model="token" rows="4" required></textarea>
      <div class="row">
        <button type="submit">Sign in</button>
        <button class="secondary" type="button" @click="useLocalMailbox">Load local development link</button>
      </div>
    </form>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    </main>
  </div>
</template>
