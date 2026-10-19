import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { InMemoryLockingProvider } from "@medusajs/locking/providers/in-memory";
import { inspectTrustedWorkflowInterpreterSubject, type TrustedWorkflowInterpreterSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { fxSystemExternalEffectAttemptsV1 } from "../../persistence-postgres/src/database/schema";
import { prepareFulfillmentDeliveryInput } from "../src/workflows/fulfillment/delivery-input";
import { logicalFulfillmentDeliveryFixture, fulfillmentDeliverySubscriber } from "./support/logical-fulfillment-delivery-fixture";

import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decideTrustedWorkflowCompleteAttempt, decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowTaskSystemRunAttemptStore } from "../../persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1";
import { makeCommitEventStore } from "../../persistence-postgres/src/commit/events/store";
import { commitEventLimits } from "../../persistence-postgres/src/commit/events/model";
const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalFulfillmentDeliveryFixture>>;
const idOf = Schema.decodeUnknownSync(Schema.String);
const stamp = "2026-10-01T00:00:00.000Z";
type Snapshot = Awaited<ReturnType<Awaited<ReturnType<typeof logicalFulfillmentDeliveryFixture>>["connected"]["snapshot"]>>;
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(value => !before.events.some(prior =>
  prior.scopeUuid === value.scopeUuid && prior.commitSeq === value.commitSeq && prior.eventOrdinal === value.eventOrdinal));
const readEffects = () => fixture.connected.fixture.persistence.drizzle.select().from(fxSystemExternalEffectAttemptsV1);

type DeliveryDriver = Awaited<ReturnType<typeof fixture.prepare>>["driver"];
type CheckpointDecorator = NonNullable<NonNullable<Parameters<typeof fixture.prepare>[0]>["checkpointStore"]>;
const checkpointDiagnostic = Schema.decodeUnknownSync(Schema.Struct({ parent: Schema.Struct({ flow: Schema.Struct({
  state: Schema.String,
  steps: Schema.Record(Schema.String, Schema.Struct({
    definition: Schema.optionalKey(Schema.Struct({ action: Schema.optionalKey(Schema.String) })),
    invoke: Schema.optionalKey(Schema.Struct({ state: Schema.String })),
  })),
}) }) }));
type DiagnosticCheckpoint = ReturnType<typeof checkpointDiagnostic>;

/** Cut only after the real authenticated checkpoint save acknowledges. The
 * captured bytes select a diagnostic boundary; no native checkpoint is edited. */
function deliveryCheckpointCut(select: (value: DiagnosticCheckpoint) => boolean) {
  const error = new Error("Delivery process lost after authentic native checkpoint acknowledgement"), bytes = new WeakMap<object, Uint8Array>();
  const readBytes = Schema.decodeUnknownSync(Schema.Struct({ bytes: Schema.Uint8Array }));
  let interrupted = false, runId: string | undefined;
  const decorate: CheckpointDecorator = store => ({ ...store,
    prepare: raw => Effect.gen(function* () {
      const prepared = yield* store.prepare(raw);
      bytes.set(prepared, readBytes(raw).bytes.slice());
      return prepared;
    }),
    save: (subject, prepared) => Effect.gen(function* () {
      const captured = bytes.get(prepared);
      if (captured === undefined) throw new Error("Missing actual prepared Delivery checkpoint bytes");
      const diagnostic = checkpointDiagnostic(JSON.parse(new TextDecoder().decode(captured)));
      const saved = yield* store.save(subject, prepared);
      if (!interrupted && select(diagnostic)) {
        const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(subject));
        interrupted = true; runId = pins.runId;
        return yield* Effect.die(error);
      }
      return saved;
    }),
  });
  return { decorate, error, interrupted: () => interrupted, runId: () => runId };
}

/** The trusted outer owner reports the lost process through the existing Task
 * lifecycle. This fixture supplies no Task row edits or retry state machine. */
async function reportDeliveryProcessLoss(task: DeliveryDriver, rawRunId: string) {
  const snapshot = await Effect.runPromise(task.inspect(rawRunId));
  if (snapshot.current.phase !== "executing") throw new Error("Missing actual interrupted Delivery attempt");
  const attempt = snapshot.current.currentAttempt, runId = snapshot.current.runId;
  const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(fixture.task);
  await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "complete_attempt", runId,
    decide: current => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId,
      attemptId: attempt.attemptId, executionFence: attempt.executionFence,
      completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
        retry: { kind: "override_delay", delayMs: Result.getOrThrow(decodeTaskDurationMsV1(0)) }, executionDurationMs: null } }, current) }));
}


describe(`complete native Fulfillment delivery Task - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { fixture = await logicalFulfillmentDeliveryFixture(driver, close => cleanup.push(close)); }, 300_000);
  afterEach(async () => { await fixture.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("delivers the nonshipped maximum graph, retains its actual child checkpoint and cold-reads/replays without another native mutation", async () => {
    const created = await fixture.connected.seed("delivery145-maximum", { maximum: true }), id = idOf(created.id);
    const protectedRoot = await fixture.connected.seed("delivery145-protected", { maximum: true });
    const beforeRows = await fixture.connected.read(), before = await fixture.connected.snapshot(), beforeEffects = await readEffects();
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id })), first = await fixture.prepare();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire");
    try {
      const key = randomUUID(), started = await Effect.runPromise(first.driver.start(key, prepared.reference, { id }));
      expect(started).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } }, errors: [],
        result: { id, delivered_at: expect.any(String), shipped_at: null, canceled_at: null, items: created.items, labels: created.labels,
          data: created.data, metadata: created.metadata } });
      expect(update).toHaveBeenCalledTimes(1); expect(acquire).toHaveBeenCalledTimes(1);
      const afterRows = await fixture.connected.read(), targetBefore = beforeRows.find(row => row.id === id), after = await fixture.connected.snapshot();
      expect(afterRows.find(row => row.id === id)).toEqual({ ...targetBefore, delivered_at: expect.any(String), updated_at: expect.any(String) });
      expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
      expect(afterRows.find(row => row.id === protectedRoot.id)).toEqual(beforeRows.find(row => row.id === protectedRoot.id));
      expect(eventsSince(before, after).map(event => event.envelope.contract)).toEqual(["fulfillment.fulfillment.updated"]);
      const ownEffects = (await readEffects()).filter(row => !beforeEffects.some(old => old.stableEffectKey === row.stableEffectKey));
      expect(ownEffects.filter(row => row.effectKind === "child_commerce")).toHaveLength(3);
      expect(ownEffects.filter(row => row.effectKind === "trusted_callback")).toHaveLength(2);
      const stored = await Effect.runPromise(first.driver.inspect(started.runId));
      if (Option.isNone(stored.checkpoint)) throw new Error("Missing genuine compound Delivery checkpoint");
      expect(stored.checkpoint.value.codec).toBe("medusa.native-checkpoint.compound.json.v1");
      const checkpoint: unknown = JSON.parse(new TextDecoder().decode(stored.checkpoint.value.bytes));
      expect(checkpoint).toMatchObject({ parent: { flow: { modelId: "mark-fulfillment-as-delivered-workflow", transactionId: started.runId, state: "done" } },
        child: { flow: { modelId: "update-fulfillment-workflow", transactionId: `update-fulfillment-workflow-as-step-${started.runId}`, state: "done" },
          context: { invoke: { "update-fulfillment": { output: { compensateInput: { id, delivered_at: null } } } } } } });
      const cold = await fixture.prepare();
      expect(await Effect.runPromise(cold.driver.advance(started.runId, { id }))).toMatchObject({ result: started.result,
        status: { phase: "terminal", terminal: { kind: "succeeded" } } });
      expect(await Effect.runPromise(cold.driver.start(key, prepared.reference, { id }))).toMatchObject({ runId: started.runId, result: started.result });
      expect(update).toHaveBeenCalledTimes(1); expect(acquire).toHaveBeenCalledTimes(1);
      expect(await fixture.connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(cold.driver.advance(started.runId, { id: id + "-changed" }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(update).toHaveBeenCalledTimes(1);
    } finally { update.mockRestore(); acquire.mockRestore(); }
  }, 240_000);

  it.each([
    { name: "canceled", dates: { canceled_at: stamp }, message: "Cannot deliver an already canceled fulfillment" },
    { name: "already-delivered", dates: { delivered_at: stamp }, message: "Fulfillment has already been marked delivered" },
    { name: "canceled-before-delivered", dates: { canceled_at: stamp, delivered_at: stamp }, message: "Cannot deliver an already canceled fulfillment" },
  ])("retains native $name guard behavior and releases without a business mutation", async ({ name, dates, message }) => {
    const created = await fixture.connected.seed("delivery145-" + name), id = idOf(created.id);
    await fixture.connected.arrangeShipment("fulfillment", "update", [{ id, ...dates }]);
    const beforeRows = await fixture.connected.read(), before = await fixture.connected.snapshot();
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id })), native = await fixture.prepare();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), release = vi.spyOn(InMemoryLockingProvider.prototype, "release");
    try {
      const result = await Effect.runPromise(native.driver.start(randomUUID(), prepared.reference, { id }));
      expect(result).toMatchObject({ status: { phase: "terminal", terminal: { kind: "failed" } }, result: null,
        errors: [{ error: { message } }] });
      expect(update).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
      expect(await release.mock.results[0]?.value).toBe(true);
      expect(await fixture.connected.read()).toEqual(beforeRows);
      expect(eventsSince(before, await fixture.connected.snapshot())).toEqual([]);
    } finally { update.mockRestore(); release.mockRestore(); }
  }, 180_000);

  it("uses a genuine current control subject to cancel the original committed update and its retained preimage", async () => {
    const created = await fixture.connected.seed("delivery145-control", { maximum: true }), id = idOf(created.id);
    const beforeRows = await fixture.connected.read(), before = await fixture.connected.snapshot();
    let ordinarySubject: TrustedWorkflowInterpreterSubject | undefined;
    const native = await fixture.prepare({ afterExecute: (input, outcome) => Effect.gen(function* () {
      if (!input.cancellationRequested && outcome.state === "done") {
        ordinarySubject = input.subject;
        const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(input.subject));
        yield* fixture.control.cancel({ type: "request_cancellation", runId: pins.runId, reason: { code: "requested", message: null } });
      }
    }) });
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id }));
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), release = vi.spyOn(InMemoryLockingProvider.prototype, "release");
    try {
      const result = await Effect.runPromise(native.driver.start(randomUUID(), prepared.reference, { id }));
      expect(result).toMatchObject({ status: { phase: "terminal", terminal: { kind: "cancelled" } }, errors: [] });
      expect(update).toHaveBeenCalledTimes(2);
      expect(update.mock.calls[1]?.slice(0, 2)).toEqual([id, { delivered_at: null }]);
      expect(release).toHaveBeenCalledTimes(2);
      expect(await release.mock.results[0]?.value).toBe(true); expect(await release.mock.results[1]?.value).toBe(false);
      const afterRows = await fixture.connected.read(), target = afterRows.find(row => row.id === id);
      expect(target).toEqual({ ...beforeRows.find(row => row.id === id), updated_at: expect.any(String) });
      expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
      expect(eventsSince(before, await fixture.connected.snapshot()).map(event => event.envelope.contract))
        .toEqual(["fulfillment.fulfillment.updated", "fulfillment.fulfillment.updated"]);
      expect(ordinarySubject).toBeDefined();
      if (ordinarySubject === undefined) throw new Error("Missing actual retired ordinary subject");
      expect(Result.isFailure(inspectTrustedWorkflowInterpreterSubject(ordinarySubject))).toBe(true);
    } finally { update.mockRestore(); release.mockRestore(); }
  }, 240_000);

  it("preserves a newer genuine Task callback owner when the original full Delivery compensates", async () => {
    const created = await fixture.connected.seed("delivery145-newer-owner"), id = idOf(created.id);
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id }));
    const newer = await fixture.createLockProbe(prepared.reference, id);
    const native = await fixture.prepare({ afterExecute: (input, outcome) => Effect.gen(function* () {
      if (!input.cancellationRequested && outcome.state === "done") {
        // The second real subject invokes the selected native Locking callback;
        // it supplies no second Delivery result, provider Map or fake inverse.
        yield* Effect.tryPromise({ try: () => newer.service.acquire(id, { expire: 10, ownerId: newer.ownerId }), catch: (cause): unknown => cause });
        yield* fixture.locking.assertAcquisitionObservation(newer.subject, id);
        const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(input.subject));
        yield* fixture.control.cancel({ type: "request_cancellation", runId: pins.runId, reason: { code: "requested", message: null } });
      }
    }) });
    const acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire"), release = vi.spyOn(InMemoryLockingProvider.prototype, "release");
    let released = false;
    try {
      const result = await Effect.runPromise(native.driver.start(randomUUID(), prepared.reference, { id }));
      expect(result).toMatchObject({ status: { phase: "terminal", terminal: { kind: "cancelled" } }, errors: [] });
      expect(acquire).toHaveBeenCalledTimes(2); expect(release).toHaveBeenCalledTimes(2);
      expect(await release.mock.results[0]?.value).toBe(true); expect(await release.mock.results[1]?.value).toBe(false);
      expect(release.mock.calls[1]?.slice(0, 2)).toEqual([[id], { ownerId: `fulfillment-delivery:${result.runId}` }]);
      expect(await newer.service.release([id], { ownerId: newer.ownerId })).toBe(true);
      released = true;
      expect((await fixture.connected.read()).find(row => row.id === id)).toMatchObject({ delivered_at: null });
    } finally {
      try { if (!released) await newer.service.release([id], { ownerId: newer.ownerId }); }
      finally { await newer.complete(); acquire.mockRestore(); release.mockRestore(); }
    }
  }, 240_000);
  it("preserves the native missing-ID singleton Query error and compensates the acquired key without a mutation", async () => {
    const id = "delivery145-missing-" + randomUUID(), before = await fixture.connected.snapshot(), beforeRows = await fixture.connected.read();
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id })), native = await fixture.prepare();
    const list = vi.spyOn(FulfillmentModuleService.prototype, "listFulfillments"), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"),
      update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), release = vi.spyOn(InMemoryLockingProvider.prototype, "release");
    try {
      const result = await Effect.runPromise(native.driver.start(randomUUID(), prepared.reference, { id }));
      expect(result).toMatchObject({ status: { phase: "terminal", terminal: { kind: "failed" } }, result: null,
        errors: [{ error: { type: "not_found", message: `Fulfillment id not found: ${id}` } }] });
      expect(list).toHaveBeenCalledTimes(1); expect(retrieve).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1); expect(await release.mock.results[0]?.value).toBe(true);
      expect(await fixture.connected.read()).toEqual(beforeRows);
      expect(eventsSince(before, await fixture.connected.snapshot())).toEqual([]);
    } finally { list.mockRestore(); retrieve.mockRestore(); update.mockRestore(); release.mockRestore(); }
  }, 180_000);

  it("observes the committed native delivered_at inside the actual provider forward-release callback", async () => {
    const created = await fixture.connected.seed("delivery145-commit-before-release"), id = idOf(created.id);
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id })), native = await fixture.prepare();
    const original = InMemoryLockingProvider.prototype.release, observed: Array<{ ownerId: string | null | undefined; deliveredAt: unknown }> = [];
    const release = vi.spyOn(InMemoryLockingProvider.prototype, "release").mockImplementation(async function (this: InMemoryLockingProvider, ...args) {
      if ((Array.isArray(args[0]) ? args[0] : [args[0]]).includes(id)) {
        const row = (await fixture.connected.read()).find(value => value.id === id);
        observed.push({ ownerId: args[1]?.ownerId, deliveredAt: row?.delivered_at });
        expect(row?.delivered_at).toEqual(expect.any(String));
      }
      return original.call(this, ...args);
    });
    try {
      const result = await Effect.runPromise(native.driver.start(randomUUID(), prepared.reference, { id }));
      expect(result).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } }, errors: [] });
      expect(observed).toEqual([{ ownerId: `fulfillment-delivery:${result.runId}`, deliveredAt: expect.any(String) }]);
      expect(await release.mock.results[0]?.value).toBe(true);
    } finally { release.mockRestore(); }
  }, 180_000);

  it("waits for genuine native contention without a Fulfillment call and continues only after the held owner releases", async () => {
    const created = await fixture.connected.seed("delivery145-contention"), id = idOf(created.id);
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput({ id })), native = await fixture.prepare(), held = await fixture.createLockProbe(prepared.reference, id);
    await held.service.acquire(id, { expire: 10, ownerId: held.ownerId });
    let signalContention: () => void = () => {};
    const contention = new Promise<void>(resolve => { signalContention = resolve; });
    const original = InMemoryLockingProvider.prototype.acquire;
    const acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire").mockImplementation(async function (this: InMemoryLockingProvider, ...args) {
      try { return await original.call(this, ...args); }
      catch (error) { signalContention(); throw error; }
    });
    const list = vi.spyOn(FulfillmentModuleService.prototype, "listFulfillments"), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"),
      update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    const pending = Effect.runPromise(native.driver.start(randomUUID(), prepared.reference, { id }));
    let released = false;
    try {
      await Promise.race([contention, pending.then(() => { throw new Error("Native delivery completed without establishing actual provider contention"); })]);
      expect(list).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      expect(await held.service.release([id], { ownerId: held.ownerId })).toBe(true); released = true;
      const result = await pending;
      expect(result).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } }, errors: [], result: { id, delivered_at: expect.any(String) } });
      expect(acquire.mock.calls.length).toBeGreaterThanOrEqual(2); expect(acquire.mock.calls.length).toBeLessThanOrEqual(8);
      expect(list).toHaveBeenCalledTimes(1); expect(retrieve).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    } finally {
      try { if (!released) await held.service.release([id], { ownerId: held.ownerId }); }
      finally {
        // Drain the already-owned native execution even if an earlier assertion
        // failed. The normal branch above still asserts its complete outcome.
        await Promise.allSettled([pending]); await held.complete();
        acquire.mockRestore(); list.mockRestore(); retrieve.mockRestore(); update.mockRestore();
      }
    }
  }, 240_000);

  it("recovers an acknowledged terminal native checkpoint after lost acknowledgement without repeating database or lock callbacks", async () => {
    const created = await fixture.connected.seed("delivery145-terminal-cut"), id = idOf(created.id), input = { id };
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput(input)), before = await fixture.connected.snapshot();
    const cut = deliveryCheckpointCut(value => value.parent.flow.state === "done");
    const first = await fixture.prepare({ checkpointStore: cut.decorate });
    const acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire"), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const failed = await Effect.runPromiseExit(first.driver.start(randomUUID(), prepared.reference, input));
      expect(cut.interrupted()).toBe(true); expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) expect(Cause.squash(failed.cause)).toBe(cut.error);
      expect(update).toHaveBeenCalledTimes(1); expect(acquire).toHaveBeenCalledTimes(1);
      const runId = cut.runId();
      if (runId === undefined) throw new Error("Missing actual checkpoint Task identity");
      const saved = await Effect.runPromise(first.driver.inspect(runId));
      expect(saved.current.phase).toBe("executing"); expect(Option.isSome(saved.checkpoint)).toBe(true);
      const committed = eventsSince(before, await fixture.connected.snapshot());
      expect(committed.map(event => event.envelope.contract)).toEqual(["fulfillment.fulfillment.updated"]);
      const events = await Effect.runPromise(makeCommitEventStore(fixture.connected.fixture.hostInput));
      for (const commitSeq of new Set(committed.map(event => event.commitSeq)))
        expect(await Effect.runPromise(events.claimBatch(commitSeq, [fulfillmentDeliverySubscriber], commitEventLimits.claimBatch))).toEqual([]);
      await reportDeliveryProcessLoss(first.driver, runId);
      const cold = await fixture.prepare(), recovered = await Effect.runPromise(cold.driver.advance(runId, input));
      expect(recovered).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } }, result: { id, delivered_at: expect.any(String) }, errors: [] });
      expect(update).toHaveBeenCalledTimes(1); expect(acquire).toHaveBeenCalledTimes(1);
      for (const commitSeq of new Set(committed.map(event => event.commitSeq)))
        expect(await Effect.runPromise(events.claimBatch(commitSeq, [fulfillmentDeliverySubscriber], commitEventLimits.claimBatch))).not.toEqual([]);
    } finally { acquire.mockRestore(); update.mockRestore(); }
  }, 240_000);

  it("refuses a fresh ordinary subject after a saved acquisition loses its process instead of treating the old callback receipt as a current lock claim", async () => {
    const created = await fixture.connected.seed("delivery145-acquisition-cut"), id = idOf(created.id), input = { id };
    const prepared = await Effect.runPromise(prepareFulfillmentDeliveryInput(input)), before = await fixture.connected.snapshot(), beforeRows = await fixture.connected.read();
    const cut = deliveryCheckpointCut(value => Object.values(value.parent.flow.steps).some(step =>
      step.definition?.action === "acquire-lock-step" && step.invoke?.state === "done"));
    const first = await fixture.prepare({ checkpointStore: cut.decorate });
    const list = vi.spyOn(FulfillmentModuleService.prototype, "listFulfillments"), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"),
      update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire");
    try {
      const failed = await Effect.runPromiseExit(first.driver.start(randomUUID(), prepared.reference, input));
      expect(cut.interrupted()).toBe(true); expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) expect(Cause.squash(failed.cause)).toBe(cut.error);
      const runId = cut.runId();
      if (runId === undefined) throw new Error("Missing actual acquisition checkpoint Task identity");
      await reportDeliveryProcessLoss(first.driver, runId);
      const cold = await fixture.prepare(), refused = await Effect.runPromiseExit(cold.driver.advance(runId, input));
      expect(Exit.isFailure(refused)).toBe(true);
      if (Exit.isFailure(refused)) expect(refused.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error instanceof CommerceTransactionError && reason.error.reason === "invalidAuthority")).toBe(true);
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(list).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      expect(await fixture.connected.read()).toEqual(beforeRows); expect(eventsSince(before, await fixture.connected.snapshot())).toEqual([]);
      expect((await Effect.runPromise(cold.driver.inspect(runId))).current.phase).toBe("executing");
      // This refusal remains recoverable with the Task owner. It establishes no
      // in-flight claim recovery, fabricated child preimage or cancellation ack.
    } finally { list.mockRestore(); retrieve.mockRestore(); update.mockRestore(); acquire.mockRestore(); }
  }, 240_000);

});
