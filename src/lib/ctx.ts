import type { Role, Permission } from "./rbac";
import { can } from "./rbac";
import { forbidden } from "./errors";

/** Everything a service needs to know about who is acting, and for which tenant. */
export type Ctx = {
  tenantId: string;
  role: Role;
  actor: { type: "user" | "api_key" | "embed" | "agent" | "system"; id: string };
  userId: string | null;
};

export function assertCan(ctx: Ctx, perm: Permission) {
  if (!can(ctx.role, perm)) throw forbidden();
}

export function systemCtx(tenantId: string): Ctx {
  return { tenantId, role: "owner", actor: { type: "system", id: "system" }, userId: null };
}
