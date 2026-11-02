export type Role = "owner" | "admin" | "editor" | "viewer";

const rank: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export type Permission =
  | "read"
  | "signals:write"
  | "agents:run"
  | "drafts:review"
  | "memory:write"
  | "experiments:write"
  | "agents:manage"
  | "settings:manage"
  | "members:manage"
  | "keys:manage";

const minRole: Record<Permission, Role> = {
  read: "viewer",
  "signals:write": "editor",
  "agents:run": "editor",
  "drafts:review": "editor",
  "memory:write": "editor",
  "experiments:write": "editor",
  "agents:manage": "admin",
  "settings:manage": "admin",
  "members:manage": "admin",
  "keys:manage": "admin",
};

export function can(role: Role, perm: Permission): boolean {
  return rank[role] >= rank[minRole[perm]];
}

export function isRole(v: unknown): v is Role {
  return v === "owner" || v === "admin" || v === "editor" || v === "viewer";
}
