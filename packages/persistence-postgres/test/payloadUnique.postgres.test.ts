import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makeUniquePayloadFixture, payloadUniqueScenario, concurrentUniqueScenario, uniqueData } from "./payloadUniqueScenario";
import { runEffect } from "./effectTestRuntime";

describe.skipIf(postgresUrl === null)("Payload compound uniqueness (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("executes native constraint failures, pending key reuse and rollback as an ordinary role", () => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeUniquePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    const role = yield* Effect.promise(() => persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user"));
    expect(role.rows[0]?.superuser).toBe(false);
    yield* payloadUniqueScenario(tested);
  })))), 180_000);
  it.each([true, false])("settles concurrent writes with same compound key = %s", sameKey => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeUniquePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    yield* concurrentUniqueScenario(tested, sameKey);
  })))), 120_000);
  it("isolates identical keys in separate scopes", () => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const first = yield* makeUniquePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    const second = yield* makeUniquePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    for (const tested of [first, second]) {
      yield* tested.host.run(tested.host.newRequestKey(), tested.runtime.commands.create,
        { collection: "items", data: uniqueData("same", "same", 1) });
      expect(yield* tested.host.read(tested.runtime.commands.count,
        { collection: "items", where: { category: { equals: "same" }, amount: { equals: 1 } } })).toEqual({ totalDocs: 1 });
      expect((yield* Effect.promise(tested.inventory)).claims).toHaveLength(3);
    }
  })))), 120_000);
});
