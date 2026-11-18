import { Effect, type Scope } from "effect";
import { inspectPrivateReferenceSaveAccess, bindPrivateReferenceSaveAccess,
  type SessionJournalAttempt, type PrivateReferenceSaveAccess, type LogicalParticipantBorrow } from "@flarex/persistence-postgres/internal/session-journal";
import { cmsError, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { LogicalParticipantInvocationError } from "@flarex/persistence-postgres/internal/logical-participant-errors";
import { isJsonObject } from "flarex-protocol/json";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "../collections";
import { makePayloadNative, type PayloadNativeInstrumentation } from "./native";
import { makePayloadAttempt } from "./attempt";
import type { PayloadAttemptRuntime } from "../runtime";
import type { Json } from "flarex-protocol/json";
import { makeBorrowedNativeCmsInvocation, inspectNativeReferenceSaveAccess, makeNativeReferenceAuthorization,
  type NativeReferenceSaveAccess, type CmsRequestLifetime, type CoreNativeOperations } from "@flarex/persistence-postgres/internal/cms-execution";

/** Source-private test seam for native normalization/lifecycle observations.
 * Neither hooks nor caller data supply the protected permission decisions. */
export const makePayloadReferenceSave: (
  compiled: CompiledPayloadCollections, attempt: SessionJournalAttempt, access: PrivateReferenceSaveAccess,
  instrumentation?: PayloadNativeInstrumentation,
) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope> = Effect.fn("PayloadReferenceSave.make")(function* (
  compiled, attempt, access, instrumentation,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const grant = inspectPrivateReferenceSaveAccess(access, attempt);
  if (grant === undefined || grant.configSha256 !== compiled.contentIdentity.configSha256 ||
    grant.provenanceSha256 !== compiled.contentIdentity.provenanceSha256 ||
    !compiled.configuration.tables.some(table => table.logicalTableName === grant.tableName && table.collectionSlug === grant.collection))
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const token = Object.freeze({});
  const contextKey = "flarexPrivateReferenceSave";
  const allowed = (operation: "create" | "update" | "delete", context: Record<string, unknown>) =>
    context[contextKey] === token && inspectPrivateReferenceSaveAccess(access, attempt)?.source[operation] === true;
  const native = yield* makePayloadNative(compiled, instrumentation, {
    create: ({ req }) => allowed("create", req.context), update: ({ req }) => allowed("update", req.context),
    delete: ({ req }) => allowed("delete", req.context), read: () => false,
  });
  const runtime = yield* makePayloadAttempt(native, attempt, { ...instrumentation, requestContext: { [contextKey]: token } });
  const borrow = bindPrivateReferenceSaveAccess(access, runtime.borrowParticipant);
  const borrowParticipant: LogicalParticipantBorrow = Effect.fn("PayloadReferenceSave.borrow")(function* (input) {
    const borrowed = yield* borrow(input);
    return Object.freeze({ ...borrowed, invoke: Effect.fn("PayloadReferenceSave.invoke")(function* (method, args) {
      if (!isJsonObject(args) || args.collection !== grant.collection)
        return yield* Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: cmsError("unsupportedProfile") }));
      return yield* borrowed.invoke(method, args);
    }) });
  });
  return Object.freeze({ borrowParticipant });
});

/** Private borrowed saves only; no alternate/direct writer is exposed. */
export const makePayloadReferenceSaveRuntime: (
  compiled: CompiledPayloadCollections, attempt: SessionJournalAttempt, access: PrivateReferenceSaveAccess,
) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope> = Effect.fn("PayloadReferenceSave.makeRuntime")(function* (
  compiled, attempt, access,
) { return yield* makePayloadReferenceSave(compiled, attempt, access); });

/** Genuine Local API save child of the translated root. The trusted backend
 * supplies an opaque tracked policy fact; Payload receives only CMS ports. */
export const makePayloadNativeReferenceSave = Effect.fn("PayloadReferenceSave.makeNative")(function* (
  compiled: CompiledPayloadCollections,
  input: Readonly<{ operations: CoreNativeOperations; lifetime: CmsRequestLifetime; transactionId: string; access: NativeReferenceSaveAccess }>,
  instrumentation?: PayloadNativeInstrumentation,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const selected = inspectNativeReferenceSaveAccess(input.access, input.lifetime);
  if (selected === undefined || selected.configSha256 !== compiled.contentIdentity.configSha256
    || selected.provenanceSha256 !== compiled.contentIdentity.provenanceSha256
    || !compiled.configuration.tables.some(table => table.logicalTableName === selected.table && table.collectionSlug === selected.collection))
    return yield* cmsError("invalidAuthority");
  const token = Object.freeze({}), contextKey = "flarexPrivateReferenceSave";
  let current: "create" | "update" | "delete" | undefined;
  const allowed = (operation: typeof current, context: Record<string, unknown>) => current === operation && context[contextKey] === token
    && operation !== undefined && inspectNativeReferenceSaveAccess(input.access, input.lifetime)?.source[operation] === true;
  const native = yield* makePayloadNative(compiled, instrumentation, {
    create: ({ req }) => allowed("create", req.context), update: ({ req }) => allowed("update", req.context),
    delete: ({ req }) => allowed("delete", req.context), read: () => false,
  });
  const commands = native.makeCommands({ ...instrumentation, requestContext: { [contextKey]: token } });
  const borrowed = makeBorrowedNativeCmsInvocation({ operations: input.operations, lifetime: input.lifetime,
    transactionId: input.transactionId, commands: [commands.create, commands.update, commands.delete],
    authorize: makeNativeReferenceAuthorization(input.access, input.lifetime) });
  const invoke = Effect.fn("PayloadReferenceSave.invokeNative")(function* (method: "create" | "update" | "delete", args: Json) {
    yield* input.lifetime.checkpoint(input.lifetime.context);
    if (!native.isLive() || current !== undefined || !isJsonObject(args) || args.collection !== selected.collection)
      return yield* cmsError("invalidAuthority");
    current = method;
    return yield* borrowed.invoke(commands[method], args).pipe(Effect.ensuring(Effect.sync(() => { current = undefined; })));
  }, Effect.catchCause(cause => Effect.fromResult(input.lifetime.recordFailure(input.lifetime.context, cause)).pipe(
    Effect.flatMap(recorded => Effect.failCause(recorded)))));
  return Object.freeze({ invoke });
});
