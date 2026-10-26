<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

interface Bucket { key: string; count: number }
interface Analytics {
  generatedAt: string;
  minCohort: number;
  activeAccounts: number | null;
  activeOrganizingInterests: number | null;
  postsByCategory: Bucket[];
  verificationsByStatus: Bucket[];
  omittedBuckets: number;
}

interface LinkCard {
  to: string;
  label: string;
  detail: string;
}

const session = useSession();
const analytics = ref<Analytics | null>(null);
const error = ref("");
const links = ref<LinkCard[]>([]);

function showCount(value: number | null): string {
  return value === null ? "Hidden because the group is smaller than 5" : String(value);
}

async function countOf(path: string, read: (body: unknown) => number): Promise<number | null> {
  try {
    return read(await api<unknown>(path));
  } catch {
    return null;
  }
}

function card(to: string, label: string, count: number | null, noun: string): LinkCard {
  return { to, label, detail: count === null ? "Open to review" : `${count} ${noun}` };
}

onMounted(async () => {
  if (!session.me) await session.load();
  const tasks: Promise<void>[] = [];
  const next: LinkCard[] = [];

  tasks.push((async () => {
    const states = await countOf("/api/v1/admin/locations/states", (body) => (Array.isArray(body) ? body.length : 0));
    next.push(card("/locations", "Locations", states, "states and union territories"));
  })());
  tasks.push((async () => {
    const schemes = await countOf("/api/v1/admin/scheme-links", (body) => {
      const items = (body as { items?: unknown[] }).items;
      return Array.isArray(items) ? items.length : 0;
    });
    next.push(card("/schemes", "State schemes", schemes, "state records"));
  })());
  tasks.push((async () => {
    const reports = await countOf("/api/v1/admin/election-reports?pageSize=1", (body) => {
      const total = (body as { total?: number }).total;
      return typeof total === "number" ? total : 0;
    });
    next.push(card("/elections", "Election reports", reports, "statistical reports"));
  })());

  if (session.isReviewer) {
    tasks.push((async () => {
      const members = await countOf("/api/v1/admin/members", (body) => {
        const listed = (body as { members?: unknown[] }).members;
        return Array.isArray(listed) ? listed.length : 0;
      });
      next.push(card("/members", "Members", members, "member accounts"));
    })());
    tasks.push((async () => {
      const pending = await countOf("/api/v1/admin/verifications?status=Pending", (body) => (Array.isArray(body) ? body.length : 0));
      next.push(card("/verifications", "Verifications", pending, "pending checks"));
    })());
  }

  if (session.isModerator) {
    tasks.push((async () => {
      const open = await countOf("/api/v1/admin/reports?status=Open", (body) => (Array.isArray(body) ? body.length : 0));
      next.push(card("/moderation", "Moderation", open, "open reports"));
    })());
    tasks.push((async () => {
      const appeals = await countOf("/api/v1/admin/appeals", (body) => (Array.isArray(body) ? body.length : 0));
      next.push(card("/appeals", "Appeals", appeals, "pending appeals"));
    })());
    tasks.push((async () => {
      const polls = await countOf("/api/v1/admin/polls", (body) => (Array.isArray(body) ? body.length : 0));
      next.push(card("/polls", "Polls", polls, "polls"));
    })());
  }

  if (session.isAdmin) {
    tasks.push((async () => {
      try {
        analytics.value = await api<Analytics>("/api/v1/admin/analytics");
      } catch (caught) {
        error.value = caught instanceof Error ? caught.message : "Could not load analytics.";
      }
    })());
    tasks.push((async () => {
      const requests = await countOf("/api/v1/admin/privacy-requests", (body) => {
        if (!Array.isArray(body)) return 0;
        return body.filter((item) => (item as { status?: string }).status === "pending").length;
      });
      next.push(card("/privacy", "Privacy requests", requests, "pending"));
    })());
    next.push({ to: "/access", label: "Staff and domains", detail: "Office users and work-email domains" });
    next.push({ to: "/audit", label: "Audit logs", detail: "Recent staff actions" });
    next.push({ to: "/announcements", label: "Announcements", detail: "Messages to members" });
    next.push({ to: "/logos", label: "Portal logos", detail: "Public portal marks" });
    next.push({ to: "/consent", label: "Consent", detail: "Signup and organizing text" });
  }

  await Promise.all(tasks);
  const order = ["/members", "/verifications", "/moderation", "/appeals", "/polls", "/privacy", "/elections", "/locations", "/schemes", "/announcements", "/logos", "/consent", "/access", "/audit"];
  links.value = next.sort((a, b) => order.indexOf(a.to) - order.indexOf(b.to));
});
</script>

<template>
  <section>
    <h1>Dashboard</h1>
    <p class="banner">This is the working overview of Employee Voice: members, moderation, elections, locations, and schemes. Counts below 5 stay hidden on the analytics card. There is no export of member identities or organizing-interest lists. Office users and work-email domains are under Staff and domains.</p>
    <p v-if="!session.isAdmin && !session.isModerator && !session.isReviewer">Open the areas your role allows. Analytics and staff setup are limited to administrators.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="stat-grid">
      <router-link v-for="item in links" :key="item.to" class="card stat-card" :to="item.to">
        <h2>{{ item.label }}</h2>
        <p>{{ item.detail }}</p>
      </router-link>
    </div>
    <div v-if="analytics" class="card">
      <h2>Aggregate analytics</h2>
      <p>Active accounts: {{ showCount(analytics.activeAccounts) }}</p>
      <p>Active organizing interest: {{ showCount(analytics.activeOrganizingInterests) }}</p>
      <p>Buckets hidden: {{ analytics.omittedBuckets }}</p>
      <h3>Posts</h3>
      <ul>
        <li v-for="bucket in analytics.postsByCategory" :key="bucket.key">{{ bucket.key }}: {{ bucket.count }}</li>
        <li v-if="analytics.postsByCategory.length === 0">No post category is large enough to show.</li>
      </ul>
      <h3>Verifications</h3>
      <ul>
        <li v-for="bucket in analytics.verificationsByStatus" :key="bucket.key">{{ bucket.key }}: {{ bucket.count }}</li>
        <li v-if="analytics.verificationsByStatus.length === 0">No verification status is large enough to show.</li>
      </ul>
    </div>
  </section>
</template>
