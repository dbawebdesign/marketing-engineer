"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { loadDemoAction } from "@/app/(app)/actions";
import { Button } from "./ui";
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
            toast.ok(`Loaded ${r.data?.inserted ?? 0} sample signals`);
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending ? <LoaderCircle size={14} className="animate-spin" /> : null}
      Load sample data
    </Button>
  );
}
