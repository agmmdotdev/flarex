import { Effect, Result } from "effect";
import { copyBytes, bytesEqualFullScan } from "@flarex/utils/bytes";
import { decodeCanonicalAppDocumentEvidenceV1Effect,
  type DecodeCanonicalAppDocumentEvidenceV1Input } from "flarex-protocol/app-document";
import { copyCanonicalFlarexValueBytesV1, copyFlarexValueSha256V1,
  FlarexValueEvidenceV1Error, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { createOwnedCanonicalFlarexRuntimeValueReaderV1 } from "flarex-protocol/internal/value-runtime-core";
import type { AppRowReadResultV1, LiveAppRowRevisionV1 } from "./appRows";

interface StoredDocumentEvidence {
  readonly runtime: CanonicalFlarexValueV1["value"];
  readonly policy: CanonicalFlarexValueV1["valueJson"];
  readonly bytes: Uint8Array;
  readonly digest: Uint8Array;
  readonly revisions: WeakSet<AppRowReadResultV1>;
}
const decodedDocuments = new WeakMap<CanonicalFlarexValueV1, StoredDocumentEvidence>();
interface ProtectedDocumentFrame {
  readonly runtime: CanonicalFlarexValueV1["value"];
  readonly policy: CanonicalFlarexValueV1["valueJson"];
  readonly read: () => CanonicalFlarexValueV1["value"];
}
const protectedDocuments = new WeakMap<CanonicalFlarexValueV1, ProtectedDocumentFrame>();

const storedDocumentReferencesMatch = (document: CanonicalFlarexValueV1, evidence: StoredDocumentEvidence): boolean => {
  const protectedFrame = protectedDocuments.get(document);
  return protectedFrame === undefined ? evidence.runtime === document.value && evidence.policy === document.valueJson
    : evidence.runtime === protectedFrame.runtime && evidence.policy === protectedFrame.policy;
};

/** Privately capture an already canonical frame for a retained root. This owns
 * its runtime/policy trees and exposes defensive binary/evidence reads. It does
 * not validate or grant decoder provenance to a foreign canonical structure.
 * Only an already protected frame is idempotent; mutable originals are copied
 * again so subsequent source corruption cannot be hidden by an alias cache. */
export function protectStoredAppDocumentEvidence(document: CanonicalFlarexValueV1): CanonicalFlarexValueV1 {
  if (protectedDocuments.has(document)) return document;
  const detached = detachStoredAppDocumentEvidence(document);
  const runtime = detached.value, policy = detached.valueJson;
  const read = createOwnedCanonicalFlarexRuntimeValueReaderV1(runtime);
  // Canonical policy is plain JSON with no runtime binary leaves. The existing
  // owned-tree reader freezes these newly detached containers without decoding.
  createOwnedCanonicalFlarexRuntimeValueReaderV1(policy);
  const bytes = copyCanonicalFlarexValueBytesV1(detached.canonicalBytes), digest = copyFlarexValueSha256V1(detached.sha256);
  const protectedDocument: CanonicalFlarexValueV1 = Object.freeze({
    profile: detached.profile, codecVersion: detached.codecVersion,
    semanticSizeBytes: detached.semanticSizeBytes, nestingDepth: detached.nestingDepth,
    canonicalText: detached.canonicalText, valueJson: policy,
    get value() { return read(); },
    get canonicalBytes() { return copyCanonicalFlarexValueBytesV1(bytes); },
    get sha256() { return copyFlarexValueSha256V1(digest); },
  });
  protectedDocuments.set(protectedDocument, Object.freeze({ runtime, policy, read }));
  const evidence = decodedDocuments.get(detached);
  if (evidence !== undefined) decodedDocuments.set(protectedDocument, Object.freeze({ ...evidence,
    runtime, policy, revisions: new WeakSet<AppRowReadResultV1>() }));
  return protectedDocument;
}

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
  if (evidence !== undefined && storedDocumentReferencesMatch(document, evidence))
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
  if (evidence === undefined || !storedDocumentReferencesMatch(document, evidence))
    return Result.succeed(undefined);
  if (!bytesEqualFullScan(document.canonicalBytes, evidence.bytes))
    return Result.fail(new FlarexValueEvidenceV1Error({ issue: { reason: "canonicalBytesMismatch" } }));
  if (!bytesEqualFullScan(document.sha256, evidence.digest))
    return Result.fail(new FlarexValueEvidenceV1Error({ issue: { reason: "sha256Mismatch" } }));
  const protectedFrame = protectedDocuments.get(document);
  return Result.succeed(Object.freeze({ runtime: protectedFrame === undefined ? evidence.runtime : protectedFrame.read(), policy: evidence.policy }));
}
