import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runEffect } from "../../support/effectTestRuntime";
import { postgresUrl } from "../../support/postgresHelpers";
import { createSessionJournalStorePostgresFixture } from "./journalFixture";
import { durableApplicationAdmissionSettlementScenario } from "./durableApplicationAdmissionSettlementScenario";

describe.skipIf(postgresUrl === null)("durable compound mixed settlement on ordinary PostgreSQL", () => {
  it("preserves real admission refusal plus settled transport rejection", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(Effect.tryPromise(createSessionJournalStorePostgresFixture),
      owner => Effect.tryPromise(owner.close).pipe(Effect.orDie));
    expect((yield* Effect.tryPromise(() => fixture.persistence.query<{ superuser: boolean; bypass: boolean }>(
      "select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user"))).rows)
      .toEqual([{ superuser: false, bypass: false }]);
    yield* durableApplicationAdmissionSettlementScenario(fixture);
  }))), 120_000);
});
