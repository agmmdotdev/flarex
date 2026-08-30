import {
  bytesEqual,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { Effect, Encoding, Result } from "effect";

import { hasExactOwnDataKeys } from "../../exactOwnDataKeys";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "./canonical";
import {
  type FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
} from "./errors";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactCaptureInput,
  type FrameworkSchemaArtifactIdentity,
  type FrameworkSchemaArtifactOwner,
} from "./model";
import {
  isFrameworkSchemaArtifactCommonIdentityString,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES,
} from "./policy";

export type FrameworkSchemaArtifactStoredStage =
  | "artifactRow"
  | "canonicalFrame"
  | "dependencyRows";

export type FrameworkSchemaArtifactStoredIssue =
  | Readonly<{
      readonly _tag: "FrameworkSchemaArtifactStoredCorruptionIssue";
      readonly storedStage: FrameworkSchemaArtifactStoredStage;
    }>
  | Readonly<{
      readonly _tag: "FrameworkSchemaArtifactStoredResourceIssue";
      readonly persistenceStage: "reconstructArtifact";
      readonly cause: unknown;
    }>;

export interface StoredFrameworkSchemaArtifactRow {
  readonly artifactStorageId: unknown;
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly artifactSha256: unknown;
  readonly frameFormat: unknown;
  readonly frameVersion: unknown;
  readonly canonicalByteLength: unknown;
  readonly observedCanonicalByteLength: unknown;
  readonly canonicalBytes: unknown;
  readonly admittedAt: unknown;
}

export interface StoredFrameworkSchemaArtifactDependencyRow {
  readonly artifactStorageId: unknown;
  readonly dependencyStorageId: unknown;
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly artifactLineageId: unknown;
  readonly dependencyOrdinal: unknown;
  readonly dependencyLineageId: unknown;
  readonly dependencyArtifactSha256: unknown;
  readonly dependencyRowCountText: unknown;
}

export interface DecodedStoredFrameworkSchemaArtifactRow {
  readonly artifactStorageId: bigint;
  readonly deploymentId: string;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: string;
  readonly artifactSha256Hex: string;
  readonly artifactSha256Bytes: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_ARTIFACT_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_ARTIFACT_VERSION;
  readonly canonicalByteLength: number;
  readonly canonicalBytes: Uint8Array;
  readonly admittedAt: Date;
}

export interface DecodedStoredFrameworkSchemaArtifactDependency {
  readonly dependencyStorageId: bigint;
  readonly dependencyOrdinal: number;
  readonly deploymentId: string;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: string;
  readonly artifactSha256Hex: string;
}

interface DecodedFrameworkSchemaArtifactCanonicalFrame {
  readonly canonicalText: string;
  readonly captureInput: FrameworkSchemaArtifactCaptureInput;
}

const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;
const SHA256_BYTE_LENGTH = 32;
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const CANONICAL_FRAME_KEYS = Object.freeze([
  "format",
  "version",
  "deploymentId",
  "owner",
  "lineageId",
  "payloadCodec",
  "provenance",
  "capabilities",
  "dependencies",
  "payload",
] as const);

export function decodeStoredFrameworkSchemaArtifactStorageIdResult(
  value: unknown,
): Result.Result<bigint, FrameworkSchemaArtifactStoredIssue> {
  return decodeStorageIdResult(value, "artifactRow");
}

export function decodeStoredFrameworkSchemaArtifactRowResult(
  expectedIdentity: FrameworkSchemaArtifactIdentity,
  row: StoredFrameworkSchemaArtifactRow,
): Result.Result<
  DecodedStoredFrameworkSchemaArtifactRow,
  FrameworkSchemaArtifactStoredIssue
> {
  return Result.gen(function* () {
    const artifactStorageId = yield*
      decodeStoredFrameworkSchemaArtifactStorageIdResult(
        row.artifactStorageId,
      );
    if (
      !isFrameworkSchemaArtifactCommonIdentityString(row.deploymentId) ||
      !isFrameworkSchemaArtifactOwner(row.owner) ||
      !isFrameworkSchemaArtifactCommonIdentityString(row.lineageId)
    ) {
      return yield* storedCorruptionResult("artifactRow");
    }
    const artifactSha256Bytes = yield* decodeBytesResult(
      row.artifactSha256,
      SHA256_BYTE_LENGTH,
      "artifactRow",
    );
    const artifactSha256Hex = Encoding.encodeHex(artifactSha256Bytes);
    if (
      row.deploymentId !== expectedIdentity.deploymentId ||
      row.owner !== expectedIdentity.owner ||
      row.lineageId !== expectedIdentity.lineageId ||
      artifactSha256Hex !== expectedIdentity.artifactSha256 ||
      row.frameFormat !== FRAMEWORK_SCHEMA_ARTIFACT_FORMAT ||
      row.frameVersion !== FRAMEWORK_SCHEMA_ARTIFACT_VERSION
    ) {
      return yield* storedCorruptionResult("artifactRow");
    }
    if (
      !isPositiveSafeIntegerAtMost(
        row.canonicalByteLength,
        MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
      ) ||
      row.observedCanonicalByteLength !== row.canonicalByteLength ||
      !isUint8ArrayWithByteLength(
        row.canonicalBytes,
        row.canonicalByteLength,
      )
    ) {
      return yield* storedCorruptionResult("artifactRow");
    }
    const admittedAtMilliseconds = finiteDateMilliseconds(row.admittedAt);
    if (admittedAtMilliseconds === undefined) {
      return yield* storedCorruptionResult("artifactRow");
    }
    const stableArtifactSha256Bytes = copyBytes(artifactSha256Bytes);
    const stableCanonicalBytes = copyBytes(row.canonicalBytes);
    return Object.freeze({
      artifactStorageId,
      deploymentId: row.deploymentId,
      owner: row.owner,
      lineageId: row.lineageId,
      artifactSha256Hex,
      get artifactSha256Bytes(): Uint8Array {
        return copyBytes(stableArtifactSha256Bytes);
      },
      frameFormat: FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
      frameVersion: FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
      canonicalByteLength: row.canonicalByteLength,
      get canonicalBytes(): Uint8Array {
        return copyBytes(stableCanonicalBytes);
      },
      get admittedAt(): Date {
        return new Date(admittedAtMilliseconds);
      },
    });
  });
}

export function decodeStoredFrameworkSchemaArtifactDependencyRowsResult(
  artifact: DecodedStoredFrameworkSchemaArtifactRow,
  rows: ReadonlyArray<StoredFrameworkSchemaArtifactDependencyRow>,
): Result.Result<
  readonly DecodedStoredFrameworkSchemaArtifactDependency[],
  FrameworkSchemaArtifactStoredIssue
> {
  if (
    !Array.isArray(rows) ||
    rows.length > MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES
  ) {
    return storedCorruptionResult("dependencyRows");
  }
  return Result.gen(function* () {
    const expectedRowCountText = String(rows.length);
    const dependencyStorageIds = new Set<bigint>();
    const dependencies: DecodedStoredFrameworkSchemaArtifactDependency[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (
        row === undefined ||
        row.dependencyRowCountText !== expectedRowCountText
      ) {
        return yield* storedCorruptionResult("dependencyRows");
      }
      const artifactStorageId = yield* decodeStorageIdResult(
        row.artifactStorageId,
        "dependencyRows",
      );
      const dependencyStorageId = yield* decodeStorageIdResult(
        row.dependencyStorageId,
        "dependencyRows",
      );
      if (
        artifactStorageId !== artifact.artifactStorageId ||
        dependencyStorageId === artifactStorageId ||
        dependencyStorageIds.has(dependencyStorageId) ||
        row.deploymentId !== artifact.deploymentId ||
        row.owner !== artifact.owner ||
        row.artifactLineageId !== artifact.lineageId ||
        row.dependencyOrdinal !== index ||
        !isFrameworkSchemaArtifactCommonIdentityString(
          row.dependencyLineageId,
        ) ||
        row.dependencyLineageId === artifact.lineageId
      ) {
        return yield* storedCorruptionResult("dependencyRows");
      }
      const dependencyArtifactSha256Bytes = yield* decodeBytesResult(
        row.dependencyArtifactSha256,
        SHA256_BYTE_LENGTH,
        "dependencyRows",
      );
      dependencyStorageIds.add(dependencyStorageId);
      dependencies.push(Object.freeze({
        dependencyStorageId,
        dependencyOrdinal: index,
        deploymentId: artifact.deploymentId,
        owner: artifact.owner,
        lineageId: row.dependencyLineageId,
        artifactSha256Hex: Encoding.encodeHex(
          copyBytes(dependencyArtifactSha256Bytes),
        ),
      }));
    }
    return Object.freeze(dependencies);
  });
}

export const reconstructStoredFrameworkSchemaArtifactEffect = Effect.fn(
  "FrameworkSchemaArtifact.reconstructStored",
)(function* (
  expectedIdentity: FrameworkSchemaArtifactIdentity,
  artifactRow: StoredFrameworkSchemaArtifactRow,
  dependencyRows: ReadonlyArray<StoredFrameworkSchemaArtifactDependencyRow>,
): Effect.fn.Return<
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactStoredIssue
> {
  const storedArtifact = yield* Effect.fromResult(
    decodeStoredFrameworkSchemaArtifactRowResult(
      expectedIdentity,
      artifactRow,
    ),
  );
  const canonicalFrame = yield* Effect.fromResult(
    decodeStoredFrameworkSchemaArtifactCanonicalFrameResult(
      storedArtifact.canonicalBytes,
    ),
  );
  const artifact = yield* captureFrameworkSchemaArtifact(
    canonicalFrame.captureInput,
  ).pipe(
    Effect.mapError(mapCaptureErrorToStoredIssue),
    Effect.catchTag("FrameworkSchemaArtifactInvariantDefect", Effect.die),
  );
  const captured = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (captured === undefined) {
    return yield* Effect.die(new FrameworkSchemaArtifactInvariantDefect({
      reason: "ownedSnapshotInvalid",
    }));
  }
  if (
    canonicalFrame.canonicalText !== artifact.canonicalJson ||
    !sameFrameworkSchemaArtifactIdentity(artifact.identity, expectedIdentity) ||
    artifact.identity.deploymentId !== storedArtifact.deploymentId ||
    artifact.identity.owner !== storedArtifact.owner ||
    artifact.identity.lineageId !== storedArtifact.lineageId ||
    artifact.identity.artifactSha256 !== storedArtifact.artifactSha256Hex ||
    captured.canonicalBytes.byteLength !==
      storedArtifact.canonicalByteLength ||
    !bytesEqual(captured.canonicalBytes, storedArtifact.canonicalBytes) ||
    !bytesEqual(
      captured.artifactSha256Bytes,
      storedArtifact.artifactSha256Bytes,
    )
  ) {
    return yield* Effect.fail(storedCorruption("canonicalFrame"));
  }

  const storedDependencies = yield* Effect.fromResult(
    decodeStoredFrameworkSchemaArtifactDependencyRowsResult(
      storedArtifact,
      dependencyRows,
    ),
  );
  if (storedDependencies.length !== artifact.dependencies.length) {
    return yield* Effect.fail(storedCorruption("dependencyRows"));
  }
  for (let index = 0; index < storedDependencies.length; index += 1) {
    const storedDependency = storedDependencies[index];
    const dependency = artifact.dependencies[index];
    if (
      storedDependency === undefined ||
      dependency === undefined ||
      storedDependency.deploymentId !== dependency.deploymentId ||
      storedDependency.owner !== dependency.owner ||
      storedDependency.lineageId !== dependency.lineageId ||
      storedDependency.artifactSha256Hex !== dependency.artifactSha256
    ) {
      return yield* Effect.fail(storedCorruption("dependencyRows"));
    }
  }
  return artifact;
});

function decodeStoredFrameworkSchemaArtifactCanonicalFrameResult(
  canonicalBytes: Uint8Array,
): Result.Result<
  DecodedFrameworkSchemaArtifactCanonicalFrame,
  FrameworkSchemaArtifactStoredIssue
> {
  return Result.try({
    try: () => {
      const canonicalText = FATAL_UTF8.decode(canonicalBytes);
      const parsed: unknown = JSON.parse(canonicalText);
      return { canonicalText, parsed };
    },
    catch: () => storedCorruption("canonicalFrame"),
  }).pipe(Result.flatMap(({ canonicalText, parsed }) => {
    if (
      !hasExactOwnDataKeys(parsed, CANONICAL_FRAME_KEYS) ||
      parsed.format !== FRAMEWORK_SCHEMA_ARTIFACT_FORMAT ||
      parsed.version !== FRAMEWORK_SCHEMA_ARTIFACT_VERSION
    ) {
      return storedCorruptionResult("canonicalFrame");
    }
    return Result.succeed(Object.freeze({
      canonicalText,
      captureInput: Object.freeze({
        deploymentId: parsed.deploymentId,
        owner: parsed.owner,
        lineageId: parsed.lineageId,
        payloadCodec: parsed.payloadCodec,
        provenance: parsed.provenance,
        capabilities: parsed.capabilities,
        dependencies: parsed.dependencies,
        payload: parsed.payload,
      }),
    }));
  }));
}

function decodeStorageIdResult(
  value: unknown,
  storedStage: FrameworkSchemaArtifactStoredStage,
): Result.Result<bigint, FrameworkSchemaArtifactStoredIssue> {
  return typeof value === "bigint" && value >= 1n &&
      value <= POSTGRES_BIGINT_MAXIMUM
    ? Result.succeed(value)
    : storedCorruptionResult(storedStage);
}

function decodeBytesResult(
  value: unknown,
  expectedByteLength: number,
  storedStage: FrameworkSchemaArtifactStoredStage,
): Result.Result<Uint8Array, FrameworkSchemaArtifactStoredIssue> {
  return isUint8ArrayWithByteLength(value, expectedByteLength)
    ? Result.succeed(copyBytes(value))
    : storedCorruptionResult(storedStage);
}

function isFrameworkSchemaArtifactOwner(
  value: unknown,
): value is FrameworkSchemaArtifactOwner {
  return value === "payload" || value === "medusa" || value === "system";
}

function isPositiveSafeIntegerAtMost(
  value: unknown,
  maximum: number,
): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function sameFrameworkSchemaArtifactIdentity(
  left: FrameworkSchemaArtifactIdentity,
  right: FrameworkSchemaArtifactIdentity,
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.owner === right.owner &&
    left.lineageId === right.lineageId &&
    left.artifactSha256 === right.artifactSha256;
}

function mapCaptureErrorToStoredIssue(
  error: FrameworkSchemaArtifactError,
): FrameworkSchemaArtifactStoredIssue |
  FrameworkSchemaArtifactInvariantDefect {
  if (error.operation !== "capture") {
    return new FrameworkSchemaArtifactInvariantDefect({
      reason: "unexpectedCaptureFailure",
    });
  }
  switch (error.reason) {
    case "invalidInput":
    case "ownerNotAdmitted":
      return storedCorruption("canonicalFrame");
    case "resourceFailure":
      return Object.freeze({
        _tag: "FrameworkSchemaArtifactStoredResourceIssue",
        persistenceStage: "reconstructArtifact",
        cause: error.cause,
      } satisfies FrameworkSchemaArtifactStoredIssue);
    case "digestCollision":
      return new FrameworkSchemaArtifactInvariantDefect({
        reason: "unexpectedCaptureFailure",
      });
  }
}

function storedCorruption(
  storedStage: FrameworkSchemaArtifactStoredStage,
): FrameworkSchemaArtifactStoredIssue {
  return Object.freeze({
    _tag: "FrameworkSchemaArtifactStoredCorruptionIssue",
    storedStage,
  });
}

function storedCorruptionResult(
  storedStage: FrameworkSchemaArtifactStoredStage,
): Result.Result<never, FrameworkSchemaArtifactStoredIssue> {
  return Result.fail(storedCorruption(storedStage));
}
