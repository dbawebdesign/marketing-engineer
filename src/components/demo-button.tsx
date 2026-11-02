"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { loadDemoAction } from "@/app/(app)/actions";
import { Button, plural } from "./ui";
import { toast } from "./toast";

export function DemoButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await loadDemoAction();
          if (r.ok) {
            toast.ok(`Loaded ${plural(r.data?.inserted ?? 0, "sample signal")}`);
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : null}
      {pending ? "Loading samples…" : "Load sample data"}
    </Button>
  );
}
