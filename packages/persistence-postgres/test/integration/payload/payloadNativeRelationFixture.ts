import { Effect, Exit, Fiber, Result } from "effect";
import { expect } from "vitest";
import type { CoreError, CoreNativeOperations, CoreReadToken } from "../../../src/core/api";
import type { CoreWriteBatch } from "../../../src/core/contracts";
import { CoreWriteLog, indexKeysFromWrites } from "../../../src/core/writeLog";
import { getCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import type { CorePayloadFixture, CorePayloadSuccessor } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { coreNativeTestBudget } from "../../core/nativeTestBudget";
import { coreNativeFixtureData } from "../../core/nativeFixtureInventory";
import type { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";

/** External trusted query root, confined by the actual installed native binding. */
export const readNativePayload = Effect.fn("PayloadRelationsTest.readNative")(function* <A>(
  fixture: CorePayloadFixture, read: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>,
) {
  const command = getCmsCommand(inspectPayloadRuntimeForTest(fixture.runtime).commands.findByID);
  if (command === undefined) return yield* Effect.die(new Error("Missing genuine native read command"));
  return yield* Effect.acquireUseRelease(fixture.database.beginNative(fixture.binding,
    { commandName: command.name, ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
    const value = yield* read(operation.operations);
    return { value, token: yield* operation.finishRead() };
  }), operation => operation.abort());
});

/** Use the engine's own index-key extraction and conflict algorithm for tokens. */
export function nativeTokenInvalidated(token: CoreReadToken, batches: readonly CoreWriteBatch[]): boolean {
  const log = new CoreWriteLog(token.timestamp);
  for (const batch of batches.toSorted((left, right) => {
    const a = left.documents[0]?.ts ?? 0n, b = right.documents[0]?.ts ?? 0n;
    return a < b ? -1 : a > b ? 1 : 0;
  })) {
    const timestamp = batch.documents[0]?.ts;
    if (timestamp !== undefined && timestamp > token.timestamp) log.append(timestamp, indexKeysFromWrites(batch.indexes));
  }
  return Result.getOrThrow(log.snapshot().conflict(token.reads, token.timestamp)) !== undefined;
}

export async function finishPayloadSuccessor(fixture: CorePayloadFixture, successor: CorePayloadSuccessor): Promise<void> {
  for (let step = 0; step < 512; step++) {
    const status = await fixture.run(fixture.database.schemaStatus(successor.proposal));
    if (status.state === "failed" || status.state === "overwritten") throw new Error(`Native successor refused: ${status.error}`);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      await fixture.activateSuccessor(successor);
      return;
    }
    await fixture.run(fixture.database.advanceSchema(successor.proposal, { pageSize: 2, maxPages: 1 }));
  }
  throw new Error("Native successor exceeded the fixture's bounded work allowance");
}

export function nativePreference(id: string, key: string | null) {
  return { id, key, user_collection: "users", user_id: "user-a", value: { retained: true },
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

/** Authoritative refusal leaves data untouched and terminalizes the exact claim. */
export async function expectNativeFailedWrite<A>(fixture: CorePayloadFixture, key: string,
  work: Effect.Effect<A, CmsTransactionError>, reason: CmsTransactionError["reason"]) {
  const before = await fixture.inventory();
  expect(await fixture.run(Effect.flip(work))).toMatchObject({ reason });
  const after = await fixture.inventory();
  expect(coreNativeFixtureData(after)).toEqual(coreNativeFixtureData(before));
  expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
  expect(after.outcomes.find(outcome => outcome.value.key === key)?.value.state).toBe("failed");
  return after;
}

/** An early child failure retains its full Cause; arrival cannot wait forever. */
export const awaitNativeTestGate = Effect.fn("PayloadRelationsTest.awaitGate")(function* <A, E>(
  fiber: Fiber.Fiber<A, E>, arrival: Effect.Effect<void>,
) {
  yield* Effect.raceFirst(arrival, Fiber.await(fiber).pipe(Effect.flatMap(exit => Exit.isFailure(exit)
    ? Effect.failCause(exit.cause) : Effect.die(new Error("Native child exited before its test gate"))))).pipe(Effect.timeout("5 seconds"));
});
