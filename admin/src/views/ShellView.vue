<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { signOut } from "../api";
import { useSession } from "../stores/session";

type NavItem = { to: string; label: string; show: boolean };
type NavGroup = { id: string; label: string; items: NavItem[] };

const session = useSession();
const router = useRouter();
const route = useRoute();
const expanded = ref<Record<string, boolean>>({});

onMounted(() => session.load());

const groups = computed<NavGroup[]>(() => {
  const all: NavGroup[] = [
    { id: "overview", label: "Overview", items: [{ to: "/", label: "Dashboard", show: true }] },
    {
      id: "community",
      label: "Community",
      items: [
        { to: "/verifications", label: "Verifications", show: session.isReviewer },
        { to: "/moderation", label: "Moderation", show: session.isModerator },
        { to: "/appeals", label: "Appeals", show: session.isModerator },
        { to: "/polls", label: "Polls", show: session.isModerator },
        { to: "/announcements", label: "Announcements", show: session.isAdmin },
      ],
    },
    {
      id: "privacy",
      label: "Privacy",
      items: [
        { to: "/consent", label: "Consent", show: session.isAdmin },
        { to: "/privacy", label: "Privacy requests", show: session.isAdmin },
      ],
    },
    {
      id: "access",
      label: "Users & access",
      items: [{ to: "/audit", label: "Audit logs", show: session.isAdmin }],
    },
  ];
  return all
    .map((group) => ({ ...group, items: group.items.filter((item) => item.show) }))
    .filter((group) => group.items.length > 0);
});

const displayName = computed(() => session.me?.displayName || "Staff");
const initials = computed(() => {
  const letters = displayName.value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
});

function active(to: string): boolean {
  if (to === "/") return route.path === "/";
  return route.path === to || route.path.startsWith(`${to}/`);
}

function groupActive(group: NavGroup): boolean {
  return group.items.some((item) => active(item.to));
}

function dashboardOnly(group: NavGroup): boolean {
  return group.id === "overview" && group.items.length === 1;
}

watch(
  () => [route.path, groups.value.map((group) => group.id).join(",")],
  () => {
    const next = { ...expanded.value };
    for (const group of groups.value) {
      if (groupActive(group)) next[group.id] = true;
    }
    expanded.value = next;
  },
  { immediate: true },
);

function toggle(id: string): void {
  const opening = !expanded.value[id];
  const next = { ...expanded.value, [id]: opening };
  if (opening) {
    for (const group of groups.value) {
      if (group.id !== id) next[group.id] = false;
    }
  }
  expanded.value = next;
}

async function leave(): Promise<void> {
  await signOut();
  session.reset();
  await router.push("/login");
}
</script>

<template>
  <div class="admin-app">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Employee Voice Admin</div>
        <div class="topbar-user">
          <span class="avatar" aria-hidden="true">{{ initials }}</span>
          <span>{{ displayName }}</span>
          <button class="signout" type="button" @click="leave">Logout</button>
        </div>
      </div>
    </header>
    <div class="shell-body">
      <aside class="sidebar">
        <nav aria-label="Admin navigation">
          <template v-for="group in groups" :key="group.id">
            <router-link
              v-if="dashboardOnly(group)"
              :to="group.items[0].to"
              class="nav-link"
              :class="{ active: active(group.items[0].to) }"
            >
              {{ group.items[0].label }}
            </router-link>
            <div v-else>
              <button class="nav-group" :class="{ active: groupActive(group) }" type="button" :aria-expanded="expanded[group.id] ? 'true' : 'false'" @click="toggle(group.id)">
                <span>{{ group.label }}</span>
                <span class="caret" aria-hidden="true">{{ expanded[group.id] ? "▾" : "▸" }}</span>
              </button>
              <div v-if="expanded[group.id]" class="nav-children">
                <router-link
                  v-for="item in group.items"
                  :key="item.to"
                  :to="item.to"
                  class="nav-link"
                  :class="{ active: active(item.to) }"
                >
                  {{ item.label }}
                </router-link>
              </div>
            </div>
          </template>
        </nav>
      </aside>
      <main class="workspace">
        <p v-if="session.error" class="error" role="alert">{{ session.error }}</p>
        <p v-else-if="session.me && session.roles.length === 0" class="banner">This account has no staff role. An administrator has to grant one. There is no default password.</p>
        <router-view />
      </main>
    </div>
  </div>
</template>
