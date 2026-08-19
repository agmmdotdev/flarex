import { copyBytes, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

import {
  makeDeclarativeV2RuntimeArtifactObjectReferenceV1,
  type DeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "./declarative-v2-runtime-projection-v1";
import {
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_PROFILE_V1,
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_ARGUMENT_BYTES_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_CALLS_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_DEPTH_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_RESULT_BYTES_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
} from "./point-mutation-internal-query-exact-runtime";

export const CANDIDATE_BOUND_MUTATION_INTERNAL_QUERY_RUNTIME_TARGET_IDENTITY_V1 =
  "flarex.system/candidate-bound-mutation-internal-query-runtime-target/v1" as const;

const DOMAIN = new TextEncoder().encode(
  `${CANDIDATE_BOUND_MUTATION_INTERNAL_QUERY_RUNTIME_TARGET_IDENTITY_V1}\0`,
);
const UTF8 = new TextEncoder();
const MAX_U64 = (1n << 64n) - 1n;

export interface CandidateBoundMutationInternalQueryRuntimeTargetModuleV1 {
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly roles: bigint;
  readonly sourceByteLength: bigint;
  readonly sourceSha256: Uint8Array;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface CandidateBoundMutationInternalQueryRuntimeTargetCatalogEntryV1 {
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "query";
  readonly visibility: "internal";
  readonly group: "transaction";
  readonly functionEntryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface CandidateBoundMutationInternalQueryRuntimeTargetFrameV1 {
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
    typeof POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_PROFILE_V1;
  readonly exactRuntimeVersion: typeof POINT_MUTATION_EXACT_RUNTIME_VERSION_V1;
  readonly syscallAbiIdentity:
    typeof POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1;
  readonly exactRuntimeGraphBasisSha256: Uint8Array;
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly projectionExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "mutation";
  readonly visibility: "public";
  readonly group: "transaction";
  readonly maximumInternalCalls: bigint;
  readonly maximumInternalCallDepth: bigint;
  readonly maximumInternalCallArgumentBytes: bigint;
  readonly maximumInternalCallResultBytes: bigint;
  readonly projectionSha256: Uint8Array;
  readonly projectionSetReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly functionGroupManifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly functionEntryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly projectionReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly modules: ReadonlyArray<CandidateBoundMutationInternalQueryRuntimeTargetModuleV1>;
  readonly internalQueryCatalog: ReadonlyArray<
    CandidateBoundMutationInternalQueryRuntimeTargetCatalogEntryV1
  >;
}

export interface CandidateBoundMutationInternalQueryRuntimeTargetEncodingBudgetV1 {
  readonly maximumModules: number;
  readonly maximumCatalogEntries: number;
  readonly maximumTextBytes: number;
  readonly maximumPreimageBytes: number;
}

export class CandidateBoundMutationInternalQueryRuntimeTargetV1Error extends Data.TaggedError(
  "CandidateBoundMutationInternalQueryRuntimeTargetV1Error",
)<{
  readonly reason: "invalidInput" | "invalidBudget" | "budgetExceeded";
  readonly path: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

const DIGEST_FIELDS = [
  "activationHeadSha256", "readinessReceiptSha256", "candidateSha256",
  "attemptSha256", "packageSha256", "artifactSha256", "sourceRootSha256",
  "semanticRootSha256", "schemaArtifactSha256", "schemaBindingSha256",
  "functionMetadataSha256", "validatorRootSha256",
  "declaredHandlerSetSha256", "runtimeProjectionSetSha256",
  "functionGroupManifestSha256", "exactRuntimeGraphBasisSha256",
  "projectionSha256",
] as const;

export function encodeCandidateBoundMutationInternalQueryRuntimeTargetV1(
  input: unknown,
  budgetInput: unknown,
): Result.Result<
  Readonly<{
    readonly frame: CandidateBoundMutationInternalQueryRuntimeTargetFrameV1;
    readonly canonicalBytes: Uint8Array;
  }>,
  CandidateBoundMutationInternalQueryRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureBudget(budgetInput);
    const frame = yield* captureFrame(input, budget);
    const segments: Uint8Array[] = [
      DOMAIN,
      text(frame.scopeId), text(frame.storageGeneration),
      u64(frame.storageGenerationFence), text(frame.scopeEpoch),
      text(frame.applicationRevisionId),
      u64(frame.activationRevision),
      ...DIGEST_FIELDS.slice(0, 15).map(field => frame[field]),
      text(frame.compatibilityDate), text(frame.exactRuntimeProfile),
      u32(frame.exactRuntimeVersion), text(frame.syscallAbiIdentity),
      frame.exactRuntimeGraphBasisSha256, u64(frame.functionOrdinal),
      text(frame.functionPath), text(frame.logicalExecutionModule),
      text(frame.artifactExecutionModule), text(frame.projectionExecutionModule),
      text(frame.exportName), text(frame.handlerKind), text(frame.visibility),
      text(frame.group),
      u64(frame.maximumInternalCalls), u64(frame.maximumInternalCallDepth),
      u64(frame.maximumInternalCallArgumentBytes),
      u64(frame.maximumInternalCallResultBytes),
      frame.projectionSha256,
      ...referenceSegments(frame.projectionSetReference),
      ...referenceSegments(frame.functionGroupManifestReference),
      ...referenceSegments(frame.functionEntryReference),
      ...referenceSegments(frame.projectionReference),
      u32(frame.modules.length),
    ];
    for (const module of frame.modules) {
      segments.push(
        u64(module.moduleOrdinal), text(module.modulePath), u64(module.roles),
        u64(module.sourceByteLength), module.sourceSha256,
        ...referenceSegments(module.reference),
      );
    }
    segments.push(u32(frame.internalQueryCatalog.length));
    for (const entry of frame.internalQueryCatalog) {
      segments.push(
        u64(entry.functionOrdinal), text(entry.functionPath),
        text(entry.logicalExecutionModule), text(entry.artifactExecutionModule),
        text(entry.exportName), text(entry.handlerKind), text(entry.visibility),
        text(entry.group), ...referenceSegments(entry.functionEntryReference),
      );
    }
    const byteLength = segments.reduce((sum, value) => sum + value.byteLength, 0);
    if (!Number.isSafeInteger(byteLength) || byteLength > budget.maximumPreimageBytes) {
      return yield* Result.fail(new CandidateBoundMutationInternalQueryRuntimeTargetV1Error({
        reason: "budgetExceeded", path: "$bytes", observed: byteLength,
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

function captureBudget(input: unknown) {
  if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 4 ||
    !isNonNegativeSafeInteger(input.maximumModules) ||
    !isNonNegativeSafeInteger(input.maximumCatalogEntries) ||
    !isNonNegativeSafeInteger(input.maximumTextBytes) ||
    !isNonNegativeSafeInteger(input.maximumPreimageBytes) ||
    input.maximumTextBytes > 0xffff_ffff) {
    return fail("invalidBudget", "budget");
  }
  return Result.succeed(Object.freeze({
    maximumModules: input.maximumModules,
    maximumCatalogEntries: input.maximumCatalogEntries,
    maximumTextBytes: input.maximumTextBytes,
    maximumPreimageBytes: input.maximumPreimageBytes,
  }));
}

function captureFrame(
  input: unknown,
  budget: CandidateBoundMutationInternalQueryRuntimeTargetEncodingBudgetV1,
): Result.Result<CandidateBoundMutationInternalQueryRuntimeTargetFrameV1, CandidateBoundMutationInternalQueryRuntimeTargetV1Error> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input)) return yield* fail("invalidInput", "$frame");
    const expectedKeys = 46;
    if (Reflect.ownKeys(input).length !== expectedKeys) {
      return yield* fail("invalidInput", "$frame");
    }
    const boundedText = (value: unknown, path: string) =>
      captureText(value, path, budget.maximumTextBytes);
    const scopeId = yield* boundedText(input.scopeId, "scopeId");
    if (input.storageGeneration !== "flarexdb_v1") {
      return yield* fail("invalidInput", "storageGeneration");
    }
    const storageGenerationFence = yield* positiveU64(
      input.storageGenerationFence, "storageGenerationFence",
    );
    const scopeEpoch = yield* boundedText(input.scopeEpoch, "scopeEpoch");
    const applicationRevisionId = yield* boundedText(
      input.applicationRevisionId, "applicationRevisionId",
    );
    const activationRevision = yield* positiveU64(
      input.activationRevision, "activationRevision",
    );
    const digests: Record<string, Uint8Array> = {};
    for (const field of DIGEST_FIELDS) {
      if (!isUint8ArrayWithByteLength(input[field], 32)) {
        return yield* fail("invalidInput", field);
      }
      digests[field] = copyBytes(input[field]);
    }
    const compatibilityDate = yield* boundedText(
      input.compatibilityDate, "compatibilityDate",
    );
    if (input.exactRuntimeProfile !==
        POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_PROFILE_V1 ||
      input.exactRuntimeVersion !== POINT_MUTATION_EXACT_RUNTIME_VERSION_V1 ||
      input.syscallAbiIdentity !==
        POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1) {
      return yield* fail("invalidInput", "runtimeIdentity");
    }
    const functionOrdinal = yield* nonNegativeU64(
      input.functionOrdinal, "functionOrdinal",
    );
    const functionPath = yield* boundedText(input.functionPath, "functionPath");
    const logicalExecutionModule = yield* boundedText(
      input.logicalExecutionModule, "logicalExecutionModule",
    );
    const artifactExecutionModule = yield* boundedText(
      input.artifactExecutionModule, "artifactExecutionModule",
    );
    const projectionExecutionModule = yield* boundedText(
      input.projectionExecutionModule, "projectionExecutionModule",
    );
    const exportName = yield* boundedText(input.exportName, "exportName");
    if (input.handlerKind !== "mutation" || input.visibility !== "public" ||
      input.group !== "transaction") {
      return yield* fail("invalidInput", "function");
    }
    const maximumInternalCalls = yield* positiveU64(
      input.maximumInternalCalls, "maximumInternalCalls",
    );
    const maximumInternalCallDepth = yield* positiveU64(
      input.maximumInternalCallDepth, "maximumInternalCallDepth",
    );
    const maximumInternalCallArgumentBytes = yield* positiveU64(
      input.maximumInternalCallArgumentBytes, "maximumInternalCallArgumentBytes",
    );
    const maximumInternalCallResultBytes = yield* positiveU64(
      input.maximumInternalCallResultBytes, "maximumInternalCallResultBytes",
    );
    if (
      maximumInternalCalls !== BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_CALLS_V1) ||
      maximumInternalCallDepth !==
        BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_DEPTH_V1) ||
      maximumInternalCallArgumentBytes !==
        BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_ARGUMENT_BYTES_V1) ||
      maximumInternalCallResultBytes !==
        BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_RESULT_BYTES_V1)
    ) return yield* fail("invalidInput", "internalCallBudget");
    const projectionSetReference = yield* captureReference(
      input.projectionSetReference, "runtime-projection-set",
      "projectionSetReference", budget.maximumTextBytes,
    );
    const functionGroupManifestReference = yield* captureReference(
      input.functionGroupManifestReference, "function-group-manifest",
      "functionGroupManifestReference", budget.maximumTextBytes,
    );
    const functionEntryReference = yield* captureReference(
      input.functionEntryReference, "function-group-entry",
      "functionEntryReference", budget.maximumTextBytes,
    );
    const projectionReference = yield* captureReference(
      input.projectionReference, "runtime-projection", "projectionReference",
      budget.maximumTextBytes,
    );
    if (!Array.isArray(input.modules) || input.modules.length === 0 ||
      input.modules.length > budget.maximumModules) {
      return yield* fail("invalidInput", "modules");
    }
    const modules: CandidateBoundMutationInternalQueryRuntimeTargetModuleV1[] = [];
    for (let index = 0; index < input.modules.length; index += 1) {
      const value = input.modules[index];
      if (!isNonArrayRecord(value) || Reflect.ownKeys(value).length !== 6) {
        return yield* fail("invalidInput", `modules[${index}]`);
      }
      const moduleOrdinal = yield* nonNegativeU64(
        value.moduleOrdinal, `modules[${index}].moduleOrdinal`,
      );
      if (moduleOrdinal !== BigInt(index)) {
        return yield* fail("invalidInput", `modules[${index}].moduleOrdinal`);
      }
      const modulePath = yield* boundedText(
        value.modulePath, `modules[${index}].modulePath`,
      );
      const roles = yield* nonNegativeU64(value.roles, `modules[${index}].roles`);
      const sourceByteLength = yield* positiveU64(
        value.sourceByteLength, `modules[${index}].sourceByteLength`,
      );
      if (!isUint8ArrayWithByteLength(value.sourceSha256, 32)) {
        return yield* fail("invalidInput", `modules[${index}].sourceSha256`);
      }
      const reference = yield* captureReference(
        value.reference, "runtime-projection-module",
        `modules[${index}].reference`, budget.maximumTextBytes,
      );
      modules.push(Object.freeze({
        moduleOrdinal, modulePath, roles, sourceByteLength,
        sourceSha256: copyBytes(value.sourceSha256), reference,
      }));
    }
    if (!Array.isArray(input.internalQueryCatalog) ||
      input.internalQueryCatalog.length > budget.maximumCatalogEntries) {
      return yield* fail("invalidInput", "internalQueryCatalog");
    }
    const internalQueryCatalog:
      CandidateBoundMutationInternalQueryRuntimeTargetCatalogEntryV1[] = [];
    let previousOrdinal = -1n;
    let previousPath = "";
    const paths = new Set<string>();
    const ordinals = new Set<bigint>();
    for (let index = 0; index < input.internalQueryCatalog.length; index += 1) {
      const value = input.internalQueryCatalog[index];
      if (!isNonArrayRecord(value) || Reflect.ownKeys(value).length !== 9 ||
        value.handlerKind !== "query" || value.visibility !== "internal" ||
        value.group !== "transaction") {
        return yield* fail("invalidInput", `internalQueryCatalog[${index}]`);
      }
      const entryOrdinal = yield* nonNegativeU64(
        value.functionOrdinal, `internalQueryCatalog[${index}].functionOrdinal`,
      );
      const entryPath = yield* boundedText(
        value.functionPath, `internalQueryCatalog[${index}].functionPath`,
      );
      if (ordinals.has(entryOrdinal) || paths.has(entryPath) ||
        entryOrdinal < previousOrdinal ||
        (entryOrdinal === previousOrdinal && entryPath <= previousPath)) {
        return yield* fail("invalidInput", `internalQueryCatalog[${index}]`);
      }
      ordinals.add(entryOrdinal);
      paths.add(entryPath);
      previousOrdinal = entryOrdinal;
      previousPath = entryPath;
      internalQueryCatalog.push(Object.freeze({
        functionOrdinal: entryOrdinal,
        functionPath: entryPath,
        logicalExecutionModule: yield* boundedText(
          value.logicalExecutionModule,
          `internalQueryCatalog[${index}].logicalExecutionModule`,
        ),
        artifactExecutionModule: yield* boundedText(
          value.artifactExecutionModule,
          `internalQueryCatalog[${index}].artifactExecutionModule`,
        ),
        exportName: yield* boundedText(
          value.exportName, `internalQueryCatalog[${index}].exportName`,
        ),
        handlerKind: "query" as const,
        visibility: "internal" as const,
        group: "transaction" as const,
        functionEntryReference: yield* captureReference(
          value.functionEntryReference, "function-group-entry",
          `internalQueryCatalog[${index}].functionEntryReference`,
          budget.maximumTextBytes,
        ),
      }));
    }
    return Object.freeze({
      scopeId, storageGeneration: "flarexdb_v1" as const,
      storageGenerationFence, scopeEpoch,
      applicationRevisionId, activationRevision,
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
      exactRuntimeGraphBasisSha256: digests.exactRuntimeGraphBasisSha256,
      projectionSha256: digests.projectionSha256,
      compatibilityDate,
      exactRuntimeProfile: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_PROFILE_V1,
      exactRuntimeVersion: POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
      syscallAbiIdentity: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1,
      functionOrdinal, functionPath, logicalExecutionModule,
      artifactExecutionModule, projectionExecutionModule, exportName,
      handlerKind: "mutation" as const, visibility: "public" as const,
      group: "transaction" as const, maximumInternalCalls,
      maximumInternalCallDepth, maximumInternalCallArgumentBytes,
      maximumInternalCallResultBytes, projectionSetReference,
      functionGroupManifestReference, functionEntryReference,
      projectionReference, modules: Object.freeze(modules),
      internalQueryCatalog: Object.freeze(internalQueryCatalog),
    });
  });
}

function captureReference(
  input: unknown,
  kind: DeclarativeV2RuntimeArtifactObjectReferenceV1["kind"],
  path: string,
  maximumTextBytes: number,
) {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 6 ||
      input.kind !== kind || typeof input.byteLength !== "bigint" ||
      input.byteLength < 1n || input.byteLength > BigInt(Number.MAX_SAFE_INTEGER) ||
      !isUint8ArrayWithByteLength(input.sha256, 32)) {
      return yield* fail("invalidInput", path);
    }
    const objectKey = yield* captureText(
      input.objectKey, `${path}.objectKey`, maximumTextBytes,
    );
    const canonical = yield* makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
      kind, input.sha256, Number(input.byteLength),
    ).pipe(Result.mapError(() => new CandidateBoundMutationInternalQueryRuntimeTargetV1Error({
      reason: "invalidInput", path,
    })));
    if (input.storeIdentity !== canonical.storeIdentity ||
      input.codecIdentity !== canonical.codecIdentity || objectKey !== canonical.objectKey) {
      return yield* fail("invalidInput", path);
    }
    return canonical;
  });
}

function captureText(input: unknown, path: string, maximum: number) {
  if (typeof input !== "string" || !isNonBlankString(input) || input.includes("\0")) {
    return fail("invalidInput", path);
  }
  const length = UTF8.encode(input).byteLength;
  return length <= maximum
    ? Result.succeed(input)
    : Result.fail(new CandidateBoundMutationInternalQueryRuntimeTargetV1Error({
        reason: "budgetExceeded", path, observed: length, maximum,
      }));
}

function nonNegativeU64(input: unknown, path: string) {
  return typeof input === "bigint" && input >= 0n && input <= MAX_U64
    ? Result.succeed(input)
    : fail("invalidInput", path);
}

function positiveU64(input: unknown, path: string) {
  return typeof input === "bigint" && input >= 1n && input <= MAX_U64
    ? Result.succeed(input)
    : fail("invalidInput", path);
}

function referenceSegments(reference: DeclarativeV2RuntimeArtifactObjectReferenceV1) {
  return [
    text(reference.storeIdentity), text(reference.kind),
    text(reference.codecIdentity), text(reference.objectKey),
    u64(reference.byteLength), reference.sha256,
  ];
}

function text(value: string) {
  const bytes = UTF8.encode(value);
  const output = new Uint8Array(4 + bytes.byteLength);
  new DataView(output.buffer).setUint32(0, bytes.byteLength, false);
  output.set(bytes, 4);
  return output;
}

function u32(value: number) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function u64(value: bigint) {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, false);
  return output;
}

function fail(reason: CandidateBoundMutationInternalQueryRuntimeTargetV1Error["reason"], path: string) {
  return Result.fail(new CandidateBoundMutationInternalQueryRuntimeTargetV1Error({ reason, path }));
}
