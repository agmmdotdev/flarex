import type {
  GetActiveDeploymentPackageInput,
  RerunStaleLiveQuerySubscriptionsInput,
  RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";
import { Effect } from "effect";
import {
  executionArtifactRefForSourcePackage,
  type ExecutionArtifactRef,
} from "flarex/artifacts";
import {
  decodeExecutionArtifactInvokePayloadBodyEffect,
  executionArtifactInvokePayload,
  materializedExecutionArtifactInvokePayload,
  type ExecutionArtifactInvokePayload,
} from "flarex-protocol/artifact-runtime";
import {
  type ExecutionArtifactMaterializer,
  type MaterializedExecutionArtifact,
  type MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import {
  createBackendHarness,
  type BackendHarness,
} from "flarex-backend/test/backendHarness";
import {
  finishPush,
  getActiveDeployment,
  type LifecycleQueryInvokeRequest,
  startSourceOnlyPush,
  testLifecycleAnalysis,
  testLifecycleCodegenAnalysis,
  testLifecycleInvokeRequest,
  testLifecycleSourcePackage,
} from "flarex-backend/test/lifecycleFixture";
import type {
  PushSourcePackage,
} from "flarex-backend/types";
import { afterAll, describe, expect, it } from "vitest";

import { createLocalExecutorHttpRuntime } from "../src/executorHttpRuntime";
import {
  emptyFreshnessStore,
  fakeExecutor,
  jsonRequest,
  liveQueryAttemptForRequest,
  sourcePackageJson,
} from "./localRuntimeFixture";

describe("execution artifact lifecycle parity", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("uses the same artifact ref and invoke payload contract for local and hosted runtime paths", async () => {
    const deploymentId = "deployment-lifecycle-parity";
    const projectId = "project-lifecycle-parity";
    const sourcePackage = testLifecycleSourcePackage();
    const request = testLifecycleInvokeRequest();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);

    const localPayload = await materializeLocalPayload({
      deploymentId,
      projectId,
      ref,
      request,
      sourcePackage,
    });
    const hostedPayload = await invokeHostedPayload({
      deploymentId,
      projectId,
      request,
      sourcePackage,
      harnesses,
    });

    const expectedHostedPayload = executionArtifactInvokePayload({
      deploymentId,
      ref,
      request,
    });
    const expectedLocalPayload = materializedExecutionArtifactInvokePayload({
      deploymentId,
      ref,
      sourcePackage,
      request,
    });

    expect(localPayload).toEqual(expectedLocalPayload);
    expect(hostedPayload).toEqual(expectedHostedPayload);
    expect(refOnlyPayload(localPayload)).toEqual(hostedPayload);
    expect(Object.prototype.hasOwnProperty.call(hostedPayload, "sourcePackage")).toBe(false);
  });
});

async function materializeLocalPayload(options: {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly ref: ExecutionArtifactRef;
  readonly request: LifecycleQueryInvokeRequest;
  readonly sourcePackage: PushSourcePackage;
}): Promise<MaterializedExecutionArtifactPayload> {
  const materializedPayloads: MaterializedExecutionArtifactPayload[] = [];
  const materializer: ExecutionArtifactMaterializer = {
    materialize: async (
      payload: MaterializedExecutionArtifactPayload,
    ): Promise<MaterializedExecutionArtifact> => {
      materializedPayloads.push(payload);
      return {
        invoke: async () => {
          throw new Error("Lifecycle parity local path should execute a query session.");
        },
        executeQuerySession: async () => ({ ok: true }),
      };
    },
  };
  const executor = fakeExecutor({
    async getActiveDeploymentPackage(input: GetActiveDeploymentPackageInput) {
      expect(input).toEqual({
        deploymentId: options.deploymentId,
        projectId: options.projectId,
      });
      return {
        deployment: {
          deploymentId: options.deploymentId,
          projectId: options.projectId,
          activePackageId: options.ref.artifactId,
          activeSchemaVersion: 1,
          createdAt: new Date("2026-06-21T00:00:00.000Z"),
        },
        package: {
          deploymentId: options.deploymentId,
          packageId: options.ref.artifactId,
          sourcePackageHash: options.ref.sourcePackageHash,
          executionModule: options.ref.executionModule,
          sourcePackageJson: sourcePackageJson(options.sourcePackage),
          analysisJson: testLifecycleAnalysis(),
          createdAt: new Date("2026-06-21T00:00:00.000Z"),
        },
      };
    },
    async rerunStaleLiveQuerySubscriptions(input: RerunStaleLiveQuerySubscriptionsInput) {
      const subscription = {
        deploymentId: options.deploymentId,
        connectionId: "connection-lifecycle-parity",
        queryId: 1,
        functionPath: options.request.path,
        argsJson: options.request.args,
        partitionKey: options.request.partitionKey ?? null,
        beginTs: 10,
        readSetJson: {},
        resultJson: null,
        resultHash: "previous",
        createdAt: new Date("2026-06-21T00:00:00.000Z"),
        updatedAt: new Date("2026-06-21T00:00:00.000Z"),
      };
      await input.runQuery(subscription);
      return {
        scanned: { fresh: [], stale: [], unsupported: [] },
        changed: [
          {
            status: "updated",
            subscription,
            previousResultHash: "previous",
            resultHash: "next",
            changed: true,
            delivery: null,
          },
        ],
        unchanged: [],
        changes: [],
        unsupported: [],
        hasMoreStale: false,
      };
    },
    async runLiveQuerySubscriptionWithInvoke(
      input: RunLiveQuerySubscriptionWithInvokeInput,
    ) {
      return {
        value: await input.executeQuery(
          liveQueryAttemptForRequest(options.request),
          input.subscription,
        ),
        beginTs: 20,
        readSet: { documents: [{ tableId: 1, id: "1:user", observedTs: 20 }] },
      };
    },
  });
  const runtime = createLocalExecutorHttpRuntime({
    executor,
    projectId: options.projectId,
    capabilityToken: "executor-secret",
    freshnessStore: emptyFreshnessStore(),
    materializer,
  });

  try {
    const response = await runtime.fetch(jsonRequest(
      "https://executor.test/maintenance/live-queries/rerun",
      {
        deploymentId: options.deploymentId,
        projectId: options.projectId,
        limit: 1,
      },
      "executor-secret",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      changed: [{ status: "updated", changed: true }],
    });
  } finally {
    await runtime.dispose();
  }

  return single(materializedPayloads, "local materialized payload");
}

async function invokeHostedPayload(options: {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly request: LifecycleQueryInvokeRequest;
  readonly sourcePackage: PushSourcePackage;
  readonly harnesses: BackendHarness[];
}): Promise<ExecutionArtifactInvokePayload> {
  const hostedPayloads: ExecutionArtifactInvokePayload[] = [];
  const analyzerRequests: unknown[] = [];
  const harness = await createBackendHarness({
    bindings: {
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
      FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
      FLAREX_PROJECT_ID: options.projectId,
    },
    r2Buckets: ["ARTIFACTS"],
    serviceBindings: {
      FLAREX_ANALYZER: async request => {
        analyzerRequests.push(await request.json());
        return Response.json({
          analysis: testLifecycleAnalysis(),
          codegenAnalysis: testLifecycleCodegenAnalysis(),
          diagnostics: [],
        });
      },
      FLAREX_ARTIFACT_RUNTIME: async request => {
        const payload = await Effect.runPromise(
          decodeExecutionArtifactInvokePayloadBodyEffect(await request.json()),
        );
        hostedPayloads.push(payload);
        return Response.json({ value: { ok: true } });
      },
    },
  });
  options.harnesses.push(harness);

  const started = await startSourceOnlyPush(harness, options.deploymentId, {
    sourcePackage: options.sourcePackage,
  });
  expect(analyzerRequests).toEqual([
    {
      deploymentId: options.deploymentId,
      sourcePackage: options.sourcePackage,
    },
  ]);
  const finish = await finishPush(harness, options.deploymentId, started.pushId);
  expect(finish.result).toBe("activated");
  const active = await getActiveDeployment(harness, options.deploymentId);
  expect(active.executionArtifactRef)
    .toEqual(await executionArtifactRefForSourcePackage(options.sourcePackage));

  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${options.deploymentId}/invoke`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.request),
    },
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ value: { ok: true } });

  return single(hostedPayloads, "hosted invoke payload");
}

function refOnlyPayload(
  payload: MaterializedExecutionArtifactPayload,
): ExecutionArtifactInvokePayload {
  return executionArtifactInvokePayload({
    deploymentId: payload.deploymentId,
    ref: payload.ref,
    request: payload.request,
  });
}

function single<T>(values: readonly T[], label: string): T {
  expect(values).toHaveLength(1);
  const value = values[0];
  if (value === undefined) {
    throw new Error(`Expected one ${label}.`);
  }
  return value;
}
