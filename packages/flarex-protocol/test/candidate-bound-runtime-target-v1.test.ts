import { createHash } from "node:crypto";

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1,
  CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1,
  CANDIDATE_BOUND_RUNTIME_TARGET_IDENTITY_V1,
  encodeCandidateBoundRuntimeTargetV1,
  type CandidateBoundRuntimeTargetFrameV1,
} from "../src/candidate-bound-runtime-target-v1";

const BUDGET = Object.freeze({
  maximumModules: 8,
  maximumTextBytes: 4_096,
  maximumPreimageBytes: 64 * 1_024,
});
const digest = (fill: number) => new Uint8Array(32).fill(fill);
const reference = (
  kind: "runtime-projection-set" | "function-group-manifest" |
    "function-group-entry" | "runtime-projection" |
    "runtime-projection-module",
  fill: number,
) => Object.freeze({
  storeIdentity: "flarex.r2/declarative-v2-runtime-artifact/v1" as const,
  kind,
  codecIdentity: kind === "function-group-manifest" ||
      kind === "function-group-entry"
    ? "flarex.declarative-v2/function-group-manifest/v1" as const
    : "flarex.declarative-v2/runtime-projection/v1" as const,
  objectKey: `declarative-v2-runtime-artifact/v1/${kind}/${fill.toString(16).padStart(2, "0").repeat(32)}`,
  byteLength: 128n,
  sha256: digest(fill),
});

const FRAME = Object.freeze({
  scopeId: "scope_10000000-0000-4000-8000-000000000001",
  storageGeneration: "flarexdb_v1" as const,
  storageGenerationFence: 3n,
  scopeEpoch: "epoch_10000000-0000-4000-8000-000000000002",
  applicationRevisionId: "revision_runtime_target_vector",
  activationRevision: 7n,
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
  compatibilityDate: "2025-04-01",
  exactRuntimeProfile: "point-mutation-exact-runtime-v1" as const,
  exactRuntimeVersion: 1 as const,
  exactRuntimeGraphBasisSha256: digest(25),
  indexedQueryOperation: CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1,
  maximumIndexedQuerySyscalls:
    CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexedQuerySyscalls,
  maximumIndexedQueryPageSize:
    CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexedQueryPageSize,
  maximumIndexRangeReadDependencies:
    CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexRangeReadDependencies,
  maximumIndexRangeDependencyEvidenceBytes:
    CANDIDATE_BOUND_INDEXED_QUERY_LIMITS_V1.maximumIndexRangeDependencyEvidenceBytes,
  functionOrdinal: 0n,
  functionPath: "orders:place",
  logicalExecutionModule: "orders",
  artifactExecutionModule: "orders.js",
  projectionExecutionModule: "orders.js",
  exportName: "place",
  handlerKind: "mutation" as const,
  visibility: "public" as const,
  group: "transaction" as const,
  projectionSha256: digest(16),
  projectionSetReference: reference("runtime-projection-set", 14),
  functionGroupManifestReference: reference("function-group-manifest", 15),
  functionEntryReference: reference("function-group-entry", 17),
  projectionReference: reference("runtime-projection", 16),
  modules: Object.freeze([Object.freeze({
    moduleOrdinal: 0n,
    modulePath: "orders.js",
    roles: 5n,
    sourceByteLength: 64n,
    sourceSha256: digest(18),
    reference: reference("runtime-projection-module", 19),
  })]),
}) satisfies CandidateBoundRuntimeTargetFrameV1;

describe("candidate-bound runtime target V1", () => {
  it("pins the identity and deterministic canonical vector", () => {
    expect(CANDIDATE_BOUND_RUNTIME_TARGET_IDENTITY_V1).toBe(
      "flarex.system/candidate-bound-runtime-target/v1",
    );
    expect(CANDIDATE_BOUND_INDEXED_QUERY_OPERATION_V1).toBe(
      "flarex.system/app-index-range-query/v1",
    );
    const first = Result.getOrThrow(
      encodeCandidateBoundRuntimeTargetV1(FRAME, BUDGET),
    );
    const replay = Result.getOrThrow(
      encodeCandidateBoundRuntimeTargetV1(structuredClone(FRAME), BUDGET),
    );
    expect(replay.canonicalBytes).toEqual(first.canonicalBytes);
    expect(createHash("sha256").update(first.canonicalBytes).digest("hex"))
      .toBe("36a0fb8a39e0bc60b147d989189c56aa1b3038b9fa1c5a77aace9fb147f9c98c");
  });

  it("changes the preimage for every authority class", () => {
    const base = Result.getOrThrow(
      encodeCandidateBoundRuntimeTargetV1(FRAME, BUDGET),
    ).canonicalBytes;
    const variants: CandidateBoundRuntimeTargetFrameV1[] = [
      { ...FRAME, activationRevision: 8n },
      { ...FRAME, candidateSha256: digest(20) },
      { ...FRAME, readinessReceiptSha256: digest(21) },
      { ...FRAME, functionMetadataSha256: digest(22) },
      { ...FRAME, compatibilityDate: "2025-04-02" },
      { ...FRAME, exactRuntimeGraphBasisSha256: digest(28) },
      { ...FRAME, functionPath: "orders:replace" },
      { ...FRAME, projectionSha256: digest(23) },
      {
        ...FRAME,
        modules: [{ ...FRAME.modules[0]!, sourceSha256: digest(24) }],
      },
    ];
    for (const variant of variants) {
      const bytes = Result.getOrThrow(
        encodeCandidateBoundRuntimeTargetV1(variant, BUDGET),
      ).canonicalBytes;
      expect(bytes).not.toEqual(base);
    }
  });

  it("rejects accessors, wrong relationships, malformed digests, and bounds", () => {
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      { ...FRAME, extra: true },
      BUDGET,
    ))).toBe(true);
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      { ...FRAME, handlerKind: "query" },
      BUDGET,
    ))).toBe(true);
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      { ...FRAME, indexedQueryOperation: "flarex.system/other-query/v1" },
      BUDGET,
    ))).toBe(true);
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      { ...FRAME, maximumIndexedQueryPageSize: 129n },
      BUDGET,
    ))).toBe(true);
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      { ...FRAME, candidateSha256: new Uint8Array(31) },
      BUDGET,
    ))).toBe(true);
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      {
        ...FRAME,
        projectionReference: {
          ...FRAME.projectionReference,
          objectKey: "runtime-projection/not-canonical",
        },
      },
      BUDGET,
    ))).toBe(true);
    expect(Result.isFailure(encodeCandidateBoundRuntimeTargetV1(
      { ...FRAME, modules: [...FRAME.modules, FRAME.modules[0]!] },
      { ...BUDGET, maximumModules: 1 },
    ))).toBe(true);
    const accessor = Object.create(Object.prototype);
    for (const [key, value] of Object.entries(FRAME)) {
      Object.defineProperty(accessor, key, {
        enumerable: true,
        ...(key === "functionPath" ? { get: () => value } : { value }),
      });
    }
    expect(Result.isFailure(
      encodeCandidateBoundRuntimeTargetV1(accessor, BUDGET),
    )).toBe(true);
  });
});
