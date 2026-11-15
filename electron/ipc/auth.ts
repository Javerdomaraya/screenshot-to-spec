import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createAdminAuthService } from "../services/adminAuth";

export function registerAuthHandlers(
  getWindow: WindowProvider,
  admin: ReturnType<typeof createAdminAuthService>,
): void {
  registerHandler("auth:status", getWindow, () => admin.status(), { public: true });
  registerHandler("auth:setup", getWindow, (password) => admin.setup(password), { public: true });
  registerHandler("auth:signIn", getWindow, (password) => admin.signIn(password), { public: true });
  registerHandler("auth:logout", getWindow, () => admin.logout(), { public: true });
}
