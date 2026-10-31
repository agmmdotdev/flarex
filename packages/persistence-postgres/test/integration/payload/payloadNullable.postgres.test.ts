import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { assertNativeConstraintBinding } from "./payloadIndexedFixture";
import { makeNullablePayloadFixture, payloadNullableScenario, concurrentNullableScenario } from "./payloadNullableScenario";
import { runEffect } from "../../support/effectTestRuntime";

const fresh = { kind: "fresh", driver: "postgres" } as const;
describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("Payload nullable keys (ordinary PostgreSQL)", () => {
  it("executes native nullable transitions, queries and rollback", () => runEffect(Effect.scoped(Effect.gen(function* () {
    yield* payloadNullableScenario(yield* makeNullablePayloadFixture(fresh));
  }))), 180_000);
  it.each([true, false])("settles competing optional keys with null = %s", nullKey => runEffect(Effect.scoped(Effect.gen(function* () {
    yield* concurrentNullableScenario(yield* makeNullablePayloadFixture(fresh), nullKey);
  }))), 120_000);
  it("isolates null membership and identical non-null keys on one physical target", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const first = yield* makeNullablePayloadFixture({ ...fresh, instanceName: "nullable-first" },
      { scopeUuid: "45000000-0000-4000-8000-000000000031", epochUuid: "45000000-0000-4000-8000-000000000032" });
    const second = yield* makeNullablePayloadFixture({ kind: "physical", physical: first.core.physical,
      installation: "fresh", instanceName: "nullable-second" },
      { scopeUuid: "45000000-0000-4000-8000-000000000041", epochUuid: "45000000-0000-4000-8000-000000000042" });
    expect(second.core.physical).toBe(first.core.physical);
    for (const tested of [first, second]) {
      yield* assertNativeConstraintBinding(tested);
      const commands = inspectPayloadRuntimeForTest(tested.runtime).commands;
      for (const alias of [null, "same"]) yield* tested.host.run(tested.host.newRequestKey(), commands.create,
        { collection: "items", data: { title: alias ?? "null", category: "red", alias, amount: alias === null ? null : 10 } });
      for (const [field, value] of [["alias", null], ["alias", "same"], ["amount", null], ["amount", 10]] as const)
        expect(yield* tested.host.read(commands.count, { collection: "items", where: {
          ...(field === "amount" ? { category: { equals: "red" } } : {}), [field]: { equals: value },
        } })).toEqual({ totalDocs: 1 });
      expect((yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause })).rows).toHaveLength(2);
    }
  }))), 120_000);
});
