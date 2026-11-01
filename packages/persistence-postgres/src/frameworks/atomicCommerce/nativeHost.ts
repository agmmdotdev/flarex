import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { CoreNativeBudgetError, isCoreDefinitiveCommitRefusal, type CoreRequestClaim } from "../../core/api";
import { makeBoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { retainPreparedHost, PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { commerceNativeInitializationCommand, makeNativeCommerceInitialization } from "../commerceTransaction/nativeInitialization";
import { captureCommerceJsonData } from "../commerceTransaction/json";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { projectCoreCommerceFailure } from "../commerceTransaction/nativeFailure";
import { CORE_NATIVE_EVENT_WRITE } from "../../commit/events/coreDefinition";
import { getAtomicCommerceCommand, type AtomicCommerceHost, type AtomicCommerceCommand } from "./commands";
import { captureAtomicCommerceNativeConfiguration, prepareAtomicCommerceNativeConfiguration, type AtomicCommerceNativeHostInput,
  type AtomicCommerceNativeProfileInput, type AtomicCommerceNativeGenerationInput } from "./nativeConfiguration";
import { executeAtomicCommerceNative } from "./nativeExecution";
import { captureAtomicCommerceNativeRequest, readAtomicCommerceNativeRequest, bindAtomicCommerceNativeRequest,
  type AtomicCommerceNativeRequest, type AtomicCommerceNativeCorrelation } from "./nativeRequest";

export type { AtomicCommerceNativeHostInput } from "./nativeConfiguration";
export interface AtomicCommerceNativeHostProfile {
  readonly make: (generation: AtomicCommerceNativeGenerationInput) => Effect.Effect<AtomicCommerceNativeHost, CommerceTransactionError>;
}
export interface AtomicCommerceNativeHost extends AtomicCommerceHost {
  /** Trusted owner recovery only. It never claims, binds or executes a body. */
  readonly recoverOnly: (key: string, command: AtomicCommerceCommand, args: Json) => Effect.Effect<Option.Option<Json>, CommerceTransactionError>;
  readonly captureRequest: (key: string, command: AtomicCommerceCommand, args: Json) => Effect.Effect<AtomicCommerceNativeRequest, CommerceTransactionError>;
  readonly prepareRequest: (request: AtomicCommerceNativeRequest) => Effect.Effect<AtomicCommerceNativeCorrelation, CommerceTransactionError>;
  readonly runCaptured: (request: AtomicCommerceNativeRequest) => Effect.Effect<Json, CommerceTransactionError>;
  readonly recoverCaptured: (request: AtomicCommerceNativeRequest) => Effect.Effect<Option.Option<Json>, CommerceTransactionError>;
}
const keyDecoder = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);
const core = <A>(work: Effect.Effect<A, Parameters<typeof projectCoreCommerceFailure>[0]>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
const retentionFailure = (failure: CommerceTransactionError | PreparedHostRuntimeError) => failure instanceof PreparedHostRuntimeError
  ? commerceError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** Ordinary native workflow execution. Resource callbacks hold no SQL session;
 * all selected sources share one Core operation and one durable outcome. */
export const makeAtomicCommerceNativeHost = Effect.fn("AtomicCommerceNative.makeHost")(function* (
  input: AtomicCommerceNativeHostInput,
): Effect.fn.Return<AtomicCommerceNativeHost, CommerceTransactionError> {
  return yield* captureAtomicCommerceNativeHostProfile(input).make({ database: input.database, hostRuntime: input.hostRuntime });
});

/** A prepared profile owns its static selection once. Generation replacement
 * supplies fresh live owners without reading the caller's mutable input again. */
export function captureAtomicCommerceNativeHostProfile(input: AtomicCommerceNativeProfileInput): AtomicCommerceNativeHostProfile {
  const captured = captureAtomicCommerceNativeConfiguration(input);
  return Object.freeze({ make: (generation: AtomicCommerceNativeGenerationInput) => makeCapturedHost({ ...captured,
    database: generation.database, hostRuntime: generation.hostRuntime }) });
}

const makeCapturedHost = Effect.fn("AtomicCommerceNative.makeCapturedHost")(function* (
  captured: ReturnType<typeof captureAtomicCommerceNativeConfiguration> & AtomicCommerceNativeGenerationInput,
): Effect.fn.Return<AtomicCommerceNativeHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(captured.hostRuntime, compose(captured)).pipe(Effect.catchCause(cause =>
    Effect.failCause(Cause.map(cause, retentionFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`,
    run: (key, command, args) => retained.use(host => host.run(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, retentionFailure)))),
    recoverOnly: (key, command, args) => retained.use(host => host.recoverOnly(key, command, args)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, retentionFailure)))),
    captureRequest: (key, command, args) => retained.use(host => Effect.sync(() => host.captureRequest(key, command, args))).pipe(Effect.catchCause(cause =>
      Effect.failCause(Cause.map(cause, retentionFailure)))),
    prepareRequest: request => retained.use(host => host.prepareRequest(request)).pipe(Effect.catchCause(cause =>
      Effect.failCause(Cause.map(cause, retentionFailure)))),
    runCaptured: request => retained.use(host => host.runCaptured(request)).pipe(Effect.catchCause(cause =>
      Effect.failCause(Cause.map(cause, retentionFailure)))),
    recoverCaptured: request => retained.use(host => host.recoverCaptured(request)).pipe(Effect.catchCause(cause =>
      Effect.failCause(Cause.map(cause, retentionFailure)))),
  } satisfies AtomicCommerceNativeHost);
});

const compose = Effect.fn("AtomicCommerceNative.composeHost")(function* (
  captured: ReturnType<typeof captureAtomicCommerceNativeConfiguration> & AtomicCommerceNativeGenerationInput,
) {
  const configuration = yield* prepareAtomicCommerceNativeConfiguration(captured);
  const { database } = configuration;
  const owner = Object.freeze({ hostId: Symbol("atomic.commerce.native") });
  // Historical authority is prepared first. Live bindings are lazy so replay
  // never depends on restoring a withdrawn producer or rerunning native code.
  const live = yield* Effect.cached(Effect.gen(function* () {
    const selected = yield* Effect.forEach(configuration.members, member => Effect.gen(function* () {
      const binding = yield* core(database.bindNative({ definition: member.source.definition,
        commands: [commerceNativeInitializationCommand, ...member.registrations] }));
      const metadata = yield* core(database.readNativeBinding(binding));
      const initialization = yield* makeNativeCommerceInitialization(database, binding, member.source.initialization);
      return Object.freeze({ member, binding, metadata, initialization });
    }));
    const eventBinding = configuration.eventPolicy === undefined || configuration.eventStorage === undefined ? undefined
      : yield* core(database.bindNative({ definition: configuration.eventStorage.definition,
        commands: [{ name: CORE_NATIVE_EVENT_WRITE, mode: "write" }] }));
    const participants = selected.map(participant => ({ binding: participant.binding,
      commands: participant.member.registrations.map(command => command.name),
      limits: { maxIdentities: participant.member.resources.catalogRows, maxDocumentBytes: 65_536 } }));
    const expectedEvent = configuration.rootInput.participants.find(participant => participant.definition === configuration.eventStorage?.definition);
    if (eventBinding !== undefined && expectedEvent !== undefined) participants.push({ binding: eventBinding,
      commands: [CORE_NATIVE_EVENT_WRITE], limits: { ...expectedEvent.limits } });
    const root = yield* core(database.bindNativeRoot({ ...configuration.rootInput, participants }));
    const metadata = yield* core(database.readNativeRootBinding(root));
    if (metadata.identity.definitionHash !== configuration.recovery.identity.definitionHash)
      return yield* commerceError("storedCorruption");
    return Object.freeze({ selected: Object.freeze(selected), root, eventBinding });
  }));
  const request = Effect.fn("AtomicCommerceNative.prepareRequest")(function* (token: AtomicCommerceNativeRequest) {
    const data = readAtomicCommerceNativeRequest(token);
    if (data === undefined) return yield* commerceError("invalidAuthority");
    const definition = getAtomicCommerceCommand(data.command);
    if (definition === undefined || !configuration.allowed.has(data.command)) return yield* commerceError("invalidAuthority");
    if (data.prepared !== undefined) {
      if (data.prepared.identity.root.definitionHash !== configuration.recovery.identity.definitionHash)
        return yield* commerceError("requestConflict");
      return { ...data.prepared, args: (yield* Effect.fromResult(data.arguments)).value, command: data.command };
    }
    const nativeKey = yield* keyDecoder(data.key).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (!/^commerce\/atomic\/[a-zA-Z0-9/-]{1,100}$/.test(nativeKey) || nativeKey.startsWith("commerce/atomic/task/"))
      return yield* commerceError("invalidInput");
    const capturedArguments = yield* Effect.fromResult(data.arguments);
    if (capturedArguments.bytes > configuration.limits.commandBytes) return yield* commerceError("limitExceeded");
    const evidence = yield* capturePrivateCanonicalValue({ root: { ...configuration.recovery.identity },
      command: definition.name, arguments: capturedArguments.value }, configuration.limits.commandBytes,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    const identity: AtomicCommerceNativeCorrelation = { kind: "nativeRoot", root: configuration.recovery.identity,
      key: nativeKey, requestHash: evidence.sha256Hex };
    const prepared = yield* Effect.fromResult(bindAtomicCommerceNativeRequest(token, identity,
      capturedArguments.bytes + evidence.canonicalByteLength));
    return { ...prepared, args: capturedArguments.value, command: data.command };
  });
  const stored = Effect.fn("AtomicCommerceNative.storedResult")(function* (value: unknown) {
    return (yield* Effect.fromResult(captureCommerceJsonData(value, configuration.limits.commandBytes)
      .pipe(Result.mapError(cause => commerceError("storedCorruption", cause))))).value;
  });
  const recoverCaptured = Effect.fn("AtomicCommerceNative.recoverCaptured")(function* (token: AtomicCommerceNativeRequest) {
    const capturedRequest = yield* request(token);
    const observed = yield* core(configuration.recovery.resolve(capturedRequest.identity));
    const recovered = observed.kind === "busy" ? yield* core(configuration.recovery.recover(capturedRequest.identity)) : observed;
    if (recovered.kind === "committed") return Option.some(yield* stored(recovered.result));
    if (recovered.kind === "busy") return yield* commerceError("decisionUncertain");
    return Option.none();
  });
  const abortWithCause = <E>(claim: CoreRequestClaim, cause: Cause.Cause<E>) => core(database.abortRequest(claim)).pipe(Effect.exit,
    Effect.flatMap(aborted => Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));
  const runCaptured = Effect.fn("AtomicCommerceNative.runCaptured")(function* (token: AtomicCommerceNativeRequest) {
    const capturedRequest = yield* request(token);
    const observed = yield* core(configuration.recovery.resolve(capturedRequest.identity));
    const recovered = observed.kind === "busy" ? yield* core(configuration.recovery.recover(capturedRequest.identity)) : observed;
    if (recovered.kind === "committed") return yield* stored(recovered.result);
    if (recovered.kind === "busy") return yield* commerceError("overlappingOperation");
    const prepared = yield* live;
    for (const participant of prepared.selected) yield* participant.initialization.requireReady;
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const acquired = yield* core(database.claimRequest(capturedRequest.identity, prepared.root));
      if (acquired.kind === "committed") return yield* stored(acquired.result);
      if (acquired.kind !== "claimed") return yield* commerceError(acquired.kind === "busy" ? "overlappingOperation" : "requestConflict");
      const id = crypto.randomUUID();
      const lifetime = yield* makeBoundedRequestLifetime(commerceError, configuration.limits, owner,
        Object.freeze({ requestId: Symbol("atomic.commerce.native.request") }), id, "write");
      const chargeRetained = (bytes: number) => lifetime.fromResult(lifetime.charge(bytes)).pipe(Effect.catchCause(cause =>
        Effect.failCause(Cause.map(cause, failure => new CoreNativeBudgetError({
          reason: failure.reason === "limitExceeded" || failure.reason === "closed" || failure.reason === "rollbackOnly"
            ? failure.reason : "unexpectedFailure", cause: failure,
        })))));
      const executed = yield* Effect.exit(restore(Effect.acquireUseRelease(core(database.beginNativeRoot(prepared.root,
        { claim: acquired.claim, chargeRetained })), operation => executeAtomicCommerceNative(configuration, prepared.selected,
        operation, prepared.eventBinding, lifetime, id, capturedRequest.identity.key, capturedRequest.command,
        capturedRequest.args, capturedRequest.bytes), operation => operation.abort())
        .pipe(Effect.ensuring(lifetime.close))));
      if (Exit.isFailure(executed)) return yield* abortWithCause(acquired.claim, executed.cause);
      const committed = yield* Effect.exit(database.commit(executed.value.finalized, { claim: acquired.claim,
        result: executed.value.value, admissionDeadlineUnixMilliseconds: executed.value.deadline }));
      if (Exit.isFailure(committed)) {
        const [reason] = committed.cause.reasons;
        const projected = Cause.map(committed.cause, projectCoreCommerceFailure);
        return committed.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason) && isCoreDefinitiveCommitRefusal(reason.error)
          ? yield* abortWithCause(acquired.claim, projected) : yield* Effect.failCause(projected);
      }
      return executed.value.value;
    }));
  });
  const captureRequest = (key: string, command: AtomicCommerceCommand, args: Json) =>
    captureAtomicCommerceNativeRequest(key, command, args, configuration.limits.commandBytes);
  return Object.freeze({ run: (key: string, command: AtomicCommerceCommand, args: Json) => Effect.suspend(() =>
    runCaptured(captureRequest(key, command, args))),
  recoverOnly: (key: string, command: AtomicCommerceCommand, args: Json) =>
    Effect.suspend(() => recoverCaptured(captureRequest(key, command, args))), captureRequest,
  prepareRequest: (token: AtomicCommerceNativeRequest) => request(token).pipe(Effect.map(preparedRequest => preparedRequest.identity)), runCaptured, recoverCaptured });
});
