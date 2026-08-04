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
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
} from "./edge-action-host-policy-v1";
import { EDGE_ACTION_EXACT_RUNTIME_VERSION_V1 } from
  "./edge-action-exact-runtime";

export const CANDIDATE_BOUND_EDGE_ACTION_RUNTIME_TARGET_IDENTITY_V1 =
  "flarex.system/candidate-bound-edge-action-runtime-target/v1" as const;

const UTF8 = new TextEncoder();
const DOMAIN = UTF8.encode(
  `${CANDIDATE_BOUND_EDGE_ACTION_RUNTIME_TARGET_IDENTITY_V1}\0`,
);
const MAX_U64 = (1n << 64n) - 1n;

export interface CandidateBoundEdgeActionRuntimeTargetModuleV1 {
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly roles: bigint;
  readonly sourceByteLength: bigint;
  readonly sourceSha256: Uint8Array;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface CandidateBoundEdgeActionRuntimeTargetFrameV1 {
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
  readonly exactRuntimeProfile: typeof EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1;
  readonly exactRuntimeVersion: typeof EDGE_ACTION_EXACT_RUNTIME_VERSION_V1;
  readonly syscallAbiIdentity: typeof EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1;
  readonly exactRuntimeGraphBasisSha256: Uint8Array;
  readonly hostPolicySha256: Uint8Array;
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly projectionExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "action";
  readonly visibility: "public";
  readonly group: "edge_action";
  readonly projectionSha256: Uint8Array;
  readonly projectionSetReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly functionGroupManifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly functionEntryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly projectionReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly modules: ReadonlyArray<CandidateBoundEdgeActionRuntimeTargetModuleV1>;
}

export interface CandidateBoundEdgeActionRuntimeTargetEncodingBudgetV1 {
  readonly maximumModules: number;
  readonly maximumTextBytes: number;
  readonly maximumPreimageBytes: number;
}

export class CandidateBoundEdgeActionRuntimeTargetV1Error
  extends Data.TaggedError("CandidateBoundEdgeActionRuntimeTargetV1Error")<{
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
  "hostPolicySha256", "projectionSha256",
] as const;

export function encodeCandidateBoundEdgeActionRuntimeTargetV1(
  input: unknown,
  budgetInput: unknown,
): Result.Result<
  Readonly<{
    readonly frame: CandidateBoundEdgeActionRuntimeTargetFrameV1;
    readonly canonicalBytes: Uint8Array;
  }>,
  CandidateBoundEdgeActionRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureBudget(budgetInput);
    const frame = yield* captureFrame(input, budget);
    const segments: Uint8Array[] = [
      DOMAIN,
      text(frame.scopeId), text(frame.storageGeneration),
      u64(frame.storageGenerationFence), text(frame.scopeEpoch),
      text(frame.applicationRevisionId), u64(frame.activationRevision),
      ...DIGEST_FIELDS.slice(0, 15).map(field => frame[field]),
      text(frame.compatibilityDate), text(frame.exactRuntimeProfile),
      u32(frame.exactRuntimeVersion), text(frame.syscallAbiIdentity),
      frame.exactRuntimeGraphBasisSha256, frame.hostPolicySha256,
      u64(frame.functionOrdinal), text(frame.functionPath),
      text(frame.logicalExecutionModule), text(frame.artifactExecutionModule),
      text(frame.projectionExecutionModule), text(frame.exportName),
      text(frame.handlerKind), text(frame.visibility), text(frame.group),
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
    const byteLength = segments.reduce(
      (sum, segment) => sum + segment.byteLength,
      0,
    );
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength > budget.maximumPreimageBytes
    ) {
      return yield* Result.fail(
        new CandidateBoundEdgeActionRuntimeTargetV1Error({
          reason: "budgetExceeded",
          path: "$bytes",
          observed: byteLength,
          maximum: budget.maximumPreimageBytes,
        }),
      );
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

function captureBudget(input: unknown): Result.Result<
  CandidateBoundEdgeActionRuntimeTargetEncodingBudgetV1,
  CandidateBoundEdgeActionRuntimeTargetV1Error
> {
  if (
    !isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 3 ||
    !isNonNegativeSafeInteger(input.maximumModules) ||
    !isNonNegativeSafeInteger(input.maximumTextBytes) ||
    !isNonNegativeSafeInteger(input.maximumPreimageBytes) ||
    input.maximumTextBytes > 0xffff_ffff
  ) return fail("invalidBudget", "budget");
  return Result.succeed(Object.freeze({
    maximumModules: input.maximumModules,
    maximumTextBytes: input.maximumTextBytes,
    maximumPreimageBytes: input.maximumPreimageBytes,
  }));
}

function captureFrame(
  input: unknown,
  budget: CandidateBoundEdgeActionRuntimeTargetEncodingBudgetV1,
): Result.Result<
  CandidateBoundEdgeActionRuntimeTargetFrameV1,
  CandidateBoundEdgeActionRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 42) {
      return yield* fail("invalidInput", "$frame");
    }
    const bounded = (value: unknown, path: string) =>
      captureText(value, path, budget.maximumTextBytes);
    const scopeId = yield* bounded(input.scopeId, "scopeId");
    if (input.storageGeneration !== "flarexdb_v1") {
      return yield* fail("invalidInput", "storageGeneration");
    }
    const storageGenerationFence = yield* positiveU64(
      input.storageGenerationFence,
      "storageGenerationFence",
    );
    const scopeEpoch = yield* bounded(input.scopeEpoch, "scopeEpoch");
    const applicationRevisionId = yield* bounded(
      input.applicationRevisionId,
      "applicationRevisionId",
    );
    const activationRevision = yield* positiveU64(
      input.activationRevision,
      "activationRevision",
    );
    const digests = new Map<(typeof DIGEST_FIELDS)[number], Uint8Array>();
    for (const field of DIGEST_FIELDS) {
      const value = input[field];
      if (!isUint8ArrayWithByteLength(value, 32)) {
        return yield* fail("invalidInput", field);
      }
      digests.set(field, copyBytes(value));
    }
    const digest = (field: (typeof DIGEST_FIELDS)[number]): Uint8Array => {
      const value = digests.get(field);
      if (value === undefined) throw new Error(`Missing captured ${field}.`);
      return value;
    };
    const compatibilityDate = yield* bounded(
      input.compatibilityDate,
      "compatibilityDate",
    );
    if (
      input.exactRuntimeProfile !== EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1 ||
      input.exactRuntimeVersion !== EDGE_ACTION_EXACT_RUNTIME_VERSION_V1 ||
      input.syscallAbiIdentity !== EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1
    ) return yield* fail("invalidInput", "runtimeIdentity");
    const functionOrdinal = yield* nonNegativeU64(
      input.functionOrdinal,
      "functionOrdinal",
    );
    const functionPath = yield* bounded(input.functionPath, "functionPath");
    const logicalExecutionModule = yield* bounded(
      input.logicalExecutionModule,
      "logicalExecutionModule",
    );
    const artifactExecutionModule = yield* bounded(
      input.artifactExecutionModule,
      "artifactExecutionModule",
    );
    const projectionExecutionModule = yield* bounded(
      input.projectionExecutionModule,
      "projectionExecutionModule",
    );
    const exportName = yield* bounded(input.exportName, "exportName");
    if (
      input.handlerKind !== "action" || input.visibility !== "public" ||
      input.group !== "edge_action"
    ) return yield* fail("invalidInput", "function");
    const projectionSetReference = yield* captureReference(
      input.projectionSetReference,
      "runtime-projection-set",
      "projectionSetReference",
      budget.maximumTextBytes,
    );
    const functionGroupManifestReference = yield* captureReference(
      input.functionGroupManifestReference,
      "function-group-manifest",
      "functionGroupManifestReference",
      budget.maximumTextBytes,
    );
    const functionEntryReference = yield* captureReference(
      input.functionEntryReference,
      "function-group-entry",
      "functionEntryReference",
      budget.maximumTextBytes,
    );
    const projectionReference = yield* captureReference(
      input.projectionReference,
      "runtime-projection",
      "projectionReference",
      budget.maximumTextBytes,
    );
    if (!Array.isArray(input.modules) ||
      input.modules.length > budget.maximumModules) {
      return yield* fail("invalidInput", "modules");
    }
    const modules: CandidateBoundEdgeActionRuntimeTargetModuleV1[] = [];
    for (let index = 0; index < input.modules.length; index += 1) {
      modules.push(yield* captureModule(
        input.modules[index],
        index,
        budget.maximumTextBytes,
      ));
    }
    return Object.freeze({
      scopeId,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence,
      scopeEpoch,
      applicationRevisionId,
      activationRevision,
      activationHeadSha256: digest("activationHeadSha256"),
      readinessReceiptSha256: digest("readinessReceiptSha256"),
      candidateSha256: digest("candidateSha256"),
      attemptSha256: digest("attemptSha256"),
      packageSha256: digest("packageSha256"),
      artifactSha256: digest("artifactSha256"),
      sourceRootSha256: digest("sourceRootSha256"),
      semanticRootSha256: digest("semanticRootSha256"),
      schemaArtifactSha256: digest("schemaArtifactSha256"),
      schemaBindingSha256: digest("schemaBindingSha256"),
      functionMetadataSha256: digest("functionMetadataSha256"),
      validatorRootSha256: digest("validatorRootSha256"),
      declaredHandlerSetSha256: digest("declaredHandlerSetSha256"),
      runtimeProjectionSetSha256: digest("runtimeProjectionSetSha256"),
      functionGroupManifestSha256: digest("functionGroupManifestSha256"),
      compatibilityDate,
      exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
      exactRuntimeVersion: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
      syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
      exactRuntimeGraphBasisSha256: digest("exactRuntimeGraphBasisSha256"),
      hostPolicySha256: digest("hostPolicySha256"),
      functionOrdinal,
      functionPath,
      logicalExecutionModule,
      artifactExecutionModule,
      projectionExecutionModule,
      exportName,
      handlerKind: "action",
      visibility: "public",
      group: "edge_action",
      projectionSha256: digest("projectionSha256"),
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
): Result.Result<
  CandidateBoundEdgeActionRuntimeTargetModuleV1,
  CandidateBoundEdgeActionRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    const path = `modules[${index}]`;
    if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 6) {
      return yield* fail("invalidInput", path);
    }
    const moduleOrdinal = yield* nonNegativeU64(
      input.moduleOrdinal,
      `${path}.moduleOrdinal`,
    );
    if (moduleOrdinal !== BigInt(index)) {
      return yield* fail("invalidInput", `${path}.moduleOrdinal`);
    }
    const modulePath = yield* captureText(
      input.modulePath,
      `${path}.modulePath`,
      maximumTextBytes,
    );
    const roles = yield* nonNegativeU64(input.roles, `${path}.roles`);
    const sourceByteLength = yield* positiveU64(
      input.sourceByteLength,
      `${path}.sourceByteLength`,
    );
    if (!isUint8ArrayWithByteLength(input.sourceSha256, 32)) {
      return yield* fail("invalidInput", `${path}.sourceSha256`);
    }
    const reference = yield* captureReference(
      input.reference,
      "runtime-projection-module",
      `${path}.reference`,
      maximumTextBytes,
    );
    if (reference.byteLength < sourceByteLength) {
      return yield* fail("invalidInput", `${path}.reference.byteLength`);
    }
    return Object.freeze({
      moduleOrdinal,
      modulePath,
      roles,
      sourceByteLength,
      sourceSha256: copyBytes(input.sourceSha256),
      reference,
    });
  });
}

function captureReference(
  input: unknown,
  kind: DeclarativeV2RuntimeArtifactObjectReferenceV1["kind"],
  path: string,
  maximumTextBytes: number,
): Result.Result<
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
  CandidateBoundEdgeActionRuntimeTargetV1Error
> {
  return Result.gen(function* () {
    if (
      !isNonArrayRecord(input) || Reflect.ownKeys(input).length !== 6 ||
      input.kind !== kind ||
      typeof input.objectKey !== "string" ||
      UTF8.encode(input.objectKey).byteLength > maximumTextBytes ||
      typeof input.byteLength !== "bigint" || input.byteLength < 1n ||
      input.byteLength > BigInt(Number.MAX_SAFE_INTEGER) ||
      !isUint8ArrayWithByteLength(input.sha256, 32)
    ) return yield* fail("invalidInput", path);
    const made = yield* makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
      kind,
      input.sha256,
      Number(input.byteLength),
    ).pipe(Result.mapError(() =>
      new CandidateBoundEdgeActionRuntimeTargetV1Error({
        reason: "invalidInput",
        path,
      })
    ));
    if (
      input.storeIdentity !== made.storeIdentity ||
      input.codecIdentity !== made.codecIdentity ||
      input.objectKey !== made.objectKey
    ) return yield* fail("invalidInput", path);
    return made;
  });
}

function captureText(
  input: unknown,
  path: string,
  maximumBytes: number,
): Result.Result<string, CandidateBoundEdgeActionRuntimeTargetV1Error> {
  if (
    typeof input !== "string" || !isNonBlankString(input) ||
    input.includes("\0") || UTF8.encode(input).byteLength > maximumBytes
  ) return fail("invalidInput", path);
  return Result.succeed(input);
}

function positiveU64(
  input: unknown,
  path: string,
): Result.Result<bigint, CandidateBoundEdgeActionRuntimeTargetV1Error> {
  return typeof input === "bigint" && input > 0n && input <= MAX_U64
    ? Result.succeed(input)
    : fail("invalidInput", path);
}

function nonNegativeU64(
  input: unknown,
  path: string,
): Result.Result<bigint, CandidateBoundEdgeActionRuntimeTargetV1Error> {
  return typeof input === "bigint" && input >= 0n && input <= MAX_U64
    ? Result.succeed(input)
    : fail("invalidInput", path);
}

function referenceSegments(
  reference: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): ReadonlyArray<Uint8Array> {
  return [
    text(reference.storeIdentity), text(reference.kind),
    text(reference.codecIdentity), text(reference.objectKey),
    u64(reference.byteLength), reference.sha256,
  ];
}

function text(input: string): Uint8Array {
  const bytes = UTF8.encode(input);
  const framed = new Uint8Array(4 + bytes.byteLength);
  new DataView(framed.buffer).setUint32(0, bytes.byteLength, false);
  framed.set(bytes, 4);
  return framed;
}

function u32(input: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, input, false);
  return bytes;
}

function u64(input: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, input, false);
  return bytes;
}

function fail(
  reason: CandidateBoundEdgeActionRuntimeTargetV1Error["reason"],
  path: string,
): Result.Result<never, CandidateBoundEdgeActionRuntimeTargetV1Error> {
  return Result.fail(new CandidateBoundEdgeActionRuntimeTargetV1Error({
    reason,
    path,
  }));
}
