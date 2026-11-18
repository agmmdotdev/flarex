import { Data, Effect, Option, Schema } from "effect";
import { AppDocumentIdV1Schema } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { PrivateReadIds, PrivateReadPrincipal } from "./privateReadAccess";
import type { SessionJournalAttempt } from "./contracts";

/** Closed private policy data, independent of discovery or target-read grants. */
export const PrivateReferencePermissions = Schema.Struct({
  format: Schema.Literal("flarex.private-reference-permissions"), version: Schema.Literal(1),
  principal: PrivateReadPrincipal,
  collection: Schema.NonEmptyString, relation: Schema.NonEmptyString,
  source: Schema.Struct({ create: Schema.Boolean, update: Schema.Boolean, delete: Schema.Boolean }),
  assign: PrivateReadIds, retain: PrivateReadIds,
});
export type PrivateReferencePermissions = typeof PrivateReferencePermissions.Type;
const Stored = Schema.Struct({ policy: PrivateReferencePermissions,
  _id: AppDocumentIdV1Schema, _creationTime: AppCreationTimeV1Schema });
const decodeStored = Schema.decodeUnknownEffect(Stored, { onExcessProperty: "error" });
export class PrivatePermissionEvidenceError extends Data.TaggedError("PrivatePermissionEvidenceError")<{
  readonly reason: "invalidAuthority" | "storedCorruption"; readonly cause?: unknown;
}> {}
declare const evidenceBrand: unique symbol;
export interface PrivateReferencePermissionEvidence { readonly [evidenceBrand]: true }
const evidence = new WeakMap<object, Readonly<{ attempt: SessionJournalAttempt; policySha256: string;
  documentId: string; permissions: PrivateReferencePermissions; isLive: () => boolean }>>();

/** Source-private issuer: called only after a genuine protected-table point read. */
export const capturePrivateReferencePermissionEvidence = Effect.fn("PrivatePermissions.capture")(function* (
  attempt: SessionJournalAttempt, principal: PrivateReadPrincipal, policySha256: string, documentId: string, stored: unknown,
  isLive: () => boolean,
) {
  if (stored === null) return Option.none<PrivateReferencePermissionEvidence>();
  const decoded = yield* decodeStored(stored).pipe(Effect.mapError(cause =>
    new PrivatePermissionEvidenceError({ reason: "storedCorruption", cause })));
  if (decoded._id !== documentId || decoded.policy.principal.scopeId !== principal.scopeId ||
    decoded.policy.principal.principalDigest !== principal.principalDigest)
    return yield* Effect.fail(new PrivatePermissionEvidenceError({ reason: "invalidAuthority" }));
  const data = decoded.policy;
  const permissions = Object.freeze({ ...data, principal: Object.freeze({ ...data.principal }),
    source: Object.freeze({ ...data.source }), assign: Object.freeze([...data.assign]), retain: Object.freeze([...data.retain]) });
  // SAFETY: only this point-read issuer registers the opaque, attempt-bound fact.
  const token = Object.freeze({}) as PrivateReferencePermissionEvidence;
  evidence.set(token, Object.freeze({ attempt, policySha256, documentId, permissions, isLive }));
  return Option.some(token);
});
export function inspectPrivateReferencePermissionEvidence(token: PrivateReferencePermissionEvidence,
  attempt: SessionJournalAttempt, principal: PrivateReadPrincipal) {
  const state = evidence.get(token);
  return state?.attempt === attempt && state.isLive() && state.permissions.principal.scopeId === principal.scopeId &&
    state.permissions.principal.principalDigest === principal.principalDigest ? Object.freeze({
      policySha256: state.policySha256, documentId: state.documentId, permissions: state.permissions }) : undefined;
}
