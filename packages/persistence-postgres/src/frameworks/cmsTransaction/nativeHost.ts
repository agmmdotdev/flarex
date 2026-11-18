import { Cause, Effect, Exit, Schema } from "effect";
import { encodeBytesToLowercaseHex, copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { CoreNativeBudgetError, isCoreDefinitiveCommitRefusal,
  type CoreNativeCommandDefinition, type CoreNativeOperations,
  type CoreNativeOperation, type CoreNativeRootOperation, type CoreRequestClaim, type CoreRequestIdentity } from "../../core/api";
import { chargeHostPreparation, retainPreparedHost, PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { getCmsCommand, type CmsCommand } from "./commands";
import { makeCmsCommandContext } from "./context";
import type { CmsContentIdentity } from "./construction";
import type { CmsHost } from "./host";
import { makeCmsRequestLifetime, type CmsRequestLifetime } from "./lifetime";
import { cmsError, cmsLimits, type CmsRequestContext, type CmsTransactionError } from "./model";
import type { CmsNativeBindingInput } from "./nativeBinding";
import { makeNativeCmsDocuments } from "./nativeDocuments";
import { projectCoreCmsFailure } from "./nativeFailure";
import { makeNativeCmsRelations } from "./nativeRelations";
import { makeNativePayloadPreferenceCleanup, requirePayloadPreferenceNativeCleanup } from "../payloadPreferences/nativeCleanup";

interface NativeHostInput extends CmsNativeBindingInput {
  readonly requestBudget: NonNullable<CmsNativeBindingInput["requestBudget"]>;
  readonly commands: readonly CmsCommand[];
  readonly expectedContentIdentity: CmsContentIdentity;
  readonly readOnly: boolean;
}
type SelectedOperation = Readonly<{ kind: "single"; operation: CoreNativeOperation; operations: CoreNativeOperations;
  preferenceOperations: undefined }> | Readonly<{ kind: "root"; operation: CoreNativeRootOperation;
    operations: CoreNativeOperations; preferenceOperations: CoreNativeOperations }>;
const requestKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);
const hash = Effect.fn("CmsNativeHost.hash")(function* (value: Json) {
  const bytes = new TextEncoder().encode(encodeCanonicalJson(value, issue => { throw new Error(`Native CMS correlation: ${issue.reason}`); }));
  return encodeBytesToLowercaseHex(new Uint8Array(yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)), catch: cause => cmsError("resourceFailure", cause),
  })));
});
const projectRetentionFailure = (failure: CmsTransactionError | PreparedHostRuntimeError) => failure instanceof PreparedHostRuntimeError
  ? cmsError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** Same framework callbacks and lifetime, over the one translated core owner. */
export const makeCmsNativeHost = Effect.fn("CmsNativeHost.make")(function* (input: NativeHostInput): Effect.fn.Return<CmsHost, CmsTransactionError> {
  const retained = yield* retainPreparedHost(input.hostRuntime, compose(input)).pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure))));
  return Object.freeze({ requestBudget: input.requestBudget, close: retained.close,
    newRequestKey: () => `cms/${crypto.randomUUID()}`,
    run: (key, command, args) => retained.use(host => host.run(key, command, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure)))),
    read: (command, args) => retained.use(host => host.read(command, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetentionFailure)))),
  } satisfies CmsHost);
});

const compose = Effect.fn("CmsNativeHost.compose")(function* (input: NativeHostInput) {
  const { database, binding, requestBudget } = input;
  const preferences = input.preferences === undefined ? undefined
    : yield* requirePayloadPreferenceNativeCleanup(input.preferences, database, binding);
  const allowed = new Set(input.commands);
  if (allowed.size === 0 || allowed.size > cmsLimits.calls) return yield* Effect.fail(cmsError("invalidAuthority"));
  const readBinding = Effect.fn("CmsNativeHost.readBinding")(function* () {
    if (input.preferences !== undefined) yield* requirePayloadPreferenceNativeCleanup(input.preferences, database, binding);
    const metadata = yield* database.readNativeBinding(binding).pipe(Effect.mapError(projectCoreCmsFailure));
    const identity = metadata.definition.identity;
    if (identity.configSha256 !== input.expectedContentIdentity.configSha256 || identity.provenanceSha256 !== input.expectedContentIdentity.provenanceSha256)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    return metadata;
  });
  const initial = yield* readBinding();
  const referenceTargets = new Map(initial.definition.references.map(reference => [reference.declaration.source.forwardName, reference.targetTable]));
  const joins = initial.definition.source.writeProfile === "payload.content-joins";
  const names = new Set<string>();
  for (const token of allowed) {
    const definition = getCmsCommand(token);
    if (definition === undefined || names.has(definition.name) || (input.readOnly && definition.mode !== "read") ||
      !initial.commands.some(command => command.name === definition.name && command.mode === definition.mode))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    names.add(definition.name);
  }
  yield* chargeHostPreparation({ native: initial.definition.identity, commands: [...names], policy: input.identityAndAccessPolicy, requestBudget });
  const owner = Object.freeze({ hostId: Symbol("cms.nativeHost") });
  const select = Effect.fn("CmsNativeHost.select")(function* (token: CmsCommand, mode?: "read" | "write") {
    const metadata = yield* readBinding();
    const definition = getCmsCommand(token);
    if (!allowed.has(token) || definition === undefined || (mode !== undefined && definition.mode !== mode))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const command = metadata.commands.find(candidate => candidate.name === definition.name && candidate.mode === definition.mode);
    if (command === undefined) return yield* Effect.fail(cmsError("bindingChanged"));
    return { definition, command };
  });
  const invoke = (operations: CoreNativeOperations, command: CoreNativeCommandDefinition, lifetime: CmsRequestLifetime,
    id: string, root: CmsCommand, args: Json, preferenceOperations?: CoreNativeOperations) => {
    const documents = makeNativeCmsDocuments(operations, lifetime);
    const unsupported = (context: CmsRequestContext, transactionId: Parameters<CmsRequestLifetime["begin"]>[1]) =>
      lifetime.operation(context, transactionId, "write", Effect.fail(cmsError("unsupportedProfile")));
    const cleanup = preferences === undefined || preferenceOperations === undefined ? undefined
      : makeNativePayloadPreferenceCleanup(preferences, lifetime, operations, preferenceOperations);
    const ports = { documents, relations: makeNativeCmsRelations(operations, lifetime, referenceTargets,
      command.mode === "read" && joins),
      preferences: cleanup?.cleanup ?? { deleteForPendingDocument: unsupported } };
    const call = Effect.fn("CmsNativeHost.invoke")(function* (context: CmsRequestContext, token: CmsCommand, value: Json): Effect.fn.Return<Json, CmsTransactionError> {
      const { definition } = yield* select(token);
      if (command.mode === "read" && definition.mode !== "read") return yield* Effect.fail(cmsError("invalidAuthority"));
      yield* lifetime.checkpoint(context);
      const captured = yield* Effect.fromResult(capturePrivateJsonData(value, lifetime.remainingBytes(), cmsError));
      yield* lifetime.fromResult(lifetime.charge(captured.bytes));
      const output = yield* definition.run(makeCmsCommandContext(lifetime, id, context, ports,
        command.mode === "read" && context === lifetime.context, call), captured.value);
      yield* lifetime.checkpoint(context);
      const result = yield* Effect.fromResult(capturePrivateJsonData(output, lifetime.remainingBytes(), cmsError));
      yield* lifetime.fromResult(lifetime.charge(result.bytes));
      return result.value;
    });
    return call(lifetime.context, root, args).pipe(Effect.map(value => ({ value, applyCleanup: cleanup === undefined ? Effect.void : cleanup.apply() })));
  };
  const execute = Effect.fn("CmsNativeHost.execute")(function* (token: CmsCommand, args: Json, claim?: CoreRequestClaim) {
    const { command } = yield* select(token);
    const id = crypto.randomUUID();
    const lifetime = yield* makeCmsRequestLifetime(owner, { requestId: Symbol("cms.nativeRequest") }, id, command.mode, requestBudget);
    const chargeRetained = (bytes: number) => lifetime.fromResult(lifetime.charge(bytes)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => new CoreNativeBudgetError({
        reason: error.reason === "limitExceeded" || error.reason === "closed" || error.reason === "rollbackOnly"
          ? error.reason : "unexpectedFailure", cause: error,
      })))),
    );
    const acquire: Effect.Effect<SelectedOperation, CmsTransactionError> = preferences !== undefined && command.mode === "write" ? Effect.gen(function* () {
      if (claim === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
      const operation = yield* database.beginNativeRoot(preferences.root, { claim, chargeRetained, remainingBytes: lifetime.remainingBytes }).pipe(Effect.mapError(projectCoreCmsFailure));
      const operations = yield* operation.native(binding).pipe(Effect.mapError(projectCoreCmsFailure),
        Effect.onError(() => operation.abort()));
      const preferenceOperations = yield* operation.native(preferences.preferencesBinding).pipe(Effect.mapError(projectCoreCmsFailure),
        Effect.onError(() => operation.abort()));
      return { kind: "root" as const, operation, operations, preferenceOperations };
    }) : database.beginNative(binding, { commandName: command.name, limits: { maxIdentities: cmsLimits.identities,
        maxDocumentBytes: cmsLimits.documentBytes }, chargeRetained, remainingBytes: lifetime.remainingBytes,
        ...(claim === undefined ? {} : { claim }) }).pipe(Effect.mapError(projectCoreCmsFailure),
        Effect.map(operation => ({ kind: "single" as const, operation, operations: operation.operations, preferenceOperations: undefined })));
    return yield* Effect.acquireUseRelease(acquire,
      selected => Effect.gen(function* () {
        const { operation } = selected;
        const native = yield* invoke(selected.operations, command, lifetime, id, token, args, selected.preferenceOperations).pipe(lifetime.withinDeadline);
        const result = yield* canonicalizeSuccessfulResultV1Effect(native.value).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
        yield* lifetime.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
        yield* lifetime.seal;
        yield* native.applyCleanup;
        // Foreign native work has drained before sealing; close the confined
        // request before handing any finalization authority to the core owner.
        yield* lifetime.close;
        yield* readBinding();
        if (command.mode === "read") {
          if (selected.kind !== "single") return yield* Effect.fail(cmsError("invalidAuthority"));
          yield* selected.operation.finishRead().pipe(Effect.mapError(projectCoreCmsFailure));
          return { value: result.valueJson, deadline: lifetime.deadlineUnixMilliseconds, finalized: undefined };
        }
        return { value: result.valueJson, deadline: lifetime.deadlineUnixMilliseconds,
          finalized: yield* operation.finalize().pipe(Effect.mapError(projectCoreCmsFailure)) };
      }),
      selected => selected.operation.abort(),
    ).pipe(Effect.ensuring(lifetime.close));
  });
  const abortWithCause = <Failure>(claim: CoreRequestClaim, cause: Cause.Cause<Failure>) =>
    database.abortRequest(claim).pipe(Effect.mapError(projectCoreCmsFailure), Effect.exit, Effect.flatMap(aborted =>
      Effect.failCause(Exit.isFailure(aborted) ? Cause.combine(cause, aborted.cause) : cause)));
  const run = Effect.fn("CmsNativeHost.run")(function* (key: string, token: CmsCommand, args: Json) {
    if (input.readOnly) return yield* Effect.fail(cmsError("invalidAuthority"));
    const { command } = yield* select(token, "write");
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, requestBudget.commandBytes, cmsError));
    const nativeKey = yield* requestKey(key).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    const correlation = yield* Effect.fromResult(capturePrivateJsonData({ native: command.identity, arguments: captured.value,
      policy: input.identityAndAccessPolicy }, requestBudget.commandBytes, cmsError));
    const correlationHash = yield* hash(correlation.value);
    const identity: CoreRequestIdentity = preferences === undefined
      ? { kind: "native", native: command.identity, key: nativeKey, requestHash: correlationHash }
      : { kind: "nativeRoot", root: preferences.metadata.identity, key: nativeKey, requestHash: correlationHash };
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const observed = yield* database.claimRequest(identity, preferences?.root ?? binding).pipe(Effect.mapError(projectCoreCmsFailure));
      const acquired = observed.kind === "busy" ? yield* database.recoverRequest(identity).pipe(Effect.mapError(projectCoreCmsFailure)) : observed;
      if (acquired.kind === "committed") { yield* readBinding();
        return (yield* Effect.fromResult(capturePrivateJsonData(acquired.result, requestBudget.commandBytes,
          (_reason, cause) => cmsError("storedCorruption", cause)))).value;
      }
      if (acquired.kind !== "claimed") return yield* Effect.fail(cmsError(acquired.kind === "busy" ? "overlappingOperation" : "requestConflict"));
      const executed = yield* Effect.exit(restore(execute(token, captured.value, acquired.claim)));
      if (Exit.isFailure(executed)) return yield* abortWithCause(acquired.claim, executed.cause);
      const finalized = executed.value.finalized;
      if (finalized === undefined) return yield* abortWithCause(acquired.claim, Cause.fail(cmsError("invalidAuthority")));
      const committed = yield* Effect.exit(database.commit(finalized, { claim: acquired.claim, result: executed.value.value,
        admissionDeadlineUnixMilliseconds: executed.value.deadline }));
      if (Exit.isFailure(committed)) {
        // Only a definitive core refusal releases its claim. Persistence owns
        // uncertainty; a later request reconciles it before any callback.
        const known = committed.cause.reasons.length === 1 ? committed.cause.reasons[0] : undefined;
        const mapped = Cause.map(committed.cause, projectCoreCmsFailure);
        return known !== undefined && Cause.isFailReason(known) && isCoreDefinitiveCommitRefusal(known.error)
          ? yield* abortWithCause(acquired.claim, mapped) : yield* Effect.failCause(mapped);
      }
      yield* readBinding();
      return executed.value.value;
    }));
  });
  const read = Effect.fn("CmsNativeHost.read")(function* (token: CmsCommand, args: Json) {
    yield* select(token, "read");
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, requestBudget.commandBytes, cmsError));
    return (yield* execute(token, captured.value)).value;
  });
  return { run, read };
});
