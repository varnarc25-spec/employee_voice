<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";

interface Logo {
  id: string;
  title: string;
  altText: string;
  linkUrl: string;
  imageUrl: string;
}

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:5080";
const items = ref<Logo[]>([]);
const error = ref("");
const notice = ref("");
const loading = ref(false);
const saving = ref(false);
const title = ref("");
const altText = ref("");
const linkUrl = ref("https://");
const file = ref<File | null>(null);

function src(logo: Logo): string {
  return `${base}${logo.imageUrl}`;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const page = await api<{ items: Logo[] }>("/api/v1/admin/portal-logos");
    items.value = page.items;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load logos.";
  } finally {
    loading.value = false;
  }
}

function choose(event: Event): void {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function upload(): Promise<void> {
  error.value = "";
  notice.value = "";
  const chosen = file.value;
  if (!chosen) {
    error.value = "Choose an image.";
    return;
  }
  saving.value = true;
  try {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(chosen);
    });
    await api("/api/v1/admin/portal-logos", {
      method: "POST",
      body: JSON.stringify({
        title: title.value,
        altText: altText.value,
        linkUrl: linkUrl.value,
        contentType: chosen.type,
        dataBase64,
      }),
    });
    title.value = "";
    altText.value = "";
    linkUrl.value = "https://";
    file.value = null;
    notice.value = "Logo saved. It shows on the app home screen.";
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not save the logo.";
  } finally {
    saving.value = false;
  }
}

async function remove(logo: Logo): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    await api(`/api/v1/admin/portal-logos/${logo.id}`, { method: "DELETE" });
    notice.value = "Logo removed.";
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not remove the logo.";
  }
}

onMounted(load);
</script>

<template>
  <section>
    <h1>Portal logos</h1>
    <p class="banner">Logos shown on the app home screen. Each one opens its link.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="banner">{{ notice }}</p>
    <form class="card" @submit.prevent="upload">
      <h2>Upload a logo</h2>
      <label>Title<input v-model="title" maxlength="80" required /></label>
      <label>Description<input v-model="altText" maxlength="160" required /></label>
      <label>Link<input v-model="linkUrl" type="url" required /></label>
      <label>Image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" required @change="choose" /></label>
      <button type="submit" :disabled="saving">{{ saving ? "Saving…" : "Save logo" }}</button>
    </form>
    <p v-if="loading">Loading…</p>
    <table v-else>
      <thead>
        <tr><th>Logo</th><th>Title</th><th>Link</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="logo in items" :key="logo.id">
          <td><img :src="src(logo)" :alt="logo.altText" style="height: 40px; background: #fff" /></td>
          <td>{{ logo.title }}</td>
          <td><a class="signout" :href="logo.linkUrl" target="_blank" rel="noreferrer">{{ logo.linkUrl }}</a></td>
          <td><button type="button" @click="remove(logo)">Remove</button></td>
        </tr>
        <tr v-if="items.length === 0"><td colspan="4">No logos yet.</td></tr>
      </tbody>
    </table>
  </section>
</template>
