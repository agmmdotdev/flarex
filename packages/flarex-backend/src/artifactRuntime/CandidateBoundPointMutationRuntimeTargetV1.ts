import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Effect, Result, Scope } from "effect";
import {
  encodeCandidateBoundRuntimeTargetV1,
  type CandidateBoundRuntimeTargetFrameV1,
  type CandidateBoundRuntimeTargetV1Error,
} from "flarex-protocol/internal/candidate-bound-runtime-target-v1";
import {
  decodeDeclarativeV2ArtifactModulePathV1,
  type DeclarativeV2ArtifactModulePathVerdictV1Error,
} from "flarex-protocol/internal/declarative-v2-artifact-module-path-v1";
import {
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
  type DeclarativeV2FunctionGroupEntryFrameV1,
  type DeclarativeV2PhysicalFrameV1,
  type DeclarativeV2PhysicalFrameV1Error,
  type DeclarativeV2RuntimeProjectionFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  frameDeclarativeV2RuntimeRootSha256PreimageV1,
  type DeclarativeV2RuntimeArtifactObjectReferenceV1,
  type DeclarativeV2RuntimeProjectionIdentityV1Error,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";
import {
  POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
  POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
  type PointMutationExactRuntimeArtifactRefV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  TransactionArtifactIdV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import type { ValidatorJson } from "flarex-protocol/validator-json";

import {
  buildPointMutationExactRuntimeWorkerDefinitionV1,
  PointMutationExactRuntimeHostV1Error,
  pointMutationExactRuntimeWorkerGraphBasisV1,
  type PointMutationExactRuntimeWorkerDefinitionV1,
} from "./PointMutationExactRuntimeHost";
import type {
  DeclarativeV2RuntimeArtifactR2AdmissionV1,
  DeclarativeV2RuntimeArtifactR2StoreV1,
  DeclarativeV2RuntimeArtifactR2V1Error,
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
const ROOT_BUDGET = Object.freeze({
  maximumDigests: 32_768,
  maximumPreimageBytes: 2 * 1_048_576,
});
const TARGET_BUDGET = Object.freeze({
  maximumModules: 32_768,
  maximumTextBytes: 4_096,
  maximumPreimageBytes: 16 * 1_048_576,
});
const EXACT_RUNTIME_EXECUTION_MODULE =
  "flarexCandidateBoundRuntimeTarget/execution-v1.js";
const UTF8 = new TextEncoder();

export interface CandidateBoundRuntimeTargetActiveMetadataV1 {
  readonly scopeId: string;
  readonly applicationRevisionId: string;
  readonly activationRevision: bigint;
  readonly candidateSha256: Uint8Array;
  readonly readinessReceiptSha256: Uint8Array;
  readonly activationHeadSha256: Uint8Array;
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
}

export interface CandidateBoundRuntimeTargetScopeAuthorityV1 {
  readonly scopeId: string;
  readonly storageGeneration: "flarexdb_v1";
  readonly storageGenerationFence: bigint;
  readonly epoch: string;
}

export interface CandidateBoundRuntimeTargetFunctionAuthorityV1 {
  readonly functionOrdinal: bigint;
  readonly functionPath: string;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly handlerKind: "mutation";
  readonly visibility: "public" | "internal";
  readonly argsValidator: ValidatorJson;
  readonly returnsValidator: ValidatorJson | null;
  readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
    readonly handlerKind: "mutation";
    readonly group: "transaction";
  };
  readonly entryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly projection: DeclarativeV2RuntimeProjectionFrameV1 & {
    readonly group: "transaction";
  };
}

export interface CandidateBoundRuntimeTargetAuthorityV1 {
  readonly metadata: CandidateBoundRuntimeTargetActiveMetadataV1;
  readonly scopeAuthority: CandidateBoundRuntimeTargetScopeAuthorityV1;
  readonly attemptSha256: Uint8Array;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly candidateFrameBytes: Uint8Array;
  readonly functionMetadataSha256: Uint8Array;
  readonly publication: Readonly<{
    readonly projectionSetReference:
      DeclarativeV2RuntimeArtifactObjectReferenceV1;
    readonly manifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    readonly manifestFrame: Readonly<{
      readonly kind: "function_group_manifest";
      readonly runtimeProjectionSetSha256: Uint8Array;
      readonly functionCount: bigint;
      readonly functionRootSha256: Uint8Array;
      readonly validatorRootSha256: Uint8Array;
      readonly declaredHandlerSetSha256: Uint8Array;
    }>;
    readonly projections: ReadonlyArray<Readonly<{
      readonly frame: DeclarativeV2RuntimeProjectionFrameV1;
      readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
      readonly modules: ReadonlyArray<Readonly<{
        readonly group: "transaction" | "edge_action";
        readonly moduleOrdinal: bigint;
        readonly modulePath: string;
        readonly roles: bigint;
        readonly sourceByteLength: bigint;
        readonly sourceSha256: Uint8Array;
        readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
      }>>;
    }>>;
    readonly functionEntries: ReadonlyArray<Readonly<{
      readonly frame: DeclarativeV2FunctionGroupEntryFrameV1;
      readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    }>>;
  }>;
  readonly function: CandidateBoundRuntimeTargetFunctionAuthorityV1;
}

export interface CandidateBoundRuntimeTargetAuthorityPortV1<Selection, E> {
  readonly claim: (
    selection: Selection,
    functionPath: string,
  ) => Effect.Effect<CandidateBoundRuntimeTargetAuthorityV1, E>;
}

export interface CandidateBoundRuntimeTargetBudgetV1 {
  readonly maximumModules: number;
  readonly maximumObjects: number;
  readonly maximumObjectBytes: number;
  readonly maximumRawBytes: number;
  readonly maximumHashBytes: number;
}

declare const candidateBoundRuntimeTargetBrand: unique symbol;
export interface CandidateBoundPointMutationRuntimeTargetV1 {
  readonly [candidateBoundRuntimeTargetBrand]: true;
}

export interface PreparedCandidateBoundPointMutationRuntimeTargetV1 {
  readonly target: CandidateBoundPointMutationRuntimeTargetV1;
  readonly runtimeTargetSha256: Uint8Array;
  readonly artifact: PointMutationExactRuntimeArtifactRefV1;
  readonly function: Readonly<{
    readonly path: string;
    readonly executionModule: string;
    readonly kind: "mutation";
    readonly visibility: "public";
    readonly argsValidator: ValidatorJson;
    readonly returnsValidator: ValidatorJson | null;
  }>;
}

export interface ClaimedCandidateBoundPointMutationRuntimeTargetV1
  extends PreparedCandidateBoundPointMutationRuntimeTargetV1 {
  readonly canonicalTargetBytes: Uint8Array;
  readonly definition: PointMutationExactRuntimeWorkerDefinitionV1;
}

export class CandidateBoundRuntimeDispatchV1Error extends Data.TaggedError(
  "CandidateBoundRuntimeDispatchV1Error",
)<{
  readonly reason:
    | "invalidBudget"
    | "authorityMismatch"
    | "functionMismatch"
    | "projectionMismatch"
    | "invalidSourceUtf8"
    | "resourceExceeded";
  readonly path: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class InvalidCandidateBoundPointMutationRuntimeTargetV1Error
  extends Data.TaggedError(
    "InvalidCandidateBoundPointMutationRuntimeTargetV1Error",
  )<{ readonly reason: "notIssued" }> {}

export type PrepareCandidateBoundPointMutationRuntimeTargetV1Error<E> =
  | E
  | CandidateBoundRuntimeDispatchV1Error
  | CandidateBoundRuntimeTargetV1Error
  | DeclarativeV2ArtifactModulePathVerdictV1Error
  | DeclarativeV2PhysicalFrameV1Error
  | DeclarativeV2RuntimeProjectionIdentityV1Error
  | DeclarativeV2RuntimeArtifactR2V1Error
  | DeclarativeV2RuntimeArtifactSha256V1Error
  | PointMutationExactRuntimeHostV1Error;

interface CandidateBoundRuntimeTargetStateV1 {
  readonly runtimeTargetSha256: Uint8Array;
  readonly canonicalTargetBytes: Uint8Array;
  readonly artifact: PointMutationExactRuntimeArtifactRefV1;
  readonly function: PreparedCandidateBoundPointMutationRuntimeTargetV1["function"];
  readonly definition: PointMutationExactRuntimeWorkerDefinitionV1;
}

const targetStates = new WeakMap<
  CandidateBoundPointMutationRuntimeTargetV1,
  CandidateBoundRuntimeTargetStateV1
>();

export const prepareCandidateBoundPointMutationRuntimeTargetV1 = Effect.fn(
  "CandidateBoundRuntimeDispatch.prepareV1",
)(function* <Selection, E>(
  selection: Selection,
  functionPath: string,
  authorityPort: CandidateBoundRuntimeTargetAuthorityPortV1<Selection, E>,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  budgetInput: unknown,
  compatibilityDate: string,
  sha256: DeclarativeV2RuntimeArtifactSha256V1 =
    makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
): Effect.fn.Return<
  PreparedCandidateBoundPointMutationRuntimeTargetV1,
  PrepareCandidateBoundPointMutationRuntimeTargetV1Error<E>,
  Scope.Scope
> {
  const budget = yield* captureBudget(budgetInput);
  const authority = yield* authorityPort.claim(selection, functionPath);
  yield* verifyAuthority(authority, functionPath, sha256, budget);
  const loaded = yield* loadSelectedProjection(authority, store, sha256, budget);
  const executionBridgeSource = registrySource(authority.function);
  const exactRuntimeGraphBasis = yield* Effect.try({
    try: () => pointMutationExactRuntimeWorkerGraphBasisV1({
      compatibilityDate,
      executionModule: EXACT_RUNTIME_EXECUTION_MODULE,
      executionBridgeSource,
    }),
    catch: cause => new PointMutationExactRuntimeHostV1Error({
      issue: { reason: "workerDefinitionFailed", cause },
    }),
  });
  const exactRuntimeGraphBasisSha256 = yield* sha256(
    UTF8.encode(exactRuntimeGraphBasis),
    { maximumInputBytes: budget.maximumHashBytes },
  );
  const frame = targetFrame(
    authority,
    compatibilityDate,
    exactRuntimeGraphBasisSha256,
  );
  const encoded = yield* Effect.fromResult(
    encodeCandidateBoundRuntimeTargetV1(frame, TARGET_BUDGET),
  );
  const runtimeTargetSha256 = yield* sha256(
    encoded.canonicalBytes,
    { maximumInputBytes: budget.maximumHashBytes },
  );
  const runtimeTargetHex = encodeBytesToLowercaseHex(runtimeTargetSha256);
  const artifact = Object.freeze({
    runtime: "dynamic-worker" as const,
    artifactId: TransactionArtifactIdV1Schema.make(
      `artifact_${runtimeTargetHex.slice(0, 32)}`,
    ),
    sourcePackageHash:
      TransactionSourcePackageSha256HexV1Schema.make(runtimeTargetHex),
    executionModule:
      TransactionExecutionModuleV1Schema.make(EXACT_RUNTIME_EXECUTION_MODULE),
  });
  const functionProjection = Object.freeze({
    path: authority.function.functionPath,
    executionModule: EXACT_RUNTIME_EXECUTION_MODULE,
    kind: "mutation" as const,
    visibility: "public" as const,
    argsValidator: authority.function.argsValidator,
    returnsValidator: authority.function.returnsValidator,
  });
  const definition = yield* Effect.try({
    try: () => buildPointMutationExactRuntimeWorkerDefinitionV1({
      artifact,
      compatibilityDate,
      sourceModules: loaded.modules,
      executionBridgeSource,
    }),
    catch: cause => new PointMutationExactRuntimeHostV1Error({
      issue: { reason: "workerDefinitionFailed", cause },
    }),
  });
  const state = Object.freeze({
    runtimeTargetSha256: copyBytes(runtimeTargetSha256),
    canonicalTargetBytes: copyBytes(encoded.canonicalBytes),
    artifact,
    function: functionProjection,
    definition,
  });
  const target = yield* Effect.acquireRelease(
    Effect.sync(() => issueTarget(state)),
    issued => Effect.sync(() => targetStates.delete(issued)),
  );
  return preparedResult(target, state);
});

export function claimCandidateBoundPointMutationRuntimeTargetV1(
  target: unknown,
): Result.Result<
  ClaimedCandidateBoundPointMutationRuntimeTargetV1,
  InvalidCandidateBoundPointMutationRuntimeTargetV1Error
> {
  if (typeof target !== "object" || target === null) {
    return Result.fail(new InvalidCandidateBoundPointMutationRuntimeTargetV1Error({
      reason: "notIssued",
    }));
  }
  const state = targetStates.get(
    target as CandidateBoundPointMutationRuntimeTargetV1,
  );
  return state === undefined
    ? Result.fail(new InvalidCandidateBoundPointMutationRuntimeTargetV1Error({
        reason: "notIssued",
      }))
    : Result.succeed(Object.freeze({
        ...preparedResult(
          target as CandidateBoundPointMutationRuntimeTargetV1,
          state,
        ),
        canonicalTargetBytes: copyBytes(state.canonicalTargetBytes),
        definition: state.definition,
      }));
}

function issueTarget(
  state: CandidateBoundRuntimeTargetStateV1,
): CandidateBoundPointMutationRuntimeTargetV1 {
  const target = Object.freeze({}) as CandidateBoundPointMutationRuntimeTargetV1;
  targetStates.set(target, state);
  return target;
}

function preparedResult(
  target: CandidateBoundPointMutationRuntimeTargetV1,
  state: CandidateBoundRuntimeTargetStateV1,
): PreparedCandidateBoundPointMutationRuntimeTargetV1 {
  return Object.freeze({
    target,
    runtimeTargetSha256: copyBytes(state.runtimeTargetSha256),
    artifact: Object.freeze({ ...state.artifact }),
    function: state.function,
  });
}

const verifyAuthority = Effect.fn(
  "CandidateBoundRuntimeDispatch.verifyAuthority",
)(function* (
  authority: CandidateBoundRuntimeTargetAuthorityV1,
  requestedFunctionPath: string,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
  budget: CandidateBoundRuntimeTargetBudgetV1,
) {
  const encodedCandidate = yield* Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(authority.candidate, FRAME_BUDGET),
  );
  const candidateSha256 = yield* sha256(
    encodedCandidate.canonicalBytes,
    { maximumInputBytes: budget.maximumHashBytes },
  );
  const metadata = authority.metadata;
  const candidate = authority.candidate;
  if (
    !bytesEqualFullScan(encodedCandidate.canonicalBytes, authority.candidateFrameBytes) ||
    !bytesEqualFullScan(candidateSha256, authority.candidateSha256) ||
    authority.function.functionPath !== requestedFunctionPath ||
    metadata.scopeId !== authority.scopeAuthority.scopeId ||
    candidate.scopeId !== authority.scopeAuthority.scopeId ||
    candidate.storageGeneration !== authority.scopeAuthority.storageGeneration ||
    candidate.storageGenerationFence !== authority.scopeAuthority.storageGenerationFence ||
    candidate.scopeEpoch !== authority.scopeAuthority.epoch ||
    !bytesEqualFullScan(metadata.candidateSha256, authority.candidateSha256) ||
    !bytesEqualFullScan(metadata.packageSha256, candidate.packageSha256) ||
    !bytesEqualFullScan(metadata.artifactSha256, candidate.artifactSha256) ||
    !bytesEqualFullScan(metadata.sourceRootSha256, candidate.sourceRootSha256) ||
    !bytesEqualFullScan(metadata.semanticRootSha256, candidate.semanticRootSha256) ||
    !bytesEqualFullScan(metadata.schemaArtifactSha256, candidate.schemaArtifactSha256) ||
    !bytesEqualFullScan(metadata.schemaBindingSha256, candidate.schemaBindingSha256) ||
    !bytesEqualFullScan(metadata.validatorRootSha256, candidate.validatorRootSha256) ||
    !bytesEqualFullScan(metadata.declaredHandlerSetSha256, candidate.declaredHandlerSetSha256) ||
    !bytesEqualFullScan(metadata.runtimeProjectionSetSha256, candidate.runtimeProjectionSetSha256) ||
    !bytesEqualFullScan(metadata.functionGroupManifestSha256, candidate.functionGroupManifestSha256) ||
    !bytesEqualFullScan(metadata.functionMetadataSha256, authority.functionMetadataSha256)
  ) return yield* dispatchFailure("authorityMismatch", "activeSelection");
  const pathSeparator = authority.function.functionPath.indexOf(":");
  if (
    authority.function.visibility !== "public" ||
    authority.function.entry.visibility !== "public" ||
    authority.function.entry.functionOrdinal !== authority.function.functionOrdinal ||
    authority.function.entry.functionPath !== authority.function.functionPath ||
    authority.function.entry.executionModule !== authority.function.artifactExecutionModule ||
    authority.function.entry.exportName !== authority.function.exportName ||
    authority.function.entry.group !== "transaction" ||
    authority.function.projection.group !== "transaction" ||
    pathSeparator <= 0 ||
    pathSeparator !== authority.function.functionPath.lastIndexOf(":")
  ) return yield* dispatchFailure("functionMismatch", "function");
});

const loadSelectedProjection = Effect.fn(
  "CandidateBoundRuntimeDispatch.loadSelectedProjection",
)(function* (
  authority: CandidateBoundRuntimeTargetAuthorityV1,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
  budget: CandidateBoundRuntimeTargetBudgetV1,
) {
  const projectionAuthority = authority.publication.projections.find(
    item => item.frame.group === "transaction",
  );
  const edgeActionProjectionAuthority = authority.publication.projections.find(
    item => item.frame.group === "edge_action",
  );
  if (projectionAuthority === undefined) {
    return yield* dispatchFailure("projectionMismatch", "transaction");
  }
  const admission = objectAdmission(budget);
  const projectionSet = yield* readFrame(
    store,
    authority.publication.projectionSetReference,
    "runtime_projection_set",
    admission,
    "projectionSet",
  );
  const manifest = yield* readFrame(
    store,
    authority.publication.manifestReference,
    "function_group_manifest",
    admission,
    "manifest",
  );
  const entry = yield* readFrame(
    store,
    authority.function.entryReference,
    "function_group_entry",
    admission,
    "functionEntry",
  );
  const projection = yield* readFrame(
    store,
    projectionAuthority.reference,
    "runtime_projection",
    admission,
    "projection",
  );
  const functionRootPreimage = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "functionGroupEntries",
      null,
      authority.publication.functionEntries.map(item => item.reference.sha256),
      ROOT_BUDGET,
    ),
  );
  const functionRoot = yield* sha256(
    functionRootPreimage,
    { maximumInputBytes: budget.maximumHashBytes },
  );
  if (
    !bytesEqualFullScan(
      authority.candidate.runtimeProjectionSetSha256,
      authority.publication.projectionSetReference.sha256,
    ) ||
    !bytesEqualFullScan(
      authority.candidate.functionGroupManifestSha256,
      authority.publication.manifestReference.sha256,
    ) ||
    projectionSet.groupCount !== BigInt(authority.publication.projections.length) ||
    !nullableDigestEqual(
      projectionSet.transactionProjectionSha256,
      projectionAuthority.reference.sha256,
    ) ||
    !nullableDigestEqual(
      projectionSet.edgeActionProjectionSha256,
      edgeActionProjectionAuthority?.reference.sha256 ?? null,
    ) ||
    !bytesEqualFullScan(
      manifest.runtimeProjectionSetSha256,
      authority.publication.projectionSetReference.sha256,
    ) ||
    manifest.functionCount !== BigInt(authority.publication.functionEntries.length) ||
    manifest.functionCount !== authority.publication.manifestFrame.functionCount ||
    !bytesEqualFullScan(manifest.functionRootSha256, functionRoot) ||
    !bytesEqualFullScan(
      manifest.functionRootSha256,
      authority.publication.manifestFrame.functionRootSha256,
    ) ||
    !bytesEqualFullScan(manifest.validatorRootSha256, authority.candidate.validatorRootSha256) ||
    !bytesEqualFullScan(manifest.declaredHandlerSetSha256, authority.candidate.declaredHandlerSetSha256) ||
    !functionEntryEqual(entry, authority.function.entry) ||
    !projectionEqual(projection, projectionAuthority.frame) ||
    !bytesEqualFullScan(entry.projectionSha256, projectionAuthority.reference.sha256)
  ) return yield* dispatchFailure("projectionMismatch", "publication");
  if (projectionAuthority.modules.length > budget.maximumModules) {
    return yield* exceeded(
      "modules",
      projectionAuthority.modules.length,
      budget.maximumModules,
    );
  }
  const modules: Array<Readonly<{ readonly path: string; readonly source: string }>> = [];
  const moduleDigests: Uint8Array[] = [];
  let rawBytes = 0;
  for (let index = 0; index < projectionAuthority.modules.length; index += 1) {
    const stored = projectionAuthority.modules[index]!;
    const frame = yield* readFrame(
      store,
      stored.reference,
      "runtime_projection_module",
      admission,
      `modules[${index}]`,
    );
    if (
      frame.group !== "transaction" ||
      frame.moduleOrdinal !== BigInt(index) ||
      frame.moduleOrdinal !== stored.moduleOrdinal ||
      frame.modulePath !== stored.modulePath ||
      frame.roles !== stored.roles ||
      BigInt(frame.sourceBytes.byteLength) !== stored.sourceByteLength ||
      !bytesEqualFullScan(frame.sourceSha256, stored.sourceSha256)
    ) return yield* dispatchFailure("projectionMismatch", `modules[${index}]`);
    yield* Effect.fromResult(decodeDeclarativeV2ArtifactModulePathV1(frame.modulePath));
    const sourceSha256 = yield* sha256(
      frame.sourceBytes,
      { maximumInputBytes: budget.maximumHashBytes },
    );
    if (!bytesEqualFullScan(sourceSha256, frame.sourceSha256)) {
      return yield* dispatchFailure(
        "projectionMismatch",
        `modules[${index}].sourceSha256`,
      );
    }
    rawBytes += frame.sourceBytes.byteLength;
    if (!Number.isSafeInteger(rawBytes) || rawBytes > budget.maximumRawBytes) {
      return yield* exceeded("rawBytes", rawBytes, budget.maximumRawBytes);
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(frame.sourceBytes);
    } catch {
      return yield* dispatchFailure("invalidSourceUtf8", `modules[${index}]`);
    }
    moduleDigests.push(stored.reference.sha256);
    modules.push(Object.freeze({ path: frame.modulePath, source }));
  }
  const rootPreimage = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "runtimeProjectionModules",
      "transaction",
      moduleDigests,
      ROOT_BUDGET,
    ),
  );
  const root = yield* sha256(
    rootPreimage,
    { maximumInputBytes: budget.maximumHashBytes },
  );
  if (
    projection.moduleCount !== BigInt(modules.length) ||
    projection.rawByteLength !== BigInt(rawBytes) ||
    !bytesEqualFullScan(projection.moduleRootSha256, root) ||
    !modules.some(module => module.path === authority.function.artifactExecutionModule)
  ) return yield* dispatchFailure("projectionMismatch", "projection.root");
  return Object.freeze({ modules: Object.freeze(modules) });
});

function targetFrame(
  authority: CandidateBoundRuntimeTargetAuthorityV1,
  compatibilityDate: string,
  exactRuntimeGraphBasisSha256: Uint8Array,
): CandidateBoundRuntimeTargetFrameV1 {
  const projection = authority.publication.projections.find(
    item => item.frame.group === "transaction",
  )!;
  return Object.freeze({
    scopeId: authority.scopeAuthority.scopeId,
    storageGeneration: authority.scopeAuthority.storageGeneration,
    storageGenerationFence: authority.scopeAuthority.storageGenerationFence,
    scopeEpoch: authority.scopeAuthority.epoch,
    applicationRevisionId: authority.metadata.applicationRevisionId,
    activationRevision: authority.metadata.activationRevision,
    activationHeadSha256: authority.metadata.activationHeadSha256,
    readinessReceiptSha256: authority.metadata.readinessReceiptSha256,
    candidateSha256: authority.candidateSha256,
    attemptSha256: authority.attemptSha256,
    packageSha256: authority.candidate.packageSha256,
    artifactSha256: authority.candidate.artifactSha256,
    sourceRootSha256: authority.candidate.sourceRootSha256,
    semanticRootSha256: authority.candidate.semanticRootSha256,
    schemaArtifactSha256: authority.candidate.schemaArtifactSha256,
    schemaBindingSha256: authority.candidate.schemaBindingSha256,
    functionMetadataSha256: authority.functionMetadataSha256,
    validatorRootSha256: authority.candidate.validatorRootSha256,
    declaredHandlerSetSha256: authority.candidate.declaredHandlerSetSha256,
    runtimeProjectionSetSha256: authority.candidate.runtimeProjectionSetSha256,
    functionGroupManifestSha256: authority.candidate.functionGroupManifestSha256,
    compatibilityDate,
    exactRuntimeProfile: POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1,
    exactRuntimeVersion: POINT_MUTATION_EXACT_RUNTIME_VERSION_V1,
    exactRuntimeGraphBasisSha256,
    functionOrdinal: authority.function.functionOrdinal,
    functionPath: authority.function.functionPath,
    logicalExecutionModule: authority.function.logicalExecutionModule,
    artifactExecutionModule: authority.function.artifactExecutionModule,
    projectionExecutionModule: projection.frame.executionModule,
    exportName: authority.function.exportName,
    handlerKind: "mutation",
    visibility: authority.function.visibility,
    group: "transaction",
    projectionSha256: projection.reference.sha256,
    projectionSetReference: authority.publication.projectionSetReference,
    functionGroupManifestReference: authority.publication.manifestReference,
    functionEntryReference: authority.function.entryReference,
    projectionReference: projection.reference,
    modules: Object.freeze(projection.modules.map(module => Object.freeze({
      moduleOrdinal: module.moduleOrdinal,
      modulePath: module.modulePath,
      roles: module.roles,
      sourceByteLength: module.sourceByteLength,
      sourceSha256: module.sourceSha256,
      reference: module.reference,
    }))),
  });
}

function registrySource(
  fn: CandidateBoundRuntimeTargetFunctionAuthorityV1,
): string {
  const separator = fn.functionPath.indexOf(":");
  const moduleName = fn.functionPath.slice(0, separator);
  const specifier = `../${fn.artifactExecutionModule}`;
  return `// Generated from an authenticated candidate-bound function entry.\n` +
    `import * as applicationModuleV1 from ${JSON.stringify(specifier)};\n` +
    `const handlerV1 = applicationModuleV1[${JSON.stringify(fn.exportName)}];\n` +
    `const functionV1 = Object.freeze({ isMutation: true, isPublic: true, _handler: handlerV1 });\n` +
    `export default Object.freeze({ ${JSON.stringify(moduleName)}: Object.freeze({ ${JSON.stringify(fn.exportName)}: functionV1 }) });\n`;
}

function readFrame<K extends
  | "runtime_projection_set"
  | "function_group_manifest"
  | "function_group_entry"
  | "runtime_projection"
  | "runtime_projection_module"
>(
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  reference: DeclarativeV2RuntimeArtifactObjectReferenceV1,
  expectedKind: K,
  admission: (
    expected: DeclarativeV2RuntimeArtifactObjectReferenceV1,
    path: string,
  ) => (
    receipt: DeclarativeV2RuntimeArtifactR2AdmissionV1,
  ) => Effect.Effect<void, CandidateBoundRuntimeDispatchV1Error>,
  path: string,
): Effect.Effect<
  Extract<DeclarativeV2PhysicalFrameV1, { readonly kind: K }>,
  | DeclarativeV2RuntimeArtifactR2V1Error
  | DeclarativeV2PhysicalFrameV1Error
  | CandidateBoundRuntimeDispatchV1Error
> {
  return store.readImmutableAdmitted(
    reference.kind,
    reference.sha256,
    admission(reference, path),
  ).pipe(Effect.flatMap(object => Effect.fromResult(
    decodeDeclarativeV2PhysicalFrameV1(object.bytes, FRAME_BUDGET),
  )), Effect.flatMap(decoded => decoded.frame.kind === expectedKind
    ? Effect.succeed(decoded.frame as Extract<typeof decoded.frame, { kind: K }>)
    : dispatchFailure("projectionMismatch", path)));
}

function objectAdmission(budget: CandidateBoundRuntimeTargetBudgetV1) {
  let objects = 0;
  let bytes = 0;
  return (
    expected: DeclarativeV2RuntimeArtifactObjectReferenceV1,
    path: string,
  ) => (receipt: Readonly<{ readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1 }>) => {
    if (!referenceEqual(expected, receipt.reference)) {
      return dispatchFailure("authorityMismatch", `${path}.reference`);
    }
    objects += 1;
    bytes += Number(receipt.reference.byteLength);
    if (objects > budget.maximumObjects) {
      return exceeded("objects", objects, budget.maximumObjects);
    }
    if (!Number.isSafeInteger(bytes) || bytes > budget.maximumObjectBytes) {
      return exceeded("objectBytes", bytes, budget.maximumObjectBytes);
    }
    return Effect.void;
  };
}

function captureBudget(
  input: unknown,
): Effect.Effect<
  CandidateBoundRuntimeTargetBudgetV1,
  CandidateBoundRuntimeDispatchV1Error
> {
  if (
    typeof input !== "object" || input === null || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    return dispatchFailure("invalidBudget", "budget");
  }
  const fields = [
    "maximumModules",
    "maximumObjects",
    "maximumObjectBytes",
    "maximumRawBytes",
    "maximumHashBytes",
  ] as const;
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.length !== fields.length ||
    ownKeys.some(key =>
      typeof key !== "string" || !fields.some(field => field === key)
    )
  ) return dispatchFailure("invalidBudget", "budget");
  const captured: Record<(typeof fields)[number], number> = {
    maximumModules: 0,
    maximumObjects: 0,
    maximumObjectBytes: 0,
    maximumRawBytes: 0,
    maximumHashBytes: 0,
  };
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (
      descriptor === undefined || !descriptor.enumerable ||
      !("value" in descriptor) || !isNonNegativeSafeInteger(descriptor.value)
    ) return dispatchFailure("invalidBudget", `budget.${field}`);
    captured[field] = descriptor.value;
  }
  return Effect.succeed(Object.freeze({
    maximumModules: captured.maximumModules,
    maximumObjects: captured.maximumObjects,
    maximumObjectBytes: captured.maximumObjectBytes,
    maximumRawBytes: captured.maximumRawBytes,
    maximumHashBytes: captured.maximumHashBytes,
  }));
}

function referenceEqual(
  left: DeclarativeV2RuntimeArtifactObjectReferenceV1,
  right: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): boolean {
  return left.storeIdentity === right.storeIdentity && left.kind === right.kind &&
    left.codecIdentity === right.codecIdentity && left.objectKey === right.objectKey &&
    left.byteLength === right.byteLength &&
    bytesEqualFullScan(left.sha256, right.sha256);
}

function functionEntryEqual(
  left: DeclarativeV2FunctionGroupEntryFrameV1,
  right: DeclarativeV2FunctionGroupEntryFrameV1,
): boolean {
  return left.functionOrdinal === right.functionOrdinal &&
    left.functionPath === right.functionPath &&
    left.executionModule === right.executionModule &&
    left.exportName === right.exportName && left.handlerKind === right.handlerKind &&
    left.visibility === right.visibility && left.group === right.group &&
    bytesEqualFullScan(left.projectionSha256, right.projectionSha256);
}

function projectionEqual(
  left: DeclarativeV2RuntimeProjectionFrameV1,
  right: DeclarativeV2RuntimeProjectionFrameV1,
): boolean {
  return left.group === right.group && left.executionModule === right.executionModule &&
    left.moduleCount === right.moduleCount && left.rawByteLength === right.rawByteLength &&
    bytesEqualFullScan(left.moduleRootSha256, right.moduleRootSha256);
}

function nullableDigestEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right);
}

function exceeded(path: string, observed: number, maximum: number) {
  return Effect.fail(new CandidateBoundRuntimeDispatchV1Error({
    reason: "resourceExceeded",
    path,
    observed,
    maximum,
  }));
}

function dispatchFailure(
  reason: CandidateBoundRuntimeDispatchV1Error["reason"],
  path: string,
) {
  return Effect.fail(new CandidateBoundRuntimeDispatchV1Error({ reason, path }));
}
