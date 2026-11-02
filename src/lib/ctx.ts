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

/**
 * Workspace administration (secrets, API keys, members, workspace settings) is never
 * available inside an embed, whatever role the host put in the token: the embed secret
 * is the host's root credential, and end users of the host app must not reach it.
 */
const EMBED_DENIED: ReadonlySet<Permission> = new Set<Permission>(["settings:manage", "members:manage", "keys:manage"]);

export function canDo(ctx: Ctx, perm: Permission) {
  if (ctx.actor.type === "embed" && EMBED_DENIED.has(perm)) return false;
  return can(ctx.role, perm);
}

export function assertCan(ctx: Ctx, perm: Permission) {
  if (!canDo(ctx, perm)) throw forbidden();
}

export function systemCtx(tenantId: string): Ctx {
  return { tenantId, role: "owner", actor: { type: "system", id: "system" }, userId: null };
}
