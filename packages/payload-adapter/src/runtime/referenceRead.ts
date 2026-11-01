import { Effect, Schema, Scope } from "effect";
import { preparePrivateParticipantReadAccess, PrivateReadPrincipal, PrivateReadIds } from
  "@flarex/persistence-postgres/internal/session-journal";
import type { SessionJournalAttempt } from "@flarex/persistence-postgres/internal/session-journal";
import { cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { LogicalParticipantInvocationError } from "@flarex/persistence-postgres/internal/logical-participant-errors";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "../collections";
import { makePayloadNative, type PayloadNativeInstrumentation } from "./native";
import { makePayloadAttempt } from "./attempt";
import type { PayloadAttemptRuntime } from "../runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { makeBorrowedNativeCmsInvocation, type CmsRequestLifetime, type CoreNativeBindingMetadata,
  type CoreNativeOperations } from "@flarex/persistence-postgres/internal/cms-execution";

const Access = Schema.Struct({ principal: PrivateReadPrincipal, collection: Schema.NonEmptyString, ids: PrivateReadIds,
  participant: Schema.NonEmptyString, nativeProfileRevision: PrivateReadPrincipal.fields.principalDigest });
const decodeAccess = Schema.decodeUnknownEffect(Access, { onExcessProperty: "error" });
const decodeNativeRead = Schema.decodeUnknownEffect(Schema.Struct({ principal: PrivateReadPrincipal,
  collection: Schema.NonEmptyString, ids: PrivateReadIds }), { onExcessProperty: "error" });

/** Selected private finite-read profile. Each instance owns its native access
 * closure; no caller-supplied user/context/overrideAccess reaches Payload. */
export const makePayloadReferenceReadRuntime = Effect.fn("PayloadReferenceRead.makeRuntime")(function* (
  compiled: CompiledPayloadCollections, input: typeof Access.Type,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const access = yield* decodeAccess(input).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const collection = access.collection;
  const principal = Object.freeze({ ...access.principal });
  if (!compiled.configuration.tables.some(table => table.collectionSlug === collection))
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  const ids = new Set(access.ids);
  const grant = yield* preparePrivateParticipantReadAccess({ principal, participant: access.participant,
    nativeProfileRevision: access.nativeProfileRevision, sourceKey: compiled.sourceContract.sourceKey,
    method: "payload-findByID", ids: "native", nativeAccess: { collection, ids: [...ids],
      contentIdentity: compiled.contentIdentity } }).pipe(Effect.mapError(cause =>
        cmsError(cause.kind === "infrastructure" ? "resourceFailure" : "invalidAuthority", cause)));
  const token = Object.freeze({});
  const contextKey = "flarexPrivateReferenceRead";
  let live = true;
  yield* Scope.addFinalizer(yield* Effect.scope, Effect.sync(() => { live = false; }));
  const native = yield* makePayloadNative(compiled, undefined, {
    create: () => false, update: () => false, delete: () => false,
    read: ({ id, req }) => live && req.context[contextKey] === token && typeof id === "string" && ids.has(id),
  });
  const makeAttempt = Effect.fn("PayloadReferenceRead.makeAttempt")(function* (attempt: SessionJournalAttempt) {
    const runtime = yield* makePayloadAttempt(native, attempt, { requestContext: { [contextKey]: token } });
    const borrowParticipant = grant.bind(runtime.borrowParticipant);
    // Select the one admitted collection without replacing native document access.
    const selected: PayloadAttemptRuntime = { borrowParticipant: Effect.fn("PayloadReferenceRead.borrow")(function* (borrowedInput) {
      const borrowed = yield* borrowParticipant(borrowedInput);
      return { ...borrowed, invoke: Effect.fn("PayloadReferenceRead.invoke")(function* (method: string, args: Json) {
        // The input owner still checks the complete native envelope and identity.
        if (!isJsonObject(args) || args.collection !== collection)
          return yield* Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: cmsError("unsupportedProfile") }));
        return yield* borrowed.invoke(method, args);
      }) };
    }) };
    return selected;
  });
  return { makeAttempt, profileRevision: grant.profileRevision };
});

/** A separate source-read selection over the same native root. Save assignment,
 * retention and reverse enumeration permissions never create this selection. */
export const makePayloadNativeReferenceRead = Effect.fn("PayloadReferenceRead.makeNative")(function* (
  compiled: CompiledPayloadCollections,
  input: Readonly<{ operations: CoreNativeOperations; native: CoreNativeBindingMetadata; lifetime: CmsRequestLifetime; transactionId: string;
    principal: PrivateReadPrincipal; collection: string; ids: readonly string[] }>,
  instrumentation?: PayloadNativeInstrumentation,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const selected = yield* decodeNativeRead({ principal: input.principal, collection: input.collection, ids: input.ids })
    .pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const table = compiled.configuration.tables.find(candidate => candidate.collectionSlug === selected.collection);
  if (table === undefined || !input.native.tables.some(candidate => candidate.name === table.logicalTableName)
    || input.native.definition.identity.configSha256 !== compiled.contentIdentity.configSha256
    || input.native.definition.identity.provenanceSha256 !== compiled.contentIdentity.provenanceSha256
    || projectScopeIdUuidV1(selected.principal.scopeId).scopeUuid !== input.native.definition.identity.scopeUuid)
    return yield* cmsError("invalidAuthority");
  const allowed = new Set(selected.ids), token = Object.freeze({}), contextKey = "flarexPrivateReferenceRead";
  const native = yield* makePayloadNative(compiled, instrumentation, { create: () => false, update: () => false, delete: () => false,
    read: ({ id, req }) => !input.lifetime.isClosing() && req.context[contextKey] === token && typeof id === "string" && allowed.has(id) });
  const commands = native.makeCommands({ requestContext: { [contextKey]: token } });
  const borrowed = makeBorrowedNativeCmsInvocation({ operations: input.operations, lifetime: input.lifetime,
    transactionId: input.transactionId, commands: [commands.findByID] });
  const read = Effect.fn("PayloadReferenceRead.readNative")(function* (id: string) {
    if (!allowed.has(id) || !native.isLive()) return yield* cmsError("invalidAuthority");
    return yield* borrowed.invoke(commands.findByID, { collection: selected.collection, id, depth: 0 });
  }, Effect.catchCause(cause => Effect.fromResult(input.lifetime.recordFailure(input.lifetime.context, cause)).pipe(
    Effect.flatMap(recorded => Effect.failCause(recorded)))));
  return Object.freeze({ read });
});
