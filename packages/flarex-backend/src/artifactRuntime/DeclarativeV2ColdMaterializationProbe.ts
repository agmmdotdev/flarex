import { bytesEqualFullScan, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Effect, Result, Scope } from "effect";
import {
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
  type DeclarativeV2ColdMaterializationReceiptFrameV1,
  type DeclarativeV2FunctionGroupEntryFrameV1,
  type DeclarativeV2FunctionGroupManifestFrameV1,
  type DeclarativeV2RuntimeExecutionGroupV1,
  type DeclarativeV2RuntimeProjectionFrameV1,
  type DeclarativeV2RuntimeProjectionModuleFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
  DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1,
  frameDeclarativeV2RuntimeRootSha256PreimageV1,
  type DeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";

import {
  type DeclarativeV2RuntimeArtifactR2AdmissionV1,
  type DeclarativeV2RuntimeArtifactR2StoreV1,
  type DeclarativeV2RuntimeArtifactR2V1Error,
} from "./DeclarativeV2RuntimeArtifactStore";
import {
  makeLiveDeclarativeV2RuntimeArtifactSha256V1,
  type DeclarativeV2RuntimeArtifactSha256V1,
  type DeclarativeV2RuntimeArtifactSha256V1Error,
} from "./DeclarativeV2RuntimeArtifactSha256";

const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 64 * 1_048_576,
  maximumCanonicalBytes: 64 * 1_048_576,
});
const HASH_BUDGET = Object.freeze({ maximumInputBytes: 64 * 1_048_576 });
const ROOT_BUDGET = Object.freeze({
  maximumDigests: 32_768,
  maximumPreimageBytes: 2 * 1_048_576,
});
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

export interface DeclarativeV2ColdMaterializationBudgetV1 {
  readonly maximumGroups: number;
  readonly maximumModulesPerGroup: number;
  readonly maximumRawBytesPerGroup: number;
  readonly maximumObjects: number;
  readonly maximumObjectBytes: number;
  readonly maximumCompressedBytesPerGroup: number;
  readonly maximumStartupMilliseconds: number;
}

export interface DeclarativeV2ColdMaterializationModuleV1 {
  readonly path: string;
  readonly code: string;
}

export interface DeclarativeV2ColdMaterializationRequestV1 {
  readonly group: DeclarativeV2RuntimeExecutionGroupV1;
  readonly executionModule: string;
  readonly modules: ReadonlyArray<DeclarativeV2ColdMaterializationModuleV1>;
}

export interface DeclarativeV2ColdMaterializationObservationV1 {
  readonly compressedByteLength: number;
  readonly startupMilliseconds: number;
}

export interface DeclarativeV2ColdMaterializerV1<E> {
  readonly identity: string;
  readonly materialize: (
    request: DeclarativeV2ColdMaterializationRequestV1,
  ) => Effect.Effect<
    DeclarativeV2ColdMaterializationObservationV1,
    E,
    Scope.Scope
  >;
}

export interface DeclarativeV2ColdStoredModuleAuthorityV1 {
  readonly group: DeclarativeV2RuntimeExecutionGroupV1;
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly roles: bigint;
  readonly sourceByteLength: bigint;
  readonly sourceSha256: Uint8Array;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface DeclarativeV2ColdStoredProjectionAuthorityV1 {
  readonly frame: DeclarativeV2RuntimeProjectionFrameV1;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly modules: ReadonlyArray<DeclarativeV2ColdStoredModuleAuthorityV1>;
}

export interface DeclarativeV2ColdMaterializationPublicationV1 {
  readonly projectionSetReference:
    DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly manifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly manifestFrame: DeclarativeV2FunctionGroupManifestFrameV1;
  readonly projections:
    ReadonlyArray<DeclarativeV2ColdStoredProjectionAuthorityV1>;
  readonly functionEntries: ReadonlyArray<
    Readonly<{
      readonly frame: DeclarativeV2FunctionGroupEntryFrameV1;
      readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    }>
  >;
}

export interface DeclarativeV2ColdMaterializationProbeInputV1 {
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly publication: DeclarativeV2ColdMaterializationPublicationV1;
  readonly budget: DeclarativeV2ColdMaterializationBudgetV1;
}

export interface DeclarativeV2ColdMaterializationReceiptV1 {
  readonly codecIdentity:
    typeof DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1;
  readonly frame: DeclarativeV2ColdMaterializationReceiptFrameV1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export class DeclarativeV2ColdMaterializationProbeV1Error
  extends Data.TaggedError("DeclarativeV2ColdMaterializationProbeV1Error")<{
    readonly reason:
      | "invalidBudget"
      | "authorityMismatch"
      | "projectionMismatch"
      | "manifestMismatch"
      | "invalidSourceUtf8"
      | "resourceExceeded"
      | "invalidObservation";
    readonly path?: string;
    readonly dimension?:
      | "groups"
      | "modules"
      | "rawBytes"
      | "objects"
      | "objectBytes"
      | "compressedBytes"
      | "startupMilliseconds";
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export type DeclarativeV2ColdMaterializationProbeV1Failure<E> =
  | DeclarativeV2ColdMaterializationProbeV1Error
  | DeclarativeV2RuntimeArtifactR2V1Error
  | DeclarativeV2RuntimeArtifactSha256V1Error
  | E;

export const probeDeclarativeV2ColdMaterializationV1 = Effect.fn(
  "ArtifactRuntime.probeDeclarativeV2ColdMaterializationV1",
)(function* <E>(
  input: DeclarativeV2ColdMaterializationProbeInputV1,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  materializer: DeclarativeV2ColdMaterializerV1<E>,
  sha256: DeclarativeV2RuntimeArtifactSha256V1 =
    makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
): Effect.fn.Return<
  ReadonlyArray<DeclarativeV2ColdMaterializationReceiptV1>,
  DeclarativeV2ColdMaterializationProbeV1Failure<E>,
  Scope.Scope
> {
  const budget = yield* validateBudget(input.budget);
  const candidateSha256 = yield* hashFrame(input.candidate, sha256);
  if (
    !isUint8ArrayWithByteLength(input.candidateSha256, 32) ||
    !bytesEqualFullScan(candidateSha256, input.candidateSha256) ||
    input.candidate.readinessPolicyIdentity !==
      DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1 ||
    !bytesEqualFullScan(
      input.candidate.runtimeProjectionSetSha256,
      input.publication.projectionSetReference.sha256,
    ) ||
    !bytesEqualFullScan(
      input.candidate.functionGroupManifestSha256,
      input.publication.manifestReference.sha256,
    )
  ) return yield* probeFailure("authorityMismatch", "candidate");

  const admission = makeAdmission(budget);
  const projectionSetObject = yield* store.readImmutableAdmitted(
    "runtime-projection-set",
    input.publication.projectionSetReference.sha256,
    admission(input.publication.projectionSetReference, "projectionSet"),
  );
  const projectionSet = yield* decodeFrame(
    projectionSetObject.bytes,
    "runtime_projection_set",
    "projectionSet",
  );
  const manifestObject = yield* store.readImmutableAdmitted(
    "function-group-manifest",
    input.publication.manifestReference.sha256,
    admission(input.publication.manifestReference, "manifest"),
  );
  const manifest = yield* decodeFrame(
    manifestObject.bytes,
    "function_group_manifest",
    "manifest",
  );
  if (
    !manifestFrameEqual(manifest, input.publication.manifestFrame) ||
    !bytesEqualFullScan(
      manifest.runtimeProjectionSetSha256,
      input.publication.projectionSetReference.sha256,
    ) ||
    !bytesEqualFullScan(
      manifest.validatorRootSha256,
      input.candidate.validatorRootSha256,
    ) ||
    !bytesEqualFullScan(
      manifest.declaredHandlerSetSha256,
      input.candidate.declaredHandlerSetSha256,
    )
  ) return yield* probeFailure("manifestMismatch", "manifest");
  if (input.publication.projections.length > budget.maximumGroups) {
    return yield* exceeded(
      "groups",
      input.publication.projections.length,
      budget.maximumGroups,
    );
  }

  const projectionByGroup = new Map(
    input.publication.projections.map(item => [
      item.frame.group,
      item.reference.sha256,
    ]),
  );
  if (
    projectionSet.groupCount !== BigInt(input.publication.projections.length) ||
    !nullableDigestEqual(
      projectionSet.transactionProjectionSha256,
      projectionByGroup.get("transaction") ?? null,
    ) ||
    !nullableDigestEqual(
      projectionSet.edgeActionProjectionSha256,
      projectionByGroup.get("edge_action") ?? null,
    )
  ) return yield* probeFailure("projectionMismatch", "projectionSet");

  const entryDigests: Uint8Array[] = [];
  for (let ordinal = 0; ordinal < input.publication.functionEntries.length; ordinal += 1) {
    const authority = input.publication.functionEntries[ordinal]!;
    const object = yield* store.readImmutableAdmitted(
      "function-group-entry",
      authority.reference.sha256,
      admission(authority.reference, `entries[${ordinal}]`),
    );
    const frame = yield* decodeFrame(
      object.bytes,
      "function_group_entry",
      `entries[${ordinal}]`,
    );
    if (!functionEntryEqual(frame, authority.frame)) {
      return yield* probeFailure("manifestMismatch", `entries[${ordinal}]`);
    }
    entryDigests.push(authority.reference.sha256);
  }
  const functionRootPreimage = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "functionGroupEntries",
      null,
      entryDigests,
      ROOT_BUDGET,
    ),
  ).pipe(Effect.orDie);
  const functionRoot = yield* sha256(functionRootPreimage, HASH_BUDGET);
  if (
    manifest.functionCount !== BigInt(entryDigests.length) ||
    !bytesEqualFullScan(manifest.functionRootSha256, functionRoot)
  ) return yield* probeFailure("manifestMismatch", "manifest.functionRoot");

  const receipts: DeclarativeV2ColdMaterializationReceiptV1[] = [];
  for (const authority of input.publication.projections) {
    const group = authority.frame.group;
    const projectionObject = yield* store.readImmutableAdmitted(
      "runtime-projection",
      authority.reference.sha256,
      admission(authority.reference, `projections.${group}`),
    );
    const projection = yield* decodeFrame(
      projectionObject.bytes,
      "runtime_projection",
      `projections.${group}`,
    );
    if (!projectionFrameEqual(projection, authority.frame)) {
      return yield* probeFailure("projectionMismatch", `projections.${group}`);
    }
    if (authority.modules.length > budget.maximumModulesPerGroup) {
      return yield* exceeded(
        "modules",
        authority.modules.length,
        budget.maximumModulesPerGroup,
      );
    }
    const modules: DeclarativeV2ColdMaterializationModuleV1[] = [];
    const moduleDigests: Uint8Array[] = [];
    let rawByteLength = 0;
    let hasExecutionModule = false;
    for (let ordinal = 0; ordinal < authority.modules.length; ordinal += 1) {
      const stored = authority.modules[ordinal]!;
      const object = yield* store.readImmutableAdmitted(
        "runtime-projection-module",
        stored.reference.sha256,
        admission(stored.reference, `projections.${group}.modules[${ordinal}]`),
      );
      const frame = yield* decodeFrame(
        object.bytes,
        "runtime_projection_module",
        `projections.${group}.modules[${ordinal}]`,
      );
      if (
        frame.group !== stored.group ||
        frame.moduleOrdinal !== stored.moduleOrdinal ||
        frame.modulePath !== stored.modulePath ||
        frame.roles !== stored.roles ||
        BigInt(frame.sourceBytes.byteLength) !== stored.sourceByteLength ||
        !bytesEqualFullScan(frame.sourceSha256, stored.sourceSha256)
      ) return yield* probeFailure("projectionMismatch", `projections.${group}.modules[${ordinal}]`);
      const sourceDigest = yield* sha256(frame.sourceBytes, HASH_BUDGET);
      if (!bytesEqualFullScan(sourceDigest, frame.sourceSha256)) {
        return yield* probeFailure("projectionMismatch", `projections.${group}.modules[${ordinal}].sourceSha256`);
      }
      rawByteLength += frame.sourceBytes.byteLength;
      if (rawByteLength > budget.maximumRawBytesPerGroup) {
        return yield* exceeded(
          "rawBytes",
          rawByteLength,
          budget.maximumRawBytesPerGroup,
        );
      }
      let code: string;
      try {
        code = FATAL_UTF8.decode(frame.sourceBytes);
      } catch {
        return yield* probeFailure("invalidSourceUtf8", `projections.${group}.modules[${ordinal}]`);
      }
      hasExecutionModule ||= frame.modulePath === projection.executionModule;
      moduleDigests.push(stored.reference.sha256);
      modules.push(Object.freeze({ path: frame.modulePath, code }));
    }
    const rootPreimage = yield* Effect.fromResult(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "runtimeProjectionModules",
        group,
        moduleDigests,
        ROOT_BUDGET,
      ),
    ).pipe(Effect.orDie);
    const root = yield* sha256(rootPreimage, HASH_BUDGET);
    if (
      projection.moduleCount !== BigInt(modules.length) ||
      projection.rawByteLength !== BigInt(rawByteLength) ||
      !bytesEqualFullScan(projection.moduleRootSha256, root) ||
      !hasExecutionModule
    ) return yield* probeFailure("projectionMismatch", `projections.${group}.root`);

    const observation = yield* materializer.materialize(Object.freeze({
      group,
      executionModule: projection.executionModule,
      modules: Object.freeze(modules),
    }));
    if (
      !isNonNegativeSafeInteger(observation.compressedByteLength) ||
      !isNonNegativeSafeInteger(observation.startupMilliseconds)
    ) return yield* probeFailure("invalidObservation", group);
    if (observation.compressedByteLength > budget.maximumCompressedBytesPerGroup) {
      return yield* exceeded("compressedBytes", observation.compressedByteLength, budget.maximumCompressedBytesPerGroup);
    }
    if (observation.startupMilliseconds > budget.maximumStartupMilliseconds) {
      return yield* exceeded("startupMilliseconds", observation.startupMilliseconds, budget.maximumStartupMilliseconds);
    }
    const frame = Object.freeze({
      kind: "cold_materialization_receipt",
      candidateSha256: new Uint8Array(input.candidateSha256),
      group,
      projectionSha256: new Uint8Array(authority.reference.sha256),
      functionGroupManifestSha256: new Uint8Array(input.publication.manifestReference.sha256),
      materializerIdentity: materializer.identity,
      moduleCount: BigInt(modules.length),
      rawByteLength: BigInt(rawByteLength),
      compressedByteLength: BigInt(observation.compressedByteLength),
      startupMilliseconds: BigInt(observation.startupMilliseconds),
    } satisfies DeclarativeV2ColdMaterializationReceiptFrameV1);
    const canonicalBytes = yield* Effect.fromResult(
      encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET).pipe(
        Result.map(encoded => new Uint8Array(encoded.canonicalBytes)),
      ),
    ).pipe(Effect.orDie);
    receipts.push(Object.freeze({
      codecIdentity: DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
      frame,
      canonicalBytes,
      sha256: yield* sha256(canonicalBytes, HASH_BUDGET),
    }));
  }
  return Object.freeze(receipts);
});

function makeAdmission(budget: DeclarativeV2ColdMaterializationBudgetV1) {
  let objectCount = 0;
  let objectBytes = 0;
  return (
    expected: DeclarativeV2RuntimeArtifactObjectReferenceV1,
    path: string,
  ) => (
    receipt: DeclarativeV2RuntimeArtifactR2AdmissionV1,
  ): Effect.Effect<void, DeclarativeV2ColdMaterializationProbeV1Error> => {
    if (!referenceEqual(expected, receipt.reference)) {
      return probeFailure("authorityMismatch", `${path}.reference`);
    }
    objectCount += 1;
    objectBytes += Number(receipt.reference.byteLength);
    if (objectCount > budget.maximumObjects) {
      return exceeded("objects", objectCount, budget.maximumObjects);
    }
    if (!Number.isSafeInteger(objectBytes) || objectBytes > budget.maximumObjectBytes) {
      return exceeded("objectBytes", objectBytes, budget.maximumObjectBytes);
    }
    return Effect.void;
  };
}

function decodeFrame<K extends
  | "runtime_projection_set"
  | "function_group_manifest"
  | "function_group_entry"
  | "runtime_projection"
  | "runtime_projection_module"
>(bytes: Uint8Array, kind: K, path: string): Effect.Effect<
  Extract<ReturnType<typeof decodeDeclarativeV2PhysicalFrameV1> extends Result.Result<infer A, unknown> ? A extends { frame: infer F } ? F : never : never, { kind: K }>,
  DeclarativeV2ColdMaterializationProbeV1Error
> {
  return Effect.fromResult(
    decodeDeclarativeV2PhysicalFrameV1(bytes, FRAME_BUDGET).pipe(
      Result.flatMap(decoded => decoded.frame.kind === kind
        ? Result.succeed(decoded.frame as never)
        : Result.fail(new DeclarativeV2ColdMaterializationProbeV1Error({ reason: "authorityMismatch", path }))),
      Result.mapError(error => error instanceof DeclarativeV2ColdMaterializationProbeV1Error
        ? error
        : new DeclarativeV2ColdMaterializationProbeV1Error({ reason: "authorityMismatch", path })),
    ),
  );
}

function hashFrame(
  frame: DeclarativeV2CandidateFrameV1,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
): Effect.Effect<Uint8Array, DeclarativeV2RuntimeArtifactSha256V1Error> {
  return Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET).pipe(
      Result.map(encoded => encoded.canonicalBytes),
    ),
  ).pipe(Effect.orDie, Effect.flatMap(bytes => sha256(bytes, HASH_BUDGET)));
}

function validateBudget(budget: DeclarativeV2ColdMaterializationBudgetV1) {
  let snapshot: DeclarativeV2ColdMaterializationBudgetV1;
  try {
    snapshot = Object.freeze({
      maximumGroups: budget.maximumGroups,
      maximumModulesPerGroup: budget.maximumModulesPerGroup,
      maximumRawBytesPerGroup: budget.maximumRawBytesPerGroup,
      maximumObjects: budget.maximumObjects,
      maximumObjectBytes: budget.maximumObjectBytes,
      maximumCompressedBytesPerGroup: budget.maximumCompressedBytesPerGroup,
      maximumStartupMilliseconds: budget.maximumStartupMilliseconds,
    });
  } catch {
    return probeFailure("invalidBudget", "budget");
  }
  return isNonNegativeSafeInteger(snapshot.maximumGroups) &&
      isNonNegativeSafeInteger(snapshot.maximumModulesPerGroup) &&
      isNonNegativeSafeInteger(snapshot.maximumRawBytesPerGroup) &&
      isNonNegativeSafeInteger(snapshot.maximumObjects) &&
      isNonNegativeSafeInteger(snapshot.maximumObjectBytes) &&
      isNonNegativeSafeInteger(snapshot.maximumCompressedBytesPerGroup) &&
      isNonNegativeSafeInteger(snapshot.maximumStartupMilliseconds)
    ? Effect.succeed(snapshot)
    : probeFailure("invalidBudget", "budget");
}

function referenceEqual(left: DeclarativeV2RuntimeArtifactObjectReferenceV1, right: DeclarativeV2RuntimeArtifactObjectReferenceV1) {
  return left.storeIdentity === right.storeIdentity && left.kind === right.kind && left.codecIdentity === right.codecIdentity && left.objectKey === right.objectKey && left.byteLength === right.byteLength && bytesEqualFullScan(left.sha256, right.sha256);
}
function projectionFrameEqual(left: DeclarativeV2RuntimeProjectionFrameV1, right: DeclarativeV2RuntimeProjectionFrameV1) {
  return left.group === right.group && left.executionModule === right.executionModule && left.moduleCount === right.moduleCount && left.rawByteLength === right.rawByteLength && bytesEqualFullScan(left.moduleRootSha256, right.moduleRootSha256);
}
function manifestFrameEqual(left: DeclarativeV2FunctionGroupManifestFrameV1, right: DeclarativeV2FunctionGroupManifestFrameV1) {
  return bytesEqualFullScan(left.runtimeProjectionSetSha256, right.runtimeProjectionSetSha256) && left.functionCount === right.functionCount && bytesEqualFullScan(left.functionRootSha256, right.functionRootSha256) && bytesEqualFullScan(left.validatorRootSha256, right.validatorRootSha256) && bytesEqualFullScan(left.declaredHandlerSetSha256, right.declaredHandlerSetSha256);
}
function functionEntryEqual(left: DeclarativeV2FunctionGroupEntryFrameV1, right: DeclarativeV2FunctionGroupEntryFrameV1) {
  return left.functionOrdinal === right.functionOrdinal && left.functionPath === right.functionPath && left.executionModule === right.executionModule && left.exportName === right.exportName && left.handlerKind === right.handlerKind && left.visibility === right.visibility && left.group === right.group && bytesEqualFullScan(left.projectionSha256, right.projectionSha256);
}
function nullableDigestEqual(left: Uint8Array | null, right: Uint8Array | null) {
  return left === null || right === null ? left === right : bytesEqualFullScan(left, right);
}
function exceeded(
  dimension: NonNullable<DeclarativeV2ColdMaterializationProbeV1Error["dimension"]>,
  observed: number,
  maximum: number,
): Effect.Effect<never, DeclarativeV2ColdMaterializationProbeV1Error> {
  return Effect.fail(new DeclarativeV2ColdMaterializationProbeV1Error({ reason: "resourceExceeded", dimension, observed, maximum }));
}
function probeFailure(
  reason: DeclarativeV2ColdMaterializationProbeV1Error["reason"],
  path: string,
): Effect.Effect<never, DeclarativeV2ColdMaterializationProbeV1Error> {
  return Effect.fail(new DeclarativeV2ColdMaterializationProbeV1Error({ reason, path }));
}
