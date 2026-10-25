<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { signInWithPassword } from "../api";

const router = useRouter();
const email = ref("business@varnarc.com");
const password = ref("");
const error = ref("");

function continueWithAuth0(): void {
  const redirect = `${window.location.origin}/auth/callback`;
  window.location.assign(`/api/v1/auth/auth0/start?redirect=${encodeURIComponent(redirect)}`);
}

async function signIn(): Promise<void> {
  error.value = "";
  try {
    await signInWithPassword(email.value, password.value);
    await router.push("/");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not sign in.";
  }
}
</script>

<template>
  <div class="login-screen">
    <main class="login-card">
      <h1>Employee Voice Admin</h1>
      <p class="hint">Super admin: business@varnarc.com</p>
      <form @submit.prevent="signIn">
        <label for="email">
          Email
          <input id="email" v-model="email" type="email" autocomplete="username" required>
        </label>
        <label for="password">
          Password
          <input id="password" v-model="password" type="password" autocomplete="current-password" minlength="8" required>
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit">Sign in</button>
      </form>
      <button class="secondary" type="button" @click="continueWithAuth0">Continue with Auth0</button>
      <p class="login-links"><router-link to="/forgot-password">Forgot password?</router-link></p>
    </main>
  </div>
</template>
