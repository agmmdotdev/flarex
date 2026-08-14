import {
  APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1,
  APPLICATION_MANIFEST_FORMAT_V1,
  canonicalizeApplicationAnalysisReceiptV1,
  canonicalizeApplicationManifestV1,
  type ApplicationAnalysisRejectionCodeV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import type {
  ApplicationAnalysisAuthority,
  ApplicationAnalysisProjection,
  ApplicationAnalysisRepository,
  ApplicationAnalysisTerminalInput,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import { Effect, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION } from
  "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
  APPLICATION_ANALYSIS_HOST_FORMAT,
  APPLICATION_ANALYSIS_HOST_VERSION,
  APPLICATION_ANALYSIS_POLICY_IDENTITY,
  type ApplicationAnalysisHostResult,
} from "../src/ApplicationAnalysisHost";
import {
  ApplicationAnalysisCompositionError,
  makeApplicationAnalysisContext,
} from "../src/ApplicationAnalysisComposition";

const ROOT = "a".repeat(64);
const MANIFEST_SHA = "b".repeat(64);
const RECEIPT_SHA = "c".repeat(64);
const authority: ApplicationAnalysisAuthority = Object.freeze({
  scopeId: ScopeIdSchema.make("scope_application_analysis_composition"),
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(3n),
  epoch: ScopeEpochSchema.make("epoch_application_analysis_composition"),
});
const input = Object.freeze({
  requestKey: "request-1",
  sourceArtifactRootSha256: ROOT,
});
const canonicalManifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
  format: APPLICATION_MANIFEST_FORMAT_V1,
  version: 1,
  sourceArtifact: {
    rootSha256: ROOT,
    executionModulePath: "functions.js",
    schemaModulePath: null,
    modules: [{
      path: "functions.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "d".repeat(64),
      sourceByteLength: 1,
    }],
  },
  schema: { version: 1, tables: [], indexes: [] },
  functions: [],
}));

describe("Application Analysis durable composition", () => {
  it("settles analyzed output once and replays without another host call", async () => {
    const repository = fakeRepository(canonicalManifest.manifest);
    let hostCalls = 0;
    const context = makeApplicationAnalysisContext({
      authority,
      repository: repository.port,
      host: {
        analyze: () => {
          hostCalls += 1;
          return Effect.succeed(analyzedHostResult());
        },
      },
    });

    const first = await Effect.runPromise(context.analyze(input));
    const replay = await Effect.runPromise(context.analyze(input));

    expect(first.kind).toBe("analyzed");
    expect(replay).toEqual(first);
    expect(hostCalls).toBe(1);
    expect(repository.settlements).toBe(1);
  });

  it("settles and replays a stable rejection", async () => {
    const repository = fakeRepository(canonicalManifest.manifest);
    let hostCalls = 0;
    const context = makeApplicationAnalysisContext({
      authority,
      repository: repository.port,
      host: {
        analyze: () => {
          hostCalls += 1;
          return Effect.succeed(Object.freeze({
            ...hostBase(),
            kind: "rejected" as const,
            failureCode: "invalid_registration" as const,
            detail: "invalid registration",
          }));
        },
      },
    });

    const first = await Effect.runPromise(context.analyze(input));
    const replay = await Effect.runPromise(context.analyze(input));

    expect(first.kind).toBe("rejected");
    expect(replay).toEqual(first);
    expect(hostCalls).toBe(1);
    expect(repository.settlements).toBe(1);
  });

  it("leaves the durable row pending when the host reports integration failure", async () => {
    const repository = fakeRepository(canonicalManifest.manifest);
    const context = makeApplicationAnalysisContext({
      authority,
      repository: repository.port,
      host: {
        analyze: () => Effect.succeed(Object.freeze({
          format: APPLICATION_ANALYSIS_HOST_FORMAT,
          version: APPLICATION_ANALYSIS_HOST_VERSION,
          kind: "failed" as const,
          reason: "workerLoadFailed" as const,
        })),
      },
    });

    const error = await Effect.runPromise(Effect.flip(context.analyze(input)));

    expect(error).toBeInstanceOf(ApplicationAnalysisCompositionError);
    expect(error).toMatchObject({ reason: "hostFailed" });
    expect(repository.settlements).toBe(0);
  });

  it("rejects a mismatched terminal before durable settlement", async () => {
    const repository = fakeRepository(canonicalManifest.manifest);
    const context = makeApplicationAnalysisContext({
      authority,
      repository: repository.port,
      host: {
        analyze: () => Effect.succeed(Object.freeze({
          ...analyzedHostResult(),
          sourceArtifactRootSha256: "e".repeat(64),
        })),
      },
    });

    const error = await Effect.runPromise(Effect.flip(context.analyze(input)));

    expect(error).toBeInstanceOf(ApplicationAnalysisCompositionError);
    expect(error).toMatchObject({ reason: "hostResultMismatch" });
    expect(repository.settlements).toBe(0);
  });
});

function hostBase() {
  return Object.freeze({
    format: APPLICATION_ANALYSIS_HOST_FORMAT,
    version: APPLICATION_ANALYSIS_HOST_VERSION,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
    analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
  });
}

function analyzedHostResult(): ApplicationAnalysisHostResult {
  return Object.freeze({
    ...hostBase(),
    kind: "analyzed",
    manifest: canonicalManifest.manifest,
    canonicalManifest: canonicalManifest.canonicalText,
  });
}

function fakeRepository(manifest: ApplicationManifestV1): Readonly<{
  readonly port: ApplicationAnalysisRepository;
  readonly settlements: number;
}> {
  const pending: ApplicationAnalysisProjection = Object.freeze({
    status: "pending",
    scopeId: authority.scopeId,
    candidateId: "candidate-1",
    analysisId: "analysis-1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
    analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
  });
  let current: ApplicationAnalysisProjection = pending;
  let settlementCount = 0;
  const port: ApplicationAnalysisRepository = Object.freeze({
    begin: () => Effect.succeed(current),
    inspect: () => Effect.succeed(current),
    settle: (
      _authority: ApplicationAnalysisAuthority,
      terminal: ApplicationAnalysisTerminalInput,
    ) => {
      settlementCount += 1;
      current = terminal.kind === "analyzed"
        ? analyzedProjection(manifest)
        : rejectedProjection(terminal.failureCode, terminal.detail);
      return Effect.succeed(current);
    },
  });
  return Object.freeze({
    port,
    get settlements() {
      return settlementCount;
    },
  });
}

function analyzedProjection(
  manifest: ApplicationManifestV1,
): ApplicationAnalysisProjection {
  const receipt = Result.getOrThrow(canonicalizeApplicationAnalysisReceiptV1({
    ...receiptBase(),
    status: "analyzed",
    manifestSha256: MANIFEST_SHA,
  })).receipt;
  return Object.freeze({
    ...projectionBase(),
    status: "analyzed",
    receipt,
    receiptSha256: RECEIPT_SHA,
    manifest,
    manifestSha256: MANIFEST_SHA,
    revision: Object.freeze({
      revisionId: "revision-1",
      status: "inactive",
      registeredAt: new Date("2026-08-14T00:00:00.000Z"),
    }),
  });
}

function rejectedProjection(
  failureCode: ApplicationAnalysisRejectionCodeV1,
  detail: string,
): ApplicationAnalysisProjection {
  const receipt = Result.getOrThrow(canonicalizeApplicationAnalysisReceiptV1({
    ...receiptBase(),
    status: "rejected",
    failureCode,
    detail,
  })).receipt;
  return Object.freeze({
    ...projectionBase(),
    status: "rejected",
    receipt,
    receiptSha256: RECEIPT_SHA,
  });
}

function projectionBase() {
  return Object.freeze({
    scopeId: authority.scopeId,
    candidateId: "candidate-1",
    analysisId: "analysis-1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
    analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
  });
}

function receiptBase() {
  return Object.freeze({
    format: APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1,
    version: 1 as const,
    analysisId: "analysis-1",
    candidateId: "candidate-1",
    scopeId: authority.scopeId,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
    analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
    completedAt: "2026-08-14T00:00:00.000Z",
  });
}
