/**
 * Whether the web process should drain queued jobs right after a response (single-box and
 * local development). Off by default in production: a web restart or a serverless freeze
 * would kill a model call halfway. Production runs the dedicated worker (`pnpm worker`).
 */
export function inlineWorkerEnabled() {
  const v = process.env.ME_INLINE_WORKER;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV !== "production";
}
