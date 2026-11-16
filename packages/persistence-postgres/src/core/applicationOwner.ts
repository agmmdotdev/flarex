/** App-scoped reconstruction above the source committer's terminal stop rule. */
import { Cause, Context, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import { CoreAdmissionChannelsSchema, makeCoreAdmissionLimiter, type CoreAdmissionChannels, type CoreApplicationAdmissionError, type CoreApplicationFunctionKind } from "./admission";
import { CoreTransactionError, type CoreDatabase, type CoreDatabaseOptions, type CoreError, type CoreRequestIdentity } from "./api";
import type { CorePersistence } from "./contracts";
import { openCoreDatabaseGeneration } from "./database";

export type CoreApplicationGenerationPhase = "initial" | "recovery";
/** Owners whose admitted root this fiber runs under; a nested root must not queue behind itself. */
const admittedOwners = Context.Reference<ReadonlySet<object>>("flarex/CoreApplicationAdmittedOwners", { defaultValue: () => new Set() });
export interface CoreApplicationMaintenance<Failure = never> {
  /** Trusted bounded metadata work; available after reconciliation, including during preparation. */
  readonly useDatabase: <A, E, R>(run: (database: CoreDatabase) => Effect.Effect<A, E, R | Scope.Scope>) =>
    Effect.Effect<A, E | CoreError | Failure, R>;
}
export interface CoreApplicationOwner<Value, Failure = never> extends CoreApplicationMaintenance<Failure> {
  /** With `admission` configured, an omitted kind takes the mutation channel. */
  readonly use: <A, E, R>(run: (prepared: Value) => Effect.Effect<A, E, R | Scope.Scope>, kind?: CoreApplicationFunctionKind) =>
    Effect.Effect<A, E | CoreError | Failure, R>;
  /** Outside an invocation: await reconstruction, without executing any caller callback. */
  readonly recover: Effect.Effect<void, CoreError | Failure>;
  readonly close: Effect.Effect<void>;
}

export function makeCoreApplicationOwner<Value, Failure, R>(input: Readonly<{
  persistence: CorePersistence;
  options: CoreDatabaseOptions;
  maximumRequests: number;
  /** Bounded FIFO wait for `use`; omitted, a full request census refuses at once.
   * Active permits across both channels must fit within `maximumRequests`. */
  admission?: CoreAdmissionChannels;
  prepare: (database: CoreDatabase, phase: CoreApplicationGenerationPhase) => Effect.Effect<Value, Failure, R | Scope.Scope>;
  onKernelReady?: (maintenance: CoreApplicationMaintenance<Failure>, phase: CoreApplicationGenerationPhase) => Effect.Effect<void, Failure, R | Scope.Scope>;
}>): Effect.Effect<CoreApplicationOwner<Value, Failure>, CoreError | Failure, R | Scope.Scope> {
  const persistence = input.persistence, maximumRequests = input.maximumRequests, prepare = input.prepare, onKernelReady = input.onKernelReady;
  const options: CoreDatabaseOptions = Object.freeze({ ...input.options, schemaWorker: Object.freeze({ ...input.options.schemaWorker }),
    ...(input.options.schemaBundles === undefined ? {} : { schemaBundles: Object.freeze([...input.options.schemaBundles]) }),
    ...(input.options.transactionLimits === undefined ? {} : { transactionLimits: Object.freeze({ ...input.options.transactionLimits }) }),
    ...(input.options.indexCache === undefined ? {} : { indexCache: Object.freeze({ ...input.options.indexCache }) }) });
  return Effect.fn("CoreApplicationOwner.make")(function* () {
    if (!Number.isSafeInteger(maximumRequests) || maximumRequests < 1) return yield* new CoreTransactionError({ reason: "invalidValue" });
    const admission = input.admission === undefined ? undefined : yield* Schema.decodeUnknownEffect(CoreAdmissionChannelsSchema)(input.admission)
      .pipe(Effect.mapError(cause => new CoreTransactionError({ reason: "invalidValue", cause })));
    if (admission !== undefined && admission.query.maxActive + admission.mutation.maxActive > maximumRequests)
      return yield* new CoreTransactionError({ reason: "invalidValue", cause: "Admission exceeds the request census" });
    const limiter = admission === undefined ? undefined : makeCoreAdmissionLimiter(admission);
    const self = {};
    const context = yield* Effect.context<R>();
    const supervision = yield* Scope.make();
    type Kernel = Effect.Success<ReturnType<typeof openCoreDatabaseGeneration>>;
    interface Invocation { interrupt: Effect.Effect<void> }
    interface Generation { readonly scope: Scope.Closeable; readonly kernel: Kernel; readonly invocations: Set<Invocation>;
      prepared?: Readonly<{ value: Value }>; retired: boolean }
    let state: "opening" | "reconciling" | "preparing" | "ready" | "recovering" | "failed" | "closed" = "opening";
    let generation: Generation | undefined;
    let unresolved: readonly CoreRequestIdentity[] = [];
    let failure: Cause.Cause<CoreError | Failure> | undefined;
    let rebuilding: Readonly<{ done: Deferred.Deferred<void, CoreError | Failure> }> | undefined;
    let closing: Deferred.Deferred<void> | undefined;
    const isClosed = () => state === "closed";

    const unavailable = () => new CoreTransactionError({ reason: state === "closed" ? "closed" : "unavailable", ...(failure === undefined ? {} : { cause: failure }) });
    const retire = Effect.fn("CoreApplicationOwner.retire")(function* (selected: Generation) {
      selected.retired = true;
      unresolved = Object.freeze([...new Map([...unresolved, ...selected.kernel.sealRequests()].map(identity => [identity.key, identity])).values()]);
      yield* Effect.forEach([...selected.invocations], invocation => invocation.interrupt, { concurrency: "unbounded", discard: true });
      yield* selected.kernel.database.close().pipe(Effect.ensuring(Scope.close(selected.scope, Exit.void)));
      if (generation === selected) generation = undefined;
    }, Effect.uninterruptible);

    const invoke = Effect.fnUntraced(function* <Selected, A, E, Requirements>(select: (current: Generation) => Selected,
      allowed: () => boolean, run: (selected: Selected) => Effect.Effect<A, E, Requirements | Scope.Scope>): Effect.fn.Return<A, E | CoreError | Failure, Requirements> {
      return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const current = generation;
        if (current === undefined || current.retired || !allowed()) return yield* unavailable();
        if (current.invocations.size >= maximumRequests) return yield* new CoreTransactionError({ reason: "capacity", cause: "App invocation retention limit" });
        // Reserved synchronously with the census check above; a later yield cannot overfill it.
        const invocation: Invocation = { interrupt: Effect.void };
        current.invocations.add(invocation);
        return yield* Effect.ensuring(Effect.gen(function* () {
          yield* current.kernel.database.assertOpen;
          const selected = select(current);
          const fiber = yield* Effect.forkIn(Effect.interruptible(Effect.scoped(Effect.suspend<A, E | CoreError, Requirements | Scope.Scope>(() =>
            generation !== current || current.retired || !allowed() ? Effect.fail(unavailable()) : run(selected)))), current.scope);
          invocation.interrupt = Fiber.interrupt(fiber).pipe(Effect.asVoid);
          const result = yield* Effect.exit(restore(Fiber.join(fiber)));
          const stopped = current.kernel.stoppedCause();
          if (Exit.isFailure(result)) return yield* Effect.failCause(current.retired && stopped !== undefined
            && result.cause.reasons.every(Cause.isInterruptReason) ? stopped : result.cause);
          if (stopped !== undefined) return yield* Effect.failCause(stopped);
          if (generation !== current || current.retired || !allowed()) return yield* unavailable();
          yield* current.kernel.database.assertOpen;
          return result.value;
        }), Effect.andThen(Effect.suspend(() => invocation.interrupt), Effect.sync(() => { current.invocations.delete(invocation); })));
      }));
    }, effect => Effect.withSpan(effect, "CoreApplicationOwner.invoke", { captureStackTrace: false }));

    const awaitReconstruction = Effect.suspend(() => rebuilding !== undefined || generation?.kernel.stoppedCause() !== undefined ? recover : Effect.void);
    const refuseAdmission = (error: CoreApplicationAdmissionError) => error.reason === "closed" ? unavailable() : new CoreTransactionError({ reason: "capacity", cause: error });
    const use: CoreApplicationOwner<Value, Failure>["use"] = (run, kind = "mutation") => Effect.gen(function* () {
      const owners = yield* admittedOwners;
      const invocation = (admitted: ReadonlySet<object>) => invoke(current => current.prepared, () => state === "ready", selected => Effect.gen(function* () {
        if (selected === undefined) return yield* unavailable();
        return yield* run(selected.value).pipe(Effect.provideService(admittedOwners, admitted));
      }));
      // A caller that queued before a stop must not see the reconstruction a later arrival would await.
      return yield* limiter === undefined || owners.has(self) ? invocation(owners)
        : limiter.withPermit(kind, Effect.andThen(awaitReconstruction, invocation(new Set([...owners, self]))), refuseAdmission);
    });
    const useDatabase: CoreApplicationMaintenance<Failure>["useDatabase"] = run => invoke(current => current.kernel.database,
      () => state === "preparing" || state === "ready", run);
    const maintenance: CoreApplicationMaintenance<Failure> = Object.freeze({ useDatabase });

    const build = Effect.fn("CoreApplicationOwner.build")(function* (phase: CoreApplicationGenerationPhase): Effect.fn.Return<void, CoreError | Failure, R> {
      const scope = yield* Scope.make();
      let selected: Generation | undefined;
      yield* Effect.gen(function* () {
        const kernel = yield* Scope.provide(scope)(openCoreDatabaseGeneration(persistence, options, maximumRequests));
        selected = { scope, kernel, invocations: new Set(), retired: false };
        generation = selected;
        state = "reconciling";
        for (const identity of unresolved) {
          const outcome = yield* kernel.database.recoverRequest(identity);
          if (outcome.kind === "busy") return yield* new CoreTransactionError({ reason: "unavailable", cause: "Request reconciliation remains busy" });
        }
        state = "preparing";
        if (onKernelReady !== undefined) yield* Scope.provide(scope)(onKernelReady(maintenance, phase));
        const value = yield* Scope.provide(scope)(Effect.raceFirst(prepare(kernel.database, phase),
          Effect.flatMap(kernel.whenStopped, cause => Effect.failCause(cause))));
        if (isClosed()) return yield* unavailable();
        selected.prepared = { value };
        unresolved = [];
        failure = undefined;
        state = "ready";
        yield* Effect.forkIn(Effect.flatMap(kernel.whenStopped, () => state === "closed" ? Effect.void
          : recover.pipe(Effect.catchCause(() => Effect.void))), supervision);
      }).pipe(Effect.onExit(exit => Exit.isFailure(exit)
        ? (selected === undefined ? Scope.close(scope, Exit.void) : retire(selected)) : Effect.void));
    });

    const recover: CoreApplicationOwner<Value, Failure>["recover"] = Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      if (state === "closed") return yield* unavailable();
      if (state === "ready" && generation !== undefined) {
        const ready = yield* Effect.exit(generation.kernel.database.assertOpen);
        if (Exit.isSuccess(ready)) return;
        failure = ready.cause;
      }
      let task = rebuilding;
      if (task === undefined) {
        task = { done: Deferred.makeUnsafe<void, CoreError | Failure>() };
        rebuilding = task;
        const currentTask = task;
        state = "recovering";
        yield* Effect.forkIn(Effect.uninterruptibleMask(resume => Effect.gen(function* () {
          const result = yield* Effect.exit(resume(Effect.gen(function* () {
            if (generation !== undefined) yield* retire(generation);
            if (state === "closed") return yield* unavailable();
            yield* build("recovery");
          }).pipe(Effect.provideContext(context))));
          if (Exit.isFailure(result) && state !== "closed") { failure = result.cause; state = "failed"; }
          yield* Deferred.done(currentTask.done, result);
          if (rebuilding === currentTask) rebuilding = undefined;
        })), supervision);
      }
      return yield* restore(Deferred.await(task.done));
    }));

    const close: CoreApplicationOwner<Value, Failure>["close"] = Effect.uninterruptible(Effect.gen(function* () {
      if (closing !== undefined) return yield* Deferred.await(closing);
      const done = Deferred.makeUnsafe<void>(); closing = done;
      state = "closed";
      if (limiter !== undefined) yield* limiter.stop;
      const result = yield* Effect.exit(Effect.gen(function* () {
        yield* Scope.close(supervision, Exit.void);
        if (generation !== undefined) yield* retire(generation);
      }));
      yield* Deferred.done(done, result);
      if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
    }));
    // Registered before opening/preparing: disposal can cancel an unfinished boot.
    yield* Effect.addFinalizer(() => close);
    yield* build("initial").pipe(Effect.onExit(exit => {
      if (Exit.isFailure(exit) && state !== "closed") { failure = exit.cause; state = "failed"; }
      return Effect.void;
    }));
    return Object.freeze({ use, useDatabase, recover, close });
  })();
}
