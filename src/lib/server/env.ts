/**
 * Server-only configuration. The secret key and PIN pepper are read from the
 * environment (Vercel project settings) and never sent to the browser.
 *
 * The health check and every API route use the SAME function below, so the
 * health page can never report "fine" while sign-in reports "not configured".
 * Only setting NAMES and short reasons are ever reported, never values.
 */
export class ConfigError extends Error {
  constructor(public problems: string[]) { super(`Server configuration: ${problems.join("; ")}`); }
}

/** Trim whitespace, line breaks and wrapping quotes that often come along with copy and paste. */
function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

function jwtRole(v: string): string | null {
  const parts = v.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role ?? null; } catch { return null; }
}

export interface ServerConfig { url: string; publishable: string; secret: string; pepper: string }

export function readServerConfig(): { values: ServerConfig; problems: string[]; present: Record<string, boolean> } {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishable = clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const secret = clean(process.env.SUPABASE_SECRET_KEY);
  const pepper = clean(process.env.INFRAREPORT_PIN_PEPPER);
  const problems: string[] = [];

  if (!url) problems.push("NEXT_PUBLIC_SUPABASE_URL is missing");
  else if (!/^https?:\/\/[^\s/]+/.test(url)) problems.push("NEXT_PUBLIC_SUPABASE_URL is not a URL");

  if (!publishable) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing");
  else if (publishable.startsWith("sb_secret_")) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a SECRET key; it must be the publishable key");

  if (!secret) problems.push("SUPABASE_SECRET_KEY is missing");
  else if (secret.startsWith("sb_publishable_")) problems.push("SUPABASE_SECRET_KEY contains the publishable key; it must be a secret key (sb_secret_...)");
  else if (jwtRole(secret) === "anon") problems.push("SUPABASE_SECRET_KEY contains the legacy anon key; it must be a secret key (sb_secret_...)");
  else if (secret === publishable) problems.push("SUPABASE_SECRET_KEY is the same value as the publishable key");

  if (!pepper) problems.push("INFRAREPORT_PIN_PEPPER is missing");
  else if (pepper.length < 32) problems.push(`INFRAREPORT_PIN_PEPPER is ${pepper.length} characters; it needs at least 32`);

  return {
    values: { url, publishable, secret, pepper },
    problems,
    present: { supabaseUrl: !!url, publishableKey: !!publishable, secretKey: !!secret, pinPepper: pepper.length >= 32 },
  };
}

export function serverEnv(): ServerConfig {
  const { values, problems } = readServerConfig();
  if (problems.length) throw new ConfigError(problems);
  return values;
}

/** Which deployment answered (not secret: the preview host and commit), to rule out testing an older deployment. */
export function deploymentInfo() {
  return {
    deployment: process.env.VERCEL_URL ?? "local",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  };
}
