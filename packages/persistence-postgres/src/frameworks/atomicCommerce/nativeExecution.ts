import { Cause, Effect, Exit, Result } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreNativeBinding, CoreNativeBindingMetadata, CoreNativeOperations, CoreNativeRootOperation } from "../../core/api";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { canonicalizeJsonOutcome } from "../../values/jsonOutcome";
import { makeNativeCommerceParticipant } from "../commerceTransaction/nativeStore";
import { makeNativeCommerceActivity } from "../commerceTransaction/nativeActivity";
import { getCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "../commerceTransaction/commands";
import { withCommerceCommandContext } from "../commerceTransaction/context";
import { makeCommerceOperations } from "../commerceTransaction/operations";
import { captureCommerceJsonData, projectCommerceJsonFailure } from "../commerceTransaction/json";
import { projectCoreCommerceFailure } from "../commerceTransaction/nativeFailure";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { getAtomicCommerceCommand, type AtomicCommerceCommand, type AtomicCommerceContext } from "./commands";
import { makeAtomicEventCapture, admitCommercePendingEventCancellation, consumeCommerceEvents, appendDerivedCommerceIdEvents,
  type AtomicCommerceCallObservation } from "./events";
import type { LogicalCommerceCallObservation } from "./participants";
import type { PreparedAtomicCommerceNativeConfiguration } from "./nativeConfiguration";
import { prepareCoreRootCommitEventFamily, stageCoreCommitEventFamily } from "../../commit/events/coreStore";
import { commitEventLimits, type CommitEventError } from "../../commit/events/model";
import { observeExecution } from "../../execution/diagnostics/operation";
import { registerAtomicCommerceScopeExclusion } from "./scopeExclusion";

export interface AtomicCommerceNativeParticipant {
  readonly member: PreparedAtomicCommerceNativeConfiguration["members"][number];
  readonly binding: CoreNativeBinding;
  readonly metadata: CoreNativeBindingMetadata;
}
interface ParticipantExecution extends AtomicCommerceNativeParticipant {
  readonly operations: CoreNativeOperations;
  readonly activity: ReturnType<typeof makeNativeCommerceActivity>;
  readonly original: ReturnType<ReturnType<typeof makeNativeCommerceActivity>["cursor"]>;
  working: Effect.Success<ReturnType<typeof makeNativeCommerceParticipant>> | undefined;
  mutations: number;
  lifecycle: number;
  readonly calls: LogicalCommerceCallObservation[];
}
const core = <A>(work: Effect.Effect<A, Parameters<typeof projectCoreCommerceFailure>[0]>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
const events = <A>(work: Effect.Effect<A, CommitEventError>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, failure => commerceError(failure.reason === "limitExceeded" ? "limitExceeded"
    : failure.reason === "storedCorruption" ? "storedCorruption" : failure.reason === "resourceFailure" ? "resourceFailure"
      : failure.reason === "statementFailure" ? "statementFailure" : "unadmittedEvent", failure)))));

/** One ordinary native workflow borrows one Core root. Native methods receive
 * only their selected source store/context; settlement never enters a resource. */
export const executeAtomicCommerceNative = Effect.fn("AtomicCommerceNative.execute")(function* (
  configuration: PreparedAtomicCommerceNativeConfiguration,
  selected: readonly AtomicCommerceNativeParticipant[], operation: CoreNativeRootOperation,
  eventBinding: CoreNativeBinding | undefined, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  transactionId: string, requestKey: string, token: AtomicCommerceCommand, args: Json, evidenceBytes: number,
) {
  const rootCommand = getAtomicCommerceCommand(token);
  if (rootCommand === undefined || !configuration.allowed.has(token)) return yield* commerceError("invalidAuthority");
  const assertSelection = Effect.fn("AtomicCommerceNative.assertSelection")(function* () {
    yield* configuration.database.assertOpen.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
    for (const participant of selected) yield* core(configuration.database.readNativeBinding(participant.binding));
  });
  const eventOperations = eventBinding === undefined ? undefined : yield* core(operation.native(eventBinding));
  const family = eventOperations === undefined || configuration.eventStorage === undefined ? undefined
    : yield* events(prepareCoreRootCommitEventFamily(configuration.database, eventOperations, configuration.eventStorage.definition));
  if (family !== undefined) yield* lifetime.fromResult(lifetime.charge(family.retainedBytes));
  const eventCapture = configuration.eventPolicy === undefined ? undefined
    : makeAtomicEventCapture(assertSelection(), lifetime, requestKey, configuration.eventPolicy, configuration.limits.eventLimit);
  const participants = yield* Effect.forEach(selected, participant => core(operation.native(participant.binding)).pipe(Effect.map((operations): ParticipantExecution => {
    const activity = makeNativeCommerceActivity(operations, participant.metadata, lifetime);
    return { ...participant, operations, activity, original: activity.cursor(),
      working: undefined, mutations: 0, lifecycle: 0, calls: [] };
  })));
  const observations: AtomicCommerceCallObservation[] = [];
  const scopeExclusion = configuration.executionIsolation === undefined ? Effect.fail(commerceError("unsupportedProfile"))
    : core(operation.requireScopeExclusion);
  const registerScopeExclusion = (context: CommerceCommandContext): void => {
    registerAtomicCommerceScopeExclusion(context, lifetime, context.manager, scopeExclusion);
  };
  let replacementPlanned = false;
  const prepareCapture = (value: unknown) => Result.gen(function* () {
    const captured = yield* captureCommerceJsonData(value, lifetime.remainingBytes());
    yield* lifetime.charge(captured.bytes);
    return captured;
  });
  return yield* Effect.acquireUseRelease(configuration.limits.operationScheduling === "queued"
    ? makeCommerceOperations(lifetime, configuration.limits.calls, lifetime.context) : Effect.succeed(undefined),
  queue => Effect.gen(function* () {
    const invoke = Effect.fn("AtomicCommerceNative.invoke")(function* (
      participant: typeof participants[number], manager: BoundedRequestContext, nested: CommerceCommand, input: Json,
      emitted: Json[], capturedInput?: Readonly<{ value: Json }>,
    ): Effect.fn.Return<Pick<AtomicCommerceCallObservation, "input" | "result">, CommerceTransactionError> {
      const definition = getCommerceCommand(nested);
      if (definition === undefined || !participant.member.commands.has(nested)) return yield* commerceError("invalidAuthority");
      yield* core(configuration.database.readNativeBinding(participant.binding));
      const captured = capturedInput ?? (yield* lifetime.fromResult(prepareCapture(input)));
      if (participant.working === undefined) participant.working = yield* makeNativeCommerceParticipant(participant.operations,
        participant.metadata, lifetime, manager, transactionId, operation.unixTime, participant.member.resources,
        { ...participant.member.invocation, onRead: participant.activity.onRead });
      const working = { ...participant.working, registerScopeExclusion };
      const result = yield* withCommerceCommandContext(lifetime, working, transactionId, manager,
        (child, command, value) => invoke(participant, child, command, value, emitted).pipe(Effect.map(call => call.result)),
        (child, message) => lifetime.operation(child, transactionId, "write", Effect.gen(function* () {
          if (eventCapture === undefined || participant.member.events === undefined) return yield* commerceError("unadmittedEvent");
          emitted.push(yield* eventCapture.captureSelected(participant.member.events, message));
        })), configuration.limits.borrowedOperationScheduling === "queued" ? configuration.limits.calls : undefined,
        context => observeExecution(`AtomicCommerceNative.invoke/${definition.name}`, definition.run(context, captured.value)));
      yield* core(configuration.database.readNativeBinding(participant.binding));
      const output = yield* lifetime.fromResult(prepareCapture(result));
      return Object.freeze({ input: captured.value, result: output.value });
    });
    const callNow = (participantToken: Parameters<AtomicCommerceContext["call"]>[0], commandToken: CommerceCommand,
      value: Json, capturedInput?: Readonly<{ value: Json }>) => lifetime.nested(lifetime.context, transactionId,
      child => Effect.gen(function* () {
        const participant = participants.find(candidate => candidate.member.participant === participantToken);
        const definition = getCommerceCommand(commandToken);
        if (replacementPlanned || participant === undefined || definition === undefined || !participant.member.commands.has(commandToken))
          return yield* commerceError("invalidAuthority");
        const cursor = participant.activity.cursor();
        // One outer call owns this native event sequence. Recursive borrowed
        // commands append to the same buffer; only its completed receipt is
        // copied/frozen, preserving before/child/after order without child
        // observations or a second capture/publication.
        const emitted: Json[] = [];
        const call = yield* invoke(participant, child, commandToken, value, emitted, capturedInput);
        const callEvents = Object.freeze([...emitted]);
        const activity = yield* participant.activity.since(cursor);
        if (definition.mode === "read" && (activity.mutations.length !== 0 || activity.lifecycle.length !== 0
          || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 || callEvents.length !== 0))
          return yield* commerceError("receiptMismatch");
        if (participant.member.validateLogicalCall !== undefined) yield* participant.member.validateLogicalCall({
          commandName: definition.name, mode: definition.mode, input: call.input, result: call.result, events: callEvents,
          fromAttempt: 0, toAttempt: activity.mutations.length, fromLifecycle: 0, toLifecycle: activity.lifecycle.length,
        }, activity, commandToken);
        if (activity.referenceReplacements.length !== 0) replacementPlanned = true;
        participant.calls.push(Object.freeze({ commandName: definition.name, mode: definition.mode, input: call.input,
          result: call.result, events: callEvents, fromAttempt: participant.mutations,
          toAttempt: participant.mutations + activity.mutations.length, fromLifecycle: participant.lifecycle,
          toLifecycle: participant.lifecycle + activity.lifecycle.length }));
        participant.mutations += activity.mutations.length; participant.lifecycle += activity.lifecycle.length;
        observations.push(Object.freeze({ participant: participantToken, command: commandToken, input: call.input, result: call.result }));
        return call.result;
      }), getCommerceCommand(commandToken)?.mode);
    const rootOperation = <A>(work: Effect.Effect<A, CommerceTransactionError>) => queue === undefined ? work
      : queue.submit(() => Result.succeed(undefined), () => work);
    const context = Object.freeze<AtomicCommerceContext>({ eventGroupId: requestKey,
      checkpoint: rootOperation(lifetime.operation(lifetime.context, transactionId, "read", Effect.void)),
      capture: (value, normalize) => queue === undefined ? lifetime.operation(lifetime.context, transactionId, "read", Effect.gen(function* () {
        const normalized = normalize === undefined ? value : yield* Effect.fromResult(normalize(value));
        const captured = yield* Effect.fromResult(captureCommerceJsonData(normalized, lifetime.remainingBytes()));
        yield* lifetime.fromResult(lifetime.charge(captured.bytes));
        return captured.value;
      })) : queue.submit(() => Result.gen(function* () {
        return yield* prepareCapture(normalize === undefined ? value : yield* normalize(value));
      }), captured => lifetime.operation(lifetime.context, transactionId, "read", Effect.succeed(captured.value))),
      call: (participant, command, value) => queue === undefined ? callNow(participant, command, value) : queue.submit(() => Result.gen(function* () {
        if (replacementPlanned || !participants.some(candidate => candidate.member.participant === participant && candidate.member.commands.has(command)))
          return yield* Result.fail(commerceError("invalidAuthority"));
        return yield* prepareCapture(value);
      }), captured => callNow(participant, command, captured.value, captured)),
      emit: (contract, message) => queue === undefined ? lifetime.operation(lifetime.context, transactionId, "write", Effect.suspend(() =>
        replacementPlanned || eventCapture === undefined ? commerceError("unadmittedEvent") : eventCapture.capture(contract, message).pipe(Effect.asVoid)))
        : queue.submit(() => Result.gen(function* () {
          if (replacementPlanned || configuration.eventPolicy?.allowed.has(contract) !== true)
            return yield* Result.fail(commerceError("unadmittedEvent"));
          const captured = yield* capturePrivateJsonData(message, Math.min(commitEventLimits.bytes, lifetime.remainingBytes()), commerceError);
          yield* lifetime.charge(captured.bytes);
          return captured;
        }), captured => lifetime.operation(lifetime.context, transactionId, "write", Effect.suspend(() =>
          replacementPlanned || eventCapture === undefined ? commerceError("unadmittedEvent")
            : eventCapture.capturePrecharged(contract, captured.value, captured.bytes).pipe(Effect.asVoid)))),
      clearPendingEvents: contract => queue === undefined ? lifetime.operation(lifetime.context, transactionId, "write", Effect.gen(function* () {
        yield* lifetime.fromResult(admitCommercePendingEventCancellation(configuration.eventPolicy, contract));
        if (replacementPlanned || eventCapture === undefined) return yield* commerceError("unadmittedEvent");
        yield* eventCapture.clearPending(contract);
      })) : queue.submit(() => replacementPlanned ? Result.fail(commerceError("invalidAuthority"))
        : admitCommercePendingEventCancellation(configuration.eventPolicy, contract),
      () => lifetime.operation(lifetime.context, transactionId, "write", Effect.suspend(() =>
        replacementPlanned || eventCapture === undefined ? commerceError("unadmittedEvent") : eventCapture.clearPending(contract)))),
      recordFailure: cause => lifetime.recordFailure(lifetime.context, cause),
      refuse: error => queue === undefined ? lifetime.operation(lifetime.context, transactionId, "write", Effect.fail(error))
        : queue.submit(() => Result.fail(error), () => Effect.fail(error)),
    });
    registerAtomicCommerceScopeExclusion(context, lifetime, lifetime.context, scopeExclusion);
    yield* lifetime.fromResult(lifetime.charge(evidenceBytes));
    const value = yield* Effect.gen(function* () {
      const output = yield* Effect.uninterruptibleMask(restore => Effect.exit(restore(Effect.suspend(() => rootCommand.run(context, args)))).pipe(
        Effect.flatMap(body => queue === undefined ? body : queue.finalize(body))));
      // Freeze the complete native graph while callback admission is open.
      // The deadline's observed invocation must drain before seal checks that
      // no native call remains active, as in the existing native service owner.
      for (const participant of participants) yield* core(participant.operations.prepareDeleteClosure());
      return output;
    }).pipe(lifetime.withinDeadline, Effect.catchCause(cause => Effect.gen(function* () {
      const sealed = yield* Effect.exit(lifetime.seal);
      const complete = Exit.isFailure(sealed) ? Cause.combine(cause, sealed.cause) : cause;
      return yield* Result.match(lifetime.recordFailure(lifetime.context, complete), {
        onSuccess: owned => Effect.failCause(owned), onFailure: error => Effect.failCause(Cause.combine(complete, Cause.fail(error))),
      });
    })));
    yield* lifetime.seal;
    const captured = yield* lifetime.fromResult(prepareCapture(value));
    const canonical = yield* Effect.fromResult(canonicalizeJsonOutcome(captured.value, configuration.limits.commandBytes))
      .pipe(Effect.mapError(projectCommerceJsonFailure));
    let derived: typeof participants[number]["member"]["derivedIdEvent"];
    const derivedIds: string[] = [];
    for (const participant of participants) {
      const activity = yield* participant.activity.since(participant.original);
      if (participant.member.validateLogical !== undefined) yield* participant.member.validateLogical(participant.calls,
        activity.mutations, activity.lifecycle, activity.observedRows, activity.setNull, activity.referenceReplacements);
      if (activity.referenceReplacements.length !== 0) {
        if (activity.referenceReplacements.length !== 1 || participant.member.invocation.allowReferenceReplacement !== true
          || participant.member.derivedIdEvent === undefined || derived !== undefined) return yield* commerceError("invalidAuthority");
        derived = participant.member.derivedIdEvent;
        if (participant.working === undefined) return yield* commerceError("invalidAuthority");
        const changes = yield* participant.working.referenceReplacementChanges();
        derivedIds.push(...changes.flatMap(change => change.ids));
      }
    }
    if (eventCapture !== undefined) {
      if (eventOperations === undefined || family === undefined || configuration.eventStorage === undefined)
        return yield* commerceError("invalidAuthority");
      const closure = yield* eventCapture.close(observations, derived);
      if (derived !== undefined) yield* appendDerivedCommerceIdEvents(closure, lifetime, derivedIds);
      const consumed = yield* consumeCommerceEvents(closure, lifetime);
      yield* events(stageCoreCommitEventFamily(eventOperations, configuration.eventStorage.definition, family.id,
        consumed, operation.unixTime, configuration.database));
    }
    yield* lifetime.close;
    yield* assertSelection();
    return { value: canonical.valueJson, finalized: yield* core(operation.finalize()), deadline: lifetime.deadlineUnixMilliseconds };
  }), queue => (queue === undefined ? Effect.void : queue.close).pipe(Effect.andThen(lifetime.close)));
});
