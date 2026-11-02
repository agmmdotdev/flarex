import { Cause, Effect, Exit, Result, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import type { CoreDatabase, CoreNativeBinding, CoreNativeInitializationBinding, CoreNativeOperation, CoreNativeOperations, CoreNativeLimits, CoreNativeRootBinding, CoreRequestClaim, CoreRequestIdentity } from "../../core/api";
import type { CoreSchemaBundle } from "../../core/schemaBundle";
import { CoreNativeBudgetError, isCoreDefinitiveCommitRefusal } from "../../core/api";
import { makeBoundedRequestLifetime, type BoundedRequestContext } from "../../execution/preparation/boundedRequestLifetime";
import { chargeHostPreparation, retainPreparedHost, PreparedHostRuntimeError, type PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { canonicalizeJsonOutcome } from "../../values/jsonOutcome";
import { getCommerceCommand, type CommerceCommand, type CommerceHost } from "./commands";
import { makeCommerceCommandContext } from "./context";
import { captureCommerceJsonData, projectCommerceJsonFailure } from "./json";
import type { CommerceInitialization } from "./initializationContract";
import { planLogicalInitializationBatches } from "./initializationRows";
import { commerceError, commerceLimits, type CommerceTransactionError } from "./model";
import { makeNativeCommerceParticipant } from "./nativeStore";
import { projectCoreCommerceFailure } from "./nativeFailure";
import { commerceNativeInitializationCommand, makeNativeCommerceInitialization } from "./nativeInitialization";
import { captureCommerceResources, defaultCommerceResources, logicalCommerceWorkingSetLimits, type CommerceResources } from "./resources";
import { CommerceCallLimit, FrameworkCommandMilliseconds } from "../../execution/preparation/frameworkExecutionPolicy";
import { admitParticipantEvents, captureAtomicCommerceEvents, captureParticipantEvents, consumeCommerceEvents,
  appendDerivedCommerceIdEvents, makeAtomicEventCapture, prepareAtomicCommerceEvents, type AtomicCommerceEvents,
  type CommerceDerivedIdEvent, type ParticipantEventSelection } from "../atomicCommerce/events";
import type { AtomicCommerceParticipant } from "../atomicCommerce/commands";
import { CORE_NATIVE_EVENT_WRITE } from "../../commit/events/coreDefinition";
import { stageCoreCommitEventFamily } from "../../commit/events/coreStore";
import type { CommitEventError } from "../../commit/events/model";
import { observeExecution } from "../../execution/diagnostics/operation";

export interface CommerceNativeEvents {
  readonly bundle: CoreSchemaBundle;
  readonly binding: CoreNativeBinding;
  readonly policy: AtomicCommerceEvents;
  readonly selection: ParticipantEventSelection;
  readonly participant: AtomicCommerceParticipant;
  /** The trusted producer selects the exact business source for derived intents. */
  readonly derivedIdEvent?: CommerceDerivedIdEvent & Readonly<{ sourceTable: string }>;
}

export interface CommerceNativeHostInput {
  readonly database: CoreDatabase;
  readonly binding: CoreNativeBinding;
  readonly hostRuntime: PreparedHostRuntime;
  readonly commands: readonly CommerceCommand[];
  readonly initialization: CommerceInitialization;
  readonly identityAndAccessPolicy: Json;
  /** Trusted profile selection, captured once and included in request identity. */
  readonly resources?: CommerceResources;
  readonly requestCallLimit?: number;
  readonly requestCommandMs?: number;
  readonly nativeLimits?: CoreNativeLimits;
  readonly events?: CommerceNativeEvents;
  /** Explicit caller retry after proven abort, authenticated by the shared root. */
  readonly retryProvenNoncommit?: true;
  /** Protected readers never register or acquire the initializer/writer role. */
  readonly readOnly?: true;
}
/** Actual registered native callbacks plus the private initialization callback. */
export function commerceNativeRegistrations(commands: readonly CommerceCommand[], options?: Readonly<{ readOnly: true }>) {
  return Result.gen(function* () {
    if (commands.length === 0 || commands.length >= commerceLimits.commandDefinitions) return yield* Result.fail(commerceError("invalidAuthority"));
    const registrations = options?.readOnly === true ? [] : [commerceNativeInitializationCommand];
    const names = new Set<string>(registrations.map(command => command.name));
    const selected: { readonly name: string; readonly mode: "read" | "write" }[] = [...registrations];
    for (const token of commands) {
      const command = getCommerceCommand(token);
      if (command === undefined || names.has(command.name) || options?.readOnly === true && command.mode !== "read")
        return yield* Result.fail(commerceError("invalidAuthority"));
      names.add(command.name); selected.push(Object.freeze({ name: command.name, mode: command.mode }));
    }
    return Object.freeze(selected);
  });
}
const requestKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);
const captureCallLimit = Schema.decodeUnknownResult(CommerceCallLimit);
const captureCommandMilliseconds = Schema.decodeUnknownResult(FrameworkCommandMilliseconds);
const captureNativeLimits = Schema.decodeUnknownResult(Schema.Struct({
  maxIdentities: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32000 })),
  maxDocumentBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16_777_216 })),
}), { onExcessProperty: "error" });
const coreResult = <A>(work: Effect.Effect<A, Parameters<typeof projectCoreCommerceFailure>[0]>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
const eventResult = <A>(work: Effect.Effect<A, CommitEventError>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, failure => commerceError(failure.reason === "limitExceeded" ? "limitExceeded"
    : failure.reason === "storedCorruption" ? "storedCorruption" : failure.reason === "resourceFailure" ? "resourceFailure"
      : failure.reason === "statementFailure" ? "statementFailure" : "unadmittedEvent", failure)))));
const projectRetentionFailure = (failure: CommerceTransactionError | PreparedHostRuntimeError) => failure instanceof PreparedHostRuntimeError
  ? commerceError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** Real service/DAL callbacks execute over Core; no SQL session crosses them. */
export const makeCommerceNativeHost = Effect.fn("CommerceNativeHost.make")(function* (
  input: CommerceNativeHostInput,
): Effect.fn.Return<CommerceHost, CommerceTransactionError> {
  const captured = captureHostInput(input);
  const retained = yield* retainPreparedHost(captured.hostRuntime, compose(captured)).pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure))));
  return Object.freeze({ close: retained.close, newRequestKey: () => `commerce/${crypto.randomUUID()}`,
    run: (key, token, args) => retained.use(host => host.run(key, token, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure)))),
    read: (token, args) => retained.use(host => host.read(token, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure)))),
    initialize: rows => retained.use(host => host.initialize(rows)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure)))),
  } satisfies CommerceHost);
});

/** Same native execution owner with a capability surface confined to reads. */
export const makeCommerceNativeReadHost = Effect.fn("CommerceNativeHost.makeReadHost")(function* (
  input: Omit<CommerceNativeHostInput, "events" | "readOnly" | "retryProvenNoncommit">,
): Effect.fn.Return<Pick<CommerceHost, "close" | "read">, CommerceTransactionError> {
  const host = yield* makeCommerceNativeHost({ ...input, readOnly: true });
  return Object.freeze({ close: host.close, read: host.read });
});

/** Capture startup data before prepared-host retention can suspend. */
function captureHostInput(input: CommerceNativeHostInput) {
  const { database, binding, hostRuntime } = input;
  const commands = Object.freeze([...input.commands]);
  const readOnly = input.readOnly === true;
  const retryProvenNoncommit = input.retryProvenNoncommit;
  const initializationInput = Object.freeze({ ...input.initialization });
  const capturedResources = captureCommerceResources(input.resources ?? defaultCommerceResources);
  const capturedCalls = captureCallLimit(input.requestCallLimit ?? commerceLimits.calls);
  const capturedMilliseconds = captureCommandMilliseconds(input.requestCommandMs ?? commerceLimits.commandMs);
  const capturedLimits = captureNativeLimits(input.nativeLimits ?? { maxIdentities: logicalCommerceWorkingSetLimits.identities,
    maxDocumentBytes: logicalCommerceWorkingSetLimits.documentBytes });
  const capturedPolicy = captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes);
  const eventInput = input.events === undefined ? undefined : Object.freeze({ bundle: input.events.bundle,
    binding: input.events.binding, participant: input.events.participant,
    ...(input.events.derivedIdEvent === undefined ? {} : { derivedIdEvent: Object.freeze({ ...input.events.derivedIdEvent }) }),
    policy: captureAtomicCommerceEvents(input.events.policy), selection: captureParticipantEvents(input.events.selection) });
  const explicitResources = input.resources !== undefined || input.requestCallLimit !== undefined
    || input.requestCommandMs !== undefined || input.nativeLimits !== undefined;
  return { database, binding, hostRuntime, commands, readOnly, initializationInput, capturedResources, capturedCalls,
    capturedMilliseconds, capturedLimits, capturedPolicy, eventInput, explicitResources, retryProvenNoncommit };
}

const compose = Effect.fn("CommerceNativeHost.compose")(function* (hostInput: ReturnType<typeof captureHostInput>) {
  const { database, binding, commands, readOnly, initializationInput, capturedResources, capturedCalls,
    capturedMilliseconds, capturedLimits, capturedPolicy, eventInput, explicitResources, retryProvenNoncommit } = hostInput;
  if (readOnly && eventInput !== undefined) return yield* commerceError("invalidAuthority");
  if (retryProvenNoncommit !== undefined && (retryProvenNoncommit !== true || readOnly || eventInput === undefined))
    return yield* commerceError("invalidAuthority");
  const resources = yield* Effect.fromResult(capturedResources);
  const calls = yield* Effect.fromResult(Result.mapError(capturedCalls, cause => commerceError("unsupportedProfile", cause)));
  const commandMs = yield* Effect.fromResult(Result.mapError(capturedMilliseconds, cause => commerceError("unsupportedProfile", cause)));
  const nativeLimits = Object.freeze(yield* Effect.fromResult(Result.mapError(capturedLimits, cause => commerceError("unsupportedProfile", cause))));
  const limits = Object.freeze({ calls, commandBytes: resources.commandBytes, commandMs });
  const eventPolicy = eventInput === undefined ? undefined : yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(eventInput.policy));
  const eventSelection = eventInput === undefined ? undefined : yield* Effect.fromResult(eventInput.selection);
  if (eventInput !== undefined && (eventPolicy === undefined || eventSelection === undefined)) return yield* commerceError("invalidAuthority");
  yield* Effect.fromResult(admitParticipantEvents(eventSelection, eventPolicy));
  const registrations = yield* Effect.fromResult(commerceNativeRegistrations(commands, readOnly ? { readOnly: true } : undefined));
  const allowed = new Set(commands);
  if (allowed.size !== commands.length) return yield* commerceError("invalidAuthority");
  const policy = yield* Effect.fromResult(capturedPolicy);
  const initialization = yield* makeNativeCommerceInitialization(database, binding, initializationInput);
  const initializerBinding = readOnly ? undefined : yield* coreResult(database.bindNativeInitialization({ binding, commandName: commerceNativeInitializationCommand.name }));
  const readBinding = Effect.fn("CommerceNativeHost.readBinding")(function* () {
    const metadata = yield* initialization.readBinding();
    if (metadata.definition.source.definition.kind !== "relational" || registrations.some(selected => !metadata.commands.some(command =>
      command.name === selected.name && command.mode === selected.mode))) return yield* commerceError("invalidAuthority");
    return metadata;
  });
  const initial = yield* readBinding();
  if (eventInput?.derivedIdEvent !== undefined && !initial.definition.tables.some(table =>
    table.name === eventInput.derivedIdEvent?.sourceTable && table.privateEvent === undefined && table.privateReference === undefined))
    return yield* commerceError("invalidAuthority");
  const eventMetadata = eventInput === undefined ? undefined : yield* coreResult(database.readNativeBinding(eventInput.binding));
  const root = eventInput === undefined ? undefined : yield* coreResult(database.bindNativeRoot({
    bundle: eventInput.bundle,
    ...(retryProvenNoncommit === undefined ? {} : { retryProvenNoncommit }),
    contract: { format: "flarex.native-commerce-events", version: 1, policy: policy.value,
      events: eventPolicy?.identity ?? null, resources: { ...resources }, limits: { ...limits }, nativeLimits: { ...nativeLimits },
      ...(eventInput.derivedIdEvent === undefined ? {} : { derivedIdEventSource: eventInput.derivedIdEvent.sourceTable }) },
    participants: [
      { binding, commands: registrations.filter(command => command.mode === "write").map(command => command.name), limits: nativeLimits },
      { binding: eventInput.binding, commands: [CORE_NATIVE_EVENT_WRITE], limits: { maxIdentities: 20_000, maxDocumentBytes: 131_072 } },
    ], maxFinalUserDocuments: nativeLimits.maxIdentities,
  }));
  const rootMetadata = root === undefined ? undefined : yield* coreResult(database.readNativeRootBinding(root));
  const profilePolicy: Json = !explicitResources && eventPolicy === undefined && !readOnly ? policy.value : {
    policy: policy.value, resources: { ...resources }, limits: { ...limits }, nativeLimits: { ...nativeLimits },
    ...(eventPolicy === undefined ? {} : { events: eventPolicy.identity }),
    ...(eventInput?.derivedIdEvent === undefined ? {} : { derivedIdEventSource: eventInput.derivedIdEvent.sourceTable }),
    ...(readOnly ? { readOnly: true } : {}),
    ...(retryProvenNoncommit === undefined ? {} : { retryProvenNoncommit }),
  };
  yield* chargeHostPreparation({ native: initial.definition.identity, commands: registrations, initialization: initialization.descriptor,
    policy: profilePolicy }).pipe(Effect.mapError(projectRetentionFailure));
  const owner = Object.freeze({ hostId: Symbol("commerce.nativeHost") });
  const select = Effect.fn("CommerceNativeHost.select")(function* (token: CommerceCommand, mode?: "read" | "write") {
    const metadata = yield* readBinding();
    const definition = getCommerceCommand(token);
    if (!allowed.has(token) || definition === undefined || (mode !== undefined && definition.mode !== mode))
      return yield* commerceError("invalidAuthority");
    const command = metadata.commands.find(candidate => candidate.name === definition.name && candidate.mode === definition.mode);
    if (command === undefined) return yield* commerceError("bindingChanged");
    return { definition, command, metadata };
  });
  const execute = Effect.fn("CommerceNativeHost.execute")(function* (commandName: string, token: CommerceCommand | null,
    args: Json, evidenceBytes: number, claim?: CoreRequestClaim) {
    const metadata = yield* readBinding();
    const command = metadata.commands.find(candidate => candidate.name === commandName);
    if (command === undefined) return yield* commerceError("invalidAuthority");
    const id = crypto.randomUUID();
    const lifetime = yield* makeBoundedRequestLifetime(commerceError, limits, owner,
      Object.freeze({ requestId: Symbol("commerce.nativeRequest") }), id, command.mode);
    const chargeRetained = (bytes: number) => lifetime.fromResult(lifetime.charge(bytes)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure => new CoreNativeBudgetError({
        reason: failure.reason === "limitExceeded" || failure.reason === "closed" || failure.reason === "rollbackOnly"
          ? failure.reason : "unexpectedFailure", cause: failure,
      })))));
    type ExecutionOperation = Pick<CoreNativeOperation, "unixTime" | "operations" | "finalize" | "abort">
      & Partial<Pick<CoreNativeOperation, "finishRead">> & Readonly<{ eventOperations?: CoreNativeOperations }>;
    const body = (operation: ExecutionOperation) => Effect.gen(function* () {
      const familyId = crypto.randomUUID();
      const eventCapture = operation.eventOperations === undefined || eventPolicy === undefined ? undefined
        : makeAtomicEventCapture(readBinding().pipe(Effect.asVoid), lifetime,
          `native/${metadata.definition.identity.scopeUuid}/${familyId}`, eventPolicy, resources.eventMessages);
      const result = yield* Effect.gen(function* () {
        yield* lifetime.fromResult(lifetime.charge(evidenceBytes));
        const working = yield* makeNativeCommerceParticipant(operation.operations, metadata, lifetime, lifetime.context, id, operation.unixTime, resources);
        const invoke = Effect.fn("CommerceNativeHost.invoke")(function* (
          context: BoundedRequestContext, child: CommerceCommand, value: Json,
        ): Effect.fn.Return<Json, CommerceTransactionError> {
          const selected = yield* select(child);
          if (command.mode === "read" && selected.command.mode !== "read") return yield* commerceError("invalidAuthority");
          yield* lifetime.checkpoint(context);
          const captured = yield* lifetime.fromResult(captureCommerceJsonData(value, lifetime.remainingBytes()));
          yield* lifetime.fromResult(lifetime.charge(captured.bytes));
          const output = yield* observeExecution(`NativeCommerce.invoke/${selected.definition.name}`, selected.definition.run(makeCommerceCommandContext(lifetime, working, id, context, invoke,
            (manager, event) => lifetime.operation(manager, id, "write", eventCapture === undefined || eventSelection === undefined
              ? Effect.fail(commerceError("unadmittedEvent")) : eventCapture.captureSelected(eventSelection, event))), captured.value));
          yield* lifetime.checkpoint(context);
          const capturedOutput = yield* lifetime.fromResult(captureCommerceJsonData(output, lifetime.remainingBytes()));
          yield* lifetime.fromResult(lifetime.charge(capturedOutput.bytes));
          return capturedOutput.value;
        });
        let value: Json;
        if (token === null) {
          for (const table of metadata.tables) if (!(yield* coreResult(operation.operations.isEmpty(table.name))))
            return yield* commerceError("seedMismatch");
          if (metadata.definition.tables.length > 1) {
            const batches = yield* Effect.fromResult(planLogicalInitializationBatches(args,
              metadata.definition.tables.map(table => table.localName ?? table.name)));
            let rowCount = 0;
            for (const batch of batches) rowCount += (yield* (yield* working.table(lifetime.context, batch.table)).write(lifetime.context, "insert", batch.rows)).length;
            value = { rowCount };
          } else value = { rowCount: (yield* working.store.write(lifetime.context, "insert", args)).length };
        } else value = yield* invoke(lifetime.context, token, args);
        if (token === null) yield* initialization.result(value);
        if (command.mode === "write") yield* observeExecution("NativeCommerce.prepareDeleteClosure", coreResult(operation.operations.prepareDeleteClosure()));
        const canonical = yield* Effect.fromResult(canonicalizeJsonOutcome(value, limits.commandBytes)).pipe(Effect.mapError(projectCommerceJsonFailure));
        if (token === null) yield* lifetime.fromResult(lifetime.charge(canonical.canonicalBytes.byteLength));
        const replacements = command.mode === "write" ? yield* working.referenceReplacementChanges() : [];
        if (replacements.length > 1 || replacements.some(replacement => eventCapture === undefined
          || eventInput?.derivedIdEvent === undefined || replacement.sourceTable !== eventInput.derivedIdEvent.sourceTable))
          return yield* commerceError("unadmittedEvent");
        return { ...canonical, replacements };
      }).pipe(lifetime.withinDeadline);
      yield* lifetime.seal;
      if (eventCapture !== undefined && operation.eventOperations !== undefined && eventMetadata !== undefined && eventInput !== undefined) {
        const derived = result.replacements.length === 0 ? undefined : eventInput.derivedIdEvent;
        const closure = yield* eventCapture.close(token === null ? [] : [{ participant: eventInput.participant,
          command: token, input: args, result: result.valueJson }], derived);
        if (derived !== undefined) yield* appendDerivedCommerceIdEvents(closure, lifetime,
          result.replacements.flatMap(replacement => replacement.ids));
        const consumed = yield* consumeCommerceEvents(closure, lifetime);
        yield* observeExecution("NativeCommerce.stageEvents", eventResult(stageCoreCommitEventFamily(operation.eventOperations, eventMetadata.definition, familyId, consumed, operation.unixTime)));
      }
      yield* lifetime.close;
      yield* readBinding();
      if (command.mode === "read") {
        if (operation.finishRead === undefined) return yield* commerceError("invalidAuthority");
        yield* coreResult(operation.finishRead());
        return { value: result.valueJson, finalized: undefined, deadline: lifetime.deadlineUnixMilliseconds };
      }
      return { value: result.valueJson, finalized: yield* observeExecution("NativeCommerce.finalize", coreResult(operation.finalize())), deadline: lifetime.deadlineUnixMilliseconds };
    });
    const beginOperation: Effect.Effect<ExecutionOperation, CommerceTransactionError> = root !== undefined && eventInput !== undefined
      && command.mode === "write" && token !== null ? Effect.gen(function* () {
        if (claim === undefined) return yield* commerceError("invalidAuthority");
        yield* coreResult(database.readNativeRootBinding(root));
        const operation = yield* coreResult(database.beginNativeRoot(root, { claim, chargeRetained, remainingBytes: lifetime.remainingBytes }));
        const prepared = yield* Effect.exit(Effect.gen(function* () {
          return { unixTime: operation.unixTime, operations: yield* coreResult(operation.native(binding)),
            eventOperations: yield* coreResult(operation.native(eventInput.binding)), finalize: operation.finalize, abort: operation.abort };
        }));
        if (Exit.isFailure(prepared)) {
          yield* operation.abort();
          return yield* Effect.failCause(prepared.cause);
        }
        return prepared.value;
      }) : coreResult(database.beginNative(binding, { commandName, limits: nativeLimits,
        chargeRetained, remainingBytes: lifetime.remainingBytes, ...(claim === undefined ? {} : { claim }) }));
    return yield* Effect.acquireUseRelease(beginOperation, operation => body(operation),
    operation => operation.abort()).pipe(Effect.ensuring(lifetime.close));
  });
  const abortWithCause = <Failure>(claim: CoreRequestClaim, cause: Cause.Cause<Failure>) => coreResult(database.abortRequest(claim)).pipe(
    Effect.exit, Effect.flatMap(aborted => Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));
  const write = Effect.fn("CommerceNativeHost.write")(function* (identity: CoreRequestIdentity,
    claimBinding: CoreNativeBinding | CoreNativeInitializationBinding | CoreNativeRootBinding, commandName: string, token: CommerceCommand | null, args: Json, evidenceBytes: number) {
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const observed = yield* token === null ? initialization.projectLookup(database.claimRequest(identity, claimBinding))
        : coreResult(database.claimRequest(identity, claimBinding));
      const acquired = observed.kind === "busy" ? yield* (token === null ? initialization.projectLookup(database.recoverRequest(identity))
        : coreResult(database.recoverRequest(identity))) : observed;
      if (acquired.kind === "committed") {
        yield* readBinding();
        return token === null ? yield* initialization.result(acquired.result)
          : (yield* Effect.fromResult(captureCommerceJsonData(acquired.result, limits.commandBytes)).pipe(
            Effect.mapError(cause => commerceError("storedCorruption", cause)))).value;
      }
      if (acquired.kind !== "claimed") return yield* commerceError(acquired.kind === "busy" ? "overlappingOperation" : "requestConflict");
      const executed = yield* Effect.exit(restore(execute(commandName, token, args, evidenceBytes, acquired.claim)));
      if (Exit.isFailure(executed)) return yield* abortWithCause(acquired.claim, executed.cause);
      if (executed.value.finalized === undefined) return yield* abortWithCause(acquired.claim, Cause.fail(commerceError("invalidAuthority")));
      const committed = yield* Effect.exit(database.commit(executed.value.finalized, { claim: acquired.claim, result: executed.value.value,
        admissionDeadlineUnixMilliseconds: executed.value.deadline }));
      if (Exit.isFailure(committed)) {
        const reason = committed.cause.reasons.length === 1 ? committed.cause.reasons[0] : undefined;
        const mapped = Cause.map(committed.cause, projectCoreCommerceFailure);
        return reason !== undefined && Cause.isFailReason(reason) && isCoreDefinitiveCommitRefusal(reason.error)
          ? yield* abortWithCause(acquired.claim, mapped) : yield* Effect.failCause(mapped);
      }
      yield* readBinding();
      return executed.value.value;
    }));
  });
  const run = Effect.fn("CommerceNativeHost.run")(function* (key: string, token: CommerceCommand, args: Json) {
    if (readOnly) return yield* commerceError("invalidAuthority");
    const selected = yield* select(token, "write");
    yield* initialization.requireReady;
    const captured = yield* Effect.fromResult(captureCommerceJsonData(args, limits.commandBytes));
    const nativeKey = yield* requestKey(key).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (!/^commerce\/[a-zA-Z0-9/-]{1,110}$/.test(nativeKey)) return yield* commerceError("invalidInput");
    const evidence = yield* capturePrivateCanonicalValue({ native: { ...selected.command.identity, source: { ...selected.command.identity.source } },
      arguments: captured.value, policy: profilePolicy }, limits.commandBytes,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    const identity: CoreRequestIdentity = rootMetadata === undefined
      ? { kind: "native", native: selected.command.identity, key: nativeKey, requestHash: evidence.sha256Hex }
      : { kind: "nativeRoot", root: rootMetadata.identity, key: nativeKey, requestHash: evidence.sha256Hex };
    return yield* write(identity, root ?? binding,
      selected.command.name, token, captured.value, evidence.canonicalByteLength);
  });
  const read = Effect.fn("CommerceNativeHost.read")(function* (token: CommerceCommand, args: Json) {
    const selected = yield* select(token, "read");
    yield* initialization.requireReady;
    const captured = yield* Effect.fromResult(captureCommerceJsonData(args, limits.commandBytes));
    return (yield* execute(selected.command.name, token, captured.value, captured.bytes)).value;
  });
  const initialize = Effect.fn("CommerceNativeHost.initialize")(function* (rows: Json) {
    if (initializerBinding === undefined) return yield* commerceError("invalidAuthority");
    yield* readBinding();
    const captured = yield* initialization.verifyRows(rows);
    return yield* write(initialization.identity, initializerBinding, commerceNativeInitializationCommand.name, null,
      captured.value, captured.bytes);
  });
  return Object.freeze({ run, read, initialize });
});
