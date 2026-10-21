import { Effect, Schema, Scope } from "effect";
import { preparePrivateParticipantReadAccess, PrivateReadPrincipal, PrivateReadIds } from
  "@flarex/persistence-postgres/internal/session-journal";
import type { SessionJournalAttempt } from "@flarex/persistence-postgres/internal/session-journal";
import { cmsError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { LogicalParticipantInvocationError } from "@flarex/persistence-postgres/internal/logical-participant-errors";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "../collections";
import { makePayloadNative } from "./native";
import { makePayloadAttempt } from "./attempt";
import type { PayloadAttemptRuntime } from "../runtime";

const Access = Schema.Struct({ principal: PrivateReadPrincipal, collection: Schema.NonEmptyString, ids: PrivateReadIds,
  participant: Schema.NonEmptyString, nativeProfileRevision: PrivateReadPrincipal.fields.principalDigest });
const decodeAccess = Schema.decodeUnknownEffect(Access, { onExcessProperty: "error" });

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
