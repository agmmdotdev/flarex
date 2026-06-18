import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { R2BackendExecutionArtifactStore } from "../src/artifactStore";
import type { R2BucketLike } from "../src/artifactStore";
import type {
  ActiveDeploymentStatus,
  AnalyzedStartPushRequest,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  PushStatus,
  StartPushRequest,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;

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
    await expect(getActiveDeploymentResponse("push-activation")).resolves.toMatchObject({
      status: 404,
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

  it("keeps public start source-only until backend analysis is configured", async () => {
    const response = await startSourceOnlyPushResponse("push-source-only", {
      sourcePackage: sourcePackage(),
    });
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error:
        "Backend source-package analysis is not configured in this runtime. Use a backend analyzer service before starting a push.",
    });
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
    await expect(response.json()).resolves.toEqual({
      error: `Cannot finish push ${first.pushId} in state superseded.`,
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
      await expect(missingArtifactFinish.json()).resolves.toEqual({
        error: `Execution artifact ${ref.artifactId} is not available in durable storage.`,
      });

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
    await expect(failedFinish.json()).resolves.toEqual({
      error: `Cannot finish push ${failed.pushId} in state failed.`,
    });

    const unknownFinish = await finishPushResponse("push-failed", "missing-push");
    expect(unknownFinish.status).toBe(404);
    await expect(unknownFinish.json()).resolves.toEqual({
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

function candidateCodegenAnalysis(): PushStatus["codegenAnalysis"] {
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
            route: null,
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

function partitionedTeamCodegenAnalysis(): PushStatus["codegenAnalysis"] {
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
  return response.json() as Promise<PushStatus>;
}

async function startPushResponse(
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return startPushResponseWithHarness(harness, deploymentId, body);
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
  return harness.mf.dispatchFetch(
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
  return response.json() as Promise<PushStatus>;
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
  return response.json() as Promise<ActiveDeploymentStatus>;
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
  return response.json() as Promise<PushStatus>;
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
): Promise<Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>> {
  return target.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
}

async function putSchema(deploymentId: string, schema: DeploymentSchema): Promise<void> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/schema`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schema),
    },
  );
  expect(response.ok).toBe(true);
}

async function putFunctions(deploymentId: string, functions: DeploymentFunctions): Promise<void> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/functions`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(functions),
    },
  );
  expect(response.ok).toBe(true);
}

async function getSchema(deploymentId: string): Promise<DeploymentSchema> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/schema`,
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<DeploymentSchema>;
}

async function getFunctions(deploymentId: string): Promise<DeploymentFunctions> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/functions`,
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<DeploymentFunctions>;
}
