import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  makeCanonicalDeclarativeProgramBudgetV1,
  makeCanonicalDeclarativeProgramFixtureV1,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
  type DeclarativeV2ArtifactIngressPlanV1,
} from "@flarex/declarative-materializer/v1";
import {
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { webcrypto } from "node:crypto";
import { Effect, Result } from "effect";

import {
  makeDeploymentProjectScopeAuthorizerV1,
  type DeploymentProjectScopeAuthorizerV1,
} from "../src/deploymentProjectScopeAuthorization";
import type {
  DeploymentProjectScopeLookupClientV1,
} from "../src/deploymentProjectScopeLookup";
import {
  SourceArtifactV2AttemptStoreConflictError,
  type SourceArtifactV2Attempt,
  type SourceArtifactV2AttemptMutation,
  type SourceArtifactV2AttemptStore,
  type SourceArtifactV2ResourceBudget,
} from "../src/sourceArtifactV2/AttemptStore";
import {
  SourceArtifactV2FinalizedAttemptReadCorruptionV1Error,
  SourceArtifactV2FinalizedAttemptReadLifecycleV1Error,
  SourceArtifactV2FinalizedAttemptReadNotFoundV1Error,
  SourceArtifactV2FinalizedAttemptReadStaleV1Error,
  type SourceArtifactV2FinalizedAttemptReadComposerInputV1,
  type SourceArtifactV2FinalizedAttemptReadComposerV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadComposer";
import {
  makeSourceArtifactV2R2Store,
  type SourceArtifactV2R2Bucket,
} from "../src/sourceArtifactV2/R2Store";
import {
  makeSourceArtifactV2Sha256,
} from "../src/sourceArtifactV2/Sha256";
import {
  makeSourceArtifactV2UploadCore,
  type SourceArtifactV2UploadCore,
  type SourceArtifactV2UploadReceipt,
} from "../src/sourceArtifactV2/UploadCore";
import {
  SemanticArtifactV1AttemptStoreConflictError,
  type SemanticArtifactV1Attempt,
  type SemanticArtifactV1AttemptMutation,
  type SemanticArtifactV1AttemptStore,
  type SemanticArtifactV1Budget,
} from "../src/semanticArtifactV1/AttemptStore";
import {
  makeSemanticArtifactV1FinalizedSourceProofFactory,
  type SemanticArtifactV1FinalizedSourceProofFactory,
} from "../src/semanticArtifactV1/FinalizedSourceProof";
import {
  makeSemanticArtifactV1R2Store,
  type SemanticArtifactV1R2Bucket,
} from "../src/semanticArtifactV1/R2Store";
import {
  makeSemanticArtifactV1Sha256,
} from "../src/semanticArtifactV1/Sha256";
import {
  SemanticArtifactV1SourceCorrelationBudgetError,
  SemanticArtifactV1SourceCorrelationCorruptionError,
  type SemanticArtifactV1SourceCorrelation,
  type SemanticArtifactV1SourceCorrelationReader,
} from "../src/semanticArtifactV1/SourceCorrelationReader";
import {
  makeSemanticArtifactV1UploadCore,
  type SemanticArtifactV1FinalizedEvidence,
  type SemanticArtifactV1Receipt,
  type SemanticArtifactV1UploadCore,
} from "../src/semanticArtifactV1/UploadCore";
import type { Env } from "../src/types";

const UTF8_ENCODER = new TextEncoder();
export const DEPLOYMENT_ID = "deployment-correlation";
const PROJECT_ID = "project-correlation";
const DEPLOYMENT_CREATED_AT = "2026-07-27T00:00:00.000Z";
const PUSH_TOKEN = "correlation-push-secret";
export const SOURCE_UPLOAD_A = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";
export const SOURCE_UPLOAD_B = "028f22e2-58cc-7b2a-91d8-f3f3401a0874";
export const SOURCE_UPLOAD_C = "038f22e2-58cc-7b2a-91d8-f3f3401a0874";

const SOURCE_CEILINGS = Object.freeze({
  calls: 100,
  blockBytes: 1_000_000,
  modules: 100,
  sourceMaps: 100,
  canonicalBytes: 1_000_000,
  frameBytes: 1_000_000,
  hashBytes: 1_000_000,
  timeMilliseconds: 1_000_000,
}) satisfies SourceArtifactV2ResourceBudget;

export const SOURCE_ADMISSION = Object.freeze({
  calls: 1,
  blockBytes: 50_000,
  modules: 10,
  sourceMaps: 10,
  canonicalBytes: 50_000,
  frameBytes: 50_000,
  hashBytes: 50_000,
  timeMilliseconds: 50_000,
}) satisfies SourceArtifactV2ResourceBudget;

export const SEMANTIC_CEILINGS = Object.freeze({
  calls: 20_000,
  blockBytes: 20_000_000,
  canonicalBytes: 20_000_000,
  frameBytes: 20_000_000,
  hashBytes: 20_000_000,
  timeMilliseconds: 100_000,
}) satisfies SemanticArtifactV1Budget;

export const SEMANTIC_ADMISSION = Object.freeze({
  calls: 1_000,
  blockBytes: 2_000_000,
  canonicalBytes: 2_000_000,
  frameBytes: 2_000_000,
  hashBytes: 2_000_000,
  timeMilliseconds: 10_000,
}) satisfies SemanticArtifactV1Budget;

const AUTHORIZATION_BUDGET = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 10_000,
  maximumBodyBytes: 10_000,
  maximumCanonicalBytes: 10_000,
  maximumFrameBytes: 10_000,
  maximumElapsedMilliseconds: 10_000,
});

const FINALIZED_READ_BUDGET = Object.freeze({
  maximumCalls: 10,
  maximumInputBytes: 10_000,
  maximumBodyBytes: 10_000,
  maximumCanonicalBytes: 10_000,
  maximumFrameBytes: 10_000,
  maximumHashBytes: 10_000,
  maximumElapsedMilliseconds: 10_000,
});

interface SourceAttemptHarness {
  readonly store: SourceArtifactV2AttemptStore;
  readonly peek: (uploadId: string) => SourceArtifactV2Attempt | null;
}

export interface CorrelationFixture {
  readonly sourceCore: SourceArtifactV2UploadCore;
  readonly sourceAttempts: SourceAttemptHarness;
  readonly proofs: SemanticArtifactV1FinalizedSourceProofFactory;
  readonly semanticCore: SemanticArtifactV1UploadCore;
}

interface CorrelationRunInput {
  readonly plan: DeclarativeV2ArtifactIngressPlanV1;
  readonly sourceUploadId: string;
  readonly semanticUploadId: string;
  readonly sourceAdmission?: SourceArtifactV2ResourceBudget;
  readonly semanticAdmission?: SemanticArtifactV1Budget;
}

export interface CorrelationRunReceipt {
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootDigest: string;
  readonly sourceSelectorDigest: string;
  readonly semanticUploadId: string;
  readonly semanticGeneration: number;
  readonly semanticMutationFence: number;
  readonly semanticRootDigest: string;
  readonly semanticSelectorDigest: string;
  readonly semanticAttemptIdentityDigest: string;
  readonly evidence: SemanticArtifactV1FinalizedEvidence;
}

export const driveSourcePlan = Effect.fn(
  "DeclarativeV2UploadCorrelation.driveSourcePlan",
)(function* (
  core: SourceArtifactV2UploadCore,
  plan: DeclarativeV2ArtifactIngressPlanV1,
  uploadId: string,
  admission: SourceArtifactV2ResourceBudget,
) {
  let receipt = yield* core.beginUpload({
    uploadId,
    commandId: "source-begin",
    ceilings: SOURCE_CEILINGS,
    admission,
  });
  for (let moduleIndex = 0;
    moduleIndex < plan.source.modules.length;
    moduleIndex += 1) {
    const module = plan.source.modules[moduleIndex];
    if (module === undefined) {
      return yield* Effect.die(
        new Error("Materializer emitted a sparse source module plan."),
      );
    }
    receipt = yield* core.beginModule({
      uploadId,
      generation: receipt.generation,
      expectedFence: receipt.mutationFence,
      commandId: `source-module-${moduleIndex}`,
      admission,
      path: module.path,
      roles: module.roles,
      environment: "isolate",
    });
    receipt = yield* core.appendBlock({
      uploadId,
      generation: receipt.generation,
      expectedFence: receipt.mutationFence,
      commandId: `source-module-${moduleIndex}-source`,
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: module.sourceBytes,
    });
    if (module.sourceMapBytes !== null) {
      receipt = yield* core.appendBlock({
        uploadId,
        generation: receipt.generation,
        expectedFence: receipt.mutationFence,
        commandId: `source-module-${moduleIndex}-source-map`,
        admission,
        kind: "sourceMap",
        blockIndex: 0,
        bytes: module.sourceMapBytes,
      });
    }
    receipt = yield* core.closeModule({
      uploadId,
      generation: receipt.generation,
      expectedFence: receipt.mutationFence,
      commandId: `source-module-${moduleIndex}-close`,
      admission,
    });
  }
  return yield* core.finalize({
    uploadId,
    generation: receipt.generation,
    expectedFence: receipt.mutationFence,
    commandId: "source-finalize",
    admission,
  });
});

export const driveCorrelation = Effect.fn(
  "DeclarativeV2UploadCorrelation.drive",
)(function* (
  fixture: CorrelationFixture,
  input: CorrelationRunInput,
) {
  const sourceAdmission = input.sourceAdmission ?? SOURCE_ADMISSION;
  const semanticAdmission = input.semanticAdmission ?? SEMANTIC_ADMISSION;
  const source = yield* driveSourcePlan(
    fixture.sourceCore,
    input.plan,
    input.sourceUploadId,
    sourceAdmission,
  );
  const beginRequest = pushRequest(`${input.semanticUploadId}-begin`);
  const beginProof = yield* fixture.proofs.issue(
    beginRequest,
    finalizedSourceProofInput(source),
  );
  const semanticBegin = yield* fixture.semanticCore.begin({
    request: beginRequest,
    proof: beginProof,
    deploymentId: DEPLOYMENT_ID,
    commandId: `${input.semanticUploadId}-begin`,
    ceilings: SEMANTIC_CEILINGS,
    admission: semanticAdmission,
  });
  const semanticAppend = yield* fixture.semanticCore.append({
    semanticUploadId: semanticBegin.semanticUploadId,
    deploymentId: DEPLOYMENT_ID,
    expectedGeneration: semanticBegin.generation,
    expectedMutationFence: semanticBegin.mutationFence,
    commandId: `${input.semanticUploadId}-append`,
    admission: semanticAdmission,
    blockOrdinal: 0,
    bytes: input.plan.semantic.bytes,
  });
  const semanticFinalized = yield* fixture.semanticCore.finalize({
    semanticUploadId: semanticAppend.semanticUploadId,
    deploymentId: DEPLOYMENT_ID,
    expectedGeneration: semanticAppend.generation,
    expectedMutationFence: semanticAppend.mutationFence,
    commandId: `${input.semanticUploadId}-finalize`,
    admission: semanticAdmission,
  });
  const readRequest = pushRequest(`${input.semanticUploadId}-read`);
  const readProof = yield* fixture.proofs.issue(
    readRequest,
    finalizedSourceProofInput(source),
  );
  const evidence = yield* fixture.semanticCore.readFinalized(
    readRequest,
    readProof,
    {
      semanticUploadId: semanticFinalized.semanticUploadId,
      deploymentId: DEPLOYMENT_ID,
      expectedGeneration: semanticFinalized.generation,
      expectedMutationFence: semanticFinalized.mutationFence,
      commandId: `${input.semanticUploadId}-read`,
      admission: semanticAdmission,
    },
  );
  const sourceRootDigest = requireTextDigest(
    source.completedRootDigest,
    "source root",
  );
  const sourceSelectorDigest = requireTextDigest(
    source.completedSelectorDigest,
    "source selector",
  );
  const semanticRootDigest = requireByteDigest(
    semanticFinalized.completedRootSha256,
    "semantic root",
  );
  const semanticSelectorDigest = requireByteDigest(
    semanticFinalized.completedSelectorSha256,
    "semantic selector",
  );
  return {
    sourceUploadId: source.uploadId,
    sourceGeneration: source.generation,
    sourceMutationFence: source.mutationFence,
    sourceRootDigest,
    sourceSelectorDigest,
    semanticUploadId: semanticFinalized.semanticUploadId,
    semanticGeneration: semanticFinalized.generation,
    semanticMutationFence: semanticFinalized.mutationFence,
    semanticRootDigest,
    semanticSelectorDigest,
    semanticAttemptIdentityDigest: encodeBytesToLowercaseHex(
      evidence.semanticAttemptIdentitySha256,
    ),
    evidence,
  } satisfies CorrelationRunReceipt;
});

export function makeCorrelationFixture(options: {
  readonly semanticUploadId: string;
  readonly sourceCorrelationGenerationDelta?: number;
}): CorrelationFixture {
  const sourceAttempts = makeSourceAttemptHarness();
  const sourceSha256 = makeSourceArtifactV2Sha256(input =>
    webcrypto.subtle.digest("SHA-256", input)
  );
  const sourceCore = makeSourceArtifactV2UploadCore({
    deploymentId: DEPLOYMENT_ID,
    attempts: sourceAttempts.store,
    objects: makeSourceArtifactV2R2Store(
      new MemorySourceArtifactBucket(),
      sourceSha256,
    ),
    sha256: sourceSha256,
  });
  const authorizer = makeTestAuthorizer();
  const proofs = makeSemanticArtifactV1FinalizedSourceProofFactory({
    authorizer,
    finalizedSourceReader: makeFinalizedSourceReader(
      authorizer,
      sourceAttempts,
    ),
  });
  const semanticSha256 = makeSemanticArtifactV1Sha256(input =>
    webcrypto.subtle.digest("SHA-256", input)
  );
  const semanticCore = Result.getOrThrow(makeSemanticArtifactV1UploadCore({
    proofFactory: proofs,
    sourceAttemptReader: makeSourceCorrelationReader(
      sourceAttempts,
      options.sourceCorrelationGenerationDelta ?? 0,
    ),
    attemptStore: makeSemanticAttemptStore(),
    r2: makeSemanticArtifactV1R2Store(
      new MemorySemanticArtifactBucket(),
      semanticSha256,
    ),
    sha256: semanticSha256,
    rootConfiguration: {
      semanticModelIdentity: "semantic-model-v1",
      semanticCodecIdentity: "semantic-codec-v1",
      semanticPolicyIdentity: "semantic-policy-v1",
      coreLanguageIdentity: "FlarexDeclarativeExecutableCoreV1",
      abiIdentity: "abi-v1",
      grammarIdentity: "grammar-v1",
      unicodeIdentity: "unicode-14",
      parserTableIdentity: "parser-table-v1",
      trustedToolingIdentity: "tooling-v1",
      ingressProtocolIdentity: "semantic-ingress-v1",
      ingressConfigurationIdentity: "semantic-ingress-config-v1",
    },
    makeUploadId: () => options.semanticUploadId,
  }));
  return { sourceCore, sourceAttempts, proofs, semanticCore };
}

function makeSourceAttemptHarness(): SourceAttemptHarness {
  const rows = new Map<string, SourceArtifactV2Attempt>();
  const store: SourceArtifactV2AttemptStore = Object.freeze({
    read: (uploadId: string) => Effect.succeed(rows.get(uploadId) ?? null),
    write: (mutation: SourceArtifactV2AttemptMutation) => Effect.suspend(() => {
      const current = rows.get(mutation.uploadId);
      if (
        current !== undefined &&
        current.lastCommandId === mutation.commandId
      ) {
        return current.lastCommandDigest === mutation.commandDigest
          ? Effect.succeed(current)
          : Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
              uploadId: mutation.uploadId,
              reason: "conflictingReplay",
            }));
      }
      if (mutation.expectedFence === null) {
        if (current !== undefined) {
          return Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
            uploadId: mutation.uploadId,
            reason: "alreadyExists",
          }));
        }
      } else if (current === undefined) {
        return Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
          uploadId: mutation.uploadId,
          reason: "notFound",
        }));
      } else if (current.mutationFence !== mutation.expectedFence) {
        return Effect.fail(new SourceArtifactV2AttemptStoreConflictError({
          uploadId: mutation.uploadId,
          reason: "staleFence",
        }));
      }
      rows.set(mutation.uploadId, mutation.next);
      return Effect.succeed(mutation.next);
    }),
  });
  return Object.freeze({
    store,
    peek: (uploadId: string) => rows.get(uploadId) ?? null,
  });
}

function makeSemanticAttemptStore(): SemanticArtifactV1AttemptStore {
  const rows = new Map<string, SemanticArtifactV1Attempt>();
  return Object.freeze({
    read: (semanticUploadId: string) =>
      Effect.succeed(rows.get(semanticUploadId) ?? null),
    write: (mutation: SemanticArtifactV1AttemptMutation) =>
      Effect.suspend(() => {
        const current = rows.get(mutation.semanticUploadId);
        if (
          current !== undefined &&
          current.lastCommandId === mutation.commandId
        ) {
          return current.lastCommandDigest === mutation.commandDigest
            ? Effect.succeed(current)
            : Effect.fail(new SemanticArtifactV1AttemptStoreConflictError({
                semanticUploadId: mutation.semanticUploadId,
                reason: "conflictingReplay",
              }));
        }
        if (mutation.expectedFence === null) {
          if (current !== undefined) {
            return Effect.fail(
              new SemanticArtifactV1AttemptStoreConflictError({
                semanticUploadId: mutation.semanticUploadId,
                reason: "alreadyExists",
              }),
            );
          }
        } else if (current === undefined) {
          return Effect.fail(new SemanticArtifactV1AttemptStoreConflictError({
            semanticUploadId: mutation.semanticUploadId,
            reason: "notFound",
          }));
        } else if (current.mutationFence !== mutation.expectedFence) {
          return Effect.fail(new SemanticArtifactV1AttemptStoreConflictError({
            semanticUploadId: mutation.semanticUploadId,
            reason: "staleFence",
          }));
        }
        rows.set(mutation.semanticUploadId, mutation.next);
        return Effect.succeed(mutation.next);
      }),
  });
}

function makeTestAuthorizer(): DeploymentProjectScopeAuthorizerV1 {
  const lookup: DeploymentProjectScopeLookupClientV1 = Object.freeze({
    lookup: (
      input: Parameters<DeploymentProjectScopeLookupClientV1["lookup"]>[0],
    ) => Effect.succeed(Object.freeze({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      deploymentCreatedAt: DEPLOYMENT_CREATED_AT,
      usage: Object.freeze({
        lookupCalls: 1,
        inputBytes: 1,
        bodyBytes: 1,
        canonicalBytes: 1,
        frameBytes: 1,
        elapsedMilliseconds: 0,
      }),
    })),
  });
  // The production authorizer accepts the complete Worker Env even though this
  // test boundary uses only its auth token, project ID, and executor presence.
  const env = {
    FLAREX_ANALYZED_START_TOKEN: PUSH_TOKEN,
    FLAREX_PROJECT_ID: PROJECT_ID,
    FLAREX_EXECUTOR: { fetch: async () => new Response() },
  } as unknown as Env;
  return Result.getOrThrow(makeDeploymentProjectScopeAuthorizerV1(env, lookup));
}

function makeFinalizedSourceReader(
  authorizer: DeploymentProjectScopeAuthorizerV1,
  attempts: SourceAttemptHarness,
): SourceArtifactV2FinalizedAttemptReadComposerV1 {
  const read: SourceArtifactV2FinalizedAttemptReadComposerV1["read"] =
    Effect.fn("DeclarativeV2UploadCorrelation.readFinalizedSource")(
      function* (request, witness, input) {
        const claimed = yield* Effect.fromResult(authorizer.claim(
          witness,
          request,
          input.deploymentId,
        ));
        if (input.deploymentId !== DEPLOYMENT_ID) {
          return yield*
            new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
              reason: "identityMismatch",
            });
        }
        const attempt = attempts.peek(input.uploadId);
        if (attempt === null) {
          return yield* new SourceArtifactV2FinalizedAttemptReadNotFoundV1Error({
            uploadId: input.uploadId,
          });
        }
        if (input.expectedGeneration !== attempt.generation) {
          return yield* new SourceArtifactV2FinalizedAttemptReadStaleV1Error({
            uploadId: input.uploadId,
            reason: "generation",
          });
        }
        if (input.expectedMutationFence !== attempt.mutationFence) {
          return yield* new SourceArtifactV2FinalizedAttemptReadStaleV1Error({
            uploadId: input.uploadId,
            reason: "mutationFence",
          });
        }
        if (attempt.state !== "finalized") {
          return yield*
            new SourceArtifactV2FinalizedAttemptReadLifecycleV1Error({
              uploadId: input.uploadId,
            });
        }
        if (
          attempt.completedRootDigest === null ||
          attempt.completedSelectorDigest === null
        ) {
          return yield*
            new SourceArtifactV2FinalizedAttemptReadCorruptionV1Error({
              reason: "storedEvidence",
            });
        }
        return Object.freeze({
          requestId: `correlation-${request.url}`,
          deploymentId: claimed.deploymentId,
          projectId: claimed.projectId,
          deploymentCreatedAt: claimed.deploymentCreatedAt,
          uploadId: attempt.uploadId,
          generation: attempt.generation,
          mutationFence: attempt.mutationFence,
          completedRootDigest: attempt.completedRootDigest,
          completedSelectorDigest: attempt.completedSelectorDigest,
          usage: Object.freeze({
            calls: 1,
            inputBytes: 1,
            bodyBytes: 1,
            canonicalBytes: 1,
            frameBytes: 1,
            hashBytes: 1,
            elapsedMilliseconds: 0,
          }),
        });
      },
    );
  return Object.freeze({ read });
}

function makeSourceCorrelationReader(
  attempts: SourceAttemptHarness,
  generationDelta: number,
): SemanticArtifactV1SourceCorrelationReader {
  const read: SemanticArtifactV1SourceCorrelationReader["read"] = Effect.fn(
    "DeclarativeV2UploadCorrelation.readSourceCorrelation",
  )(function* (
    uploadId,
    budget,
  ): Effect.fn.Return<
    SemanticArtifactV1SourceCorrelation | null,
    | SemanticArtifactV1SourceCorrelationBudgetError
    | SemanticArtifactV1SourceCorrelationCorruptionError
  > {
      if (budget.maximumCalls < 1 || budget.maximumStoredBytes < 1) {
        return yield* new SemanticArtifactV1SourceCorrelationBudgetError({
          uploadId,
          observed: 1,
          maximum: Math.min(
            budget.maximumCalls,
            budget.maximumStoredBytes,
          ),
        });
      }
      const attempt = attempts.peek(uploadId);
      if (attempt === null) return null;
      if (
        attempt.state !== "finalized" ||
        attempt.completedRootDigest === null ||
        attempt.completedSelectorDigest === null
      ) {
        return yield*
          new SemanticArtifactV1SourceCorrelationCorruptionError({ uploadId });
      }
      return Object.freeze({
        uploadId: attempt.uploadId,
        generation: attempt.generation + generationDelta,
        mutationFence: attempt.mutationFence,
        state: "finalized" as const,
        completedRootDigest: attempt.completedRootDigest,
        completedSelectorDigest: attempt.completedSelectorDigest,
      });
  });
  return Object.freeze({ read });
}

class MemorySourceArtifactBucket implements SourceArtifactV2R2Bucket {
  readonly #objects = new Map<string, Uint8Array>();

  put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<Readonly<Record<string, never>> | null> {
    if (this.#objects.has(key)) return Promise.resolve(null);
    this.#objects.set(key, copyBytes(new Uint8Array(value)));
    return Promise.resolve(Object.freeze({}));
  }

  get(key: string): PromiseLike<Readonly<Record<string, unknown>> | null> {
    const bytes = this.#objects.get(key);
    return Promise.resolve(bytes === undefined
      ? null
      : storedObject(bytes));
  }
}

class MemorySemanticArtifactBucket implements SemanticArtifactV1R2Bucket {
  readonly #objects = new Map<string, Uint8Array>();

  put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<Readonly<Record<string, never>> | null> {
    if (this.#objects.has(key)) return Promise.resolve(null);
    this.#objects.set(key, copyBytes(new Uint8Array(value)));
    return Promise.resolve(Object.freeze({}));
  }

  get(key: string): PromiseLike<Readonly<Record<string, unknown>> | null> {
    const bytes = this.#objects.get(key);
    return Promise.resolve(bytes === undefined
      ? null
      : storedObject(bytes));
  }
}

function storedObject(
  bytes: Uint8Array,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    size: bytes.byteLength,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(copyBytes(bytes));
        controller.close();
      },
    }),
  });
}

export function materializedPlan(
  ordersSource = "export const place = 1;\n",
): DeclarativeV2ArtifactIngressPlanV1 {
  const programBudget = Result.getOrThrow(
    makeCanonicalDeclarativeProgramBudgetV1({
      maximumModules: 2,
      maximumFunctions: 2,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 256,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    }),
  );
  const program = Result.getOrThrow(
    makeCanonicalDeclarativeProgramFixtureV1({
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
      schema: {
        tables: [{
          logicalName: "orders",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                status: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
          },
        }],
        indexes: [{
          tableLogicalName: "orders",
          descriptor: "by_status",
          fields: ["status"],
        }],
      },
      modules: [{
        modulePath: "orders",
        functions: [{
          exportName: "place",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    }, programBudget),
  );
  const materializationBudget = Result.getOrThrow(
    makeDeclarativeV2MaterializationBudgetV1({
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 2_048,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 32_000,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 16_000,
    }),
  );
  return Result.getOrThrow(materializeDeclarativeV2ArtifactsV1(program, {
    modules: [
      {
        path: "orders.js",
        roles: ["function"],
        sourceBytes: UTF8_ENCODER.encode(ordersSource),
        sourceMapBytes: UTF8_ENCODER.encode("{\"version\":3}\n"),
      },
      {
        path: "_flarex/execution.js",
        roles: ["execution"],
        sourceBytes: UTF8_ENCODER.encode("export const run = 1;\n"),
        sourceMapBytes: null,
      },
    ],
    functionEntries: [{
      logicalModulePath: "orders",
      artifactModulePath: "orders.js",
    }],
    executionPath: "_flarex/execution.js",
    schemaPath: null,
    authPath: null,
  }, materializationBudget));
}

export function finalizedSourceProofInput(
  source: SourceArtifactV2UploadReceipt,
): {
  readonly authorization: {
    readonly deploymentId: string;
    readonly budget: {
      readonly cumulative: typeof AUTHORIZATION_BUDGET;
      readonly command: typeof AUTHORIZATION_BUDGET;
    };
  };
  readonly source: SourceArtifactV2FinalizedAttemptReadComposerInputV1;
} {
  return Object.freeze({
    authorization: Object.freeze({
      deploymentId: DEPLOYMENT_ID,
      budget: Object.freeze({
        cumulative: AUTHORIZATION_BUDGET,
        command: AUTHORIZATION_BUDGET,
      }),
    }),
    source: Object.freeze({
      deploymentId: DEPLOYMENT_ID,
      uploadId: source.uploadId,
      expectedGeneration: source.generation,
      expectedMutationFence: source.mutationFence,
      budget: Object.freeze({
        cumulative: FINALIZED_READ_BUDGET,
        command: FINALIZED_READ_BUDGET,
      }),
    }),
  });
}

export function pushRequest(suffix: string): Request {
  return new Request(`https://backend.test/correlation/${suffix}`, {
    method: "POST",
    headers: { authorization: `Bearer ${PUSH_TOKEN}` },
  });
}

function requireTextDigest(
  value: string | null,
  label: string,
): string {
  if (value === null) {
    throw new Error(`Finalized ${label} was missing.`);
  }
  return value;
}

function requireByteDigest(
  value: Uint8Array | null,
  label: string,
): string {
  if (value === null) {
    throw new Error(`Finalized ${label} was missing.`);
  }
  return encodeBytesToLowercaseHex(value);
}
