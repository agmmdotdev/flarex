import {
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

import type {
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "./declarative-v2-runtime-projection-v1";
import {
  makeDeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "./declarative-v2-runtime-projection-v1";
import type {
  DeclarativeV2RuntimeExecutionGroupV1,
} from "./declarative-v2-physical-v1";
import {
  POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
} from "./point-mutation-exact-runtime";
import {
  MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
} from "./commit-protocol";

export const CANDIDATE_BOUND_RUNTIME_TARGET_IDENTITY_V1 =
  "flarex.system/candidate-bound-runtime-target/v1" as const;
export const CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1 =
  "flarex.system/app-index-range-query/v1" as const;

export const CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1 = Object.freeze({
  maximumIndexedQuerySyscalls: BigInt(MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1),
  maximumIndexedQueryPageSize: BigInt(MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1),
  maximumIndexRangeReadDependencies:
    BigInt(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1),
  maximumIndexRangeDependencyEvidenceBytes:
    BigInt(MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1),
});

const DOMAIN = new TextEncoder().encode(
  `${CANDIDATE_BOUND_RUNTIME_TARGET_IDENTITY_V1}\0`,
);
const UTF8 = new TextEncoder();
const DIGEST_BYTES = 32;
const MAX_U64 = (1n << 64n) - 1n;

export interface CandidateBoundRuntimeTargetModuleV1 {
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly roles: bigint;
  readonly sourceByteLength: bigint;
  readonly sourceSha256: Uint8Array;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface CandidateBoundRuntimeTargetFrameV1 {
  readonly scopeId: string;
  readonly storageGeneration: "flarexdb_v1";
  readonly storageGenerationFence: bigint;
  readonly scopeEpoch: string;
  readonly applicationRevisionId: string;
  readonly activationRevision: bigint;
  readonly activationHeadSha256: Uint8Array;
  readonly readinessReceiptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly attemptSha256: Uint8Array;
  readonly packageSha256: Uint8Array;
  readonly artifactSha256: Uint8Array;
  readonly sourceRootSha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
  readonly schemaArtifactSha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
  readonly functionMetadataSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
  readonly declaredHandlerSetSha256: Uint8Array;
  readonly runtimeProjectionSetSha256: Uint8Array;
  readonly functionGroupManifestSha256: Uint8Array;
  readonly compatibilityDate: string;
  readonly exactRuntimeProfile:
    typeof POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1;
  readonly exactRuntimeVersion:
    typeof POINT_MUTATION_EXACT_RUNTIME_VERSION_V1;
  readonly exactRuntimeGraphBasisSha256: Uint8Array;
  readonly indexedQueryOperation:
    typeof CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1;
  readonly maximumIndexedQuerySyscalls: bigint;
  readonly maximumIndexedQueryPageSize: bigint;
  readonly maximumIndexRangeReadDependencies: bigint;
  readonly maximumIndexRangeDependencyEvidenceBytes: bigint;
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly projectionExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "mutation";
  readonly visibility: "public" | "internal";
  readonly group: Extract<DeclarativeV2RuntimeExecutionGroupV1, "transaction">;
  readonly projectionSha256: Uint8Array;
  readonly projectionSetReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly functionGroupManifestReference:
    DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly functionEntryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly projectionReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly modules: ReadonlyArray<CandidateBoundRuntimeTargetModuleV1>;
}

export interface CandidateBoundRuntimeTargetEncodingBudgetV1 {
  readonly maximumModules: number;
  readonly maximumTextBytes: number;
  readonly maximumPreimageBytes: number;
}

export interface CandidateBoundRuntimeTargetEncodedV1 {
  readonly frame: CandidateBoundRuntimeTargetFrameV1;
  readonly canonicalBytes: Uint8Array;
}

export class CandidateBoundRuntimeTargetV1Error extends Data.TaggedError(
  "CandidateBoundRuntimeTargetV1Error",
)<{
  readonly reason: "invalidInput" | "invalidBudget" | "budgetExceeded";
  readonly path: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

const FRAME_FIELDS = [
  "scopeId",
  "storageGeneration",
  "storageGenerationFence",
  "scopeEpoch",
  "applicationRevisionId",
  "activationRevision",
  "activationHeadSha256",
  "readinessReceiptSha256",
  "candidateSha256",
  "attemptSha256",
  "packageSha256",
  "artifactSha256",
  "sourceRootSha256",
  "semanticRootSha256",
  "schemaArtifactSha256",
  "schemaBindingSha256",
  "functionMetadataSha256",
  "validatorRootSha256",
  "declaredHandlerSetSha256",
  "runtimeProjectionSetSha256",
  "functionGroupManifestSha256",
  "compatibilityDate",
  "exactRuntimeProfile",
  "exactRuntimeVersion",
  "exactRuntimeGraphBasisSha256",
  "indexedQueryOperation",
  "maximumIndexedQuerySyscalls",
  "maximumIndexedQueryPageSize",
  "maximumIndexRangeReadDependencies",
  "maximumIndexRangeDependencyEvidenceBytes",
  "functionOrdinal",
  "functionPath",
  "logicalExecutionModule",
  "artifactExecutionModule",
  "projectionExecutionModule",
  "exportName",
  "handlerKind",
  "visibility",
  "group",
  "projectionSha256",
  "projectionSetReference",
  "functionGroupManifestReference",
  "functionEntryReference",
  "projectionReference",
  "modules",
] as const;
const MODULE_FIELDS = [
  "moduleOrdinal",
  "modulePath",
  "roles",
  "sourceByteLength",
  "sourceSha256",
  "reference",
] as const;
const REFERENCE_FIELDS = [
  "storeIdentity",
  "kind",
  "codecIdentity",
  "objectKey",
  "byteLength",
  "sha256",
] as const;

/**
 * Canonical SHA-256 preimage for one active, candidate-bound transaction
 * function and the exact R2 objects needed to materialize it. Array order is
 * semantic: modules are strictly ascending by module ordinal.
 */
export function encodeCandidateBoundRuntimeTargetV1(
  input: unknown,
  budgetInput: unknown,
): Result.Result<
  CandidateBoundRuntimeTargetEncodedV1,
  CandidateBoundRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureBudget(budgetInput);
    const frame = yield* captureFrame(input, budget);
    const segments: Uint8Array[] = [DOMAIN];
    segments.push(
      text(frame.scopeId),
      text(frame.storageGeneration),
      u64(frame.storageGenerationFence),
      text(frame.scopeEpoch),
      text(frame.applicationRevisionId),
      u64(frame.activationRevision),
      frame.activationHeadSha256,
      frame.readinessReceiptSha256,
      frame.candidateSha256,
      frame.attemptSha256,
      frame.packageSha256,
      frame.artifactSha256,
      frame.sourceRootSha256,
      frame.semanticRootSha256,
      frame.schemaArtifactSha256,
      frame.schemaBindingSha256,
      frame.functionMetadataSha256,
      frame.validatorRootSha256,
      frame.declaredHandlerSetSha256,
      frame.runtimeProjectionSetSha256,
      frame.functionGroupManifestSha256,
      text(frame.compatibilityDate),
      text(frame.exactRuntimeProfile),
      u32(frame.exactRuntimeVersion),
      frame.exactRuntimeGraphBasisSha256,
      text(frame.indexedQueryOperation),
      u64(frame.maximumIndexedQuerySyscalls),
      u64(frame.maximumIndexedQueryPageSize),
      u64(frame.maximumIndexRangeReadDependencies),
      u64(frame.maximumIndexRangeDependencyEvidenceBytes),
      u64(frame.functionOrdinal),
      text(frame.functionPath),
      text(frame.logicalExecutionModule),
      text(frame.artifactExecutionModule),
      text(frame.projectionExecutionModule),
      text(frame.exportName),
      text(frame.handlerKind),
      text(frame.visibility),
      text(frame.group),
      frame.projectionSha256,
      ...referenceSegments(frame.projectionSetReference),
      ...referenceSegments(frame.functionGroupManifestReference),
      ...referenceSegments(frame.functionEntryReference),
      ...referenceSegments(frame.projectionReference),
      u32(frame.modules.length),
    );
    for (const module of frame.modules) {
      segments.push(
        u64(module.moduleOrdinal),
        text(module.modulePath),
        u64(module.roles),
        u64(module.sourceByteLength),
        module.sourceSha256,
        ...referenceSegments(module.reference),
      );
    }
    const byteLength = segments.reduce(
      (total, segment) => total + segment.byteLength,
      0,
    );
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength > budget.maximumPreimageBytes
    ) {
      return yield* Result.fail(new CandidateBoundRuntimeTargetV1Error({
        reason: "budgetExceeded",
        path: "$bytes",
        observed: byteLength,
        maximum: budget.maximumPreimageBytes,
      }));
    }
    const canonicalBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const segment of segments) {
      canonicalBytes.set(segment, offset);
      offset += segment.byteLength;
    }
    return Object.freeze({ frame, canonicalBytes });
  });
}

function captureBudget(
  input: unknown,
): Result.Result<
  CandidateBoundRuntimeTargetEncodingBudgetV1,
  CandidateBoundRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(input, [
      "maximumModules",
      "maximumTextBytes",
      "maximumPreimageBytes",
    ], "budget");
    if (
      !isNonNegativeSafeInteger(value.maximumModules) ||
      !isNonNegativeSafeInteger(value.maximumTextBytes) ||
      !isNonNegativeSafeInteger(value.maximumPreimageBytes) ||
      value.maximumTextBytes > 0xffff_ffff
    ) return yield* fail("invalidBudget", "budget");
    return Object.freeze({
      maximumModules: value.maximumModules,
      maximumTextBytes: value.maximumTextBytes,
      maximumPreimageBytes: value.maximumPreimageBytes,
    });
  });
}

function captureFrame(
  input: unknown,
  budget: CandidateBoundRuntimeTargetEncodingBudgetV1,
): Result.Result<
  CandidateBoundRuntimeTargetFrameV1,
  CandidateBoundRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(input, FRAME_FIELDS, "$frame");
    const boundedText = (candidate: unknown, path: string) =>
      captureText(candidate, path, budget.maximumTextBytes);
    const scopeId = yield* boundedText(value.scopeId, "scopeId");
    if (value.storageGeneration !== "flarexdb_v1") {
      return yield* fail("invalidInput", "storageGeneration");
    }
    const storageGenerationFence = yield* positiveU64(
      value.storageGenerationFence,
      "storageGenerationFence",
    );
    const scopeEpoch = yield* boundedText(value.scopeEpoch, "scopeEpoch");
    const applicationRevisionId = yield* boundedText(
      value.applicationRevisionId,
      "applicationRevisionId",
    );
    const activationRevision = yield* positiveU64(
      value.activationRevision,
      "activationRevision",
    );
    const digests = yield* captureDigests(value, [
      "activationHeadSha256",
      "readinessReceiptSha256",
      "candidateSha256",
      "attemptSha256",
      "packageSha256",
      "artifactSha256",
      "sourceRootSha256",
      "semanticRootSha256",
      "schemaArtifactSha256",
      "schemaBindingSha256",
      "functionMetadataSha256",
      "validatorRootSha256",
      "declaredHandlerSetSha256",
      "runtimeProjectionSetSha256",
      "functionGroupManifestSha256",
      "exactRuntimeGraphBasisSha256",
      "projectionSha256",
    ]);
    const compatibilityDate = yield* boundedText(
      value.compatibilityDate,
      "compatibilityDate",
    );
    if (value.exactRuntimeProfile !== POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1) {
      return yield* fail("invalidInput", "exactRuntimeProfile");
    }
    if (value.exactRuntimeVersion !== POINT_MUTATION_EXACT_RUNTIME_VERSION_V1) {
      return yield* fail("invalidInput", "exactRuntimeVersion");
    }
    if (value.indexedQueryOperation !== CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1) {
      return yield* fail("invalidInput", "indexedQueryOperation");
    }
    const maximumIndexedQuerySyscalls = yield* exactPositiveU64(
      value.maximumIndexedQuerySyscalls,
      CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexedQuerySyscalls,
      "maximumIndexedQuerySyscalls",
    );
    const maximumIndexedQueryPageSize = yield* exactPositiveU64(
      value.maximumIndexedQueryPageSize,
      CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexedQueryPageSize,
      "maximumIndexedQueryPageSize",
    );
    const maximumIndexRangeReadDependencies = yield* exactPositiveU64(
      value.maximumIndexRangeReadDependencies,
      CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexRangeReadDependencies,
      "maximumIndexRangeReadDependencies",
    );
    const maximumIndexRangeDependencyEvidenceBytes = yield* exactPositiveU64(
      value.maximumIndexRangeDependencyEvidenceBytes,
      CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexRangeDependencyEvidenceBytes,
      "maximumIndexRangeDependencyEvidenceBytes",
    );
    const functionOrdinal = yield* nonNegativeU64(
      value.functionOrdinal,
      "functionOrdinal",
    );
    const functionPath = yield* boundedText(value.functionPath, "functionPath");
    const logicalExecutionModule = yield* boundedText(
      value.logicalExecutionModule,
      "logicalExecutionModule",
    );
    const artifactExecutionModule = yield* boundedText(
      value.artifactExecutionModule,
      "artifactExecutionModule",
    );
    const projectionExecutionModule = yield* boundedText(
      value.projectionExecutionModule,
      "projectionExecutionModule",
    );
    const exportName = yield* boundedText(value.exportName, "exportName");
    if (value.handlerKind !== "mutation") {
      return yield* fail("invalidInput", "handlerKind");
    }
    if (value.visibility !== "public" && value.visibility !== "internal") {
      return yield* fail("invalidInput", "visibility");
    }
    if (value.group !== "transaction") {
      return yield* fail("invalidInput", "group");
    }
    const projectionSetReference = yield* captureReference(
      value.projectionSetReference,
      "runtime-projection-set",
      "projectionSetReference",
      budget.maximumTextBytes,
    );
    const functionGroupManifestReference = yield* captureReference(
      value.functionGroupManifestReference,
      "function-group-manifest",
      "functionGroupManifestReference",
      budget.maximumTextBytes,
    );
    const functionEntryReference = yield* captureReference(
      value.functionEntryReference,
      "function-group-entry",
      "functionEntryReference",
      budget.maximumTextBytes,
    );
    const projectionReference = yield* captureReference(
      value.projectionReference,
      "runtime-projection",
      "projectionReference",
      budget.maximumTextBytes,
    );
    if (!Array.isArray(value.modules)) {
      return yield* fail("invalidInput", "modules");
    }
    if (value.modules.length > budget.maximumModules) {
      return yield* Result.fail(new CandidateBoundRuntimeTargetV1Error({
        reason: "budgetExceeded",
        path: "modules",
        observed: value.modules.length,
        maximum: budget.maximumModules,
      }));
    }
    const modules: CandidateBoundRuntimeTargetModuleV1[] = [];
    for (let index = 0; index < value.modules.length; index += 1) {
      const module = yield* captureModule(
        value.modules[index],
        index,
        budget.maximumTextBytes,
      );
      if (module.moduleOrdinal !== BigInt(index)) {
        return yield* fail("invalidInput", `modules[${index}].moduleOrdinal`);
      }
      modules.push(module);
    }
    if (modules.length === 0) return yield* fail("invalidInput", "modules");
    return Object.freeze({
      scopeId,
      storageGeneration: "flarexdb_v1" as const,
      storageGenerationFence,
      scopeEpoch,
      applicationRevisionId,
      activationRevision,
      activationHeadSha256: digests.activationHeadSha256,
      readinessReceiptSha256: digests.readinessReceiptSha256,
      candidateSha256: digests.candidateSha256,
      attemptSha256: digests.attemptSha256,
      packageSha256: digests.packageSha256,
      artifactSha256: digests.artifactSha256,
      sourceRootSha256: digests.sourceRootSha256,
      semanticRootSha256: digests.semanticRootSha256,
      schemaArtifactSha256: digests.schemaArtifactSha256,
      schemaBindingSha256: digests.schemaBindingSha256,
      functionMetadataSha256: digests.functionMetadataSha256,
      validatorRootSha256: digests.validatorRootSha256,
      declaredHandlerSetSha256: digests.declaredHandlerSetSha256,
      runtimeProjectionSetSha256: digests.runtimeProjectionSetSha256,
      functionGroupManifestSha256: digests.functionGroupManifestSha256,
      compatibilityDate,
      exactRuntimeProfile: POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
      exactRuntimeVersion: POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
      exactRuntimeGraphBasisSha256: digests.exactRuntimeGraphBasisSha256,
      indexedQueryOperation: CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1,
      maximumIndexedQuerySyscalls,
      maximumIndexedQueryPageSize,
      maximumIndexRangeReadDependencies,
      maximumIndexRangeDependencyEvidenceBytes,
      projectionSha256: digests.projectionSha256,
      functionOrdinal,
      functionPath,
      logicalExecutionModule,
      artifactExecutionModule,
      projectionExecutionModule,
      exportName,
      handlerKind: "mutation" as const,
      visibility: value.visibility,
      group: "transaction" as const,
      projectionSetReference,
      functionGroupManifestReference,
      functionEntryReference,
      projectionReference,
      modules: Object.freeze(modules),
    });
  });
}

function captureModule(
  input: unknown,
  index: number,
  maximumTextBytes: number,
): Result.Result<CandidateBoundRuntimeTargetModuleV1, CandidateBoundRuntimeTargetV1Error> {
  return Result.gen(function* () {
    const path = `modules[${index}]`;
    const value = yield* exactRecord(input, MODULE_FIELDS, path);
    const moduleOrdinal = yield* nonNegativeU64(
      value.moduleOrdinal,
      `${path}.moduleOrdinal`,
    );
    const modulePath = yield* captureText(
      value.modulePath,
      `${path}.modulePath`,
      maximumTextBytes,
    );
    const roles = yield* nonNegativeU64(value.roles, `${path}.roles`);
    const sourceByteLength = yield* positiveU64(
      value.sourceByteLength,
      `${path}.sourceByteLength`,
    );
    const sourceSha256 = yield* digest(value.sourceSha256, `${path}.sourceSha256`);
    const reference = yield* captureReference(
      value.reference,
      "runtime-projection-module",
      `${path}.reference`,
      maximumTextBytes,
    );
    return Object.freeze({
      moduleOrdinal,
      modulePath,
      roles,
      sourceByteLength,
      sourceSha256,
      reference,
    });
  });
}

function captureReference(
  input: unknown,
  expectedKind: DeclarativeV2RuntimeArtifactObjectReferenceV1["kind"],
  path: string,
  maximumTextBytes: number,
): Result.Result<
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
  CandidateBoundRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const value = yield* exactRecord(input, REFERENCE_FIELDS, path);
    if (value.kind !== expectedKind) {
      return yield* fail("invalidInput", `${path}.kind`);
    }
    const objectKey = yield* captureText(
      value.objectKey,
      `${path}.objectKey`,
      maximumTextBytes,
    );
    const byteLength = yield* positiveU64(value.byteLength, `${path}.byteLength`);
    const sha256 = yield* digest(value.sha256, `${path}.sha256`);
    if (byteLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      return yield* fail("invalidInput", `${path}.byteLength`);
    }
    const canonical = yield* makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
      expectedKind,
      sha256,
      Number(byteLength),
    ).pipe(Result.mapError(() => new CandidateBoundRuntimeTargetV1Error({
      reason: "invalidInput",
      path,
    })));
    if (
      value.storeIdentity !== canonical.storeIdentity ||
      value.codecIdentity !== canonical.codecIdentity ||
      objectKey !== canonical.objectKey || byteLength !== canonical.byteLength
    ) return yield* fail("invalidInput", path);
    return canonical;
  });
}

function captureDigests<Keys extends readonly string[]>(
  value: Readonly<Record<string, unknown>>,
  keys: Keys,
): Result.Result<
  Readonly<Record<Keys[number], Uint8Array>>,
  CandidateBoundRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const output: Record<string, Uint8Array> = {};
    for (const key of keys) output[key] = yield* digest(value[key], key);
    return Object.freeze(output) as Readonly<Record<Keys[number], Uint8Array>>;
  });
}

function digest(
  input: unknown,
  path: string,
): Result.Result<Uint8Array, CandidateBoundRuntimeTargetV1Error> {
  return isUint8ArrayWithByteLength(input, DIGEST_BYTES)
    ? Result.succeed(copyBytes(input))
    : fail("invalidInput", path);
}

function captureText(
  input: unknown,
  path: string,
  maximumTextBytes: number,
): Result.Result<string, CandidateBoundRuntimeTargetV1Error> {
  if (
    typeof input !== "string" || !isNonBlankString(input) ||
    input.includes("\0")
  ) return fail("invalidInput", path);
  const bytes = UTF8.encode(input);
  return bytes.byteLength <= maximumTextBytes
    ? Result.succeed(input)
    : Result.fail(new CandidateBoundRuntimeTargetV1Error({
        reason: "budgetExceeded",
        path,
        observed: bytes.byteLength,
        maximum: maximumTextBytes,
      }));
}

function nonNegativeU64(
  input: unknown,
  path: string,
): Result.Result<bigint, CandidateBoundRuntimeTargetV1Error> {
  return typeof input === "bigint" && input >= 0n && input <= MAX_U64
    ? Result.succeed(input)
    : fail("invalidInput", path);
}

function positiveU64(
  input: unknown,
  path: string,
): Result.Result<bigint, CandidateBoundRuntimeTargetV1Error> {
  return typeof input === "bigint" && input >= 1n && input <= MAX_U64
    ? Result.succeed(input)
    : fail("invalidInput", path);
}

function exactPositiveU64(
  input: unknown,
  expected: bigint,
  path: string,
): Result.Result<bigint, CandidateBoundRuntimeTargetV1Error> {
  return positiveU64(input, path).pipe(
    Result.filterOrFail(
      (value) => value === expected,
      () => new CandidateBoundRuntimeTargetV1Error({
        reason: "invalidInput",
        path,
      }),
    ),
  );
}

function exactRecord<Keys extends readonly string[]>(
  input: unknown,
  keys: Keys,
  path: string,
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  CandidateBoundRuntimeTargetV1Error
> {
  if (
    typeof input !== "object" || input === null || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) return fail("invalidInput", path);
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
  ) return fail("invalidInput", path);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined || !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) return fail("invalidInput", `${path}.${key}`);
    output[key] = descriptor.value;
  }
  return Result.succeed(output as Readonly<Record<Keys[number], unknown>>);
}

function referenceSegments(
  reference: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): Uint8Array[] {
  return [
    text(reference.storeIdentity),
    text(reference.kind),
    text(reference.codecIdentity),
    text(reference.objectKey),
    u64(reference.byteLength),
    reference.sha256,
  ];
}

function text(value: string): Uint8Array {
  const bytes = UTF8.encode(value);
  const output = new Uint8Array(4 + bytes.byteLength);
  new DataView(output.buffer).setUint32(0, bytes.byteLength, false);
  output.set(bytes, 4);
  return output;
}

function u32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function u64(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, false);
  return output;
}

function fail(
  reason: CandidateBoundRuntimeTargetV1Error["reason"],
  path: string,
): Result.Result<never, CandidateBoundRuntimeTargetV1Error> {
  return Result.fail(new CandidateBoundRuntimeTargetV1Error({ reason, path }));
}
