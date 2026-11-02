import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { currentSession, isEmbed, requireCtx } from "@/server/web/session";
import { userTenants } from "@/server/services/tenants";
import { pendingCount } from "@/server/services/drafts";
import { listAgents } from "@/server/services/agents";
import { BaseProvider, SidebarNav, TopNav } from "@/components/nav";
import { WorkspaceMenu } from "@/components/workspace-menu";
import { CommandPalette } from "@/components/palette";
import { Toaster } from "@/components/toast";
import { Kbd } from "@/components/ui";
import { PaletteTrigger } from "@/components/palette-trigger";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const session = (await currentSession())!;
  if (!session.tenant) redirect("/login");
  const embed = await isEmbed();
  const [tenants, inbox, agents] = await Promise.all([embed ? [] : userTenants(session.userId), pendingCount(ctx), listAgents(ctx)]);
  const palette = <CommandPalette agents={agents.map((a) => ({ id: a.id, name: a.name }))} />;

  if (embed) {
    return (
      <BaseProvider base="/embed">
        <div className="min-h-dvh">
          <div className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
            <TopNav inboxCount={inbox} />
          </div>
          <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
        </div>
        {palette}
        <Toaster />
      </BaseProvider>
    );
  }

  return (
    <BaseProvider base="">
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line px-3 py-3 lg:flex">
          <WorkspaceMenu current={{ id: session.tenant.id, name: session.tenant.name }} tenants={tenants} user={{ name: session.name, email: session.email }} />
          <PaletteTrigger className="mb-4 mt-2 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-3 ring-1 ring-line hover:bg-subtle">
            <Search size={14} />
            <span className="flex-1 text-left">Search</span>
            <Kbd>⌘K</Kbd>
          </PaletteTrigger>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav inboxCount={inbox} />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur lg:hidden">
            <TopNav inboxCount={inbox} />
          </div>
          <main className="mx-auto max-w-[1080px] px-5 py-10 sm:px-10">{children}</main>
        </div>
      </div>
      {palette}
      <Toaster />
    </BaseProvider>
  );
}
