"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play } from "lucide-react";
import { moveExperimentAction } from "@/app/(app)/actions-extra";
import { Button } from "./ui";
import { toast } from "./toast";

/** Starts a queued test. */
export function StartTestButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="primary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await moveExperimentAction(id, "start");
          if (!r.ok) return void toast.error(r.error, { key: `exp:${id}` });
          toast.ok("Test started", { key: `exp:${id}` });
          router.refresh();
        })
      }
    >
      {pending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Play size={12} className="fill-current" aria-hidden />}
      Start test
    </Button>
  );
}
