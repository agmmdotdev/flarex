import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import { SESSION_JOURNAL_FORMAT_V1 } from "flarex-protocol/commit-protocol";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionPackageIdV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  decodeCanonicalFlarexValueEvidenceV1,
} from "flarex-protocol/value";

import type {
  PointCommitAttemptScalarCommandV1,
  PointCommitDependencyV1,
  PointCommitFinishingTransitionCommandV1,
  PointCommitRowIntentV1,
  PointCommitTransactionCommandV1,
  PointMutationAttemptReplacementCommandV1,
} from "../src/pointCommitTransaction";
import type {
  StoredAttemptEvidenceAuthorityV1,
  StoredAttemptEvidenceV1,
  StoredAttemptPointEvidenceV1,
} from "../src/storedAttemptEvidence";

export async function pointMutationAttemptReplacementCommandFromStoredAttemptV1(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: StoredAttemptEvidenceV1,
): Promise<PointMutationAttemptReplacementCommandV1> {
  const command = await pointCommitCommandFromStoredAttemptV1(
    authority,
    evidence,
  );
  return Object.freeze({
    authorityPins: command.authorityPins,
    session: command.session,
    sealIdentity: command.sealIdentity,
    dependencies: command.dependencies,
  });
}

export async function pointCommitCommandFromStoredAttemptV1(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: StoredAttemptEvidenceV1,
): Promise<PointCommitTransactionCommandV1> {
  return pointCommitCommandForLifecycleFromStoredAttemptV1(
    authority,
    evidence,
    "finishing",
  );
}

export async function pointCommitFinishingCommandFromStoredAttemptV1(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: StoredAttemptEvidenceV1,
): Promise<PointCommitFinishingTransitionCommandV1> {
  if (authority.executionClaim === undefined) {
    throw new Error("Running test evidence has no execution claim.");
  }
  const scalar = pointCommitScalarCommandForLifecycleFromStoredAttemptV1(
    authority,
    evidence,
    "running",
  );
  return Object.freeze({
    ...scalar,
    executionClaim: Object.freeze({ ...authority.executionClaim }),
    session: Object.freeze({ ...scalar.session, lifecycle: "running" as const }),
    sealIdentity: Object.freeze({
      ...scalar.sealIdentity,
      lifecycle: "running" as const,
    }),
  });
}

async function pointCommitCommandForLifecycleFromStoredAttemptV1(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: StoredAttemptEvidenceV1,
  lifecycle: "running" | "finishing",
): Promise<PointCommitTransactionCommandV1> {
  if (
    evidence.session.lifecycle !== lifecycle ||
    evidence.session.storageGeneration !== "flarexdb_v1" ||
    evidence.session.functionKind !== "mutation"
  ) {
    throw new Error(
      `Point-commit test evidence is not a ${lifecycle} mutation attempt.`,
    );
  }
  const scalar = pointCommitScalarCommandForLifecycleFromStoredAttemptV1(
    authority,
    evidence,
    lifecycle,
  );
  const entries = await Promise.all(evidence.points.map(async (point) => {
    const dependency = pointDependency(point);
    const rowIntent = await pointRowIntent(point, dependency);
    return Object.freeze({ dependency, rowIntent });
  }));
  const dependencies = Object.freeze(
    entries.map((entry) => entry.dependency).sort(compareDependencies),
  );
  const materialIntents = entries.flatMap((entry) =>
    entry.rowIntent === null ? [] : [entry.rowIntent]
  ).sort(compareDependencies);
  return Object.freeze({
    ...scalar,
    dependencies,
    rowIntents: Object.freeze(materialIntents),
  } satisfies PointCommitTransactionCommandV1);
}

function pointCommitScalarCommandForLifecycleFromStoredAttemptV1(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: StoredAttemptEvidenceV1,
  lifecycle: "running" | "finishing",
): PointCommitAttemptScalarCommandV1 {
  if (
    evidence.session.lifecycle !== lifecycle ||
    evidence.session.storageGeneration !== "flarexdb_v1" ||
    evidence.session.functionKind !== "mutation"
  ) {
    throw new Error(
      `Point-commit test evidence is not a ${lifecycle} mutation attempt.`,
    );
  }
  const session = evidence.session;
  const root = evidence.root;
  return Object.freeze({
    authorityPins: Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        authority.deploymentId,
      ),
      scopeId: authority.scopeId,
      sessionId: authority.sessionId,
      attemptFence: authority.attemptFence,
      storageGeneration: authority.storageGeneration,
      storageGenerationFence: authority.storageGenerationFence,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        authority.schemaVersionId,
      ),
      packageId: TransactionPackageIdV1Schema.make(session.packageId),
      artifactRuntime: TransactionArtifactRuntimeV1Schema.make(
        session.artifactRuntime,
      ),
      artifactId: TransactionArtifactIdV1Schema.make(session.artifactId),
      sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
        session.sourcePackageHash,
      ),
      executionModule: TransactionExecutionModuleV1Schema.make(
        session.executionModule,
      ),
      functionPath: TransactionFunctionPathV1Schema.make(
        session.functionPath,
      ),
      functionKind: "mutation",
      policyVersion: TransactionPolicyVersionV1Schema.make(
        session.policyVersion,
      ),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          session.authorizationRevocationEpoch,
        ),
      requestKey: TransactionRequestKeyV1Schema.make(session.requestKey),
    }),
    session: Object.freeze({
      ...session,
      lifecycle,
      authorizationGrantId: TransactionAuthorizationGrantIdV1Schema.make(
        session.authorizationGrantId,
      ),
      identityAccessPolicySha256:
        new Uint8Array(session.identityAccessPolicySha256),
      validatedArgsSha256: new Uint8Array(session.validatedArgsSha256),
      authorizationGrantSha256:
        new Uint8Array(session.authorizationGrantSha256),
      requestSha256: new Uint8Array(session.requestSha256),
    }),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle,
      sessionUpdatedAtMilliseconds: session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: root.updatedAtMilliseconds,
      sealedAtMilliseconds: root.sealedAtMilliseconds,
      finalSyscallSequence: root.sealedFinalSyscallSequence,
      creationTimeSeed: root.creationTimeSeed,
      nextCreationTime: root.nextCreationTime,
      journalFormat: SESSION_JOURNAL_FORMAT_V1,
      journalProtocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      journalValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      journalByteLength: root.journalBytes.byteLength,
      journalSha256: new Uint8Array(root.journalSha256),
      resultValueCodecVersion: root.resultValueCodecVersion,
      resultSemanticBytes: root.resultSemanticBytes,
      resultByteLength: root.resultBytes.byteLength,
      resultSha256: new Uint8Array(root.resultSha256),
      readDocuments: root.readDocuments,
      readSemanticBytes: root.readSemanticBytes,
      pointDependencyCount: root.pointDependencyCount,
      indexedQuerySyscalls: root.indexedQuerySyscalls,
      indexRangeDependencyCount: root.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        root.indexRangeDependencyEvidenceBytes,
      writeOperations: root.writeOperations,
      writeSemanticBytes: root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        root.materialWriteEventEvidenceBytes,
    }),
  });
}

function pointDependency(
  point: StoredAttemptPointEvidenceV1,
): PointCommitDependencyV1 {
  const rowId = appRowIdHexV1FromBytes(point.rowId);
  const documentId = appDocumentIdV1FromRowIdentity({
    tableId: point.tableId,
    rowId,
  });
  const observed = (() => {
    switch (point.dependencyKind) {
      case "present":
        if (point.dependencyRevisionCommitSeq === null) {
          throw new Error("Present point evidence has no revision.");
        }
        return Object.freeze({
          kind: "present" as const,
          revisionCommitSeq: point.dependencyRevisionCommitSeq,
        });
      case "missing_no_visible_revision":
        return Object.freeze({
          kind: "missing" as const,
          basis: Object.freeze({ kind: "noVisibleRevision" as const }),
        });
      case "missing_tombstone":
        if (point.dependencyRevisionCommitSeq === null) {
          throw new Error("Tombstone point evidence has no revision.");
        }
        return Object.freeze({
          kind: "missing" as const,
          basis: Object.freeze({
            kind: "tombstone" as const,
            revisionCommitSeq: point.dependencyRevisionCommitSeq,
          }),
        });
    }
  })();
  return Object.freeze({
    documentId,
    tableId: point.tableId,
    rowId,
    dependency: Object.freeze({
      kind: "appRowPoint",
      documentId,
      observed,
    }),
  });
}

async function pointRowIntent(
  point: StoredAttemptPointEvidenceV1,
  dependency: PointCommitDependencyV1,
): Promise<PointCommitRowIntentV1 | null> {
  switch (point.overlayKind) {
    case "none":
      return null;
    case "deleted":
      if (point.dependencyKind === "missing_no_visible_revision") {
        return null;
      }
      if (point.dependencyKind !== "present") {
        throw new Error("Deleted tombstone evidence is not plannable.");
      }
      return Object.freeze({ ...dependency, kind: "deleted" });
    case "live": {
      if (
        point.overlayCreationTime === null ||
        point.overlayValueBytes === null ||
        point.overlayValueSha256 === null
      ) {
        throw new Error("Live point evidence is incomplete.");
      }
      const document = await decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: point.overlayValueBytes,
        sha256: point.overlayValueSha256,
        profile: "appDocument",
      });
      return Object.freeze({
        ...dependency,
        kind: "live",
        creationTime: point.overlayCreationTime,
        value: document.value,
        canonicalBytes: new Uint8Array(document.canonicalBytes),
        semanticSizeBytes: document.semanticSizeBytes,
      });
    }
  }
}

function compareDependencies(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): number {
  const tableDifference = left.tableId - right.tableId;
  if (tableDifference !== 0) return tableDifference;
  const leftBytes = appRowIdHexV1ToBytes(left.rowId);
  const rightBytes = appRowIdHexV1ToBytes(right.rowId);
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
