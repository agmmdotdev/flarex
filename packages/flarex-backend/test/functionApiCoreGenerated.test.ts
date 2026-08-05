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
import { pointMutationInternalCallExactRuntimeWorkerGraphBasisV1 } from
  "../src/artifactRuntime/PointMutationInternalCallExactRuntimeHost";
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
      "createQueryFunctionRuntimeBaseContextV1",
    );
    expect(FUNCTION_API_CORE_SOURCE_V1).toContain(
      "createMutationFunctionRuntimeBaseContextV1",
    );
  });

  it("commits the same support identity into selected query and mutation graphs", () => {
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

    expect(queryBasis).toContain(supportIdentity);
    expect(mutationBasis).toContain(supportIdentity);
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
