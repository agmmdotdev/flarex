import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { Effect, Result, Schema } from "effect";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  encodeCanonicalJson,
  JsonValue,
  isJsonObject,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  CanonicalSchemaManifestBytesSchema,
  CatalogSchemaVersionIdSchema,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  SchemaManifestCodecVersionSchema,
  SchemaManifestJsonSchema,
  SchemaManifestSha256Schema,
  canonicalizeSchemaManifestV1,
  decodeSchemaManifestAppSchemaV1Result,
  type CanonicalSchemaManifestBytes,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestCodecVersion,
  type SchemaManifestJson,
  type SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionSessionIdV1Schema,
  storedTransactionSessionScalarsEqualV1,
  type TransactionAttemptFence,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import { snapshotSchemaManifestValue } from "../schemaManifestValueSnapshot";
import {
  applicationActivationFrameBytes,
  applicationActiveHeadFrameBytes,
  applicationColdReceiptSetFrameBytes,
  applicationSchemaBindingFrameBytes,
  decodeApplicationReadinessFrame,
  sha256 as sha256ApplicationFrame,
  validateCanonicalFrame,
} from "../applicationAuthorityFrames";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { snapshotApplicationExecutionAuthorityJson } from
  "../applicationExecutionAuthoritySnapshot";
import {
  decodeScopeClockRecordResult,
  type ScopeClockRecord,
} from "../scopeClock";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
} from "../transactionSessionAttemptFacet";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
} from "../transactionExecutionClaimModel";
import {
  occExecutionAuthorityMismatch,
  occExecutionCorrupt,
  type StoredOccExecutionEvidenceAuthorityV1,
  type StoredOccExecutionEvidenceLoadResultV1,
  type StoredOccExecutionEvidenceV1,
} from "../storedOccExecution/model";
import {
  authorityMismatch,
  corrupt,
  type StoredCommitAuthorityCaptureAuthorityV1,
  type StoredCommitAuthorityCorruptionReasonV1,
  type StoredCommitAuthorityEvidenceV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceLoadResultV1,
  StoredCommitAuthorityEvidencePersistenceV1Error,
  type StoredCommitAuthoritySealIdentityV1,
  type StoredCommitAuthoritySessionScalarsV1,
} from "./model";

type SessionRow =
  typeof import("../schema").fxSystemTransactionSessions.$inferSelect;
type LeaseRow =
  typeof import("../schema").fxSystemSnapshotLeases.$inferSelect;
type RootRow =
  typeof import("../schema").fxSystemTransactionJournals.$inferSelect;
type ExecutionClaimRow =
  typeof import("../schema").fxSystemTransactionExecutionClaims.$inferSelect;
type SchemaRow =
  typeof import("../schema").fxControlSchemaVersions.$inferSelect;
type ApplicationActivationRow =
  typeof import("../schema").fxSystemApplicationActivationsV1.$inferSelect;
type ApplicationReadinessRow =
  typeof import("../schema").fxSystemApplicationReadinessV1.$inferSelect;
type ApplicationRevisionRow =
  typeof import("../schema").fxSystemApplicationRevisionsV2.$inferSelect;
type ApplicationAnalysisRow =
  typeof import("../schema").fxSystemApplicationAnalysesV1.$inferSelect;
type ApplicationPublicationRow =
  typeof import("../schema").fxSystemApplicationPublicationsV1.$inferSelect;
type ApplicationFunctionRow =
  typeof import("../schema").fxSystemApplicationFunctionsV1.$inferSelect;
type ApplicationRevisionSchemaRow =
  typeof import("../schema").fxSystemApplicationRevisionSchemasV1.$inferSelect;
type ApplicationSchemaAuthorityRow =
  typeof import("../schema").fxControlApplicationSchemaAuthoritiesV1.$inferSelect;
export type ClockRow =
  typeof import("../schema").fxSystemScopeClocks.$inferSelect;

export interface SessionSizeRow extends Omit<
  SessionRow,
  | "validatedArgsJson"
  | "validatedArgsCanonicalBytes"
  | "authorizationGrantJson"
  | "authorizationGrantCanonicalBytes"
  | "applicationExecutionAuthorityJson"
  | "applicationExecutionAuthorityCanonicalBytes"
> {
  readonly validatedArgsJsonByteLengthText: string;
  readonly validatedArgsCanonicalByteLengthText: string;
  readonly authorizationGrantJsonByteLengthText: string;
  readonly authorizationGrantCanonicalByteLengthText: string;
  readonly applicationExecutionAuthorityFormat: string | null;
  readonly applicationExecutionAuthorityVersionText: string | null;
  readonly applicationExecutionAuthorityActivationSequence: string | null;
  readonly applicationExecutionAuthorityRevisionId: string | null;
  readonly applicationExecutionAuthorityFunctionPath: string | null;
  readonly applicationExecutionAuthoritySchemaSha256: string | null;
  readonly applicationExecutionAuthorityJsonByteLengthText: string | null;
  readonly applicationExecutionAuthorityCanonicalByteLengthText: string | null;
}

export interface SessionPayloadRow {
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly validatedArgsJsonText: string;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly authorizationGrantJsonText: string;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
  readonly applicationExecutionAuthorityJsonText: string | null;
  readonly applicationExecutionAuthorityCanonicalBytes: Uint8Array | null;
}

export interface SchemaPayloadRow extends Omit<
  SchemaRow,
  "manifestJson" | "manifestBytes" | "manifestSha256"
> {
  readonly manifestJsonText: string;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Uint8Array;
}

export interface SchemaSizeRow extends Omit<
  SchemaRow,
  "manifestJson" | "manifestBytes"
> {
  readonly manifestJsonByteLengthText: string;
  readonly manifestCanonicalByteLengthText: string;
}

export interface AttemptChildExistenceRow {
  readonly receiptExists: boolean;
  readonly pointExists: boolean;
  readonly indexRangeExists: boolean;
  readonly eventExists: boolean;
}

export interface ApplicationGraphSizeRow {
  readonly activationByteLengthText: string;
  readonly readinessByteLengthText: string;
  readonly manifestByteLengthText: string;
  readonly schemaByteLengthText: string;
  readonly functionCatalogByteLengthText: string;
  readonly functionEntryByteLengthText: string;
  readonly schemaBindingByteLengthText: string;
}

export interface ApplicationGraphPayloadRow {
  readonly activation: ApplicationActivationRow;
  readonly readiness: ApplicationReadinessRow;
  readonly revision: ApplicationRevisionRow;
  readonly analysis: ApplicationAnalysisRow;
  readonly publication: ApplicationPublicationRow;
  readonly selectedFunction: ApplicationFunctionRow;
  readonly revisionSchema: ApplicationRevisionSchemaRow;
  readonly schemaAuthority: ApplicationSchemaAuthorityRow;
}

interface BindingRow {
  readonly ordinalText: string;
  readonly declaredTableIdText: string | null;
  readonly stableTableIdText: string | null;
}

export interface CapturedRowsV1 {
  readonly clockRows: ReadonlyArray<ClockRow>;
  readonly databaseNowText: string | undefined;
  readonly sessionSizeRows: ReadonlyArray<SessionSizeRow>;
  readonly leaseRows: ReadonlyArray<LeaseRow>;
  readonly rootRows: ReadonlyArray<RootScalarRow>;
  readonly executionClaimRows: ReadonlyArray<ExecutionClaimRow>;
  readonly attemptChildRows: ReadonlyArray<AttemptChildExistenceRow>;
  readonly schemaSizeRows: ReadonlyArray<SchemaSizeRow>;
  readonly applicationGraphSizeRows: ReadonlyArray<ApplicationGraphSizeRow>;
  readonly skipReason?: StoredCommitAuthorityCorruptionReasonV1;
  readonly sessionPayloadRows: ReadonlyArray<SessionPayloadRow>;
  readonly schemaPayloadRows: ReadonlyArray<SchemaPayloadRow>;
  readonly applicationGraphPayloadRows:
    ReadonlyArray<ApplicationGraphPayloadRow>;
  readonly bindingRows: ReadonlyArray<unknown>;
}

export interface StoredCommitAuthorityMaterializationOptionsV1 {
  /** Test-only: runs immediately before schema evidence decoding. */
  readonly beforeSchemaArtifactDecode?: () => void | Promise<void>;
}

export interface RootScalarRow extends Omit<
  RootRow,
  "sealedJournalBytes" | "sealedResultBytes"
> {
  readonly sealedJournalByteLengthText: string | null;
  readonly sealedResultByteLengthText: string | null;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const decodeCanonicalSchemaManifestBytesResult = Schema.decodeUnknownResult(
  Schema.toType(CanonicalSchemaManifestBytesSchema),
);
const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeSchemaManifestCodecVersionResult = Schema.decodeUnknownResult(
  Schema.toType(SchemaManifestCodecVersionSchema),
);
const decodeSchemaManifestJsonTextResult = Schema.decodeUnknownResult(
  Schema.fromJsonString(SchemaManifestJsonSchema),
);
const decodeSchemaManifestSha256Result = Schema.decodeUnknownResult(
  Schema.toType(SchemaManifestSha256Schema),
);
const decodeStoredJsonTextResult = Schema.decodeUnknownResult(
  Schema.fromJsonString(JsonValue),
);
const decodeScopeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodeScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);
const decodeStorageGenerationFenceResult = Schema.decodeUnknownResult(
  Schema.toType(StorageGenerationFenceSchema),
);
const decodeTransactionAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);
const decodeTransactionAuthorizationRevocationEpochResult =
  Schema.decodeUnknownResult(
    Schema.toType(TransactionAuthorizationRevocationEpochSchema),
  );
const decodeTransactionSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);

type SealedCommitAuthorityMaterializationV1 = Readonly<{
  readonly kind: "sealed";
  readonly expected: StoredCommitAuthorityEvidenceAuthorityV1;
}>;

type OpenOccExecutionMaterializationV1 = Readonly<{
  readonly kind: "openOccExecution";
  readonly expected: StoredOccExecutionEvidenceAuthorityV1;
}>;

type StoredAuthorityMaterializationV1 =
  | SealedCommitAuthorityMaterializationV1
  | OpenOccExecutionMaterializationV1;

export const materializeEffect = Effect.fn("StoredCommitAuthority.materialize")(
  function* (
    expected: StoredCommitAuthorityEvidenceAuthorityV1,
    preliminary: TrustedScopeAuthority,
    captured: CapturedRowsV1,
    options: StoredCommitAuthorityMaterializationOptionsV1 = {},
  ): Effect.fn.Return<
    StoredCommitAuthorityEvidenceLoadResultV1,
    StoredCommitAuthorityEvidencePersistenceV1Error
  > {
    return yield* materializeStoredAuthorityEffect(
      Object.freeze({ kind: "sealed", expected }),
      preliminary,
      captured,
      options,
    );
  },
);

export const materializeOpenOccExecutionEffect = Effect.fn(
  "StoredOccExecution.materialize",
)(function* (
  expected: StoredOccExecutionEvidenceAuthorityV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedRowsV1,
  options: StoredCommitAuthorityMaterializationOptionsV1 = {},
): Effect.fn.Return<
  StoredOccExecutionEvidenceLoadResultV1,
  StoredCommitAuthorityEvidencePersistenceV1Error
> {
  return yield* materializeStoredAuthorityEffect(
    Object.freeze({ kind: "openOccExecution", expected }),
    preliminary,
    captured,
    options,
  );
});

function materializeStoredAuthorityEffect(
  mode: SealedCommitAuthorityMaterializationV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedRowsV1,
  options?: StoredCommitAuthorityMaterializationOptionsV1,
): Effect.Effect<
  StoredCommitAuthorityEvidenceLoadResultV1,
  StoredCommitAuthorityEvidencePersistenceV1Error
>;
function materializeStoredAuthorityEffect(
  mode: OpenOccExecutionMaterializationV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedRowsV1,
  options?: StoredCommitAuthorityMaterializationOptionsV1,
): Effect.Effect<
  StoredOccExecutionEvidenceLoadResultV1,
  StoredCommitAuthorityEvidencePersistenceV1Error
>;
function materializeStoredAuthorityEffect(
  mode: StoredAuthorityMaterializationV1,
  preliminary: TrustedScopeAuthority,
  captured: CapturedRowsV1,
  options: StoredCommitAuthorityMaterializationOptionsV1 = {},
): Effect.Effect<
  | StoredCommitAuthorityEvidenceLoadResultV1
  | StoredOccExecutionEvidenceLoadResultV1,
  StoredCommitAuthorityEvidencePersistenceV1Error
> {
  return Effect.gen(function* () {
    const expected = mode.expected;
    // Preserve C04B1's established size/corruption precedence. O08-B2a may
    // still observe a committed lifecycle first so it can close through O07-A
    // without materializing execution evidence.
    if (mode.kind === "sealed" && captured.skipReason !== undefined) {
      return corrupt(captured.skipReason);
    }
    if (captured.clockRows.length !== 1) {
      return materializationCorrupt(mode, "authorityProjectionInvalid");
    }
    const clockRow = captured.clockRows[0];
    if (clockRow === undefined) {
      return materializationCorrupt(mode, "authorityProjectionInvalid");
    }
    const clockAuthority = decodeOrMaterializationCorrupt(
      mode,
      decodeClockAuthorityResult(clockRow),
    );
    if ("corrupt" in clockAuthority) return clockAuthority.corrupt;
    const { clock, scopeUuid, epochUuid, revocationEpoch } =
      clockAuthority.value;
    if (
      scopeUuid !== projectScopeIdUuidV1(expected.scopeId).scopeUuid ||
      epochUuid !== projectScopeEpochUuidV1(clock.epoch).epochUuid ||
      clock.scopeId !== expected.scopeId ||
      preliminary.scopeId !== expected.scopeId
    ) {
      return materializationAuthorityMismatch(mode, "scopeChanged");
    }
    if (
      mode.kind === "openOccExecution" &&
      scopeUuid !== mode.expected.scopeUuid
    ) {
      return occExecutionAuthorityMismatch("scopeChanged");
    }
    if (
      clock.storageGeneration !== expected.storageGeneration ||
      clock.storageGenerationFence !== expected.storageGenerationFence ||
      preliminary.storageGeneration !== expected.storageGeneration ||
      preliminary.storageGenerationFence !== expected.storageGenerationFence
    ) {
      return materializationAuthorityMismatch(mode, "generationChanged");
    }
    if (
      clock.epoch !== expected.snapshotToken.epoch ||
      preliminary.epoch !== expected.snapshotToken.epoch
    ) {
      return materializationAuthorityMismatch(mode, "epochChanged");
    }
    const databaseNowMilliseconds = decodeDatabaseNow(captured.databaseNowText);
    if (databaseNowMilliseconds === undefined) {
      return materializationCorrupt(mode, "databaseClockInvalid");
    }

    if (captured.sessionSizeRows.length === 0) {
      return materializationAuthorityMismatch(mode, "attemptMissing");
    }
    if (captured.sessionSizeRows.length !== 1) {
      return materializationCorrupt(mode, "sessionEvidenceMissingOrDuplicate");
    }
    const session = captured.sessionSizeRows[0];
    if (session === undefined) {
      return materializationCorrupt(mode, "sessionEvidenceMissingOrDuplicate");
    }
    const sessionIdentity = decodeOrMaterializationCorrupt(
      mode,
      decodeSessionIdentityResult(session),
    );
    if ("corrupt" in sessionIdentity) return sessionIdentity.corrupt;
    const decodedSessionIdentity = sessionIdentity.value;
    if (
      session.scopeUuid !== scopeUuid ||
      decodedSessionIdentity.sessionId !== expected.sessionId
    ) {
      return materializationAuthorityMismatch(mode, "attemptMissing");
    }
    if (decodedSessionIdentity.attemptFence !== expected.attemptFence) {
      return materializationAuthorityMismatch(mode, "attemptReplaced");
    }
    if (
      session.storageGeneration !== expected.storageGeneration ||
      decodedSessionIdentity.storageGenerationFence !==
        expected.storageGenerationFence
    ) {
      return materializationAuthorityMismatch(mode, "generationChanged");
    }
    if (session.schemaVersionId !== expected.schemaVersionId) {
      return materializationAuthorityMismatch(mode, "schemaChanged");
    }
    if (session.authorizationRevocationEpoch !== revocationEpoch) {
      return materializationAuthorityMismatch(mode, "revocationEpochChanged");
    }
    if (mode.kind === "sealed") {
      if (
        session.lifecycle !== "running" &&
        session.lifecycle !== "finishing"
      ) {
        return Object.freeze({ kind: "notPlannable", reason: "lifecycle" });
      }
    } else {
      if (session.lifecycle === "committed") {
        const updatedAtMilliseconds = finiteDateMilliseconds(session.updatedAt);
        return updatedAtMilliseconds === undefined
          ? occExecutionCorrupt("sessionEvidenceInvalid")
          : Object.freeze({ kind: "alreadyCommitted", updatedAtMilliseconds });
      }
      if (session.lifecycle === "retrying") {
        return occExecutionCorrupt("durableRetrying");
      }
      if (session.lifecycle !== "running") {
        return Object.freeze({
          kind: "notExecutable",
          reason: "lifecycle",
          lifecycle: session.lifecycle,
        });
      }
    }
    if (captured.skipReason !== undefined) {
      return materializationCorrupt(mode, captured.skipReason);
    }
    if (!validSessionScalars(session)) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    const sessionTiming = captureSessionTiming(session);
    if (sessionTiming === undefined) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    const sessionScalars = captureSessionScalars(
      session,
      captured.sessionPayloadRows.length === 1
        ? captured.sessionPayloadRows[0]
        : undefined,
    );
    if (sessionScalars === undefined) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    if (captured.leaseRows.length !== 1) {
      return materializationCorrupt(mode, "snapshotLeaseMissingOrDuplicate");
    }
    const lease = captured.leaseRows[0];
    if (lease === undefined) {
      return materializationCorrupt(mode, "snapshotLeaseMissingOrDuplicate");
    }
    const leaseSnapshot = decodeOrMaterializationCorrupt(
      mode,
      decodeLeaseSnapshotResult(expected, lease),
    );
    if ("corrupt" in leaseSnapshot) return leaseSnapshot.corrupt;
    const decodedLeaseSnapshot = leaseSnapshot.value;
    const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
      lease.leaseExpiresAt,
    );
    if (
      lease.scopeUuid !== scopeUuid ||
      lease.sessionId !== expected.sessionId ||
      lease.attemptFence !== expected.attemptFence ||
      leaseExpiresAtMilliseconds === undefined ||
      leaseExpiresAtMilliseconds > sessionTiming.hardExpiresAtMilliseconds ||
      decodedLeaseSnapshot.commitSeq > clock.lastCommitSeq
    ) {
      return materializationCorrupt(mode, "snapshotLeaseInvalid");
    }
    if (
      decodedLeaseSnapshot.scopeId !== expected.snapshotToken.scopeId ||
      decodedLeaseSnapshot.epoch !== expected.snapshotToken.epoch ||
      decodedLeaseSnapshot.commitSeq !== expected.snapshotToken.commitSeq
    ) {
      return materializationAuthorityMismatch(mode, "snapshotChanged");
    }
    if (leaseExpiresAtMilliseconds <= databaseNowMilliseconds) {
      return mode.kind === "sealed"
        ? Object.freeze({ kind: "notPlannable", reason: "expired" })
        : Object.freeze({ kind: "notExecutable", reason: "expired" });
    }

    if (mode.kind === "openOccExecution") {
      if (captured.executionClaimRows.length !== 1) {
        return occExecutionCorrupt("executionClaimInvalid");
      }
      const claim = captured.executionClaimRows[0];
      if (claim === undefined) {
        return occExecutionCorrupt("executionClaimInvalid");
      }
      const claimOwner = decodeTransactionExecutionClaimOwnerV1(
        claim.claimOwner,
      );
      const claimFence = decodeTransactionExecutionClaimFenceV1(
        claim.claimFence,
      );
      const claimedAtMilliseconds = finiteDateMilliseconds(claim.claimedAt);
      const claimExpiresAtMilliseconds = finiteDateMilliseconds(
        claim.claimExpiresAt,
      );
      if (
        Result.isFailure(claimOwner) ||
        Result.isFailure(claimFence) ||
        claimedAtMilliseconds === undefined ||
        claimExpiresAtMilliseconds === undefined ||
        claim.scopeUuid !== scopeUuid ||
        claim.sessionId !== expected.sessionId ||
        claim.attemptFence !== expected.attemptFence ||
        claimedAtMilliseconds > databaseNowMilliseconds ||
        claimExpiresAtMilliseconds <= claimedAtMilliseconds
      ) {
        return occExecutionCorrupt("executionClaimInvalid");
      }
      if (claimExpiresAtMilliseconds <= databaseNowMilliseconds) {
        return Object.freeze({ kind: "notExecutable", reason: "expired" });
      }
      if (
        claimOwner.success !== mode.expected.executionClaim.claimOwner ||
        claimFence.success !== mode.expected.executionClaim.claimFence
      ) {
        return occExecutionAuthorityMismatch("executionClaimChanged");
      }
    }

    if (captured.rootRows.length !== 1) {
      return materializationCorrupt(mode, "journalRootMissingOrDuplicate");
    }
    const root = captured.rootRows[0];
    if (root === undefined) {
      return materializationCorrupt(mode, "journalRootMissingOrDuplicate");
    }
    let creationTimeSeed:
      | StoredOccExecutionEvidenceV1["creationTimeSeed"]
      | undefined;
    if (mode.kind === "sealed") {
      if (root.state !== "sealed") {
        return Object.freeze({ kind: "notPlannable", reason: "rootNotSealed" });
      }
      if (!validRootScalars(root)) {
        return corrupt("journalRootInvalid");
      }
      if (
        !storedTransactionSessionScalarsEqualV1(
          sessionScalars,
          mode.expected.session,
        )
      ) {
        return authorityMismatch("sealChanged");
      }
      if (
        !sameSealIdentity(
          mode.expected.sealIdentity,
          session,
          lease,
          root,
          scopeUuid,
        )
      ) {
        return authorityMismatch("sealChanged");
      }
    } else {
      if (leaseExpiresAtMilliseconds <= sessionTiming.updatedAtMilliseconds) {
        return occExecutionCorrupt("snapshotLeaseInvalid");
      }
      const expectedFacet = buildFreshTransactionAttemptFacetV1({
        scopeUuid,
        sessionId: mode.expected.sessionId,
        attemptFence: mode.expected.attemptFence,
        snapshotEpochUuid: epochUuid,
        snapshotCommitSeq: decodedLeaseSnapshot.commitSeq,
        databaseNowMilliseconds: sessionTiming.updatedAtMilliseconds,
        authorizationGrantExpiresAtMilliseconds:
          sessionTiming.authorizationGrantExpiresAtMilliseconds,
        hardExpiresAtMilliseconds: sessionTiming.hardExpiresAtMilliseconds,
        leaseDurationMilliseconds:
          leaseExpiresAtMilliseconds - sessionTiming.updatedAtMilliseconds,
      });
      const journalRootOutcome = Result.match(expectedFacet, {
        onSuccess: (facet) =>
          ({ ok: true as const, journalRoot: facet.journalRoot }),
        onFailure: () => ({ ok: false as const }),
      });
      if (!journalRootOutcome.ok) {
        return occExecutionCorrupt("journalRootNotPristine");
      }
      const rootState = classifyOpenOccExecutionRoot(
        Object.freeze({
          ...root,
          sealedJournalBytes:
            root.sealedJournalByteLengthText === null
              ? null
              : new Uint8Array(0),
          sealedResultBytes:
            root.sealedResultByteLengthText === null ? null : new Uint8Array(0),
        }),
        journalRootOutcome.journalRoot,
        databaseNowMilliseconds,
      );
      if (rootState === "corrupt") {
        return occExecutionCorrupt("journalRootInvalid");
      }
      if (rootState === "advanced") {
        return Object.freeze({ kind: "notExecutable", reason: "notPristine" });
      }
      if (captured.attemptChildRows.length !== 1) {
        return occExecutionCorrupt("journalRootNotPristine");
      }
      const children = captured.attemptChildRows[0];
      if (
        children === undefined ||
        typeof children.receiptExists !== "boolean" ||
        typeof children.pointExists !== "boolean" ||
        typeof children.indexRangeExists !== "boolean" ||
        typeof children.eventExists !== "boolean"
      ) {
        return occExecutionCorrupt("journalRootNotPristine");
      }
      if (
        children.receiptExists ||
        children.pointExists ||
        children.indexRangeExists ||
        children.eventExists
      ) {
        return occExecutionCorrupt("journalChildrenPresent");
      }
      creationTimeSeed = expectedFacet.success.journalRoot.creationTimeSeed;
    }

    if (captured.sessionPayloadRows.length !== 1) {
      return materializationCorrupt(mode, "sessionEvidenceMissingOrDuplicate");
    }
    const payload = captured.sessionPayloadRows[0];
    if (
      payload === undefined ||
      payload.scopeUuid !== scopeUuid ||
      payload.sessionId !== expected.sessionId ||
      payload.attemptFence !== expected.attemptFence ||
      typeof payload.validatedArgsJsonText !== "string" ||
      typeof payload.authorizationGrantJsonText !== "string"
    ) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    const sessionPayloadJson = Result.all({
      validatedArgsJson: decodeJsonObjectTextResult(
        payload.validatedArgsJsonText,
      ),
      authorizationGrantJson: decodeJsonObjectTextResult(
        payload.authorizationGrantJsonText,
      ),
    });
    const projectedArgsLength = parseLength(
      session.validatedArgsCanonicalByteLengthText,
    );
    const projectedGrantLength = parseLength(
      session.authorizationGrantCanonicalByteLengthText,
    );
    const projectedArgsJsonLength = parseLength(
      session.validatedArgsJsonByteLengthText,
    );
    const projectedGrantJsonLength = parseLength(
      session.authorizationGrantJsonByteLengthText,
    );
    if (
      Result.isFailure(sessionPayloadJson) ||
      projectedArgsLength === undefined ||
      projectedGrantLength === undefined ||
      projectedArgsJsonLength === undefined ||
      projectedGrantJsonLength === undefined ||
      utf8ByteLength(payload.validatedArgsJsonText) !==
        projectedArgsJsonLength ||
      utf8ByteLength(payload.authorizationGrantJsonText) !==
        projectedGrantJsonLength ||
      payload.validatedArgsCanonicalBytes.byteLength !== projectedArgsLength ||
      payload.authorizationGrantCanonicalBytes.byteLength !==
        projectedGrantLength
    ) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    const { validatedArgsJson, authorizationGrantJson } =
      sessionPayloadJson.success;
    const authorityJsonLength = session.executionAuthorityGeneration ===
        "application_v1"
      ? parseLength(session.applicationExecutionAuthorityJsonByteLengthText)
      : undefined;
    const authorityBytesLength = session.executionAuthorityGeneration ===
        "application_v1"
      ? parseLength(
          session.applicationExecutionAuthorityCanonicalByteLengthText,
        )
      : undefined;
    if (session.executionAuthorityGeneration === "application_v1" &&
      (payload.applicationExecutionAuthorityJsonText === null ||
        payload.applicationExecutionAuthorityCanonicalBytes === null ||
        authorityJsonLength === undefined || authorityBytesLength === undefined ||
        utf8ByteLength(payload.applicationExecutionAuthorityJsonText) !==
          authorityJsonLength ||
        payload.applicationExecutionAuthorityCanonicalBytes.byteLength !==
          authorityBytesLength)) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    if (mode.kind === "openOccExecution" &&
      mode.expected.kind === "occRerun") {
      const previous = mode.expected.previousSession;
      if (previous.lifecycle !== "finishing" ||
        !storedTransactionSessionScalarsEqualV1(
          sessionScalars,
          Object.freeze({
            ...previous,
            lifecycle: "running",
            updatedAtMilliseconds: sessionScalars.updatedAtMilliseconds,
          }),
        )) return occExecutionAuthorityMismatch("sessionChanged");
    }
    if (sessionScalars.updatedAtMilliseconds > databaseNowMilliseconds) {
      return materializationCorrupt(mode, "sessionEvidenceInvalid");
    }
    if (sessionScalars.authorizationGrantExpiresAtMilliseconds <=
        databaseNowMilliseconds ||
      sessionScalars.hardExpiresAtMilliseconds <= databaseNowMilliseconds) {
      return mode.kind === "sealed"
        ? Object.freeze({ kind: "notPlannable", reason: "expired" })
        : Object.freeze({ kind: "notExecutable", reason: "expired" });
    }

    if (captured.schemaSizeRows.length !== 1) {
      return materializationCorrupt(mode, "schemaArtifactMissingOrDuplicate");
    }
    const schemaSize = captured.schemaSizeRows[0];
    if (schemaSize === undefined) {
      return materializationCorrupt(mode, "schemaArtifactMissingOrDuplicate");
    }
    if (captured.schemaPayloadRows.length !== 1) {
      return materializationCorrupt(mode, "schemaArtifactMissingOrDuplicate");
    }
    const schemaRow = captured.schemaPayloadRows[0];
    if (schemaRow === undefined) {
      return materializationCorrupt(mode, "schemaArtifactMissingOrDuplicate");
    }
    if (options.beforeSchemaArtifactDecode !== undefined) {
      yield* runMaterializationPromise("beforeSchemaArtifactDecode", async () =>
        options.beforeSchemaArtifactDecode?.(),
      );
    }
    const manifest = yield* verifySchemaArtifactEffect(
      expected,
      schemaSize,
      schemaRow,
    );
    const manifestOr = decodeOrMaterializationCorrupt(mode, manifest);
    if ("corrupt" in manifestOr) return manifestOr.corrupt;
    const decodedManifest = manifestOr.value;
    const stableBindings = materializeBindings(
      decodedManifest,
      captured.bindingRows,
    );
    if (stableBindings === "overflow") {
      return materializationCorrupt(mode, "stableBindingOverflow");
    }
    if (stableBindings === "missing") {
      return materializationCorrupt(mode, "stableBindingMissing");
    }
    if (stableBindings === "mismatch") {
      return materializationCorrupt(mode, "stableBindingMismatch");
    }
    const application = sessionScalars.executionAuthorityGeneration ===
        "application_v1"
      ? yield* materializeApplicationGraphEffect(
          sessionScalars,
          captured,
          expected,
          decodedManifest,
        )
      : undefined;

    const commonEvidence = Object.freeze({
      databaseNowMilliseconds,
      currentAuthorizationRevocationEpoch: revocationEpoch,
      schema: Object.freeze({
        deploymentId: expected.deploymentId,
        schemaVersionId: expected.schemaVersionId,
        manifest: snapshotSchemaManifestValue(decodedManifest),
        stableBindings,
      }),
    });
    const payloadEvidence = Object.freeze({
        validatedArgsJson: Object.freeze(structuredClone(validatedArgsJson)),
        validatedArgsCanonicalBytes: copyBytes(
          payload.validatedArgsCanonicalBytes,
        ),
        authorizationGrantJson: Object.freeze(
          structuredClone(authorizationGrantJson),
        ),
        authorizationGrantCanonicalBytes: copyBytes(
          payload.authorizationGrantCanonicalBytes,
        ),
    });
    const evidence: StoredCommitAuthorityEvidenceV1 =
      sessionScalars.executionAuthorityGeneration ===
          "legacy_dynamic_worker_v1"
        ? Object.freeze({
            ...commonEvidence,
            session: Object.freeze({ ...sessionScalars, ...payloadEvidence }),
          })
        : Object.freeze({
            ...commonEvidence,
            session: Object.freeze({ ...sessionScalars, ...payloadEvidence }),
            application: application ??
              (yield* Effect.die("Application graph invariant.")),
          });
    return mode.kind === "sealed"
      ? Object.freeze({ kind: "loaded", evidence })
      : Object.freeze({
          kind: "loaded",
          evidence: Object.freeze({
            ...evidence,
            creationTimeSeed,
          }),
        });
  }).pipe(Effect.catch(error => typeof error === "string"
    ? Effect.succeed(materializationCorrupt(mode, error))
    : Effect.fail(error)));
}

function materializationAuthorityMismatch(
  mode: StoredAuthorityMaterializationV1,
  reason:
    | "scopeChanged"
    | "attemptMissing"
    | "attemptReplaced"
    | "generationChanged"
    | "epochChanged"
    | "snapshotChanged"
    | "schemaChanged"
    | "revocationEpochChanged",
) {
  return mode.kind === "sealed"
    ? authorityMismatch(reason)
    : occExecutionAuthorityMismatch(reason);
}

const materializeApplicationGraphEffect = Effect.fn(
  "StoredCommitAuthority.materializeApplicationGraph",
)(function* (
  session: Extract<StoredCommitAuthoritySessionScalarsV1, {
    readonly executionAuthorityGeneration: "application_v1";
  }>,
  captured: CapturedRowsV1,
  expected: StoredCommitAuthorityCaptureAuthorityV1,
  schemaManifest: SchemaManifestAppSchemaV1,
) {
  if (
    captured.applicationGraphSizeRows.length !== 1 ||
    captured.applicationGraphPayloadRows.length !== 1
  ) {
    return yield* Effect.fail(
      "applicationGraphMissingOrDuplicate" as const,
    );
  }
  const sizes = captured.applicationGraphSizeRows[0];
  const graph = captured.applicationGraphPayloadRows[0];
  if (sizes === undefined || graph === undefined) {
    return yield* Effect.fail("applicationGraphMissingOrDuplicate" as const);
  }
  const canonicalAuthority = yield*
    canonicalizeApplicationMutationExecutionAuthorityV1(
      session.applicationExecutionAuthorityJson,
    ).pipe(Effect.mapError(() => "applicationGraphInvalid" as const));
  if (
    !bytesEqual(
      canonicalAuthority.canonicalBytes,
      session.applicationExecutionAuthorityCanonicalBytes,
    ) ||
    !bytesEqual(
      canonicalAuthority.sha256,
      session.applicationExecutionAuthoritySha256,
    )
  ) return yield* Effect.fail("applicationGraphInvalid" as const);
  const authority = canonicalAuthority.authority;
  const target = authority.runtimeTarget;
  const activation = graph.activation;
  const readiness = graph.readiness;
  const revision = graph.revision;
  const analysis = graph.analysis;
  const publication = graph.publication;
  const fn = graph.selectedFunction;
  const revisionSchema = graph.revisionSchema;
  const schemaAuthority = graph.schemaAuthority;
  const expectedLengths = [
    [sizes.activationByteLengthText, activation.activationBytes],
    [sizes.readinessByteLengthText, readiness.readinessBytes],
    [sizes.manifestByteLengthText, analysis.manifestBytes],
    [sizes.schemaByteLengthText, publication.schemaBytes],
    [sizes.functionCatalogByteLengthText, publication.functionCatalogBytes],
    [sizes.functionEntryByteLengthText, fn.entryBytes],
    [sizes.schemaBindingByteLengthText, schemaAuthority.bindingBytes],
  ] as const;
  if (expectedLengths.some(([text, bytes]) =>
    bytes === null || parseLength(text) !== bytes.byteLength
  )) return yield* Effect.fail("applicationGraphInvalid" as const);
  const activatedAt = databaseTimestampFromUnknown(activation.activatedAt);
  const readyAt = databaseTimestampFromUnknown(readiness.readyAt);
  if (activatedAt === null || readyAt === null) {
    return yield* Effect.fail("applicationGraphInvalid" as const);
  }
  yield* validateCanonicalFrame(
    activation.activationBytes,
    activation.activationSha256,
  ).pipe(Effect.mapError(() => "applicationGraphInvalid" as const));
  yield* validateCanonicalFrame(
    readiness.readinessBytes,
    readiness.readinessSha256,
  ).pipe(Effect.mapError(() => "applicationGraphInvalid" as const));
  const readinessFrame = yield* Effect.fromResult(
    decodeApplicationReadinessFrame(readiness.readinessBytes).pipe(
      Result.mapError(() => "applicationGraphInvalid" as const),
    ),
  );
  const activationBytes = yield* Effect.fromResult(
    applicationActivationFrameBytes({
      scopeId: activation.scopeId,
      activationSequence: activation.activationSequence,
      previousActivationSequence: activation.previousActivationSequence,
      revisionId: activation.revisionId,
      readinessSha256: activation.readinessSha256,
      activationRequestSha256: activation.activationRequestSha256,
      activatedAtIso: activatedAt.toISOString(),
    }).pipe(Result.mapError(() => "applicationGraphInvalid" as const)),
  );
  const headBytes = yield* Effect.fromResult(
    applicationActiveHeadFrameBytes({
      scopeId: activation.scopeId,
      activationSequence: activation.activationSequence,
      revisionId: activation.revisionId,
      readinessSha256: activation.readinessSha256,
      activationSha256: activation.activationSha256,
    }).pipe(Result.mapError(() => "applicationGraphInvalid" as const)),
  );
  const headSha256 = yield* sha256ApplicationFrame(headBytes).pipe(
    Effect.mapError(() => "applicationGraphInvalid" as const),
  );
  if (
    !bytesEqual(activationBytes, activation.activationBytes) ||
    activation.activationSequence.toString() !== authority.activationSequence ||
    activation.revisionId !== target.revisionId ||
    !bytesEqual(
      headSha256,
      hexToBytes(authority.activeHeadSha256),
    ) ||
    !bytesEqual(activation.readinessSha256, readiness.readinessSha256)
  ) return yield* Effect.fail("applicationGraphInvalid" as const);

  if (
    revision.scopeId !== target.scopeId ||
    revision.revisionId !== target.revisionId ||
    revision.candidateId !== target.candidateId ||
    revision.analysisId !== target.analysisId ||
    revision.analysisStatus !== "analyzed" || revision.status !== "inactive" ||
    analysis.scopeId !== target.scopeId ||
    analysis.analysisId !== target.analysisId ||
    analysis.status !== "analyzed" ||
    analysis.candidateId !== target.candidateId ||
    !bytesEqual(analysis.sourceArtifactRootSha256,
      hexToBytes(target.sourceArtifactRootSha256)) ||
    !bytesEqual(revision.sourceArtifactRootSha256,
      hexToBytes(target.sourceArtifactRootSha256)) ||
    !bytesEqual(revision.manifestSha256, hexToBytes(target.manifestSha256)) ||
    analysis.manifestBytes === null || analysis.manifestSha256 === null
  ) return yield* Effect.fail("applicationGraphInvalid" as const);
  const manifestBytes = analysis.manifestBytes;
  const manifestSha256 = analysis.manifestSha256;
  const manifestDigest = yield* sha256ApplicationFrame(
    manifestBytes,
  ).pipe(Effect.mapError(() => "applicationGraphInvalid" as const));
  if (!bytesEqual(manifestDigest, manifestSha256)) {
    return yield* Effect.fail("applicationGraphInvalid" as const);
  }
  const manifestValue = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(manifestBytes)),
    catch: () => "applicationGraphInvalid" as const,
  });
  const manifest = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(manifestValue).pipe(
      Result.mapError(() => "applicationGraphInvalid" as const),
    ),
  );
  if (!bytesEqual(manifest.canonicalBytes, manifestBytes)) {
    return yield* Effect.fail("applicationGraphInvalid" as const);
  }
  const selected = manifest.manifest.functions.find(
    candidate => candidate.path === target.function.path,
  );
  if (selected === undefined) {
    return yield* Effect.fail("applicationGraphInvalid" as const);
  }
  const schemaFrame = yield* Effect.fromResult(
    applicationSchemaPublicationFrameV1(manifest.manifest).pipe(
      Result.mapError(() => "applicationGraphInvalid" as const),
    ),
  );
  const catalogFrame = yield* Effect.fromResult(
    applicationFunctionCatalogPublicationFrameV1(manifest.manifest).pipe(
      Result.mapError(() => "applicationGraphInvalid" as const),
    ),
  );
  const entryFrame = yield* Effect.fromResult(
    applicationFunctionEntryPublicationFrameV1(selected).pipe(
      Result.mapError(() => "applicationGraphInvalid" as const),
    ),
  );
  const schemaSha = yield* sha256ApplicationFrame(schemaFrame).pipe(
    Effect.mapError(() => "applicationGraphInvalid" as const),
  );
  const catalogSha = yield* sha256ApplicationFrame(catalogFrame).pipe(
    Effect.mapError(() => "applicationGraphInvalid" as const),
  );
  const entrySha = yield* sha256ApplicationFrame(entryFrame).pipe(
    Effect.mapError(() => "applicationGraphInvalid" as const),
  );
  const publicationFrame = yield* Effect.fromResult(
    applicationPublicationCommitmentFrameV1({
      scopeId: target.scopeId,
      revisionId: target.revisionId,
      candidateId: target.candidateId,
      analysisId: target.analysisId,
      sourceArtifactRootSha256: target.sourceArtifactRootSha256,
      manifestSha256: target.manifestSha256,
      schemaSha256: encodeBytesToLowercaseHex(schemaSha),
      functionCatalogSha256: encodeBytesToLowercaseHex(catalogSha),
    }).pipe(Result.mapError(() => "applicationGraphInvalid" as const)),
  );
  const publicationSha = yield* sha256ApplicationFrame(publicationFrame).pipe(
    Effect.mapError(() => "applicationGraphInvalid" as const),
  );
  const reconstructedTarget = yield* Effect.fromResult(
    canonicalizeApplicationRuntimeTargetV1({
      ...target,
      executionModulePath: manifest.manifest.sourceArtifact.executionModulePath,
      function: { ...selected, entrySha256: encodeBytesToLowercaseHex(entrySha) },
    }).pipe(Result.mapError(() => "applicationGraphInvalid" as const)),
  );
  if (
    publication.scopeId !== target.scopeId ||
    publication.revisionId !== target.revisionId ||
    publication.candidateId !== target.candidateId ||
    publication.analysisId !== target.analysisId ||
    publication.revisionStatus !== "inactive" ||
    !bytesEqual(publication.sourceArtifactRootSha256,
      hexToBytes(target.sourceArtifactRootSha256)) ||
    !bytesEqual(publication.manifestSha256,
      hexToBytes(target.manifestSha256)) ||
    fn.scopeId !== target.scopeId ||
    fn.revisionId !== target.revisionId ||
    fn.functionPath !== selected.path ||
    fn.moduleName !== selected.moduleName ||
    fn.exportName !== selected.exportName ||
    fn.functionKind !== selected.kind ||
    fn.visibility !== selected.visibility ||
    !bytesEqual(fn.functionCatalogSha256, catalogSha) ||
    !bytesEqual(schemaFrame, publication.schemaBytes) ||
    !bytesEqual(catalogFrame, publication.functionCatalogBytes) ||
    !bytesEqual(entryFrame, fn.entryBytes) ||
    !bytesEqual(schemaSha, publication.schemaSha256) ||
    !bytesEqual(catalogSha, publication.functionCatalogSha256) ||
    !bytesEqual(entrySha, fn.entrySha256) ||
    !bytesEqual(publicationSha, publication.publicationSha256) ||
    encodeBytesToLowercaseHex(publicationSha) !== target.publicationSha256 ||
    !bytesEqual(reconstructedTarget.canonicalBytes,
      (yield* Effect.fromResult(canonicalizeApplicationRuntimeTargetV1(target)
        .pipe(Result.mapError(() => "applicationGraphInvalid" as const))))
        .canonicalBytes)
  ) return yield* Effect.fail("applicationGraphInvalid" as const);
  const coldReceiptSetFrame = yield* Effect.fromResult(
    applicationColdReceiptSetFrameBytes({
      runtimeHostIdentity: readinessFrame.runtimeHostIdentity,
      compatibilityDate: readinessFrame.compatibilityDate,
      entries: readinessFrame.coldReceipts,
    }).pipe(Result.mapError(() => "applicationGraphInvalid" as const)),
  );
  const coldReceiptSetSha256 = yield* sha256ApplicationFrame(
    coldReceiptSetFrame,
  ).pipe(Effect.mapError(() => "applicationGraphInvalid" as const));
  if (
    readiness.scopeId !== target.scopeId ||
    readiness.revisionId !== target.revisionId ||
    readiness.deploymentId !== expected.deploymentId ||
    readiness.candidateId !== target.candidateId ||
    readiness.analysisId !== target.analysisId ||
    readiness.storageGeneration !== expected.storageGeneration ||
    readiness.storageGenerationFence !== expected.storageGenerationFence ||
    readiness.epoch !== expected.snapshotToken.epoch ||
    readiness.schemaVersionId !== authority.schemaVersionId ||
    !bytesEqual(readiness.sourceArtifactRootSha256,
      hexToBytes(target.sourceArtifactRootSha256)) ||
    !bytesEqual(readiness.manifestSha256,
      hexToBytes(target.manifestSha256)) ||
    !bytesEqual(readiness.publicationSha256, publicationSha) ||
    !bytesEqual(readiness.applicationSchemaSha256, schemaSha) ||
    !bytesEqual(readiness.functionCatalogSha256, catalogSha) ||
    !bytesEqual(readiness.coldReceiptSetSha256, coldReceiptSetSha256) ||
    !readinessFrameMatchesRow(readinessFrame, readiness, readyAt) ||
    revisionSchema.scopeId !== target.scopeId ||
    revisionSchema.revisionId !== target.revisionId ||
    revisionSchema.schemaVersionId !== authority.schemaVersionId ||
    revisionSchema.deploymentId !== expected.deploymentId ||
    !bytesEqual(revisionSchema.applicationSchemaSha256, schemaSha) ||
    schemaAuthority.deploymentId !== expected.deploymentId ||
    !bytesEqual(schemaAuthority.applicationSchemaSha256, schemaSha) ||
    schemaAuthority.status !== "published" ||
    schemaAuthority.schemaVersionId !== authority.schemaVersionId ||
    schemaAuthority.schemaVersion !== revisionSchema.schemaVersion ||
    schemaAuthority.schemaManifestSha256 === null ||
    schemaAuthority.bindingSha256 === null ||
    schemaAuthority.bindingBytes === null ||
    !bytesEqual(revisionSchema.schemaManifestSha256,
      schemaAuthority.schemaManifestSha256) ||
    !bytesEqual(readiness.schemaManifestSha256,
      schemaAuthority.schemaManifestSha256) ||
    !bytesEqual(readiness.schemaBindingSha256,
      schemaAuthority.bindingSha256) ||
    !bytesEqual(revisionSchema.schemaBindingSha256,
      schemaAuthority.bindingSha256)
  ) return yield* Effect.fail("applicationGraphInvalid" as const);
  const bindingProjection = yield* Effect.fromResult(
    projectApplicationSchemaBindingResult(manifest.manifest, schemaManifest),
  );
  const bindingFrame = yield* Effect.fromResult(
    applicationSchemaBindingFrameBytes({
      deploymentId: expected.deploymentId,
      applicationSchemaSha256: encodeBytesToLowercaseHex(schemaSha),
      schemaVersionId: authority.schemaVersionId,
      schemaVersion: schemaAuthority.schemaVersion,
      schemaManifestSha256: encodeBytesToLowercaseHex(
        schemaAuthority.schemaManifestSha256,
      ),
      tables: bindingProjection.tables,
      indexes: bindingProjection.indexes,
    }).pipe(Result.mapError(() => "applicationGraphInvalid" as const)),
  );
  const bindingSha = yield* sha256ApplicationFrame(bindingFrame).pipe(
    Effect.mapError(() => "applicationGraphInvalid" as const),
  );
  if (!bytesEqual(bindingFrame, schemaAuthority.bindingBytes) ||
    !bytesEqual(bindingSha, schemaAuthority.bindingSha256)) {
    return yield* Effect.fail("applicationGraphInvalid" as const);
  }

  return Object.freeze({
    manifest: manifest.manifest,
    runtimeHostIdentity: readinessFrame.runtimeHostIdentity,
    compatibilityDate: readinessFrame.compatibilityDate,
    executionAuthority: canonicalAuthority.authority,
    runtimeTarget: canonicalAuthority.authority.runtimeTarget,
    activationSequence: activation.activationSequence,
    readinessSha256: copyBytes(readiness.readinessSha256),
    activationSha256: copyBytes(activation.activationSha256),
    activeHeadSha256: copyBytes(headSha256),
    publicationSha256: copyBytes(publicationSha),
    functionEntrySha256: copyBytes(entrySha),
    schemaBindingSha256: copyBytes(schemaAuthority.bindingSha256),
  });
});

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) return new Uint8Array(0);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function readinessFrameMatchesRow(
  frame: import("../applicationAuthorityFrames").ApplicationReadinessFrameProjection,
  row: ApplicationReadinessRow,
  readyAt: Date,
): boolean {
  return frame.scopeId === row.scopeId &&
    frame.deploymentId === row.deploymentId &&
    frame.revisionId === row.revisionId &&
    frame.candidateId === row.candidateId &&
    frame.analysisId === row.analysisId &&
    frame.storageGeneration === row.storageGeneration &&
    frame.storageGenerationFence === row.storageGenerationFence.toString() &&
    frame.epoch === row.epoch &&
    frame.sourceArtifactRootSha256 ===
      encodeBytesToLowercaseHex(row.sourceArtifactRootSha256) &&
    frame.manifestSha256 === encodeBytesToLowercaseHex(row.manifestSha256) &&
    frame.publicationSha256 ===
      encodeBytesToLowercaseHex(row.publicationSha256) &&
    frame.applicationSchemaSha256 ===
      encodeBytesToLowercaseHex(row.applicationSchemaSha256) &&
    frame.functionCatalogSha256 ===
      encodeBytesToLowercaseHex(row.functionCatalogSha256) &&
    frame.schemaVersionId === row.schemaVersionId &&
    frame.schemaManifestSha256 ===
      encodeBytesToLowercaseHex(row.schemaManifestSha256) &&
    frame.schemaBindingSha256 ===
      encodeBytesToLowercaseHex(row.schemaBindingSha256) &&
    frame.taskCatalogBindingSha256 ===
      encodeBytesToLowercaseHex(row.taskCatalogBindingSha256) &&
    frame.runtimeHostIdentity === row.runtimeHostIdentity &&
    frame.compatibilityDate === row.compatibilityDate &&
    frame.coldReceiptSetSha256 ===
      encodeBytesToLowercaseHex(row.coldReceiptSetSha256) &&
    frame.candidateValidationReceiptSha256 ===
      encodeBytesToLowercaseHex(row.candidateValidationReceiptSha256) &&
    frame.uniqueConstraintStatus === row.uniqueConstraintStatus &&
    frame.uniqueConstraintEligibilitySha256 ===
      encodeBytesToLowercaseHex(row.uniqueConstraintEligibilitySha256) &&
    frame.physicalReadinessSha256 ===
      encodeBytesToLowercaseHex(row.physicalReadinessSha256) &&
    frame.readyAt === readyAt.toISOString();
}

function projectApplicationSchemaBindingResult(
  manifest: ApplicationManifestV1,
  schemaManifest: SchemaManifestAppSchemaV1,
): Result.Result<Readonly<{
  readonly tables: ReadonlyArray<Json>;
  readonly indexes: ReadonlyArray<Json>;
}>, "applicationGraphInvalid"> {
  const boundTablesByName = new Map(
    schemaManifest.tableDefinitions.tables.map(table => [
      table.logicalName,
      table,
    ] as const),
  );
  if (boundTablesByName.size !== manifest.schema.tables.length) {
    return Result.fail("applicationGraphInvalid");
  }
  const tableIds = new Map<number, CatalogTableId>();
  const tables: Json[] = [];
  for (const table of manifest.schema.tables) {
    const bound = schemaManifest.tableDefinitions.tables.find(candidate =>
      candidate.logicalName === table.name
    );
    if (bound === undefined || !canonicalJsonEqual(
      bound.definition.documentType,
      table.validator,
    )) return Result.fail("applicationGraphInvalid");
    tableIds.set(table.tableId, bound.tableId);
    tables.push({
      applicationTableId: table.tableId,
      logicalName: table.name,
      tableId: bound.tableId,
    });
  }
  const unmatched = new Set(schemaManifest.indexBindings.indexes);
  const indexes: Json[] = [];
  for (const index of manifest.schema.indexes) {
    const tableId = tableIds.get(index.tableId);
    const bound = tableId === undefined ? undefined :
      schemaManifest.indexBindings.indexes.find(candidate =>
        candidate.tableId === tableId && candidate.descriptor === index.name
      );
    if (bound === undefined || bound.spec.fields.length !== index.fields.length ||
      !bound.spec.fields.every((field, position) =>
        field === index.fields[position])) {
      return Result.fail("applicationGraphInvalid");
    }
    if (tableId === undefined) return Result.fail("applicationGraphInvalid");
    unmatched.delete(bound);
    indexes.push({
      applicationIndexId: index.indexId,
      applicationTableId: index.tableId,
      descriptor: index.name,
      logicalIndexId: bound.logicalIndexId,
      tableId,
    });
  }
  return unmatched.size === 0
    ? Result.succeed(Object.freeze({
        tables: Object.freeze(tables),
        indexes: Object.freeze(indexes),
      }))
    : Result.fail("applicationGraphInvalid");
}

function canonicalJsonInvariant(issue: { readonly reason: string }): never {
  throw new Error(`Application schema invariant: ${issue.reason}`);
}

function canonicalJsonEqual(left: Json, right: Json): boolean {
  return encodeCanonicalJson(left, canonicalJsonInvariant) ===
    encodeCanonicalJson(right, canonicalJsonInvariant);
}

function materializationCorrupt(
  mode: StoredAuthorityMaterializationV1,
  reason: StoredCommitAuthorityCorruptionReasonV1,
) {
  return mode.kind === "sealed" ? corrupt(reason) : occExecutionCorrupt(reason);
}

/**
 * Folds a projected-row decode into either its decoded value or the
 * materialization corruption result, which is a success-channel load outcome
 * rather than an Effect failure.
 */
function decodeOrMaterializationCorrupt<T>(
  mode: StoredAuthorityMaterializationV1,
  decoded: Result.Result<T, StoredCommitAuthorityCorruptionReasonV1>,
): { readonly value: T } | { readonly corrupt: ReturnType<typeof materializationCorrupt> } {
  return Result.isFailure(decoded)
    ? { corrupt: materializationCorrupt(mode, decoded.failure) }
    : { value: decoded.success };
}

interface ClockAuthorityProjectionRow {
  readonly scopeId: unknown;
  readonly storageGeneration: unknown;
  readonly storageGenerationFence: unknown;
  readonly lastCommitSeq: unknown;
  readonly oldestAvailableCommitSeq: unknown;
  readonly lastOutboxSeq: unknown;
  readonly epoch: unknown;
  readonly updatedAt: unknown;
  readonly scopeUuid: unknown;
  readonly epochUuid: unknown;
  readonly authorizationRevocationEpoch: unknown;
}

interface DecodedClockAuthority {
  readonly clock: ScopeClockRecord;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly revocationEpoch: TransactionAuthorizationRevocationEpoch;
}

export function decodeClockAuthorityResult(
  row: ClockAuthorityProjectionRow,
): Result.Result<
  Readonly<DecodedClockAuthority>,
  "authorityProjectionInvalid"
> {
  return Result.gen(function* () {
    const clock = yield* decodeScopeClockRecordResult(row).pipe(
      Result.mapError(() => "authorityProjectionInvalid" as const),
    );
    const scopeUuid = yield* decodeScopeUuidResult(row.scopeUuid).pipe(
      Result.mapError(() => "authorityProjectionInvalid" as const),
    );
    const epochUuid = yield* decodeScopeEpochUuidResult(row.epochUuid).pipe(
      Result.mapError(() => "authorityProjectionInvalid" as const),
    );
    const revocationEpoch =
      yield* decodeTransactionAuthorizationRevocationEpochResult(
        row.authorizationRevocationEpoch,
      ).pipe(
        Result.mapError(() => "authorityProjectionInvalid" as const),
      );
    return Object.freeze({
      clock,
      scopeUuid,
      epochUuid,
      revocationEpoch,
    } satisfies DecodedClockAuthority);
  });
}

interface SessionIdentityProjectionRow {
  readonly sessionId: unknown;
  readonly attemptFence: unknown;
  readonly storageGenerationFence: unknown;
}

interface DecodedSessionIdentity {
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGenerationFence: StorageGenerationFence;
}

export function decodeSessionIdentityResult(
  session: SessionIdentityProjectionRow,
): Result.Result<Readonly<DecodedSessionIdentity>, "sessionEvidenceInvalid"> {
  return Result.gen(function* () {
    const sessionId = yield* decodeTransactionSessionIdResult(
      session.sessionId,
    ).pipe(Result.mapError(() => "sessionEvidenceInvalid" as const));
    const attemptFence = yield* decodeTransactionAttemptFenceResult(
      session.attemptFence,
    ).pipe(Result.mapError(() => "sessionEvidenceInvalid" as const));
    const storageGenerationFence = yield* decodeStorageGenerationFenceResult(
      session.storageGenerationFence,
    ).pipe(Result.mapError(() => "sessionEvidenceInvalid" as const));
    return Object.freeze({
      sessionId,
      attemptFence,
      storageGenerationFence,
    } satisfies DecodedSessionIdentity);
  });
}

interface LeaseSnapshotProjectionRow {
  readonly snapshotEpochUuid: unknown;
  readonly snapshotCommitSeq: unknown;
}

export function decodeLeaseSnapshotResult(
  expected: Pick<StoredCommitAuthorityCaptureAuthorityV1, "scopeId">,
  lease: LeaseSnapshotProjectionRow,
): Result.Result<SnapshotToken, "snapshotLeaseInvalid"> {
  return Result.gen(function* () {
    const snapshotEpochUuid = yield* decodeScopeEpochUuidResult(
      lease.snapshotEpochUuid,
    ).pipe(Result.mapError(() => "snapshotLeaseInvalid" as const));
    const epoch = replacementScopeEpochV1FromUuid(snapshotEpochUuid);
    const commitSeq = yield* decodeCommitSeqResult(
      lease.snapshotCommitSeq,
    ).pipe(Result.mapError(() => "snapshotLeaseInvalid" as const));
    return yield* decodeSnapshotTokenResult({
      scopeId: expected.scopeId,
      epoch,
      commitSeq,
    }).pipe(Result.mapError(() => "snapshotLeaseInvalid" as const));
  });
}

function validSessionScalars(session: SessionSizeRow): boolean {
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const createdAtMilliseconds = finiteDateMilliseconds(session.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(session.updatedAt);
  return session.protocolVersion === TRANSACTION_SESSION_PROTOCOL_VERSION_V1 &&
    authorizationGrantExpiresAtMilliseconds !== undefined &&
    hardExpiresAtMilliseconds !== undefined &&
    createdAtMilliseconds !== undefined &&
    updatedAtMilliseconds !== undefined &&
    hardExpiresAtMilliseconds <= authorizationGrantExpiresAtMilliseconds &&
    updatedAtMilliseconds >= createdAtMilliseconds &&
    isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32) &&
    isUint8ArrayWithByteLength(session.validatedArgsSha256, 32) &&
    isUint8ArrayWithByteLength(session.authorizationGrantSha256, 32) &&
    isUint8ArrayWithByteLength(session.requestSha256, 32) &&
    isPositiveSafeInteger(
      parseLength(session.validatedArgsCanonicalByteLengthText),
    ) &&
    isPositiveSafeInteger(
      parseLength(session.authorizationGrantCanonicalByteLengthText),
    );
}

function captureSessionTiming(session: SessionSizeRow): Readonly<{
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}> | undefined {
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const updatedAtMilliseconds = finiteDateMilliseconds(session.updatedAt);
  return authorizationGrantExpiresAtMilliseconds === undefined ||
      hardExpiresAtMilliseconds === undefined ||
      updatedAtMilliseconds === undefined
    ? undefined
    : Object.freeze({
        authorizationGrantExpiresAtMilliseconds,
        hardExpiresAtMilliseconds,
        updatedAtMilliseconds,
      });
}

function captureSessionScalars(
  session: SessionSizeRow,
  payload?: SessionPayloadRow,
): StoredCommitAuthoritySessionScalarsV1 | undefined {
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    return undefined;
  }
  const argsLength = parseLength(
    session.validatedArgsCanonicalByteLengthText,
  );
  const grantLength = parseLength(
    session.authorizationGrantCanonicalByteLengthText,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const createdAtMilliseconds = finiteDateMilliseconds(session.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(session.updatedAt);
  if (
    argsLength === undefined ||
    grantLength === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined
  ) {
    return undefined;
  }
  const common = {
    lifecycle: session.lifecycle,
    storageGeneration: session.storageGeneration,
    storageGenerationFence: session.storageGenerationFence,
    functionPath: session.functionPath,
    functionKind: session.functionKind,
    schemaVersionId: session.schemaVersionId,
    policyVersion: session.policyVersion,
    identityAccessPolicySha256: copyBytes(
      session.identityAccessPolicySha256,
    ),
    validatedArgsValueCodecVersion:
      session.validatedArgsValueCodecVersion,
    validatedArgsCanonicalByteLength: argsLength,
    validatedArgsSha256: copyBytes(session.validatedArgsSha256),
    authorizationGrantId: session.authorizationGrantId,
    authorizationGrantValueCodecVersion:
      session.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength: grantLength,
    authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
    authorizationRevocationEpoch: session.authorizationRevocationEpoch,
    authorizationGrantExpiresAtMilliseconds,
    requestKey: session.requestKey,
    requestSha256: copyBytes(session.requestSha256),
    protocolVersion: session.protocolVersion,
    hardExpiresAtMilliseconds,
    createdAtMilliseconds,
    updatedAtMilliseconds,
  } as const;
  if (session.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (
      session.packageId === null ||
      session.artifactRuntime === null ||
      session.artifactId === null ||
      session.sourcePackageHash === null ||
      session.executionModule === null ||
      session.applicationExecutionAuthorityJsonByteLengthText !== null ||
      session.applicationExecutionAuthorityCanonicalByteLengthText !== null ||
      session.applicationExecutionAuthoritySha256 !== null
    ) return undefined;
    return Object.freeze({
      executionAuthorityGeneration: "legacy_dynamic_worker_v1",
      packageId: session.packageId,
      artifactRuntime: session.artifactRuntime,
      artifactId: session.artifactId,
      sourcePackageHash: session.sourcePackageHash,
      executionModule: session.executionModule,
      ...common,
    });
  }
  if (
    session.executionAuthorityGeneration !== "application_v1" ||
    session.packageId !== null || session.artifactRuntime !== null ||
    session.artifactId !== null || session.sourcePackageHash !== null ||
    session.executionModule !== null ||
    payload?.applicationExecutionAuthorityJsonText === null ||
    payload?.applicationExecutionAuthorityJsonText === undefined ||
    payload.applicationExecutionAuthorityCanonicalBytes === null ||
    session.applicationExecutionAuthoritySha256 === null
  ) return undefined;
  const authorityJson = decodeJsonObjectTextResult(
    payload.applicationExecutionAuthorityJsonText,
  );
  return Result.match(authorityJson, {
    onSuccess: (authority) =>
      Object.freeze({
        executionAuthorityGeneration: "application_v1",
        applicationExecutionAuthorityJson:
          snapshotApplicationExecutionAuthorityJson(
            authority,
          ),
        applicationExecutionAuthorityCanonicalBytes: copyBytes(
          payload.applicationExecutionAuthorityCanonicalBytes,
        ),
        applicationExecutionAuthoritySha256: copyBytes(
          session.applicationExecutionAuthoritySha256,
        ),
        ...common,
      }),
  });
}

function validRootScalars(root: RootScalarRow): boolean {
  const createdAtMilliseconds = finiteDateMilliseconds(root.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  const sealedAtMilliseconds = finiteDateMilliseconds(root.sealedAt);
  return root.failureDimension === null &&
    root.sealedFinalSyscallSequence !== null &&
    root.sealedFinalSyscallSequence === root.lastSyscallSequence &&
    root.sealedJournalByteLengthText !== null &&
    root.sealedJournalSha256 !== null &&
    root.sealedResultValueCodecVersion !== null &&
    root.sealedResultSemanticBytes !== null &&
    root.sealedResultByteLengthText !== null &&
    root.sealedResultSha256 !== null &&
    root.sealedAt !== null &&
    isPositiveSafeInteger(parseLength(root.sealedJournalByteLengthText)) &&
    isPositiveSafeInteger(parseLength(root.sealedResultByteLengthText)) &&
    isUint8ArrayWithByteLength(root.sealedJournalSha256, 32) &&
    isUint8ArrayWithByteLength(root.sealedResultSha256, 32) &&
    createdAtMilliseconds !== undefined &&
    updatedAtMilliseconds !== undefined &&
    sealedAtMilliseconds !== undefined &&
    updatedAtMilliseconds >= createdAtMilliseconds &&
    sealedAtMilliseconds >= createdAtMilliseconds;
}

type OpenOccExecutionRootRowV1 = RootScalarRow &
  Readonly<{
    readonly sealedJournalBytes: Uint8Array | null;
    readonly sealedResultBytes: Uint8Array | null;
  }>;

function classifyOpenOccExecutionRoot(
  root: OpenOccExecutionRootRowV1,
  expected: Parameters<
    typeof isPristineFreshTransactionAttemptJournalRootV1
  >[1],
  databaseNowMilliseconds: number,
): "pristine" | "advanced" | "corrupt" {
  const createdAtMilliseconds = finiteDateMilliseconds(root.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  const expectedCreatedAtMilliseconds = finiteDateMilliseconds(
    expected.createdAt,
  );
  const numericCounters = [
    root.readDocuments,
    root.readSemanticBytes,
    root.pointDependencyCount,
    root.indexedQuerySyscalls,
    root.indexRangeDependencyCount,
    root.indexRangeDependencyEvidenceBytes,
    root.writeOperations,
    root.writeSemanticBytes,
    root.materialWriteEventEvidenceBytes,
  ];
  if (
    root.scopeUuid !== expected.scopeUuid ||
    root.sessionId !== expected.sessionId ||
    root.attemptFence !== expected.attemptFence ||
    typeof root.lastSyscallSequence !== "bigint" ||
    root.lastSyscallSequence < 0n ||
    !Number.isFinite(root.creationTimeSeed) ||
    root.creationTimeSeed <= 0 ||
    root.creationTimeSeed >= Number.MAX_SAFE_INTEGER + 1 ||
    !Number.isFinite(root.nextCreationTime) ||
    root.nextCreationTime < root.creationTimeSeed ||
    root.nextCreationTime >= Number.MAX_SAFE_INTEGER + 1 ||
    numericCounters.some((value) => !isNonNegativeSafeInteger(value)) ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined ||
    expectedCreatedAtMilliseconds === undefined ||
    createdAtMilliseconds !== expectedCreatedAtMilliseconds ||
    root.creationTimeSeed !== expected.creationTimeSeed ||
    updatedAtMilliseconds < createdAtMilliseconds ||
    updatedAtMilliseconds > databaseNowMilliseconds
  ) {
    return "corrupt";
  }

  const hasNoSealedEvidence =
    root.sealedFinalSyscallSequence === null &&
    root.sealedJournalBytes === null &&
    root.sealedJournalSha256 === null &&
    root.sealedResultValueCodecVersion === null &&
    root.sealedResultSemanticBytes === null &&
    root.sealedResultBytes === null &&
    root.sealedResultSha256 === null &&
    root.sealedAt === null;
  if (root.state === "open") {
    if (root.failureDimension !== null || !hasNoSealedEvidence) {
      return "corrupt";
    }
  } else if (root.state === "failed") {
    if (
      !isJournalFailureDimension(root.failureDimension) ||
      !hasNoSealedEvidence
    ) {
      return "corrupt";
    }
  } else if (root.state === "sealed") {
    if (!validRootScalars(root)) return "corrupt";
  } else {
    return "corrupt";
  }

  return isPristineFreshTransactionAttemptJournalRootV1(root, expected)
    ? "pristine"
    : "advanced";
}

function isJournalFailureDimension(
  value: RootScalarRow["failureDimension"],
): value is Exclude<RootScalarRow["failureDimension"], null> {
  return (
    value === "readDocuments" ||
    value === "readSemanticBytes" ||
    value === "pointReadDependencies" ||
    value === "indexedQuerySyscalls" ||
    value === "indexRangeReadDependencies" ||
    value === "indexRangeDependencyEvidenceBytes" ||
    value === "writeOperations" ||
    value === "writeSemanticBytes" ||
    value === "materialWriteEventEvidenceBytes"
  );
}

function sameSealIdentity(
  expected: StoredCommitAuthoritySealIdentityV1,
  session: SessionSizeRow,
  lease: LeaseRow,
  root: RootScalarRow,
  scopeUuid: ScopeUuidV1,
): boolean {
  const sessionUpdatedAtMilliseconds = finiteDateMilliseconds(
    session.updatedAt,
  );
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  const rootCreatedAtMilliseconds = finiteDateMilliseconds(root.createdAt);
  const rootUpdatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  const sealedAtMilliseconds = finiteDateMilliseconds(root.sealedAt);
  const journalLength = root.sealedJournalByteLengthText === null
    ? undefined
    : parseLength(root.sealedJournalByteLengthText);
  const resultLength = root.sealedResultByteLengthText === null
    ? undefined
    : parseLength(root.sealedResultByteLengthText);
  return root.sealedAt !== null &&
    root.sealedFinalSyscallSequence !== null &&
    root.sealedJournalSha256 !== null &&
    root.sealedResultValueCodecVersion !== null &&
    root.sealedResultSemanticBytes !== null &&
    root.sealedResultSha256 !== null &&
    expected.scopeUuid === scopeUuid &&
    expected.lifecycle === session.lifecycle &&
    expected.sessionUpdatedAtMilliseconds === sessionUpdatedAtMilliseconds &&
    expected.leaseExpiresAtMilliseconds === leaseExpiresAtMilliseconds &&
    expected.rootCreatedAtMilliseconds === rootCreatedAtMilliseconds &&
    expected.rootUpdatedAtMilliseconds === rootUpdatedAtMilliseconds &&
    expected.sealedAtMilliseconds === sealedAtMilliseconds &&
    expected.finalSyscallSequence === root.sealedFinalSyscallSequence &&
    expected.creationTimeSeed === root.creationTimeSeed &&
    expected.nextCreationTime === root.nextCreationTime &&
    expected.journalByteLength === journalLength &&
    bytesEqual(expected.journalSha256, root.sealedJournalSha256) &&
    expected.resultValueCodecVersion ===
      root.sealedResultValueCodecVersion &&
    expected.resultSemanticBytes === root.sealedResultSemanticBytes &&
    expected.resultByteLength === resultLength &&
    bytesEqual(expected.resultSha256, root.sealedResultSha256) &&
    expected.readDocuments === root.readDocuments &&
    expected.readSemanticBytes === root.readSemanticBytes &&
    expected.pointDependencyCount === root.pointDependencyCount &&
    expected.indexedQuerySyscalls === root.indexedQuerySyscalls &&
    expected.indexRangeDependencyCount === root.indexRangeDependencyCount &&
    expected.indexRangeDependencyEvidenceBytes ===
      root.indexRangeDependencyEvidenceBytes &&
    expected.writeOperations === root.writeOperations &&
    expected.writeSemanticBytes === root.writeSemanticBytes &&
    expected.materialWriteEventEvidenceBytes ===
      root.materialWriteEventEvidenceBytes;
}

const verifySchemaArtifactEffect = Effect.fn(
  "StoredCommitAuthority.verifySchemaArtifact",
)(function* (
  expected: StoredCommitAuthorityCaptureAuthorityV1,
  size: SchemaSizeRow,
  row: SchemaPayloadRow,
): Effect.fn.Return<
  Result.Result<SchemaManifestAppSchemaV1, "schemaArtifactInvalid">,
  StoredCommitAuthorityEvidencePersistenceV1Error
> {
  const sizeCreatedAtMilliseconds = finiteDateMilliseconds(size.createdAt);
  const rowCreatedAtMilliseconds = finiteDateMilliseconds(row.createdAt);
  if (
    row.deploymentId !== expected.deploymentId ||
    row.schemaVersionId !== expected.schemaVersionId ||
    size.deploymentId !== row.deploymentId ||
    size.schemaVersionId !== row.schemaVersionId ||
    size.version !== row.version ||
    size.manifestCodecVersion !== row.manifestCodecVersion ||
    !bytesEqual(size.manifestSha256, row.manifestSha256) ||
    sizeCreatedAtMilliseconds === undefined ||
    rowCreatedAtMilliseconds === undefined ||
    sizeCreatedAtMilliseconds !== rowCreatedAtMilliseconds ||
    parseLength(size.manifestJsonByteLengthText) !==
      utf8ByteLength(row.manifestJsonText) ||
    parseLength(size.manifestCanonicalByteLengthText) !==
    row.manifestBytes.byteLength
  ) {
    return Result.fail("schemaArtifactInvalid" as const);
  }
  const decoded = decodeStoredSchemaArtifactResult(row);
  if (
    Result.isFailure(decoded) ||
    decoded.success.schemaVersionId !== expected.schemaVersionId
  ) {
    return Result.fail("schemaArtifactInvalid" as const);
  }
  const decodedArtifact = decoded.success;
  const canonical = yield* runMaterializationPromise(
    "schemaManifestCanonicalization",
    () => canonicalizeSchemaManifestV1(decodedArtifact.json),
  );
  if (
    decodedArtifact.codecVersion !== canonical.codecVersion ||
    !bytesEqual(decodedArtifact.canonicalBytes, canonical.canonicalBytes) ||
    !bytesEqual(decodedArtifact.sha256, canonical.sha256)
  ) {
    return Result.fail("schemaArtifactInvalid" as const);
  }
  return decodeAppSchemaResult(canonical.manifestJson);
});

interface StoredSchemaArtifactProjectionRow {
  readonly schemaVersionId: unknown;
  readonly manifestCodecVersion: unknown;
  readonly manifestJsonText: unknown;
  readonly manifestBytes: unknown;
  readonly manifestSha256: unknown;
}

interface DecodedStoredSchemaArtifact {
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly codecVersion: SchemaManifestCodecVersion;
  readonly json: SchemaManifestJson;
  readonly canonicalBytes: CanonicalSchemaManifestBytes;
  readonly sha256: SchemaManifestSha256;
}

export function decodeStoredSchemaArtifactResult(
  row: StoredSchemaArtifactProjectionRow,
): Result.Result<
  Readonly<DecodedStoredSchemaArtifact>,
  "schemaArtifactInvalid"
> {
  return Result.gen(function* () {
    const schemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      row.schemaVersionId,
    ).pipe(Result.mapError(() => "schemaArtifactInvalid" as const));
    const codecVersion = yield* decodeSchemaManifestCodecVersionResult(
      row.manifestCodecVersion,
    ).pipe(Result.mapError(() => "schemaArtifactInvalid" as const));
    const json = yield* decodeSchemaManifestJsonTextResult(
      row.manifestJsonText,
    ).pipe(Result.mapError(() => "schemaArtifactInvalid" as const));
    const canonicalBytes =
      yield* decodeCanonicalSchemaManifestBytesResult(
        row.manifestBytes,
      ).pipe(Result.mapError(() => "schemaArtifactInvalid" as const));
    const sha256 = yield* decodeSchemaManifestSha256Result(
      row.manifestSha256,
    ).pipe(Result.mapError(() => "schemaArtifactInvalid" as const));
    return Object.freeze({
      schemaVersionId,
      codecVersion,
      json,
      canonicalBytes,
      sha256,
    } satisfies DecodedStoredSchemaArtifact);
  });
}

export function decodeAppSchemaResult(
  value: unknown,
): Result.Result<SchemaManifestAppSchemaV1, "schemaArtifactInvalid"> {
  return decodeSchemaManifestAppSchemaV1Result(value).pipe(
    Result.mapError(() => "schemaArtifactInvalid" as const),
  );
}

function materializeBindings(
  manifest: SchemaManifestAppSchemaV1,
  rawRows: ReadonlyArray<unknown>,
): ReadonlyArray<Readonly<{
  readonly logicalName: string;
  readonly tableId: CatalogTableId;
}>> | "overflow" | "missing" | "mismatch" {
  if (rawRows.length > MAX_SCHEMA_MANIFEST_APP_TABLES) return "overflow";
  const tables = manifest.tableDefinitions.tables;
  if (rawRows.length !== tables.length) return "missing";
  const bindings: Array<Readonly<{
    readonly logicalName: string;
    readonly tableId: CatalogTableId;
  }>> = [];
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    const row = decodeBindingRow(rawRows[index]);
    if (table === undefined || row === undefined) return "missing";
    const ordinal = parsePositiveIntegerText(row.ordinalText);
    const declaredTableId = parsePositiveIntegerText(
      row.declaredTableIdText,
    );
    const stableTableId = parsePositiveIntegerText(row.stableTableIdText);
    if (stableTableId === undefined) return "missing";
    if (
      ordinal !== index + 1 ||
      declaredTableId !== table.tableId ||
      stableTableId !== table.tableId
    ) {
      return "mismatch";
    }
    bindings.push(Object.freeze({
      logicalName: table.logicalName,
      tableId: table.tableId,
    }));
  }
  return Object.freeze(bindings);
}

function decodeBindingRow(value: unknown): BindingRow | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const ordinalText =
    Reflect.get(value, "ordinalText") ?? Reflect.get(value, "ordinaltext");
  const declaredTableIdText =
    Reflect.get(value, "declaredTableIdText") ??
    Reflect.get(value, "declaredtableidtext");
  const stableTableIdText =
    Reflect.get(value, "stableTableIdText") ??
    Reflect.get(value, "stabletableidtext");
  if (
    typeof ordinalText !== "string" ||
    (declaredTableIdText !== null &&
      typeof declaredTableIdText !== "string") ||
    (stableTableIdText !== null && typeof stableTableIdText !== "string")
  ) {
    return undefined;
  }
  return Object.freeze({
    ordinalText,
    declaredTableIdText,
    stableTableIdText,
  });
}

export function parseLength(
  value: string | null | undefined,
): number | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return isNonNegativeSafeInteger(parsed) ? parsed : undefined;
}

function parsePositiveIntegerText(
  value: string | null | undefined,
): number | undefined {
  const parsed = parseLength(value);
  return parsed !== undefined && parsed >= 1 && parsed <= 2_147_483_647
    ? parsed
    : undefined;
}

export function decodeJsonObjectTextResult(
  value: unknown,
): Result.Result<JsonObject, "sessionEvidenceInvalid"> {
  return decodeStoredJsonTextResult(value).pipe(
    Result.flatMap((json) =>
      isJsonObject(json)
        ? Result.succeed(json)
        : Result.fail("sessionEvidenceInvalid" as const)
    ),
    Result.mapError(() => "sessionEvidenceInvalid" as const),
  );
}

function runMaterializationPromise<A>(
  operation:
    | "beforeSchemaArtifactDecode"
    | "schemaManifestCanonicalization",
  run: () => PromiseLike<A>,
): Effect.Effect<A, StoredCommitAuthorityEvidencePersistenceV1Error> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new StoredCommitAuthorityEvidencePersistenceV1Error({
      operation,
      cause,
    }),
  });
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function decodeDatabaseNow(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Number(value);
  return isPositiveSafeInteger(milliseconds)
    ? milliseconds
    : undefined;
}
