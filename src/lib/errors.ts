export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You don't have permission to do that") => new AppError(403, "forbidden", msg);
export const unauthorized = () => new AppError(401, "unauthorized", "Sign in required");
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const tooMany = () => new AppError(429, "rate_limited", "Too many requests, slow down");
