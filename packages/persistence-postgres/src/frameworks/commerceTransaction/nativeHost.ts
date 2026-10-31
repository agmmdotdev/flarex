import { Cause, Effect, Exit, Result, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import type { CoreDatabase, CoreNativeBinding, CoreNativeInitializationBinding, CoreNativeOperation, CoreRequestClaim, CoreRequestIdentity } from "../../core/api";
import { CoreNativeBudgetError, CoreTransactionError } from "../../core/api";
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
import { logicalCommerceWorkingSetLimits } from "./resources";

export interface CommerceNativeHostInput {
  readonly database: CoreDatabase;
  readonly binding: CoreNativeBinding;
  readonly hostRuntime: PreparedHostRuntime;
  readonly commands: readonly CommerceCommand[];
  readonly initialization: CommerceInitialization;
  readonly identityAndAccessPolicy: Json;
}
/** Actual registered native callbacks plus the private initialization callback. */
export function commerceNativeRegistrations(commands: readonly CommerceCommand[]) {
  return Result.gen(function* () {
    if (commands.length === 0 || commands.length >= commerceLimits.commandDefinitions) return yield* Result.fail(commerceError("invalidAuthority"));
    const names = new Set<string>([commerceNativeInitializationCommand.name]);
    const registrations = [commerceNativeInitializationCommand];
    const selected: { readonly name: string; readonly mode: "read" | "write" }[] = [...registrations];
    for (const token of commands) {
      const command = getCommerceCommand(token);
      if (command === undefined || names.has(command.name)) return yield* Result.fail(commerceError("invalidAuthority"));
      names.add(command.name); selected.push(Object.freeze({ name: command.name, mode: command.mode }));
    }
    return Object.freeze(selected);
  });
}
const requestKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);
const coreResult = <A>(work: Effect.Effect<A, Parameters<typeof projectCoreCommerceFailure>[0]>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
const projectRetentionFailure = (failure: CommerceTransactionError | PreparedHostRuntimeError) => failure instanceof PreparedHostRuntimeError
  ? commerceError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** Real service/DAL callbacks execute over Core; no SQL session crosses them. */
export const makeCommerceNativeHost = Effect.fn("CommerceNativeHost.make")(function* (
  input: CommerceNativeHostInput,
): Effect.fn.Return<CommerceHost, CommerceTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, compose(input)).pipe(
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

const compose = Effect.fn("CommerceNativeHost.compose")(function* (input: CommerceNativeHostInput) {
  const { database, binding } = input;
  const registrations = yield* Effect.fromResult(commerceNativeRegistrations(input.commands));
  const allowed = new Set(input.commands);
  if (allowed.size !== input.commands.length) return yield* commerceError("invalidAuthority");
  const policy = yield* Effect.fromResult(captureCommerceJsonData(input.identityAndAccessPolicy, commerceLimits.rowBytes));
  const initialization = yield* makeNativeCommerceInitialization(database, binding, input.initialization);
  const initializerBinding = yield* coreResult(database.bindNativeInitialization({ binding, commandName: commerceNativeInitializationCommand.name }));
  const readBinding = Effect.fn("CommerceNativeHost.readBinding")(function* () {
    const metadata = yield* initialization.readBinding();
    if (metadata.definition.source.definition.kind !== "relational" || registrations.some(selected => !metadata.commands.some(command =>
      command.name === selected.name && command.mode === selected.mode))) return yield* commerceError("invalidAuthority");
    return metadata;
  });
  const initial = yield* readBinding();
  yield* chargeHostPreparation({ native: initial.definition.identity, commands: registrations, initialization: initialization.descriptor,
    policy: policy.value }).pipe(Effect.mapError(projectRetentionFailure));
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
    const lifetime = yield* makeBoundedRequestLifetime(commerceError, commerceLimits, owner,
      Object.freeze({ requestId: Symbol("commerce.nativeRequest") }), id, command.mode);
    const chargeRetained = (bytes: number) => lifetime.fromResult(lifetime.charge(bytes)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure => new CoreNativeBudgetError({
        reason: failure.reason === "limitExceeded" || failure.reason === "closed" || failure.reason === "rollbackOnly"
          ? failure.reason : "unexpectedFailure", cause: failure,
      })))));
    const body = (operation: CoreNativeOperation) => Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        yield* lifetime.fromResult(lifetime.charge(evidenceBytes));
        const working = yield* makeNativeCommerceParticipant(operation.operations, metadata, lifetime, lifetime.context, id, operation.unixTime);
        const invoke = Effect.fn("CommerceNativeHost.invoke")(function* (
          context: BoundedRequestContext, child: CommerceCommand, value: Json,
        ): Effect.fn.Return<Json, CommerceTransactionError> {
          const selected = yield* select(child);
          if (command.mode === "read" && selected.command.mode !== "read") return yield* commerceError("invalidAuthority");
          yield* lifetime.checkpoint(context);
          const captured = yield* lifetime.fromResult(captureCommerceJsonData(value, lifetime.remainingBytes()));
          yield* lifetime.fromResult(lifetime.charge(captured.bytes));
          const output = yield* selected.definition.run(makeCommerceCommandContext(lifetime, working, id, context, invoke,
            manager => lifetime.operation(manager, id, "write", Effect.fail(commerceError("unadmittedEvent")))), captured.value);
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
        const canonical = yield* Effect.fromResult(canonicalizeJsonOutcome(value, commerceLimits.commandBytes)).pipe(Effect.mapError(projectCommerceJsonFailure));
        if (token === null) yield* lifetime.fromResult(lifetime.charge(canonical.canonicalBytes.byteLength));
        return canonical;
      }).pipe(lifetime.withinDeadline);
      yield* lifetime.seal;
      yield* lifetime.close;
      yield* readBinding();
      if (command.mode === "read") {
        yield* coreResult(operation.finishRead());
        return { value: result.valueJson, finalized: undefined, deadline: lifetime.deadlineUnixMilliseconds };
      }
      return { value: result.valueJson, finalized: yield* coreResult(operation.finalize()), deadline: lifetime.deadlineUnixMilliseconds };
    });
    return yield* Effect.acquireUseRelease(coreResult(database.beginNative(binding, { commandName,
      limits: { maxIdentities: logicalCommerceWorkingSetLimits.identities, maxDocumentBytes: logicalCommerceWorkingSetLimits.documentBytes },
      chargeRetained, ...(claim === undefined ? {} : { claim }) })), operation => body(operation),
    operation => operation.abort()).pipe(Effect.ensuring(lifetime.close));
  });
  const abortWithCause = <Failure>(claim: CoreRequestClaim, cause: Cause.Cause<Failure>) => coreResult(database.abortRequest(claim)).pipe(
    Effect.exit, Effect.flatMap(aborted => Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));
  const write = Effect.fn("CommerceNativeHost.write")(function* (identity: CoreRequestIdentity,
    claimBinding: CoreNativeBinding | CoreNativeInitializationBinding, commandName: string, token: CommerceCommand | null, args: Json, evidenceBytes: number) {
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const observed = yield* token === null ? initialization.projectLookup(database.claimRequest(identity, claimBinding))
        : coreResult(database.claimRequest(identity, claimBinding));
      const acquired = observed.kind === "busy" ? yield* (token === null ? initialization.projectLookup(database.recoverRequest(identity))
        : coreResult(database.recoverRequest(identity))) : observed;
      if (acquired.kind === "committed") {
        yield* readBinding();
        return token === null ? yield* initialization.result(acquired.result)
          : (yield* Effect.fromResult(captureCommerceJsonData(acquired.result, commerceLimits.commandBytes)).pipe(
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
        return reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreTransactionError
          ? yield* abortWithCause(acquired.claim, mapped) : yield* Effect.failCause(mapped);
      }
      yield* readBinding();
      return executed.value.value;
    }));
  });
  const run = Effect.fn("CommerceNativeHost.run")(function* (key: string, token: CommerceCommand, args: Json) {
    const selected = yield* select(token, "write");
    yield* initialization.requireReady;
    const captured = yield* Effect.fromResult(captureCommerceJsonData(args, commerceLimits.commandBytes));
    const nativeKey = yield* requestKey(key).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (!/^commerce\/[a-zA-Z0-9/-]{1,110}$/.test(nativeKey)) return yield* commerceError("invalidInput");
    const evidence = yield* capturePrivateCanonicalValue({ native: { ...selected.command.identity, source: { ...selected.command.identity.source } },
      arguments: captured.value, policy: policy.value }, commerceLimits.commandBytes,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    return yield* write({ kind: "native", native: selected.command.identity, key: nativeKey, requestHash: evidence.sha256Hex }, binding,
      selected.command.name, token, captured.value, evidence.canonicalByteLength);
  });
  const read = Effect.fn("CommerceNativeHost.read")(function* (token: CommerceCommand, args: Json) {
    const selected = yield* select(token, "read");
    yield* initialization.requireReady;
    const captured = yield* Effect.fromResult(captureCommerceJsonData(args, commerceLimits.commandBytes));
    return (yield* execute(selected.command.name, token, captured.value, captured.bytes)).value;
  });
  const initialize = Effect.fn("CommerceNativeHost.initialize")(function* (rows: Json) {
    yield* readBinding();
    const captured = yield* initialization.verifyRows(rows);
    return yield* write(initialization.identity, initializerBinding, commerceNativeInitializationCommand.name, null,
      captured.value, captured.bytes);
  });
  return Object.freeze({ run, read, initialize });
});
