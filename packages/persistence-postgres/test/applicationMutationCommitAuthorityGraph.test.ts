import { webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { beforeAll, describe, expect, it } from "vitest";

import {
  inspectApplicationMutationCommitAuthorityGraph,
  InvalidApplicationMutationCommitAuthorityGraphError,
  verifyApplicationMutationCommitAuthorityGraph,
  type ApplicationMutationCommitAuthorityGraphSnapshot,
} from "../src/applicationMutationCommitAuthorityGraph";
import {
  applicationRuntimeTargetFromPublication,
  type ApplicationPublication,
} from "../src/applicationPublication";
import { runEffect } from "./effectTestRuntime";

const UTF8 = new TextEncoder();
const SCOPE_ID = ScopeIdSchema.make(
  "scope_10000000-0000-4000-8000-000000000001",
);
const ROOT = "11".repeat(32);
const REVISION_ID = "revision";
const CANDIDATE_ID = "candidate";
const ANALYSIS_ID = "analysis";
const SCHEMA_VERSION_ID = "schema-version";
const FUNCTION_PATH = "recipes:alpha";
const READY_AT = "2026-08-12T00:00:00.000Z";
const ACTIVATED_AT = "2026-08-12T00:00:01.000Z";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application mutation commit-authority graph", () => {
  it("authenticates one exact immutable graph and rejects structural copies", async () => {
    const snapshot = await graphSnapshot();
    const capability = await runEffect(
      verifyApplicationMutationCommitAuthorityGraph(snapshot),
    );
    const evidence = inspectApplicationMutationCommitAuthorityGraph(capability);

    expect(evidence.runtimeTarget.function).toMatchObject({
      path: FUNCTION_PATH,
      kind: "mutation",
      visibility: "public",
    });
    expect(evidence.authority.schemaVersionId).toBe(SCHEMA_VERSION_ID);
    expect(evidence.manifest.functions).toHaveLength(1);
    const second = inspectApplicationMutationCommitAuthorityGraph(capability);
    expect(second).not.toBe(evidence);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(() => inspectApplicationMutationCommitAuthorityGraph({
      ...capability,
    })).toThrow(InvalidApplicationMutationCommitAuthorityGraphError);
  });

  it("reconstructs readiness in manifest order from a path-ordered directory", async () => {
    const snapshot = await graphSnapshot("_flarex/application.js", true);
    const capability = await runEffect(
      verifyApplicationMutationCommitAuthorityGraph(snapshot),
    );

    expect(inspectApplicationMutationCommitAuthorityGraph(capability)
      .runtimeTarget.function.path).toBe(FUNCTION_PATH);
  });

  it.each([
    ["publication", "publicationMismatch", (snapshot: MutableSnapshot) => {
      snapshot.publication.publicationSha256[0] ^= 0xff;
    }],
    ["function", "functionMismatch", (snapshot: MutableSnapshot) => {
      snapshot.selectedFunction.entrySha256[0] ^= 0xff;
    }],
    ["schema", "schemaMismatch", (snapshot: MutableSnapshot) => {
      snapshot.schema.schemaBindingSha256 = bytes(0xde);
    }],
    ["readiness", "readinessMismatch", (snapshot: MutableSnapshot) => {
      snapshot.readiness.readinessBytes[0] ^= 0xff;
    }],
    ["activation", "activationMismatch", (snapshot: MutableSnapshot) => {
      snapshot.activation.activationBytes[0] ^= 0xff;
    }],
  ] as const)("rejects corrupted %s evidence", async (
    _name,
    reason,
    corrupt,
  ) => {
    const snapshot = await graphSnapshot();
    corrupt(snapshot as MutableSnapshot);
    const result = await runEffect(Effect.result(
      verifyApplicationMutationCommitAuthorityGraph(snapshot),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
  });

  it("captures caller-owned bytes before Effect execution", async () => {
    const snapshot = await graphSnapshot();
    const effect = verifyApplicationMutationCommitAuthorityGraph(snapshot);
    snapshot.analysis.manifestBytes[0] ^= 0xff;
    const capability = await runEffect(effect);

    expect(inspectApplicationMutationCommitAuthorityGraph(capability)
      .runtimeTarget.function.path).toBe(FUNCTION_PATH);
  });

  it("maps detached byte views to the typed invalid-input channel", async () => {
    const snapshot = await graphSnapshot();
    structuredClone(snapshot.analysis.manifestBytes, {
      transfer: [snapshot.analysis.manifestBytes.buffer as ArrayBuffer],
    });
    const result = await runEffect(Effect.result(
      verifyApplicationMutationCommitAuthorityGraph(snapshot),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "invalidInput",
        field: "snapshot",
      });
    }
  });

  it("rejects readiness child rows from another immutable receipt", async () => {
    const snapshot = await graphSnapshot();
    const mutable = snapshot as MutableSnapshot;
    mutable.readiness.functions[0]!.readinessSha256 = bytes(0xef);
    const result = await runEffect(Effect.result(
      verifyApplicationMutationCommitAuthorityGraph(snapshot),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "readinessMismatch",
        field: "functions",
      });
    }
  });

  it("derives the execution module from the manifest, not the authority", async () => {
    const snapshot = await graphSnapshot("_flarex/other.js");
    const result = await runEffect(Effect.result(
      verifyApplicationMutationCommitAuthorityGraph(snapshot),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "functionMismatch",
        field: "runtimeTarget",
      });
    }
  });

  it("rejects an oversized readiness directory before detaching it", async () => {
    const snapshot = await graphSnapshot();
    const child = snapshot.readiness.functions[0]!;
    const oversized = {
      ...snapshot,
      readiness: {
        ...snapshot.readiness,
        functions: Array.from({ length: 1_025 }, () => child),
      },
    };
    const result = await runEffect(Effect.result(
      verifyApplicationMutationCommitAuthorityGraph(oversized),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "invalidInput",
        field: "snapshot",
      });
    }
  });

  it("uses intrinsic byte length before copying a lying subclass", async () => {
    const snapshot = await graphSnapshot();
    class LyingBytes extends Uint8Array {
      override get byteLength(): number {
        return 32;
      }
    }
    const oversized = new LyingBytes(1_048_577);
    const result = await runEffect(Effect.result(
      verifyApplicationMutationCommitAuthorityGraph({
        ...snapshot,
        analysis: { ...snapshot.analysis, manifestBytes: oversized },
      }),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "invalidInput",
        field: "snapshot",
      });
    }
  });
});

type MutableSnapshot = ApplicationMutationCommitAuthorityGraphSnapshot & {
  publication: { publicationSha256: Uint8Array };
  selectedFunction: { entrySha256: Uint8Array };
  schema: { schemaBindingSha256: Uint8Array };
  readiness: {
    readinessBytes: Uint8Array;
    functions: Array<{ readinessSha256: Uint8Array }>;
  };
  activation: { activationBytes: Uint8Array };
};

async function graphSnapshot(
  runtimeExecutionModulePath = "_flarex/application.js",
  includeDefaultFunction = false,
): Promise<
  ApplicationMutationCommitAuthorityGraphSnapshot
> {
  const canonicalManifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "22".repeat(32),
        sourceByteLength: 128,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "33".repeat(32),
        sourceByteLength: 64,
      }],
    },
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "recipes",
        validator: { type: "any" },
        placement: { kind: "partitionBy", field: "_id" },
      }],
      indexes: [],
    },
    functions: [{
      path: FUNCTION_PATH,
      moduleName: "recipes",
      exportName: "alpha",
      kind: "mutation",
      visibility: "public",
      args: { type: "any" },
      returns: { type: "null" },
      partition: null,
    }, ...(includeDefaultFunction ? [{
      path: "recipes",
      moduleName: "recipes",
      exportName: "default",
      kind: "query" as const,
      visibility: "public" as const,
      args: { type: "any" as const },
      returns: { type: "null" as const },
      partition: null,
    }] : [])],
  }));
  const manifestSha256 = await sha256(canonicalManifest.canonicalBytes);
  const schemaBytes = Result.getOrThrow(
    applicationSchemaPublicationFrameV1(canonicalManifest.manifest),
  );
  const schemaSha256 = await sha256(schemaBytes);
  const catalogBytes = Result.getOrThrow(
    applicationFunctionCatalogPublicationFrameV1(canonicalManifest.manifest),
  );
  const catalogSha256 = await sha256(catalogBytes);
  const fn = canonicalManifest.manifest.functions[0]!;
  const entryBytes = Result.getOrThrow(
    applicationFunctionEntryPublicationFrameV1(fn),
  );
  const entrySha256 = await sha256(entryBytes);
  const publicationCommitment = Result.getOrThrow(
    applicationPublicationCommitmentFrameV1({
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      candidateId: CANDIDATE_ID,
      analysisId: ANALYSIS_ID,
      sourceArtifactRootSha256: ROOT,
      manifestSha256: hex(manifestSha256),
      schemaSha256: hex(schemaSha256),
      functionCatalogSha256: hex(catalogSha256),
    }),
  );
  const publicationSha256 = await sha256(publicationCommitment);
  const publicationFunctions = await Promise.all(
    canonicalManifest.manifest.functions.map(async functionEntry => {
      const bytes = Result.getOrThrow(
        applicationFunctionEntryPublicationFrameV1(functionEntry),
      );
      return Object.freeze({
        ...functionEntry,
        entrySha256: hex(await sha256(bytes)),
      });
    }),
  );
  const publication: ApplicationPublication = Object.freeze({
    scopeId: SCOPE_ID,
    revisionId: REVISION_ID,
    candidateId: CANDIDATE_ID,
    analysisId: ANALYSIS_ID,
    sourceArtifactRootSha256: ROOT,
    manifestSha256: hex(manifestSha256),
    schemaSha256: hex(schemaSha256),
    functionCatalogSha256: hex(catalogSha256),
    publicationSha256: hex(publicationSha256),
    executionModulePath: runtimeExecutionModulePath,
    functions: Object.freeze(publicationFunctions),
    publishedAt: new Date(0),
  });
  const runtimeTarget = Result.getOrThrow(
    applicationRuntimeTargetFromPublication(publication, FUNCTION_PATH),
  );
  const runtimeTargetSha256 = await sha256(runtimeTarget.canonicalBytes);
  const schemaManifestSha256 = bytes(0x44);
  const schemaBindingSha256 = bytes(0x55);
  const coldReceiptSha256 = bytes(0x66);
  const coldReceipts = await Promise.all(
    canonicalManifest.manifest.functions.map(async manifestFunction => {
      const functionTarget = Result.getOrThrow(
        applicationRuntimeTargetFromPublication(
          publication,
          manifestFunction.path,
        ),
      );
      return {
        functionPath: manifestFunction.path,
        runtimeTargetSha256: hex(await sha256(functionTarget.canonicalBytes)),
        coldReceiptSha256: manifestFunction.path === FUNCTION_PATH
          ? hex(coldReceiptSha256)
          : "67".repeat(32),
      };
    }),
  );
  const readinessValue: Json = {
    format: "flarex.application-readiness",
    version: 1,
    status: "ready",
    scopeId: SCOPE_ID,
    deploymentId: "deployment",
    revisionId: REVISION_ID,
    candidateId: CANDIDATE_ID,
    analysisId: ANALYSIS_ID,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: "1",
    epoch: "epoch",
    sourceArtifactRootSha256: ROOT,
    manifestSha256: hex(manifestSha256),
    publicationSha256: hex(publicationSha256),
    applicationSchemaSha256: hex(schemaSha256),
    functionCatalogSha256: hex(catalogSha256),
    schemaVersionId: SCHEMA_VERSION_ID,
    schemaManifestSha256: hex(schemaManifestSha256),
    schemaBindingSha256: hex(schemaBindingSha256),
    taskCatalogBindingSha256: "77".repeat(32),
    runtimeHostIdentity: "workerd",
    compatibilityDate: "2026-08-12",
    coldReceiptSetSha256: "88".repeat(32),
    candidateValidationReceiptSha256: "99".repeat(32),
    uniqueConstraintStatus: "not_required",
    uniqueConstraintEligibilitySha256: "aa".repeat(32),
    physicalReadinessSha256: "bb".repeat(32),
    coldReceipts,
    readyAt: READY_AT,
  };
  const readinessBytes = canonicalBytes(readinessValue);
  const readinessSha256 = await sha256(readinessBytes);
  const activationRequestSha256 = bytes(0xcc);
  const activationValue: Json = {
    format: "flarex.application-activation",
    version: 1,
    scopeId: SCOPE_ID,
    activationSequence: "1",
    previousActivationSequence: null,
    revisionId: REVISION_ID,
    readinessSha256: hex(readinessSha256),
    activationRequestSha256: hex(activationRequestSha256),
    activatedAt: ACTIVATED_AT,
  };
  const activationBytes = canonicalBytes(activationValue);
  const activationSha256 = await sha256(activationBytes);
  const headBytes = canonicalBytes({
    format: "flarex.application-active-head",
    version: 1,
    scopeId: SCOPE_ID,
    activationSequence: "1",
    revisionId: REVISION_ID,
    readinessSha256: hex(readinessSha256),
    activationSha256: hex(activationSha256),
  });
  const headSha256 = await sha256(headBytes);
  const authority = await runEffect(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: runtimeTarget.target,
      runtimeTargetSha256: hex(runtimeTargetSha256),
      activationSequence: "1",
      activeHeadSha256: hex(headSha256),
      schemaVersionId: SCHEMA_VERSION_ID,
    }),
  );

  return {
    authorityBytes: copyBytes(authority.canonicalBytes),
    deploymentId: "deployment",
    scope: {
      scopeId: SCOPE_ID,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      epoch: "epoch",
    },
    candidate: {
      scopeId: SCOPE_ID,
      candidateId: CANDIDATE_ID,
      sourceArtifactRootSha256: hexBytes(ROOT),
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      epoch: "epoch",
    },
    analysis: {
      scopeId: SCOPE_ID,
      analysisId: ANALYSIS_ID,
      candidateId: CANDIDATE_ID,
      sourceArtifactRootSha256: hexBytes(ROOT),
      status: "analyzed",
      manifestSha256,
      manifestBytes: copyBytes(canonicalManifest.canonicalBytes),
    },
    revision: {
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      candidateId: CANDIDATE_ID,
      analysisId: ANALYSIS_ID,
      sourceArtifactRootSha256: hexBytes(ROOT),
      manifestSha256,
      status: "inactive",
    },
    publication: {
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      candidateId: CANDIDATE_ID,
      analysisId: ANALYSIS_ID,
      sourceArtifactRootSha256: hexBytes(ROOT),
      manifestSha256,
      schemaSha256,
      schemaBytes,
      functionCatalogSha256: catalogSha256,
      functionCatalogBytes: catalogBytes,
      publicationSha256,
    },
    selectedFunction: {
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      functionPath: FUNCTION_PATH,
      functionCatalogSha256: catalogSha256,
      entrySha256,
      entryBytes,
    },
    schema: {
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      deploymentId: "deployment",
      applicationSchemaSha256: schemaSha256,
      schemaVersionId: SCHEMA_VERSION_ID,
      schemaManifestSha256,
      schemaBindingSha256,
    },
    readiness: {
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      deploymentId: "deployment",
      candidateId: CANDIDATE_ID,
      analysisId: ANALYSIS_ID,
      sourceArtifactRootSha256: hexBytes(ROOT),
      manifestSha256,
      publicationSha256,
      applicationSchemaSha256: schemaSha256,
      functionCatalogSha256: catalogSha256,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      epoch: "epoch",
      schemaVersionId: SCHEMA_VERSION_ID,
      schemaManifestSha256,
      schemaBindingSha256,
      taskCatalogBindingSha256: bytes(0x77),
      runtimeHostIdentity: "workerd",
      compatibilityDate: "2026-08-12",
      coldReceiptSetSha256: bytes(0x88),
      candidateValidationReceiptSha256: bytes(0x99),
      uniqueConstraintStatus: "not_required",
      uniqueConstraintEligibilitySha256: bytes(0xaa),
      physicalReadinessSha256: bytes(0xbb),
      readinessSha256,
      readinessBytes,
      readyAt: READY_AT,
      functions: coldReceipts.slice().reverse().map(receipt => ({
        scopeId: SCOPE_ID,
        revisionId: REVISION_ID,
        readinessSha256,
        functionPath: receipt.functionPath,
        runtimeTargetSha256: hexBytes(receipt.runtimeTargetSha256),
        coldReceiptSha256: hexBytes(receipt.coldReceiptSha256),
      })),
    },
    activation: {
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      activationSequence: 1n,
      previousActivationSequence: null,
      readinessSha256,
      activationRequestSha256,
      activationSha256,
      activationBytes,
      activatedAt: ACTIVATED_AT,
    },
  };
}

function canonicalBytes(value: Json): Uint8Array {
  return UTF8.encode(encodeCanonicalJson(value, issue => {
    throw new Error(`Test fixture invariant: ${issue.reason}`);
  }));
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(value),
  ));
}

function bytes(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function hex(value: Uint8Array): string {
  return encodeBytesToLowercaseHex(value);
}

function hexBytes(value: string): Uint8Array {
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}
