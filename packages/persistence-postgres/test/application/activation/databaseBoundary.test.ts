import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { query as activationQuery } from "../../../src/application/activation/databaseBoundary";
import { ApplicationActivationError } from "../../../src/application/activation/errors";
import {
  execute as readinessExecute,
  query as readinessQuery,
} from "../../../src/application/readiness/databaseBoundary";
import { ApplicationReadinessError } from "../../../src/application/readiness/errors";
import { runEffectFailure } from "../../support/effectTestRuntime";

const client = new PGlite();
const database = drizzle(client);
const states = [
  { code: "40001", retryable: true },
  { code: "40P01", retryable: true },
  { code: "42P01", retryable: false },
] as const;

/** This executes the actual Drizzle statement once and observes its genuine
 * rejection. The same native-execution promise retains that exact error object
 * when the Application owner awaits it; no provider error is manufactured. */
async function rejectedNativeStatement<Value>(statement: PromiseLike<Value>) {
  const nativeExecution = Promise.resolve(statement);
  const cause = await nativeExecution.then(
    () => { throw new Error("Native PostgreSQL fault statement unexpectedly succeeded"); },
    (error: unknown) => error,
  );
  expect(cause).toBeInstanceOf(DrizzleQueryError);
  if (!(cause instanceof DrizzleQueryError)) throw new Error("Expected actual Drizzle provider envelope");
  return { nativeExecution, cause };
}

describe("Application native Drizzle statement failure boundary", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await client.exec(`
      create function application_boundary_raise_sqlstate(state text) returns integer
      language plpgsql as $body$
      begin
        raise exception using errcode = state, message = 'Application native statement fault';
      end
      $body$;
    `);
  });

  afterAll(async () => { await client.close(); });

  it.each(states)("retains and classifies native $code through Activation query", async ({ code, retryable }) => {
    const native = await rejectedNativeStatement(database.select({
      value: sql<number>`application_boundary_raise_sqlstate(${code})`,
    }).from(sql`(values (1)) as native_boundary_source(value)`));
    expect(native.cause.cause).toMatchObject({ code, message: "Application native statement fault" });
    expect(Reflect.get(native.cause, "code")).toBeUndefined();

    const failure = await runEffectFailure(activationQuery(native.nativeExecution, "activate", "native_fault_revision"));
    expect(failure).toBeInstanceOf(ApplicationActivationError);
    expect(failure.cause).toBe(native.cause);
    expect(failure).toMatchObject({ operation: "activate", reason: "resourceFailure", revisionId: "native_fault_revision" });
    expect(failure.retryable).toBe(retryable);
  });

  it.each(states)("retains and classifies native $code through Readiness query", async ({ code, retryable }) => {
    const native = await rejectedNativeStatement(database.select({
      value: sql<number>`application_boundary_raise_sqlstate(${code})`,
    }).from(sql`(values (1)) as native_boundary_source(value)`));
    expect(native.cause.cause).toMatchObject({ code, message: "Application native statement fault" });

    const failure = await runEffectFailure(readinessQuery(native.nativeExecution));
    expect(failure).toBeInstanceOf(ApplicationReadinessError);
    expect(failure.cause).toBe(native.cause);
    expect(failure).toMatchObject({ reason: "resourceFailure", operation: "settle" });
    expect(failure.retryable).toBe(retryable);
  });

  it.each(states)("retains and classifies native $code through Readiness execute", async ({ code, retryable }) => {
    const native = await rejectedNativeStatement(database.execute(
      sql`select application_boundary_raise_sqlstate(${code})`,
    ));
    expect(native.cause.cause).toMatchObject({ code, message: "Application native statement fault" });

    const failure = await runEffectFailure(readinessExecute(native.nativeExecution));
    expect(failure).toBeInstanceOf(ApplicationReadinessError);
    expect(failure.cause).toBe(native.cause);
    expect(failure).toMatchObject({ reason: "resourceFailure", operation: "settle" });
    expect(failure.retryable).toBe(retryable);
  });
});
