import {
  compareBytesLexicographically,
  copyBytes,
} from "@flarex/utils/bytes";
import { Data, Result } from "effect";

import {
  appRowIdHexV1ToBytes,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  type LogicalIndexRangeReadDependencyV1,
  type LogicalReadDependencyV1,
} from "flarex-protocol/commit-protocol";

import type {
  VerifiedCommitInputStateV1,
  VerifiedCommitPointV1,
  VerifiedSuccessfulResultV1,
} from "./commitInputVerification";

export class InvalidVerifiedCommitInputV1Error extends Data.TaggedError(
  "InvalidVerifiedCommitInputV1Error",
)<{
  readonly reason: "notSameFactory";
}> {}

export type UnsupportedPointCommitPlanV1Issue =
  | {
      readonly reason: "developerIndexMaintenance";
      readonly tableId: CatalogTableId;
    }
  | {
      readonly reason: "materialRowLimitExceeded";
      readonly maximum: number;
      readonly observed: number;
    }
  | {
      readonly reason: "uniqueConstraintEligibilityUnavailable";
      readonly tableId: CatalogTableId;
    }
  | {
      readonly reason: "uniqueConstraintSetNotReady";
      readonly tableId: CatalogTableId;
      readonly eligibilityReason:
        | "setNotClosed"
        | "buildMissing"
        | "buildNotEnabled"
        | "buildStale";
    }
  | { readonly reason: "unsupportedReadDependency" }
  | { readonly reason: "unsupportedPointState" };

export class UnsupportedPointCommitPlanV1Error extends Data.TaggedError(
  "UnsupportedPointCommitPlanV1Error",
)<{
  readonly issue: UnsupportedPointCommitPlanV1Issue;
}> {}

export class PointCommitUniqueConstraintEligibilityV1Error
  extends Data.TaggedError("PointCommitUniqueConstraintEligibilityV1Error")<{
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export type PointCommitPlannerInvariantV1DefectReason =
  | "deletedPointWithTombstoneDependency"
  | "nonMaterialDeletedPointSelected"
  | "unchangedPointSelected"
  | "unsupportedPointStateSelected";

export class PointCommitPlannerInvariantV1Defect extends Data.TaggedError(
  "PointCommitPlannerInvariantV1Defect",
)<{
  readonly reason: PointCommitPlannerInvariantV1DefectReason;
}> {}

export interface PreparedPointDependencyV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appRowPoint" }
  >;
}

type PreparedPointRowIntentBaseV1 = PreparedPointDependencyV1;

export type PreparedPointRowIntentV1 =
  | Readonly<PreparedPointRowIntentBaseV1 & {
      readonly kind: "live";
      readonly creationTime: Extract<
        VerifiedCommitPointV1,
        { readonly kind: "live" }
      >["creationTime"];
      readonly value: Extract<
        VerifiedCommitPointV1,
        { readonly kind: "live" }
      >["value"];
      readonly canonicalBytes: Uint8Array;
      readonly semanticSizeBytes: number;
    }>
  | Readonly<PreparedPointRowIntentBaseV1 & {
      readonly kind: "deleted";
    }>;

export interface PreparedPointCommitStateV1 {
  readonly authorityPins: VerifiedCommitInputStateV1["authorityPins"];
  readonly sealIdentity: VerifiedCommitInputStateV1["sealIdentity"];
  readonly dependencies: ReadonlyArray<PreparedPointDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<
    LogicalIndexRangeReadDependencyV1
  >;
  readonly rowIntents: ReadonlyArray<PreparedPointRowIntentV1>;
  readonly successfulResult: Readonly<VerifiedSuccessfulResultV1>;
}

interface OrderedPointCandidateV1 {
  readonly point: VerifiedCommitPointV1;
  readonly dependency: PreparedPointDependencyV1;
  readonly rowBytes: Uint8Array;
}

export interface PointCommitPlannerCapabilitiesV1 {
  readonly developerIndexMaintenance?: "c08-a-v1";
  readonly uniqueConstraints?:
    | Readonly<{ readonly status: "unavailable" }>
    | Readonly<{ readonly status: "not_required" }>
    | Readonly<{
        readonly status: "not_ready";
        readonly reason:
          | "setNotClosed"
        | "buildMissing"
        | "buildNotEnabled"
        | "buildStale";
        readonly blocksAllTables: boolean;
        readonly tableIds: ReadonlyArray<CatalogTableId>;
      }>
    | Readonly<{
        readonly status: "eligible";
        readonly tableIds: ReadonlyArray<CatalogTableId>;
      }>;
}

export function planPointCommitStateV1(
  source: VerifiedCommitInputStateV1,
  capabilities: PointCommitPlannerCapabilitiesV1 = {},
): Result.Result<
  PreparedPointCommitStateV1,
  UnsupportedPointCommitPlanV1Error
> {
  return Result.gen(function* () {
    const indexRangeDependencies = yield* captureIndexRangeDependencies(
      source.journal.readDependencies,
    );

    const candidates: OrderedPointCandidateV1[] = [];
    const materialCandidates: OrderedPointCandidateV1[] = [];

    for (const point of source.points) {
      const capturedDependency = yield* captureLogicalReadDependency(
        point.dependency,
      );
      const dependency = Object.freeze({
        documentId: point.documentId,
        tableId: point.tableId,
        rowId: point.rowId,
        dependency: capturedDependency,
      } satisfies PreparedPointDependencyV1);
      const candidate = Object.freeze({
        point,
        dependency,
        rowBytes: appRowIdHexV1ToBytes(point.rowId),
      } satisfies OrderedPointCandidateV1);
      candidates.push(candidate);

      const material = yield* isNetMaterialPoint(point);
      if (material) materialCandidates.push(candidate);
    }

    candidates.sort(comparePointCandidates);
    materialCandidates.sort(comparePointCandidates);

    if (materialCandidates.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) {
      return yield* Result.fail(new UnsupportedPointCommitPlanV1Error({
        issue: {
          reason: "materialRowLimitExceeded",
          maximum: MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
          observed: materialCandidates.length,
        },
      }));
    }

    if (capabilities.developerIndexMaintenance !== "c08-a-v1") {
      for (const materialCandidate of materialCandidates) {
        if (source.schemaManifest.indexBindings.indexes.some(
          (index) => index.tableId === materialCandidate.point.tableId,
        )) {
          return yield* Result.fail(new UnsupportedPointCommitPlanV1Error({
            issue: {
              reason: "developerIndexMaintenance",
              tableId: materialCandidate.point.tableId,
            },
          }));
        }
      }
    }

    if (capabilities.uniqueConstraints?.status === "unavailable") {
      const first = materialCandidates[0];
      if (first !== undefined) {
        return yield* Result.fail(new UnsupportedPointCommitPlanV1Error({
          issue: {
            reason: "uniqueConstraintEligibilityUnavailable",
            tableId: first.point.tableId,
          },
        }));
      }
    }
    if (capabilities.uniqueConstraints?.status === "not_ready") {
      const blocked = materialCandidates.find((candidate) =>
        capabilities.uniqueConstraints?.status === "not_ready" &&
        (capabilities.uniqueConstraints.blocksAllTables ||
          capabilities.uniqueConstraints.tableIds.includes(
            candidate.point.tableId,
          ))
      );
      if (blocked !== undefined) {
        return yield* Result.fail(new UnsupportedPointCommitPlanV1Error({
          issue: {
            reason: "uniqueConstraintSetNotReady",
            tableId: blocked.point.tableId,
            eligibilityReason: capabilities.uniqueConstraints.reason,
          },
        }));
      }
    }

    const dependencies = Object.freeze(
      candidates.map((candidate) => candidate.dependency),
    );
    return Object.freeze({
      authorityPins: captureAuthorityPins(source.authorityPins),
      sealIdentity: captureSealIdentity(source.sealIdentity),
      dependencies,
      indexRangeDependencies,
      rowIntents: Object.freeze(
        materialCandidates.map(captureRowIntent),
      ),
      successfulResult: captureSuccessfulResult(source.successfulResult),
    } satisfies PreparedPointCommitStateV1);
  });
}

function captureIndexRangeDependency(
  dependency: LogicalIndexRangeReadDependencyV1,
): LogicalIndexRangeReadDependencyV1 {
  return Object.freeze({
    ...dependency,
    lower: dependency.lower === null ? null : Object.freeze({ ...dependency.lower }),
    upper: dependency.upper === null ? null : Object.freeze({ ...dependency.upper }),
  });
}

function captureIndexRangeDependencies(
  dependencies: ReadonlyArray<LogicalReadDependencyV1>,
): Result.Result<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  UnsupportedPointCommitPlanV1Error
> {
  const ranges: LogicalIndexRangeReadDependencyV1[] = [];
  for (const dependency of dependencies) {
    switch (dependency.kind) {
      case "appRowPoint":
        break;
      case "appIndexRange":
        ranges.push(captureIndexRangeDependency(dependency));
        break;
      default:
        return Result.fail(new UnsupportedPointCommitPlanV1Error({
          issue: { reason: "unsupportedReadDependency" },
        }));
    }
  }
  return Result.succeed(Object.freeze(ranges));
}

function captureLogicalReadDependency(
  dependency: LogicalReadDependencyV1,
): Result.Result<
  Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
  UnsupportedPointCommitPlanV1Error
> {
  switch (dependency.kind) {
    case "appRowPoint":
      switch (dependency.observed.kind) {
        case "present":
          return Result.succeed(Object.freeze({
            kind: "appRowPoint",
            documentId: dependency.documentId,
            observed: Object.freeze({
              kind: "present",
              revisionCommitSeq: dependency.observed.revisionCommitSeq,
            }),
          } satisfies Extract<
            LogicalReadDependencyV1,
            { readonly kind: "appRowPoint" }
          >));
        case "missing":
          switch (dependency.observed.basis.kind) {
            case "noVisibleRevision":
              return Result.succeed(Object.freeze({
                kind: "appRowPoint",
                documentId: dependency.documentId,
                observed: Object.freeze({
                  kind: "missing",
                  basis: Object.freeze({ kind: "noVisibleRevision" }),
                }),
              } satisfies Extract<
                LogicalReadDependencyV1,
                { readonly kind: "appRowPoint" }
              >));
            case "tombstone":
              return Result.succeed(Object.freeze({
                kind: "appRowPoint",
                documentId: dependency.documentId,
                observed: Object.freeze({
                  kind: "missing",
                  basis: Object.freeze({
                    kind: "tombstone",
                    revisionCommitSeq:
                      dependency.observed.basis.revisionCommitSeq,
                  }),
                }),
              } satisfies Extract<
                LogicalReadDependencyV1,
                { readonly kind: "appRowPoint" }
              >));
            default:
              return Result.fail(unsupportedReadDependency(
                dependency.observed.basis,
              ));
          }
        default:
          return Result.fail(unsupportedReadDependency(dependency.observed));
      }
    default:
      return Result.fail(unsupportedReadDependency(dependency));
  }
}

function isNetMaterialPoint(
  point: VerifiedCommitPointV1,
): Result.Result<boolean, UnsupportedPointCommitPlanV1Error> {
  switch (point.kind) {
    case "unchanged":
      return Result.succeed(false);
    case "live":
      return Result.succeed(true);
    case "deleted": {
      const observed: Extract<
        LogicalReadDependencyV1,
        { readonly kind: "appRowPoint" }
      >["observed"] =
        point.dependency.observed;
      switch (observed.kind) {
        case "present":
          return Result.succeed(true);
        case "missing":
          switch (observed.basis.kind) {
            case "noVisibleRevision":
              return Result.succeed(false);
            case "tombstone":
              return pointCommitPlannerInvariant(
                "deletedPointWithTombstoneDependency",
              );
            default:
              return Result.fail(unsupportedReadDependency(
                observed.basis,
              ));
          }
        default:
          return Result.fail(unsupportedReadDependency(observed));
      }
    }
    default:
      return Result.fail(unsupportedPointState(point));
  }
}

function captureRowIntent(
  candidate: OrderedPointCandidateV1,
): PreparedPointRowIntentV1 {
  const point = candidate.point;
  switch (point.kind) {
    case "live": {
      const stableBytes = copyBytes(point.canonicalBytes);
      return Object.freeze({
        ...candidate.dependency,
        kind: "live",
        creationTime: point.creationTime,
        value: point.value,
        get canonicalBytes(): Uint8Array {
          return copyBytes(stableBytes);
        },
        semanticSizeBytes: point.semanticSizeBytes,
      });
    }
    case "deleted": {
      if (point.dependency.observed.kind !== "present") {
        return pointCommitPlannerInvariant(
          "nonMaterialDeletedPointSelected",
        );
      }
      return Object.freeze({
        ...candidate.dependency,
        kind: "deleted",
      });
    }
    case "unchanged":
      return pointCommitPlannerInvariant("unchangedPointSelected");
    default:
      return pointCommitPlannerInvariant("unsupportedPointStateSelected");
  }
}

function comparePointCandidates(
  left: OrderedPointCandidateV1,
  right: OrderedPointCandidateV1,
): number {
  const tableOrder = left.point.tableId - right.point.tableId;
  if (tableOrder !== 0) return tableOrder;
  return compareBytesLexicographically(left.rowBytes, right.rowBytes);
}

function captureAuthorityPins(
  pins: VerifiedCommitInputStateV1["authorityPins"],
): VerifiedCommitInputStateV1["authorityPins"] {
  return Object.freeze({
    ...pins,
    snapshotToken: Object.freeze({ ...pins.snapshotToken }),
  });
}

function captureSealIdentity(
  seal: VerifiedCommitInputStateV1["sealIdentity"],
): VerifiedCommitInputStateV1["sealIdentity"] {
  const stableJournalSha256 = copyBytes(seal.journalSha256);
  const stableResultSha256 = copyBytes(seal.resultSha256);
  return Object.freeze({
    ...seal,
    get journalSha256(): Uint8Array {
      return copyBytes(stableJournalSha256);
    },
    get resultSha256(): Uint8Array {
      return copyBytes(stableResultSha256);
    },
  });
}

function captureSuccessfulResult(
  result: VerifiedSuccessfulResultV1,
): Readonly<VerifiedSuccessfulResultV1> {
  const stableBytes = copyBytes(result.canonicalBytes);
  return Object.freeze({
    valueCodecVersion: result.valueCodecVersion,
    value: result.value,
    get canonicalBytes(): VerifiedSuccessfulResultV1["canonicalBytes"] {
      return CanonicalSuccessfulResultBytesV1Schema.make(
        copyBytes(stableBytes),
      );
    },
    semanticSizeBytes: result.semanticSizeBytes,
    sha256Hex: result.sha256Hex,
  });
}

function unsupportedReadDependency(
  _value: unknown,
): UnsupportedPointCommitPlanV1Error {
  return new UnsupportedPointCommitPlanV1Error({
    issue: { reason: "unsupportedReadDependency" },
  });
}

function unsupportedPointState(
  _value: never,
): UnsupportedPointCommitPlanV1Error {
  return new UnsupportedPointCommitPlanV1Error({
    issue: { reason: "unsupportedPointState" },
  });
}

function pointCommitPlannerInvariant(
  reason: PointCommitPlannerInvariantV1DefectReason,
): never {
  throw new PointCommitPlannerInvariantV1Defect({ reason });
}
