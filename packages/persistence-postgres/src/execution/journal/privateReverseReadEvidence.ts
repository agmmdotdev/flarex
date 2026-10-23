import { Effect, Option, Schema } from "effect";
import { AppDocumentIdV1Schema } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { MAX_PRIVATE_READ_IDS, PrivateReadIds, PrivateReadPrincipal } from "./privateReadAccess";
import { PrivatePermissionEvidenceError } from "./privatePermissionEvidence";
import type { SessionJournalAttempt } from "./contracts";

/** Separate protected record contract: existing save-policy bytes retain their meaning. */
export const PrivateReverseReadPermissions = Schema.Struct({
  format: Schema.Literal("flarex.private-reference-read-permissions"), version: Schema.Literal(1),
  principal: PrivateReadPrincipal,
  collection: Schema.NonEmptyString, relation: Schema.NonEmptyString,
  enumerate: PrivateReadIds,
  articles: Schema.Array(AppDocumentIdV1Schema).check(Schema.isMaxLength(MAX_PRIVATE_READ_IDS)),
});
export type PrivateReverseReadPermissions = typeof PrivateReverseReadPermissions.Type;
const Stored = Schema.Struct({ policy: PrivateReverseReadPermissions,
  _id: AppDocumentIdV1Schema, _creationTime: AppCreationTimeV1Schema });
const decodeStored = Schema.decodeUnknownEffect(Stored, { onExcessProperty: "error" });
declare const evidenceBrand: unique symbol;
export interface PrivateReverseReadEvidence { readonly [evidenceBrand]: true }
const facts = new WeakMap<object, Readonly<{ attempt: SessionJournalAttempt; policySha256: string;
  documentId: string; permissions: PrivateReverseReadPermissions; isLive: () => boolean }>>();

/** Source-private issuer, called only by the protected tracked-point reader. */
export const capturePrivateReverseReadEvidence = Effect.fn("PrivateReverseRead.captureEvidence")(function* (
  attempt: SessionJournalAttempt, principal: PrivateReadPrincipal, policySha256: string, documentId: string,
  stored: unknown, isLive: () => boolean,
) {
  if (stored === null) return Option.none<PrivateReverseReadEvidence>();
  const decoded = yield* decodeStored(stored).pipe(Effect.mapError(cause =>
    new PrivatePermissionEvidenceError({ reason: "storedCorruption", cause })));
  if (decoded._id !== documentId || decoded.policy.principal.scopeId !== principal.scopeId ||
    decoded.policy.principal.principalDigest !== principal.principalDigest)
    return yield* Effect.fail(new PrivatePermissionEvidenceError({ reason: "invalidAuthority" }));
  const data = decoded.policy;
  const permissions = Object.freeze({ ...data, principal: Object.freeze({ ...data.principal }),
    enumerate: Object.freeze([...data.enumerate]), articles: Object.freeze([...data.articles]) });
  // SAFETY: only the protected tracked-point issuer registers this attempt-bound token.
  const token = Object.freeze({}) as PrivateReverseReadEvidence;
  facts.set(token, Object.freeze({ attempt, policySha256, documentId, permissions, isLive }));
  return Option.some(token);
});
export function inspectPrivateReverseReadEvidence(token: PrivateReverseReadEvidence,
  attempt: SessionJournalAttempt, principal: PrivateReadPrincipal) {
  const state = facts.get(token);
  return state?.attempt === attempt && state.isLive() && state.permissions.principal.scopeId === principal.scopeId &&
    state.permissions.principal.principalDigest === principal.principalDigest ? Object.freeze({
      policySha256: state.policySha256, documentId: state.documentId, permissions: state.permissions }) : undefined;
}
