import { defineStore } from "pinia";
import { api, type AdminMe, clearSession } from "../api";

export const useSession = defineStore("session", {
  state: () => ({
    me: null as AdminMe | null,
    error: "",
  }),
  getters: {
    roles: (state) => state.me?.roles ?? [],
    isAdmin: (state) => state.me?.roles.includes("administrator") ?? false,
    isModerator: (state) =>
      state.me?.roles.includes("moderator") || state.me?.roles.includes("administrator") || false,
    isReviewer: (state) =>
      state.me?.roles.includes("verificationReviewer") || state.me?.roles.includes("administrator") || false,
  },
  actions: {
    async load(): Promise<void> {
      this.error = "";
      try {
        this.me = await api<AdminMe>("/api/v1/admin/me");
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Could not load the session.";
      }
    },
    reset(): void {
      this.me = null;
      clearSession();
    },
  },
});
