import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

type ScryptOpts = { N: number; r: number; p: number; maxmem: number };
const scrypt = (pw: Buffer, salt: Buffer, keylen: number, opts: ScryptOpts) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

/** The shared first-time PIN. Accepted ONLY together with a valid, unexpired, unused activation token. */
export const TEMP_PIN = "12345";
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;

/** Personal PIN rules: 4 to 6 digits (6 recommended), not the temporary PIN, not trivially guessable. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "PIN must be 4 to 6 digits.";
  if ([TEMP_PIN, "1234", "123456", "654321", "4321"].includes(pin)) return "Choose a PIN that is not a simple sequence.";
  if (/^(\d)\1+$/.test(pin)) return "PIN cannot repeat one digit.";
  return null;
}

/** scrypt over HMAC(pepper, pin): a database leak alone is not enough to brute-force PINs offline. */
export async function hashPin(pin: string, pepper: string): Promise<string> {
  const salt = randomBytes(16);
  const peppered = createHmac("sha256", pepper).update(pin).digest();
  const hash = await scrypt(peppered, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined, pepper: string): Promise<boolean> {
  if (!stored) return false;
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const peppered = createHmac("sha256", pepper).update(pin).digest();
  const actual = await scrypt(peppered, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
