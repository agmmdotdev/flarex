import { Data, Effect, Schema } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { JsonValue } from "flarex-protocol/json";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { inspectLogicalParticipantAttemptAdmission, inspectLogicalParticipantAdmissionBundle } from "../../storage/documents/logicalDocuments/participantAdmission";
import { LogicalParticipantInvocationError } from "../../storage/documents/logicalDocuments/participantErrors";
import type { LogicalParticipantBorrow } from "./contracts";

/** Trusted composition input, never arguments supplied by an application. */
export const PrivateReadPrincipal = Schema.Struct({ scopeId: ScopeIdSchema,
  principalDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) });
export type PrivateReadPrincipal = typeof PrivateReadPrincipal.Type;
export const PrivateReadIds = Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(256));
const Selection = Schema.Struct({ principal: PrivateReadPrincipal, sourceKey: Schema.NonEmptyString,
  participant: Schema.NonEmptyString, nativeProfileRevision: PrivateReadPrincipal.fields.principalDigest,
  method: Schema.NonEmptyString, ids: Schema.Union([Schema.Literal("native"), PrivateReadIds]),
  nativeAccess: Schema.optionalKey(JsonValue) });
const decodeSelection = Schema.decodeUnknownEffect(Selection, { onExcessProperty: "error" });

export class PrivateReadAccessError extends Data.TaggedError("PrivateReadAccessError")<{
  readonly reason: "invalidAuthority" | "unavailable";
  readonly cause?: unknown;
}> {}
const refused = (reason: PrivateReadAccessError["reason"], cause?: unknown) => new LogicalParticipantInvocationError({
  kind: "rejection", cause: new PrivateReadAccessError({ reason, ...(cause === undefined ? {} : { cause }) }) });

/** Binds a selected native read to its genuine attempt principal and source.
 * Native access still owns `native` visibility. An explicit ID selection is a
 * separate target-read grant, never mutation or discovery authority. */
export const preparePrivateParticipantReadAccess = Effect.fn("PrivateReadAccess.prepare")(function* (
  selection: typeof Selection.Type,
) {
  const captured = yield* decodeSelection(selection).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
  if ((captured.ids === "native") !== (captured.nativeAccess !== undefined))
    return yield* Effect.fail(refused("invalidAuthority"));
  const identity = yield* capturePrivateCanonicalValue({ format: "flarex.private-participant-read-access", version: 1,
    ...captured }, 1_048_576, { invalidInput: () => refused("invalidAuthority"), hashFailure: cause =>
      new LogicalParticipantInvocationError({ kind: "infrastructure", cause }) });
  const { scopeId, principalDigest } = captured.principal;
  const { sourceKey, participant, method } = captured;
  const ids = captured.ids === "native" ? undefined : new Set(captured.ids);
  const bind = (borrow: LogicalParticipantBorrow): LogicalParticipantBorrow => Effect.fn("PrivateReadAccess.borrow")(function* (input) {
    const admission = input.admissions[0];
    const state = admission === undefined || input.admissions.length !== 1 ? null :
      inspectLogicalParticipantAttemptAdmission(admission, input.attempt, input.method);
    if (state === null || state.root.executionProfile !== "finiteRoot" || state.root.scopeId !== scopeId ||
      state.root.principalDigest !== principalDigest || state.sourceKey !== sourceKey || input.method !== method)
      return yield* Effect.fail(refused("invalidAuthority"));
    if (inspectLogicalParticipantAdmissionBundle(input.bundle, input.attempt, participant, method, identity.sha256Hex) === null)
      return yield* Effect.fail(refused("invalidAuthority"));
    const borrowed = yield* borrow(input);
    return Object.freeze({ ...borrowed, invoke: Effect.fn("PrivateReadAccess.invoke")(function* (selected: string, args: Json) {
      if (selected !== method) return yield* Effect.fail(refused("invalidAuthority"));
      // Membership is an authorization decision, not a native input decoder.
      if (ids !== undefined && (!isJsonObject(args) || typeof args.id !== "string" || !ids.has(args.id)))
        return yield* Effect.fail(refused("unavailable"));
      return yield* borrowed.invoke(selected, args);
    }) });
  });
  return Object.freeze({ profileRevision: identity.sha256Hex, bind });
});
