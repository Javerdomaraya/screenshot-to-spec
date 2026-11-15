import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { SchoolDatabase } from "../db/database";
import { CatalogError } from "./catalog";

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;
const USERNAME = "admin" as const;

type PasswordRecord = { salt: string; password_hash: string };
export type AdminAuthStatus = {
  configured: boolean;
  authenticated: boolean;
  username: typeof USERNAME;
};

function validatePassword(input: unknown): string {
  if (typeof input !== "string" || input.length < 12 || input.length > 256)
    throw new CatalogError("INVALID_INPUT", "Password must be 12 characters or longer (maximum 256).");
  return input;
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/** Session state belongs to Electron's main process, never to localStorage.
 * The single offline admin uses the operating system's per-user SQLite file.
 */
export function createAdminAuthService(db: SchoolDatabase) {
  let signedIn = false;
  let attempts = 0;
  let lockedUntil = 0;
  const credentials = () =>
    db.prepare("SELECT salt, password_hash FROM admin_credentials WHERE singleton=1")
      .get() as PasswordRecord | undefined;
  const authenticated = () => signedIn && Boolean(credentials());
  const status = (): AdminAuthStatus => ({
    configured: Boolean(credentials()),
    authenticated: authenticated(),
    username: USERNAME,
  });

  const setup = async (input: unknown): Promise<AdminAuthStatus> => {
    if (credentials()) throw new CatalogError("ALREADY_CONFIGURED", "The administrator account is already configured.");
    const password = validatePassword(input);
    const salt = randomBytes(32);
    const hash = await derive(password, salt);
    db.transaction(() => {
      if (credentials()) throw new CatalogError("ALREADY_CONFIGURED", "The administrator account is already configured.");
      db.prepare(
        "INSERT INTO admin_credentials(singleton,username,salt,password_hash) VALUES(1,?,?,?)",
      ).run(USERNAME, salt.toString("base64"), hash.toString("base64"));
    }).immediate();
    signedIn = true;
    attempts = 0;
    lockedUntil = 0;
    return status();
  };

  const signIn = async (input: unknown): Promise<AdminAuthStatus> => {
    const row = credentials();
    if (!row) throw new CatalogError("SETUP_REQUIRED", "Create an administrator password first.");
    if (Date.now() < lockedUntil)
      throw new CatalogError("RATE_LIMITED", "Too many attempts. Try again in one minute.");
    // Never leak the configured password length or saved password hash.
    const password = typeof input === "string" && input.length <= 256 ? input : "";
    const actual = await derive(password, Buffer.from(row.salt, "base64"));
    const expected = Buffer.from(row.password_hash, "base64");
    const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!valid) {
      signedIn = false;
      attempts += 1;
      if (attempts >= MAX_FAILURES) lockedUntil = Date.now() + LOCK_MS;
      throw new CatalogError("INVALID_CREDENTIALS", "Invalid password.");
    }
    signedIn = true;
    attempts = 0;
    lockedUntil = 0;
    return status();
  };

  const logout = (): AdminAuthStatus => {
    signedIn = false;
    return status();
  };
  return { setup, signIn, logout, status, authenticated };
}
