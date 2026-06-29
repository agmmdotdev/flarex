import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  parseActiveDeploymentStatus,
  parseFinishPushResponse,
  parsePushStatus,
} from "flarex-protocol/deployment";
import { R2BackendExecutionArtifactStore } from "../src/artifactStore";
import type { R2BucketLike } from "../src/artifactStore";
import type {
  ActiveDeploymentStatus,
  AbandonPushRequest,
  AnalyzedStartPushRequest,
  DeploymentCodegenAnalysis,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  FinishPushResponse,
  PushStatus,
  StartPushRequest,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;
const testDeploymentSchemas = new Map<string, DeploymentSchema>();
const testDeploymentFunctions = new Map<string, DeploymentFunctions>();

beforeAll(async () => {
  harness = await createBackendHarness();
  await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("deployment push lifecycle", () => {
  it("stores a candidate and leaves the active deployment unchanged until finish", async () => {
    await putSchema("push-activation", activeSchema());
    await putFunctions("push-activation", activeFunctions());

    const start = await startPush("push-activation", analyzedPush(candidateSchema(), candidateFunctions()));
    expect(start.state).toBe("analyzed");
    expect(start.analysis?.schema).toEqual(normalizedCandidateSchema());
    expect(start.analysis?.functions).toEqual(candidateFunctions());
    expect(start.codegenAnalysis).toEqual(candidateCodegenAnalysis());

    await expect(getSchema("push-activation")).resolves.toEqual(normalizedActiveSchema());
    await expect(getFunctions("push-activation")).resolves.toEqual(normalizedActiveFunctions());
    await expect(getActiveDeployment("push-activation")).resolves.toMatchObject({
      schemaVersion: 1,
      analysis: { schema: normalizedActiveSchema(), functions: normalizedActiveFunctions() },
    });

    const status = await getPush("push-activation", start.pushId);
    expect(status).toMatchObject({
      pushId: start.pushId,
      state: "analyzed",
      sourcePackage: sourcePackage(),
    });
    expect(status.codegenAnalysis).toEqual(candidateCodegenAnalysis());

    const finish = await finishPush("push-activation", start.pushId);
    expect(finish.state).toBe("activated");
    expect(finish.codegenAnalysis).toEqual(candidateCodegenAnalysis());
    await expect(getSchema("push-activation")).resolves.toEqual(normalizedCandidateSchema());
    await expect(getFunctions("push-activation")).resolves.toEqual(normalizedCandidateFunctions());
    await expect(getActiveDeployment("push-activation")).resolves.toMatchObject({
      activePushId: start.pushId,
      schemaVersion: 2,
      executionArtifactRef: await executionArtifactRefForSourcePackage(sourcePackage()),
      sourcePackage: sourcePackage(),
      analysis: { schema: normalizedCandidateSchema(), functions: candidateFunctions() },
      codegenAnalysis: candidateCodegenAnalysis(),
    });
  });

  it("reads active deployment and push status through public routes", async () => {
    const start = await startPush("push-read-routes", analyzedPush(candidateSchema(), candidateFunctions()));
    await finishPush("push-read-routes", start.pushId);

    await expect(getPush("push-read-routes", start.pushId)).resolves.toMatchObject({
      pushId: start.pushId,
      state: "activated",
      sourcePackage: sourcePackage(),
      codegenAnalysis: candidateCodegenAnalysis(),
    });
    await expect(getActiveDeployment("push-read-routes")).resolves.toMatchObject({
      activePushId: start.pushId,
      schemaVersion: 2,
      executionArtifactRef: await executionArtifactRefForSourcePackage(sourcePackage()),
      analysis: { schema: normalizedCandidateSchema(), functions: candidateFunctions() },
      codegenAnalysis: candidateCodegenAnalysis(),
    });
  });

  it("keeps public start source-only until backend analysis is configured", async () => {
    const invalidJson = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/push-source-only/push/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const response = await startSourceOnlyPushResponse("push-source-only", {
      sourcePackage: sourcePackage(),
    });
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error:
        "Backend source-package analysis is not configured in this runtime. Use a backend analyzer service before starting a push.",
    });

    const invalidSourcePackage = await startSourceOnlyPushResponse("push-source-only", {
      sourcePackage: { ...sourcePackage(), modules: "not-modules" },
    } as unknown as StartPushRequest);
    expect(invalidSourcePackage.status).toBe(501);
    await expect(invalidSourcePackage.json()).resolves.toEqual({
      error:
        "Backend source-package analysis is not configured in this runtime. Use a backend analyzer service before starting a push.",
    });
  });

  it("rejects malformed analyzed push request bodies", async () => {
    const invalidJson = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/push-start-bad-body/push/start-analyzed",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const invalidSourcePackage = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: {
        ...sourcePackage(),
        modules: "not-modules",
      },
      analysis: { schema: candidateSchema(), functions: candidateFunctions() },
    });
    expect(invalidSourcePackage.status).toBe(400);
    await expect(invalidSourcePackage.json()).resolves.toEqual({
      error: "Source package modules must be an array.",
    });

    const invalidDiagnostics = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: sourcePackage(),
      analysis: { schema: candidateSchema(), functions: candidateFunctions() },
      diagnostics: "not-diagnostics",
    });
    expect(invalidDiagnostics.status).toBe(400);
    await expect(invalidDiagnostics.json()).resolves.toEqual({
      error: "Push diagnostics must be an array.",
    });

    const invalidDiagnosticEntry = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: sourcePackage(),
      analysis: { schema: candidateSchema(), functions: candidateFunctions() },
      diagnostics: [{ level: "debug", message: "too chatty" }],
    });
    expect(invalidDiagnosticEntry.status).toBe(400);
    await expect(invalidDiagnosticEntry.json()).resolves.toEqual({
      error: "Push diagnostic at index 0 has an invalid level.",
    });

    const invalidAnalysis = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: sourcePackage(),
      analysis: null,
    });
    expect(invalidAnalysis.status).toBe(400);
    await expect(invalidAnalysis.json()).resolves.toEqual({
      error: "Deployment analysis must be an object.",
    });

    const invalidCodegenAnalysis = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: sourcePackage(),
      analysis: { schema: candidateSchema(), functions: candidateFunctions() },
      codegenAnalysis: null,
    });
    expect(invalidCodegenAnalysis.status).toBe(400);
    await expect(invalidCodegenAnalysis.json()).resolves.toEqual({
      error: "Codegen analysis must be an object.",
    });

    const successWithError = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: sourcePackage(),
      analysis: { schema: candidateSchema(), functions: candidateFunctions() },
      error: "should not be present",
    });
    expect(successWithError.status).toBe(400);
    await expect(successWithError.json()).resolves.toEqual({
      error: "A push with analysis must not include error.",
    });

    const failureWithCodegen = await startPushRawResponse("push-start-bad-body", {
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      codegenAnalysis: candidateCodegenAnalysis(),
    });
    expect(failureWithCodegen.status).toBe(400);
    await expect(failureWithCodegen.json()).resolves.toEqual({
      error: "A push without analysis must not include codegenAnalysis.",
    });
  });

  it("preserves analyzer codegen analysis through source-only push activation", async () => {
    const package_ = sourcePackage();
    const analysis = {
      schema: dualFunctionSchema(),
      functions: dualFunctions(),
    };
    const codegenAnalysis = reversedDualFunctionCodegenAnalysis();
    let analyzerRequest: unknown;
    const analyzerHarness = await createBackendHarness({
      serviceBindings: {
        FLAREX_ANALYZER: async request => {
          analyzerRequest = await request.json();
          return Response.json({
            analysis,
            codegenAnalysis,
            diagnostics: [{ level: "log", message: "analyzed source package" }],
          });
        },
      },
    });
    try {
      const response = await startSourceOnlyPushResponseWithHarness(
        analyzerHarness,
        "push-source-analyzed",
        { sourcePackage: package_ },
      );
      expect(response.ok).toBe(true);
      const started = parsePushStatus(await response.json()) as PushStatus;

      expect(analyzerRequest).toEqual({
        deploymentId: "push-source-analyzed",
        sourcePackage: package_,
      });
      expect(started.state).toBe("analyzed");
      expect(started.codegenAnalysis).toEqual(codegenAnalysis);
      expect(started.diagnostics).toEqual([{ level: "log", message: "analyzed source package" }]);

      const activated = await finishPushWithHarness(
        analyzerHarness,
        "push-source-analyzed",
        started.pushId,
      );
      expect(activated.codegenAnalysis).toEqual(codegenAnalysis);
      await expect(getActiveDeploymentWithHarness(analyzerHarness, "push-source-analyzed"))
        .resolves
        .toMatchObject({ codegenAnalysis });
    } finally {
      await analyzerHarness.dispose();
    }
  });

  it("rejects malformed source-only push bodies when analyzer forwarding is configured", async () => {
    const analyzerHarness = await createBackendHarness({
      serviceBindings: {
        FLAREX_ANALYZER: async () => Response.json({
          analysis: {
            schema: dualFunctionSchema(),
            functions: dualFunctions(),
          },
          codegenAnalysis: reversedDualFunctionCodegenAnalysis(),
        }),
      },
    });
    try {
      const invalidJson = await analyzerHarness.mf.dispatchFetch(
        "http://flarex.test/deployments/push-source-only-bad-body/push/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        },
      );
      expect(invalidJson.status).toBe(400);
      await expect(invalidJson.json()).resolves.toEqual({
        error: "Request body must be JSON.",
      });

      const invalidSourcePackage = await startSourceOnlyPushResponseWithHarness(
        analyzerHarness,
        "push-source-only-bad-body",
        { sourcePackage: { ...sourcePackage(), modules: "not-modules" } } as unknown as StartPushRequest,
      );
      expect(invalidSourcePackage.status).toBe(400);
      await expect(invalidSourcePackage.json()).resolves.toEqual({
        error: "Start push request must include a valid sourcePackage.",
      });
    } finally {
      await analyzerHarness.dispose();
    }
  });

  it("fails source-only push when analyzer success omits codegen analysis", async () => {
    const analyzerHarness = await createBackendHarness({
      serviceBindings: {
        FLAREX_ANALYZER: async () =>
          Response.json({
            analysis: {
              schema: dualFunctionSchema(),
              functions: dualFunctions(),
            },
          }),
      },
    });
    try {
      const response = await startSourceOnlyPushResponseWithHarness(
        analyzerHarness,
        "push-missing-codegen",
        { sourcePackage: sourcePackage() },
      );
      expect(response.ok).toBe(true);
      const started = parsePushStatus(await response.json()) as PushStatus;

      expect(started.state).toBe("failed");
      expect(started.error).toBe("Backend analyzer response did not include codegenAnalysis.");
      expect(started.codegenAnalysis).toBeUndefined();
    } finally {
      await analyzerHarness.dispose();
    }
  });

  it("fails source-only push when analyzer success returns null codegen analysis", async () => {
    const analyzerHarness = await createBackendHarness({
      serviceBindings: {
        FLAREX_ANALYZER: async () =>
          Response.json({
            analysis: {
              schema: dualFunctionSchema(),
              functions: dualFunctions(),
            },
            codegenAnalysis: null,
          }),
      },
    });
    try {
      const response = await startSourceOnlyPushResponseWithHarness(
        analyzerHarness,
        "push-null-codegen",
        { sourcePackage: sourcePackage() },
      );
      expect(response.ok).toBe(true);
      const started = parsePushStatus(await response.json()) as PushStatus;

      expect(started.state).toBe("failed");
      expect(started.error).toBe("Analyzer request failed with status 200");
      expect(started.codegenAnalysis).toBeUndefined();
    } finally {
      await analyzerHarness.dispose();
    }
  });

  it("rejects malformed analyzer analysis objects without a worker 500", async () => {
    const analyzerHarness = await createBackendHarness({
      serviceBindings: {
        FLAREX_ANALYZER: async () =>
          Response.json({
            analysis: null,
            codegenAnalysis: reversedDualFunctionCodegenAnalysis(),
          }),
      },
    });
    try {
      const response = await startSourceOnlyPushResponseWithHarness(
        analyzerHarness,
        "push-null-analysis",
        { sourcePackage: sourcePackage() },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Deployment analysis must be an object.",
      });
    } finally {
      await analyzerHarness.dispose();
    }
  });

  it("rejects codegen analysis that disagrees with deployment metadata", async () => {
    const badCodegenAnalysis = reversedDualFunctionCodegenAnalysis();
    badCodegenAnalysis.functions[0]!.functions[0] = {
      ...badCodegenAnalysis.functions[0]!.functions[0]!,
      kind: "mutation",
    };

    const response = await startPushResponse("push-bad-codegen", {
      sourcePackage: sourcePackage(),
      analysis: { schema: dualFunctionSchema(), functions: dualFunctions() },
      codegenAnalysis: badCodegenAnalysis,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Codegen function lessons:b must match deployment function metadata.",
    });
  });

  it("rejects codegen analysis with mismatched source positions", async () => {
    const badCodegenAnalysis = candidateCodegenAnalysis();
    badCodegenAnalysis.functions[0]!.functions[0] = {
      ...badCodegenAnalysis.functions[0]!.functions[0]!,
      position: { path: "other.ts", startLine: 3, startColumn: 1 },
    };

    const response = await startPushResponse("push-bad-codegen-position", {
      sourcePackage: sourcePackage(),
      analysis: { schema: candidateSchema(), functions: candidateFunctions() },
      codegenAnalysis: badCodegenAnalysis,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Codegen function lessons:list must match deployment function metadata.",
    });
  });

  it("rejects duplicate codegen module entries", async () => {
    const badCodegenAnalysis = reversedDualFunctionCodegenAnalysis();
    badCodegenAnalysis.functions = [
      {
        moduleName: "lessons",
        functions: [badCodegenAnalysis.functions[0]!.functions[0]!],
      },
      {
        moduleName: "lessons",
        functions: [badCodegenAnalysis.functions[0]!.functions[1]!],
      },
    ];

    const response = await startPushResponse("push-duplicate-codegen-module", {
      sourcePackage: sourcePackage(),
      analysis: { schema: dualFunctionSchema(), functions: dualFunctions() },
      codegenAnalysis: badCodegenAnalysis,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Duplicate codegen module metadata: lessons.",
    });
  });

  it("does not expose legacy direct schema or functions metadata routes", async () => {
    for (const path of ["schema", "functions"]) {
      const response = await harness.mf.dispatchFetch(
        `http://flarex.test/deployments/no-direct-metadata/${path}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Not found." });
    }
  });

  it("supersedes previous pending or analyzed pushes", async () => {
    const first = await startPush("push-supersede", analyzedPush(activeSchema(), activeFunctions()));
    const second = await startPush("push-supersede", analyzedPush(candidateSchema(), candidateFunctions()));

    await expect(getPush("push-supersede", first.pushId)).resolves.toMatchObject({
      pushId: first.pushId,
      state: "superseded",
    });
    await expect(getPush("push-supersede", second.pushId)).resolves.toMatchObject({
      pushId: second.pushId,
      state: "analyzed",
    });

    const activated = await finishPush("push-supersede", second.pushId);
    await expect(getActiveDeployment("push-supersede")).resolves.toMatchObject({
      activePushId: activated.pushId,
      schemaVersion: 2,
      executionArtifactRef: await executionArtifactRefForSourcePackage(sourcePackage()),
    });

    const response = await finishPushResponse("push-supersede", first.pushId);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      result: "rejected",
      error: `Cannot finish push ${first.pushId} in state superseded.`,
      push: {
        pushId: first.pushId,
        state: "superseded",
      },
    });
    await expect(getActiveDeployment("push-supersede")).resolves.toMatchObject({
      activePushId: activated.pushId,
      schemaVersion: 2,
      executionArtifactRef: await executionArtifactRefForSourcePackage(sourcePackage()),
    });
  });

  it("moves the active execution artifact reference with each activated push", async () => {
    const firstPackage = sourcePackage("d".repeat(64));
    const first = await startPush(
      "push-artifact-ref",
      analyzedPush(activeSchema(), activeFunctions(), firstPackage),
    );
    await finishPush("push-artifact-ref", first.pushId);
    const firstActive = await getActiveDeployment("push-artifact-ref");
    expect(firstActive).toMatchObject({
      activePushId: first.pushId,
      executionArtifactRef: await executionArtifactRefForSourcePackage(firstPackage),
    });

    const secondPackage = sourcePackage("e".repeat(64));
    const second = await startPush(
      "push-artifact-ref",
      analyzedPush(candidateSchema(), candidateFunctions(), secondPackage),
    );
    await finishPush("push-artifact-ref", second.pushId);
    const secondActive = await getActiveDeployment("push-artifact-ref");

    expect(secondActive).toMatchObject({
      activePushId: second.pushId,
      executionArtifactRef: await executionArtifactRefForSourcePackage(secondPackage),
    });
    expect(secondActive.executionArtifactRef).not.toEqual(firstActive.executionArtifactRef);
  });

  it("persists partition selector metadata from analyzed push metadata", async () => {
    const start = await startPush(
      "push-partition-metadata",
      analyzedPush(partitionedTeamSchema(), partitionedTeamFunctions()),
    );

    await finishPush("push-partition-metadata", start.pushId);

    await expect(getFunctions("push-partition-metadata")).resolves.toEqual(
      normalizedPartitionedTeamFunctions(),
    );
    await expect(getActiveDeployment("push-partition-metadata")).resolves.toMatchObject({
      analysis: {
        schema: normalizedPartitionedTeamSchema(),
        functions: partitionedTeamFunctions(),
      },
      codegenAnalysis: partitionedTeamCodegenAnalysis(),
    });
  });

  it("rejects partition selector metadata that disagrees with schema placement", async () => {
    const response = await startPushResponse(
      "push-invalid-partition-selector",
      analyzedPush(partitionedTeamSchema(), {
        functions: [
          {
            ...partitionedTeamFunctions().functions[0]!,
            partition: {
              type: "partition",
              table: "teams",
              selector: "byId",
              partitionField: "_id",
              argField: "teamId",
            },
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "teams:create.partition: Selector byId targets _id, but teams is partitioned by slug.",
    });
  });

  it("rejects partition metadata whose argument does not match route metadata", async () => {
    const response = await startPushResponse(
      "push-invalid-partition-route",
      analyzedPush(partitionedTeamSchema(), {
        functions: [
          {
            ...partitionedTeamFunctions().functions[0]!,
            route: { type: "args", field: "differentSlug" },
            args: {
              type: "object",
              value: {
                teamSlug: { fieldType: { type: "string" }, optional: false },
                differentSlug: { fieldType: { type: "string" }, optional: false },
              },
            },
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "teams:create.partition: partition argument teamSlug must match route argument differentSlug.",
    });
  });

  it("requires durable artifact storage before public finish when R2 is configured", async () => {
    const r2Harness = await createBackendHarness({ r2Buckets: ["ARTIFACTS"] });
    try {
      const package_ = sourcePackage();
      const start = await startPushWithHarness(
        r2Harness,
        "push-stored-artifact",
        analyzedPush(candidateSchema(), candidateFunctions(), package_),
      );

      const missingArtifactFinish = await finishPushResponseWithHarness(
        r2Harness,
        "push-stored-artifact",
        start.pushId,
      );
      const ref = await executionArtifactRefForSourcePackage(package_);
      expect(missingArtifactFinish.status).toBe(409);
      const missingArtifactBody: unknown = await missingArtifactFinish.json();
      const expectedMissingArtifactBody = {
        result: "rejected",
        push: {
          ...start,
        },
        code: "missing_artifact",
        error: `Execution artifact ${ref.artifactId} is not available in durable storage.`,
      } satisfies Extract<FinishPushResponse, { result: "rejected" }>;
      expect(missingArtifactBody).toEqual(expectedMissingArtifactBody);

      const invalidBodyMissingArtifactFinish = await finishPushResponseWithHarness(
        r2Harness,
        "push-stored-artifact",
        start.pushId,
        { activate: "yes" },
      );
      expect(invalidBodyMissingArtifactFinish.status).toBe(409);
      await expect(invalidBodyMissingArtifactFinish.json()).resolves.toEqual(expectedMissingArtifactBody);

      const bucket = await r2Harness.mf.getR2Bucket("ARTIFACTS");
      await new R2BackendExecutionArtifactStore(bucket as unknown as R2BucketLike).put(package_);

      const finish = await finishPushWithHarness(
        r2Harness,
        "push-stored-artifact",
        start.pushId,
      );
      expect(finish.state).toBe("activated");
      await expect(getActiveDeploymentWithHarness(r2Harness, "push-stored-artifact"))
        .resolves.toMatchObject({
          activePushId: start.pushId,
          executionArtifactRef: ref,
        });
    } finally {
      await r2Harness.dispose();
    }
  });

  it("does not activate failed or unknown pushes", async () => {
    const failed = await startPush("push-failed", {
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      diagnostics: [{ level: "error", message: "import failed" }],
    });
    expect(failed.state).toBe("failed");
    expect(failed.diagnostics).toEqual([{ level: "error", message: "import failed" }]);
    await expect(getPush("push-failed", failed.pushId)).resolves.toMatchObject({
      diagnostics: [{ level: "error", message: "import failed" }],
    });

    const failedFinish = await finishPushResponse("push-failed", failed.pushId);
    expect(failedFinish.status).toBe(409);
    await expect(failedFinish.json()).resolves.toMatchObject({
      result: "rejected",
      code: "invalid_state",
      error: `Cannot finish push ${failed.pushId} in state failed.`,
      push: {
        pushId: failed.pushId,
        state: "failed",
        error: "analysis failed",
      },
      diagnostics: [{ level: "error", message: "import failed" }],
    });

    const unknownFinish = await finishPushResponse("push-failed", "missing-push");
    expect(unknownFinish.status).toBe(404);
    await expect(unknownFinish.json()).resolves.toEqual({
      error: "Unknown push: missing-push",
    });
  });

  it("rejects malformed finish request bodies", async () => {
    const start = await startPush("push-finish-bad-body", analyzedPush(candidateSchema(), candidateFunctions()));

    const invalidJson = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/push-finish-bad-body/push/${start.pushId}/finish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const nullBody = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/push-finish-bad-body/push/${start.pushId}/finish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(null),
      },
    );
    expect(nullBody.status).toBe(400);
    await expect(nullBody.json()).resolves.toEqual({
      error: "Finish push request must be an object.",
    });

    const invalidActivate = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/push-finish-bad-body/push/${start.pushId}/finish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activate: "yes" }),
      },
    );
    expect(invalidActivate.status).toBe(400);
    await expect(invalidActivate.json()).resolves.toEqual({
      error: "Finish push activate flag must be a boolean.",
    });
  });

  it("abandons analyzed pushes without activating them", async () => {
    await putSchema("push-abandon", activeSchema());
    await putFunctions("push-abandon", activeFunctions());

    const start = await startPush("push-abandon", analyzedPush(candidateSchema(), candidateFunctions()));
    const abandoned = await abandonPush("push-abandon", start.pushId, {
      reason: "generated output typecheck failed",
    });

    expect(abandoned).toMatchObject({
      pushId: start.pushId,
      state: "abandoned",
      error: "generated output typecheck failed",
    });
    await expect(getPush("push-abandon", start.pushId)).resolves.toMatchObject({
      state: "abandoned",
      error: "generated output typecheck failed",
    });
    await expect(getSchema("push-abandon")).resolves.toEqual(normalizedActiveSchema());
    await expect(getFunctions("push-abandon")).resolves.toEqual(normalizedActiveFunctions());
    await expect(getActiveDeployment("push-abandon")).resolves.toMatchObject({
      schemaVersion: 1,
      analysis: { schema: normalizedActiveSchema(), functions: normalizedActiveFunctions() },
    });

    const finish = await finishPushResponse("push-abandon", start.pushId);
    expect(finish.status).toBe(409);
    await expect(finish.json()).resolves.toMatchObject({
      result: "rejected",
      code: "invalid_state",
      error: `Cannot finish push ${start.pushId} in state abandoned.`,
      push: {
        pushId: start.pushId,
        state: "abandoned",
        error: "generated output typecheck failed",
      },
    });
  });

  it("normalizes abandon reasons through the deployment service from public routes", async () => {
    const defaultReasonStart = await startPush(
      "push-abandon-default-reason",
      analyzedPush(candidateSchema(), candidateFunctions()),
    );
    const defaultReasonAbandoned = await abandonPush("push-abandon-default-reason", defaultReasonStart.pushId);

    expect(defaultReasonAbandoned).toMatchObject({
      pushId: defaultReasonStart.pushId,
      state: "abandoned",
      error: "Push abandoned before activation.",
    });

    const longReasonStart = await startPush(
      "push-abandon-long-reason",
      analyzedPush(candidateSchema(), candidateFunctions()),
    );
    const longReasonAbandoned = await abandonPush("push-abandon-long-reason", longReasonStart.pushId, {
      reason: "x".repeat(1_100),
    });

    expect(longReasonAbandoned).toMatchObject({
      pushId: longReasonStart.pushId,
      state: "abandoned",
      error: "x".repeat(1_000),
    });
  });

  it("rejects malformed abandon request bodies", async () => {
    const start = await startPush("push-abandon-bad-body", analyzedPush(candidateSchema(), candidateFunctions()));

    const invalidJson = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/push-abandon-bad-body/push/${start.pushId}/abandon`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const nullBody = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/push-abandon-bad-body/push/${start.pushId}/abandon`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(null),
      },
    );
    expect(nullBody.status).toBe(400);
    await expect(nullBody.json()).resolves.toEqual({
      error: "Abandon push request must be an object.",
    });

    const invalidReason = await abandonPushResponse("push-abandon-bad-body", start.pushId, {
      reason: 123,
    });
    expect(invalidReason.status).toBe(400);
    await expect(invalidReason.json()).resolves.toEqual({
      error: "Abandon push reason must be a string.",
    });
  });

  it("abandons public push routes with encoded push IDs", async () => {
    const start = await startPush("push-abandon-encoded", analyzedPush(candidateSchema(), candidateFunctions()));
    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/push-abandon-encoded/push/${encodeURIComponent(start.pushId)}/abandon`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "encoded route" }),
      },
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      pushId: start.pushId,
      state: "abandoned",
      error: "encoded route",
    });
  });

  it("does not abandon activated or unknown pushes", async () => {
    const start = await startPush("push-abandon-terminal", analyzedPush(candidateSchema(), candidateFunctions()));
    await finishPush("push-abandon-terminal", start.pushId);

    const activatedAbandon = await abandonPushResponse("push-abandon-terminal", start.pushId);
    expect(activatedAbandon.status).toBe(409);
    await expect(activatedAbandon.json()).resolves.toEqual({
      error: `Cannot abandon push ${start.pushId} in state activated.`,
    });

    const unknownAbandon = await abandonPushResponse("push-abandon-terminal", "missing-push");
    expect(unknownAbandon.status).toBe(404);
    await expect(unknownAbandon.json()).resolves.toEqual({
      error: "Unknown push: missing-push",
    });
  });
});

function analyzedPush(
  schema: DeploymentSchema,
  functions: DeploymentFunctions,
  package_: StartPushRequest["sourcePackage"] = sourcePackage(),
): AnalyzedStartPushRequest {
  return {
    sourcePackage: package_,
    analysis: { schema, functions },
  };
}

function sourcePackage(functionModuleHash = "c".repeat(64)): StartPushRequest["sourcePackage"] {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "_flarex/schema.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export default {};",
      },
      {
        path: "lessons.js",
        environment: "isolate",
        sha256: functionModuleHash,
        source: "export const list = {};",
      },
    ],
    functions: ["lessons.js"],
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}

function activeSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "active",
        validator: { type: "object", value: {} },
        placement: { kind: "partitionBy", field: "_id" },
      },
    ],
    indexes: [],
  };
}

function normalizedActiveSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [{ ...activeSchema().tables[0]!, state: "active" }],
    indexes: [],
  };
}

function candidateSchema(): DeploymentSchema {
  return {
    version: 2,
    tables: [
      {
        tableId: 1,
        name: "lessonProgress",
        validator: {
          type: "object",
          value: {
            userId: { fieldType: { type: "string" }, optional: false },
          },
        },
        placement: { kind: "colocateWith", table: "users", field: "userId" },
      },
    ],
    indexes: [
      {
        indexId: 1,
        tableId: 1,
        name: "by_user",
        fields: ["userId"],
      },
    ],
  };
}

function normalizedCandidateSchema(): DeploymentSchema {
  return {
    version: 2,
    tables: [{ ...candidateSchema().tables[0]!, state: "active" }],
    indexes: [{ ...candidateSchema().indexes[0]!, state: "enabled" }],
  };
}

function activeFunctions(): DeploymentFunctions {
  return { functions: [{ path: "active:list", kind: "query" }] };
}

function normalizedActiveFunctions(): DeploymentFunctions {
  return {
    functions: [
      {
        path: "active:list",
        kind: "query",
        visibility: "public",
        args: null,
        returns: null,
        route: null,
        partition: null,
      },
    ],
  };
}

function candidateFunctions(): DeploymentFunctions {
  return {
    functions: [
      {
        path: "lessons:list",
        kind: "query",
        visibility: "internal",
        args: { type: "object", value: {} },
        returns: { type: "array", value: { type: "string" } },
        route: null,
        partition: null,
        position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
      },
    ],
  };
}

function normalizedCandidateFunctions(): DeploymentFunctions {
  return candidateFunctions();
}

function candidateCodegenAnalysis(): DeploymentCodegenAnalysis {
  return {
    schema: normalizedCandidateSchema(),
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "list",
            kind: "query",
            visibility: "internal",
            args: { type: "object", value: {} },
            returns: { type: "array", value: { type: "string" } },
            partition: null,
            position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
          },
        ],
      },
    ],
  };
}

function partitionedTeamSchema(): DeploymentSchema {
  return {
    version: 3,
    tables: [
      {
        tableId: 1,
        name: "teams",
        validator: {
          type: "object",
          value: {
            slug: { fieldType: { type: "string" }, optional: false },
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
        placement: { kind: "partitionBy", field: "slug" },
      },
    ],
    indexes: [],
  };
}

function normalizedPartitionedTeamSchema(): DeploymentSchema {
  return {
    ...partitionedTeamSchema(),
    tables: [{ ...partitionedTeamSchema().tables[0]!, state: "active" }],
  };
}

function partitionedTeamFunctions(): DeploymentFunctions {
  return {
    functions: [
      {
        path: "teams:create",
        kind: "mutation",
        visibility: "public",
        args: {
          type: "object",
          value: {
            teamSlug: { fieldType: { type: "string" }, optional: false },
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
        returns: null,
        route: { type: "args", field: "teamSlug" },
        partition: {
          type: "partition",
          table: "teams",
          selector: "bySlug",
          partitionField: "slug",
          argField: "teamSlug",
        },
      },
    ],
  };
}

function normalizedPartitionedTeamFunctions(): DeploymentFunctions {
  return partitionedTeamFunctions();
}

function partitionedTeamCodegenAnalysis(): DeploymentCodegenAnalysis {
  return {
    schema: normalizedPartitionedTeamSchema(),
    functions: [
      {
        moduleName: "teams",
        functions: [
          {
            moduleName: "teams",
            exportName: "create",
            kind: "mutation",
            visibility: "public",
            args: partitionedTeamFunctions().functions[0]!.args!,
            returns: null,
            partition: {
              type: "partition",
              table: "teams",
              selector: "bySlug",
              partitionField: "slug",
              argField: "teamSlug",
            },
          },
        ],
      },
    ],
  };
}

function dualFunctionSchema(): DeploymentSchema {
  return {
    version: 4,
    tables: [],
    indexes: [],
  };
}

function normalizedDualFunctionSchema(): DeploymentSchema {
  return {
    version: 4,
    tables: [],
    indexes: [],
  };
}

function dualFunctions(): DeploymentFunctions {
  return {
    functions: [
      {
        path: "lessons:a",
        kind: "query",
        visibility: "public",
        args: { type: "object", value: {} },
        returns: null,
        route: null,
        partition: null,
      },
      {
        path: "lessons:b",
        kind: "query",
        visibility: "public",
        args: { type: "object", value: {} },
        returns: null,
        route: null,
        partition: null,
      },
    ],
  };
}

function reversedDualFunctionCodegenAnalysis(): DeploymentCodegenAnalysis {
  return {
    schema: normalizedDualFunctionSchema(),
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "b",
            kind: "query",
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
            partition: null,
          },
          {
            moduleName: "lessons",
            exportName: "a",
            kind: "query",
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
            partition: null,
          },
        ],
      },
    ],
  };
}

async function startPush(deploymentId: string, body: AnalyzedStartPushRequest): Promise<PushStatus> {
  return startPushWithHarness(harness, deploymentId, body);
}

async function startPushWithHarness(
  target: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<PushStatus> {
  const response = await startPushResponseWithHarness(target, deploymentId, body);
  expect(response.ok).toBe(true);
  return parsePushStatus(await response.json()) as PushStatus;
}

async function startPushResponse(
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return startPushResponseWithHarness(harness, deploymentId, body);
}

async function startPushRawResponse(
  deploymentId: string,
  body: unknown,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return startPushResponseWithHarness(harness, deploymentId, body as AnalyzedStartPushRequest);
}

async function startPushResponseWithHarness(
  target: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return target.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function startSourceOnlyPushResponse(
  deploymentId: string,
  body: StartPushRequest,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return startSourceOnlyPushResponseWithHarness(harness, deploymentId, body);
}

async function startSourceOnlyPushResponseWithHarness(
  target: BackendHarness,
  deploymentId: string,
  body: StartPushRequest,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return target.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function getPush(deploymentId: string, pushId: string): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}`,
  );
  expect(response.ok).toBe(true);
  return parsePushStatus(await response.json()) as PushStatus;
}

async function getActiveDeployment(deploymentId: string): Promise<ActiveDeploymentStatus> {
  return getActiveDeploymentWithHarness(harness, deploymentId);
}

async function getActiveDeploymentWithHarness(
  target: BackendHarness,
  deploymentId: string,
): Promise<ActiveDeploymentStatus> {
  const response = await getActiveDeploymentResponseWithHarness(target, deploymentId);
  expect(response.ok).toBe(true);
  return parseActiveDeploymentStatus(await response.json()) as ActiveDeploymentStatus;
}

async function getActiveDeploymentResponse(
  deploymentId: string,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return getActiveDeploymentResponseWithHarness(harness, deploymentId);
}

async function getActiveDeploymentResponseWithHarness(
  target: BackendHarness,
  deploymentId: string,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return target.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/deployment`,
  );
}

async function finishPush(deploymentId: string, pushId: string): Promise<PushStatus> {
  return finishPushWithHarness(harness, deploymentId, pushId);
}

async function finishPushWithHarness(
  target: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<PushStatus> {
  const response = await finishPushResponseWithHarness(target, deploymentId, pushId);
  expect(response.ok).toBe(true);
  const body = parseFinishPushResponse(await response.json()) as FinishPushResponse;
  expect(body.result).toBe("activated");
  return body.push;
}

async function finishPushResponse(
  deploymentId: string,
  pushId: string,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return finishPushResponseWithHarness(harness, deploymentId, pushId);
}

async function finishPushResponseWithHarness(
  target: BackendHarness,
  deploymentId: string,
  pushId: string,
  body: unknown = {},
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return target.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function abandonPush(
  deploymentId: string,
  pushId: string,
  body: AbandonPushRequest = {},
): Promise<PushStatus> {
  const response = await abandonPushResponse(deploymentId, pushId, body);
  expect(response.ok).toBe(true);
  return parsePushStatus(await response.json()) as PushStatus;
}

async function abandonPushResponse(
  deploymentId: string,
  pushId: string,
  body: unknown = {},
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/abandon`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function putSchema(deploymentId: string, schema: DeploymentSchema): Promise<void> {
  testDeploymentSchemas.set(deploymentId, schema);
  await activateTestDeployment(deploymentId);
}

async function putFunctions(deploymentId: string, functions: DeploymentFunctions): Promise<void> {
  testDeploymentFunctions.set(deploymentId, functions);
  await activateTestDeployment(deploymentId);
}

async function getSchema(deploymentId: string): Promise<DeploymentSchema> {
  return (await getActiveDeployment(deploymentId)).analysis.schema;
}

async function getFunctions(deploymentId: string): Promise<DeploymentFunctions> {
  return (await getActiveDeployment(deploymentId)).analysis.functions;
}

async function activateTestDeployment(deploymentId: string): Promise<void> {
  const schema = testDeploymentSchemas.get(deploymentId) ?? {
    version: 1,
    tables: [],
    indexes: [],
  };
  const functions = testDeploymentFunctions.get(deploymentId) ?? { functions: [] };
  const start = await startPush(deploymentId, analyzedPush(schema, functions));
  await finishPush(deploymentId, start.pushId);
}
