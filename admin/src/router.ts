import { createRouter, createWebHistory } from "vue-router";
import { signedIn } from "./api";
import LoginView from "./views/LoginView.vue";
import ForgotPasswordView from "./views/ForgotPasswordView.vue";
import ResetPasswordView from "./views/ResetPasswordView.vue";
import ChangePasswordView from "./views/ChangePasswordView.vue";
import AuthCallbackView from "./views/AuthCallbackView.vue";
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
import LocationsView from "./views/LocationsView.vue";
import MembersView from "./views/MembersView.vue";
import ElectionReportsView from "./views/ElectionReportsView.vue";
import ElectionReportDetailView from "./views/ElectionReportDetailView.vue";
import ElectionWorkbookView from "./views/ElectionWorkbookView.vue";
import ElectionStatesView from "./views/ElectionStatesView.vue";
import SchemeLinksView from "./views/SchemeLinksView.vue";
import PortalLogosView from "./views/PortalLogosView.vue";
import AccessView from "./views/AccessView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView },
    { path: "/forgot-password", component: ForgotPasswordView },
    { path: "/reset-password", component: ResetPasswordView },
    { path: "/auth/callback", component: AuthCallbackView },
    {
      path: "/",
      component: ShellView,
      children: [
        { path: "", component: DashboardView },
        { path: "locations", component: LocationsView },
        { path: "schemes", component: SchemeLinksView },
        { path: "logos", component: PortalLogosView },
        { path: "members", component: MembersView },
        { path: "elections", component: ElectionReportsView },
        { path: "elections/:id/files/:fileId", component: ElectionWorkbookView },
        { path: "elections/:id", component: ElectionReportDetailView },
        { path: "election-states", component: ElectionStatesView },
        { path: "verifications", component: VerificationsView },
        { path: "moderation", component: ModerationView },
        { path: "appeals", component: AppealsView },
        { path: "polls", component: PollsView },
        { path: "announcements", component: AnnouncementsView },
        { path: "privacy", component: PrivacyView },
        { path: "audit", component: AuditView },
        { path: "access", component: AccessView },
        { path: "consent", component: ConsentView },
        { path: "password", component: ChangePasswordView },
      ],
    },
  ],
});

const publicPaths = new Set(["/login", "/forgot-password", "/reset-password", "/auth/callback"]);

router.beforeEach((to) => {
  if (!publicPaths.has(to.path) && !signedIn()) return "/login";
  if (to.path === "/login" && signedIn()) return "/";
  return true;
});

export default router;
