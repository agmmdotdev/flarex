import { Cause, Clock, Deferred, Effect, Exit, Fiber, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import {
  observePointCommitPublicationEffect,
  observePointCommitPublicationPromise,
} from "../../../../../persistence-postgres/src/commit/point/observation";
import { createEffectMeasurementCollector } from "./effect";
import { observePhysicalSessionEffect, PhysicalSessionObservation } from "../../../../../persistence-postgres/src/database/physicalSession/observation";
import { observeExecution, withExecutionDiagnosticDefaults } from "@flarex/persistence-postgres/internal/execution-diagnostics";

describe("diagnostic Effect measurement collector", () => {
  it("opts stable core operations into the actual SDK Layer without changing their full Cause", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const original = Cause.combine(Cause.combine(Cause.fail({ _tag: "Refused" }), Cause.die(new Error("defect"))), Cause.interrupt(993));
    const work = withExecutionDiagnosticDefaults(observeExecution("LogicalDocuments.get", Effect.failCause(original)));
    const quiet = await Effect.runPromiseExit(work);
    expect(Exit.isFailure(quiet) && quiet.cause).toBe(original);
    expect(collector.records()).toEqual([]);
    const exit = await collector.runRequest("request", () => Effect.runPromiseExit(Effect.provide(
      collector.binding.traceEffect("native Product operation", work), collector.layer)));
    expect(Exit.isFailure(exit) && exit.cause).toBe(original);
    const records = collector.records();
    const parent = records.find(event => event.kind === "effectSpan" && event.name === "native Product operation");
    const child = records.find(event => event.kind === "effectSpan" && event.name === "LogicalDocuments.get");
    expect(child).toMatchObject({ parentId: parent?.id, outcome: "mixed" });
    if (child === undefined) throw new Error("Missing opt-in core operation");
    const observed = collector.fullExits().get(child.id);
    expect(observed).toEqual(exit);
    expect(observed !== undefined && Exit.isFailure(observed) && observed.cause).toBe(original);
    expect(collector.status()).toMatchObject({ failureCount: 0, lostContextEvents: 0 });
  });

  it("parents physical work at evaluation and classifies owner refusals without changing success Exits", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const refused = { status: "failed" as const };
    const work = observePhysicalSessionEffect(collector.binding.physicalSessionObservation, "drain",
      Effect.succeed(refused), value => value.status === "failed");
    const exit = await collector.runRequest("request", () => Effect.runPromiseExit(collector.binding.provide(
      collector.binding.traceEffect("native Product operation", work))));
    expect(Exit.isSuccess(exit) && exit.value).toBe(refused);
    const records = collector.records();
    const native = records.find(event => event.kind === "effectSpan" && event.name === "native Product operation");
    const physical = records.find(event => event.kind === "effectSpan" && event.name === "PostgresPhysicalSession.drain");
    expect(physical).toMatchObject({ parentId: native?.id, owner: "physicalSession", outcome: "failure", cause: null });
    if (physical === undefined) throw new Error("Missing physical span");
    expect(collector.fullExits().get(physical.id)).toBe(exit);
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, failureCount: 0 });
  });

  it("preserves every physical failure reason and waits for interrupted cleanup before span completion", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const original = Cause.combine(Cause.fail({ _tag: "Refused" }), Cause.die(new Error("private physical failure")));
    const begun = Effect.runSync(Deferred.make<void>());
    const cleanupBegun = Effect.runSync(Deferred.make<void>());
    const finishCleanup = Effect.runSync(Deferred.make<void>());
    let cleanupComplete = false;
    await collector.runRequest("request", async () => {
      const combined = await Effect.runPromiseExit(collector.binding.provide(observePhysicalSessionEffect(
        collector.binding.physicalSessionObservation, "release", Effect.failCause(original))));
      expect(Exit.isFailure(combined) && combined.cause).toBe(original);
      const fiber = Effect.runFork(collector.binding.provide(observePhysicalSessionEffect(
        collector.binding.physicalSessionObservation, "drain", Deferred.succeed(begun, undefined).pipe(
          Effect.andThen(Effect.never), Effect.ensuring(Deferred.succeed(cleanupBegun, undefined).pipe(
            Effect.andThen(Deferred.await(finishCleanup)), Effect.andThen(Effect.sync(() => { cleanupComplete = true; }))))))));
      await Effect.runPromise(Deferred.await(begun));
      const interruption = Effect.runPromise(Fiber.interrupt(fiber));
      await Effect.runPromise(Deferred.await(cleanupBegun));
      const pending = collector.records().find(event => event.kind === "effectSpan" && event.name === "PostgresPhysicalSession.drain");
      expect(pending?.kind !== "work" && pending?.endMs).toBeNull();
      expect(cleanupComplete).toBe(false);
      await Effect.runPromise(Deferred.succeed(finishCleanup, undefined));
      await interruption;
      const interrupted = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
      expect(cleanupComplete).toBe(true);
    });
    const physical = collector.records().filter(event => event.kind === "effectSpan" && event.owner === "physicalSession");
    expect(physical.map(event => event.kind === "effectSpan" && event.outcome)).toEqual(["mixed", "interruption"]);
    expect(physical.every(event => event.kind !== "work" && event.endMs !== null)).toBe(true);
    expect(JSON.stringify(physical)).not.toContain("private physical failure");
  });

  it("retains nested quarantine and cancellation intervals as inclusive evidence", async () => {
    let tick = 0, resourceReads = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++, readResources: () => {
      resourceReads++;
      return { process: { user: resourceReads, system: 0 }, thread: null,
        eventLoop: { idle: resourceReads, active: 0, utilization: 0 } };
    } });
    const observation = collector.binding.physicalSessionObservation;
    await collector.runRequest("request", () => Effect.runPromise(collector.binding.provide(observePhysicalSessionEffect(
      observation, "quarantine", observePhysicalSessionEffect(observation, "cancel", Effect.void)))));
    const records = collector.records();
    const quarantine = records.find(event => event.kind === "effectSpan" && event.name === "PostgresPhysicalSession.quarantine");
    const cancel = records.find(event => event.kind === "effectSpan" && event.name === "PostgresPhysicalSession.cancel");
    if (quarantine?.kind !== "effectSpan" || cancel?.kind !== "effectSpan") throw new Error("Missing physical intervals");
    expect(cancel.parentId).toBe(quarantine.id);
    expect(cancel.startMs).toBeGreaterThan(quarantine.startMs);
    expect(cancel.endMs).toBeLessThan(quarantine.endMs!);
    expect([cancel.outcome, quarantine.outcome]).toEqual(["success", "success"]);
    expect(cancel).not.toHaveProperty("resources");
    expect(quarantine).not.toHaveProperty("resources");
    expect(resourceReads).toBe(2);
  });

  it("settles business outcomes before diagnosing physical predicate, clock and sink faults", async () => {
    let tick = 0;
    const fault = new Error("physical diagnostic fault");
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const value = { status: "released" };
    expect(await collector.runRequest("request", () => Effect.runPromise(collector.binding.provide(observePhysicalSessionEffect(
      collector.binding.physicalSessionObservation, "release", Effect.succeed(value), () => { throw fault; }))))).toBe(value);
    expect(collector.status().failureCount).toBe(1);
    expect(() => collector.assertHealthy()).toThrow(expect.objectContaining({ cause: fault }));
    const sink = new PhysicalSessionObservation({ record: () => { throw fault; } });
    const original = Cause.combine(Cause.fail("refusal"), Cause.die("cleanup"));
    const exit = await Effect.runPromiseExit(observePhysicalSessionEffect(sink, "drain", Effect.failCause(original)));
    expect(Exit.isFailure(exit) && exit.cause).toBe(original);
    expect(sink.status().failureCount).toBeGreaterThan(0);
    expect(() => sink.assertHealthy()).toThrow(expect.objectContaining({ cause: fault }));
    const faultyClock = createEffectMeasurementCollector({ now: () => { throw fault; } });
    expect(await faultyClock.runRequest("request", () => Effect.runPromise(faultyClock.binding.provide(
      observePhysicalSessionEffect(faultyClock.binding.physicalSessionObservation, "release", Effect.succeed(value)))))).toBe(value);
    expect(() => faultyClock.assertHealthy()).toThrow(expect.objectContaining({ cause: fault }));
  });

  it("keeps quiet and closed physical work identical without timing or predicate evaluation", async () => {
    let clocks = 0, predicates = 0;
    const work = Effect.succeed(7);
    expect(observePhysicalSessionEffect(undefined, "drain", work, () => { predicates++; return true; })).toBe(work);
    expect(predicates).toBe(0);
    const collector = createEffectMeasurementCollector({ now: () => clocks++ });
    await collector.runRequest("request", async () => 1);
    const before = clocks;
    expect(observePhysicalSessionEffect(collector.binding.physicalSessionObservation, "release", work,
      () => { predicates++; return true; })).toBe(work);
    expect(clocks).toBe(before);
    expect(predicates).toBe(0);
  });

  it("selects owner counters without primitive context wrapping or unselected records", async () => {
    let tick = 0, reads = 0;
    const collector = createEffectMeasurementCollector({ observation: "owners", now: () => tick++, readResources: () => ({
      process: { user: ++reads * 1000, system: 0 }, thread: null,
      eventLoop: { idle: reads, active: reads, utilization: 0.5 },
    }) });
    const work = Effect.succeed(7);
    expect(collector.binding.traceEffect("unselected boundary", work)).toBe(work);
    const unselected = Effect.fn("Unselected.internal")(() => Effect.gen(function* () {
      const tracer = yield* Tracer.Tracer;
      expect(tracer.context).toBeUndefined();
      return yield* work;
    }));
    const original = await collector.runRequest("request", () => collector.binding.withPhase("native Payload operation", () => {
      const before = tick;
      return Effect.runPromise(collector.binding.provide(unselected())).then(value => {
        expect(tick).toBe(before); // Unselected evaluation touches no SDK clock or observer.
        return value;
      });
    }));
    expect(original).toBe(7);
    expect(reads).toBe(4);
    expect(collector.records().map(event => event.kind !== "work" && "name" in event ? event.name : event.kind))
      .toEqual(["request", "native Payload operation"]);
    const records = collector.records();
    expect(records[1]?.parentId).toBe(records[0]?.id);
    expect(records[0]).toMatchObject({ resources: { process: { user: 3000 } } });
    expect(records[1]).toMatchObject({ resources: { process: { user: 1000 } } });
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, droppedEvents: 0, failureCount: 0 });
  });

  it("retains selected ancestors through intervening spans and isolated concurrent branches", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ observation: "owners", now: () => tick++ });
    const inner = Effect.fn("ApplicationBindingProjection.readAccepted")(() => Effect.succeed(1));
    const unknown = Effect.fn("Unselected.intervening")(() => inner());
    const outer = Effect.fn("InstallationRuntime.accept")(() => Effect.yieldNow.pipe(Effect.andThen(unknown())));
    await collector.runRequest("root", () => Effect.runPromise(collector.binding.provide(Effect.all([outer(), outer()], { concurrency: 2 }))));
    const records = collector.records();
    const root = records.find(event => event.kind === "effectSpan" && event.name === "root");
    const outers = records.filter(event => event.kind === "effectSpan" && event.name === "InstallationRuntime.accept");
    const inners = records.filter(event => event.kind === "effectSpan" && event.name === "ApplicationBindingProjection.readAccepted");
    expect(outers).toHaveLength(2);
    expect(inners).toHaveLength(2);
    expect(outers.every(event => event.parentId === root?.id)).toBe(true);
    expect(new Set(inners.map(event => event.parentId))).toEqual(new Set(outers.map(event => event.id)));
    expect(records).toHaveLength(5);
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, failureCount: 0 });
  });

  it("selects coarse Atomic and native workflow producers with bounded counters and genuine nesting", async () => {
    let tick = 0, reads = 0;
    const collector = createEffectMeasurementCollector({ observation: "owners", now: () => tick++, readResources: () => ({
      process: { user: ++reads, system: 0 }, thread: null,
      eventLoop: { idle: 0, active: reads, utilization: 1 },
    }) });
    const canonical = Effect.fn("ApplicationReadiness.readReady")(() => Effect.void);
    const installed = Effect.fn("ApplicationReadiness.readReadyInstalled")(() => canonical());
    const prepare = Effect.fn("ApplicationActivation.prepareBindingSelection")(() => installed());
    const omittedReadinessFrame = Effect.fn("Unselected.readinessFrame")((work: Effect.Effect<void>) => Effect.gen(function* () {
      const tracer = yield* Tracer.Tracer;
      expect(tracer.context).toBeUndefined();
      return yield* work;
    }));
    const authenticate = Effect.fn("ApplicationReadiness.authenticateInstalled")((reprove: boolean) =>
      reprove ? omittedReadinessFrame(canonical()) : Effect.void);
    const validateReadiness = Effect.fn("ApplicationReadiness.validateStoredIssuedReadiness")((reprove: boolean) =>
      omittedReadinessFrame(authenticate(reprove)));
    const inspect = Effect.fn("LogicalStorageReadiness.inspect")(() => Effect.void);
    const verify = Effect.fn("DataBinding.verifyLogicalSchema")(() => inspect());
    const make = Effect.fn("LogicalCommerce.make")(() => Effect.void);
    const unselected = Effect.fn("LogicalDocuments.relationalChange")(() => Effect.withFiber(fiber => Effect.gen(function* () {
      const tracer = yield* Tracer.Tracer;
      expect(tracer.context).toBeUndefined();
      expect(fiber.currentSpan).toBeInstanceOf(Tracer.NativeSpan);
      return yield* Effect.succeed(1);
    })));
    const native = Effect.fn("MedusaWorkflow.runNative")(() => Effect.gen(function* () {
      for (let source = 0; source < 3; source++) yield* make();
      const before = tick;
      for (let call = 0; call < 9; call++) yield* unselected();
      expect(tick).toBe(before);
      return 7;
    }));
    const workflow = Effect.fn("Workflow.runAtomic")(() => native());
    const close = Effect.fn("AtomicCommerce.closeContributions")(() => Effect.void);
    const finalize = Effect.fn("CommerceCommit.finalize")(() => Effect.void);
    const execute = Effect.fn("AtomicCommerce.executeRequest")(() => Effect.gen(function* () {
      const value = yield* workflow();
      yield* close();
      yield* finalize();
      return value;
    }));
    const checkBinding = Effect.fn("LogicalSourceAdmission.checkBinding")(() => Effect.gen(function* () {
      for (let source = 0; source < 3; source++) {
        yield* validateReadiness(source === 0);
        yield* verify();
      }
      return yield* execute();
    }));
    const admissions = Effect.fn("AtomicCommerce.withAdmissions")(() => checkBinding());
    const attempt = Effect.fn("AtomicCommerce.attempt")(() => Effect.gen(function* () {
      yield* prepare();
      return yield* admissions();
    }));
    const value = await collector.runRequest("request", () => collector.binding.withPhase("native Medusa workflow", () =>
      Effect.runPromise(collector.binding.provide(attempt()))));
    expect(value).toBe(7);
    const records = collector.records();
    const selected = (name: string) => {
      const event = records.find(record => (record.kind === "effectSpan" || record.kind === "phase") && record.name === name);
      if (event === undefined) throw new Error(`Missing selected test producer: ${name}`);
      return event;
    };
    const root = selected("request"), fixture = selected("native Medusa workflow"), outer = selected("AtomicCommerce.attempt");
    const execution = selected("AtomicCommerce.executeRequest"), runAtomic = selected("Workflow.runAtomic");
    const runNative = selected("MedusaWorkflow.runNative");
    expect(fixture.parentId).toBe(root.id);
    expect(outer.parentId).toBe(fixture.id);
    expect(execution.parentId).toBe(outer.id);
    expect(runAtomic.parentId).toBe(execution.id);
    expect(runNative.parentId).toBe(runAtomic.id);
    expect(runNative.id).not.toBe(fixture.id);
    const bindings = records.filter(event => event.kind === "effectSpan" && event.name === "DataBinding.verifyLogicalSchema");
    const readiness = records.filter(event => event.kind === "effectSpan" && event.name === "LogicalStorageReadiness.inspect");
    const working = records.filter(event => event.kind === "effectSpan" && event.name === "LogicalCommerce.make");
    const preparations = records.filter(event => event.kind === "effectSpan" && event.name === "ApplicationActivation.prepareBindingSelection");
    const validations = records.filter(event => event.kind === "effectSpan" && event.name === "ApplicationReadiness.validateStoredIssuedReadiness");
    const authentications = records.filter(event => event.kind === "effectSpan" && event.name === "ApplicationReadiness.authenticateInstalled");
    const canonicals = records.filter(event => event.kind === "effectSpan" && event.name === "ApplicationReadiness.readReady");
    expect(preparations).toHaveLength(1);
    expect(preparations[0]).toMatchObject({ parentId: outer.id, owner: "applicationBindingPreparation" });
    expect(validations).toHaveLength(3);
    expect(validations.every(event => event.parentId === outer.id && event.owner === "applicationReadinessAcceptance")).toBe(true);
    expect(authentications).toHaveLength(3);
    expect(new Set(authentications.map(event => event.parentId))).toEqual(new Set(validations.map(event => event.id)));
    expect(authentications.every(event => event.owner === "applicationReadinessAcceptance")).toBe(true);
    // Synthetic renewal/reproof branches: one canonical preparation, one nested
    // reproof, and two authentications that do not call canonical preparation.
    expect(canonicals).toHaveLength(2);
    expect(canonicals.every(event => event.owner === "applicationReadinessPreparation")).toBe(true);
    expect(canonicals[0]?.parentId).toBe(preparations[0]?.id);
    expect(canonicals[1]?.parentId).toBe(authentications[0]?.id);
    expect(bindings).toHaveLength(3);
    expect(bindings.every(event => event.parentId === outer.id && event.owner === "logicalBindingAcceptance")).toBe(true);
    expect(readiness).toHaveLength(3);
    expect(new Set(readiness.map(event => event.parentId))).toEqual(new Set(bindings.map(event => event.id)));
    expect(readiness.every(event => event.owner === "logicalReadinessAcceptance")).toBe(true);
    expect(working).toHaveLength(3);
    expect(working.every(event => event.parentId === runNative.id && event.owner === "logicalWorkingSet")).toBe(true);
    expect(outer.owner).toBe("atomicCommerceExecution");
    expect(execution.owner).toBe("atomicCommerceExecution");
    expect(runAtomic.owner).toBe("medusaWorkflow");
    expect(runNative.owner).toBe("medusaWorkflow");
    expect(selected("AtomicCommerce.closeContributions")).toMatchObject({ parentId: execution.id, owner: "finiteCommitPreparation" });
    expect(selected("CommerceCommit.finalize")).toMatchObject({ parentId: execution.id, owner: "commercePublication" });
    expect(records).toHaveLength(26);
    expect(reads).toBe(records.length * 2);
    expect(records.every(event => event.kind === "effectSpan" || event.kind === "phase")).toBe(true);
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, droppedEvents: 0, failureCount: 0 });
  });

  it("retains native root ancestry and coarse publication without fine phases or scalar delivery", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ observation: "owners", now: () => tick++ });
    const observation = collector.publicationObservation();
    expect(observation.detail).toBe(false);
    await collector.runRequest("root", () => collector.binding.withPhase("authoritative publication", () =>
      observePointCommitPublicationPromise(observation, "transaction", async () => {
        observation.record({ kind: "counts", owner: "plan", counts: { rows: 3 } });
        return Effect.runPromise(observePointCommitPublicationEffect(observation, "lowering",
          observePointCommitPublicationEffect(observation, "durablePublication", Effect.succeed(1))));
      })));
    const records = collector.records();
    const root = records.find(event => event.kind === "effectSpan" && event.name === "root");
    const native = records.find(event => event.kind === "phase" && event.name === "authoritative publication");
    const transaction = records.find(event => event.kind === "phase" && event.name === "publication.transaction");
    const effect = records.find(event => event.kind === "effectSpan" && event.name === "publication.durablePublication");
    expect(native?.parentId).toBe(root?.id);
    expect(transaction?.parentId).toBe(native?.id);
    expect(effect?.parentId).toBe(native?.id);
    expect(records).toHaveLength(4);
    expect(records.some(event => event.kind === "work")).toBe(false);
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, failureCount: 0 });
  });

  it("preserves full business Cause and cleanup while selected counter faults settle independently", async () => {
    let tick = 0, reads = 0, released = 0;
    const original = Cause.combine(Cause.fail({ _tag: "Refused" }), Cause.die(new Error("original defect")));
    const collector = createEffectMeasurementCollector({ observation: "owners", now: () => tick++, readResources: () => {
      if (++reads === 1 || reads === 3) throw new Error("counter fault");
      return { process: { user: reads, system: 0 }, thread: null, eventLoop: { idle: 0, active: 0, utilization: 0 } };
    } });
    const exit = await collector.runRequest("root", () => Effect.runPromiseExit(collector.binding.provide(
      collector.binding.traceEffect("native Payload operation", Effect.failCause(original).pipe(
        Effect.ensuring(Effect.sync(() => { released++; })))))));
    expect(Exit.isFailure(exit) && exit.cause).toBe(original);
    expect(released).toBe(1);
    expect(reads).toBe(4);
    expect(collector.status()).toMatchObject({ failureCount: 2, closed: true, lostContextEvents: 0 });
    expect(collector.records().find(event => event.kind === "effectSpan" && event.name === "native Payload operation"))
      .toMatchObject({ outcome: "mixed", endMs: expect.any(Number) });
    const rejection = { _tag: "OriginalPromiseFailure" };
    const failed = createEffectMeasurementCollector({ observation: "owners", now: () => tick++ });
    await expect(failed.runRequest("root", async () => { throw rejection; })).rejects.toBe(rejection);
  });

  it("brackets native publication phases and rejects backwards resource readings", async () => {
    let tick = 0;
    let reads = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++, readResources: () => {
      reads++;
      return { process: { user: reads === 3 ? 0 : reads * 1000, system: 0 }, thread: null,
        eventLoop: { idle: reads, active: reads, utilization: 0.5 } };
    } });
    const observation = collector.publicationObservation();
    const original = { id: "original business value" };
    expect(await collector.runRequest("request", () => observePointCommitPublicationPromise(observation,
      "lowering", () => Promise.resolve(original)))).toBe(original);
    const phase = collector.records().find(event => event.kind === "phase" && event.name === "publication.lowering");
    expect(phase).not.toHaveProperty("resources");
    expect(collector.status().failureCount).toBe(1);
    expect(collector.records().find(event => event.kind === "effectSpan" && event.name === "request"))
      .toMatchObject({ resources: { process: { user: 3000, system: 0 } } });
  });
  it("brackets coarse resources and leaves internal counter observations absent", async () => {
    let tick = 0;
    let reads = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++, readResources: () => {
      reads++;
      return { process: { user: reads * 1000, system: 0 }, thread: null,
        eventLoop: { idle: reads, active: reads, utilization: 0.5 } };
    } });
    const internal = Effect.fn("unknown internal operation")(() => Effect.succeed(7));
    expect(await collector.runRequest("request", () => collector.binding.withPhase("native Product operation", () =>
      Effect.runPromise(collector.binding.provide(internal()))))).toBe(7);
    expect(reads).toBe(4);
    const records = collector.records();
    const root = records.find(event => event.kind === "effectSpan" && event.name === "request");
    const phase = records.find(event => event.kind === "phase" && event.name === "native Product operation");
    expect(root).toMatchObject({ resources: { process: { user: 3000, system: 0 }, thread: null,
      eventLoop: { idle: 3, active: 3, utilization: 0.5 } } });
    expect(phase).toMatchObject({ resources: { process: { user: 1000, system: 0 } } });
    expect(records.find(event => event.kind === "effectSpan" && event.name === "unknown internal operation"))
      .not.toHaveProperty("resources");
    if (root?.kind !== "effectSpan" || root.resources === undefined) throw new Error("Missing root counters");
    Object.assign(root.resources.process, { user: 0 });
    expect(collector.records().find(event => event.id === root.id)).toMatchObject({ resources: { process: { user: 3000 } } });
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, failureCount: 0 });
  });

  it("contains foreign counter faults without changing original business outcomes", async () => {
    let tick = 0;
    const original = { _tag: "OriginalRefusal" };
    const collector = createEffectMeasurementCollector({ now: () => tick++, readResources: () => {
      throw new Error("counter reader failed");
    } });
    await expect(collector.runRequest("request", async () => { throw original; })).rejects.toBe(original);
    expect(collector.status().failureCount).toBeGreaterThan(0);
    expect(collector.records().every(event => !("resources" in event))).toBe(true);
  });

  it("assigns inspected finite capture names without assigning unknown names", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const capture = Effect.fn("FiniteStorageCapture.run")(() => Effect.succeed(1));
    const unknown = Effect.fn("Uninspected.run")(() => Effect.succeed(2));
    await collector.runRequest("request", () => Effect.runPromise(collector.binding.provide(
      capture().pipe(Effect.andThen(unknown())))));
    expect(collector.records().find(event => event.kind === "effectSpan" && event.name === "FiniteStorageCapture.run"))
      .toMatchObject({ owner: "logicalReadCapture" });
    expect(collector.records().find(event => event.kind === "effectSpan" && event.name === "Uninspected.run"))
      .toMatchObject({ owner: null });
  });

  it("supplies tracing to publication's genuine independent runtime without an outer binding", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const observation = collector.publicationObservation();
    const original = Cause.combine(Cause.fail({ _tag: "Refused" }), Cause.die(new Error("original defect")));
    const exit = await collector.runRequest("request", () => collector.binding.withPhase("authoritative publication", () =>
      Effect.runPromiseExit(observePointCommitPublicationEffect(observation, "transaction", Effect.failCause(original)))));
    const phase = collector.records().find(event => event.kind === "phase" && event.name === "authoritative publication");
    const span = collector.records().find(event => event.kind === "effectSpan" && event.name === "publication.transaction");
    expect(span).toMatchObject({ parentId: phase?.id, owner: "pointCommitPublication", role: "operation", outcome: "mixed" });
    expect(Exit.isFailure(exit) && exit.cause).toBe(original);
    expect(collector.status()).toMatchObject({ lostContextEvents: 0, droppedEvents: 0, failureCount: 0 });
  });

  it("reads exact retained operations across concurrent fibers and isolated request collectors", async () => {
    const first = createEffectMeasurementCollector({ now: () => performance.now() });
    const second = createEffectMeasurementCollector({ now: () => performance.now() });
    const read = Effect.fn("initiating operation")(() => Effect.sleep("1 millis").pipe(
      Effect.andThen(Effect.sync(() => first.currentOperationId()))));
    const [firstIds, secondId] = await Promise.all([
      first.runRequest("first", () => Effect.runPromise(first.binding.provide(Effect.all([read(), read()], { concurrency: 2 })))),
      second.runRequest("second", () => second.binding.withPhase("native Promise operation", async () => second.currentOperationId())),
    ]);
    const actual = first.records().filter(event => event.kind === "effectSpan" && event.name === "initiating operation");
    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2);
    expect(firstIds.every(id => actual.some(event => event.id === id))).toBe(true);
    expect(second.records().some(event => event.id === secondId && event.kind === "phase")).toBe(true);
    expect(first.records().some(event => event.id === secondId)).toBe(false);
    expect(first.status().lostContextEvents).toBe(0);
    expect(second.status().lostContextEvents).toBe(0);
  });

  it("does not expose dropped or closed operations as database parents", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++, capacity: 2 });
    const child = Effect.fn("dropped operation")(() => Effect.sync(() => collector.currentOperationId()));
    expect(await collector.runRequest("request", () => Effect.runPromise(collector.binding.provide(child())))).toBeNull();
    expect(collector.status().droppedEvents).toBeGreaterThan(0);
    expect(collector.currentOperationId()).toBeNull();
  });

  it("parents an explicitly request-owned fiber to the root beyond its shorter admission phase", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    await collector.runRequest("request", async () => {
      let child: Fiber.Fiber<number> | undefined;
      await collector.binding.withPhase("admission", async () => {
        child = Effect.runFork(collector.binding.provideRequest(collector.binding.traceEffect("request-owned fiber",
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(7)))));
        await Effect.runPromise(collector.binding.provide(Deferred.await(started)));
      });
      await Effect.runPromise(Deferred.succeed(release, undefined));
      if (child === undefined) throw new Error("Missing request-owned test fiber");
      return Effect.runPromise(Fiber.join(child));
    });
    const records = collector.records();
    const root = records.find(event => event.kind === "effectSpan" && event.name === "request");
    const child = records.find(event => event.kind === "effectSpan" && event.name === "request-owned fiber");
    const admission = records.find(event => event.kind === "phase" && event.name === "admission");
    expect(child?.parentId).toBe(root?.id);
    if (child === undefined || admission === undefined || child.kind === "work" || admission.kind === "work")
      throw new Error("Missing test intervals");
    expect(child.endMs).toBeGreaterThan(admission.endMs!);
    expect(collector.status()).toMatchObject({ droppedEvents: 0, lostContextEvents: 0 });
  });

  it("returns original new work after request closure while retaining escaped earlier work as incomplete", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const child = await collector.runRequest("request", async () => {
      const fiber = Effect.runFork(collector.binding.provideRequest(collector.binding.traceEffect("escaped fiber",
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))))));
      await Effect.runPromise(collector.binding.provide(Deferred.await(started)));
      return fiber;
    });
    const work = Effect.succeed(11);
    expect(collector.binding.provide(work)).toBe(work);
    expect(collector.binding.provideRequest(work)).toBe(work);
    expect(collector.binding.traceEffect("post-request verification", work)).toBe(work);
    const original = Promise.resolve(12);
    expect(collector.binding.withPhase("post-request verification", () => original)).toBe(original);
    expect(collector.status()).toMatchObject({ droppedEvents: 0, lostContextEvents: 0 });
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(child));
    const escaped = collector.records().find(event => event.kind === "effectSpan" && event.name === "escaped fiber");
    expect(escaped?.kind !== "work" && escaped?.endMs).toBeNull();
    expect(collector.status().lostContextEvents).toBeGreaterThan(0);
  });

  it("preserves request parentage across structured fibers and genuine independent runtimes", async () => {
    let tick = 100;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const child = Effect.fn("actual child")(() => Effect.succeed(7));
    const value = await collector.runRequest("request", () => collector.binding.withPhase("native Promise owner", () =>
      Effect.runPromise(collector.binding.provide(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(child());
        const result = yield* Fiber.join(fiber);
        const bridged = yield* Effect.promise(() => Effect.runPromise(collector.binding.provide(child())));
        return result + bridged;
      }))))));
    expect(value).toBe(14);
    const records = collector.records();
    const root = records.find(event => event.kind === "effectSpan" && event.name === "request");
    const native = records.find(event => event.kind === "phase" && event.name === "native Promise owner");
    const children = records.filter(event => event.kind === "effectSpan" && event.name === "actual child");
    expect(root?.parentId).toBeNull();
    expect(native?.parentId).toBe(root?.id);
    expect(children).toHaveLength(2);
    expect(children.every(event => event.parentId === native?.id)).toBe(true);
    expect(children.every(event => event.kind === "effectSpan" && event.traceId ===
      (root?.kind === "effectSpan" ? root.traceId : null) && event.fiberId !== null)).toBe(true);
    expect(children[0]?.kind === "effectSpan" && children[1]?.kind === "effectSpan" &&
      children[0].fiberId !== children[1].fiberId).toBe(true);
    expect(collector.status()).toMatchObject({ droppedEvents: 0, lostContextEvents: 0, failureCount: 0, closed: true });
    expect(records.every(event => event.kind === "work" || event.endMs !== null)).toBe(true);
  });

  it("retains full failure classes and the actual Exit while replacing publication phase wrappers", async () => {
    let tick = 0;
    const collector = createEffectMeasurementCollector({ now: () => tick++ });
    const observation = collector.publicationObservation();
    const combined = Cause.combine(Cause.fail({ _tag: "Refused" }), Cause.die(new Error("private input")));
    const exits = await collector.runRequest("request", async () => {
      const outcomes: Exit.Exit<unknown, unknown>[] = [];
      for (const work of [Effect.fail({ _tag: "Refused" }), Effect.die(new Error("defect")),
        Effect.interrupt, Effect.failCause(combined)]) {
        outcomes.push(await Effect.runPromiseExit(collector.binding.provide(
          observePointCommitPublicationEffect(observation, "transaction", work))));
      }
      observation.record({ kind: "counts", owner: "plan", counts: { rows: 3, canonicalBytes: 11 } });
      return outcomes;
    });
    const spans = collector.records().filter(event => event.kind === "effectSpan" && event.name === "publication.transaction");
    expect(spans.map(event => event.kind === "effectSpan" && event.outcome))
      .toEqual(["typedFailure", "defect", "interruption", "mixed"]);
    expect(collector.records().some(event => event.kind === "phase" && event.name === "publication.transaction")).toBe(false);
    expect(exits[3] && Exit.isFailure(exits[3]) && exits[3].cause).toBe(combined);
    expect(collector.fullExits().get(spans[3]!.id)).toBe(exits[3]);
    expect(JSON.stringify(collector.records())).not.toContain("private input");
    const counts = collector.records().filter(event => event.kind === "work");
    expect(counts.map(event => event.kind === "work" && [event.metric, event.value, event.unit])).toEqual([
      ["rows", 3, "count"], ["canonicalBytes", 11, "bytes"],
    ]);
    observation.assertHealthy();
  });

  it("uses its independent monotonic clock when the business wall clock moves backwards", async () => {
    let monotonic = 40;
    let wall = 900n;
    const businessClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => Number(wall), currentTimeMillis: Effect.sync(() => Number(wall)),
      currentTimeNanosUnsafe: () => wall--, currentTimeNanos: Effect.sync(() => wall--),
      monotonicTimeNanosUnsafe: () => 1n, monotonicTimeNanos: Effect.succeed(1n), sleep: () => Effect.void,
    };
    const collector = createEffectMeasurementCollector({ now: () => monotonic++ });
    const observed = await collector.runRequest("root", () => Effect.runPromise(collector.binding.provide(
      collector.binding.traceEffect("business", Clock.currentTimeMillis).pipe(
        Effect.provideService(Clock.Clock, businessClock)))));
    expect(observed).toBe(899);
    const event = collector.records().find(event => event.kind === "effectSpan" && event.name === "business");
    if (event?.kind !== "effectSpan") throw new Error("Missing business span");
    expect(BigInt(event.effectEndNanos!)).toBeLessThan(BigInt(event.effectStartNanos!));
    expect(event.endMs).toBeGreaterThan(event.startMs);
  });

  it("preserves original Promise failures and reports clock faults and capacity loss after settlement", async () => {
    const original = new Error("original callback failure");
    const clockFailure = new Error("diagnostic clock failure");
    const collector = createEffectMeasurementCollector({ now: () => { throw clockFailure; }, capacity: 2 });
    await expect(collector.runRequest("root", async () => { throw original; })).rejects.toBe(original);
    expect(collector.status().failureCount).toBeGreaterThan(0);
    expect(collector.status().droppedEvents).toBeGreaterThan(0);
    expect(() => collector.assertHealthy()).toThrow(expect.objectContaining({ cause: clockFailure }));
    await expect(collector.runRequest("again", async () => 1)).rejects.toThrow("single-request");
  });
});
