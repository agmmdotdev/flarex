import { Data, Result, Schema } from "effect";
import { sql, type Logger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Database } from "./persistence.ts";
import * as tables from "./schema.ts";

export interface Session { readonly run: <A>(work: (database: Database) => Promise<A>) => Promise<A> }
export class PhysicalFailure extends Data.TaggedError("PhysicalFailure")<{
  readonly phase: "acquire" | "begin" | "work" | "commit" | "rollback" | "release";
  readonly cause: unknown;
  readonly cleanupCause?: unknown;
}> {}

/** Own checkout from before BEGIN through rollback/drain and release. Drizzle
 * 0.45.2's pooled transaction helper does not release on failed BEGIN and can
 * replace a commit/work error with rollback error. All control SQL still uses
 * Drizzle, on one private checked-out client. There is no native callback here. */
export function postgresSession(pool: Pool, logger?: Logger,
  beforeBegin?: (backendPid: number) => Promise<void>): Session {
  return { run: async work => {
    const client = await pool.connect().catch(cause => { throw new PhysicalFailure({ phase: "acquire", cause }); });
    const database = drizzle(client, { schema: tables, ...(logger === undefined ? {} : { logger }) });
    let phase: PhysicalFailure["phase"] = "begin";
    let outcome: Result.Result<Awaited<ReturnType<typeof work>>, unknown>;
    let transportFailed = false;
    const onError = () => { transportFailed = true; };
    client.on("error", onError);
    try {
      if (beforeBegin !== undefined) {
        const result = await database.execute(sql`select pg_backend_pid() as pid`);
        const pid = Schema.decodeUnknownSync(Schema.Number)(result.rows[0]?.pid);
        await beforeBegin(pid);
      }
      await database.execute(sql`begin`);
      phase = "work";
      const result = await work(database);
      phase = "commit";
      await database.execute(sql`commit`);
      outcome = Result.succeed(result);
    } catch (cause) {
      let cleanupCause: unknown;
      if (phase !== "begin") {
        try { await database.execute(sql`rollback`); }
        catch (rollback) { cleanupCause = rollback; }
      }
      outcome = Result.fail(phase === "work" && cleanupCause === undefined ? cause :
        new PhysicalFailure({ phase, cause, ...(cleanupCause === undefined ? {} : { cleanupCause }) }));
    }
    try { client.release(Result.isFailure(outcome) || transportFailed); }
    catch (cause) {
      const original = outcome;
      outcome = Result.fail(new PhysicalFailure({ phase: "release", cause,
        ...(Result.isFailure(original) ? { cleanupCause: original.failure } : {}) }));
    } finally { client.removeListener("error", onError); }
    // Required Promise boundary: fold the complete resource outcome once.
    return Result.match(outcome, { onSuccess: value => value, onFailure: cause => { throw cause; } });
  } };
}
