import { fxSystemApplicationAnalysesV1, fxSystemApplicationRevisionsV2 } from "../../database/schema";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import {
  lockScopeClockForSnapshotReadInTransactionEffect,
  type LockScopeClockForUpdateError,
  lockScopeClockForUpdateInTransactionEffect,
} from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  readApplicationActiveHeadForShareInTransactionEffect,
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
} from "../applicationActiveHeadRead";
import { validateStoredApplicationReadinessForActivationInTransaction } from "../readiness/acceptance";
import type { ApplicationReadinessResult } from "../readiness/contracts";
import {
  type ApplicationRelationReadinessFoldRepository,
  type ApplicationRelationReadinessFoldResult,
  validateActiveApplicationRelationReadinessInTransaction,
} from "../relations/applicationRelationReadinessFold";
import type { ValidatedActivation } from "./activationPersistence";
import { headMatchesValidatedReadiness } from "./capture";
import { query, sha256 } from "./databaseBoundary";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import { activeHeadFailure, type DecodedHead } from "./headCapture";
import { UTF8_FATAL, validIdentity } from "./limits";
import { clockMatches, copyRelationSelectionBasis, copySelectionBasis } from "./selectionIdentity";
import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";

export const readActiveLegacyInTransaction = Effect.fn(
  "ApplicationActivation.readLegacyTransaction",
)(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
) {
  const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure("read", "scopeAuthority");
  }
  const validated = yield* validateStoredApplicationReadinessForActivationInTransaction(
    readinessRepository,
    readiness,
    tx,
    clock,
  );
  const active = yield* readValidatedActiveInTransaction(
    tx,
    Object.freeze({ kind: "legacy", basis: validated.basis }),
  );
  return Object.freeze({
    expectedActiveHead: active.expectedActiveHead,
    basis: copySelectionBasis(Object.freeze({
      ...validated.basis,
      activationSequence: active.head.activationSequence,
      activationSha256: copyBytes(active.head.activationSha256),
      headSha256: copyBytes(active.head.headSha256),
    })),
  });
});

export const readActiveRelationInTransaction = Effect.fn(
  "ApplicationActivation.readRelationTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
) {
  const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure("read", "scopeAuthority");
  }
  const validated = yield*
    validateActiveApplicationRelationReadinessInTransaction(
      readinessRepository,
      readiness,
      tx,
      clock,
    );
  const active = yield* readValidatedActiveInTransaction(
    tx,
    Object.freeze({ kind: "relation", basis: validated.basis }),
  );
  return Object.freeze({
    expectedActiveHead: active.expectedActiveHead,
    basis: copyRelationSelectionBasis(Object.freeze({
      ...validated.basis,
      activationSequence: active.head.activationSequence,
      activationSha256: copyBytes(active.head.activationSha256),
      headSha256: copyBytes(active.head.headSha256),
    })),
  });
});

export const readValidatedActiveInTransaction = Effect.fn(
  "ApplicationActivation.readValidatedActiveInTransaction",
)(function* (
  tx: AppRowTransaction,
  validated: ValidatedActivation,
) {
  const basis = validated.basis;
  const active = yield*
    readCoherentApplicationActiveHeadForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    ).pipe(Effect.mapError(error => activeHeadFailure(
      "read",
      error,
      basis.revisionId,
    )));
  if (active === null) {
    return yield* activationFailure("read", "activeMissing", basis.revisionId);
  }
  if (!headMatchesValidatedReadiness(active.head, validated)) {
    return yield* activationFailure(
      "read",
      "concurrentHead",
      basis.revisionId,
    );
  }
  const expectedActiveHead = Object.freeze({
    activationSequence: active.head.activationSequence,
    headSha256: encodeBytesToLowercaseHex(active.head.headSha256),
  });
  return Object.freeze({ expectedActiveHead, head: active.head });
});

export const loadRevisionReadinessKindInTransaction = Effect.fn(
  "ApplicationActivation.loadRevisionReadinessKindInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  revisionId: string,
): Effect.fn.Return<
  DecodedHead["readinessKind"],
  ApplicationActivationError | LockScopeClockForUpdateError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      revisionId,
    );
  }
  const revisionRows = yield* query(
    tx.select().from(fxSystemApplicationRevisionsV2).where(and(
      eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId, revisionId),
    )).limit(2).for("share"),
    "activate",
    revisionId,
  );
  const revision = revisionRows[0];
  if (revision === undefined) {
    return yield* activationFailure("activate", "notReady", revisionId);
  }
  if (revisionRows.length !== 1 || revision.scopeId !== authority.scopeId ||
    revision.revisionId !== revisionId || revision.status !== "inactive" ||
    revision.analysisStatus !== "analyzed" ||
    !validIdentity(revision.candidateId) ||
    !validIdentity(revision.analysisId) ||
    !isUint8ArrayWithByteLength(revision.sourceArtifactRootSha256, 32) ||
    !isUint8ArrayWithByteLength(revision.manifestSha256, 32)) {
    return yield* activationFailure(
      "activate",
      "storedState",
      revisionId,
    );
  }
  const analysisRows = yield* query(
    tx.select().from(fxSystemApplicationAnalysesV1).where(and(
      eq(fxSystemApplicationAnalysesV1.scopeId, authority.scopeId),
      eq(fxSystemApplicationAnalysesV1.analysisId, revision.analysisId),
    )).limit(2).for("share"),
    "activate",
    revisionId,
  );
  const analysis = analysisRows[0];
  if (analysisRows.length !== 1 || analysis === undefined ||
    analysis.scopeId !== revision.scopeId ||
    analysis.candidateId !== revision.candidateId ||
    analysis.analysisId !== revision.analysisId ||
    analysis.status !== "analyzed" || analysis.manifestBytes === null ||
    analysis.manifestSha256 === null ||
    analysis.manifestBytes.byteLength < 1 ||
    analysis.manifestBytes.byteLength > 16_777_216 ||
    !isUint8ArrayWithByteLength(analysis.manifestSha256, 32) ||
    !bytesEqualFullScan(
      analysis.sourceArtifactRootSha256,
      revision.sourceArtifactRootSha256,
    ) || !bytesEqualFullScan(
      analysis.manifestSha256,
      revision.manifestSha256,
    )) {
    return yield* activationFailure(
      "activate",
      "storedState",
      revisionId,
    );
  }
  const manifestBytes = analysis.manifestBytes;
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(manifestBytes)),
    catch: cause => activationError(
      "activate",
      "storedState",
      revisionId,
      false,
      cause,
    ),
  });
  const canonical = yield* Effect.fromResult(
    canonicalizeApplicationManifest(parsed).pipe(Result.mapError(cause =>
      activationError(
        "activate",
        "storedState",
        revisionId,
        false,
        cause,
      )
    )),
  );
  if (!bytesEqualFullScan(canonical.canonicalBytes, manifestBytes) ||
    !bytesEqualFullScan(
      yield* sha256(canonical.canonicalBytes),
      revision.manifestSha256,
    )) {
    return yield* activationFailure(
      "activate",
      "storedState",
      revisionId,
    );
  }
  switch (canonical.manifest.version) {
    case 1: return "legacy";
    case 2: return "relation";
    case 3: return "relation";
  }
});

export const loadActiveRevisionHint = Effect.fn("ApplicationActivation.loadHeadHint")(
function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  expectedKind?: DecodedHead["readinessKind"],
) {
  const head = yield* readApplicationActiveHeadForShareInTransactionEffect(
    tx,
    scopeId,
  ).pipe(Effect.mapError(error => activeHeadFailure("read", error)));
  if (head === null ||
    (expectedKind !== undefined && head.readinessKind !== expectedKind) ||
    !validIdentity(head.revisionId)) {
    return yield* activationFailure("read", "activeMissing");
  }
  return Object.freeze({
    revisionId: head.revisionId,
    readinessKind: head.readinessKind,
  });
});