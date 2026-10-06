import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hasPostgresCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

/** The native owner resets public tables during preparation. Only fresh,
 * privately generated databases may be supplied to it. This Promise adapter
 * deliberately retains native errors rather than inserting timed Effect bridges. */
export async function acquireNativeBusinessResource() {
  const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL?.trim();
  if (provisioningUrl === undefined || provisioningUrl.length === 0)
    throw new Error("FLAREX_POSTGRES_PROVISIONING_DATABASE_URL is required for native comparison");
  const endpoint = new URL(provisioningUrl);
  if (endpoint.protocol !== "postgres:" && endpoint.protocol !== "postgresql:")
    throw new Error("Native comparison requires a PostgreSQL provisioning endpoint");
  const { prepareNativeBusiness } = await import("../../../../../medusa-adapter/benchmarks/core-performance/native-business/native");
  const nonce = randomBytes(16).toString("hex");
  const login = `fx_measure_native_${nonce}`;
  const databases = [`fx_measure_medusa_${nonce}`, `fx_measure_payload_${nonce}`] as const;
  const password = randomBytes(24).toString("base64url");
  const provisioning = new Pool({ connectionString: provisioningUrl, max: 1 });
  const attemptedDatabases = new Set<string>();
  let attemptedLogin = false;
  let resource: Awaited<ReturnType<typeof prepareNativeBusiness>> | undefined;
  let closing: Promise<void> | undefined;
  const cleanup = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    const release = async (work: () => Promise<unknown>) => {
      try { await work(); } catch (cause) { failures.push(cause); }
    };
    // The business owner closes module/native pools before database retirement.
    if (resource !== undefined) await release(resource.dispose);
    for (const database of [...attemptedDatabases].toReversed())
      await release(() => provisioning.query(`drop database if exists ${quoteIdentifier(database)}`));
    if (attemptedLogin) await release(() => provisioning.query(`drop role if exists ${quoteIdentifier(login)}`));
    await release(() => provisioning.end());
    return failures;
  };
  try {
    // Track before awaiting the driver: a rejected transport does not prove the
    // generated CREATE failed to commit. Duplicate-name refusals prove ownership
    // was never acquired and must not retire someone else's matching resource.
    attemptedLogin = true;
    try {
      await provisioning.query(`create role ${quoteIdentifier(login)} login password ${quoteLiteral(password)}
        nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
    } catch (cause) {
      if (hasPostgresCode(cause, "42710")) attemptedLogin = false;
      throw cause;
    }
    for (const database of databases) {
      attemptedDatabases.add(database);
      try {
        await provisioning.query(`create database ${quoteIdentifier(database)} owner ${quoteIdentifier(login)} template template0`);
      } catch (cause) {
        if (hasPostgresCode(cause, "42P04")) attemptedDatabases.delete(database);
        throw cause;
      }
    }
    const ordinaryUrl = (database: string) => {
      const url = new URL(endpoint);
      url.username = login;
      url.password = password;
      url.pathname = `/${database}`;
      // A provisioning URL's role/search_path override cannot enter the native
      // ordinary-login envelope. Preserve transport settings only.
      url.searchParams.delete("options");
      url.searchParams.delete("application_name");
      url.searchParams.delete("user");
      url.searchParams.delete("password");
      return url.toString();
    };
    resource = await prepareNativeBusiness(ordinaryUrl(databases[0]), ordinaryUrl(databases[1]));
    return {
      resource,
      close(): Promise<void> {
        closing ??= cleanup().then(failures => {
          if (failures.length !== 0) throw new AggregateError(failures, "Native comparison cleanup failed");
        });
        return closing;
      },
    };
  } catch (cause) {
    const failures = await cleanup();
    if (failures.length !== 0) throw new AggregateError([cause, ...failures], "Native comparison acquisition and cleanup failed");
    throw cause;
  }
}
