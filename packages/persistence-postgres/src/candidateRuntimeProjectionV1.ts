import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2EncodedFrameV1,
  type DeclarativeV2FunctionGroupEntryFrameV1,
  type DeclarativeV2FunctionGroupManifestFrameV1,
  type DeclarativeV2RuntimeExecutionGroupV1,
  type DeclarativeV2RuntimeProjectionFrameV1,
  type DeclarativeV2RuntimeProjectionModuleFrameV1,
  type DeclarativeV2RuntimeProjectionSetFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  frameDeclarativeV2RuntimeRootSha256PreimageV1,
  makeDeclarativeV2RuntimeArtifactObjectReferenceV1,
  type DeclarativeV2RuntimeArtifactObjectKindV1,
  type DeclarativeV2RuntimeArtifactObjectReferenceV1,
  type DeclarativeV2RuntimeProjectionIdentityV1Error,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";

import type {
  SystemFunctionIdentityV1,
} from "./applicationRevisionRegistrationIdentitiesV1";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";

const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 64 * 1_048_576,
  maximumCanonicalBytes: 64 * 1_048_576,
});
const ROOT_BUDGET = Object.freeze({
  maximumDigests: 32_768,
  maximumPreimageBytes: 2 * 1_048_576,
});
const HASH_BUDGET = Object.freeze({
  maximumInputBytes: 64 * 1_048_576,
});
const PUBLICATION_CONCURRENCY = 8;
const PUBLICATION_BUDGET = Object.freeze({
  maximumObjects: 128,
  maximumCanonicalBytes: 64 * 1_048_576,
  maximumModulesPerGroup: 32,
  maximumFunctionEntries: 60,
});

export class CandidateRuntimeProjectionV1Error extends Data.TaggedError(
  "CandidateRuntimeProjectionV1Error",
)<{
  readonly reason:
    | "missingExecutionModule"
    | "missingFunctionModule"
    | "invalidFunctionPath"
    | "emptyProjection"
    | "budgetExceeded";
  readonly path?: string;
}> {}

export type PrepareCandidateRuntimePublicationV1Error =
  | CandidateRuntimeProjectionV1Error
  | DeclarativeV2RuntimeProjectionIdentityV1Error
  | DeclarativeV2Sha256V1Error;

export interface CandidateRuntimeProjectionArtifactV1 {
  readonly group: DeclarativeV2RuntimeExecutionGroupV1;
  readonly moduleFrames:
    ReadonlyArray<DeclarativeV2RuntimeProjectionModuleFrameV1>;
  readonly moduleFrameBytes: ReadonlyArray<Uint8Array>;
  readonly moduleFrameSha256: ReadonlyArray<Uint8Array>;
  readonly projectionFrame: DeclarativeV2RuntimeProjectionFrameV1;
  readonly projectionFrameBytes: Uint8Array;
  readonly projectionSha256: Uint8Array;
}

export interface CandidateRuntimePublicationV1 {
  readonly projections: ReadonlyArray<CandidateRuntimeProjectionArtifactV1>;
  readonly projectionSetFrame: DeclarativeV2RuntimeProjectionSetFrameV1;
  readonly projectionSetFrameBytes: Uint8Array;
  readonly runtimeProjectionSetSha256: Uint8Array;
  readonly functionEntries:
    ReadonlyArray<DeclarativeV2FunctionGroupEntryFrameV1>;
  readonly functionEntryBytes: ReadonlyArray<Uint8Array>;
  readonly functionEntrySha256: ReadonlyArray<Uint8Array>;
  readonly manifestFrame: DeclarativeV2FunctionGroupManifestFrameV1;
  readonly manifestFrameBytes: Uint8Array;
  readonly functionGroupManifestSha256: Uint8Array;
}

export class CandidateRuntimeArtifactPublicationV1Error extends Data.TaggedError(
  "CandidateRuntimeArtifactPublicationV1Error",
)<{
  readonly operation: "preflight" | "putImmutable";
  readonly reason:
    | "invalidInput"
    | "budgetExceeded"
    | "resource"
    | "corruption"
    | "settlementUncertain";
  readonly kind?: DeclarativeV2RuntimeArtifactObjectKindV1;
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export interface CandidateRuntimeArtifactPublisherV1 {
  readonly putImmutable: (
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digest: Uint8Array,
    canonicalBytes: Uint8Array,
  ) => Effect.Effect<
    DeclarativeV2RuntimeArtifactObjectReferenceV1,
    CandidateRuntimeArtifactPublicationV1Error
  >;
}

export interface CandidateRuntimePublishedProjectionV1 {
  readonly group: DeclarativeV2RuntimeExecutionGroupV1;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly modules: ReadonlyArray<
    Readonly<{
      readonly frame: DeclarativeV2RuntimeProjectionModuleFrameV1;
      readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    }>
  >;
}

export interface CandidateRuntimePublishedAuthorityV1 {
  readonly projectionSetReference:
    DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly manifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly projections: ReadonlyArray<CandidateRuntimePublishedProjectionV1>;
  readonly functionEntries: ReadonlyArray<
    Readonly<{
      readonly frame: DeclarativeV2FunctionGroupEntryFrameV1;
      readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    }>
  >;
}

export interface CandidateRuntimeStoredModuleAuthorityV1 {
  readonly group: DeclarativeV2RuntimeExecutionGroupV1;
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly roles: bigint;
  readonly sourceByteLength: bigint;
  readonly sourceSha256: Uint8Array;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface CandidateRuntimeStoredProjectionAuthorityV1 {
  readonly frame: DeclarativeV2RuntimeProjectionFrameV1;
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly modules: ReadonlyArray<CandidateRuntimeStoredModuleAuthorityV1>;
}

export interface CandidateRuntimeStoredAuthorityV1 {
  readonly projectionSetReference:
    DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly manifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly manifestFrame: DeclarativeV2FunctionGroupManifestFrameV1;
  readonly projections:
    ReadonlyArray<CandidateRuntimeStoredProjectionAuthorityV1>;
  readonly functionEntries: ReadonlyArray<
    Readonly<{
      readonly frame: DeclarativeV2FunctionGroupEntryFrameV1;
      readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    }>
  >;
}

export type PublishCandidateRuntimeArtifactsV1Error =
  | CandidateRuntimeArtifactPublicationV1Error
  | DeclarativeV2RuntimeProjectionIdentityV1Error;

/**
 * Publishes canonical bodies to the injected content-addressed object owner.
 * The returned value intentionally contains only immutable references and
 * normalized authority suitable for PostgreSQL persistence.
 */
export const publishCandidateRuntimeArtifactsV1 = Effect.fn(
  "CandidateRuntimeProjection.publishArtifactsV1",
)(function* (
  publication: CandidateRuntimePublicationV1,
  publisher: CandidateRuntimeArtifactPublisherV1,
): Effect.fn.Return<
  CandidateRuntimePublishedAuthorityV1,
  PublishCandidateRuntimeArtifactsV1Error
> {
  yield* validatePublicationBudget(publication);
  const [projectionSetReference, manifestReference] = yield* Effect.all([
    publishOne(
      publisher,
      "runtime-projection-set",
      publication.runtimeProjectionSetSha256,
      publication.projectionSetFrameBytes,
    ),
    publishOne(
      publisher,
      "function-group-manifest",
      publication.functionGroupManifestSha256,
      publication.manifestFrameBytes,
    ),
  ], { concurrency: 2 });
  const projections: CandidateRuntimePublishedProjectionV1[] = [];
  for (const projection of publication.projections) {
    const reference = yield* publishOne(
      publisher,
      "runtime-projection",
      projection.projectionSha256,
      projection.projectionFrameBytes,
    );
    const modules = yield* Effect.all(
      projection.moduleFrames.map((frame, ordinal) =>
        publishOne(
          publisher,
          "runtime-projection-module",
          projection.moduleFrameSha256[ordinal]!,
          projection.moduleFrameBytes[ordinal]!,
        ).pipe(Effect.map((moduleReference) =>
          Object.freeze({ frame, reference: moduleReference })
        ))
      ),
      { concurrency: PUBLICATION_CONCURRENCY },
    );
    projections.push(Object.freeze({
      group: projection.group,
      reference,
      modules: Object.freeze(modules),
    }));
  }
  const functionEntries = yield* Effect.all(
    publication.functionEntries.map((frame, ordinal) =>
      publishOne(
        publisher,
        "function-group-entry",
        publication.functionEntrySha256[ordinal]!,
        publication.functionEntryBytes[ordinal]!,
      ).pipe(Effect.map(reference => Object.freeze({ frame, reference })))
    ),
    { concurrency: PUBLICATION_CONCURRENCY },
  );
  return Object.freeze({
    projectionSetReference,
    manifestReference,
    projections: Object.freeze(projections),
    functionEntries: Object.freeze(functionEntries),
  });
});

function validatePublicationBudget(
  publication: CandidateRuntimePublicationV1,
): Effect.Effect<void, CandidateRuntimeArtifactPublicationV1Error> {
  let objectCount = 2;
  let canonicalBytes =
    publication.projectionSetFrameBytes.byteLength +
    publication.manifestFrameBytes.byteLength;
  if (
    publication.projections.length > 2 ||
    publication.functionEntries.length !== publication.functionEntryBytes.length ||
    publication.functionEntries.length !== publication.functionEntrySha256.length
  ) return publicationPreflightFailure("shape");
  if (publication.functionEntries.length > PUBLICATION_BUDGET.maximumFunctionEntries) {
    return publicationPreflightExceeded(
      "functionEntries",
      publication.functionEntries.length,
      PUBLICATION_BUDGET.maximumFunctionEntries,
    );
  }
  objectCount += publication.functionEntries.length;
  for (const bytes of publication.functionEntryBytes) {
    canonicalBytes += bytes.byteLength;
  }
  for (const projection of publication.projections) {
    if (
      projection.moduleFrames.length !== projection.moduleFrameBytes.length ||
      projection.moduleFrames.length !== projection.moduleFrameSha256.length
    ) return publicationPreflightFailure(`projections.${projection.group}.shape`);
    if (projection.moduleFrames.length > PUBLICATION_BUDGET.maximumModulesPerGroup) {
      return publicationPreflightExceeded(
        `projections.${projection.group}.modules`,
        projection.moduleFrames.length,
        PUBLICATION_BUDGET.maximumModulesPerGroup,
      );
    }
    objectCount += 1 + projection.moduleFrames.length;
    canonicalBytes += projection.projectionFrameBytes.byteLength;
    for (const bytes of projection.moduleFrameBytes) {
      canonicalBytes += bytes.byteLength;
    }
  }
  if (objectCount > PUBLICATION_BUDGET.maximumObjects) {
    return publicationPreflightExceeded(
      "objects",
      objectCount,
      PUBLICATION_BUDGET.maximumObjects,
    );
  }
  if (
    !Number.isSafeInteger(canonicalBytes) ||
    canonicalBytes > PUBLICATION_BUDGET.maximumCanonicalBytes
  ) {
    return publicationPreflightExceeded(
      "canonicalBytes",
      canonicalBytes,
      PUBLICATION_BUDGET.maximumCanonicalBytes,
    );
  }
  return Effect.void;
}

function publicationPreflightFailure(
  path: string,
): Effect.Effect<never, CandidateRuntimeArtifactPublicationV1Error> {
  return Effect.fail(new CandidateRuntimeArtifactPublicationV1Error({
    operation: "preflight",
    reason: "invalidInput",
    path,
  }));
}

function publicationPreflightExceeded(
  path: string,
  observed: number,
  maximum: number,
): Effect.Effect<never, CandidateRuntimeArtifactPublicationV1Error> {
  return Effect.fail(new CandidateRuntimeArtifactPublicationV1Error({
    operation: "preflight",
    reason: "budgetExceeded",
    path,
    observed,
    maximum,
  }));
}

function publishOne(
  publisher: CandidateRuntimeArtifactPublisherV1,
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: Uint8Array,
  canonicalBytes: Uint8Array,
): Effect.Effect<
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
  PublishCandidateRuntimeArtifactsV1Error
> {
  return Effect.gen(function* () {
    const expected = yield* Effect.fromResult(
      makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
        kind,
        digest,
        canonicalBytes.byteLength,
      ),
    );
    const actual = yield* publisher.putImmutable(
      kind,
      digest,
      canonicalBytes,
    );
    if (
      actual.storeIdentity !== expected.storeIdentity ||
      actual.kind !== expected.kind ||
      actual.codecIdentity !== expected.codecIdentity ||
      actual.objectKey !== expected.objectKey ||
      actual.byteLength !== expected.byteLength ||
      !bytesEqualFullScan(actual.sha256, expected.sha256)
    ) {
      return yield* new CandidateRuntimeArtifactPublicationV1Error({
        operation: "putImmutable",
        reason: "corruption",
        kind,
        path: "reference",
      });
    }
    return Object.freeze({
      ...actual,
      sha256: new Uint8Array(actual.sha256),
    });
  });
}

export const prepareCandidateRuntimePublicationV1 = Effect.fn(
  "CandidateRuntimeProjection.preparePublicationV1",
)(function* (
  prepared: PreparedStandardApplicationDefinitionV1,
  functionIdentity: SystemFunctionIdentityV1,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): Effect.fn.Return<
  CandidateRuntimePublicationV1,
  PrepareCandidateRuntimePublicationV1Error
> {
  const sourceModules = new Map<
    string,
    PreparedStandardApplicationDefinitionV1["artifactIngressPlan"]["source"]["modules"][number]
  >(
    prepared.artifactIngressPlan.source.modules.map((module) => [
      module.path,
      module,
    ]),
  );
  const executionModule =
    prepared.artifactIngressPlan.source.executionPath;
  const runtimeModulePaths = prepared.artifactIngressPlan.source.modules
    .filter(module =>
      (module.roles & (
        SOURCE_ARTIFACT_V2_ROLE_FUNCTION |
        SOURCE_ARTIFACT_V2_ROLE_EXECUTION
      )) !== 0
    )
    .map(module => module.path);
  const artifactModuleByLogicalModule = new Map<string, string>(
    prepared.artifactIngressPlan.source.functionEntries.map(binding => [
      binding.logicalModulePath,
      binding.artifactModulePath,
    ]),
  );
  if (!sourceModules.has(executionModule)) {
    return yield* new CandidateRuntimeProjectionV1Error({
      reason: "missingExecutionModule",
      path: executionModule,
    });
  }
  const groupFunctions = new Map<
    DeclarativeV2RuntimeExecutionGroupV1,
    typeof functionIdentity.metadata.functions
  >();
  for (const item of functionIdentity.metadata.functions) {
    const group = groupFor(item.metadata.kind);
    const current = groupFunctions.get(group) ?? [];
    groupFunctions.set(group, Object.freeze([...current, item]));
  }

  const projections: CandidateRuntimeProjectionArtifactV1[] = [];
  for (
    const group of ["transaction", "edge_action"] as const
  ) {
    const functions = groupFunctions.get(group);
    if (functions === undefined || functions.length === 0) continue;
    // The ingress contract does not publish a transitive import graph. Include
    // every runtime-role module so a projection can never omit a shared chunk.
    const modulePaths = new Set<string>(runtimeModulePaths);
    modulePaths.add(executionModule);
    for (const item of functions) {
      const artifactModule =
        artifactModuleByLogicalModule.get(item.metadata.executionModule);
      if (
        artifactModule === undefined ||
        !sourceModules.has(artifactModule)
      ) {
        return yield* new CandidateRuntimeProjectionV1Error({
          reason: "missingFunctionModule",
          path: item.metadata.executionModule,
        });
      }
      modulePaths.add(artifactModule);
    }
    const orderedPaths = [...modulePaths].toSorted(compareUtf16Strings);
    if (orderedPaths.length === 0) {
      return yield* new CandidateRuntimeProjectionV1Error({
        reason: "emptyProjection",
        path: group,
      });
    }
    const moduleFrames: DeclarativeV2RuntimeProjectionModuleFrameV1[] = [];
    const moduleFrameBytes: Uint8Array[] = [];
    const moduleFrameSha256: Uint8Array[] = [];
    let rawByteLength = 0n;
    for (let ordinal = 0; ordinal < orderedPaths.length; ordinal += 1) {
      const path = orderedPaths[ordinal]!;
      const module = sourceModules.get(path)!;
      rawByteLength += BigInt(module.sourceBytes.byteLength);
      const frame = Object.freeze({
        kind: "runtime_projection_module",
        group,
        moduleOrdinal: BigInt(ordinal),
        modulePath: path,
        roles: BigInt(module.roles),
        sourceSha256: yield* sha256(module.sourceBytes, HASH_BUDGET),
        sourceBytes: new Uint8Array(module.sourceBytes),
      } satisfies DeclarativeV2RuntimeProjectionModuleFrameV1);
      const encoded = yield* encode(frame);
      moduleFrames.push(frame);
      moduleFrameBytes.push(encoded.bytes);
      moduleFrameSha256.push(yield* sha256(encoded.bytes, HASH_BUDGET));
    }
    const moduleRootPreimage = yield* Effect.fromResult(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "runtimeProjectionModules",
        group,
        moduleFrameSha256,
        ROOT_BUDGET,
      ),
    );
    const projectionFrame = Object.freeze({
      kind: "runtime_projection",
      group,
      executionModule,
      moduleCount: BigInt(moduleFrames.length),
      rawByteLength,
      moduleRootSha256:
        yield* sha256(moduleRootPreimage, HASH_BUDGET),
    } satisfies DeclarativeV2RuntimeProjectionFrameV1);
    const projectionEncoded = yield* encode(projectionFrame);
    projections.push(Object.freeze({
      group,
      moduleFrames: Object.freeze(moduleFrames),
      moduleFrameBytes: Object.freeze(moduleFrameBytes),
      moduleFrameSha256: Object.freeze(moduleFrameSha256),
      projectionFrame,
      projectionFrameBytes: projectionEncoded.bytes,
      projectionSha256:
        yield* sha256(projectionEncoded.bytes, HASH_BUDGET),
    }));
  }

  const projectionByGroup = new Map(
    projections.map((projection) => [projection.group, projection]),
  );
  const projectionSetFrame = Object.freeze({
    kind: "runtime_projection_set",
    groupCount: BigInt(projections.length),
    transactionProjectionSha256:
      projectionByGroup.get("transaction")?.projectionSha256 ?? null,
    edgeActionProjectionSha256:
      projectionByGroup.get("edge_action")?.projectionSha256 ?? null,
  } satisfies DeclarativeV2RuntimeProjectionSetFrameV1);
  const projectionSetEncoded = yield* encode(projectionSetFrame);
  const runtimeProjectionSetSha256 = yield* sha256(
    projectionSetEncoded.bytes,
    HASH_BUDGET,
  );

  const functionEntries: DeclarativeV2FunctionGroupEntryFrameV1[] = [];
  const functionEntryBytes: Uint8Array[] = [];
  const functionEntrySha256: Uint8Array[] = [];
  for (
    let ordinal = 0;
    ordinal < functionIdentity.metadata.functions.length;
    ordinal += 1
  ) {
    const item = functionIdentity.metadata.functions[ordinal]!;
    const exportSeparator = item.metadata.functionPath.lastIndexOf(":");
    if (exportSeparator <= 0) {
      return yield* new CandidateRuntimeProjectionV1Error({
        reason: "invalidFunctionPath",
        path: item.metadata.functionPath,
      });
    }
    const group = groupFor(item.metadata.kind);
    const projection = projectionByGroup.get(group);
    if (projection === undefined) {
      return yield* new CandidateRuntimeProjectionV1Error({
        reason: "emptyProjection",
        path: group,
      });
    }
    const frame = Object.freeze({
      kind: "function_group_entry",
      functionOrdinal: BigInt(ordinal),
      functionPath: item.metadata.functionPath,
      executionModule:
        artifactModuleByLogicalModule.get(item.metadata.executionModule)!,
      exportName: item.metadata.functionPath.slice(exportSeparator + 1),
      handlerKind: item.metadata.kind,
      visibility: item.metadata.visibility,
      group,
      projectionSha256: new Uint8Array(projection.projectionSha256),
    } satisfies DeclarativeV2FunctionGroupEntryFrameV1);
    const encoded = yield* encode(frame);
    functionEntries.push(frame);
    functionEntryBytes.push(encoded.bytes);
    functionEntrySha256.push(yield* sha256(encoded.bytes, HASH_BUDGET));
  }
  const functionRootPreimage = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "functionGroupEntries",
      null,
      functionEntrySha256,
      ROOT_BUDGET,
    ),
  );
  const manifestFrame = Object.freeze({
    kind: "function_group_manifest",
    runtimeProjectionSetSha256:
      new Uint8Array(runtimeProjectionSetSha256),
    functionCount: BigInt(functionEntries.length),
    functionRootSha256:
      yield* sha256(functionRootPreimage, HASH_BUDGET),
    validatorRootSha256:
      new Uint8Array(functionIdentity.validatorRootSha256),
    declaredHandlerSetSha256:
      new Uint8Array(functionIdentity.declaredHandlerSetSha256),
  } satisfies DeclarativeV2FunctionGroupManifestFrameV1);
  const manifestEncoded = yield* encode(manifestFrame);
  return Object.freeze({
    projections: Object.freeze(projections),
    projectionSetFrame,
    projectionSetFrameBytes: projectionSetEncoded.bytes,
    runtimeProjectionSetSha256:
      new Uint8Array(runtimeProjectionSetSha256),
    functionEntries: Object.freeze(functionEntries),
    functionEntryBytes: Object.freeze(functionEntryBytes),
    functionEntrySha256: Object.freeze(functionEntrySha256),
    manifestFrame,
    manifestFrameBytes: manifestEncoded.bytes,
    functionGroupManifestSha256:
      yield* sha256(manifestEncoded.bytes, HASH_BUDGET),
  });
});

function groupFor(
  kind: "query" | "mutation" | "workflowMutation" | "action",
): DeclarativeV2RuntimeExecutionGroupV1 {
  return kind === "action" ? "edge_action" : "transaction";
}

function encode(
  frame:
    | DeclarativeV2RuntimeProjectionModuleFrameV1
    | DeclarativeV2RuntimeProjectionFrameV1
    | DeclarativeV2RuntimeProjectionSetFrameV1
    | DeclarativeV2FunctionGroupEntryFrameV1
    | DeclarativeV2FunctionGroupManifestFrameV1,
): Effect.Effect<
  Readonly<{ readonly bytes: Uint8Array }>,
  never
> {
  return Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET).pipe(
      Result.map((encoded: DeclarativeV2EncodedFrameV1) =>
        Object.freeze({ bytes: new Uint8Array(encoded.canonicalBytes) })
      ),
    ),
  ).pipe(Effect.orDie);
}
