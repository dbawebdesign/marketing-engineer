import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(pw: string) {
  return hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(h: string, pw: string) {
  try {
    return await verify(h, pw);
  } catch {
    return false;
  }
}
