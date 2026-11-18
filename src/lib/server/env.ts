/**
 * Server-only configuration. The secret key and PIN pepper are read from the
 * environment (Vercel project settings) and never sent to the browser.
 */
export class ConfigError extends Error {}

export function serverEnv() {
  if (typeof window !== "undefined") throw new ConfigError("serverEnv() must only run on the server");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const pepper = process.env.INFRAREPORT_PIN_PEPPER;
  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !publishable && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    !secret && "SUPABASE_SECRET_KEY",
    !pepper && "INFRAREPORT_PIN_PEPPER",
  ].filter(Boolean) as string[];
  if (missing.length) throw new ConfigError(`Server is missing configuration: ${missing.join(", ")}`);
  if (pepper!.length < 32) throw new ConfigError("INFRAREPORT_PIN_PEPPER must be at least 32 characters");
  return { url: url!, publishable: publishable!, secret: secret!, pepper: pepper! };
}
