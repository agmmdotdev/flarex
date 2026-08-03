import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Scope } from "effect";
import {
  encodeCandidateBoundMutationInternalQueryRuntimeTargetV1,
  type CandidateBoundMutationInternalQueryRuntimeTargetFrameV1,
  type CandidateBoundMutationInternalQueryRuntimeTargetV1Error,
} from "flarex-protocol/internal/candidate-bound-mutation-internal-query-runtime-target-v1";
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
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_PROFILE_V1,
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1,
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_VERSION_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_ARGUMENT_BYTES_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_CALLS_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_DEPTH_V1,
  POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_RESULT_BYTES_V1,
  type PointMutationInternalQueryExactRuntimeArtifactRefV1,
} from "flarex-protocol/point-mutation-internal-query-exact-runtime";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";
import {
  TransactionArtifactIdV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";

import {
  buildPointMutationInternalQueryExactRuntimeWorkerDefinitionV1,
  pointMutationInternalQueryExactRuntimeWorkerGraphBasisV1,
  PointMutationInternalQueryExactRuntimeHostV1Error,
  type PointMutationInternalQueryExactRuntimeWorkerDefinitionV1,
} from "./PointMutationInternalQueryExactRuntimeHost";
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
const TARGET_ENCODING_BUDGET = Object.freeze({
  maximumModules: 32_768,
  maximumCatalogEntries: 32_768,
  maximumTextBytes: 4_096,
  maximumPreimageBytes: 16 * 1_048_576,
});
const UTF8 = new TextEncoder();

export interface CandidateBoundMutationInternalQueryRuntimeTargetAuthorityV1 {
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
    readonly manifestFrame: Extract<DeclarativeV2PhysicalFrameV1,
      { readonly kind: "function_group_manifest" }>;
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
    readonly handlerKind: "mutation";
    readonly visibility: "public";
    readonly argsValidator:
      | ObjectValidatorJsonV1
      | Readonly<{ readonly type: "any" }>;
    readonly returnsValidator: ValidatorJsonV1 | null;
    readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
      readonly handlerKind: "mutation";
      readonly visibility: "public";
      readonly group: "transaction";
    };
    readonly entryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
    readonly projection: DeclarativeV2RuntimeProjectionFrameV1 & {
      readonly group: "transaction";
    };
  }>;
  readonly internalQueryCatalog: ReadonlyArray<Readonly<{
    readonly functionOrdinal: bigint;
    readonly functionPath: string;
    readonly logicalExecutionModule: string;
    readonly artifactExecutionModule: string;
    readonly exportName: string;
    readonly handlerKind: "query";
    readonly visibility: "internal";
    readonly argsValidator:
      | ObjectValidatorJsonV1
      | Readonly<{ readonly type: "any" }>;
    readonly returnsValidator: ValidatorJsonV1 | null;
    readonly entry: DeclarativeV2FunctionGroupEntryFrameV1 & {
      readonly handlerKind: "query";
      readonly visibility: "internal";
      readonly group: "transaction";
    };
    readonly entryReference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  }>>;
}

export interface CandidateBoundMutationInternalQueryRuntimeTargetAuthorityPortV1<Selection, E> {
  readonly claim: (
    selection: Selection,
    functionPath: string,
  ) => Effect.Effect<CandidateBoundMutationInternalQueryRuntimeTargetAuthorityV1, E>;
}

export interface CandidateBoundMutationInternalQueryRuntimeTargetBudgetV1 {
  readonly maximumModules: number;
  readonly maximumObjects: number;
  readonly maximumObjectBytes: number;
  readonly maximumRawBytes: number;
  readonly maximumHashBytes: number;
}

declare const queryRuntimeTargetBrand: unique symbol;
export interface CandidateBoundPointMutationInternalQueryRuntimeTargetV1 {
  readonly [queryRuntimeTargetBrand]: true;
}

export interface PreparedCandidateBoundPointMutationInternalQueryRuntimeTargetV1 {
  readonly target: CandidateBoundPointMutationInternalQueryRuntimeTargetV1;
  readonly runtimeTargetSha256: Uint8Array;
  readonly artifact: PointMutationInternalQueryExactRuntimeArtifactRefV1;
  readonly function: Readonly<{
    readonly path: string;
    readonly executionModule: string;
    readonly kind: "mutation";
    readonly visibility: "public";
    readonly argsValidator:
      | ObjectValidatorJsonV1
      | Readonly<{ readonly type: "any" }>;
    readonly returnsValidator: ValidatorJsonV1 | null;
  }>;
}

export interface ClaimedCandidateBoundPointMutationInternalQueryRuntimeTargetV1
  extends PreparedCandidateBoundPointMutationInternalQueryRuntimeTargetV1 {
  readonly canonicalTargetBytes: Uint8Array;
  readonly definition: PointMutationInternalQueryExactRuntimeWorkerDefinitionV1;
}

export class CandidateBoundMutationInternalQueryRuntimeDispatchV1Error extends Data.TaggedError(
  "CandidateBoundMutationInternalQueryRuntimeDispatchV1Error",
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

export class InvalidCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error
  extends Data.TaggedError("InvalidCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error")<{
    readonly reason: "notIssued";
  }> {}

export type PrepareCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error<E> =
  | E
  | CandidateBoundMutationInternalQueryRuntimeDispatchV1Error
  | CandidateBoundMutationInternalQueryRuntimeTargetV1Error
  | DeclarativeV2ArtifactModulePathVerdictV1Error
  | DeclarativeV2PhysicalFrameV1Error
  | DeclarativeV2RuntimeProjectionIdentityV1Error
  | DeclarativeV2RuntimeArtifactR2V1Error
  | DeclarativeV2RuntimeArtifactSha256V1Error
  | PointMutationInternalQueryExactRuntimeHostV1Error;

interface MutationTargetStateV1 {
  readonly runtimeTargetSha256: Uint8Array;
  readonly canonicalTargetBytes: Uint8Array;
  readonly artifact: PointMutationInternalQueryExactRuntimeArtifactRefV1;
  readonly function: PreparedCandidateBoundPointMutationInternalQueryRuntimeTargetV1["function"];
  readonly definition: PointMutationInternalQueryExactRuntimeWorkerDefinitionV1;
}

const targetStates = new WeakMap<CandidateBoundPointMutationInternalQueryRuntimeTargetV1,
  MutationTargetStateV1>();

export const prepareCandidateBoundPointMutationInternalQueryRuntimeTargetV1 = Effect.fn(
  "CandidateBoundMutationInternalQueryRuntimeDispatch.prepareV1",
)(function* <Selection, AuthorityError>(
  selection: Selection,
  functionPath: string,
  authorityPort: CandidateBoundMutationInternalQueryRuntimeTargetAuthorityPortV1<
    Selection,
    AuthorityError
  >,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  budgetInput: unknown,
  compatibilityDate: string,
  sha256: DeclarativeV2RuntimeArtifactSha256V1 =
    makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
): Effect.fn.Return<
  PreparedCandidateBoundPointMutationInternalQueryRuntimeTargetV1,
  PrepareCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error<AuthorityError>,
  Scope.Scope
> {
  const budget = yield* Effect.fromResult(captureBudget(budgetInput));
  const authority = yield* authorityPort.claim(selection, functionPath);
  yield* verifyAuthority(authority, functionPath, sha256, budget);
  const loaded = yield* loadSelectedProjection(authority, store, sha256, budget);
  const graphBasis = yield* Effect.try({
    try: () => pointMutationInternalQueryExactRuntimeWorkerGraphBasisV1({
      compatibilityDate,
      artifactExecutionModule: authority.function.artifactExecutionModule,
      exportName: authority.function.exportName,
      functionPath,
      internalQueryCatalog: authority.internalQueryCatalog,
    }),
    catch: cause => new PointMutationInternalQueryExactRuntimeHostV1Error({
      reason: "workerDefinitionFailed", cause,
    }),
  });
  const graphBasisSha256 = yield* sha256(UTF8.encode(graphBasis), {
    maximumInputBytes: budget.maximumHashBytes,
  });
  const encoded = yield* Effect.fromResult(
    encodeCandidateBoundMutationInternalQueryRuntimeTargetV1(
      targetFrame(authority, compatibilityDate, graphBasisSha256, budget),
      TARGET_ENCODING_BUDGET,
    ),
  );
  const runtimeTargetSha256 = yield* sha256(encoded.canonicalBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  const targetHex = encodeBytesToLowercaseHex(runtimeTargetSha256);
  const artifact = Object.freeze({
    runtime: "dynamic-worker" as const,
    artifactId: TransactionArtifactIdV1Schema.make(
      `artifact_${targetHex.slice(0, 32)}`,
    ),
    sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(targetHex),
    executionModule: TransactionExecutionModuleV1Schema.make(
      "flarexCandidateBoundMutationInternalQueryRuntimeTarget/execution-v1.js",
    ),
  });
  const functionProjection = Object.freeze({
    path: TransactionFunctionPathV1Schema.make(functionPath),
    executionModule: artifact.executionModule,
    kind: "mutation" as const,
    visibility: "public" as const,
    argsValidator: authority.function.argsValidator,
    returnsValidator: authority.function.returnsValidator,
  });
  const definition = yield* Effect.try({
    try: () => buildPointMutationInternalQueryExactRuntimeWorkerDefinitionV1({
      artifact,
      compatibilityDate,
      runtimeTargetSha256Hex: targetHex,
      function: functionProjection,
      functionPath,
      artifactExecutionModule: authority.function.artifactExecutionModule,
      exportName: authority.function.exportName,
      rootFunctionOrdinal: authority.function.functionOrdinal,
      internalQueryCatalog: authority.internalQueryCatalog,
      sourceModules: loaded.modules,
    }),
    catch: cause => new PointMutationInternalQueryExactRuntimeHostV1Error({
      reason: "workerDefinitionFailed", cause,
    }),
  });
  const state: MutationTargetStateV1 = Object.freeze({
      runtimeTargetSha256: copyBytes(runtimeTargetSha256),
      canonicalTargetBytes: copyBytes(encoded.canonicalBytes),
      artifact,
      function: functionProjection,
      definition,
    });
  const target = yield* Effect.acquireRelease(
    Effect.sync(() => issueTarget(state)),
    issued => Effect.sync(() => { targetStates.delete(issued); }),
  );
  return preparedResult(target, state);
});

export function claimCandidateBoundPointMutationInternalQueryRuntimeTargetV1(
  target: unknown,
): Result.Result<
  ClaimedCandidateBoundPointMutationInternalQueryRuntimeTargetV1,
  InvalidCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error
> {
  const state = claimState(target);
  return Result.map(state, value => Object.freeze({
    ...preparedResult(target as CandidateBoundPointMutationInternalQueryRuntimeTargetV1, value),
    canonicalTargetBytes: copyBytes(value.canonicalTargetBytes),
    definition: value.definition,
  }));
}

function issueTarget(
  state: MutationTargetStateV1,
) {
  const target = Object.freeze({}) as CandidateBoundPointMutationInternalQueryRuntimeTargetV1;
  targetStates.set(target, state);
  return target;
}

function claimState(target: unknown) {
  if (typeof target !== "object" || target === null) {
    return Result.fail(new InvalidCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error({
      reason: "notIssued",
    }));
  }
  const state = targetStates.get(target as CandidateBoundPointMutationInternalQueryRuntimeTargetV1);
  return state === undefined
    ? Result.fail(new InvalidCandidateBoundPointMutationInternalQueryRuntimeTargetV1Error({
        reason: "notIssued",
      }))
    : Result.succeed(state);
}

function preparedResult(
  target: CandidateBoundPointMutationInternalQueryRuntimeTargetV1,
  state: MutationTargetStateV1,
): PreparedCandidateBoundPointMutationInternalQueryRuntimeTargetV1 {
  return Object.freeze({
    target,
    runtimeTargetSha256: copyBytes(state.runtimeTargetSha256),
    artifact: Object.freeze({ ...state.artifact }),
    function: state.function,
  });
}

const verifyAuthority = Effect.fn(
  "CandidateBoundMutationInternalQueryRuntimeDispatch.verifyAuthorityV1",
)(function* (
  authority: CandidateBoundMutationInternalQueryRuntimeTargetAuthorityV1,
  requestedFunctionPath: string,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
  budget: CandidateBoundMutationInternalQueryRuntimeTargetBudgetV1,
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
    !bytesEqualFullScan(metadata.functionMetadataSha256, authority.functionMetadataSha256) ||
    !bytesEqualFullScan(metadata.validatorRootSha256, candidate.validatorRootSha256) ||
    !bytesEqualFullScan(metadata.declaredHandlerSetSha256, candidate.declaredHandlerSetSha256) ||
    !bytesEqualFullScan(metadata.runtimeProjectionSetSha256, candidate.runtimeProjectionSetSha256) ||
    !bytesEqualFullScan(metadata.functionGroupManifestSha256,
      candidate.functionGroupManifestSha256)
  ) return yield* failure("authorityMismatch", "activeSelection");
  const separator = authority.function.functionPath.indexOf(":");
  if (authority.function.handlerKind !== "mutation" ||
    authority.function.visibility !== "public" ||
    separator <= 0 ||
    separator !== authority.function.functionPath.lastIndexOf(":") ||
    authority.function.entry.functionOrdinal !==
      authority.function.functionOrdinal ||
    authority.function.entry.functionPath !== authority.function.functionPath ||
    authority.function.entry.executionModule !==
      authority.function.artifactExecutionModule ||
    authority.function.entry.exportName !== authority.function.exportName ||
    authority.function.entry.handlerKind !== "mutation" ||
    authority.function.entry.visibility !== "public" ||
    authority.function.entry.group !== "transaction" ||
    authority.function.projection.group !== "transaction") {
    return yield* failure("functionMismatch", "function");
  }
  let previousOrdinal = -1n;
  let previousPath = "";
  const ordinals = new Set<bigint>();
  const paths = new Set<string>();
  for (const entry of authority.internalQueryCatalog) {
    const separator = entry.functionPath.indexOf(":");
    if (entry.handlerKind !== "query" || entry.visibility !== "internal" ||
      entry.entry.handlerKind !== "query" ||
      entry.entry.visibility !== "internal" ||
      entry.entry.group !== "transaction" ||
      entry.entry.functionOrdinal !== entry.functionOrdinal ||
      entry.entry.functionPath !== entry.functionPath ||
      entry.entry.executionModule !== entry.artifactExecutionModule ||
      entry.entry.exportName !== entry.exportName || separator <= 0 ||
      separator !== entry.functionPath.lastIndexOf(":") ||
      ordinals.has(entry.functionOrdinal) || paths.has(entry.functionPath) ||
      entry.functionOrdinal < previousOrdinal ||
      (entry.functionOrdinal === previousOrdinal &&
        entry.functionPath <= previousPath)) {
      return yield* failure("functionMismatch", "internalQueryCatalog");
    }
    previousOrdinal = entry.functionOrdinal;
    previousPath = entry.functionPath;
    ordinals.add(entry.functionOrdinal);
    paths.add(entry.functionPath);
  }
});

const loadSelectedProjection = Effect.fn(
  "CandidateBoundMutationInternalQueryRuntimeDispatch.loadProjectionV1",
)(function* (
  authority: CandidateBoundMutationInternalQueryRuntimeTargetAuthorityV1,
  store: DeclarativeV2RuntimeArtifactR2StoreV1,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
  budget: CandidateBoundMutationInternalQueryRuntimeTargetBudgetV1,
) {
  const projectionAuthority = authority.publication.projections.find(
    item => item.frame.group === "transaction",
  );
  const edge = authority.publication.projections.find(
    item => item.frame.group === "edge_action",
  );
  if (projectionAuthority === undefined) {
    return yield* failure("projectionMismatch", "transaction");
  }
  const admission = objectAdmission(budget);
  const projectionSet = yield* readFrame(store,
    authority.publication.projectionSetReference, "runtime_projection_set",
    admission, "projectionSet");
  const manifest = yield* readFrame(store,
    authority.publication.manifestReference, "function_group_manifest",
    admission, "manifest");
  const entry = yield* readFrame(store, authority.function.entryReference,
    "function_group_entry", admission, "functionEntry");
  const projection = yield* readFrame(store, projectionAuthority.reference,
    "runtime_projection", admission, "projection");
  for (let index = 0; index < authority.internalQueryCatalog.length; index += 1) {
    const expected = authority.internalQueryCatalog[index]!;
    const internalEntry = yield* readFrame(
      store,
      expected.entryReference,
      "function_group_entry",
      admission,
      `internalQueryCatalog[${index}]`,
    );
    if (!functionEntryEqual(internalEntry, expected.entry) ||
      !bytesEqualFullScan(
        internalEntry.projectionSha256,
        projectionAuthority.reference.sha256,
      )) {
      return yield* failure(
        "projectionMismatch",
        `internalQueryCatalog[${index}]`,
      );
    }
  }
  const functionRootBytes = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "functionGroupEntries", null,
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
      projectionAuthority.reference.sha256) ||
    !nullableDigestEqual(projectionSet.edgeActionProjectionSha256,
      edge?.reference.sha256 ?? null) ||
    !bytesEqualFullScan(manifest.runtimeProjectionSetSha256,
      authority.publication.projectionSetReference.sha256) ||
    manifest.functionCount !== BigInt(authority.publication.functionEntries.length) ||
    !bytesEqualFullScan(manifest.functionRootSha256, functionRoot) ||
    !bytesEqualFullScan(manifest.validatorRootSha256,
      authority.candidate.validatorRootSha256) ||
    !bytesEqualFullScan(manifest.declaredHandlerSetSha256,
      authority.candidate.declaredHandlerSetSha256) ||
    !functionEntryEqual(entry, authority.function.entry) ||
    !projectionEqual(projection, projectionAuthority.frame) ||
    !bytesEqualFullScan(entry.projectionSha256, projectionAuthority.reference.sha256)
  ) return yield* failure("projectionMismatch", "publication");
  if (projectionAuthority.modules.length > budget.maximumModules) {
    return yield* exceeded("modules", projectionAuthority.modules.length,
      budget.maximumModules);
  }
  const modules: Array<Readonly<{ readonly path: string; readonly source: string }>> = [];
  const moduleDigests: Uint8Array[] = [];
  let rawBytes = 0;
  for (let index = 0; index < projectionAuthority.modules.length; index += 1) {
    const stored = projectionAuthority.modules[index]!;
    const frame = yield* readFrame(store, stored.reference,
      "runtime_projection_module", admission, `modules[${index}]`);
    if (frame.group !== "transaction" || frame.moduleOrdinal !== BigInt(index) ||
      frame.moduleOrdinal !== stored.moduleOrdinal ||
      frame.modulePath !== stored.modulePath || frame.roles !== stored.roles ||
      BigInt(frame.sourceBytes.byteLength) !== stored.sourceByteLength ||
      !bytesEqualFullScan(frame.sourceSha256, stored.sourceSha256)) {
      return yield* failure("projectionMismatch", `modules[${index}]`);
    }
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
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(frame.sourceBytes); }
    catch { return yield* failure("invalidSourceUtf8", `modules[${index}]`); }
    moduleDigests.push(stored.reference.sha256);
    modules.push(Object.freeze({ path: frame.modulePath, source }));
  }
  const moduleRootBytes = yield* Effect.fromResult(
    frameDeclarativeV2RuntimeRootSha256PreimageV1(
      "runtimeProjectionModules", "transaction", moduleDigests, ROOT_BUDGET,
    ),
  );
  const moduleRoot = yield* sha256(moduleRootBytes, {
    maximumInputBytes: budget.maximumHashBytes,
  });
  if (projection.moduleCount !== BigInt(modules.length) ||
    projection.rawByteLength !== BigInt(rawBytes) ||
    !bytesEqualFullScan(projection.moduleRootSha256, moduleRoot) ||
    !modules.some(module => module.path === authority.function.artifactExecutionModule)) {
    return yield* failure("projectionMismatch", "projection.root");
  }
  return Object.freeze({ modules: Object.freeze(modules) });
});

function targetFrame(
  authority: CandidateBoundMutationInternalQueryRuntimeTargetAuthorityV1,
  compatibilityDate: string,
  exactRuntimeGraphBasisSha256: Uint8Array,
  budget: CandidateBoundMutationInternalQueryRuntimeTargetBudgetV1,
): CandidateBoundMutationInternalQueryRuntimeTargetFrameV1 {
  const projection = authority.publication.projections.find(
    item => item.frame.group === "transaction",
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
    exactRuntimeProfile: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_PROFILE_V1,
    exactRuntimeVersion: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_VERSION_V1,
    syscallAbiIdentity: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_SYSCALL_ABI_V1,
    exactRuntimeGraphBasisSha256,
    functionOrdinal: authority.function.functionOrdinal,
    functionPath: authority.function.functionPath,
    logicalExecutionModule: authority.function.logicalExecutionModule,
    artifactExecutionModule: authority.function.artifactExecutionModule,
    projectionExecutionModule: projection.frame.executionModule,
    exportName: authority.function.exportName,
    handlerKind: "mutation",
    visibility: "public",
    group: "transaction",
    maximumInternalCalls: BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_CALLS_V1),
    maximumInternalCallDepth:
      BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_DEPTH_V1),
    maximumInternalCallArgumentBytes:
      BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_ARGUMENT_BYTES_V1),
    maximumInternalCallResultBytes:
      BigInt(POINT_MUTATION_INTERNAL_QUERY_MAXIMUM_RESULT_BYTES_V1),
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
    internalQueryCatalog: Object.freeze(authority.internalQueryCatalog.map(
      entry => Object.freeze({
        functionOrdinal: entry.functionOrdinal,
        functionPath: entry.functionPath,
        logicalExecutionModule: entry.logicalExecutionModule,
        artifactExecutionModule: entry.artifactExecutionModule,
        exportName: entry.exportName,
        handlerKind: "query" as const,
        visibility: "internal" as const,
        group: "transaction" as const,
        functionEntryReference: entry.entryReference,
      }),
    )),
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
    Effect.Effect<void, CandidateBoundMutationInternalQueryRuntimeDispatchV1Error>,
  path: string,
): Effect.Effect<
  Extract<DeclarativeV2PhysicalFrameV1, { readonly kind: K }>,
  DeclarativeV2RuntimeArtifactR2V1Error | DeclarativeV2PhysicalFrameV1Error |
    CandidateBoundMutationInternalQueryRuntimeDispatchV1Error
> {
  return store.readImmutableAdmitted(reference.kind, reference.sha256,
    admission(reference, path)).pipe(
      Effect.flatMap(object => Effect.fromResult(
        decodeDeclarativeV2PhysicalFrameV1(object.bytes, FRAME_BUDGET),
      )),
      Effect.flatMap(decoded => decoded.frame.kind === expectedKind
        ? Effect.succeed(decoded.frame as Extract<DeclarativeV2PhysicalFrameV1,
            { readonly kind: K }>)
        : failure("projectionMismatch", path)),
    );
}

function objectAdmission(budget: CandidateBoundMutationInternalQueryRuntimeTargetBudgetV1) {
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

function captureBudget(input: unknown) {
  const keys = ["maximumModules", "maximumObjects", "maximumObjectBytes",
    "maximumRawBytes", "maximumHashBytes"] as const;
  if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== keys.length ||
    keys.some(key => !isPositiveSafeInteger(input[key]))) {
    return Result.fail(new CandidateBoundMutationInternalQueryRuntimeDispatchV1Error({
      reason: "invalidBudget", path: "budget",
    }));
  }
  return Result.succeed(Object.freeze({
    maximumModules: input.maximumModules as number,
    maximumObjects: input.maximumObjects as number,
    maximumObjectBytes: input.maximumObjectBytes as number,
    maximumRawBytes: input.maximumRawBytes as number,
    maximumHashBytes: input.maximumHashBytes as number,
  }));
}

function referenceEqual(
  left: DeclarativeV2RuntimeArtifactObjectReferenceV1,
  right: DeclarativeV2RuntimeArtifactObjectReferenceV1,
) {
  return left.storeIdentity === right.storeIdentity && left.kind === right.kind &&
    left.codecIdentity === right.codecIdentity && left.objectKey === right.objectKey &&
    left.byteLength === right.byteLength && bytesEqualFullScan(left.sha256, right.sha256);
}
function nullableDigestEqual(left: Uint8Array | null, right: Uint8Array | null) {
  return left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right);
}
function functionEntryEqual(
  left: Extract<DeclarativeV2PhysicalFrameV1, { readonly kind: "function_group_entry" }>,
  right: DeclarativeV2FunctionGroupEntryFrameV1,
) {
  return left.functionOrdinal === right.functionOrdinal &&
    left.functionPath === right.functionPath &&
    left.executionModule === right.executionModule &&
    left.exportName === right.exportName && left.handlerKind === right.handlerKind &&
    left.visibility === right.visibility && left.group === right.group &&
    bytesEqualFullScan(left.projectionSha256, right.projectionSha256);
}
function projectionEqual(
  left: Extract<DeclarativeV2PhysicalFrameV1, { readonly kind: "runtime_projection" }>,
  right: DeclarativeV2RuntimeProjectionFrameV1,
) {
  return left.group === right.group && left.executionModule === right.executionModule &&
    left.moduleCount === right.moduleCount && left.rawByteLength === right.rawByteLength &&
    bytesEqualFullScan(left.moduleRootSha256, right.moduleRootSha256);
}
function failure(reason: CandidateBoundMutationInternalQueryRuntimeDispatchV1Error["reason"], path: string) {
  return Effect.fail(new CandidateBoundMutationInternalQueryRuntimeDispatchV1Error({ reason, path }));
}
function exceeded(path: string, observed: number, maximum: number) {
  return Effect.fail(new CandidateBoundMutationInternalQueryRuntimeDispatchV1Error({
    reason: "resourceExceeded", path, observed, maximum,
  }));
}
