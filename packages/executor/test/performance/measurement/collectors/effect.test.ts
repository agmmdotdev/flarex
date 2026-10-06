import { Cause, Clock, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { observePointCommitPublicationEffect, observePointCommitPublicationPromise } from "../../../../../persistence-postgres/src/pointCommitPublicationObservation";
import { createEffectMeasurementCollector } from "./effect";

describe("diagnostic Effect measurement collector", () => {
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
