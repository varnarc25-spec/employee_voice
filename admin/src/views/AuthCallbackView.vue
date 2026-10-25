<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { signInWithAuth0 } from "../api";

const router = useRouter();
const error = ref("");

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error_description") || params.get("error");
  if (authError) {
    error.value = authError;
    return;
  }
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  try {
    await signInWithAuth0(code, state, `${window.location.origin}/auth/callback`);
    await router.replace("/");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Auth0 did not sign you in.";
  }
});
</script>

<template>
  <div class="login-screen">
    <main class="login-card">
      <h1>Employee Voice Admin</h1>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else class="hint">Signing in with Auth0…</p>
      <p class="login-links"><router-link to="/login">Back to sign in</router-link></p>
    </main>
  </div>
</template>
