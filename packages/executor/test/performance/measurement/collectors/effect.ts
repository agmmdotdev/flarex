import { AsyncLocalStorage } from "node:async_hooks";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { Cause, Effect, Exit, Layer, Option, Result, Schema, Tracer } from "effect";
import { PointCommitPublicationObservation, type PointCommitPublicationEvent } from
  "../../../../../persistence-postgres/src/pointCommitPublicationObservation";
import { PhysicalSessionObservation } from "../../../../../persistence-postgres/src/physicalSession/observation";
import type { MeasurementEvent, MeasurementObserver } from "../artifact";
import { ResourceCountersSchema, ResourceReadingSchema, type ResourceReading } from "../cpu";
import { failureTokens, type MixedMutationEffectDiagnostics } from "../../support/measurement";

type SpanRecord = Extract<MeasurementEvent, { kind: "effectSpan" }>;
type PhaseRecord = Extract<MeasurementEvent, { kind: "phase" }>;
type BindingContext = Readonly<{ parent: Tracer.AnySpan | undefined; fiberId: string | null }>;

/** Exact observed boundary names, checked against fixture traceEffect/tracePhase
 * sites and their named source operations. Unknown names stay gaps. */
const boundaryOwners = new Map<string, string>([
  ["request admission", "applicationAdmission"],
  ["stored read and source preparation", "applicationAdmission"],
  ["finite outer entry activation", "finiteExecution"],
  ["portable runtime execution", "executorRuntime"],
  ["Worker execution", "executorRuntime"],
  ["runtime result validation", "executorRuntime"],
  ["complete call cleanup", "requestLifecycle"],
  ["Application point", "applicationJournal"],
  ["Product borrow and source checks", "logicalParticipantAdmission"],
  ["Payload borrow and source checks", "logicalParticipantAdmission"],
  ["Workflow borrow and source checks", "logicalParticipantAdmission"],
  ["Product operation close", "logicalWorkingSet"],
  ["native Product operation", "medusaProduct"],
  ["native Payload operation", "payload"],
  ["native Medusa workflow", "medusaWorkflow"],
  ["Payload operation scopes close", "payload"],
  ["finite freeze and validation", "finiteCommitPreparation"],
  ["freeze and verify", "finiteCommitPreparation"],
  ["authoritative publication", "pointCommitPublication"],
  ["LogicalDocuments.make", "logicalWorkingSet"],
  ["LogicalDocuments.requireReadDemand", "logicalReadCapture"],
  ["LogicalDocuments.consumeAccessMetadata", "logicalReadCapture"],
  ["LogicalDocuments.get", "logicalWorkingSet"],
  ["LogicalDocuments.getMany", "logicalWorkingSet"],
  ["LogicalDocuments.relationalFind", "logicalWorkingSet"],
  ["LogicalDocuments.relationalPage", "logicalWorkingSet"],
  ["LogicalDocuments.relationalChange", "logicalWorkingSet"],
  ["LogicalDocuments.readRelationalSelection", "logicalWorkingSet"],
  ["LogicalDocuments.locate", "logicalWorkingSet"],
  ["LogicalDocuments.validateWrite", "logicalWorkingSet"],
  ["LogicalDocuments.validateUnique", "logicalWorkingSet"],
  ["LogicalDocuments.validateRelationalReferences", "logicalWorkingSet"],
  ["LogicalDocuments.close", "logicalWorkingSet"],
  ["LogicalSourceAdmission.captureMetadata", "logicalSourceAdmission"],
  ["LogicalSourceAdmission.pinFiniteReadBinding", "logicalSourceAdmission"],
  ["LogicalDocumentMaterialization.prepareDelta", "logicalMaterialization"],
  ["LogicalDocumentMaterialization.lower", "logicalMaterialization"],
  ["LogicalDocumentMaterialization.completeBatch", "logicalMaterialization"],
  ["FiniteStorageCapture.run", "logicalReadCapture"],
  ["FiniteStorageCapture.acceptOwnership", "logicalReadCapture"],
  ["FiniteStorageCapture.acceptDemandBuild", "logicalReadCapture"],
  ["SessionJournalStore.freezeFiniteRoot", "finiteCommitPreparation"],
  ["SessionJournalStore.prepareFiniteEntry", "finiteExecution"],
  ["ApplicationMutationSessionActivation.completeFiniteEntry", "finiteExecution"],
  ["ApplicationMutationSessionActivation.prepareFiniteSession", "finiteExecution"],
  ["ApplicationMutationSessionActivation.finiteEntryContext", "finiteExecution"],
  ["ApplicationMutationSessionActivation.enterFiniteInTransaction", "finiteExecution"],
  ["PointCommitTransaction.prepareFiniteCommand", "finiteCommitPreparation"],
  ["PostgresPhysicalSession.implicitRead", "physicalDatabase"],
  ["PostgresPhysicalSession.drain", "physicalSession"],
  ["PostgresPhysicalSession.release", "physicalSession"],
  ["PostgresPhysicalSession.cancel", "physicalSession"],
  ["PostgresPhysicalSession.quarantine", "physicalSession"],
  ["PointCommitTransaction.publishFinite", "pointCommitPublication"],
  ["ApplicationDocument.acceptPublication", "pointCommitPublication"],
  ["ApplicationDocument.materializeAcceptedPublication", "logicalMaterialization"],
  ["AppIndexEntries.consumeCurrentPages", "applicationIndexes"],
  ["LogicalDocuments.withCandidateSelection", "logicalWorkingSet"],
  ["FiniteEntryObservation.capture", "finiteExecution"],
  ["FinitePublication.observeMetadata", "pointCommitPublication"],
  ["ApplicationRelationReadinessFold.validatePreparedInTransaction", "applicationReadinessAcceptance"],
  ["ApplicationRelationReadinessFold.validateProtectedReplay", "applicationReadinessAcceptance"],
  ["ApplicationBindingProjection.readAccepted", "applicationBindingAcceptance"],
  ["ApplicationActivation.prepareBindingSelection", "applicationBindingPreparation"],
  ["ApplicationReadiness.validateStoredIssuedReadiness", "applicationReadinessAcceptance"],
  ["ApplicationReadiness.authenticateInstalled", "applicationReadinessAcceptance"],
  ["ApplicationReadiness.readReady", "applicationReadinessPreparation"],
  ["InstallationRuntime.accept", "installationAcceptance"],
  ["AtomicCommerce.attempt", "atomicCommerceExecution"],
  ["AtomicCommerce.executeRequest", "atomicCommerceExecution"],
  ["DataBinding.verifyLogicalSchema", "logicalBindingAcceptance"],
  ["LogicalStorageReadiness.inspect", "logicalReadinessAcceptance"],
  ["LogicalCommerce.make", "logicalWorkingSet"],
  ["Workflow.runAtomic", "medusaWorkflow"],
  ["MedusaWorkflow.runNative", "medusaWorkflow"],
  ["AtomicCommerce.closeContributions", "finiteCommitPreparation"],
  ["CommerceCommit.finalize", "commercePublication"],
  ["CmsCommit.finalize", "cmsPublication"],
  ["CmsCommit.publishOutcome", "cmsPublication"],
  ["ScopeAuthority.resolveLocatedTrustedById", "scopeAuthorityResolution"],
]);
const boundaryOwner = (name: string) => boundaryOwners.get(name) ?? null;
// Exact existing producer names. These are inclusive owner envelopes, not
// standalone admission costs or a complete operation timeline.
const ownerBoundaries = new Set([
  "ApplicationRelationReadinessFold.validatePreparedInTransaction",
  "ApplicationRelationReadinessFold.validateProtectedReplay",
  "ApplicationBindingProjection.readAccepted", "InstallationRuntime.accept",
  "ApplicationActivation.prepareBindingSelection", "ApplicationReadiness.validateStoredIssuedReadiness",
  "ApplicationReadiness.authenticateInstalled", "ApplicationReadiness.readReady",
  "AtomicCommerce.attempt", "AtomicCommerce.executeRequest",
  "DataBinding.verifyLogicalSchema", "LogicalStorageReadiness.inspect", "LogicalCommerce.make",
  "Workflow.runAtomic", "MedusaWorkflow.runNative",
  "AtomicCommerce.closeContributions", "CommerceCommit.finalize",
  "native Product operation", "native Payload operation", "native Medusa workflow",
  "request admission", "stored read and source preparation", "finite outer entry activation",
  "portable runtime execution", "Worker execution", "Application point",
  "finite freeze and validation", "freeze and verify", "authoritative publication",
  "runtime result validation", "complete call cleanup", "CmsCommit.finalize",
  "CmsCommit.publishOutcome", "PointCommitTransaction.publishFinite",
  "ApplicationDocument.acceptPublication", "ApplicationDocument.materializeAcceptedPublication",
  "ScopeAuthority.resolveLocatedTrustedById",
  "publication.publisher", "publication.transaction", "publication.durablePublication",
  "PostgresPhysicalSession.drain", "PostgresPhysicalSession.release",
  "PostgresPhysicalSession.cancel", "PostgresPhysicalSession.quarantine",
]);
// Coarse counter brackets only. Internal spans remain wall evidence without
// a syscall at every row/helper. These are actual source-owned boundaries.
const resourceBoundaries = new Set([
  "request admission", "stored read and source preparation", "finite outer entry activation",
  "portable runtime execution", "Worker execution", "Application point", "native Product operation",
  "native Payload operation", "native Medusa workflow", "finite freeze and validation", "freeze and verify",
  "authoritative publication", "runtime result validation", "complete call cleanup", "FiniteStorageCapture.run",
  "SessionJournalStore.freezeFiniteRoot", "ApplicationMutationSessionActivation.completeFiniteEntry",
  "PointCommitTransaction.prepareFiniteCommand",
  "LogicalDocuments.readRelationalSelection",
  "LogicalDocuments.validateContribution", "LogicalDocuments.compileRelationalRead",
  "LogicalDocuments.relationalChange", "FiniteStorageCapture.acceptOwnership",
  "FiniteStorageCapture.acceptDemandBuild",
]);
const decodeResourceReading = Schema.decodeUnknownResult(ResourceReadingSchema, { onExcessProperty: "error" });
const decodeResourceCounters = Schema.decodeUnknownResult(ResourceCountersSchema, { onExcessProperty: "error" });
// This named operation owns fork/race/join and the fixture's initialDone wait.
// Its interval remains evidence; it is not a foreground execution frontier.
const operationRole = (name: string): SpanRecord["role"] =>
  name === "PointMutationExecutionLiveness.supervise" ? "coordination" : "operation";

export function classifyMeasurementExit(exit: Exit.Exit<unknown, unknown>): SpanRecord["outcome"] {
  if (Exit.isSuccess(exit)) return "success";
  const typed = Cause.hasFails(exit.cause);
  const defect = Cause.hasDies(exit.cause);
  const interruption = Cause.hasInterrupts(exit.cause);
  if (Number(typed) + Number(defect) + Number(interruption) > 1) return "mixed";
  return typed ? "typedFailure" : defect ? "defect" : interruption ? "interruption" : "unknown";
}

/** One diagnostic request. Platform monotonic time belongs to this test adapter;
 * the application's Effect Clock and all business lifetimes remain untouched. */
export function createEffectMeasurementCollector(input: Readonly<{
  now: () => number;
  capacity?: number;
  readResources?: () => ResourceReading;
  observation?: "owners";
}>) {
  const ownersOnly = input.observation === "owners";
  const capacity = input.capacity ?? 20_000;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Invalid Effect collection capacity");
  const context = new AsyncLocalStorage<BindingContext>();
  const events: MeasurementEvent[] = [];
  const positions = new WeakMap<object, number>();
  const observerIntervals: MeasurementObserver[] = [];
  const exits = new Map<string, Exit.Exit<unknown, unknown>>();
  const identities = new WeakMap<Tracer.AnySpan, string>();
  const retainedIds = new Set<string>();
  const nativePhases = new Map<string, PhaseRecord[]>();
  let sequence = 0;
  let droppedEvents = 0;
  let lostContextEvents = 0;
  let failureCount = 0;
  let firstFailure: unknown;
  let lastTime = 0;
  let started = false;
  let closed = false;
  let rootId: string | null = null;
  let requestParent: Tracer.AnySpan | undefined;
  let originMonotonicMs = 0;
  const fault = (cause: unknown) => {
    if (failureCount === 0) firstFailure = cause;
    failureCount = Math.min(Number.MAX_SAFE_INTEGER, failureCount + 1);
  };
  const now = () => {
    try {
      const reading = input.now();
      if (!Number.isFinite(reading) || reading < lastTime) throw new Error("Invalid diagnostic monotonic clock");
      lastTime = reading;
    } catch (cause) { fault(cause); }
    return lastTime;
  };
  const resourceStart = () => {
    const read = input.readResources;
    if (read === undefined) return undefined;
    const atMonotonicMs = now();
    return Result.match(Result.try({ try: () => Result.getOrThrow(decodeResourceReading(read())), catch: cause => cause }), {
      onFailure: cause => { fault(cause); return undefined; },
      onSuccess: reading => ({ atMonotonicMs, reading }),
    });
  };
  const resourceEnd = (start: ReturnType<typeof resourceStart>) => {
    if (start === undefined) {
      // Selected acquisition failure must not suppress the closing reading.
      if (ownersOnly) resourceStart();
      return undefined;
    }
    const end = resourceStart();
    if (end === undefined) return undefined;
    const delta = (last: ResourceReading["process"], first: ResourceReading["process"]) =>
      ({ user: last.user - first.user, system: last.system - first.system });
    const idle = end.reading.eventLoop.idle - start.reading.eventLoop.idle;
    const active = end.reading.eventLoop.active - start.reading.eventLoop.active;
    return Result.match(decodeResourceCounters({
      window: { startMonotonicMs: start.atMonotonicMs, endMonotonicMs: end.atMonotonicMs },
      process: delta(end.reading.process, start.reading.process),
      thread: start.reading.thread === null || end.reading.thread === null ? null : delta(end.reading.thread, start.reading.thread),
      eventLoop: { idle, active, utilization: active + idle === 0 ? 0 : active / (active + idle) },
    }), { onFailure: cause => { fault(cause); return undefined; }, onSuccess: reading => reading });
  };
  const nativePhaseResources = new WeakMap<PhaseRecord, ReturnType<typeof resourceStart>>();
  const append = (event: MeasurementEvent) => {
    if (closed || events.length + observerIntervals.length >= capacity) { droppedEvents++; return false; }
    positions.set(event, events.length);
    retainedIds.add(event.id);
    events.push(event);
    return true;
  };
  const parentId = (parent: Tracer.AnySpan | undefined): string | null => {
    while (parent !== undefined) {
      const id = identities.get(parent);
      if (id !== undefined) return id;
      if (!ownersOnly || parent._tag === "ExternalSpan") return null;
      parent = Option.getOrUndefined(parent.parent);
    }
    return null;
  };
  const observer = (startMs: number, name: string) => {
    const endMs = now();
    if (closed || events.length + observerIntervals.length >= capacity) { droppedEvents++; return; }
    const ordinal = sequence++;
    observerIntervals.push({ kind: "observer", id: `effect-observer:${ordinal}`, sequence: ordinal,
      name, startMs, endMs, owner: "measurement", site: "effectCollector", parentId: null,
      outcome: failureCount === 0 ? "success" : "failure" });
  };
  const tracer = Tracer.make({
    ...(!ownersOnly ? { context<X>(primitive: Tracer.EffectPrimitive<X>, fiber: Parameters<NonNullable<Tracer.Tracer["context"]>>[1]): X {
      return context.run({ parent: fiber.currentSpan, fiberId: String(fiber.id) }, () =>
        primitive["~effect/Effect/evaluate"](fiber));
    } } : {}),
    span(options) {
      if (ownersOnly && !options.root && !ownerBoundaries.has(options.name)) return new Tracer.NativeSpan(options);
      const startMs = now();
      const resourcesBefore = ownersOnly || options.root || resourceBoundaries.has(options.name) || options.name.startsWith("publication.")
        ? resourceStart() : undefined;
      const span = new Tracer.NativeSpan(options);
      const id = `effect:${span.spanId}`;
      identities.set(span, id);
      const record: SpanRecord = { kind: "effectSpan", id, sequence: sequence++, name: options.name, role: operationRole(options.name),
        startMs, endMs: null, owner: boundaryOwner(options.name),
        site: options.name, parentId: parentId(Option.getOrUndefined(options.parent)),
        spanId: span.spanId, traceId: span.traceId, fiberId: context.getStore()?.fiberId ?? null,
        effectStartNanos: options.startTime.toString(), effectEndNanos: null, outcome: "unknown", cause: null };
      if (!started) lostContextEvents++;
      const retained = append(record);
      if (options.root && rootId === null) { rootId = id; originMonotonicMs = startMs; }
      const nativeEnd = span.end.bind(span);
      span.end = (endTime, exit) => {
        const endMs = now();
        nativeEnd(endTime, exit);
        if (closed) { droppedEvents++; lostContextEvents++; return; }
        if (retained) {
          let cause: string | null = null;
          try { if (Exit.isFailure(exit)) cause = failureTokens(exit.cause).join(",") || null; }
          catch (failure) { fault(failure); }
          const resources = resourceEnd(resourcesBefore);
          const completed: SpanRecord = { ...record, endMs, effectEndNanos: endTime.toString(),
            ...(resources === undefined ? {} : { resources }),
            outcome: Exit.isSuccess(exit) && span.attributes.get("measurement.failureAsData") === true
              ? "failure" : classifyMeasurementExit(exit), cause,
            owner: typeof span.attributes.get("measurement.owner") === "string"
              ? String(span.attributes.get("measurement.owner")) : record.owner,
            fiberId: typeof span.attributes.get("measurement.fiberId") === "string"
              ? String(span.attributes.get("measurement.fiberId")) : record.fiberId };
          const index = positions.get(record);
          if (index !== undefined) events[index] = completed;
          exits.set(id, exit);
        }
        observer(endMs, "Effect span completion");
      };
      observer(startMs, "Effect span creation");
      return span;
    },
  });
  const provide = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    if (closed) return work;
    const parent = context.getStore()?.parent;
    const traced = Effect.provideService(Effect.provideService(work, ExecutionDiagnostics, diagnosticPolicy), Tracer.Tracer, tracer);
    return parent === undefined ? traced : Effect.provideService(traced, Tracer.ParentSpan, parent);
  };
  const provideRequest = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    if (closed) return work;
    const traced = Effect.provideService(Effect.provideService(work, ExecutionDiagnostics, diagnosticPolicy), Tracer.Tracer, tracer);
    return requestParent === undefined ? traced : Effect.provideService(traced, Tracer.ParentSpan, requestParent);
  };
  // RC.112 withSpan/withParentSpan add Cause stack-frame annotations even with
  // captureStackTrace=false. useSpan owns the same native lifetime without
  // rewriting the business Cause; provide only its ParentSpan capability.
  const traceEffect = <A, E, R>(name: string, work: Effect.Effect<A, E, R>, owner?: string,
    isFailure?: (value: A) => boolean): Effect.Effect<A, E, R> => {
    if (closed || (ownersOnly && !ownerBoundaries.has(name))) return work;
    return Effect.withFiber(fiber => Effect.useSpan(name, {
      attributes: { "measurement.fiberId": String(fiber.id),
        ...(owner === undefined ? {} : { "measurement.owner": owner }) },
    }, span => Effect.provideService(isFailure === undefined ? work : work.pipe(Effect.tap(value => Effect.sync(() => {
      // The predicate is supplied by the physical owner. Foreign diagnostic
      // faults invalidate evidence after settlement without replacing its Exit.
      try { if (isFailure(value)) span.attribute("measurement.failureAsData", true); }
      catch (cause) { fault(cause); }
    }))), Tracer.ParentSpan, span)));
  };
  const diagnosticPolicy = { observe: traceEffect };
  const layer = Layer.merge(Layer.succeed(Tracer.Tracer, tracer), Layer.succeed(ExecutionDiagnostics, diagnosticPolicy));
  const withPhase = <A>(name: string, run: () => Promise<A>): Promise<A> => {
    if (closed || (ownersOnly && !ownerBoundaries.has(name))) return run();
    const startMs = now();
    const resourcesBefore = ownersOnly || resourceBoundaries.has(name) ? resourceStart() : undefined;
    const outer = context.getStore();
    if (outer === undefined) lostContextEvents++;
    const ordinal = sequence++;
    const id = `effect-phase:${ordinal}`;
    const parent = Tracer.externalSpan({ spanId: id, traceId: outer?.parent?.traceId ?? "unbound" });
    identities.set(parent, id);
    const record: PhaseRecord = { kind: "phase", id, sequence: ordinal, name, role: "operation", startMs, endMs: null,
      owner: boundaryOwner(name), site: name, parentId: parentId(outer?.parent) };
    const retained = append(record);
    observer(startMs, "Promise phase creation");
    return context.run({ parent, fiberId: null }, async () => {
      try { return await run(); }
      finally {
        const endMs = now();
        if (closed) { droppedEvents++; lostContextEvents++; }
        else if (retained) {
          const index = positions.get(record);
          const resources = resourceEnd(resourcesBefore);
          if (index !== undefined) events[index] = { ...record, endMs, ...(resources === undefined ? {} : { resources }) };
        }
        observer(endMs, "Promise phase completion");
      }
    });
  };
  const recordPublication = (event: PointCommitPublicationEvent) => {
    if (ownersOnly && (event.kind !== "phase" || !ownerBoundaries.has(`publication.${event.phase}`))) return;
    const startMs = now();
    if (closed) { droppedEvents++; lostContextEvents++; return; }
    const parent = context.getStore()?.parent;
    if (parent === undefined) lostContextEvents++;
    if (event.kind === "phase") {
      // Only genuine native Promise phases remain here. Effect phases are
      // decorated by the injected tracer rather than recorded twice.
      const stack = nativePhases.get(event.phase) ?? [];
      if (event.edge === "begin") {
        const resourcesBefore = resourceStart();
        const ordinal = sequence++;
        const record: PhaseRecord = { kind: "phase", id: `publication-phase:${ordinal}`, sequence: ordinal,
          name: `publication.${event.phase}`, role: "operation", startMs, endMs: null, owner: "pointCommitPublication",
          site: event.phase, parentId: parentId(parent) };
        if (append(record)) {
          stack.push(record);
          if (resourcesBefore !== undefined) nativePhaseResources.set(record, resourcesBefore);
        }
        nativePhases.set(event.phase, stack);
      } else {
        const record = stack.pop();
        if (record === undefined) lostContextEvents++;
        else {
          const index = positions.get(record);
          const resources = resourceEnd(nativePhaseResources.get(record));
          if (index !== undefined) events[index] = { ...record, endMs: startMs,
            ...(resources === undefined ? {} : { resources }) };
          nativePhaseResources.delete(record);
        }
      }
    } else {
      for (const [metric, value] of Object.entries(event.counts)) {
        if (value === undefined) continue;
        const ordinal = sequence++;
        append({ kind: "work", id: `publication-work:${ordinal}`, sequence: ordinal, atMs: startMs,
          owner: event.owner, site: `publication.${event.kind}`, parentId: parentId(parent), metric,
          unit: metric.endsWith("Bytes") ? "bytes" : "count", value });
      }
    }
    observer(startMs, "Publication scalar delivery");
  };
  const physicalSessionObservation = new PhysicalSessionObservation({ record: () => {},
    traceEffect: (phase, work, isFailure) => traceEffect(`PostgresPhysicalSession.${phase}`, work, "physicalSession", isFailure) });
  const binding: MixedMutationEffectDiagnostics = { provide, provideRequest, traceEffect, withPhase, physicalSessionObservation };
  return {
    layer, binding,
    /** Read at the actual driver boundary. Retained IDs belong only to this
     * request; a dropped, foreign or closed span cannot become a SQL parent. */
    currentOperationId: (): string | null => {
      const current = context.getStore()?.parent;
      const id = current === undefined ? undefined : identities.get(current);
      if (!closed && id !== undefined && retainedIds.has(id)) return id;
      // The driver collector counts each consumed missing correlation once.
      // Dropped spans and escaped completions retain their own collector losses.
      return null;
    },
    publicationObservation: () => new PointCommitPublicationObservation({ detail: !ownersOnly, record: recordPublication,
      traceEffect: (phase, work) => provide(traceEffect(`publication.${phase}`, work, "pointCommitPublication")) }),
    async runRequest<A>(name: string, run: () => Promise<A>): Promise<A> {
      if (started) throw new Error("Effect measurement collector is single-request");
      started = true;
      const work = Effect.useSpan(name, { root: true }, span => {
        requestParent = span;
        return Effect.provideService(Effect.tryPromise({
          try: ownersOnly ? () => context.run({ parent: span, fiberId: null }, run) : run,
          catch: cause => cause,
        }), Tracer.ParentSpan, span);
      });
      const exit = await Effect.runPromiseExit(Effect.provide(work, layer));
      closed = true;
      context.disable();
      return Exit.match(exit, {
        onSuccess: value => value,
        onFailure: cause => {
          const reason = cause.reasons[0];
          if (cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)) throw reason.error;
          throw cause;
        },
      });
    },
    records: () => events.map(event => (event.kind === "phase" || event.kind === "effectSpan") && event.resources !== undefined
      ? { ...event, resources: structuredClone(event.resources) } : { ...event }),
    observers: () => observerIntervals.map(event => ({ ...event })),
    fullExits: () => new Map(exits),
    status: () => ({ capacity, droppedEvents, lostContextEvents,
      failureCount: Math.min(Number.MAX_SAFE_INTEGER, failureCount + physicalSessionObservation.status().failureCount),
      failures: failureCount + physicalSessionObservation.status().failureCount === 0 ? [] : ["Effect diagnostic collector failed"],
      rootId, originMonotonicMs, closed }),
    assertHealthy: () => {
      if (failureCount !== 0) throw new Error("Effect diagnostic collector failed", { cause: firstFailure });
      physicalSessionObservation.assertHealthy();
    },
  };
}
