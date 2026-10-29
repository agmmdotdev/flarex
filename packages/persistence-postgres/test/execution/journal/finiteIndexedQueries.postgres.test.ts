import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createApplicationNativeMutationPostgresFixture } from "../../application/applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { FINITE_INDEXED_QUERY_OPTIONS, finiteIndexedQueriesScenario } from "./finiteIndexedQueriesScenario";

describe.skipIf(postgresUrl === null)("finite range evidence on ordinary PostgreSQL", () => {
  it("retains the lookahead through a genuine competing finite publication", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({}, {}, "finiteCapture")),
      owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
    const control = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture()),
      owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
    const roles = yield* Effect.tryPromise(() => target.persistence.query<{ superuser: boolean; bypass: boolean }>(
      "select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user",
    ));
    expect(roles.rows).toEqual([{ superuser: false, bypass: false }]);
    const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPostgresFixture(FINITE_INDEXED_QUERY_OPTIONS, {
      control: control.persistence, target: target.persistence,
    }));
    yield* finiteIndexedQueriesScenario(native);
  }))), 120_000);
});
