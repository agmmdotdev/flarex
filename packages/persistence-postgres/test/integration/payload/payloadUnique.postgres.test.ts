import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { assertNativeConstraintBinding, decodeIndexedDocument } from "./payloadIndexedFixture";
import { makeUniquePayloadFixture, payloadUniqueScenario, concurrentUniqueScenario, uniqueData, assertUniqueOwners } from "./payloadUniqueScenario";
import { runEffect } from "../../support/effectTestRuntime";

const fresh = { kind: "fresh", driver: "postgres" } as const;
describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("Payload compound uniqueness (ordinary PostgreSQL)", () => {
  it("executes native constraint failures, pending key reuse and rollback", () => runEffect(Effect.scoped(Effect.gen(function* () {
    yield* payloadUniqueScenario(yield* makeUniquePayloadFixture(fresh));
  }))), 180_000);
  it.each([true, false])("settles concurrent writes with same compound key = %s", sameKey => runEffect(Effect.scoped(Effect.gen(function* () {
    yield* concurrentUniqueScenario(yield* makeUniquePayloadFixture(fresh), sameKey);
  }))), 120_000);
  it("isolates identical keys in two app instances of the same physical target", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const first = yield* makeUniquePayloadFixture({ ...fresh, instanceName: "unique-first" },
      { scopeUuid: "45000000-0000-4000-8000-000000000011", epochUuid: "45000000-0000-4000-8000-000000000012" });
    const second = yield* makeUniquePayloadFixture({ kind: "physical", physical: first.core.physical,
      installation: "fresh", instanceName: "unique-second" },
      { scopeUuid: "45000000-0000-4000-8000-000000000021", epochUuid: "45000000-0000-4000-8000-000000000022" });
    expect(second.core.physical).toBe(first.core.physical);
    expect(second.core.instanceName).not.toBe(first.core.instanceName);
    for (const tested of [first, second]) {
      yield* assertNativeConstraintBinding(tested);
      const data = uniqueData("same", "same", 1);
      const created = decodeIndexedDocument(yield* tested.host.run(tested.host.newRequestKey(),
        inspectPayloadRuntimeForTest(tested.runtime).commands.create, { collection: "items", data }));
      yield* assertUniqueOwners(tested, [{ id: created.id, data }]);
      expect((yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause })).rows).toHaveLength(1);
    }
  }))), 120_000);
});
