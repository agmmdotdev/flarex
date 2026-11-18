import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { CoreDatabase, CoreNativeBinding } from "../../../src/core/api";
import { makeNativeCommerceInitialization } from "../../../src/frameworks/commerceTransaction/nativeInitialization";

/** Records the trusted database calls; this is an owner witness, not a database proof. */
function recordingDatabase() {
  const identity = { scopeUuid: "11111111-1111-4111-8111-111111111111", epochUuid: "22222222-2222-4222-8222-222222222222",
    sourceKey: "products", sourceSha256: "a".repeat(64), configSha256: "b".repeat(64), provenanceSha256: "c".repeat(64),
    definitionHash: "d".repeat(64) };
  const state = { identity, outcome: { kind: "missing" } as { kind: string; result?: unknown }, bindingReads: 0, resolves: 0 };
  const database: Pick<CoreDatabase, "readNativeBinding" | "resolveRequest" | "recoverRequest"> = {
    readNativeBinding: () => Effect.sync(() => { state.bindingReads += 1;
      return { definition: { identity: state.identity } } as unknown as Effect.Success<ReturnType<CoreDatabase["readNativeBinding"]>>; }),
    resolveRequest: () => Effect.sync(() => { state.resolves += 1;
      return state.outcome as Effect.Success<ReturnType<CoreDatabase["resolveRequest"]>>; }),
    recoverRequest: () => Effect.die(new Error("No claimed initialization in this witness")),
  };
  // The owner reads only these three operations.
  return { database: database as CoreDatabase, state };
}
const input = { stepId: "products.seed", datasetSha256: "e".repeat(64), expectedRowCount: 2 };
const binding = Object.freeze({}) as CoreNativeBinding;

describe("native Commerce initialization readiness", () => {
  it("verifies a committed receipt once while every check still reads the current binding", async () => {
    const { database, state } = recordingDatabase();
    const initialization = await Effect.runPromise(makeNativeCommerceInitialization(database, binding, input));
    expect(await Effect.runPromise(Effect.flip(initialization.requireReady))).toMatchObject({ reason: "seedRequired" });
    expect(state.resolves).toBe(1);
    // A not-ready verdict is never retained.
    state.outcome = { kind: "committed", result: { rowCount: 2 } };
    await Effect.runPromise(initialization.requireReady);
    expect(state.resolves).toBe(2);
    const bindingReads = state.bindingReads;
    await Effect.runPromise(initialization.requireReady);
    await Effect.runPromise(initialization.requireReady);
    expect(state.resolves).toBe(2);
    expect(state.bindingReads).toBe(bindingReads + 4);
  });

  it("still refuses a changed source identity after its receipt was verified", async () => {
    const { database, state } = recordingDatabase();
    state.outcome = { kind: "committed", result: { rowCount: 2 } };
    const initialization = await Effect.runPromise(makeNativeCommerceInitialization(database, binding, input));
    await Effect.runPromise(initialization.requireReady);
    state.identity = { ...state.identity, definitionHash: "f".repeat(64) };
    expect(await Effect.runPromise(Effect.flip(initialization.requireReady))).toMatchObject({ reason: "seedMismatch" });
  });

  it("does not retain a corrupt committed result", async () => {
    const { database, state } = recordingDatabase();
    state.outcome = { kind: "committed", result: { rowCount: 3 } };
    const initialization = await Effect.runPromise(makeNativeCommerceInitialization(database, binding, input));
    expect(await Effect.runPromise(Effect.flip(initialization.requireReady))).toMatchObject({ reason: "storedCorruption" });
    expect(await Effect.runPromise(Effect.flip(initialization.requireReady))).toMatchObject({ reason: "storedCorruption" });
    expect(state.resolves).toBe(2);
  });
});
