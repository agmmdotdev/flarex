import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { makeNullablePayloadFixture, payloadNullableScenario, concurrentNullableScenario } from "./payloadNullableScenario";
import { runEffect } from "../../support/effectTestRuntime";

describe.skipIf(postgresUrl === null)("Payload nullable keys (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("executes nullable key transitions, queries and rollback as an ordinary role", () => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeNullablePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    const role = yield* Effect.promise(() => persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user"));
    expect(role.rows[0]?.superuser).toBe(false);
    yield* payloadNullableScenario(tested);
  })))), 180_000);
  it.each([true, false])("settles competing optional keys with null = %s", nullKey => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const tested = yield* makeNullablePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    yield* concurrentNullableScenario(tested, nullKey);
  })))), 120_000);
  it("isolates null membership and identical non-null keys across scopes", () => withPersistence(persistence => runEffect(Effect.scoped(Effect.gen(function* () {
    const first = yield* makeNullablePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    const second = yield* makeNullablePayloadFixture(persistence, makePostgresRelationalSession(persistence));
    for (const tested of [first, second]) {
      for (const alias of [null, "same"]) yield* tested.host.run(tested.host.newRequestKey(), inspectPayloadRuntimeForTest(tested.runtime).commands.create,
        { collection: "items", data: { title: alias ?? "null", category: "red", alias, amount: alias === null ? null : 10 } });
      expect(yield* tested.host.read(inspectPayloadRuntimeForTest(tested.runtime).commands.count, { collection: "items", where: { alias: { equals: null } } })).toEqual({ totalDocs: 1 });
      expect((yield* Effect.promise(tested.inventory)).claims).toHaveLength(4);
    }
  })))), 120_000);
});
