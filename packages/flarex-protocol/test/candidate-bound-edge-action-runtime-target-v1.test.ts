import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  encodeCandidateBoundEdgeActionRuntimeTargetV1,
  type CandidateBoundEdgeActionRuntimeTargetFrameV1,
} from "../src/candidate-bound-edge-action-runtime-target-v1";
import { makeDeclarativeV2RuntimeArtifactObjectReferenceV1 } from
  "../src/declarative-v2-runtime-projection-v1";
import { EDGE_ACTION_EXACT_RUNTIME_VERSION_V1 } from
  "../src/edge-action-exact-runtime";
import {
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
} from "../src/edge-action-host-policy-v1";

const BUDGET = Object.freeze({
  maximumModules: 8,
  maximumTextBytes: 4_096,
  maximumPreimageBytes: 1_048_576,
});

describe("candidate-bound edge-action runtime target v1", () => {
  it("binds policy, candidate, function, R2 references, and ordered modules", () => {
    const first = Result.getOrThrow(
      encodeCandidateBoundEdgeActionRuntimeTargetV1(frame(), BUDGET),
    );
    const alias = Result.getOrThrow(
      encodeCandidateBoundEdgeActionRuntimeTargetV1({
        ...frame(),
        modules: [...frame().modules],
      }, BUDGET),
    );
    expect(first.canonicalBytes).toEqual(alias.canonicalBytes);
    const changed = Result.getOrThrow(
      encodeCandidateBoundEdgeActionRuntimeTargetV1({
        ...frame(),
        hostPolicySha256: digest(99),
      }, BUDGET),
    );
    expect(hash(first.canonicalBytes)).not.toBe(hash(changed.canonicalBytes));
  });

  it("rejects forged ordinals and object-reference identities", () => {
    const invalidOrdinal = {
      ...frame(),
      modules: [{ ...frame().modules[0]!, moduleOrdinal: 1n }],
    };
    expect(Result.isFailure(
      encodeCandidateBoundEdgeActionRuntimeTargetV1(invalidOrdinal, BUDGET),
    )).toBe(true);
    const invalidReference = {
      ...frame(),
      projectionReference: {
        ...frame().projectionReference,
        objectKey: "forged",
      },
    };
    expect(Result.isFailure(
      encodeCandidateBoundEdgeActionRuntimeTargetV1(invalidReference, BUDGET),
    )).toBe(true);
  });
});

function frame(): CandidateBoundEdgeActionRuntimeTargetFrameV1 {
  const projectionSetReference = reference("runtime-projection-set", 21);
  const functionGroupManifestReference = reference("function-group-manifest", 22);
  const functionEntryReference = reference("function-group-entry", 23);
  const projectionReference = reference("runtime-projection", 24);
  const moduleReference = reference("runtime-projection-module", 25);
  return {
    scopeId: "scope-1",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: "epoch-1",
    applicationRevisionId: "revision-1",
    activationRevision: 1n,
    activationHeadSha256: digest(1),
    readinessReceiptSha256: digest(2),
    candidateSha256: digest(3),
    attemptSha256: digest(4),
    packageSha256: digest(5),
    artifactSha256: digest(6),
    sourceRootSha256: digest(7),
    semanticRootSha256: digest(8),
    schemaArtifactSha256: digest(9),
    schemaBindingSha256: digest(10),
    functionMetadataSha256: digest(11),
    validatorRootSha256: digest(12),
    declaredHandlerSetSha256: digest(13),
    runtimeProjectionSetSha256: digest(14),
    functionGroupManifestSha256: digest(15),
    compatibilityDate: "2026-06-14",
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    exactRuntimeVersion: EDGE_ACTION_EXACT_RUNTIME_VERSION_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    exactRuntimeGraphBasisSha256: digest(16),
    hostPolicySha256: digest(17),
    functionOrdinal: 0n,
    functionPath: "orders:place",
    logicalExecutionModule: "orders.ts",
    artifactExecutionModule: "orders.js",
    projectionExecutionModule: "orders.js",
    exportName: "place",
    handlerKind: "action",
    visibility: "public",
    group: "edge_action",
    projectionSha256: digest(18),
    projectionSetReference,
    functionGroupManifestReference,
    functionEntryReference,
    projectionReference,
    modules: [Object.freeze({
      moduleOrdinal: 0n,
      modulePath: "orders.js",
      roles: 1n,
      sourceByteLength: 10n,
      sourceSha256: digest(19),
      reference: moduleReference,
    })],
  };
}

function reference(
  kind:
    | "runtime-projection-set"
    | "function-group-manifest"
    | "function-group-entry"
    | "runtime-projection"
    | "runtime-projection-module",
  seed: number,
) {
  return Result.getOrThrow(
    makeDeclarativeV2RuntimeArtifactObjectReferenceV1(kind, digest(seed), 100),
  );
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
