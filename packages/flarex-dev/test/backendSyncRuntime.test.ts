import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactRuntimeService,
} from "flarex-backend/artifact-runtime";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "flarex-backend/artifact-store";
import {
  createBackendHarness,
  type BackendHarness,
} from "flarex-backend/test/backendHarness";
import type {
  ModifyQuerySet,
  MutationRequest,
  MutationResponse,
} from "flarex-backend/test/sync-protocol";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  Json,
  PushStatus,
  PushSourcePackage,
} from "flarex-backend/types";

import { backendAnalysisFromCodegenAnalysis } from "../src/backendPush";
import {
  createLocalPGliteExecutorHttpRuntime,
  type LocalPGliteExecutorHttpRuntime,
} from "../src/executorHttpRuntime";
import { LocalMiniflareExecutionArtifactAdapter } from "../src/executionArtifact";
import {
  bundleFlarexSourcePackage,
  initialCodegen,
} from "../src/generate";
import { LocalMiniflareExecutionArtifactMaterializer } from "../src/runtimeMaterializer";

type BackendDispatchResponse = Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>;
type SyncWebSocket = NonNullable<BackendDispatchResponse["webSocket"]>;

describe("backend sync with local executor runtime", () => {
  const harnesses: BackendHarness[] = [];
  const runtimes: LocalPGliteExecutorHttpRuntime[] = [];
  const artifactRuntimes: ExecutionArtifactRuntimeService[] = [];

  afterAll(async () => {
    await Promise.all([
      ...harnesses.map(harness => harness.dispose()),
      ...runtimes.map(runtime => runtime.dispose()),
      ...artifactRuntimes.map(runtime => runtime.dispose()),
    ]);
  });

  it("reruns stale live queries through PGlite executor state and delivers QueryUpdated over Cloudflare DOs", async () => {
    let now = 100;
    let nextSession = 0;
    const deploymentId = "deployment-backend-runtime-live";
    const projectId = "project-backend-runtime-live";
    const firstSessionId = "runtime-live-session-a";
    const secondSessionId = "runtime-live-session-b";
    const firstConnectionId = `connection:${deploymentId}:${firstSessionId}`;
    const secondConnectionId = `connection:${deploymentId}:${secondSessionId}`;
    const teamId = "2:team_alpha";
    const generatedDeployment = await createGeneratedMessageDeployment();

    const runtime = await createLocalPGliteExecutorHttpRuntime({
      projectId,
      capabilityToken: "executor-secret",
      backendUrl: "https://backend.test",
      triggerFetch: async () => Response.json({ triggered: false }),
      clock: { now: () => new Date(++now) },
      ids: { nextId: () => `runtime_live_${++nextSession}` },
    });
    runtimes.push(runtime);

    const registered = await runtime.executor.registerDeploymentPackage({
      deploymentId,
      projectId,
      sourcePackage: generatedDeployment.sourcePackage,
      analysisJson: generatedDeployment.analysis,
    });
    await runtime.executor.activateDeploymentPackage({
      deploymentId,
      projectId,
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    let harness: BackendHarness | undefined;
    let materializeCount = 0;
    let storeGetCount = 0;
    const baseMaterializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId,
      executorToken: "executor-secret",
      backend: request => runtime.fetch(request),
    });
    const artifactRuntime = createExecutionArtifactRuntimeService({
      capabilityToken: "sync-secret",
      store: {
        put: async package_ => new R2BackendExecutionArtifactStore(
          r2BucketLikeFromMiniflare(await requireHarness(harness).mf.getR2Bucket("ARTIFACTS")),
        ).put(package_),
        get: async ref => {
          storeGetCount += 1;
          return new R2BackendExecutionArtifactStore(
            r2BucketLikeFromMiniflare(await requireHarness(harness).mf.getR2Bucket("ARTIFACTS")),
          ).get(ref);
        },
      },
      materializer: {
        materialize: async payload => {
          materializeCount += 1;
          return baseMaterializer.materialize(payload);
        },
      },
    });
    artifactRuntimes.push(artifactRuntime);

    harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "sync-secret",
        FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
        FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        FLAREX_PROJECT_ID: projectId,
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_EXECUTOR: request => runtime.fetch(request),
        FLAREX_ARTIFACT_RUNTIME: artifactRuntime,
      },
    });
    harnesses.push(harness);
    await activateBackendDeployment(
      harness,
      deploymentId,
      generatedDeployment.sourcePackage,
      generatedDeployment.analysis,
    );

    const firstWs = await openSync(harness, deploymentId, firstSessionId);
    const secondWs = await openSync(harness, deploymentId, secondSessionId);
    try {
      sendMutation(firstWs, {
        type: "Mutation",
        requestId: 1,
        udfPath: "messages:seed",
        args: [{ teamId, text: "initial" }],
        partitionKey: teamId,
      });
      const created = mutationResponseFromUnknown(await nextJsonMessage(firstWs));
      expect(created).toMatchObject({
        type: "MutationResponse",
        requestId: 1,
        success: true,
        ts: expect.any(Number),
      });
      const messageId = jsonString(created.result, "seed mutation result");
      expect(messageId).toMatch(/^1:/);
      expect(materializeCount).toBe(1);
      expect(storeGetCount).toBe(1);

      sendMessageSubscriptions(firstWs, teamId, messageId);
      sendMessageSubscriptions(secondWs, teamId, messageId);
      const [firstInitialTransition, secondInitialTransition] = await Promise.all([
        nextJsonMessage(firstWs),
        nextJsonMessage(secondWs),
      ]);
      expectMessageSubscriptionTransition(
        firstInitialTransition,
        "first initial transition",
        messageId,
        teamId,
        "initial",
      );
      expectMessageSubscriptionTransition(
        secondInitialTransition,
        "second initial transition",
        messageId,
        teamId,
        "initial",
      );
      expect(materializeCount).toBe(1);
      expect(storeGetCount).toBe(5);

      const initiallyStale = await runtime.executor.findStaleLiveQuerySubscriptions({
        deploymentId,
        freshnessStore: runtime.freshnessStore,
      });
      expect(initiallyStale.stale).toEqual([]);

      sendMutation(firstWs, {
        type: "Mutation",
        requestId: 2,
        udfPath: "messages:update",
        args: [{ teamId, messageId, text: "fresh" }],
        partitionKey: teamId,
      });
      await expect(nextJsonMessage(firstWs)).resolves.toMatchObject({
        type: "MutationResponse",
        requestId: 2,
        success: true,
        result: messageId,
        ts: expect.any(Number),
      });
      expect(materializeCount).toBe(1);
      expect(storeGetCount).toBe(6);
      const stale = await runtime.executor.findStaleLiveQuerySubscriptions({
          deploymentId,
          freshnessStore: runtime.freshnessStore,
      });
      expect(stale.fresh).toEqual([]);
      expect(stale.unsupported).toEqual([]);
      expect(stale.stale.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:1`,
        `${firstConnectionId}:2`,
        `${secondConnectionId}:1`,
        `${secondConnectionId}:2`,
      ]);
      expect(stale).toMatchObject({
        stale: expect.arrayContaining([
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: firstConnectionId,
              queryId: 1,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: firstConnectionId,
              queryId: 2,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: secondConnectionId,
              queryId: 1,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: secondConnectionId,
              queryId: 2,
            }),
          }),
        ]),
      });

      const firstDelivered = nextJsonMessage(firstWs);
      const secondDelivered = nextJsonMessage(secondWs);
      const response = await harness.mf.dispatchFetch(
        "http://flarex.test/scheduler/live-query-subscriptions/trigger",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer delivery-secret",
          },
          body: JSON.stringify({
            deploymentId,
            projectId,
            limit: 10,
            deliveryLimit: 10,
            maxBatches: 1,
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        deploymentId,
        changed: 4,
        unchanged: 0,
        unsupported: 0,
        hasMoreStale: false,
        delivery: {
          woken: true,
          status: 200,
          result: {
            deploymentId,
            claimed: 4,
            acked: 4,
            delivered: 4,
            skipped: 0,
            hasMore: false,
          },
        },
      });

      expectMessageSubscriptionTransition(
        await firstDelivered,
        "first delivered transition",
        messageId,
        teamId,
        "fresh",
      );
      expectMessageSubscriptionTransition(
        await secondDelivered,
        "second delivered transition",
        messageId,
        teamId,
        "fresh",
      );
      await expect(
        runtime.persistence.listUndeliveredLiveQueryDeliveries({
          deploymentId,
          limit: 10,
        }),
      ).resolves.toMatchObject({ deliveries: [], hasMore: false });
      expect(runtime.cacheSize()).toBe(1);
    } finally {
      firstWs.close();
      secondWs.close();
    }
  }, 30000);
});

async function createGeneratedMessageDeployment(): Promise<{
  sourcePackage: PushSourcePackage;
  analysis: DeploymentAnalysis;
}> {
  const root = await createMessageProject();
  const context = await initialCodegen({ root });
  const sourcePackage = await bundleFlarexSourcePackage(context);
  const codegenAnalysis = await new LocalMiniflareExecutionArtifactAdapter()
    .analyze(sourcePackage);
  return {
    sourcePackage,
    analysis: backendAnalysisFromCodegenAnalysis(codegenAnalysis),
  };
}

async function createMessageProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-hosted-sync-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { defineColocatedTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  teams: definePartitionTable({
    name: v.string(),
  }),
  messages: defineColocatedTable("teams", "teamId", {
    teamId: v.id("teams"),
    text: v.string(),
  }).index("by_team", ["teamId"]),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/messages.ts"),
    `import { model, mutation, query } from "../_generated/server";
import { v } from "flarex/values";

export const get = query({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams"), messageId: v.id("messages") },
  returns: v.union(v.null(), v.object({
    _id: v.id("messages"),
    teamId: v.id("teams"),
    text: v.string(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const listByTeam = query({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams") },
  returns: v.array(v.object({
    _id: v.id("messages"),
    teamId: v.id("teams"),
    text: v.string(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_team", q => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const seed = mutation({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams"), text: v.string() },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", { teamId: args.teamId, text: args.text });
  },
});

export const update = mutation({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams"), messageId: v.id("messages"), text: v.string() },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { text: args.text });
    return args.messageId;
  },
});
`,
  );
  return root;
}

async function activateBackendDeployment(
  harness: BackendHarness,
  deploymentId: string,
  sourcePackage: PushSourcePackage,
  analysis: DeploymentAnalysis,
): Promise<void> {
  const start = await startPush(harness, deploymentId, {
    sourcePackage,
    analysis,
  });
  const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
  await new R2BackendExecutionArtifactStore(r2BucketLikeFromMiniflare(bucket))
    .put(sourcePackage);
  const finish = await finishPush(harness, deploymentId, start.pushId);
  expect(finish.state).toBe("activated");
}

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<Pick<PushStatus, "pushId" | "state">> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    expect(response.ok, await response.text()).toBe(true);
  }
  return pushStatusFromUnknown(await response.json());
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<Pick<PushStatus, "pushId" | "state">> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    expect(response.ok, await response.text()).toBe(true);
  }
  return pushStatusFromUnknown(await response.json());
}

async function openSync(
  harness: BackendHarness,
  deploymentId: string,
  sessionId: string,
): Promise<SyncWebSocket> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/sync`,
    { headers: { Upgrade: "websocket", "x-flarex-session": sessionId } },
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (ws == null) {
    throw new Error("Expected sync route to return a WebSocket.");
  }
  ws.accept();
  return ws;
}

function requireHarness(harness: BackendHarness | undefined): BackendHarness {
  if (harness === undefined) {
    throw new Error("Backend harness is not initialized.");
  }
  return harness;
}

function r2BucketLikeFromMiniflare(bucket: unknown): R2BucketLike {
  if (!isR2BucketLike(bucket)) {
    throw new Error("Miniflare ARTIFACTS bucket does not implement the R2 artifact store API.");
  }
  return bucket;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    "put" in value &&
    typeof value.put === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
  );
}

function pushStatusFromUnknown(value: unknown): Pick<PushStatus, "pushId" | "state"> {
  const record = jsonRecord(value, "push status");
  if (typeof record.pushId !== "string" || record.pushId.length === 0) {
    throw new Error("push status.pushId must be a non-empty string.");
  }
  if (!isPushStatusState(record.state)) {
    throw new Error("push status.state must be a valid push status state.");
  }
  return {
    pushId: record.pushId,
    state: record.state,
  };
}

function isPushStatusState(value: unknown): value is PushStatus["state"] {
  return typeof value === "string" && value in pushStatusStates;
}

function mutationResponseFromUnknown(value: unknown): MutationResponse {
  const record = jsonRecord(value, "mutation response");
  if (record.type !== "MutationResponse") {
    throw new Error("mutation response.type must be MutationResponse.");
  }
  if (typeof record.requestId !== "number" || !Number.isInteger(record.requestId)) {
    throw new Error("mutation response.requestId must be an integer.");
  }
  if (record.success === true) {
    return {
      type: "MutationResponse",
      requestId: record.requestId,
      success: true,
      result: assertJson(record.result, "mutation response.result"),
      ...(record.ts === undefined ? {} : { ts: jsonInteger(record.ts, "mutation response.ts") }),
      logLines: jsonStringArray(record.logLines, "mutation response.logLines"),
    };
  }
  if (record.success === false) {
    return {
      type: "MutationResponse",
      requestId: record.requestId,
      success: false,
      result: jsonString(record.result, "mutation response.result"),
      logLines: jsonStringArray(record.logLines, "mutation response.logLines"),
      ...(record.errorData === undefined
        ? {}
        : { errorData: assertJson(record.errorData, "mutation response.errorData") }),
    };
  }
  throw new Error("mutation response.success must be a boolean.");
}

function jsonRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${name} must be an object.`);
}

function jsonString(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  throw new Error(`${name} must be a string.`);
}

function jsonInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${name} must be an integer.`);
}

function jsonStringArray(value: unknown, name: string): string[] {
  if (Array.isArray(value)) {
    return value.map(item => jsonString(item, name));
  }
  throw new Error(`${name} must be a string array.`);
}

function transitionUpdatesByQueryId(value: unknown, name: string): Map<number, Json> {
  const record = jsonRecord(value, name);
  if (record.type !== "Transition") {
    throw new Error(`${name}.type must be Transition.`);
  }
  if (!Array.isArray(record.modifications)) {
    throw new Error(`${name}.modifications must be an array.`);
  }
  const updates = new Map<number, Json>();
  for (const [index, modification] of record.modifications.entries()) {
    const modificationRecord = jsonRecord(
      modification,
      `${name}.modifications[${index}]`,
    );
    if (modificationRecord.type !== "QueryUpdated") {
      throw new Error(`${name}.modifications[${index}].type must be QueryUpdated.`);
    }
    const queryId = jsonInteger(
      modificationRecord.queryId,
      `${name}.modifications[${index}].queryId`,
    );
    if (updates.has(queryId)) {
      throw new Error(`${name}.modifications has duplicate queryId ${queryId}.`);
    }
    updates.set(
      queryId,
      assertJson(modificationRecord.value, `${name}.modifications[${index}].value`),
    );
  }
  return new Map([...updates].sort(([left], [right]) => left - right));
}

function sendMessageSubscriptions(
  ws: SyncWebSocket,
  teamId: string,
  messageId: string,
): void {
  sendModifyQuerySet(ws, {
    type: "ModifyQuerySet",
    baseVersion: 0,
    newVersion: 1,
    modifications: [
      {
        type: "Add",
        queryId: 1,
        udfPath: "messages:get",
        args: [{ teamId, messageId }],
        partitionKey: teamId,
      },
      {
        type: "Add",
        queryId: 2,
        udfPath: "messages:listByTeam",
        args: [{ teamId }],
        partitionKey: teamId,
      },
    ],
  });
}

function expectMessageSubscriptionTransition(
  transition: unknown,
  name: string,
  messageId: string,
  teamId: string,
  text: string,
): void {
  const updates = transitionUpdatesByQueryId(transition, name);
  expect([...updates.keys()]).toEqual([1, 2]);
  expect(updates.get(1)).toEqual({ _id: messageId, teamId, text });
  expect(updates.get(2)).toEqual([{ _id: messageId, teamId, text }]);
}

function assertJson(value: unknown, name: string): Json {
  if (isJson(value)) return value;
  throw new Error(`${name} must be JSON.`);
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(isJson);
}

const pushStatusStates = {
  pending: true,
  analyzed: true,
  failed: true,
  activated: true,
  superseded: true,
} satisfies Record<PushStatus["state"], true>;

function nextJsonMessage(ws: SyncWebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message.")),
      5000,
    );
    ws.addEventListener("message", event => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
    ws.addEventListener("error", event => {
      clearTimeout(timeout);
      reject(event);
    }, { once: true });
  });
}

function sendMutation(ws: SyncWebSocket, message: MutationRequest): void {
  ws.send(JSON.stringify(message));
}

function sendModifyQuerySet(ws: SyncWebSocket, message: ModifyQuerySet): void {
  ws.send(JSON.stringify(message));
}
