import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import {
  isLowercaseUuidText,
  isNonBlankString,
} from "@flarex/utils/strings";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierAttemptIdentityFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierEncodedFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierFrameBudgetV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
  type DeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierProgressV2Error,
  type DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const FRAME_CODEC_VERSION = 2;
const RESTART_PAYLOAD_CODEC_VERSION = 1;

export interface DeclarativeV2VerifierStoredFrameBudgetV2
  extends DeclarativeV2VerifierFrameBudgetV2 {
  readonly maximumPayloadBytes: number;
}

export interface DeclarativeV2VerifierStoredFrameMetadataV2 {
  readonly codecVersion: 2;
  readonly byteLength: bigint;
  readonly sha256: Uint8Array;
}

export interface DeclarativeV2VerifierStoredEvidencePageMetadataV2 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly sequence: bigint;
  readonly commandKind: DeclarativeV2VerifierRestartCommandKindV2;
  readonly reservationSha256: Uint8Array;
  readonly pageOrdinal: bigint;
  readonly pageSha256: Uint8Array;
  readonly firstEvidenceOrdinal: bigint;
  readonly evidenceCount: bigint;
  readonly firstDiagnosticOrdinal: bigint;
  readonly diagnosticCount: bigint;
  readonly predecessorPageSha256: Uint8Array | null;
  readonly cumulativeDiagnosticsRootSha256: Uint8Array;
  readonly manifest: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly payloadCodecVersion: 1;
  readonly payloadByteLength: bigint;
  readonly payloadSha256: Uint8Array;
  readonly createdAt: Date;
}

export interface DeclarativeV2VerifierStoredAttemptMetadataV2 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly lifecycle:
    | "open"
    | "parsing"
    | "parse_complete"
    | "linking"
    | "link_complete"
    | "registering"
    | "ready"
    | "rejected"
    | "abandoned";
  readonly writerOwnerId: string | null;
  readonly writerFence: bigint;
  readonly leaseUpdatedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly settledSequence: bigint;
  readonly lastReceiptSha256: Uint8Array | null;
  readonly pendingKind: DeclarativeV2VerifierDurableCommandKindV2 | null;
  readonly pendingSequence: bigint | null;
  readonly pendingReservationSha256: Uint8Array | null;
  readonly pendingReservedByFence: bigint | null;
  readonly pendingStartedAt: Date | null;
  readonly identity: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly ceilings: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly usage: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly progress: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DeclarativeV2VerifierStoredCommandMetadataV2 {
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  readonly sequence: bigint;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly reservationSha256: Uint8Array;
  readonly reservation: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly commandBudget: DeclarativeV2VerifierStoredFrameMetadataV2;
  readonly reservedByFence: bigint;
  readonly reservedAt: Date;
  readonly pageCount: bigint;
  readonly lastPageSha256: Uint8Array | null;
  readonly outputManifest: DeclarativeV2VerifierStoredFrameMetadataV2 | null;
  readonly commandUsage: DeclarativeV2VerifierStoredFrameMetadataV2 | null;
  readonly resultingUsage: DeclarativeV2VerifierStoredFrameMetadataV2 | null;
  readonly nextProgress: DeclarativeV2VerifierStoredFrameMetadataV2 | null;
  readonly receipt: DeclarativeV2VerifierStoredFrameMetadataV2 | null;
  readonly settledAt: Date | null;
}

export interface DeclarativeV2VerifierDecodedStoredFrameV2<
  Frame extends DeclarativeV2VerifierProgressFrameV2 =
    DeclarativeV2VerifierProgressFrameV2,
> {
  readonly frame: Frame;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export interface DeclarativeV2VerifierDecodedAttemptStoredStateV2 {
  readonly metadata: DeclarativeV2VerifierStoredAttemptMetadataV2;
  readonly identity: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierAttemptIdentityFrameV2
  >;
  readonly ceilings: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_ceilings" }
  >;
  readonly usage: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" }
  >;
  readonly progress: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierProgressCursorFrameV2
  >;
}

export interface DeclarativeV2VerifierStoredCommandSettlementInputV2 {
  readonly outputManifestBytes: unknown;
  readonly outputManifestObservedSha256: unknown;
  readonly commandUsageBytes: unknown;
  readonly commandUsageObservedSha256: unknown;
  readonly resultingUsageBytes: unknown;
  readonly resultingUsageObservedSha256: unknown;
  readonly nextProgressBytes: unknown;
  readonly nextProgressObservedSha256: unknown;
  readonly receiptBytes: unknown;
  readonly receiptObservedSha256: unknown;
}

export interface DeclarativeV2VerifierDecodedCommandSettlementV2 {
  readonly outputManifest: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierCommandOutputManifestFrameV2
  >;
  readonly commandUsage: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" }
  >;
  readonly resultingUsage: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "attempt_usage" }
  >;
  readonly nextProgress: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierProgressCursorFrameV2
  >;
  readonly receipt: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierCommandReceiptFrameV2
  >;
}

export interface DeclarativeV2VerifierDecodedCommandStoredStateV2 {
  readonly metadata: DeclarativeV2VerifierStoredCommandMetadataV2;
  readonly reservation: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierCommandReservationFrameV2
  >;
  readonly commandBudget: DeclarativeV2VerifierDecodedStoredFrameV2<
    DeclarativeV2VerifierBudgetFrameV2 & { readonly kind: "command_budget" }
  >;
  readonly settlement: DeclarativeV2VerifierDecodedCommandSettlementV2 | null;
}

export interface DeclarativeV2VerifierCommittedCommandAttemptStateV2 {
  readonly candidateSha256: Uint8Array;
  readonly lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"];
  readonly settledSequence: bigint;
  readonly lastReceiptSha256: Uint8Array;
  readonly usageSha256: Uint8Array;
  readonly progressSha256: Uint8Array;
  readonly phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"];
}

export class DeclarativeV2VerifierProgressV2StoredRowError
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressV2StoredRowError",
  )<{
    readonly operation:
      | "decodeBudget"
      | "decodeFrameMetadata"
      | "decodeFrame"
      | "decodeAttemptMetadata"
      | "decodeCommandMetadata"
      | "decodePageMetadata"
      | "decodePagePayload";
    readonly reason:
      | "invalidInput"
      | "invalidMetadata"
      | "budgetExceeded"
      | "digestMismatch"
      | "invalidStoredBytes"
      | "normalizedMismatch";
    readonly path?: string;
    readonly observed?: bigint;
    readonly maximum?: bigint;
    readonly codecCause?: DeclarativeV2VerifierProgressV2Error;
  }> {}

type StoredRowOperation =
  DeclarativeV2VerifierProgressV2StoredRowError["operation"];

const FRAME_METADATA_KEYS = Object.freeze([
  "codecVersion",
  "byteLength",
  "sha256",
] as const);

const PAGE_METADATA_KEYS = Object.freeze([
  "scopeId",
  "attemptSha256",
  "sequence",
  "commandKind",
  "reservationSha256",
  "pageOrdinal",
  "pageSha256",
  "firstEvidenceOrdinal",
  "evidenceCount",
  "firstDiagnosticOrdinal",
  "diagnosticCount",
  "predecessorPageSha256",
  "cumulativeDiagnosticsRootSha256",
  "manifestCodecVersion",
  "manifestByteLength",
  "manifestSha256",
  "payloadCodecVersion",
  "payloadByteLength",
  "payloadSha256",
  "createdAt",
] as const);

const ATTEMPT_METADATA_KEYS = Object.freeze([
  "scopeId",
  "attemptSha256",
  "candidateSha256",
  "lifecycle",
  "writerOwnerId",
  "writerFence",
  "leaseUpdatedAt",
  "leaseExpiresAt",
  "settledSequence",
  "lastReceiptSha256",
  "pendingKind",
  "pendingSequence",
  "pendingReservationSha256",
  "pendingReservedByFence",
  "pendingStartedAt",
  "identityCodecVersion",
  "identityByteLength",
  "identitySha256",
  "ceilingsCodecVersion",
  "ceilingsByteLength",
  "ceilingsSha256",
  "usageCodecVersion",
  "usageByteLength",
  "usageSha256",
  "progressCodecVersion",
  "progressByteLength",
  "progressSha256",
  "createdAt",
  "updatedAt",
] as const);

const COMMAND_METADATA_KEYS = Object.freeze([
  "scopeId",
  "attemptSha256",
  "sequence",
  "commandKind",
  "reservationSha256",
  "reservationCodecVersion",
  "reservationByteLength",
  "reservationFrameSha256",
  "commandBudgetCodecVersion",
  "commandBudgetByteLength",
  "commandBudgetSha256",
  "reservedByFence",
  "reservedAt",
  "pageCount",
  "lastPageSha256",
  "outputManifestCodecVersion",
  "outputManifestByteLength",
  "outputManifestSha256",
  "commandUsageCodecVersion",
  "commandUsageByteLength",
  "commandUsageSha256",
  "resultingUsageCodecVersion",
  "resultingUsageByteLength",
  "resultingUsageSha256",
  "nextProgressCodecVersion",
  "nextProgressByteLength",
  "nextProgressSha256",
  "receiptCodecVersion",
  "receiptByteLength",
  "receiptSha256",
  "settledAt",
] as const);

const COMMAND_SETTLEMENT_INPUT_KEYS = Object.freeze([
  "outputManifestBytes",
  "outputManifestObservedSha256",
  "commandUsageBytes",
  "commandUsageObservedSha256",
  "resultingUsageBytes",
  "resultingUsageObservedSha256",
  "nextProgressBytes",
  "nextProgressObservedSha256",
  "receiptBytes",
  "receiptObservedSha256",
] as const);

const COMMITTED_COMMAND_ATTEMPT_STATE_KEYS = Object.freeze([
  "candidateSha256",
  "lifecycle",
  "settledSequence",
  "lastReceiptSha256",
  "usageSha256",
  "progressSha256",
  "phase",
] as const);

export function decodeDeclarativeV2VerifierStoredFrameBudgetV2(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierStoredFrameBudgetV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const record = yield* captureExactOwnDataRecord(
      input,
      [
        "maximumFrameBytes",
        "maximumCanonicalBytes",
        "maximumPayloadBytes",
      ],
      "decodeBudget",
    );
    const maximumFrameBytes = record.maximumFrameBytes;
    const maximumCanonicalBytes = record.maximumCanonicalBytes;
    const maximumPayloadBytes = record.maximumPayloadBytes;
    if (
      !isNonNegativeSafeInteger(maximumFrameBytes) ||
      !isNonNegativeSafeInteger(maximumCanonicalBytes) ||
      !isNonNegativeSafeInteger(maximumPayloadBytes)
    ) {
      return yield* fail("decodeBudget", "invalidInput", "budget");
    }
    return Object.freeze({
      maximumFrameBytes,
      maximumCanonicalBytes,
      maximumPayloadBytes,
    });
  });
}

export function decodeDeclarativeV2VerifierStoredFrameMetadataV2(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierStoredFrameMetadataV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const record = yield* captureExactOwnDataRecord(
      input,
      FRAME_METADATA_KEYS,
      "decodeFrameMetadata",
    );
    const metadata = yield* decodeFrameMetadataFields(
      record.codecVersion,
      record.byteLength,
      record.sha256,
      "decodeFrameMetadata",
      "frame",
    );
    return metadata;
  });
}

export function decodeDeclarativeV2VerifierAttemptMetadataRowV2(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierStoredAttemptMetadataV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const row = yield* captureExactOwnDataRecord(
      input,
      ATTEMPT_METADATA_KEYS,
      "decodeAttemptMetadata",
    );
    if (
      !isNonBlankString(row.scopeId) ||
      !isDigest(row.attemptSha256) ||
      !isDigest(row.candidateSha256) ||
      !isLifecycle(row.lifecycle) ||
      (
        row.writerOwnerId !== null &&
        (
          typeof row.writerOwnerId !== "string" ||
          !isLowercaseUuidText(row.writerOwnerId)
        )
      ) ||
      !isNonNegativeInt64(row.writerFence) ||
      !isNonNegativeInt64(row.settledSequence) ||
      !isOptionalDigest(row.lastReceiptSha256)
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "invalidMetadata",
        "attempt",
      );
    }
    const leaseUpdatedAt = copyOptionalFiniteDate(row.leaseUpdatedAt);
    const leaseExpiresAt = copyOptionalFiniteDate(row.leaseExpiresAt);
    const pendingStartedAt = copyOptionalFiniteDate(row.pendingStartedAt);
    if (
      leaseUpdatedAt === undefined ||
      leaseExpiresAt === undefined ||
      pendingStartedAt === undefined
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "invalidMetadata",
        "timestamps",
      );
    }
    const hasLease = row.writerOwnerId !== null;
    if (
      hasLease !== (leaseUpdatedAt !== null) ||
      hasLease !== (leaseExpiresAt !== null) ||
      (
        hasLease &&
        (
          row.writerFence < 1n ||
          leaseExpiresAt!.getTime() <= leaseUpdatedAt!.getTime() ||
          isClosedLifecycle(row.lifecycle)
        )
      )
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "lease",
      );
    }
    if (
      (row.settledSequence === 0n) !== (row.lastReceiptSha256 === null)
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "settledSequence",
      );
    }
    const hasPending = row.pendingKind !== null;
    if (
      hasPending !== (row.pendingSequence !== null) ||
      hasPending !== (row.pendingReservationSha256 !== null) ||
      hasPending !== (row.pendingReservedByFence !== null) ||
      hasPending !== (pendingStartedAt !== null)
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "pending",
      );
    }
    let pendingKind: DeclarativeV2VerifierDurableCommandKindV2 | null = null;
    let pendingSequence: bigint | null = null;
    let pendingReservationSha256: Uint8Array | null = null;
    let pendingReservedByFence: bigint | null = null;
    if (hasPending) {
      if (
        !isDurableCommandKind(row.pendingKind) ||
        !isPositiveInt64(row.pendingSequence) ||
        row.pendingSequence !== row.settledSequence + 1n ||
        !isDigest(row.pendingReservationSha256) ||
        !isPositiveInt64(row.pendingReservedByFence) ||
        row.pendingReservedByFence !== row.writerFence ||
        isClosedLifecycle(row.lifecycle)
      ) {
        return yield* fail(
          "decodeAttemptMetadata",
          "normalizedMismatch",
          "pending",
        );
      }
      pendingKind = row.pendingKind;
      pendingSequence = row.pendingSequence;
      pendingReservationSha256 = new Uint8Array(
        row.pendingReservationSha256,
      );
      pendingReservedByFence = row.pendingReservedByFence;
    }
    const identity = yield* decodeFrameMetadataFields(
      row.identityCodecVersion,
      row.identityByteLength,
      row.identitySha256,
      "decodeAttemptMetadata",
      "identity",
    );
    const ceilings = yield* decodeFrameMetadataFields(
      row.ceilingsCodecVersion,
      row.ceilingsByteLength,
      row.ceilingsSha256,
      "decodeAttemptMetadata",
      "ceilings",
    );
    const usage = yield* decodeFrameMetadataFields(
      row.usageCodecVersion,
      row.usageByteLength,
      row.usageSha256,
      "decodeAttemptMetadata",
      "usage",
    );
    const progress = yield* decodeFrameMetadataFields(
      row.progressCodecVersion,
      row.progressByteLength,
      row.progressSha256,
      "decodeAttemptMetadata",
      "progress",
    );
    if (!bytesEqualFullScan(row.attemptSha256, identity.sha256)) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "attemptSha256",
      );
    }
    const createdAt = copyFiniteDate(row.createdAt);
    const updatedAt = copyFiniteDate(row.updatedAt);
    if (
      createdAt === undefined ||
      updatedAt === undefined ||
      updatedAt.getTime() < createdAt.getTime()
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "invalidMetadata",
        "timestamps",
      );
    }
    return Object.freeze({
      scopeId: row.scopeId,
      attemptSha256: new Uint8Array(row.attemptSha256),
      candidateSha256: new Uint8Array(row.candidateSha256),
      lifecycle: row.lifecycle,
      writerOwnerId: row.writerOwnerId,
      writerFence: row.writerFence,
      leaseUpdatedAt,
      leaseExpiresAt,
      settledSequence: row.settledSequence,
      lastReceiptSha256: row.lastReceiptSha256 === null
        ? null
        : new Uint8Array(row.lastReceiptSha256),
      pendingKind,
      pendingSequence,
      pendingReservationSha256,
      pendingReservedByFence,
      pendingStartedAt,
      identity,
      ceilings,
      usage,
      progress,
      createdAt,
      updatedAt,
    });
  });
}

export function decodeDeclarativeV2VerifierCommandMetadataRowV2(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierStoredCommandMetadataV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const row = yield* captureExactOwnDataRecord(
      input,
      COMMAND_METADATA_KEYS,
      "decodeCommandMetadata",
    );
    if (
      !isNonBlankString(row.scopeId) ||
      !isDigest(row.attemptSha256) ||
      !isPositiveInt64(row.sequence) ||
      !isDurableCommandKind(row.commandKind) ||
      !isDigest(row.reservationSha256) ||
      !isPositiveInt64(row.reservedByFence) ||
      !isNonNegativeInt64(row.pageCount) ||
      !isOptionalDigest(row.lastPageSha256)
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "invalidMetadata",
        "command",
      );
    }
    const reservedAt = copyFiniteDate(row.reservedAt);
    const settledAt = copyOptionalFiniteDate(row.settledAt);
    if (reservedAt === undefined || settledAt === undefined) {
      return yield* fail(
        "decodeCommandMetadata",
        "invalidMetadata",
        "timestamps",
      );
    }
    if (
      (row.pageCount === 0n) !== (row.lastPageSha256 === null) ||
      (
        row.pageCount > 0n &&
        row.commandKind !== "parse_module" &&
        row.commandKind !== "link_page"
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "pageTail",
      );
    }
    const reservation = yield* decodeFrameMetadataFields(
      row.reservationCodecVersion,
      row.reservationByteLength,
      row.reservationFrameSha256,
      "decodeCommandMetadata",
      "reservation",
    );
    const commandBudget = yield* decodeFrameMetadataFields(
      row.commandBudgetCodecVersion,
      row.commandBudgetByteLength,
      row.commandBudgetSha256,
      "decodeCommandMetadata",
      "commandBudget",
    );
    if (!bytesEqualFullScan(row.reservationSha256, reservation.sha256)) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "reservationSha256",
      );
    }
    const outputManifest = yield* decodeNullableFrameMetadataFields(
      row.outputManifestCodecVersion,
      row.outputManifestByteLength,
      row.outputManifestSha256,
      "decodeCommandMetadata",
      "outputManifest",
    );
    const commandUsage = yield* decodeNullableFrameMetadataFields(
      row.commandUsageCodecVersion,
      row.commandUsageByteLength,
      row.commandUsageSha256,
      "decodeCommandMetadata",
      "commandUsage",
    );
    const resultingUsage = yield* decodeNullableFrameMetadataFields(
      row.resultingUsageCodecVersion,
      row.resultingUsageByteLength,
      row.resultingUsageSha256,
      "decodeCommandMetadata",
      "resultingUsage",
    );
    const nextProgress = yield* decodeNullableFrameMetadataFields(
      row.nextProgressCodecVersion,
      row.nextProgressByteLength,
      row.nextProgressSha256,
      "decodeCommandMetadata",
      "nextProgress",
    );
    const receipt = yield* decodeNullableFrameMetadataFields(
      row.receiptCodecVersion,
      row.receiptByteLength,
      row.receiptSha256,
      "decodeCommandMetadata",
      "receipt",
    );
    const settlementPresence = [
      outputManifest,
      commandUsage,
      resultingUsage,
      nextProgress,
      receipt,
      settledAt,
    ].map((value) => value !== null);
    if (
      settlementPresence.some((present) => present !== settlementPresence[0])
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "settlement",
      );
    }
    if (
      settledAt !== null &&
      (
        settledAt.getTime() < reservedAt.getTime() ||
        (
          (row.commandKind === "parse_module" ||
            row.commandKind === "link_page") &&
          row.pageCount < 1n
        )
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "settlement",
      );
    }
    return Object.freeze({
      scopeId: row.scopeId,
      attemptSha256: new Uint8Array(row.attemptSha256),
      sequence: row.sequence,
      commandKind: row.commandKind,
      reservationSha256: new Uint8Array(row.reservationSha256),
      reservation,
      commandBudget,
      reservedByFence: row.reservedByFence,
      reservedAt,
      pageCount: row.pageCount,
      lastPageSha256: row.lastPageSha256 === null
        ? null
        : new Uint8Array(row.lastPageSha256),
      outputManifest,
      commandUsage,
      resultingUsage,
      nextProgress,
      receipt,
      settledAt,
    });
  });
}

export function decodeDeclarativeV2VerifierStoredFrameV2<
  Kind extends DeclarativeV2VerifierProgressFrameV2["kind"],
>(
  metadata: DeclarativeV2VerifierStoredFrameMetadataV2,
  bytesInput: unknown,
  observedSha256Input: unknown,
  expectedKind: Kind,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierDecodedStoredFrameV2<
    Extract<DeclarativeV2VerifierProgressFrameV2, { readonly kind: Kind }>
  >,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const budget = yield* decodeDeclarativeV2VerifierStoredFrameBudgetV2(
      rawBudget,
    );
    if (metadata.byteLength > BigInt(budget.maximumFrameBytes)) {
      return yield* limitFailure(
        "decodeFrame",
        "frameBytes",
        metadata.byteLength,
        BigInt(budget.maximumFrameBytes),
      );
    }
    if (metadata.byteLength > BigInt(budget.maximumCanonicalBytes)) {
      return yield* limitFailure(
        "decodeFrame",
        "canonicalBytes",
        metadata.byteLength,
        BigInt(budget.maximumCanonicalBytes),
      );
    }
    if (
      !isUint8ArrayWithByteLength(bytesInput, Number(metadata.byteLength))
    ) {
      return yield* fail("decodeFrame", "invalidStoredBytes", "byteLength");
    }
    if (!isUint8ArrayWithByteLength(observedSha256Input, 32)) {
      return yield* fail(
        "decodeFrame",
        "invalidInput",
        "observedSha256",
      );
    }
    if (!bytesEqualFullScan(observedSha256Input, metadata.sha256)) {
      return yield* fail("decodeFrame", "digestMismatch", "sha256");
    }
    let owned: Uint8Array;
    try {
      owned = new Uint8Array(bytesInput);
    } catch {
      return yield* fail("decodeFrame", "invalidStoredBytes", "bytes");
    }
    const decoded = decodeDeclarativeV2VerifierProgressFrameV2(owned, {
      maximumFrameBytes: budget.maximumFrameBytes,
      maximumCanonicalBytes: budget.maximumCanonicalBytes,
    });
    if (Result.isFailure(decoded)) {
      return yield* Result.fail(
        new DeclarativeV2VerifierProgressV2StoredRowError({
          operation: "decodeFrame",
          reason: "invalidStoredBytes",
          path: "canonicalFrame",
          codecCause: decoded.failure,
        }),
      );
    }
    if (decoded.success.frame.kind !== expectedKind) {
      return yield* fail("decodeFrame", "normalizedMismatch", "kind");
    }
    return Object.freeze({
      frame: decoded.success.frame as Extract<
        DeclarativeV2VerifierProgressFrameV2,
        { readonly kind: Kind }
      >,
      canonicalBytes: decoded.success.canonicalBytes,
      sha256: new Uint8Array(metadata.sha256),
    });
  });
}

/**
 * Decodes the complete attempt row boundary and proves that every normalized
 * lineage field duplicated in canonical frames agrees with those frames.
 */
export function decodeDeclarativeV2VerifierAttemptStoredStateV2(
  metadataInput: unknown,
  identityBytesInput: unknown,
  identityObservedSha256Input: unknown,
  ceilingsBytesInput: unknown,
  ceilingsObservedSha256Input: unknown,
  usageBytesInput: unknown,
  usageObservedSha256Input: unknown,
  progressBytesInput: unknown,
  progressObservedSha256Input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierDecodedAttemptStoredStateV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const metadata = yield* decodeDeclarativeV2VerifierAttemptMetadataRowV2(
      metadataInput,
    );
    const identity = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.identity,
      identityBytesInput,
      identityObservedSha256Input,
      "attempt_identity",
      rawBudget,
    );
    const ceilings = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.ceilings,
      ceilingsBytesInput,
      ceilingsObservedSha256Input,
      "attempt_ceilings",
      rawBudget,
    );
    const usage = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.usage,
      usageBytesInput,
      usageObservedSha256Input,
      "attempt_usage",
      rawBudget,
    );
    const progress = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.progress,
      progressBytesInput,
      progressObservedSha256Input,
      "progress_cursor",
      rawBudget,
    );
    if (
      !bytesEqualFullScan(
        identity.frame.candidateSha256,
        metadata.candidateSha256,
      ) ||
      !bytesEqualFullScan(
        identity.frame.ceilingsSha256,
        metadata.ceilings.sha256,
      )
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "identity",
      );
    }
    if (!budgetFrameWithin(usage.frame, ceilings.frame)) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "usage",
      );
    }
    // The progress frame retains the reservation predecessor receipt. The
    // current receipt separately commits nextProgressSha256, so comparing the
    // progress field to the current receipt would create a hash cycle. The
    // later repository binds lastReceiptSha256 to the settled command row.
    if (
      progress.frame.settledSequence !== metadata.settledSequence ||
      !isLifecyclePhaseCoherent(metadata.lifecycle, progress.frame.phase)
    ) {
      return yield* fail(
        "decodeAttemptMetadata",
        "normalizedMismatch",
        "progress",
      );
    }
    return Object.freeze({
      metadata,
      identity,
      ceilings,
      usage,
      progress,
    });
  });
}

/**
 * Decodes the complete command row boundary and verifies canonical frame
 * commitments against normalized row mechanics and authoritative predecessor
 * comparisons supplied by the later locked repository operation.
 */
export function decodeDeclarativeV2VerifierCommandStoredStateV2(
  metadataInput: unknown,
  expectedCandidateSha256Input: unknown,
  expectedCurrentProgressSha256Input: unknown,
  expectedPredecessorReceiptSha256Input: unknown,
  expectedCurrentLifecycleInput: unknown,
  expectedCurrentPhaseInput: unknown,
  expectedNextLifecycleInput: unknown,
  reservationBytesInput: unknown,
  reservationObservedSha256Input: unknown,
  commandBudgetBytesInput: unknown,
  commandBudgetObservedSha256Input: unknown,
  settlementInput: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierDecodedCommandStoredStateV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const metadata = yield* decodeDeclarativeV2VerifierCommandMetadataRowV2(
      metadataInput,
    );
    if (
      !isDigest(expectedCandidateSha256Input) ||
      !isDigest(expectedCurrentProgressSha256Input) ||
      !isOptionalDigest(expectedPredecessorReceiptSha256Input) ||
      !isLifecycle(expectedCurrentLifecycleInput) ||
      !isPhase(expectedCurrentPhaseInput) ||
      !isLifecycle(expectedNextLifecycleInput)
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "invalidInput",
        "lineage",
      );
    }
    if (
      !isLifecyclePhaseCoherent(
        expectedCurrentLifecycleInput,
        expectedCurrentPhaseInput,
      ) ||
      !isCommandAllowed(
        expectedCurrentLifecycleInput,
        expectedCurrentPhaseInput,
        metadata.commandKind,
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "lifecycle",
      );
    }
    const decoded = yield* decodeCommandFramesAndSettlementV2(
      metadata,
      reservationBytesInput,
      reservationObservedSha256Input,
      commandBudgetBytesInput,
      commandBudgetObservedSha256Input,
      settlementInput,
      rawBudget,
    );
    if (
      !bytesEqualFullScan(
        decoded.reservation.frame.candidateSha256,
        expectedCandidateSha256Input,
      ) ||
      !bytesEqualFullScan(
        decoded.reservation.frame.currentProgressSha256,
        expectedCurrentProgressSha256Input,
      ) ||
      !optionalDigestsEqual(
        decoded.reservation.frame.predecessorReceiptSha256,
        expectedPredecessorReceiptSha256Input,
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "reservation",
      );
    }
    if (decoded.settlement === null) {
      if (expectedNextLifecycleInput !== expectedCurrentLifecycleInput) {
        return yield* fail(
          "decodeCommandMetadata",
          "normalizedMismatch",
          "settlement",
        );
      }
      return decoded;
    }
    if (
      !isValidSettlementTransition(
        expectedCurrentLifecycleInput,
        expectedCurrentPhaseInput,
        metadata.commandKind,
        expectedNextLifecycleInput,
        decoded.settlement.nextProgress.frame.phase,
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "receipt",
      );
    }
    return decoded;
  });
}

/**
 * Decodes an already-settled command from the post-settlement attempt state.
 *
 * The attempt state is an inert durable comparison boundary, not writer
 * authority. This path deliberately requires the latest settled command so a
 * cold reader never reconstructs historical predecessor authority from stored
 * bytes alone.
 */
export function decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
  metadataInput: unknown,
  postSettlementAttemptStateInput: unknown,
  reservationBytesInput: unknown,
  reservationObservedSha256Input: unknown,
  commandBudgetBytesInput: unknown,
  commandBudgetObservedSha256Input: unknown,
  settlementInput: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierDecodedCommandStoredStateV2 & {
    readonly settlement: DeclarativeV2VerifierDecodedCommandSettlementV2;
  },
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const metadata = yield* decodeDeclarativeV2VerifierCommandMetadataRowV2(
      metadataInput,
    );
    const postRecord = yield* captureExactOwnDataRecord(
      postSettlementAttemptStateInput,
      COMMITTED_COMMAND_ATTEMPT_STATE_KEYS,
      "decodeCommandMetadata",
    );
    if (
      !isDigest(postRecord.candidateSha256) ||
      !isLifecycle(postRecord.lifecycle) ||
      !isPositiveInt64(postRecord.settledSequence) ||
      !isDigest(postRecord.lastReceiptSha256) ||
      !isDigest(postRecord.usageSha256) ||
      !isDigest(postRecord.progressSha256) ||
      !isPhase(postRecord.phase)
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "invalidInput",
        "postSettlementAttempt",
      );
    }
    const decoded = yield* decodeCommandFramesAndSettlementV2(
      metadata,
      reservationBytesInput,
      reservationObservedSha256Input,
      commandBudgetBytesInput,
      commandBudgetObservedSha256Input,
      settlementInput,
      rawBudget,
    );
    const settlement = decoded.settlement;
    if (
      settlement === null ||
      !bytesEqualFullScan(
        decoded.reservation.frame.candidateSha256,
        postRecord.candidateSha256,
      ) ||
      postRecord.settledSequence !== metadata.sequence ||
      !bytesEqualFullScan(
        postRecord.lastReceiptSha256,
        settlement.receipt.sha256,
      ) ||
      !bytesEqualFullScan(
        postRecord.usageSha256,
        settlement.resultingUsage.sha256,
      ) ||
      !bytesEqualFullScan(
        postRecord.progressSha256,
        settlement.nextProgress.sha256,
      ) ||
      postRecord.phase !== settlement.nextProgress.frame.phase ||
      !isValidCommittedCommandState(
        metadata.commandKind,
        postRecord.lifecycle,
        settlement.nextProgress.frame.phase,
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "postSettlementAttempt",
      );
    }
    return Object.freeze({
      ...decoded,
      settlement,
    });
  });
}

function decodeCommandFramesAndSettlementV2(
  metadata: DeclarativeV2VerifierStoredCommandMetadataV2,
  reservationBytesInput: unknown,
  reservationObservedSha256Input: unknown,
  commandBudgetBytesInput: unknown,
  commandBudgetObservedSha256Input: unknown,
  settlementInput: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierDecodedCommandStoredStateV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const reservation = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.reservation,
      reservationBytesInput,
      reservationObservedSha256Input,
      "command_reservation",
      rawBudget,
    );
    const commandBudget = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.commandBudget,
      commandBudgetBytesInput,
      commandBudgetObservedSha256Input,
      "command_budget",
      rawBudget,
    );
    if (
      !bytesEqualFullScan(
        reservation.frame.attemptSha256,
        metadata.attemptSha256,
      ) ||
      reservation.frame.commandKind !== metadata.commandKind ||
      reservation.frame.sequence !== metadata.sequence ||
      !bytesEqualFullScan(
        reservation.frame.commandBudgetSha256,
        metadata.commandBudget.sha256,
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "reservation",
      );
    }
    if (metadata.settledAt === null) {
      if (settlementInput !== null) {
        return yield* fail(
          "decodeCommandMetadata",
          "normalizedMismatch",
          "settlement",
        );
      }
      return Object.freeze({
        metadata,
        reservation,
        commandBudget,
        settlement: null,
      });
    }
    const settlementRecord = yield* captureExactOwnDataRecord(
      settlementInput,
      COMMAND_SETTLEMENT_INPUT_KEYS,
      "decodeCommandMetadata",
    );
    const outputMetadata = metadata.outputManifest;
    const commandUsageMetadata = metadata.commandUsage;
    const resultingUsageMetadata = metadata.resultingUsage;
    const nextProgressMetadata = metadata.nextProgress;
    const receiptMetadata = metadata.receipt;
    if (
      outputMetadata === null ||
      commandUsageMetadata === null ||
      resultingUsageMetadata === null ||
      nextProgressMetadata === null ||
      receiptMetadata === null
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "settlement",
      );
    }
    const outputManifest = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      outputMetadata,
      settlementRecord.outputManifestBytes,
      settlementRecord.outputManifestObservedSha256,
      "command_output_manifest",
      rawBudget,
    );
    const commandUsage = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      commandUsageMetadata,
      settlementRecord.commandUsageBytes,
      settlementRecord.commandUsageObservedSha256,
      "command_budget",
      rawBudget,
    );
    const resultingUsage = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      resultingUsageMetadata,
      settlementRecord.resultingUsageBytes,
      settlementRecord.resultingUsageObservedSha256,
      "attempt_usage",
      rawBudget,
    );
    const nextProgress = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      nextProgressMetadata,
      settlementRecord.nextProgressBytes,
      settlementRecord.nextProgressObservedSha256,
      "progress_cursor",
      rawBudget,
    );
    const receipt = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      receiptMetadata,
      settlementRecord.receiptBytes,
      settlementRecord.receiptObservedSha256,
      "command_receipt",
      rawBudget,
    );
    if (
      !bytesEqualFullScan(
        outputManifest.frame.reservationSha256,
        metadata.reservationSha256,
      ) ||
      outputManifest.frame.commandKind !== metadata.commandKind ||
      outputManifest.frame.sequence !== metadata.sequence ||
      !bytesEqualFullScan(
        outputManifest.frame.nextProgressSha256,
        nextProgressMetadata.sha256,
      ) ||
      (
        (metadata.commandKind === "parse_module" ||
          metadata.commandKind === "link_page") &&
        (
          metadata.lastPageSha256 === null ||
          !bytesEqualFullScan(
            outputManifest.frame.evidenceRootSha256,
            metadata.lastPageSha256,
          )
        )
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "outputManifest",
      );
    }
    if (
      !budgetFrameWithin(commandUsage.frame, commandBudget.frame) ||
      !budgetFrameWithin(commandUsage.frame, resultingUsage.frame)
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "usage",
      );
    }
    if (
      !bytesEqualFullScan(
        receipt.frame.reservationSha256,
        metadata.reservationSha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.commandUsageSha256,
        commandUsageMetadata.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.resultingAttemptUsageSha256,
        resultingUsageMetadata.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.outputManifestSha256,
        outputMetadata.sha256,
      ) ||
      !bytesEqualFullScan(
        receipt.frame.nextProgressSha256,
        nextProgressMetadata.sha256,
      ) ||
      nextProgress.frame.settledSequence !== metadata.sequence ||
      !optionalDigestsEqual(
        nextProgress.frame.previousReceiptSha256,
        reservation.frame.predecessorReceiptSha256,
      )
    ) {
      return yield* fail(
        "decodeCommandMetadata",
        "normalizedMismatch",
        "receipt",
      );
    }
    return Object.freeze({
      metadata,
      reservation,
      commandBudget,
      settlement: Object.freeze({
        outputManifest,
        commandUsage,
        resultingUsage,
        nextProgress,
        receipt,
      }),
    });
  });
}

/**
 * Decodes the metadata-only page projection used before a payload SELECT.
 *
 * The exact accepted row deliberately has no manifest-bytes or payload-bytes
 * property. A later repository must issue separate exact-key reads only after
 * this decoder and the caller's byte ceilings succeed.
 */
export function decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(
  input: unknown,
): Result.Result<
  DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const row = yield* captureExactOwnDataRecord(
      input,
      PAGE_METADATA_KEYS,
      "decodePageMetadata",
    );
    if (
      !isNonBlankString(row.scopeId) ||
      !isDigest(row.attemptSha256) ||
      !isPositiveInt64(row.sequence) ||
      (row.commandKind !== "parse_module" && row.commandKind !== "link_page") ||
      !isDigest(row.reservationSha256) ||
      !isNonNegativeInt64(row.pageOrdinal) ||
      !isDigest(row.pageSha256) ||
      !isNonNegativeInt64(row.firstEvidenceOrdinal) ||
      !isPositiveInt64(row.evidenceCount) ||
      !isNonNegativeInt64(row.firstDiagnosticOrdinal) ||
      !isNonNegativeInt64(row.diagnosticCount) ||
      row.diagnosticCount > row.evidenceCount ||
      !isOptionalDigest(row.predecessorPageSha256) ||
      !isDigest(row.cumulativeDiagnosticsRootSha256) ||
      row.payloadCodecVersion !== RESTART_PAYLOAD_CODEC_VERSION ||
      !isPositiveInt64(row.payloadByteLength) ||
      !isDigest(row.payloadSha256)
    ) {
      return yield* fail(
        "decodePageMetadata",
        "invalidMetadata",
        "page",
      );
    }
    if (
      row.firstEvidenceOrdinal > MAX_SIGNED_INT64 - row.evidenceCount ||
      row.firstDiagnosticOrdinal > MAX_SIGNED_INT64 - row.diagnosticCount ||
      (
        row.pageOrdinal === 0n &&
        (
          row.firstEvidenceOrdinal !== 0n ||
          row.firstDiagnosticOrdinal !== 0n ||
          row.predecessorPageSha256 !== null
        )
      ) ||
      (row.pageOrdinal > 0n && row.predecessorPageSha256 === null)
    ) {
      return yield* fail(
        "decodePageMetadata",
        "normalizedMismatch",
        "range",
      );
    }
    const createdAt = copyFiniteDate(row.createdAt);
    if (createdAt === undefined) {
      return yield* fail(
        "decodePageMetadata",
        "invalidMetadata",
        "createdAt",
      );
    }
    const manifest = yield* decodeFrameMetadataFields(
      row.manifestCodecVersion,
      row.manifestByteLength,
      row.manifestSha256,
      "decodePageMetadata",
      "manifest",
    );
    if (!bytesEqualFullScan(row.pageSha256, manifest.sha256)) {
      return yield* fail(
        "decodePageMetadata",
        "normalizedMismatch",
        "pageSha256",
      );
    }
    return Object.freeze({
      scopeId: row.scopeId,
      attemptSha256: new Uint8Array(row.attemptSha256),
      sequence: row.sequence,
      commandKind: row.commandKind,
      reservationSha256: new Uint8Array(row.reservationSha256),
      pageOrdinal: row.pageOrdinal,
      pageSha256: new Uint8Array(row.pageSha256),
      firstEvidenceOrdinal: row.firstEvidenceOrdinal,
      evidenceCount: row.evidenceCount,
      firstDiagnosticOrdinal: row.firstDiagnosticOrdinal,
      diagnosticCount: row.diagnosticCount,
      predecessorPageSha256: row.predecessorPageSha256 === null
        ? null
        : new Uint8Array(row.predecessorPageSha256),
      cumulativeDiagnosticsRootSha256: new Uint8Array(
        row.cumulativeDiagnosticsRootSha256,
      ),
      manifest,
      payloadCodecVersion: RESTART_PAYLOAD_CODEC_VERSION,
      payloadByteLength: row.payloadByteLength,
      payloadSha256: new Uint8Array(row.payloadSha256),
      createdAt,
    });
  });
}

export function decodeDeclarativeV2VerifierEvidencePagePayloadV2(
  metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  payloadBytesInput: unknown,
  observedSha256Input: unknown,
  rawBudget: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const budget = yield* decodeDeclarativeV2VerifierStoredFrameBudgetV2(
      rawBudget,
    );
    if (metadata.payloadByteLength > BigInt(budget.maximumPayloadBytes)) {
      return yield* limitFailure(
        "decodePagePayload",
        "payloadBytes",
        metadata.payloadByteLength,
        BigInt(budget.maximumPayloadBytes),
      );
    }
    if (
      !isUint8ArrayWithByteLength(
        payloadBytesInput,
        Number(metadata.payloadByteLength),
      )
    ) {
      return yield* fail(
        "decodePagePayload",
        "invalidStoredBytes",
        "payloadByteLength",
      );
    }
    if (!isUint8ArrayWithByteLength(observedSha256Input, 32)) {
      return yield* fail(
        "decodePagePayload",
        "invalidInput",
        "observedSha256",
      );
    }
    if (!bytesEqualFullScan(observedSha256Input, metadata.payloadSha256)) {
      return yield* fail(
        "decodePagePayload",
        "digestMismatch",
        "payloadSha256",
      );
    }
    try {
      return new Uint8Array(payloadBytesInput);
    } catch {
      return yield* fail(
        "decodePagePayload",
        "invalidStoredBytes",
        "payloadBytes",
      );
    }
  });
}

export function decodeDeclarativeV2VerifierEvidencePageManifestV2(
  metadata: DeclarativeV2VerifierStoredEvidencePageMetadataV2,
  manifestBytesInput: unknown,
  observedSha256Input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierDecodedStoredFrameV2<
    Extract<
      DeclarativeV2VerifierProgressFrameV2,
      { readonly kind: "evidence_page_manifest" }
    >
  >,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  return Result.gen(function* () {
    const decoded = yield* decodeDeclarativeV2VerifierStoredFrameV2(
      metadata.manifest,
      manifestBytesInput,
      observedSha256Input,
      "evidence_page_manifest",
      rawBudget,
    );
    const frame = decoded.frame;
    if (
      !bytesEqualFullScan(frame.reservationSha256, metadata.reservationSha256) ||
      frame.commandKind !== metadata.commandKind ||
      frame.sequence !== metadata.sequence ||
      frame.pageOrdinal !== metadata.pageOrdinal ||
      frame.firstEvidenceOrdinal !== metadata.firstEvidenceOrdinal ||
      frame.evidenceCount !== metadata.evidenceCount ||
      frame.firstDiagnosticOrdinal !== metadata.firstDiagnosticOrdinal ||
      frame.diagnosticCount !== metadata.diagnosticCount ||
      !optionalDigestsEqual(
        frame.predecessorPageSha256,
        metadata.predecessorPageSha256,
      ) ||
      frame.payloadByteLength !== metadata.payloadByteLength ||
      !bytesEqualFullScan(frame.payloadSha256, metadata.payloadSha256) ||
      !bytesEqualFullScan(
        frame.cumulativeDiagnosticsRootSha256,
        metadata.cumulativeDiagnosticsRootSha256,
      )
    ) {
      return yield* fail(
        "decodeFrame",
        "normalizedMismatch",
        "evidencePageManifest",
      );
    }
    return decoded;
  });
}

function decodeFrameMetadataFields(
  codecVersion: unknown,
  byteLength: unknown,
  sha256: unknown,
  operation: StoredRowOperation,
  path: string,
): Result.Result<
  DeclarativeV2VerifierStoredFrameMetadataV2,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  if (
    codecVersion !== FRAME_CODEC_VERSION ||
    !isPositiveInt64(byteLength) ||
    !isDigest(sha256)
  ) {
    return fail(operation, "invalidMetadata", path);
  }
  return Result.succeed(Object.freeze({
    codecVersion: FRAME_CODEC_VERSION,
    byteLength,
    sha256: new Uint8Array(sha256),
  }));
}

function decodeNullableFrameMetadataFields(
  codecVersion: unknown,
  byteLength: unknown,
  sha256: unknown,
  operation: StoredRowOperation,
  path: string,
): Result.Result<
  DeclarativeV2VerifierStoredFrameMetadataV2 | null,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  if (codecVersion === null && byteLength === null && sha256 === null) {
    return Result.succeed(null);
  }
  return decodeFrameMetadataFields(
    codecVersion,
    byteLength,
    sha256,
    operation,
    path,
  );
}

function captureExactOwnDataRecord(
  input: unknown,
  keys: readonly string[],
  operation: StoredRowOperation,
): Result.Result<
  Readonly<Record<string, unknown>>,
  DeclarativeV2VerifierProgressV2StoredRowError
> {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype
    ) {
      return fail(operation, "invalidInput", "row");
    }
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) {
      return fail(operation, "invalidInput", "row");
    }
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return fail(operation, "invalidInput", key);
      }
      captured[key] = descriptor.value;
    }
    return Result.succeed(Object.freeze(captured));
  } catch {
    return fail(operation, "invalidInput", "row");
  }
}

function fail(
  operation: StoredRowOperation,
  reason: DeclarativeV2VerifierProgressV2StoredRowError["reason"],
  path?: string,
): Result.Result<never, DeclarativeV2VerifierProgressV2StoredRowError> {
  return Result.fail(
    new DeclarativeV2VerifierProgressV2StoredRowError({
      operation,
      reason,
      ...(path === undefined ? {} : { path }),
    }),
  );
}

function limitFailure(
  operation: StoredRowOperation,
  path: string,
  observed: bigint,
  maximum: bigint,
): Result.Result<never, DeclarativeV2VerifierProgressV2StoredRowError> {
  return Result.fail(
    new DeclarativeV2VerifierProgressV2StoredRowError({
      operation,
      reason: "budgetExceeded",
      path,
      observed,
      maximum,
    }),
  );
}

function isNonNegativeInt64(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= MAX_SIGNED_INT64;
}

function isPositiveInt64(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 1n && value <= MAX_SIGNED_INT64;
}

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, 32);
}

function isOptionalDigest(value: unknown): value is Uint8Array | null {
  return value === null || isDigest(value);
}

function isDurableCommandKind(
  value: unknown,
): value is DeclarativeV2VerifierDurableCommandKindV2 {
  return value === "source_page" ||
    value === "parse_module" ||
    value === "link_page" ||
    value === "registration_page";
}

function isLifecycle(
  value: unknown,
): value is DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"] {
  return value === "open" ||
    value === "parsing" ||
    value === "parse_complete" ||
    value === "linking" ||
    value === "link_complete" ||
    value === "registering" ||
    value === "ready" ||
    value === "rejected" ||
    value === "abandoned";
}

function isPhase(
  value: unknown,
): value is DeclarativeV2VerifierProgressCursorFrameV2["phase"] {
  return value === "source" ||
    value === "parse" ||
    value === "link" ||
    value === "registration" ||
    value === "verdict";
}

function isLifecyclePhaseCoherent(
  lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): boolean {
  switch (lifecycle) {
    case "open":
      return phase === "source";
    case "parsing":
      return phase === "parse";
    case "parse_complete":
    case "linking":
      return phase === "link";
    case "link_complete":
      return phase === "registration";
    case "registering":
      return phase === "registration" || phase === "verdict";
    case "ready":
    case "rejected":
      return phase === "verdict";
    case "abandoned":
      return true;
  }
}

function isCommandAllowed(
  lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
): boolean {
  return lifecycle === "open" && phase === "source" &&
      commandKind === "source_page" ||
    lifecycle === "parsing" && phase === "parse" &&
      commandKind === "parse_module" ||
    (lifecycle === "parse_complete" || lifecycle === "linking") &&
      phase === "link" && commandKind === "link_page" ||
    (lifecycle === "link_complete" || lifecycle === "registering") &&
      phase === "registration" && commandKind === "registration_page";
}

function isValidSettlementTransition(
  currentLifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  currentPhase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  nextLifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  nextPhase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): boolean {
  if (isClosedLifecycle(nextLifecycle)) return false;
  switch (commandKind) {
    case "source_page":
      return currentLifecycle === "open" &&
        currentPhase === "source" &&
        (
          nextLifecycle === "open" && nextPhase === "source" ||
          nextLifecycle === "parsing" && nextPhase === "parse"
        );
    case "parse_module":
      return currentLifecycle === "parsing" &&
        currentPhase === "parse" &&
        (
          nextLifecycle === "parsing" && nextPhase === "parse" ||
          nextLifecycle === "parse_complete" && nextPhase === "link"
        );
    case "link_page":
      return (
        currentLifecycle === "parse_complete" ||
        currentLifecycle === "linking"
      ) &&
        currentPhase === "link" &&
        (
          nextLifecycle === "linking" && nextPhase === "link" ||
          nextLifecycle === "link_complete" &&
            nextPhase === "registration"
        );
    case "registration_page":
      return (
        currentLifecycle === "link_complete" ||
        currentLifecycle === "registering"
      ) &&
        currentPhase === "registration" &&
        nextLifecycle === "registering" &&
        (nextPhase === "registration" || nextPhase === "verdict");
  }
}

function isValidCommittedCommandState(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  lifecycle: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): boolean {
  if (lifecycle === "abandoned") {
    return isValidCommittedCommandPhase(commandKind, phase);
  }
  if (lifecycle === "ready" || lifecycle === "rejected") {
    return commandKind === "registration_page" && phase === "verdict";
  }
  switch (commandKind) {
    case "source_page":
      return lifecycle === "open" && phase === "source" ||
        lifecycle === "parsing" && phase === "parse";
    case "parse_module":
      return lifecycle === "parsing" && phase === "parse" ||
        lifecycle === "parse_complete" && phase === "link";
    case "link_page":
      return lifecycle === "linking" && phase === "link" ||
        lifecycle === "link_complete" && phase === "registration";
    case "registration_page":
      return lifecycle === "registering" &&
        (phase === "registration" || phase === "verdict");
  }
}

function isValidCommittedCommandPhase(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): boolean {
  switch (commandKind) {
    case "source_page":
      return phase === "source" || phase === "parse";
    case "parse_module":
      return phase === "parse" || phase === "link";
    case "link_page":
      return phase === "link" || phase === "registration";
    case "registration_page":
      return phase === "registration" || phase === "verdict";
  }
}

function isClosedLifecycle(
  value: DeclarativeV2VerifierStoredAttemptMetadataV2["lifecycle"],
): boolean {
  return value === "ready" || value === "rejected" || value === "abandoned";
}

function copyOptionalFiniteDate(value: unknown): Date | null | undefined {
  return value === null ? null : copyFiniteDate(value);
}

function optionalDigestsEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && bytesEqualFullScan(left, right);
}

function budgetFrameWithin(
  observed: DeclarativeV2VerifierBudgetFrameV2,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
): boolean {
  return DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.every(
    (dimension) => observed[dimension] <= maximum[dimension],
  );
}
