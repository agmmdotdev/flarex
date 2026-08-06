import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { deriveCandidateBoundRuntimeTargetCommitmentV1 } from
  "../src/artifactRuntime/CandidateBoundRuntimeTargetCommitment";
import { makeLiveDeclarativeV2RuntimeArtifactSha256V1 } from
  "../src/artifactRuntime/DeclarativeV2RuntimeArtifactSha256";
import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SHA256_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "../src/artifactRuntime/FunctionApiCore.generated";
import { POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationInternalCallExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationInternalQueryExactRuntimeWorkerCore.generated";
import { POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointQueryExactRuntimeWorkerCore.generated";
import { POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointQueryInternalCallExactRuntimeWorkerCore.generated";
import { pointMutationInternalCallExactRuntimeWorkerGraphBasisV1 } from
  "../src/artifactRuntime/PointMutationInternalCallExactRuntimeHost";
import { pointMutationInternalQueryExactRuntimeWorkerGraphBasisV1 } from
  "../src/artifactRuntime/PointMutationInternalQueryExactRuntimeHost";
import { pointQueryInternalCallExactRuntimeWorkerGraphBasisV1 } from
  "../src/artifactRuntime/PointQueryInternalCallExactRuntimeHost";

describe("generated function API core", () => {
  it("pins the deterministic shared support-module source", () => {
    expect(FUNCTION_API_CORE_MODULE_V1).toBe("flarex:function-api-core/v1");
    expect(createHash("sha256").update(
      FUNCTION_API_CORE_SOURCE_V1,
      "utf8",
    ).digest("hex")).toBe(FUNCTION_API_CORE_SHA256_V1);
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimeDatabaseContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "const clone = globalThis.structuredClone",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimeRunQueryContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createMutationFunctionRuntimeContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).not.toContain(
      "createQueryFunctionRuntimeContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).not.toContain(
      "createQueryFunctionRuntimeBaseContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).not.toContain(
      "createMutationFunctionRuntimeBaseContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimePointReaderV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimePointDatabaseWriterV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimeApplicationErrorRegistryV1",
    );
  });

  it("commits the same support identity into all selected graphs", () => {
    const supportIdentity = JSON.stringify([
      FUNCTION_API_CORE_MODULE_V1,
      FUNCTION_API_CORE_SHA256_V1,
    ]);
    const queryBasis = pointQueryInternalCallExactRuntimeWorkerGraphBasisV1({
      compatibilityDate: "2026-06-18",
      artifactExecutionModule: "application.js",
      exportName: "read",
      functionPath: "application:read",
      internalQueryCatalog: Object.freeze([]),
    });
    const mutationBasis = pointMutationInternalCallExactRuntimeWorkerGraphBasisV1({
      compatibilityDate: "2026-06-18",
      artifactExecutionModule: "application.js",
      exportName: "write",
      functionPath: "application:write",
      internalFunctionCatalog: Object.freeze([]),
    });
    const mutationInternalQueryBasis =
      pointMutationInternalQueryExactRuntimeWorkerGraphBasisV1({
        compatibilityDate: "2026-06-18",
        artifactExecutionModule: "application.js",
        exportName: "write",
        functionPath: "application:write",
        internalQueryCatalog: Object.freeze([]),
      });

    expect(queryBasis).toContain(supportIdentity);
    expect(mutationBasis).toContain(supportIdentity);
    expect(mutationInternalQueryBasis).toContain(supportIdentity);
  });

  it.each([
    ["query", POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1],
    ["query-internal-call", POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1],
    ["mutation", POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1],
    ["mutation-internal-query", POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1],
    ["mutation-internal-call", POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1],
  ] as const)("uses the shared auth facade in the %s exact runtime", (
    _profile,
    source,
  ) => {
    expect(source).toContain("createFunctionRuntimeAuthV1(");
    expect(source).not.toContain("getUserIdentity: async");
    expect(source).not.toContain("cloneUserIdentityV1");
  });

  it("uses the shared point database facades in both top-level runtimes", () => {
    expect(POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimePointReaderV1(",
    );
    expect(POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimePointReaderV1(",
    );
    expect(POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1).toContain(
      "createFunctionRuntimePointDatabaseWriterV1(",
    );
    for (const source of [
      POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    ]) {
      expect(source).toContain("createFunctionRuntimeDatabaseContextV1(");
      expect(source).not.toContain('unsupported("ctx.db.query")');
      expect(source).not.toContain('unsupported("ctx.db.normalizeId")');
      expect(source).not.toContain("system: Object.freeze({})");
    }
    for (const negativeCapability of [
      'unsupported("ctx.runQuery")',
      'unsupported("ctx.runMutation")',
      "scheduler: Object.freeze",
      "storage: Object.freeze",
    ]) {
      expect(POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1)
        .not.toContain(negativeCapability);
    }
  });

  it("installs query globals before loading dynamic modules", () => {
    for (const source of [
      POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    ]) {
      const globalsInstallIndex = source.indexOf("installExactGlobals();");
      const executionImportIndex = source.indexOf(
        "const executionModulePromise = import(",
      );
      const kernelImportIndex = source.indexOf(
        "const runtimeKernelPromise = import(",
      );
      for (const capture of [
        "const nativeStructuredClone = globalThis.structuredClone",
        "const nativeDate = globalThis.Date",
        "const nativeMath = globalThis.Math",
        "const defineProperty = Object.defineProperty",
        "const getPrototypeOf = Object.getPrototypeOf",
        "const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor",
        "const reflectConstruct = Reflect.construct",
        "const freeze = Object.freeze",
      ]) {
        const captureIndex = source.indexOf(capture);
        expect(captureIndex).toBeGreaterThanOrEqual(0);
        expect(globalsInstallIndex).toBeGreaterThan(captureIndex);
      }
      expect(executionImportIndex).toBeGreaterThan(globalsInstallIndex);
      expect(kernelImportIndex).toBeGreaterThan(globalsInstallIndex);
      expect(source).toContain("output[key] = nativeStructuredClone(value)");
      expect(source).not.toContain("output[key] = structuredClone(value)");
    }
  });

  it("uses positive run-query contexts in all exact nested-call runtimes", () => {
    for (const source of [
      POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
      POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
    ]) {
      expect(source).toContain("createFunctionRuntimeRunQueryContextV1(");
      expect(source).not.toContain("createQueryFunctionRuntimeContextV1");
    }
    expect(POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1)
      .toContain("createFunctionRuntimePointReaderV1(");
    expect(POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1)
      .toContain("createFunctionRuntimePointDatabaseWriterV1(");
    for (const negativeCapability of [
      'unsupported("ctx.db.query")',
      'unsupported("ctx.db.normalizeId")',
      'unsupported("ctx.runMutation")',
      "scheduler: Object.freeze",
      "storage: Object.freeze",
    ]) {
      expect(POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1)
        .not.toContain(negativeCapability);
    }
  });

  it.each([
    {
      profile: "query-internal-call",
      discriminator: 0x71,
      graphBasis: () => pointQueryInternalCallExactRuntimeWorkerGraphBasisV1({
        compatibilityDate: "2026-06-18",
        artifactExecutionModule: "application.js",
        exportName: "read",
        functionPath: "application:read",
        internalQueryCatalog: Object.freeze([]),
      }),
    },
    {
      profile: "mutation-internal-query",
      discriminator: 0x69,
      graphBasis: () => pointMutationInternalQueryExactRuntimeWorkerGraphBasisV1({
        compatibilityDate: "2026-06-18",
        artifactExecutionModule: "application.js",
        exportName: "write",
        functionPath: "application:write",
        internalQueryCatalog: Object.freeze([]),
      }),
    },
    {
      profile: "mutation-internal-call",
      discriminator: 0x6d,
      graphBasis: () => pointMutationInternalCallExactRuntimeWorkerGraphBasisV1({
        compatibilityDate: "2026-06-18",
        artifactExecutionModule: "application.js",
        exportName: "write",
        functionPath: "application:write",
        internalFunctionCatalog: Object.freeze([]),
      }),
    },
  ])("derives the $profile target digest from its refreshed graph basis", async ({
    discriminator,
    graphBasis,
  }) => {
    const basis = graphBasis();
    let encodedGraphDigest: Uint8Array | undefined;
    const commitment = await Effect.runPromise(
      deriveCandidateBoundRuntimeTargetCommitmentV1(
        basis,
        1_048_576,
        graphDigest => {
          encodedGraphDigest = new Uint8Array(graphDigest);
          return Result.succeed(Object.freeze({
            canonicalBytes: new Uint8Array([...graphDigest, discriminator]),
          }));
        },
        makeLiveDeclarativeV2RuntimeArtifactSha256V1(),
      ),
    );
    const expectedGraphDigest = createHash("sha256")
      .update(basis, "utf8")
      .digest();
    const expectedCanonicalTarget = new Uint8Array([
      ...expectedGraphDigest,
      discriminator,
    ]);
    const expectedRuntimeTargetDigest = createHash("sha256")
      .update(expectedCanonicalTarget)
      .digest();

    expect(encodedGraphDigest).toEqual(new Uint8Array(expectedGraphDigest));
    expect(commitment.exactRuntimeGraphBasisSha256).toEqual(
      new Uint8Array(expectedGraphDigest),
    );
    expect(commitment.canonicalTargetBytes).toEqual(expectedCanonicalTarget);
    expect(commitment.runtimeTargetSha256).toEqual(
      new Uint8Array(expectedRuntimeTargetDigest),
    );
  });
});
