import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-16">
      <div className="w-full max-w-[380px] animate-in">
        <div className="mb-10 flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Marketing Engineer</span>
        </div>
        {children}
      </div>
    </main>
  );
}
