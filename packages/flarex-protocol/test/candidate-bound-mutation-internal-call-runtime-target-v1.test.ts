import { createHash } from "node:crypto";

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  CANDIDATE_BOUND_MUTATION_INTERNAL_CALL_RUNTIME_TARGET_IDENTITY_V1,
  encodeCandidateBoundMutationInternalCallRuntimeTargetV1,
  type CandidateBoundMutationInternalCallRuntimeTargetFrameV1,
} from "../src/candidate-bound-mutation-internal-call-runtime-target-v1";

const digest = (fill: number) => new Uint8Array(32).fill(fill);
const codec = (kind:
  | "runtime-projection-set" | "function-group-manifest"
  | "function-group-entry" | "runtime-projection"
  | "runtime-projection-module") =>
  kind === "function-group-manifest" || kind === "function-group-entry"
    ? "flarex.declarative-v2/function-group-manifest/v1" as const
    : "flarex.declarative-v2/runtime-projection/v1" as const;
const reference = (kind: Parameters<typeof codec>[0], fill: number) => ({
  storeIdentity: "flarex.r2/declarative-v2-runtime-artifact/v1" as const,
  kind,
  codecIdentity: codec(kind),
  objectKey: `declarative-v2-runtime-artifact/v1/${kind}/${fill.toString(16).padStart(2, "0").repeat(32)}`,
  byteLength: 128n,
  sha256: digest(fill),
});

const FRAME = Object.freeze({
  scopeId: "scope_10000000-0000-4000-8000-000000000001",
  storageGeneration: "flarexdb_v1" as const,
  storageGenerationFence: 3n,
  scopeEpoch: "epoch_10000000-0000-4000-8000-000000000002",
  applicationRevisionId: "revision_mutation_internal_query_target_vector",
  activationRevision: 7n,
  activationHeadSha256: digest(1), readinessReceiptSha256: digest(2),
  candidateSha256: digest(3), attemptSha256: digest(4), packageSha256: digest(5),
  artifactSha256: digest(6), sourceRootSha256: digest(7), semanticRootSha256: digest(8),
  schemaArtifactSha256: digest(9), schemaBindingSha256: digest(10),
  functionMetadataSha256: digest(11), validatorRootSha256: digest(12),
  declaredHandlerSetSha256: digest(13), runtimeProjectionSetSha256: digest(14),
  functionGroupManifestSha256: digest(15), compatibilityDate: "2026-08-03",
  exactRuntimeProfile: "point-mutation-internal-call-exact-runtime-v1" as const,
  exactRuntimeVersion: 1 as const,
  syscallAbiIdentity:
    "flarex.system/point-mutation-internal-call-syscall-abi/v1" as const,
  exactRuntimeGraphBasisSha256: digest(16), functionOrdinal: 0n,
  functionPath: "orders:update", logicalExecutionModule: "orders",
  artifactExecutionModule: "orders.js", projectionExecutionModule: "orders.js",
  exportName: "update", handlerKind: "mutation" as const,
  visibility: "public" as const, group: "transaction" as const,
  maximumInternalCalls: 64n, maximumInternalCallDepth: 8n,
  maximumInternalCallArgumentBytes: 8_388_608n,
  maximumInternalCallResultBytes: 8_388_608n,
  projectionSha256: digest(17),
  projectionSetReference: reference("runtime-projection-set", 18),
  functionGroupManifestReference: reference("function-group-manifest", 19),
  functionEntryReference: reference("function-group-entry", 20),
  projectionReference: reference("runtime-projection", 21),
  modules: [{ moduleOrdinal: 0n, modulePath: "orders.js", roles: 5n,
    sourceByteLength: 64n, sourceSha256: digest(22),
    reference: reference("runtime-projection-module", 23) }],
  internalFunctionCatalog: [{
    functionOrdinal: 1n,
    functionPath: "orders:internal",
    logicalExecutionModule: "orders",
    artifactExecutionModule: "orders.js",
    exportName: "internal",
    handlerKind: "query" as const,
    visibility: "internal" as const,
    group: "transaction" as const,
    functionEntryReference: reference("function-group-entry", 24),
  }, {
    functionOrdinal: 2n,
    functionPath: "orders:mutateInternal",
    logicalExecutionModule: "orders",
    artifactExecutionModule: "orders.js",
    exportName: "mutateInternal",
    handlerKind: "mutation" as const,
    visibility: "internal" as const,
    group: "transaction" as const,
    functionEntryReference: reference("function-group-entry", 25),
  }],
}) satisfies CandidateBoundMutationInternalCallRuntimeTargetFrameV1;
const BUDGET = {
  maximumModules: 8,
  maximumCatalogEntries: 16,
  maximumTextBytes: 4_096,
  maximumPreimageBytes: 64 * 1_024,
};

describe("candidate-bound mutation internal-call runtime target V1", () => {
  it("pins its separate identity and deterministic preimage", () => {
    expect(CANDIDATE_BOUND_MUTATION_INTERNAL_CALL_RUNTIME_TARGET_IDENTITY_V1).toBe(
      "flarex.system/candidate-bound-mutation-internal-call-runtime-target/v1",
    );
    const first = Result.getOrThrow(
      encodeCandidateBoundMutationInternalCallRuntimeTargetV1(FRAME, BUDGET),
    );
    const replay = Result.getOrThrow(
      encodeCandidateBoundMutationInternalCallRuntimeTargetV1(
        structuredClone(FRAME),
        BUDGET,
      ),
    );
    expect(replay.canonicalBytes).toEqual(first.canonicalBytes);
    expect(createHash("sha256").update(first.canonicalBytes).digest("hex"))
      .toBe("89f2faa621fe4864f52ec7e4935c0c7256f80efc69e6bd9d7b2031b06e22adcc");
  });

  it("changes on catalog, call-budget, ABI, and module authority", () => {
    const base = Result.getOrThrow(
      encodeCandidateBoundMutationInternalCallRuntimeTargetV1(FRAME, BUDGET),
    ).canonicalBytes;
    for (const variant of [
      { ...FRAME, compatibilityDate: "2026-08-04" },
      { ...FRAME, exactRuntimeGraphBasisSha256: digest(25) },
      { ...FRAME, internalFunctionCatalog: [{
        ...FRAME.internalFunctionCatalog[0]!, exportName: "other",
      }, FRAME.internalFunctionCatalog[1]!] },
      { ...FRAME, internalFunctionCatalog: [{
        ...FRAME.internalFunctionCatalog[0]!, handlerKind: "mutation" as const,
      }, FRAME.internalFunctionCatalog[1]!] },
      { ...FRAME, modules: [{ ...FRAME.modules[0]!, sourceSha256: digest(27) }] },
    ]) {
      expect(Result.getOrThrow(
        encodeCandidateBoundMutationInternalCallRuntimeTargetV1(variant, BUDGET),
      ).canonicalBytes).not.toEqual(base);
    }
  });

  it("rejects non-internal catalogs, duplicates, unknown fields, and bounds", () => {
    const entry = FRAME.internalFunctionCatalog[0]!;
    for (const variant of [
      { ...FRAME, internalFunctionCatalog: [{ ...entry, visibility: "public" }] },
      { ...FRAME, internalFunctionCatalog: [entry, { ...entry }] },
      { ...FRAME, internalFunctionCatalog: [
        FRAME.internalFunctionCatalog[1]!, entry,
      ] },
      { ...FRAME, internalFunctionCatalog: [{ ...entry, group: "edge_action" }] },
      { ...FRAME, internalFunctionCatalog: [{ ...entry, handlerKind: "action" }] },
      { ...FRAME, internalFunctionCatalog: [{
        ...entry, functionOrdinal: FRAME.functionOrdinal,
      }] },
      { ...FRAME, internalFunctionCatalog: [{
        ...entry, functionPath: FRAME.functionPath,
      }] },
      { ...FRAME, maximumInternalCalls: 63n },
      { ...FRAME, extra: true },
      { ...FRAME, candidateSha256: new Uint8Array(31) },
    ]) {
      expect(Result.isFailure(
        encodeCandidateBoundMutationInternalCallRuntimeTargetV1(variant, BUDGET),
      )).toBe(true);
    }
    expect(Result.isFailure(encodeCandidateBoundMutationInternalCallRuntimeTargetV1(
      FRAME,
      { ...BUDGET, maximumCatalogEntries: 0 },
    ))).toBe(true);
  });
});
