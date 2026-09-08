import { expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { acceptPreparedInstallation, prepareInstallationRuntime } from "../src/frameworkSchema/installation/runtime";
import { postgresUrl, createFileScopedPostgresFixture } from "./postgresHelpers";
import { createInstallationRuntimeFixture, exerciseInstallationRuntime } from "./frameworkInstallationRuntimeTestSupport";
import { runEffect } from "./effectTestRuntime";

it.skipIf(postgresUrl === null)("compares fresh installation evidence after preparation on PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try { await exerciseInstallationRuntime(fixture.persistence.drizzle); }
  finally { await fixture.dispose(); }
}, 180_000);

it.skipIf(postgresUrl === null)("settles cancelled preparation and isolates concurrent prepared instances", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try {
    const runtime = await createInstallationRuntimeFixture(fixture.persistence.drizzle);
    const [first, second] = await Promise.all([runtime.prepare(), runtime.prepare()]);
    expect(first).not.toBe(second);
    expect(await runtime.accept(first)).toEqual(await runtime.accept(second));
    const client = await fixture.persistence.pool.connect();
    try {
      await client.query("begin");
      await client.query("select installation_storage_id from fx_system_framework_schema_availability_head where installation_storage_id = $1 for update",
        [runtime.stored.installation.storageId.toString()]);
      const abort = new AbortController();
      // An acquired connection proves the Promise transaction has started. Abort
      // must still await rollback/settlement rather than abandon that connection.
      fixture.persistence.pool.once("acquire", () => abort.abort());
      const exit = await Effect.runPromiseExit(prepareInstallationRuntime(fixture.persistence.drizzle, runtime.target, runtime.reference), { signal: abort.signal });
      expect(Exit.isFailure(exit)).toBe(true);
      expect(fixture.persistence.pool.totalCount - fixture.persistence.pool.idleCount).toBe(1);
    } finally {
      try { await client.query("rollback"); } finally { client.release(); }
    }
    expect(await runtime.accept(await runtime.prepare())).toEqual(await runtime.accept());
    expect(fixture.persistence.pool.totalCount - fixture.persistence.pool.idleCount).toBe(0);
  } finally { await fixture.dispose(); }
}, 180_000);

it.skipIf(postgresUrl === null)("holds prepared acceptance protection through transaction settlement", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try {
    const runtime = await createInstallationRuntimeFixture(fixture.persistence.drizzle);
    const client = await fixture.persistence.pool.connect();
    const update = "update fx_system_framework_schema_availability_head set status = status where installation_storage_id = $1";
    const parameters = [runtime.stored.installation.storageId.toString()];
    try {
      await fixture.persistence.drizzle.transaction(async tx => {
        await runEffect(acceptPreparedInstallation(runtime.prepared, runtime.target, runtime.reference, tx));
        await client.query("begin");
        try {
          await client.query("set local lock_timeout = '100ms'");
          await expect(client.query(update, parameters)).rejects.toMatchObject({ code: "55P03" });
        } finally { await client.query("rollback"); }
      });
      expect((await client.query(update, parameters)).rowCount).toBe(1);
    } finally { client.release(); }
  } finally { await fixture.dispose(); }
}, 180_000);
