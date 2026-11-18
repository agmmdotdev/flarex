import { Data, Effect, Schema } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { JsonValue } from "flarex-protocol/json";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { inspectLogicalParticipantAttemptAdmission, inspectLogicalParticipantAdmissionBundle } from "../../storage/documents/logicalDocuments/participantAdmission";
import { LogicalParticipantInvocationError } from "../../storage/documents/logicalDocuments/participantErrors";
import type { LogicalParticipantBorrow } from "./contracts";
import { capturePrivateJsonData } from "../../values/privateJsonData";

/** Trusted composition input, never arguments supplied by an application. */
export const PrivateReadPrincipal = Schema.Struct({ scopeId: ScopeIdSchema,
  principalDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) });
export type PrivateReadPrincipal = typeof PrivateReadPrincipal.Type;
export const MAX_PRIVATE_READ_IDS = 256;
export const PrivateReadIds = Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(MAX_PRIVATE_READ_IDS));
export const PrivateParticipantReadSelectionInput = Schema.Struct({ principal: PrivateReadPrincipal, sourceKey: Schema.NonEmptyString,
  participant: Schema.NonEmptyString, nativeProfileRevision: PrivateReadPrincipal.fields.principalDigest,
  method: Schema.NonEmptyString, ids: Schema.Union([Schema.Literal("native"), PrivateReadIds]),
  nativeAccess: Schema.optionalKey(JsonValue) });
const decodeSelection = Schema.decodeUnknownEffect(PrivateParticipantReadSelectionInput, { onExcessProperty: "error" });
export interface PrivateParticipantReadAccess {
  readonly profileRevision: string;
  readonly bind: (borrow: LogicalParticipantBorrow) => LogicalParticipantBorrow;
}
const issued = new WeakMap<PrivateParticipantReadAccess, typeof PrivateParticipantReadSelectionInput.Type>();
/** Source-private proof inspection. A structural copy is never a read grant. */
export function inspectPrivateParticipantReadAccess(access: PrivateParticipantReadAccess) { return issued.get(access); }

export class PrivateReadAccessError extends Data.TaggedError("PrivateReadAccessError")<{
  readonly reason: "invalidAuthority" | "unavailable";
  readonly cause?: unknown;
}> {}
const refused = (reason: PrivateReadAccessError["reason"], cause?: unknown) => new LogicalParticipantInvocationError({
  kind: "rejection", cause: new PrivateReadAccessError({ reason, ...(cause === undefined ? {} : { cause }) }) });

export interface PrivateParticipantReadSelection { readonly profileRevision: string }
const selections = new WeakMap<PrivateParticipantReadSelection, Readonly<{
  selection: typeof PrivateParticipantReadSelectionInput.Type; canonicalJson: string;
}>>();
/** The same private authority frame is captured by each execution profile. */
export function privateParticipantReadSelectionFrame(selection: typeof PrivateParticipantReadSelectionInput.Type) {
  return { format: "flarex.private-participant-read-access", version: 1, ...selection,
    principal: { ...selection.principal }, ids: selection.ids === "native" ? "native" : [...selection.ids] };
}
export function inspectPrivateParticipantReadSelection(selection: PrivateParticipantReadSelection) { return selections.get(selection); }

/** Pure selected read authority, independent of either transaction engine.
 * Its profile binder must authenticate the actual root and native callback. */
export const preparePrivateParticipantReadSelection = Effect.fn("PrivateReadAccess.prepareSelection")(function* (
  selection: typeof PrivateParticipantReadSelectionInput.Type,
) {
  const decoded = yield* decodeSelection(selection).pipe(Effect.mapError(cause => new PrivateReadAccessError({ reason: "invalidAuthority", cause })));
  const nativeAccess = decoded.nativeAccess === undefined ? undefined : yield* Effect.fromResult(capturePrivateJsonData(decoded.nativeAccess,
    1_048_576, (_reason, cause) => new PrivateReadAccessError({ reason: "invalidAuthority", ...(cause === undefined ? {} : { cause }) })));
  const captured: typeof PrivateParticipantReadSelectionInput.Type = Object.freeze({ ...decoded,
    principal: Object.freeze({ ...decoded.principal }), ids: decoded.ids === "native" ? "native" : Object.freeze([...decoded.ids]),
    ...(nativeAccess === undefined ? {} : { nativeAccess: nativeAccess.value }) });
  if ((captured.ids === "native") !== (captured.nativeAccess !== undefined))
    return yield* new PrivateReadAccessError({ reason: "invalidAuthority" });
  const identity = yield* capturePrivateCanonicalValue(privateParticipantReadSelectionFrame(captured), 1_048_576, {
    invalidInput: () => new PrivateReadAccessError({ reason: "invalidAuthority" }),
    hashFailure: cause => new PrivateReadAccessError({ reason: "unavailable", cause }),
  });
  const access = Object.freeze({ profileRevision: identity.sha256Hex });
  selections.set(access, Object.freeze({ selection: captured, canonicalJson: identity.canonicalJson }));
  return access;
});

/** Binds a selected native read to its genuine attempt principal and source.
 * Native access still owns `native` visibility. An explicit ID selection is a
 * separate target-read grant, never mutation or discovery authority. */
export const preparePrivateParticipantReadAccess = Effect.fn("PrivateReadAccess.prepare")(function* (
  selection: typeof PrivateParticipantReadSelectionInput.Type,
) {
  const accessSelection = yield* preparePrivateParticipantReadSelection(selection).pipe(Effect.mapError(error => error.reason === "unavailable"
    ? new LogicalParticipantInvocationError({ kind: "infrastructure", cause: error.cause })
    : new LogicalParticipantInvocationError({ kind: "rejection", cause: error })));
  const selected = inspectPrivateParticipantReadSelection(accessSelection);
  if (selected === undefined) return yield* Effect.die(new Error("Issued private read selection is missing"));
  const captured = selected.selection;
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
    if (inspectLogicalParticipantAdmissionBundle(input.bundle, input.attempt, participant, method, accessSelection.profileRevision) === null)
      return yield* Effect.fail(refused("invalidAuthority"));
    const borrowed = yield* borrow(input);
    return Object.freeze({ ...borrowed, invoke: Effect.fn("PrivateReadAccess.invoke")(function* (selectedMethod: string, args: Json) {
      if (selectedMethod !== method) return yield* Effect.fail(refused("invalidAuthority"));
      // Membership is an authorization decision, not a native input decoder.
      if (ids !== undefined && (!isJsonObject(args) || typeof args.id !== "string" || !ids.has(args.id)))
        return yield* Effect.fail(refused("unavailable"));
      return yield* borrowed.invoke(selectedMethod, args);
    }) });
  });
  const access = Object.freeze({ profileRevision: accessSelection.profileRevision, bind });
  issued.set(access, captured);
  return access;
});
