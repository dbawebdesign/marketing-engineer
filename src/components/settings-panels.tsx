"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, KeyRound, RotateCcw } from "lucide-react";
import { createKeyAction, revokeKeyAction, revealSecretAction, rotateSecretAction, updateWorkspaceAction } from "@/app/(app)/settings/actions";
import { Badge, Button, Input, Label, Textarea, cx, timeAgo } from "./ui";
import { toast } from "./toast";

const copy = async (t: string) => {
  await navigator.clipboard.writeText(t);
  toast.ok("Copied");
};

export function WorkspaceForm({ name, origins, canManage }: { name: string; origins: string[]; canManage: boolean }) {
  const [n, setN] = useState(name);
  const [o, setO] = useState(origins.join("\n"));
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <fieldset disabled={!canManage} className="space-y-4">
      <label className="block">
        <Label>Workspace name</Label>
        <Input value={n} onChange={(e) => setN(e.target.value)} maxLength={120} />
      </label>
      <label className="block">
        <Label hint="one per line">Sites allowed to embed this workspace</Label>
        <Textarea value={o} onChange={(e) => setO(e.target.value)} rows={3} placeholder="https://app.yourcompany.com" className="font-mono text-[13px]" />
      </label>
      {canManage ? (
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateWorkspaceAction({ name: n, allowed_origins: o.split("\n").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean) });
              if (r.ok) {
                toast.ok("Saved");
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          Save
        </Button>
      ) : null}
    </fieldset>
  );
}

export function ApiKeys({ keys }: { keys: { id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }[] }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write" | "admin">("write");
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = keys.filter((k) => !k.revoked_at);
  return (
    <div>
      {fresh ? (
        <div className="mb-4 rounded-xl bg-accent-soft p-4">
          <p className="text-sm font-medium text-ink">Copy your key now. You won't see it again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-surface px-3 py-2 font-mono text-[13px] ring-1 ring-line">{fresh}</code>
            <Button size="sm" onClick={() => copy(fresh)}>
              <Copy size={13} /> Copy
            </Button>
          </div>
        </div>
      ) : null}
      {active.length ? (
        <ul className="mb-4 divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
          {active.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <KeyRound size={14} className="text-ink-3" />
              <span className="font-medium">{k.name}</span>
              <code className="font-mono text-xs text-ink-3">me_live_{k.prefix}_…</code>
              <Badge>{k.scopes.includes("admin") ? "admin" : k.scopes.includes("write") ? "read + write" : "read only"}</Badge>
              <span className="ml-auto text-xs text-ink-3">{k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : "never used"}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  start(async () => {
                    if (!confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`)) return;
                    const r = await revokeKeyAction(k.id);
                    if (r.ok) toast.ok("Key revoked");
                    else toast.error(r.error);
                    router.refresh();
                  })
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const scopes = scope === "read" ? ["read"] : scope === "write" ? ["read", "write"] : ["read", "write", "admin"];
            const r = await createKeyAction(name, scopes);
            if (!r.ok) return void toast.error(r.error);
            setFresh(r.data?.key ?? null);
            setName("");
            router.refresh();
          });
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. HubSpot sync" className="h-9 max-w-xs" />
        <div className="flex rounded-lg bg-subtle p-0.5 text-[13px]">
          {(["read", "write", "admin"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)} className={cx("rounded-md px-2.5 py-1", scope === s ? "bg-surface font-medium shadow-soft" : "text-ink-2")}>
              {s === "read" ? "Read" : s === "write" ? "Read + write" : "Admin"}
            </button>
          ))}
        </div>
        <Button disabled={pending || !name.trim()}>Create key</Button>
      </form>
    </div>
  );
}

export function EmbedPanel({ slug, appUrl }: { slug: string; appUrl: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const snippet = `<div id="growth"></div>
<script src="${appUrl}/embed/v1.js"></script>
<script>
  // Mint the token on YOUR server (never in the browser) with the embed secret:
  // HS256 JWT { iss: "${slug}", sub: user.id, email, name, role: "editor", exp: now + 600 }
  MarketingEngineer.mount(document.getElementById("growth"), {
    baseUrl: "${appUrl}",
    token: TOKEN_FROM_YOUR_SERVER,
    path: "/today",
  });
</script>`;
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-ink-2">
        Put the whole platform inside your product. Your server signs a short-lived token for the signed-in user; the iframe opens straight into their workspace. Roles come from the token and can never exceed admin.
      </p>
      <div className="relative min-w-0">
        <pre className="max-w-full overflow-x-auto rounded-xl bg-subtle p-4 pt-12 font-mono text-[12.5px] leading-relaxed text-ink-2 sm:pt-4">{snippet}</pre>
        <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={() => copy(snippet)}>
          <Copy size={13} /> Copy
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">Issuer</span>
        <code className="rounded bg-subtle px-2 py-1 font-mono text-[13px]">{slug}</code>
        <span className="ml-3 text-sm text-ink-2">Secret</span>
        <code className="min-w-0 max-w-[260px] truncate rounded bg-subtle px-2 py-1 font-mono text-[13px]">{secret ?? "••••••••••••••••"}</code>
        {secret ? (
          <Button size="sm" variant="ghost" onClick={() => copy(secret)}>
            <Copy size={13} />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await revealSecretAction();
                if (r.ok) setSecret(r.data ?? null);
                else toast.error(r.error);
              })
            }
          >
            <Eye size={13} /> Reveal
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!confirm("Rotate the embed secret? Tokens signed with the old secret stop working, and webhooks must be re-signed.")) return;
              const r = await rotateSecretAction();
              if (r.ok) {
                setSecret(r.data ?? null);
                toast.ok("Secret rotated");
              } else toast.error(r.error);
            })
          }
        >
          <RotateCcw size={13} /> Rotate
        </Button>
      </div>
    </div>
  );
}
