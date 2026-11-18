import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, readServerConfig, serverEnv } from "@/lib/server/env";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "INFRAREPORT_PIN_PEPPER"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const set = (v: Partial<Record<(typeof KEYS)[number], string | undefined>>) => { for (const k of KEYS) { if (v[k] === undefined) delete process.env[k]; else process.env[k] = v[k]; } };
const good = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_y", INFRAREPORT_PIN_PEPPER: "p".repeat(32) };
afterEach(() => set(saved));

describe("server configuration (shared by /api/health and the sign-in routes)", () => {
  it("accepts a complete configuration", () => {
    set(good);
    expect(readServerConfig().problems).toEqual([]);
    expect(serverEnv().secret).toBe("sb_secret_y");
  });
  it("ignores spaces, line breaks and quotes pasted with a value", () => {
    set({ ...good, SUPABASE_SECRET_KEY: '  "sb_secret_y"\n', INFRAREPORT_PIN_PEPPER: ` ${"p".repeat(32)}\n` });
    expect(serverEnv()).toMatchObject({ secret: "sb_secret_y", pepper: "p".repeat(32) });
  });
  it("names exactly what is wrong, never the value", () => {
    set({ ...good, SUPABASE_SECRET_KEY: "sb_publishable_x", INFRAREPORT_PIN_PEPPER: "short" });
    const { problems } = readServerConfig();
    expect(problems).toEqual(["SUPABASE_SECRET_KEY contains the publishable key; it must be a secret key (sb_secret_...)", "INFRAREPORT_PIN_PEPPER is 5 characters; it needs at least 32"]);
    expect(() => serverEnv()).toThrow(ConfigError);
  });
  it("a value that is only whitespace counts as missing", () => {
    set({ ...good, SUPABASE_SECRET_KEY: "   " });
    expect(readServerConfig().problems).toEqual(["SUPABASE_SECRET_KEY is missing"]);
  });
  it("rejects the legacy anon JWT as the secret key", () => {
    const jwt = ["e30", Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url"), "sig"].join(".");
    set({ ...good, SUPABASE_SECRET_KEY: jwt });
    expect(readServerConfig().problems[0]).toMatch(/legacy anon key/);
  });
});
