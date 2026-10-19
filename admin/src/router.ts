import { createRouter, createWebHistory } from "vue-router";
import { signedIn } from "./api";
import LoginView from "./views/LoginView.vue";
import ShellView from "./views/ShellView.vue";
import DashboardView from "./views/DashboardView.vue";
import VerificationsView from "./views/VerificationsView.vue";
import ModerationView from "./views/ModerationView.vue";
import AppealsView from "./views/AppealsView.vue";
import PollsView from "./views/PollsView.vue";
import AnnouncementsView from "./views/AnnouncementsView.vue";
import PrivacyView from "./views/PrivacyView.vue";
import AuditView from "./views/AuditView.vue";
import ConsentView from "./views/ConsentView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView },
    {
      path: "/",
      component: ShellView,
      children: [
        { path: "", component: DashboardView },
        { path: "verifications", component: VerificationsView },
        { path: "moderation", component: ModerationView },
        { path: "appeals", component: AppealsView },
        { path: "polls", component: PollsView },
        { path: "announcements", component: AnnouncementsView },
        { path: "privacy", component: PrivacyView },
        { path: "audit", component: AuditView },
        { path: "consent", component: ConsentView },
      ],
    },
  ],
});

router.beforeEach((to) => {
  if (to.path !== "/login" && !signedIn()) return "/login";
  if (to.path === "/login" && signedIn()) return "/";
  return true;
});

export default router;
