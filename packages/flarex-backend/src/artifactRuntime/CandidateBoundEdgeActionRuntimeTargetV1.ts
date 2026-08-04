import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Scope } from "effect";
import {
  encodeCandidateBoundEdgeActionRuntimeTargetV1,
  type CandidateBoundEdgeActionRuntimeTargetFrameV1,
  type CandidateBoundEdgeActionRuntimeTargetV1Error,
} from "flarex-protocol/internal/candidate-bound-edge-action-runtime-target-v1";
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
  encodeEdgeActionHostPolicyV1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  type EdgeActionHostPolicyFrameV1,
  type EdgeActionHostPolicyV1Error,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
  type EdgeActionExactRuntimeArtifactRefV1,
  type EdgeActionExactRuntimeFunctionV1,
} from "flarex-protocol/edge-action-exact-runtime";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

import {
  buildEdgeActionExactRuntimeWorkerDefinitionV1,
  edgeActionExactRuntimeWorkerGraphBasisV1,
  EdgeActionExactRuntimeHostV1Error,
  type EdgeActionExactRuntimeWorkerDefinitionV1,
} from "./EdgeActionExactRuntimeHost";
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

export type { EdgeActionExactRuntimeWorkerDefinitionV1 } from
  "./EdgeActionExactRuntimeHost";

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
const POLICY_BUDGET = Object.freeze({
  maximumOrigins: 256,
  maximumOriginBytes: 2_048,
  maximumCanonicalBytes: 1_048_576,
});
const UTF8 = new TextEncoder();

export interface CandidateBoundEdgeActionRuntimeTargetAuthorityV1 {
  readonly metadata: Readonly<{
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
  }>;
  readonly scopeAuthority: Readonly<{
    readonly scopeId: string;
    readonly storageGeneration: "flarexdb_v1";
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  }>;
  readonly attemptSha256: Uint8Array;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly candidateFrameBytes: Uint8Array;
  readonly functionMetadataSha256: Uint8Array;
  readonly publication: Readonly<{
    readonly projectionSetReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    readonly manifestReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
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
  readonly function: Readonly<{
    readonly functionOrdinal: bigint;
    readonly functionPath: string;
    readonly logicalExecutionModule: string;
    readonly artifactExecutionModule: string;
    readonly exportName: string;
    readonly handlerKind: "action";
    readonly visibility: "public";
    readonly argsValidator: ValidatorJsonV1;
    readonly returnsValidator: ValidatorJsonV1 | null;
    readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
      readonly handlerKind: "action";
      readonly visibility: "public";
      readonly group: "edge_action";
    };
    readonly entryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    readonly projection: DeclarativeV2RuntimeProjectionFrameV1 & {
      readonly group: "edge_action";
    };
  }>;
}

export interface CandidateBoundEdgeActionRuntimeTargetAuthorityPortV1<Selection, E> {
  readonly claim: (
    selection: Selection,
    functionPath: string,
  ) => Effect.Effect<CandidateBoundEdgeActionRuntimeTargetAuthorityV1, E>;
}

export interface CandidateBoundEdgeActionRuntimeTargetBudgetV1 {
  readonly maximumModules: number;
  readonly maximumObjects: number;
  readonly maximumObjectBytes: number;
  readonly maximumRawBytes: number;
  readonly maximumHashBytes: number;
}

declare const edgeActionTargetBrand: unique symbol;
export interface CandidateBoundEdgeActionRuntimeTargetV1 {
  readonly [edgeActionTargetBrand]: true;
}

export interface PreparedCandidateBoundEdgeActionRuntimeTargetV1 {
  readonly target: CandidateBoundEdgeActionRuntimeTargetV1;
  readonly binding: Readonly<{
    readonly scopeId: string;
    readonly applicationRevisionId: string;
    readonly candidateSha256: Uint8Array;
    readonly actionBindingSha256: Uint8Array;
    readonly functionPath: string;
    readonly compatibilityDate: string;
  }>;
  readonly runtimeTargetSha256: Uint8Array;
  readonly hostPolicySha256: Uint8Array;
  readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
  readonly function: EdgeActionExactRuntimeFunctionV1;
}

export interface ClaimedCandidateBoundEdgeActionRuntimeTargetV1
  extends PreparedCandidateBoundEdgeActionRuntimeTargetV1 {
  readonly canonicalTargetBytes: Uint8Array;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly definition: EdgeActionExactRuntimeWorkerDefinitionV1;
}

export class CandidateBoundEdgeActionRuntimeDispatchV1Error
  extends Data.TaggedError("CandidateBoundEdgeActionRuntimeDispatchV1Error")<{
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

export class InvalidCandidateBoundEdgeActionRuntimeTargetV1Error
  extends Data.TaggedError(
    "InvalidCandidateBoundEdgeActionRuntimeTargetV1Error",
  )<{ readonly reason: "notIssued" }> {}

export type PrepareCandidateBoundEdgeActionRuntimeTargetV1Error<E> =
  | E
  | CandidateBoundEdgeActionRuntimeDispatchV1Error
  | CandidateBoundEdgeActionRuntimeTargetV1Error
  | EdgeActionHostPolicyV1Error
  | DeclarativeV2ArtifactModulePathVerdictV1Error
  | DeclarativeV2PhysicalFrameV1Error
  | DeclarativeV2RuntimeProjectionIdentityV1Error
  | DeclarativeV2RuntimeArtifactR2V1Error
  | DeclarativeV2RuntimeArtifactSha256V1Error
  | EdgeActionExactRuntimeHostV1Error;

interface TargetStateV1 {
  readonly binding: PreparedCandidateBoundEdgeActionRuntimeTargetV1["binding"];
  readonly runtimeTargetSha256: Uint8Array;
  readonly hostPolicySha256: Uint8Array;
  readonly canonicalTargetBytes: Uint8Array;
  readonly artifact: EdgeActionExactRuntimeArtifactRefV1;
  readonly function: EdgeActionExactRuntimeFunctionV1;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly definition: EdgeActionExactRuntimeWorkerDefinitionV1;
}

const targetStates = new WeakMap<
  CandidateBoundEdgeActionRuntimeTargetV1,
  TargetStateV1
>();

export const prepareCandidateBoundEdgeActionRuntimeTargetV1 = Effect.fn(
  "CandidateBoundEdgeActionRuntimeDispatch.prepareV1",
)(function* <Selection, AuthorityError>(
  selection: Selection,
  functionPath: string,
  authorityPort: CandidateBoundEdgeActionRuntimeTargetAuthorityPortV1<
    Selection,
    AuthorityError
  >,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  budgetInput: unknown,
  hostPolicyInput: unknown,
  compatibilityDate: string,
  sha256: DeclarativeV2RuntimeArtifactSha256V1 =
    makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
): Effect.fn.Return<
  PreparedCandidateBoundEdgeActionRuntimeTargetV1,
  PrepareCandidateBoundEdgeActionRuntimeTargetV1Error<AuthorityError>,
  Scope.Scope
> {
  const budget = yield* Effect.fromResult(captureBudget(budgetInput));
  const policy = yield* Effect.fromResult(
    encodeEdgeActionHostPolicyV1(hostPolicyInput, POLICY_BUDGET),
  );
  const hostPolicySha256 = yield* sha256(policy.canonicalBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  const authority = yield* authorityPort.claim(selection, functionPath);
  yield* verifyAuthority(authority, functionPath, sha256, budget);
  const loaded = yield* loadSelectedProjection(authority, store, sha256, budget);
  const policyHex = encodeBytesToLowercaseHex(hostPolicySha256);
  const graphBasis = yield* Effect.try({
    try: () => edgeActionExactRuntimeWorkerGraphBasisV1({
      compatibilityDate,
      hostPolicySha256Hex: policyHex,
      artifactExecutionModule: authority.function.artifactExecutionModule,
      exportName: authority.function.exportName,
      functionPath,
    }),
    catch: cause => new EdgeActionExactRuntimeHostV1Error({
      reason: "workerDefinitionFailed",
      cause,
    }),
  });
  const graphBasisSha256 = yield* sha256(UTF8.encode(graphBasis), {
    maximumInputBytes: budget.maximumHashBytes,
  });
  const encoded = yield* Effect.fromResult(
    encodeCandidateBoundEdgeActionRuntimeTargetV1(
      targetFrame(
        authority,
        compatibilityDate,
        graphBasisSha256,
        hostPolicySha256,
      ),
      TARGET_BUDGET,
    ),
  );
  const runtimeTargetSha256 = yield* sha256(encoded.canonicalBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  const targetHex = encodeBytesToLowercaseHex(runtimeTargetSha256);
  const artifact = Object.freeze({
    runtime: "dynamic-worker" as const,
    artifactId: `artifact_${targetHex.slice(0, 32)}`,
    sourcePackageHash: targetHex,
    executionModule:
      "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
  });
  const functionProjection = Object.freeze({
    path: functionPath,
    executionModule: artifact.executionModule,
    kind: "action" as const,
    visibility: "public" as const,
    argsValidator: authority.function.argsValidator,
    returnsValidator: authority.function.returnsValidator,
  });
  const definition = yield* Effect.try({
    try: () => buildEdgeActionExactRuntimeWorkerDefinitionV1({
      artifact,
      compatibilityDate,
      runtimeTargetSha256Hex: targetHex,
      hostPolicySha256Hex: policyHex,
      hostPolicy: policy.frame,
      function: functionProjection,
      functionPath,
      artifactExecutionModule: authority.function.artifactExecutionModule,
      exportName: authority.function.exportName,
      sourceModules: loaded.modules,
    }),
    catch: cause => new EdgeActionExactRuntimeHostV1Error({
      reason: "workerDefinitionFailed",
      cause,
    }),
  });
  const state: TargetStateV1 = Object.freeze({
    binding: Object.freeze({
      scopeId: authority.scopeAuthority.scopeId,
      applicationRevisionId: authority.metadata.applicationRevisionId,
      candidateSha256: copyBytes(authority.candidateSha256),
      actionBindingSha256: copyBytes(authority.function.entryReference.sha256),
      functionPath,
      compatibilityDate,
    }),
    runtimeTargetSha256: copyBytes(runtimeTargetSha256),
    hostPolicySha256: copyBytes(hostPolicySha256),
    canonicalTargetBytes: copyBytes(encoded.canonicalBytes),
    artifact,
    function: functionProjection,
    hostPolicy: policy.frame,
    definition,
  });
  const target = yield* Effect.acquireRelease(
    Effect.sync(() => issueTarget(state)),
    issued => Effect.sync(() => { targetStates.delete(issued); }),
  );
  return prepared(target, state);
});

export function claimCandidateBoundEdgeActionRuntimeTargetV1(
  target: unknown,
): Result.Result<
  ClaimedCandidateBoundEdgeActionRuntimeTargetV1,
  InvalidCandidateBoundEdgeActionRuntimeTargetV1Error
> {
  return Result.map(claimState(target), state => Object.freeze({
    ...prepared(target as CandidateBoundEdgeActionRuntimeTargetV1, state),
    canonicalTargetBytes: copyBytes(state.canonicalTargetBytes),
    hostPolicy: state.hostPolicy,
    definition: state.definition,
  }));
}

function issueTarget(state: TargetStateV1): CandidateBoundEdgeActionRuntimeTargetV1 {
  const target = Object.freeze({}) as CandidateBoundEdgeActionRuntimeTargetV1;
  targetStates.set(target, state);
  return target;
}

function claimState(target: unknown): Result.Result<
  TargetStateV1,
  InvalidCandidateBoundEdgeActionRuntimeTargetV1Error
> {
  if (target === null || typeof target !== "object") {
    return Result.fail(new InvalidCandidateBoundEdgeActionRuntimeTargetV1Error({
      reason: "notIssued",
    }));
  }
  const state = targetStates.get(target as CandidateBoundEdgeActionRuntimeTargetV1);
  return state === undefined
    ? Result.fail(new InvalidCandidateBoundEdgeActionRuntimeTargetV1Error({
        reason: "notIssued",
      }))
    : Result.succeed(state);
}

function prepared(
  target: CandidateBoundEdgeActionRuntimeTargetV1,
  state: TargetStateV1,
): PreparedCandidateBoundEdgeActionRuntimeTargetV1 {
  return Object.freeze({
    target,
    binding: Object.freeze({
      ...state.binding,
      candidateSha256: copyBytes(state.binding.candidateSha256),
      actionBindingSha256: copyBytes(state.binding.actionBindingSha256),
    }),
    runtimeTargetSha256: copyBytes(state.runtimeTargetSha256),
    hostPolicySha256: copyBytes(state.hostPolicySha256),
    artifact: Object.freeze({ ...state.artifact }),
    function: state.function,
  });
}

const verifyAuthority = Effect.fn(
  "CandidateBoundEdgeActionRuntimeDispatch.verifyAuthorityV1",
)(function* (
  authority: CandidateBoundEdgeActionRuntimeTargetAuthorityV1,
  functionPath: string,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
  budget: CandidateBoundEdgeActionRuntimeTargetBudgetV1,
) {
  const encodedCandidate = yield* Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(authority.candidate, FRAME_BUDGET),
  );
  const candidateSha256 = yield* sha256(encodedCandidate.canonicalBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  const metadata = authority.metadata;
  const candidate = authority.candidate;
  if (
    !bytesEqualFullScan(encodedCandidate.canonicalBytes, authority.candidateFrameBytes) ||
    !bytesEqualFullScan(candidateSha256, authority.candidateSha256) ||
    authority.function.functionPath !== functionPath ||
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
    !bytesEqualFullScan(metadata.functionMetadataSha256,
      authority.functionMetadataSha256) ||
    !bytesEqualFullScan(metadata.validatorRootSha256, candidate.validatorRootSha256) ||
    !bytesEqualFullScan(metadata.declaredHandlerSetSha256,
      candidate.declaredHandlerSetSha256) ||
    !bytesEqualFullScan(metadata.runtimeProjectionSetSha256,
      candidate.runtimeProjectionSetSha256) ||
    !bytesEqualFullScan(metadata.functionGroupManifestSha256,
      candidate.functionGroupManifestSha256)
  ) return yield* failure("authorityMismatch", "activeSelection");
  const separator = functionPath.indexOf(":");
  if (
    authority.function.handlerKind !== "action" ||
    authority.function.visibility !== "public" ||
    separator <= 0 || separator !== functionPath.lastIndexOf(":") ||
    authority.function.entry.functionOrdinal !== authority.function.functionOrdinal ||
    authority.function.entry.functionPath !== functionPath ||
    authority.function.entry.executionModule !==
      authority.function.artifactExecutionModule ||
    authority.function.entry.exportName !== authority.function.exportName ||
    authority.function.entry.handlerKind !== "action" ||
    authority.function.entry.visibility !== "public" ||
    authority.function.entry.group !== "edge_action" ||
    authority.function.projection.group !== "edge_action"
  ) return yield* failure("functionMismatch", "function");
});

const loadSelectedProjection = Effect.fn(
  "CandidateBoundEdgeActionRuntimeDispatch.loadProjectionV1",
)(function* (
  authority: CandidateBoundEdgeActionRuntimeTargetAuthorityV1,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
  budget: CandidateBoundEdgeActionRuntimeTargetBudgetV1,
) {
  const selected = authority.publication.projections.find(
    item => item.frame.group === "edge_action",
  );
  const transaction = authority.publication.projections.find(
    item => item.frame.group === "transaction",
  );
  if (selected === undefined) {
    return yield* failure("projectionMismatch", "edge_action");
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
    selected.reference,
    "runtime_projection",
    admission,
    "projection",
  );
  const functionRootBytes = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "functionGroupEntries",
      null,
      authority.publication.functionEntries.map(item => item.reference.sha256),
      ROOT_BUDGET,
    ),
  );
  const functionRoot = yield* sha256(functionRootBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  if (
    !bytesEqualFullScan(authority.candidate.runtimeProjectionSetSha256,
      authority.publication.projectionSetReference.sha256) ||
    !bytesEqualFullScan(authority.candidate.functionGroupManifestSha256,
      authority.publication.manifestReference.sha256) ||
    projectionSet.groupCount !== BigInt(authority.publication.projections.length) ||
    !nullableDigestEqual(projectionSet.transactionProjectionSha256,
      transaction?.reference.sha256 ?? null) ||
    !nullableDigestEqual(projectionSet.edgeActionProjectionSha256,
      selected.reference.sha256) ||
    !bytesEqualFullScan(manifest.runtimeProjectionSetSha256,
      authority.publication.projectionSetReference.sha256) ||
    manifest.functionCount !== BigInt(authority.publication.functionEntries.length) ||
    !bytesEqualFullScan(manifest.functionRootSha256, functionRoot) ||
    !bytesEqualFullScan(manifest.validatorRootSha256,
      authority.candidate.validatorRootSha256) ||
    !bytesEqualFullScan(manifest.declaredHandlerSetSha256,
      authority.candidate.declaredHandlerSetSha256) ||
    !functionEntryEqual(entry, authority.function.entry) ||
    !projectionEqual(projection, selected.frame) ||
    !bytesEqualFullScan(entry.projectionSha256, selected.reference.sha256)
  ) return yield* failure("projectionMismatch", "publication");
  if (selected.modules.length > budget.maximumModules) {
    return yield* exceeded("modules", selected.modules.length,
      budget.maximumModules);
  }
  const modules: Array<Readonly<{ readonly path: string; readonly source: string }>> = [];
  const moduleDigests: Uint8Array[] = [];
  let rawBytes = 0;
  for (let index = 0; index < selected.modules.length; index += 1) {
    const stored = selected.modules[index]!;
    const frame = yield* readFrame(
      store,
      stored.reference,
      "runtime_projection_module",
      admission,
      `modules[${index}]`,
    );
    if (
      frame.group !== "edge_action" || frame.moduleOrdinal !== BigInt(index) ||
      frame.moduleOrdinal !== stored.moduleOrdinal ||
      frame.modulePath !== stored.modulePath || frame.roles !== stored.roles ||
      BigInt(frame.sourceBytes.byteLength) !== stored.sourceByteLength ||
      !bytesEqualFullScan(frame.sourceSha256, stored.sourceSha256)
    ) return yield* failure("projectionMismatch", `modules[${index}]`);
    yield* Effect.fromResult(decodeDeclarativeV2ArtifactModulePathV1(frame.modulePath));
    const digest = yield* sha256(frame.sourceBytes, {
      maximumInputBytes: budget.maximumHashBytes,
    });
    if (!bytesEqualFullScan(digest, frame.sourceSha256)) {
      return yield* failure("projectionMismatch", `modules[${index}].sourceSha256`);
    }
    rawBytes += frame.sourceBytes.byteLength;
    if (!Number.isSafeInteger(rawBytes) || rawBytes > budget.maximumRawBytes) {
      return yield* exceeded("rawBytes", rawBytes, budget.maximumRawBytes);
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(frame.sourceBytes);
    } catch {
      return yield* failure("invalidSourceUtf8", `modules[${index}]`);
    }
    moduleDigests.push(stored.reference.sha256);
    modules.push(Object.freeze({ path: frame.modulePath, source }));
  }
  const rootBytes = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "runtimeProjectionModules",
      "edge_action",
      moduleDigests,
      ROOT_BUDGET,
    ),
  );
  const root = yield* sha256(rootBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  if (
    projection.moduleCount !== BigInt(modules.length) ||
    projection.rawByteLength !== BigInt(rawBytes) ||
    !bytesEqualFullScan(projection.moduleRootSha256, root) ||
    !modules.some(module =>
      module.path === authority.function.artifactExecutionModule)
  ) return yield* failure("projectionMismatch", "projection.root");
  return Object.freeze({ modules: Object.freeze(modules) });
});

function targetFrame(
  authority: CandidateBoundEdgeActionRuntimeTargetAuthorityV1,
  compatibilityDate: string,
  graphSha256: Uint8Array,
  hostPolicySha256: Uint8Array,
): CandidateBoundEdgeActionRuntimeTargetFrameV1 {
  const projection = authority.publication.projections.find(
    item => item.frame.group === "edge_action",
  )!;
  return Object.freeze({
    scopeId: authority.scopeAuthority.scopeId,
    storageGeneration: "flarexdb_v1",
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
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    exactRuntimeVersion: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    exactRuntimeGraphBasisSha256: graphSha256,
    hostPolicySha256,
    functionOrdinal: authority.function.functionOrdinal,
    functionPath: authority.function.functionPath,
    logicalExecutionModule: authority.function.logicalExecutionModule,
    artifactExecutionModule: authority.function.artifactExecutionModule,
    projectionExecutionModule: projection.frame.executionModule,
    exportName: authority.function.exportName,
    handlerKind: "action",
    visibility: "public",
    group: "edge_action",
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

function readFrame<K extends DeclarativeV2PhysicalFrameV1["kind"]>(
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  reference: DeclarativeV2RuntimeArtifactObjectReferenceV1,
  expectedKind: K,
  admission: (
    expected: DeclarativeV2RuntimeArtifactObjectReferenceV1,
    path: string,
  ) => (receipt: DeclarativeV2RuntimeArtifactR2AdmissionV1) =>
    Effect.Effect<void, CandidateBoundEdgeActionRuntimeDispatchV1Error>,
  path: string,
): Effect.Effect<
  Extract<DeclarativeV2PhysicalFrameV1, { readonly kind: K }>,
  DeclarativeV2RuntimeArtifactR2V1Error | DeclarativeV2PhysicalFrameV1Error |
    CandidateBoundEdgeActionRuntimeDispatchV1Error
> {
  return store.readImmutableAdmitted(
    reference.kind,
    reference.sha256,
    admission(reference, path),
  ).pipe(
    Effect.flatMap(object => Effect.fromResult(
      decodeDeclarativeV2PhysicalFrameV1(object.bytes, FRAME_BUDGET),
    )),
    Effect.flatMap(decoded => decoded.frame.kind === expectedKind
      ? Effect.succeed(decoded.frame as Extract<
          DeclarativeV2PhysicalFrameV1,
          { readonly kind: K }
        >)
      : failure("projectionMismatch", path)),
  );
}

function objectAdmission(budget: CandidateBoundEdgeActionRuntimeTargetBudgetV1) {
  let objects = 0;
  let bytes = 0;
  return (expected: DeclarativeV2RuntimeArtifactObjectReferenceV1, path: string) =>
    (receipt: DeclarativeV2RuntimeArtifactR2AdmissionV1) => {
      objects += 1;
      bytes += Number(receipt.reference.byteLength);
      if (objects > budget.maximumObjects) {
        return exceeded("objects", objects, budget.maximumObjects);
      }
      if (!Number.isSafeInteger(bytes) || bytes > budget.maximumObjectBytes) {
        return exceeded("objectBytes", bytes, budget.maximumObjectBytes);
      }
      return referenceEqual(expected, receipt.reference)
        ? Effect.void
        : failure("authorityMismatch", path);
    };
}

function captureBudget(input: unknown): Result.Result<
  CandidateBoundEdgeActionRuntimeTargetBudgetV1,
  CandidateBoundEdgeActionRuntimeDispatchV1Error
> {
  const keys = [
    "maximumModules", "maximumObjects", "maximumObjectBytes",
    "maximumRawBytes", "maximumHashBytes",
  ] as const;
  if (
    !isNonArrayRecord(input) || Reflect.ownKeys(input).length !== keys.length ||
    keys.some(key => !isPositiveSafeInteger(input[key]))
  ) return Result.fail(new CandidateBoundEdgeActionRuntimeDispatchV1Error({
    reason: "invalidBudget",
    path: "budget",
  }));
  const captured = new Map<(typeof keys)[number], number>();
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== "number") throw new Error(`Missing ${key}.`);
    captured.set(key, value);
  }
  const read = (key: (typeof keys)[number]): number => {
    const value = captured.get(key);
    if (value === undefined) throw new Error(`Missing ${key}.`);
    return value;
  };
  return Result.succeed(Object.freeze({
    maximumModules: read("maximumModules"),
    maximumObjects: read("maximumObjects"),
    maximumObjectBytes: read("maximumObjectBytes"),
    maximumRawBytes: read("maximumRawBytes"),
    maximumHashBytes: read("maximumHashBytes"),
  }));
}

function referenceEqual(
  left: DeclarativeV2RuntimeArtifactObjectReferenceV1,
  right: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): boolean {
  return left.storeIdentity === right.storeIdentity && left.kind === right.kind &&
    left.codecIdentity === right.codecIdentity &&
    left.objectKey === right.objectKey && left.byteLength === right.byteLength &&
    bytesEqualFullScan(left.sha256, right.sha256);
}

function nullableDigestEqual(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  return left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right);
}

function functionEntryEqual(
  left: Extract<DeclarativeV2PhysicalFrameV1,
    { readonly kind: "function_group_entry" }>,
  right: DeclarativeV2FunctionGroupEntryFrameV1,
): boolean {
  return left.functionOrdinal === right.functionOrdinal &&
    left.functionPath === right.functionPath &&
    left.executionModule === right.executionModule &&
    left.exportName === right.exportName &&
    left.handlerKind === right.handlerKind &&
    left.visibility === right.visibility && left.group === right.group &&
    bytesEqualFullScan(left.projectionSha256, right.projectionSha256);
}

function projectionEqual(
  left: Extract<DeclarativeV2PhysicalFrameV1,
    { readonly kind: "runtime_projection" }>,
  right: DeclarativeV2RuntimeProjectionFrameV1,
): boolean {
  return left.group === right.group &&
    left.executionModule === right.executionModule &&
    left.moduleCount === right.moduleCount &&
    left.rawByteLength === right.rawByteLength &&
    bytesEqualFullScan(left.moduleRootSha256, right.moduleRootSha256);
}

function failure(
  reason: CandidateBoundEdgeActionRuntimeDispatchV1Error["reason"],
  path: string,
) {
  return Effect.fail(new CandidateBoundEdgeActionRuntimeDispatchV1Error({
    reason,
    path,
  }));
}

function exceeded(path: string, observed: number, maximum: number) {
  return Effect.fail(new CandidateBoundEdgeActionRuntimeDispatchV1Error({
    reason: "resourceExceeded",
    path,
    observed,
    maximum,
  }));
}
