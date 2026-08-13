import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type ApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import type { ApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import { encodeCanonicalJson, isJson, type Json } from "flarex-protocol/json";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  applicationRuntimeTargetFromPublication,
  type ApplicationRuntimeTargetPublication,
  type ApplicationPublicationFunction,
} from "./applicationPublication";

const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const UTF8 = new TextEncoder();
const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_PUBLICATION_FRAME_BYTES = 1_048_576;
const MAX_READINESS_BYTES = 16_777_216;
const MAX_ACTIVATION_BYTES = 1_048_576;
const MAX_READINESS_FUNCTIONS = 1_024;

export interface ApplicationMutationCommitAuthorityGraphSnapshot {
  readonly authorityBytes: Uint8Array;
  readonly deploymentId: string;
  readonly scope: Readonly<{
    readonly scopeId: ScopeId;
    readonly storageGeneration: "flarexdb_v1";
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  }>;
  readonly candidate: Readonly<{
    readonly scopeId: ScopeId;
    readonly candidateId: string;
    readonly sourceArtifactRootSha256: Uint8Array;
    readonly storageGeneration: "flarexdb_v1";
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  }>;
  readonly analysis: Readonly<{
    readonly scopeId: ScopeId;
    readonly analysisId: string;
    readonly candidateId: string;
    readonly sourceArtifactRootSha256: Uint8Array;
    readonly status: "analyzed";
    readonly manifestSha256: Uint8Array;
    readonly manifestBytes: Uint8Array;
  }>;
  readonly revision: Readonly<{
    readonly scopeId: ScopeId;
    readonly revisionId: string;
    readonly candidateId: string;
    readonly analysisId: string;
    readonly sourceArtifactRootSha256: Uint8Array;
    readonly manifestSha256: Uint8Array;
    readonly status: "inactive";
  }>;
  readonly publication: Readonly<{
    readonly scopeId: ScopeId;
    readonly revisionId: string;
    readonly candidateId: string;
    readonly analysisId: string;
    readonly sourceArtifactRootSha256: Uint8Array;
    readonly manifestSha256: Uint8Array;
    readonly schemaSha256: Uint8Array;
    readonly schemaBytes: Uint8Array;
    readonly functionCatalogSha256: Uint8Array;
    readonly functionCatalogBytes: Uint8Array;
    readonly publicationSha256: Uint8Array;
  }>;
  readonly selectedFunction: Readonly<{
    readonly scopeId: ScopeId;
    readonly revisionId: string;
    readonly functionPath: string;
    readonly functionCatalogSha256: Uint8Array;
    readonly entrySha256: Uint8Array;
    readonly entryBytes: Uint8Array;
  }>;
  readonly schema: Readonly<{
    readonly scopeId: ScopeId;
    readonly revisionId: string;
    readonly deploymentId: string;
    readonly applicationSchemaSha256: Uint8Array;
    readonly schemaVersionId: string;
    readonly schemaManifestSha256: Uint8Array;
    readonly schemaBindingSha256: Uint8Array;
  }>;
  readonly readiness: Readonly<{
    readonly scopeId: ScopeId;
    readonly revisionId: string;
    readonly deploymentId: string;
    readonly candidateId: string;
    readonly analysisId: string;
    readonly sourceArtifactRootSha256: Uint8Array;
    readonly manifestSha256: Uint8Array;
    readonly publicationSha256: Uint8Array;
    readonly applicationSchemaSha256: Uint8Array;
    readonly functionCatalogSha256: Uint8Array;
    readonly storageGeneration: "flarexdb_v1";
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
    readonly schemaVersionId: string;
    readonly schemaManifestSha256: Uint8Array;
    readonly schemaBindingSha256: Uint8Array;
    readonly taskCatalogBindingSha256: Uint8Array;
    readonly runtimeHostIdentity: string;
    readonly compatibilityDate: string;
    readonly coldReceiptSetSha256: Uint8Array;
    readonly candidateValidationReceiptSha256: Uint8Array;
    readonly uniqueConstraintStatus: "not_required" | "eligible";
    readonly uniqueConstraintEligibilitySha256: Uint8Array;
    readonly physicalReadinessSha256: Uint8Array;
    readonly readinessSha256: Uint8Array;
    readonly readinessBytes: Uint8Array;
    readonly readyAt: string;
    readonly functions: ReadonlyArray<Readonly<{
      readonly scopeId: ScopeId;
      readonly revisionId: string;
      readonly readinessSha256: Uint8Array;
      readonly functionPath: string;
      readonly runtimeTargetSha256: Uint8Array;
      readonly coldReceiptSha256: Uint8Array;
    }>>;
  }>;
  readonly activation: Readonly<{
    readonly scopeId: ScopeId;
    readonly revisionId: string;
    readonly activationSequence: bigint;
    readonly previousActivationSequence: bigint | null;
    readonly readinessSha256: Uint8Array;
    readonly activationRequestSha256: Uint8Array;
    readonly activationSha256: Uint8Array;
    readonly activationBytes: Uint8Array;
    readonly activatedAt: string;
  }>;
}

export interface ApplicationMutationCommitAuthorityGraphEvidence {
  readonly authority: ApplicationMutationExecutionAuthorityV1;
  readonly manifest: ApplicationManifestV1;
  readonly runtimeTarget: ApplicationRuntimeTargetV1 & Readonly<{
    readonly function: ApplicationRuntimeTargetV1["function"] & Readonly<{
      readonly kind: "mutation";
      readonly visibility: "public";
    }>;
  }>;
  readonly compatibilityDate: string;
  readonly readinessSha256: string;
  readonly activationSha256: string;
}

interface StoredApplicationMutationCommitAuthorityGraphEvidence {
  readonly authority: ApplicationMutationExecutionAuthorityV1;
  readonly manifest: ApplicationManifestV1;
  readonly runtimeTarget: ApplicationMutationCommitAuthorityGraphEvidence["runtimeTarget"];
  readonly compatibilityDate: string;
  readonly readinessSha256: string;
  readonly activationSha256: string;
}

declare const applicationMutationCommitAuthorityGraphBrand: unique symbol;
export interface AuthenticatedApplicationMutationCommitAuthorityGraph {
  readonly [applicationMutationCommitAuthorityGraphBrand]: true;
}

export class ApplicationMutationCommitAuthorityGraphError extends Data.TaggedError(
  "ApplicationMutationCommitAuthorityGraphError",
)<{
  readonly reason:
    | "invalidInput"
    | "authorityMismatch"
    | "candidateMismatch"
    | "analysisMismatch"
    | "revisionMismatch"
    | "publicationMismatch"
    | "functionMismatch"
    | "schemaMismatch"
    | "readinessMismatch"
    | "activationMismatch";
  readonly field?: string;
  readonly cause?: unknown;
}> {}

export class InvalidApplicationMutationCommitAuthorityGraphError extends Error {
  readonly name = "InvalidApplicationMutationCommitAuthorityGraphError";
}

const states = new WeakMap<
  AuthenticatedApplicationMutationCommitAuthorityGraph,
  StoredApplicationMutationCommitAuthorityGraphEvidence
>();

export function verifyApplicationMutationCommitAuthorityGraph(
  input: ApplicationMutationCommitAuthorityGraphSnapshot,
): Effect.Effect<
  AuthenticatedApplicationMutationCommitAuthorityGraph,
  ApplicationMutationCommitAuthorityGraphError
> {
  return Effect.fromResult(Result.try({
    try: () => {
      preflightSnapshot(input);
      return copySnapshot(input);
    },
    catch: cause => failure("invalidInput", "snapshot", cause),
  })).pipe(Effect.flatMap(verifyCapturedGraph));
}

const verifyCapturedGraph = Effect.fn(
  "ApplicationMutationCommitAuthorityGraph.verify",
)(function* (
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
): Effect.fn.Return<
  AuthenticatedApplicationMutationCommitAuthorityGraph,
  ApplicationMutationCommitAuthorityGraphError
> {
    const authorityJson = yield* decodeCanonicalJson(
      snapshot.authorityBytes,
      131_072,
      "authorityMismatch",
      "authorityBytes",
    );
    const canonicalAuthority = yield* canonicalizeApplicationMutationExecutionAuthorityV1(
      authorityJson,
    ).pipe(Effect.mapError(cause => failure(
      "authorityMismatch",
      "authorityBytes",
      cause,
    )));
    if (!bytesEqualFullScan(
      canonicalAuthority.canonicalBytes,
      snapshot.authorityBytes,
    )) return yield* fail("authorityMismatch", "authorityBytes");
    const authority = canonicalAuthority.authority;
    const target = authority.runtimeTarget;
    if (
      target.scopeId !== snapshot.scope.scopeId ||
      authority.schemaVersionId !== snapshot.schema.schemaVersionId ||
      target.function.path !== snapshot.selectedFunction.functionPath
    ) return yield* fail("authorityMismatch", "runtimeTarget");

    yield* Effect.fromResult(requireExactScope(snapshot));
    yield* Effect.fromResult(requireExactCandidate(snapshot, target));

    const manifestJson = yield* decodeCanonicalJson(
      snapshot.analysis.manifestBytes,
      MAX_MANIFEST_BYTES,
      "analysisMismatch",
      "manifestBytes",
    );
    const canonicalManifest = yield* Effect.fromResult(
      canonicalizeApplicationManifestV1(manifestJson).pipe(
        Result.mapError(cause => failure(
          "analysisMismatch",
          "manifestBytes",
          cause,
        )),
      ),
    );
    if (!bytesEqualFullScan(
      canonicalManifest.canonicalBytes,
      snapshot.analysis.manifestBytes,
    )) return yield* fail("analysisMismatch", "manifestBytes");
    const manifestSha256 = yield* sha256(canonicalManifest.canonicalBytes);
    yield* Effect.fromResult(requireExactAnalysis(
      snapshot,
      target,
      manifestSha256,
    ));
    yield* Effect.fromResult(requireExactRevision(
      snapshot,
      target,
      manifestSha256,
    ));

    const selectedFunction = yield* verifyFunction(
      snapshot,
      canonicalManifest.manifest,
    );
    const publication = yield* verifyPublication(
      snapshot,
      canonicalManifest.manifest,
      manifestSha256,
      selectedFunction,
      target,
    );
    const canonicalTarget = yield* Effect.fromResult(
      applicationRuntimeTargetFromPublication(
        publication,
        selectedFunction.path,
      ).pipe(Result.mapError(cause => failure(
        "functionMismatch",
        "runtimeTarget",
        cause,
      ))),
    );
    if (!runtimeTargetMatches(canonicalTarget.target, target)) {
      return yield* fail("functionMismatch", "runtimeTarget");
    }
    yield* Effect.fromResult(requireExactSchema(snapshot, authority, target));
    yield* verifyReadiness(
      snapshot,
      canonicalManifest.manifest,
      canonicalTarget.canonicalBytes,
    );
    const activationSha256 = yield* verifyActivation(snapshot, authority);

    if (!isPublicMutationRuntimeTarget(canonicalTarget.target)) {
      return yield* fail("functionMismatch", "runtimeTarget");
    }
    const evidence = Object.freeze({
      authority,
      manifest: canonicalManifest.manifest,
      runtimeTarget: canonicalTarget.target,
      compatibilityDate: snapshot.readiness.compatibilityDate,
      readinessSha256: encodeBytesToLowercaseHex(
        snapshot.readiness.readinessSha256,
      ),
      activationSha256: encodeBytesToLowercaseHex(activationSha256),
    });
    const capability = Object.freeze({}) as
      AuthenticatedApplicationMutationCommitAuthorityGraph;
    states.set(capability, evidence);
    return capability;
  });

export function inspectApplicationMutationCommitAuthorityGraph(
  value: unknown,
): ApplicationMutationCommitAuthorityGraphEvidence {
  if (typeof value !== "object" || value === null) {
    throw new InvalidApplicationMutationCommitAuthorityGraphError();
  }
  const evidence = states.get(
    value as AuthenticatedApplicationMutationCommitAuthorityGraph,
  );
  if (evidence === undefined) {
    throw new InvalidApplicationMutationCommitAuthorityGraphError();
  }
  return copyEvidence(evidence);
}

function requireExactScope(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
): Result.Result<void, ApplicationMutationCommitAuthorityGraphError> {
  return (
    snapshot.candidate.scopeId !== snapshot.scope.scopeId ||
    snapshot.candidate.storageGeneration !== snapshot.scope.storageGeneration ||
    snapshot.candidate.storageGenerationFence !==
      snapshot.scope.storageGenerationFence ||
    snapshot.candidate.epoch !== snapshot.scope.epoch
  ) ? Result.fail(failure("candidateMismatch", "scopeAuthority"))
    : Result.succeed(undefined);
}

function requireExactCandidate(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  target: ApplicationRuntimeTargetV1,
): Result.Result<void, ApplicationMutationCommitAuthorityGraphError> {
  return (
    snapshot.analysis.scopeId !== snapshot.scope.scopeId ||
    snapshot.candidate.candidateId !== target.candidateId ||
    encodeBytesToLowercaseHex(snapshot.candidate.sourceArtifactRootSha256) !==
      target.sourceArtifactRootSha256
  ) ? Result.fail(failure("candidateMismatch")) : Result.succeed(undefined);
}

function requireExactAnalysis(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  target: ApplicationRuntimeTargetV1,
  manifestSha256: Uint8Array,
): Result.Result<void, ApplicationMutationCommitAuthorityGraphError> {
  return (
    snapshot.revision.scopeId !== snapshot.scope.scopeId ||
    snapshot.analysis.status !== "analyzed" ||
    snapshot.analysis.analysisId !== target.analysisId ||
    snapshot.analysis.candidateId !== target.candidateId ||
    !bytesEqualFullScan(
      snapshot.analysis.sourceArtifactRootSha256,
      snapshot.candidate.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(snapshot.analysis.manifestSha256, manifestSha256) ||
    encodeBytesToLowercaseHex(manifestSha256) !== target.manifestSha256
  ) ? Result.fail(failure("analysisMismatch")) : Result.succeed(undefined);
}

function requireExactRevision(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  target: ApplicationRuntimeTargetV1,
  manifestSha256: Uint8Array,
): Result.Result<void, ApplicationMutationCommitAuthorityGraphError> {
  return (
    snapshot.revision.status !== "inactive" ||
    snapshot.revision.revisionId !== target.revisionId ||
    snapshot.revision.candidateId !== target.candidateId ||
    snapshot.revision.analysisId !== target.analysisId ||
    !bytesEqualFullScan(
      snapshot.revision.sourceArtifactRootSha256,
      snapshot.candidate.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(snapshot.revision.manifestSha256, manifestSha256)
  ) ? Result.fail(failure("revisionMismatch")) : Result.succeed(undefined);
}

function verifyPublication(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  manifest: ApplicationManifestV1,
  manifestSha256: Uint8Array,
  selectedFunction: ApplicationPublicationFunction,
  runtime: ApplicationRuntimeTargetV1,
): Effect.Effect<
  ApplicationRuntimeTargetPublication,
  ApplicationMutationCommitAuthorityGraphError
> {
  return Effect.gen(function* () {
    const publication = snapshot.publication;
    if (
      publication.scopeId !== snapshot.scope.scopeId ||
      publication.revisionId !== runtime.revisionId ||
      publication.candidateId !== runtime.candidateId ||
      publication.analysisId !== runtime.analysisId ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        snapshot.candidate.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(publication.manifestSha256, manifestSha256)
    ) return yield* fail("publicationMismatch");
    const schemaBytes = yield* frame(
      applicationSchemaPublicationFrameV1(manifest),
      "publicationMismatch",
      "schemaBytes",
    );
    const catalogBytes = yield* frame(
      applicationFunctionCatalogPublicationFrameV1(manifest),
      "publicationMismatch",
      "functionCatalogBytes",
    );
    const schemaSha256 = yield* sha256(schemaBytes);
    const catalogSha256 = yield* sha256(catalogBytes);
    const publicationBytes = yield* frame(
      applicationPublicationCommitmentFrameV1({
        scopeId: snapshot.scope.scopeId,
        revisionId: snapshot.revision.revisionId,
        candidateId: snapshot.revision.candidateId,
        analysisId: snapshot.revision.analysisId,
        sourceArtifactRootSha256: runtime.sourceArtifactRootSha256,
        manifestSha256: runtime.manifestSha256,
        schemaSha256: encodeBytesToLowercaseHex(schemaSha256),
        functionCatalogSha256: encodeBytesToLowercaseHex(catalogSha256),
      }),
      "publicationMismatch",
      "publicationSha256",
    );
    const publicationSha256 = yield* sha256(publicationBytes);
    if (
      snapshot.selectedFunction.scopeId !== snapshot.scope.scopeId ||
      snapshot.selectedFunction.revisionId !== snapshot.revision.revisionId ||
      !bytesEqualFullScan(publication.schemaBytes, schemaBytes) ||
      !bytesEqualFullScan(publication.schemaSha256, schemaSha256) ||
      !bytesEqualFullScan(publication.functionCatalogBytes, catalogBytes) ||
      !bytesEqualFullScan(publication.functionCatalogSha256, catalogSha256) ||
      !bytesEqualFullScan(publication.publicationSha256, publicationSha256) ||
      encodeBytesToLowercaseHex(schemaSha256) !== runtime.schemaSha256 ||
      encodeBytesToLowercaseHex(catalogSha256) !==
        runtime.functionCatalogSha256 ||
      encodeBytesToLowercaseHex(publicationSha256) !==
        runtime.publicationSha256
    ) return yield* fail("publicationMismatch");
    return Object.freeze({
      scopeId: snapshot.scope.scopeId,
      revisionId: runtime.revisionId,
      candidateId: runtime.candidateId,
      analysisId: runtime.analysisId,
      sourceArtifactRootSha256: runtime.sourceArtifactRootSha256,
      manifestSha256: runtime.manifestSha256,
      schemaSha256: runtime.schemaSha256,
      functionCatalogSha256: runtime.functionCatalogSha256,
      publicationSha256: runtime.publicationSha256,
      executionModulePath: manifest.sourceArtifact.executionModulePath,
      functions: Object.freeze([selectedFunction]),
    });
  });
}

function verifyFunction(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  manifest: ApplicationManifestV1,
): Effect.Effect<ApplicationPublicationFunction, ApplicationMutationCommitAuthorityGraphError> {
  return Effect.gen(function* () {
    const fn = manifest.functions.find(
      candidate => candidate.path === snapshot.selectedFunction.functionPath,
    );
    if (fn === undefined || fn.kind !== "mutation" || fn.visibility !== "public") {
      return yield* fail("functionMismatch");
    }
    const entryBytes = yield* frame(
      applicationFunctionEntryPublicationFrameV1(fn),
      "functionMismatch",
      "entryBytes",
    );
    const entrySha256 = yield* sha256(entryBytes);
    if (
      !bytesEqualFullScan(
        snapshot.selectedFunction.functionCatalogSha256,
        snapshot.publication.functionCatalogSha256,
      ) ||
      !bytesEqualFullScan(snapshot.selectedFunction.entryBytes, entryBytes) ||
      !bytesEqualFullScan(snapshot.selectedFunction.entrySha256, entrySha256)
    ) return yield* fail("functionMismatch");
    const selected = Object.freeze({
      ...fn,
      kind: "mutation" as const,
      visibility: "public" as const,
      entrySha256: encodeBytesToLowercaseHex(entrySha256),
    });
    return selected;
  });
}

function requireExactSchema(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  authority: ApplicationMutationExecutionAuthorityV1,
  target: ApplicationRuntimeTargetV1,
): Result.Result<void, ApplicationMutationCommitAuthorityGraphError> {
  return (
    snapshot.schema.scopeId !== snapshot.scope.scopeId ||
    snapshot.schema.revisionId !== snapshot.revision.revisionId ||
    snapshot.schema.deploymentId !== snapshot.deploymentId ||
    snapshot.schema.schemaVersionId !== authority.schemaVersionId ||
    !bytesEqualFullScan(
      snapshot.schema.applicationSchemaSha256,
      snapshot.publication.schemaSha256,
    ) ||
    snapshot.readiness.schemaVersionId !== snapshot.schema.schemaVersionId ||
    !bytesEqualFullScan(
      snapshot.readiness.applicationSchemaSha256,
      snapshot.schema.applicationSchemaSha256,
    ) ||
    !bytesEqualFullScan(
      snapshot.readiness.schemaManifestSha256,
      snapshot.schema.schemaManifestSha256,
    ) ||
    !bytesEqualFullScan(
      snapshot.readiness.schemaBindingSha256,
      snapshot.schema.schemaBindingSha256,
    ) ||
    encodeBytesToLowercaseHex(snapshot.schema.applicationSchemaSha256) !==
      target.schemaSha256 ||
    snapshot.schema.schemaBindingSha256.byteLength !== 32 ||
    snapshot.schema.schemaManifestSha256.byteLength !== 32
  ) ? Result.fail(failure("schemaMismatch")) : Result.succeed(undefined);
}

function verifyReadiness(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  manifest: ApplicationManifestV1,
  runtimeTargetBytes: Uint8Array,
): Effect.Effect<void, ApplicationMutationCommitAuthorityGraphError> {
  return Effect.gen(function* () {
    const row = snapshot.readiness;
    if (
      row.functions.length > MAX_READINESS_FUNCTIONS ||
      row.readinessBytes.byteLength < 1 ||
      row.readinessBytes.byteLength > MAX_READINESS_BYTES
    ) {
      return yield* fail("readinessMismatch", "functions");
    }
    if (row.functions.some(child =>
      child.scopeId !== row.scopeId ||
      child.revisionId !== row.revisionId ||
      !bytesEqualFullScan(child.readinessSha256, row.readinessSha256)
    )) return yield* fail("readinessMismatch", "functions");
    const runtimeTargetSha256 = yield* sha256(runtimeTargetBytes);
    const selected = row.functions.filter(
      child => child.functionPath === snapshot.selectedFunction.functionPath,
    );
    if (
      selected.length !== 1 ||
      !bytesEqualFullScan(selected[0]!.runtimeTargetSha256, runtimeTargetSha256)
    ) return yield* fail("readinessMismatch", "runtimeTargetSha256");
    const children = new Map(
      row.functions.map(child => [child.functionPath, child] as const),
    );
    if (
      children.size !== row.functions.length ||
      children.size !== manifest.functions.length ||
      manifest.functions.some(fn => !children.has(fn.path))
    ) return yield* fail("readinessMismatch", "functions");
    const expected: Json = {
      format: "flarex.application-readiness",
      version: 1,
      status: "ready",
      scopeId: snapshot.scope.scopeId,
      deploymentId: row.deploymentId,
      revisionId: snapshot.revision.revisionId,
      candidateId: row.candidateId,
      analysisId: row.analysisId,
      storageGeneration: row.storageGeneration,
      storageGenerationFence: row.storageGenerationFence.toString(),
      epoch: row.epoch,
      sourceArtifactRootSha256: hex(row.sourceArtifactRootSha256),
      manifestSha256: hex(row.manifestSha256),
      publicationSha256: hex(row.publicationSha256),
      applicationSchemaSha256: hex(row.applicationSchemaSha256),
      functionCatalogSha256: hex(row.functionCatalogSha256),
      schemaVersionId: row.schemaVersionId,
      schemaManifestSha256: hex(row.schemaManifestSha256),
      schemaBindingSha256: hex(row.schemaBindingSha256),
      taskCatalogBindingSha256: hex(row.taskCatalogBindingSha256),
      runtimeHostIdentity: row.runtimeHostIdentity,
      compatibilityDate: row.compatibilityDate,
      coldReceiptSetSha256: hex(row.coldReceiptSetSha256),
      candidateValidationReceiptSha256:
        hex(row.candidateValidationReceiptSha256),
      uniqueConstraintStatus: row.uniqueConstraintStatus,
      uniqueConstraintEligibilitySha256:
        hex(row.uniqueConstraintEligibilitySha256),
      physicalReadinessSha256: hex(row.physicalReadinessSha256),
      coldReceipts: manifest.functions.map(fn => {
        const child = children.get(fn.path)!;
        return {
          functionPath: child.functionPath,
          runtimeTargetSha256: hex(child.runtimeTargetSha256),
          coldReceiptSha256: hex(child.coldReceiptSha256),
        };
      }),
      readyAt: row.readyAt,
    };
    const bytes = canonicalBytes(expected);
    const digest = yield* sha256(bytes);
    if (
      row.scopeId !== snapshot.scope.scopeId ||
      row.revisionId !== snapshot.revision.revisionId ||
      row.deploymentId !== snapshot.deploymentId ||
      row.candidateId !== snapshot.revision.candidateId ||
      row.analysisId !== snapshot.revision.analysisId ||
      row.storageGeneration !== snapshot.scope.storageGeneration ||
      row.storageGenerationFence !== snapshot.scope.storageGenerationFence ||
      row.epoch !== snapshot.scope.epoch ||
      row.schemaVersionId !== snapshot.schema.schemaVersionId ||
      !bytesEqualFullScan(row.sourceArtifactRootSha256,
        snapshot.revision.sourceArtifactRootSha256) ||
      !bytesEqualFullScan(row.manifestSha256,
        snapshot.revision.manifestSha256) ||
      !bytesEqualFullScan(row.publicationSha256,
        snapshot.publication.publicationSha256) ||
      !bytesEqualFullScan(row.applicationSchemaSha256,
        snapshot.schema.applicationSchemaSha256) ||
      !bytesEqualFullScan(row.functionCatalogSha256,
        snapshot.publication.functionCatalogSha256) ||
      !bytesEqualFullScan(row.schemaManifestSha256,
        snapshot.schema.schemaManifestSha256) ||
      !bytesEqualFullScan(row.schemaBindingSha256,
        snapshot.schema.schemaBindingSha256) ||
      !bytesEqualFullScan(row.readinessBytes, bytes) ||
      !bytesEqualFullScan(row.readinessSha256, digest)
    ) return yield* fail("readinessMismatch");
  });
}

function verifyActivation(
  snapshot: ApplicationMutationCommitAuthorityGraphSnapshot,
  authority: ApplicationMutationExecutionAuthorityV1,
): Effect.Effect<Uint8Array, ApplicationMutationCommitAuthorityGraphError> {
  return Effect.gen(function* () {
    const row = snapshot.activation;
    if (
      row.activationBytes.byteLength < 1 ||
      row.activationBytes.byteLength > MAX_ACTIVATION_BYTES
    ) return yield* fail("activationMismatch", "activationBytes");
    const activationBytes = canonicalBytes({
      format: "flarex.application-activation",
      version: 1,
      scopeId: snapshot.scope.scopeId,
      activationSequence: row.activationSequence.toString(),
      previousActivationSequence:
        row.previousActivationSequence?.toString() ?? null,
      revisionId: snapshot.revision.revisionId,
      readinessSha256: hex(row.readinessSha256),
      activationRequestSha256: hex(row.activationRequestSha256),
      activatedAt: row.activatedAt,
    });
    const activationSha256 = yield* sha256(activationBytes);
    const headBytes = canonicalBytes({
      format: "flarex.application-active-head",
      version: 1,
      scopeId: snapshot.scope.scopeId,
      activationSequence: row.activationSequence.toString(),
      revisionId: snapshot.revision.revisionId,
      readinessSha256: hex(row.readinessSha256),
      activationSha256: hex(activationSha256),
    });
    const headSha256 = yield* sha256(headBytes);
    if (
      row.scopeId !== snapshot.scope.scopeId ||
      row.revisionId !== snapshot.revision.revisionId ||
      row.activationSequence.toString() !== authority.activationSequence ||
      !bytesEqualFullScan(row.readinessSha256,
        snapshot.readiness.readinessSha256) ||
      !bytesEqualFullScan(row.activationBytes, activationBytes) ||
      !bytesEqualFullScan(row.activationSha256, activationSha256) ||
      hex(headSha256) !== authority.activeHeadSha256
    ) return yield* fail("activationMismatch");
    return activationSha256;
  });
}

function runtimeTargetMatches(
  left: ApplicationRuntimeTargetV1,
  right: ApplicationRuntimeTargetV1,
): boolean {
  return encodeCanonicalJson(left, invariant) ===
    encodeCanonicalJson(right, invariant);
}

function isPublicMutationRuntimeTarget(
  target: ApplicationRuntimeTargetV1,
): target is ApplicationMutationCommitAuthorityGraphEvidence["runtimeTarget"] {
  return target.function.kind === "mutation" &&
    target.function.visibility === "public";
}

function canonicalBytes(value: Json): Uint8Array {
  return UTF8.encode(encodeCanonicalJson(value, invariant));
}

function invariant(issue: { readonly reason: string }): never {
  throw new Error(`Application graph invariant: ${issue.reason}`);
}

function decodeCanonicalJson(
  bytes: Uint8Array,
  maximum: number,
  reason: ApplicationMutationCommitAuthorityGraphError["reason"],
  field: string,
): Effect.Effect<Json, ApplicationMutationCommitAuthorityGraphError> {
  if (bytes.byteLength < 1 || bytes.byteLength > maximum) {
    return fail(reason, field);
  }
  return Effect.try({
    try: () => {
      const value: unknown = JSON.parse(UTF8_FATAL.decode(bytes));
      if (!isJson(value)) throw new Error("Expected JSON.");
      if (!bytesEqualFullScan(canonicalBytes(value), bytes)) {
        throw new Error("Expected canonical JSON bytes.");
      }
      return value;
    },
    catch: cause => failure(reason, field, cause),
  });
}

function frame(
  result: Result.Result<Uint8Array, unknown>,
  reason: ApplicationMutationCommitAuthorityGraphError["reason"],
  field: string,
): Effect.Effect<Uint8Array, ApplicationMutationCommitAuthorityGraphError> {
  return Effect.fromResult(result.pipe(Result.mapError(cause =>
    failure(reason, field, cause)
  ))).pipe(Effect.flatMap(bytes =>
    bytes.byteLength <= MAX_PUBLICATION_FRAME_BYTES
      ? Effect.succeed(bytes)
      : fail(reason, field)
  ));
}

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.promise(async () => {
    const digest = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ));
    if (digest.byteLength !== 32) {
      throw new Error("SHA-256 returned a non-32-byte digest.");
    }
    return digest;
  });
}

function hex(bytes: Uint8Array): string {
  return encodeBytesToLowercaseHex(bytes);
}

function fail(
  reason: ApplicationMutationCommitAuthorityGraphError["reason"],
  field?: string,
): Effect.Effect<never, ApplicationMutationCommitAuthorityGraphError> {
  return Effect.fail(failure(reason, field));
}

function failure(
  reason: ApplicationMutationCommitAuthorityGraphError["reason"],
  field?: string,
  cause?: unknown,
): ApplicationMutationCommitAuthorityGraphError {
  return new ApplicationMutationCommitAuthorityGraphError({
    reason,
    ...(field === undefined ? {} : { field }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function copySnapshot(
  input: ApplicationMutationCommitAuthorityGraphSnapshot,
): ApplicationMutationCommitAuthorityGraphSnapshot {
  return Object.freeze({
    ...input,
    authorityBytes: copyBytes(input.authorityBytes),
    scope: Object.freeze({ ...input.scope }),
    candidate: copyByteRecord(input.candidate, ["sourceArtifactRootSha256"]),
    analysis: copyByteRecord(input.analysis, [
      "sourceArtifactRootSha256", "manifestSha256", "manifestBytes",
    ]),
    revision: copyByteRecord(input.revision, [
      "sourceArtifactRootSha256", "manifestSha256",
    ]),
    publication: copyByteRecord(input.publication, [
      "sourceArtifactRootSha256", "manifestSha256", "schemaSha256",
      "schemaBytes", "functionCatalogSha256", "functionCatalogBytes",
      "publicationSha256",
    ]),
    selectedFunction: copyByteRecord(input.selectedFunction, [
      "functionCatalogSha256", "entrySha256", "entryBytes",
    ]),
    schema: copyByteRecord(input.schema, [
      "applicationSchemaSha256", "schemaManifestSha256",
      "schemaBindingSha256",
    ]),
    readiness: Object.freeze({
      ...copyByteRecord(input.readiness, [
        "sourceArtifactRootSha256", "manifestSha256", "publicationSha256",
        "applicationSchemaSha256", "functionCatalogSha256",
        "schemaManifestSha256", "schemaBindingSha256",
        "taskCatalogBindingSha256", "coldReceiptSetSha256",
        "candidateValidationReceiptSha256", "uniqueConstraintEligibilitySha256",
        "physicalReadinessSha256", "readinessSha256", "readinessBytes",
      ]),
      functions: Object.freeze(input.readiness.functions.map(child =>
        copyByteRecord(child, [
          "readinessSha256", "runtimeTargetSha256", "coldReceiptSha256",
        ])
      )),
    }),
    activation: copyByteRecord(input.activation, [
      "readinessSha256", "activationRequestSha256", "activationSha256",
      "activationBytes",
    ]),
  });
}

function preflightSnapshot(
  input: ApplicationMutationCommitAuthorityGraphSnapshot,
): void {
  const bounded = (value: string, maximum = 4_096): boolean =>
    value.length > 0 && value.length <= maximum;
  const bytes = (
    value: Uint8Array,
    maximum: number,
    minimum = 1,
  ): boolean => {
    const length = uint8ArrayByteLength(value);
    return length !== undefined && length >= minimum && length <= maximum;
  };
  const digest = (value: Uint8Array): boolean => bytes(value, 32, 32);
  const identities = [
    input.deploymentId,
    input.scope.scopeId,
    input.scope.epoch,
    input.candidate.scopeId,
    input.candidate.candidateId,
    input.candidate.epoch,
    input.analysis.scopeId,
    input.analysis.analysisId,
    input.analysis.candidateId,
    input.revision.scopeId,
    input.revision.revisionId,
    input.revision.candidateId,
    input.revision.analysisId,
    input.publication.scopeId,
    input.publication.revisionId,
    input.publication.candidateId,
    input.publication.analysisId,
    input.selectedFunction.scopeId,
    input.selectedFunction.revisionId,
    input.selectedFunction.functionPath,
    input.schema.scopeId,
    input.schema.revisionId,
    input.schema.deploymentId,
    input.schema.schemaVersionId,
    input.readiness.scopeId,
    input.readiness.revisionId,
    input.readiness.deploymentId,
    input.readiness.candidateId,
    input.readiness.analysisId,
    input.readiness.epoch,
    input.readiness.schemaVersionId,
    input.readiness.runtimeHostIdentity,
    input.readiness.compatibilityDate,
    input.readiness.readyAt,
    input.activation.scopeId,
    input.activation.revisionId,
    input.activation.activatedAt,
  ];
  const fixedDigests = [
    input.candidate.sourceArtifactRootSha256,
    input.analysis.sourceArtifactRootSha256,
    input.analysis.manifestSha256,
    input.revision.sourceArtifactRootSha256,
    input.revision.manifestSha256,
    input.publication.sourceArtifactRootSha256,
    input.publication.manifestSha256,
    input.publication.schemaSha256,
    input.publication.functionCatalogSha256,
    input.publication.publicationSha256,
    input.selectedFunction.functionCatalogSha256,
    input.selectedFunction.entrySha256,
    input.schema.applicationSchemaSha256,
    input.schema.schemaManifestSha256,
    input.schema.schemaBindingSha256,
    input.readiness.sourceArtifactRootSha256,
    input.readiness.manifestSha256,
    input.readiness.publicationSha256,
    input.readiness.applicationSchemaSha256,
    input.readiness.functionCatalogSha256,
    input.readiness.schemaManifestSha256,
    input.readiness.schemaBindingSha256,
    input.readiness.taskCatalogBindingSha256,
    input.readiness.coldReceiptSetSha256,
    input.readiness.candidateValidationReceiptSha256,
    input.readiness.uniqueConstraintEligibilitySha256,
    input.readiness.physicalReadinessSha256,
    input.readiness.readinessSha256,
    input.activation.readinessSha256,
    input.activation.activationRequestSha256,
    input.activation.activationSha256,
  ];
  if (
    identities.some(value => !bounded(value)) ||
    !bytes(input.authorityBytes, 131_072) ||
    !bytes(input.analysis.manifestBytes, MAX_MANIFEST_BYTES) ||
    !bytes(input.publication.schemaBytes, MAX_PUBLICATION_FRAME_BYTES) ||
    !bytes(
      input.publication.functionCatalogBytes,
      MAX_PUBLICATION_FRAME_BYTES,
    ) ||
    !bytes(input.selectedFunction.entryBytes, 65_536) ||
    !bytes(input.readiness.readinessBytes, MAX_READINESS_BYTES) ||
    !bytes(input.activation.activationBytes, MAX_ACTIVATION_BYTES) ||
    fixedDigests.some(value => !digest(value)) ||
    input.readiness.functions.length > MAX_READINESS_FUNCTIONS ||
    input.readiness.functions.some(child =>
      !bounded(child.scopeId) ||
      !bounded(child.revisionId) ||
      !bounded(child.functionPath) ||
      !digest(child.readinessSha256) ||
      !digest(child.runtimeTargetSha256) ||
      !digest(child.coldReceiptSha256)
    )
  ) throw new Error("Invalid Application graph snapshot bounds.");
}

function copyByteRecord<T extends object, K extends keyof T>(
  input: T,
  byteKeys: ReadonlyArray<K>,
): T {
  const output = { ...input };
  for (const key of byteKeys) {
    output[key] = copyBytes(input[key] as Uint8Array) as T[K];
  }
  return Object.freeze(output);
}

function copyEvidence(
  evidence: StoredApplicationMutationCommitAuthorityGraphEvidence,
): ApplicationMutationCommitAuthorityGraphEvidence {
  return Object.freeze({
    authority: evidence.authority,
    manifest: evidence.manifest,
    runtimeTarget: evidence.runtimeTarget,
    compatibilityDate: evidence.compatibilityDate,
    readinessSha256: evidence.readinessSha256,
    activationSha256: evidence.activationSha256,
  });
}
