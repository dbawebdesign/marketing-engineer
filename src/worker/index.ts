/**
 * Background worker: runs scheduled agents and processes the job queue.
 * Scale horizontally by running more copies; the queue uses SKIP LOCKED.
 */
process.env.ME_PROCESS_ROLE ??= "worker";
import { hostname } from "node:os";
import { shutdown, tick } from "@/server/worker-core";
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

for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    stopping = true;
    shutdown.abort(); // stop in-flight model calls; their jobs and runs go back to the queue
  });
// Liveness for the worker container (no HTTP server): touch a heartbeat file every loop.
const HEARTBEAT = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/me-worker-heartbeat";
setInterval(() => void import("node:fs").then((fs) => fs.writeFileSync(HEARTBEAT, String(Date.now()))).catch(() => {}), 10_000).unref();
void loop();
