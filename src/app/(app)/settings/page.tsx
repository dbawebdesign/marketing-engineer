import { requireCtx } from "@/server/web/session";
import { listMembers, tenantSettings } from "@/server/services/tenants";
import { listApiKeys } from "@/lib/apikeys";
import { aiEnabled } from "@/lib/ai/provider";
import { canDo } from "@/lib/ctx";
import { ApiKeys, EmbedPanel, WorkspaceForm } from "@/components/settings-panels";
import { CopyButton } from "@/components/copy-button";
import { Badge, Dot, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const admin = canDo(ctx, "settings:manage");
  const [t, members, keys] = await Promise.all([tenantSettings(ctx), listMembers(ctx), admin ? listApiKeys(ctx) : []]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const ai = aiEnabled();
  const row = "grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line py-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10";
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
        {admin ? (
          <div className={row}>
            {head("Workspace", "Name and where it can be embedded.")}
            <WorkspaceForm name={t.name} origins={t.allowed_origins} canManage={admin} />
          </div>
        ) : null}
        <div className={row}>
          {head("Intelligence", "What powers your agents.")}
          <div className="text-[14px]">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Dot tone={ai ? "accent" : "warn"} />
              {ai ? "Claude is connected" : "Agents are running in offline mode"}
            </p>
            {ai ? (
              <p className="mt-1.5 max-w-xl text-ink-2">
                Customer truth, AI search and the Growth cockpit use Claude&rsquo;s deepest model for judgment. Drafting agents use a faster one.
              </p>
            ) : admin ? (
              <>
                <p className="mt-1.5 max-w-xl text-ink-2">
                  Add <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[13px] text-ink">ANTHROPIC_API_KEY</code> to the server environment to switch agents from the
                  offline engine to Claude. Offline mode still checks every receipt.
                </p>
                <CopyButton text="ANTHROPIC_API_KEY" label="Copy variable name" className="mt-3" />
              </>
            ) : (
              <p className="mt-1.5 max-w-xl text-ink-2">Ask an admin to connect Claude for full-quality output. Offline mode still checks every receipt.</p>
            )}
          </div>
        </div>
        {members.length ? (
          <div className={row}>
            {head("People", "Who can see and approve work here.")}
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="grid size-7 place-items-center rounded-full bg-subtle text-xs font-semibold text-ink-2">
                    {(m.name || m.email).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name || m.email}</p>
                    <p className="truncate text-xs text-ink-3">{m.external ? "Via embed" : m.email}</p>
                  </div>
                  <Badge>{m.role}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
