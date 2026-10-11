import { Effect, Result } from "effect";
import { copyBytes, bytesEqualFullScan } from "@flarex/utils/bytes";
import { decodeCanonicalAppDocumentEvidenceV1Effect,
  type DecodeCanonicalAppDocumentEvidenceV1Input } from "flarex-protocol/app-document";
import { FlarexValueEvidenceV1Error, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { AppRowReadResultV1, LiveAppRowRevisionV1 } from "./appRows";

interface StoredDocumentEvidence {
  readonly runtime: CanonicalFlarexValueV1["value"];
  readonly policy: CanonicalFlarexValueV1["valueJson"];
  readonly bytes: Uint8Array;
  readonly digest: Uint8Array;
  readonly revisions: WeakSet<AppRowReadResultV1>;
}
const decodedDocuments = new WeakMap<CanonicalFlarexValueV1, StoredDocumentEvidence>();

/** The decoder alone transfers its provenance into an owned detached copy.
 * Protected evidence stays private, including a changed buffer's original
 * expectation: corruption is still reported at the accepting inspection cut.
 * Structural copies and replaced runtime/policy references gain no evidence. */
export function detachStoredAppDocumentEvidence(document: CanonicalFlarexValueV1): CanonicalFlarexValueV1 {
  const detached = structuredClone(document);
  transferStoredDocumentEvidence(document, detached);
  return detached;
}

/** Root ingestion keeps the complete original revision-copy evaluation order. */
export function detachStoredAppRowRevisionEvidence(revision: AppRowReadResultV1, document: CanonicalFlarexValueV1 | null) {
  // The root already observed document at its original guard. Membership tests
  // touch neither foreign frame properties nor Proxy traps before native clone.
  const eligible = document !== null && decodedDocuments.get(document)?.revisions.has(revision) === true;
  const detached = structuredClone(revision);
  if (eligible && document !== null && detached.kind === "live") transferStoredDocumentEvidence(document, detached.document);
  return { revision: detached, sourceDocument: eligible ? document : null };
}

function transferStoredDocumentEvidence(document: CanonicalFlarexValueV1, detached: CanonicalFlarexValueV1): void {
  const evidence = decodedDocuments.get(document);
  if (evidence !== undefined && evidence.runtime === document.value && evidence.policy === document.valueJson)
    decodedDocuments.set(detached, Object.freeze({ ...evidence, runtime: detached.value, policy: detached.valueJson,
      revisions: new WeakSet<AppRowReadResultV1>() }));
}

/** AppRows' actual stored decoder owns this reference provenance. The existing
 * verifier still performs every canonical-byte, SHA and system-field check.
 * Neither a caller-supplied canonical shape nor a registration API can issue it. */
export const decodeStoredAppDocumentEvidenceEffect = (input: DecodeCanonicalAppDocumentEvidenceV1Input) =>
  decodeCanonicalAppDocumentEvidenceV1Effect(input).pipe(Effect.map(document => {
    decodedDocuments.set(document, Object.freeze({ runtime: document.value, policy: document.valueJson,
      bytes: copyBytes(document.canonicalBytes), digest: copyBytes(document.sha256), revisions: new WeakSet<AppRowReadResultV1>() }));
    return document;
  }));

/** The stored decoder constructs and records its own immutable frame. This
 * operation accepts canonical evidence, never a caller-created frame to bless. */
export const decodeStoredAppRowRevisionEvidenceEffect = (
  base: Omit<LiveAppRowRevisionV1, "kind" | "document">,
  input: DecodeCanonicalAppDocumentEvidenceV1Input,
) => decodeStoredAppDocumentEvidenceEffect(input).pipe(Effect.map(document => {
  const revision = Object.freeze({ kind: "live", ...base, document } satisfies LiveAppRowRevisionV1);
  const evidence = decodedDocuments.get(document);
  if (evidence === undefined) throw new Error("Stored document decoder lost its evidence");
  evidence.revisions.add(revision);
  return revision;
}));

/** Verification/reference provenance only. Runtime binary leaves remain mutable;
 * consumers must still establish detached JSON ownership at their real boundary.
 * Protected byte copies never leave this owner. */
export function inspectStoredAppDocumentEvidence(document: CanonicalFlarexValueV1): Result.Result<
  Readonly<{ runtime: CanonicalFlarexValueV1["value"]; policy: CanonicalFlarexValueV1["valueJson"] }> | undefined,
  FlarexValueEvidenceV1Error
> {
  const evidence = decodedDocuments.get(document);
  if (evidence === undefined || evidence.runtime !== document.value || evidence.policy !== document.valueJson)
    return Result.succeed(undefined);
  if (!bytesEqualFullScan(document.canonicalBytes, evidence.bytes))
    return Result.fail(new FlarexValueEvidenceV1Error({ issue: { reason: "canonicalBytesMismatch" } }));
  if (!bytesEqualFullScan(document.sha256, evidence.digest))
    return Result.fail(new FlarexValueEvidenceV1Error({ issue: { reason: "sha256Mismatch" } }));
  return Result.succeed(Object.freeze({ runtime: evidence.runtime, policy: evidence.policy }));
}
