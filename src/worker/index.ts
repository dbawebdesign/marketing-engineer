/**
 * Background worker: runs scheduled agents and processes the job queue.
 * Scale horizontally by running more copies; the queue uses SKIP LOCKED.
 */
import { hostname } from "node:os";
import { tick } from "@/server/worker-core";
import { pools } from "@/lib/db";

const id = `${hostname()}:${process.pid}`;
const INTERVAL = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
let stopping = false;

async function loop() {
  console.log(`[worker ${id}] started`);
  while (!stopping) {
    try {
      const n = await tick(id);
      if (n > 0) continue; // keep draining while there is work
    } catch (e) {
      console.error("[worker] tick failed", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
  await pools().app.end();
  await pools().sys.end();
  console.log(`[worker ${id}] stopped`);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stopping = true));
void loop();
