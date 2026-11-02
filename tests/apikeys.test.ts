import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, keyFromAuthHeader, parseApiKey, roleFromScopes, verifyApiKeyHash } from "@/lib/apikeys";

describe("api keys", () => {
  it("generates keys in the documented format", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key).toMatch(/^me_live_[A-Za-z0-9]{12}_[A-Za-z0-9]{32}$/);
    expect(key.startsWith(`me_live_${prefix}_`)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).not.toContain(key.slice(-32));
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey().key));
    expect(keys.size).toBe(500);
  });

  it("parses valid keys and rejects malformed ones", () => {
    const { key, prefix } = generateApiKey();
    expect(parseApiKey(key)).toEqual({ prefix, secret: key.slice(-32) });
    for (const bad of ["", "me_live_short_x", key + "x", key.replace("me_live_", "me_test_"), key.replace(/.$/, "!"), ` ${key}`]) {
      expect(parseApiKey(bad)).toBeNull();
    }
  });

  it("verifies against the stored hash only for the exact key", () => {
    const { key, hash } = generateApiKey();
    expect(verifyApiKeyHash(key, hash)).toBe(true);
    const flipped = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
    expect(verifyApiKeyHash(flipped, hash)).toBe(false);
    expect(verifyApiKeyHash(key, "deadbeef")).toBe(false);
  });

  it("maps scopes to roles, never owner", () => {
    expect(roleFromScopes(["read"])).toBe("viewer");
    expect(roleFromScopes(["read", "write"])).toBe("editor");
    expect(roleFromScopes(["write"])).toBe("editor");
    expect(roleFromScopes(["admin"])).toBe("admin");
    expect(roleFromScopes(["owner"])).toBeNull();
    expect(roleFromScopes([])).toBeNull();
  });

  it("extracts bearer tokens", () => {
    expect(keyFromAuthHeader("Bearer abc")).toBe("abc");
    expect(keyFromAuthHeader("bearer   abc")).toBe("abc");
    expect(keyFromAuthHeader("Basic abc")).toBeNull();
    expect(keyFromAuthHeader("Bearer a b")).toBeNull();
    expect(keyFromAuthHeader(null)).toBeNull();
  });
});
