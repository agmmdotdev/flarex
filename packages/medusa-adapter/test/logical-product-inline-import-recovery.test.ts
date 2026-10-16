import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { WorkflowsModuleService } from "@medusajs/workflows-sdk/durable/engine";
import { decideTrustedWorkflowCompleteAttempt, decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowTaskSystemRunAttemptStore } from "../../persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1";
import { inspectTrustedWorkflowInterpreterSubject } from "../../persistence-postgres/src/tasks/trustedWorkflowExecutionSubject";
import { fxSystemExternalEffectAttemptsV1 } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { makeCommitEventStore } from "../../persistence-postgres/src/commit/events/store";
import { commitEventLimits } from "../../persistence-postgres/src/commit/events/model";
import { prepareProductInlineImportInput } from "../src/workflows/product/import-inline-input";
import { decodeDurableNativeCheckpoint } from "../src/workflow/durable-native-storage";
import { inlineImportSubscriber, logicalProductInlineImportFixture } from "./support/logical-product-inline-import-fixture";
import { notificationLogger } from "./support/notification-logger";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const logger = notificationLogger();
let fixture: Awaited<ReturnType<typeof logicalProductInlineImportFixture>>;

describe(`native inline Product child receipt recovery - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { fixture = await logicalProductInlineImportFixture(driver, close => cleanup.push(close), logger); }, 300_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("uses genuine native retry metadata and attempt-2 child to recover occurrence 1 after its committed receipt loses the parent checkpoint", async () => {
    const key = "receipt-cut-" + randomUUID();
    const input = { filename: key + ".csv", fileContent:
      "Product Handle,Product Title,Variant Title,Variant SKU,Variant Option 1 Name,Variant Option 1 Value\n" +
      `${key},${key},Blue,${key}-sku,Color,Blue\n` };
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    const db = fixture.connected.fixture.persistence.drizzle;
    const readEffects = () => db.select().from(fxSystemExternalEffectAttemptsV1);
    const beforeEffects = await readEffects();
    const beforeEvents = await db.select().from(fxSystemCommitEvents);
    const cut = new Error("Process lost after Product commit and before native parent completion checkpoint");
    let armed = false, interrupted = false;
    const first = await fixture.prepare(store => ({ ...store, save: (subject, checkpoint) => Effect.gen(function* () {
      if (armed && !interrupted) {
        const recorded = yield* Effect.promise(readEffects);
        const own = recorded.filter(row => !beforeEffects.some(old => old.stableEffectKey === row.stableEffectKey));
        if (own.some(row => row.effectKind === "child_commerce")) {
          interrupted = true;
          return yield* Effect.die(cut);
        }
      }
      return yield* store.save(subject, checkpoint);
    }) }));
    const create = vi.spyOn(ProductModuleService.prototype, "createProducts");
    const nativeRun = vi.spyOn(WorkflowsModuleService.prototype, "run");
    const nativeRetry = vi.spyOn(WorkflowsModuleService.prototype, "retryStep");
    try {
      const started = await Effect.runPromise(first.driver.start(randomUUID(), prepared.reference, input));
      await Effect.runPromise(first.driver.confirm(started.runId));
      armed = true;
      const lost = await Effect.runPromiseExit(first.driver.advance(started.runId, input));
      expect(interrupted).toBe(true); expect(Exit.isFailure(lost)).toBe(true);
      if (Exit.isFailure(lost)) expect(Cause.squash(lost.cause)).toBe(cut);
      expect(create).toHaveBeenCalledTimes(1);
      const committed = await readEffects();
      expect(committed.filter(row => !beforeEffects.some(old => old.stableEffectKey === row.stableEffectKey)))
        .toMatchObject([{ effectKind: "child_commerce" }]);
      const heldEvents = (await db.select().from(fxSystemCommitEvents)).filter(row =>
        !beforeEvents.some(old => old.commitSeq === row.commitSeq && old.eventOrdinal === row.eventOrdinal));
      expect(heldEvents.length).toBeGreaterThan(0);
      const events = await Effect.runPromise(makeCommitEventStore(fixture.connected.fixture.hostInput));
      for (const commitSeq of new Set(heldEvents.map(event => event.commitSeq)))
        expect(await Effect.runPromise(events.claimBatch(commitSeq, [inlineImportSubscriber], commitEventLimits.claimBatch))).toEqual([]);
      const snapshot = await Effect.runPromise(first.driver.inspect(started.runId));
      if (snapshot.current.phase !== "executing") throw new Error("Expected the actual lost Task attempt");
      const attempt = snapshot.current.currentAttempt;
      // The trusted outer owner reports the failed process through the real
      // lifecycle API. No durable Task/native rows or clocks are rewritten.
      const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(fixture.task);
      await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: started.runId,
        decide: current => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId: started.runId,
          attemptId: attempt.attemptId, executionFence: attempt.executionFence,
          completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
            retry: { kind: "override_delay", delayMs: Result.getOrThrow(decodeTaskDurationMsV1(0)) }, executionDurationMs: null } }, current) }));
      const cold = await fixture.prepare();
      const recovered = await Effect.runPromise(cold.driver.advance(started.runId, input));
      expect(recovered).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } },
        summary: { toCreate: 1, toUpdate: 0 }, errors: [] });
      expect(create).toHaveBeenCalledTimes(1); expect(logger.info).toHaveBeenCalledTimes(1);
      expect(nativeRetry).toHaveBeenCalledTimes(1);
      expect(nativeRun).toHaveBeenCalledWith("batch-products", expect.objectContaining({
        transactionId: `batch-products-as-step-${started.runId}`,
      }));
      expect(nativeRun).toHaveBeenCalledWith("batch-products", expect.objectContaining({
        transactionId: `batch-products-as-step-${started.runId}-attempt-2`,
      }));
      const final = await Effect.runPromise(cold.driver.inspect(started.runId));
      if (Option.isNone(final.checkpoint)) throw new Error("Missing actual native recovery checkpoint");
      const native = await Effect.runPromise(decodeDurableNativeCheckpoint(final.checkpoint.value.bytes,
        { workflowId: "import-products", transactionId: started.runId, expectedInput: input }));
      expect(Object.values(native.flow.steps).find(step => step.definition?.action === "batch-products-as-step"))
        .toMatchObject({ attempts: 2, invoke: { state: "done" } });
      const recorded = await readEffects();
      const own = recorded.filter(row => !beforeEffects.some(old => old.stableEffectKey === row.stableEffectKey));
      expect(own.filter(row => row.effectKind === "child_commerce")).toHaveLength(3);
      expect(own.filter(row => row.effectKind === "trusted_callback")).toHaveLength(1);
      for (const commitSeq of new Set(heldEvents.map(event => event.commitSeq)))
        expect(await Effect.runPromise(events.claimBatch(commitSeq, [inlineImportSubscriber], commitEventLimits.claimBatch))).not.toEqual([]);
    } finally { create.mockRestore(); nativeRun.mockRestore(); nativeRetry.mockRestore(); }
  }, 180_000);

  it.each(["confirmation-acknowledged", "child-completed", "terminal-before-finish"] as const)(
    "cold-recovers the actual saved %s checkpoint without duplicate business calls", async phase => {
      const key = "checkpoint-cut-" + randomUUID();
      const input = { filename: key + ".csv", fileContent:
        "Product Handle,Product Title,Variant Title,Variant SKU,Variant Option 1 Name,Variant Option 1 Value\n" +
        `${key},${key},Blue,${key}-sku,Color,Blue\n` };
      const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
      const db = fixture.connected.fixture.persistence.drizzle;
      const beforeEvents = await db.select().from(fxSystemCommitEvents);
      const beforeEffects = await db.select().from(fxSystemExternalEffectAttemptsV1);
      const sends = vi.mocked(logger.info).mock.calls.length;
      const cut = new Error(`Process lost after durable native ${phase} save`);
      const bytes = new WeakMap<object, Uint8Array>();
      const readPreparedBytes = Schema.decodeUnknownSync(Schema.Struct({ bytes: Schema.Uint8Array }));
      let armed = false, interrupted = false;
      const first = await fixture.prepare(store => ({ ...store,
        prepare: raw => Effect.gen(function* () {
          const value = yield* store.prepare(raw);
          bytes.set(value, readPreparedBytes(raw).bytes.slice());
          return value;
        }),
        save: (subject, checkpoint) => Effect.gen(function* () {
          const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(subject));
          const captured = bytes.get(checkpoint);
          if (captured === undefined) throw new Error("Missing actual prepared checkpoint bytes");
          const native = yield* decodeDurableNativeCheckpoint(captured,
            { workflowId: "import-products", transactionId: pins.runId, expectedInput: input });
          const steps = Object.values(native.flow.steps);
          const confirmation = steps.find(step => step.definition?.action === "wait-confirmation-product-import");
          const child = steps.find(step => step.definition?.action === "batch-products-as-step");
          const notification = steps.find(step => step.definition?.action === "send-notifications");
          const selected = phase === "confirmation-acknowledged"
            ? confirmation?.invoke.state === "done" && child?.invoke.state === "not_started"
            : phase === "child-completed"
            ? child?.invoke.state === "done" && notification?.invoke.state === "not_started"
            : native.flow.state === "done";
          const saved = yield* store.save(subject, checkpoint);
          if (armed && !interrupted && selected) { interrupted = true; return yield* Effect.die(cut); }
          return saved;
        }),
      }));
      const create = vi.spyOn(ProductModuleService.prototype, "createProducts");
      const retry = vi.spyOn(WorkflowsModuleService.prototype, "retryStep");
      try {
        const started = await Effect.runPromise(first.driver.start(randomUUID(), prepared.reference, input));
        await Effect.runPromise(first.driver.confirm(started.runId));
        armed = true;
        const lost = await Effect.runPromiseExit(first.driver.advance(started.runId, input));
        expect(interrupted).toBe(true);
        expect(Exit.isFailure(lost)).toBe(true);
        if (Exit.isFailure(lost)) expect(Cause.squash(lost.cause)).toBe(cut);
        expect(create).toHaveBeenCalledTimes(phase === "confirmation-acknowledged" ? 0 : 1);
        expect(logger.info).toHaveBeenCalledTimes(sends + (phase === "terminal-before-finish" ? 1 : 0));
        const heldEvents = (await db.select().from(fxSystemCommitEvents)).filter(row =>
          !beforeEvents.some(old => old.commitSeq === row.commitSeq && old.eventOrdinal === row.eventOrdinal));
        if (phase !== "confirmation-acknowledged") expect(heldEvents.length).toBeGreaterThan(0);
        const events = await Effect.runPromise(makeCommitEventStore(fixture.connected.fixture.hostInput));
        for (const commitSeq of new Set(heldEvents.map(event => event.commitSeq)))
          expect(await Effect.runPromise(events.claimBatch(commitSeq, [inlineImportSubscriber], commitEventLimits.claimBatch))).toEqual([]);
        const snapshot = await Effect.runPromise(first.driver.inspect(started.runId));
        if (Option.isNone(snapshot.checkpoint)) throw new Error("Missing durable cut checkpoint");
        const actual = await Effect.runPromise(decodeDurableNativeCheckpoint(snapshot.checkpoint.value.bytes,
          { workflowId: "import-products", transactionId: started.runId, expectedInput: input }));
        if (phase === "terminal-before-finish") expect(actual.flow.state).toBe("done");
        else expect(actual.flow.state).toBe("invoking");
        if (snapshot.current.phase !== "executing") throw new Error("Missing lost native Task attempt");
        const attempt = snapshot.current.currentAttempt;
        const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(fixture.task);
        await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: started.runId,
          decide: current => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", runId: started.runId,
            attemptId: attempt.attemptId, executionFence: attempt.executionFence,
            completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
              retry: { kind: "override_delay", delayMs: Result.getOrThrow(decodeTaskDurationMsV1(0)) }, executionDurationMs: null } }, current) }));
        const cold = await fixture.prepare();
        const recovered = await Effect.runPromise(cold.driver.advance(started.runId, input));
        expect(recovered).toMatchObject({ status: { phase: "terminal", terminal: { kind: "succeeded" } },
          summary: { toCreate: 1, toUpdate: 0 }, errors: [] });
        expect(create).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledTimes(sends + 1);
        expect(retry).not.toHaveBeenCalled();
        const own = (await db.select().from(fxSystemExternalEffectAttemptsV1))
          .filter(row => !beforeEffects.some(old => old.stableEffectKey === row.stableEffectKey));
        expect(own.filter(row => row.effectKind === "child_commerce")).toHaveLength(3);
        expect(own.filter(row => row.effectKind === "trusted_callback")).toHaveLength(1);
        const finalEvents = (await db.select().from(fxSystemCommitEvents)).filter(row =>
          !beforeEvents.some(old => old.commitSeq === row.commitSeq && old.eventOrdinal === row.eventOrdinal));
        expect(finalEvents.length).toBeGreaterThan(0);
        for (const commitSeq of new Set(finalEvents.map(event => event.commitSeq)))
          expect(await Effect.runPromise(events.claimBatch(commitSeq, [inlineImportSubscriber], commitEventLimits.claimBatch))).not.toEqual([]);
      } finally { create.mockRestore(); retry.mockRestore(); }
    }, 180_000);
});
