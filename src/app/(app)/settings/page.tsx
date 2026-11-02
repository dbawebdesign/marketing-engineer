import { requireCtx } from "@/server/web/session";
import { listMembers, tenantSettings } from "@/server/services/tenants";
import { listApiKeys } from "@/lib/apikeys";
import { aiEnabled, MODELS } from "@/lib/ai/provider";
import { can } from "@/lib/rbac";
import { ApiKeys, EmbedPanel, WorkspaceForm } from "@/components/settings-panels";
import { Badge, Dot, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const admin = can(ctx.role, "settings:manage");
  const [t, members, keys] = await Promise.all([tenantSettings(ctx), listMembers(ctx), admin ? listApiKeys(ctx) : []]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const ai = aiEnabled();
  const row = "grid gap-4 border-t border-line py-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10";
  const head = (title: string, sub: string) => (
    <div>
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{sub}</p>
    </div>
  );

  return (
    <div className="animate-in">
      <PageHeader title="Settings" />
      <Section>
        <div className={row}>
          {head("Workspace", "Name and where it can be embedded.")}
          <WorkspaceForm name={t.name} origins={t.allowed_origins} canManage={admin} />
        </div>
        <div className={row}>
          {head("Intelligence", "The models your agents use.")}
          <div className="text-sm">
            <p className="flex items-center gap-2">
              <Dot tone={ai ? "accent" : "warn"} />
              {ai ? "Claude is connected." : "Running on the offline engine (no Claude API key on this server)."}
            </p>
            <p className="mt-2 text-ink-2">
              Deep work (truth synthesis, AI search, cockpit): <code className="font-mono text-[13px]">{MODELS.deep}</code>. Fast drafting (content, outbound, creative): <code className="font-mono text-[13px]">{MODELS.fast}</code>.
            </p>
            {!ai ? <p className="mt-2 text-ink-3">Set ANTHROPIC_API_KEY on the server for judgment-quality synthesis. The offline engine still verifies every receipt.</p> : null}
          </div>
        </div>
        <div className={row}>
          {head("People", "Who can see and approve work here.")}
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="grid size-7 place-items-center rounded-full bg-subtle text-xs font-semibold text-ink-2">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name || m.email}</p>
                  <p className="truncate text-xs text-ink-3">{m.external ? "Via embed" : m.email}</p>
                </div>
                <Badge>{m.role}</Badge>
              </li>
            ))}
          </ul>
        </div>
        {admin ? (
          <>
            <div className={row}>
              {head("API keys", "Send signals and metrics from your stack, or run agents from your own code.")}
              <ApiKeys keys={keys} />
            </div>
            <div className={row}>
              {head("Embed", "Run Marketing Engineer inside your own product.")}
              <EmbedPanel slug={t.slug} appUrl={appUrl} />
            </div>
          </>
        ) : null}
      </Section>
    </div>
  );
}
