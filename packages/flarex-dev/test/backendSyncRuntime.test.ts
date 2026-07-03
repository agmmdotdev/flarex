import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { deploymentAnalysisFromCodegenAnalysisEffect } from "@flarex/analysis";
import { afterAll, describe, expect, it } from "vitest";
import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactRuntimeService,
} from "flarex-backend/artifact-runtime";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "flarex-backend/artifact-store";
import {
  ANALYZED_START_TEST_AUTHORIZATION,
  createBackendHarness,
  type BackendHarness,
} from "flarex-backend/test/backendHarness";
import type {
  ModifyQuerySet,
  MutationRequest,
  MutationResponse,
  QueryFailed,
} from "flarex-backend/test/sync-protocol";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  FinishPushResponse,
  Json,
  PushStatus,
  PushSourcePackage,
} from "flarex-backend/types";
import type { PaginationResult } from "flarex/server";

import type { DeploymentAnalysis as CodegenDeploymentAnalysis } from "../src/analyze";
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
type ActivatedFinishPushSummary =
  Pick<Extract<FinishPushResponse, { result: "activated" }>, "result"> & {
    push: Pick<PushStatus, "pushId" | "state">;
  };

function backendAnalysisFromCodegenAnalysis(
  analysis: CodegenDeploymentAnalysis,
): DeploymentAnalysis {
  return Effect.runSync(deploymentAnalysisFromCodegenAnalysisEffect(analysis));
}

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
    const duplicateTeamId = "2:team_duplicate";
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
      const firstMessageId = await seedMessage(firstWs, 1, teamId, "first");
      const secondMessageId = await seedMessage(firstWs, 2, teamId, "second");
      const thirdMessageId = await seedMessage(firstWs, 3, teamId, "third");
      await seedMessage(firstWs, 40, duplicateTeamId, "dupe");
      await seedMessage(firstWs, 41, duplicateTeamId, "dupe");
      expect(materializeCount).toBe(1);

      const initialMessages: ExpectedMessage[] = [
        { _id: firstMessageId, teamId, text: "first" },
        { _id: secondMessageId, teamId, text: "second" },
        { _id: thirdMessageId, teamId, text: "third" },
      ];
      const initialRecentMessages: ExpectedMessage[] = [
        { _id: thirdMessageId, teamId, text: "third" },
        { _id: secondMessageId, teamId, text: "second" },
      ];
      const initialPaginatedMessages = {
        page: initialRecentMessages,
        isDone: false,
      };
      const initialFirstMessage = { _id: thirdMessageId, teamId, text: "third" };
      const uniqueSecondMessage = { _id: secondMessageId, teamId, text: "second" };
      sendMessageSubscriptions(firstWs, teamId, thirdMessageId);
      sendMessageSubscriptions(secondWs, teamId, thirdMessageId);
      const [firstInitialTransition, secondInitialTransition] = await Promise.all([
        nextJsonMessage(firstWs),
        nextJsonMessage(secondWs),
      ]);
      expectMessageSubscriptionTransition(
        firstInitialTransition,
        "first initial transition",
        { _id: thirdMessageId, teamId, text: "third" },
        initialMessages,
        initialRecentMessages,
        initialPaginatedMessages,
        initialFirstMessage,
        uniqueSecondMessage,
      );
      expectMessageSubscriptionTransition(
        secondInitialTransition,
        "second initial transition",
        { _id: thirdMessageId, teamId, text: "third" },
        initialMessages,
        initialRecentMessages,
        initialPaginatedMessages,
        initialFirstMessage,
        uniqueSecondMessage,
      );
      expect(materializeCount).toBe(1);

      sendDuplicateUniqueSubscription(firstWs, duplicateTeamId);
      sendDuplicateUniqueSubscription(secondWs, duplicateTeamId);
      const [firstDuplicateUniqueTransition, secondDuplicateUniqueTransition] =
        await Promise.all([
          nextJsonMessage(firstWs),
          nextJsonMessage(secondWs),
        ]);
      expectQueryFailedTransition(
        firstDuplicateUniqueTransition,
        "first duplicate unique transition",
        7,
        "Query returned more than one document.",
      );
      expectQueryFailedTransition(
        secondDuplicateUniqueTransition,
        "second duplicate unique transition",
        7,
        "Query returned more than one document.",
      );

      const initiallyStale = await runtime.executor.findStaleLiveQuerySubscriptions({
        deploymentId,
        freshnessStore: runtime.freshnessStore,
      });
      expect(initiallyStale.stale).toEqual([]);

      sendMutation(firstWs, {
        type: "Mutation",
        requestId: 4,
        udfPath: "messages:update",
        args: [{ teamId, messageId: thirdMessageId, text: "updated" }],
        partitionKey: teamId,
      });
      await expect(nextJsonMessage(firstWs)).resolves.toMatchObject({
        type: "MutationResponse",
        requestId: 4,
        success: true,
        result: thirdMessageId,
        ts: expect.any(Number),
      });
      expect(materializeCount).toBe(1);
      const stale = await runtime.executor.findStaleLiveQuerySubscriptions({
        deploymentId,
        freshnessStore: runtime.freshnessStore,
      });
      expect(stale.fresh.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:6`,
        `${secondConnectionId}:6`,
      ]);
      expect(stale.unsupported).toEqual([]);
      expect(stale.stale.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:1`,
        `${firstConnectionId}:2`,
        `${firstConnectionId}:3`,
        `${firstConnectionId}:4`,
        `${firstConnectionId}:5`,
        `${secondConnectionId}:1`,
        `${secondConnectionId}:2`,
        `${secondConnectionId}:3`,
        `${secondConnectionId}:4`,
        `${secondConnectionId}:5`,
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
              connectionId: firstConnectionId,
              queryId: 3,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: firstConnectionId,
              queryId: 4,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: firstConnectionId,
              queryId: 5,
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
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: secondConnectionId,
              queryId: 3,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: secondConnectionId,
              queryId: 4,
            }),
          }),
          expect.objectContaining({
            subscription: expect.objectContaining({
              deploymentId,
              connectionId: secondConnectionId,
              queryId: 5,
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
      expectSchedulerTriggerResponse(await response.json(), {
        deploymentId,
        changed: 10,
        claimed: 10,
        acked: 10,
        delivered: 10,
      });

      expectMessageSubscriptionTransition(
        await firstDelivered,
        "first delivered transition",
        { _id: thirdMessageId, teamId, text: "updated" },
        [
          { _id: firstMessageId, teamId, text: "first" },
          { _id: secondMessageId, teamId, text: "second" },
          { _id: thirdMessageId, teamId, text: "updated" },
        ],
        [
          { _id: thirdMessageId, teamId, text: "updated" },
          { _id: secondMessageId, teamId, text: "second" },
        ],
        {
          page: [
            { _id: thirdMessageId, teamId, text: "updated" },
            { _id: secondMessageId, teamId, text: "second" },
          ],
          isDone: false,
        },
        { _id: thirdMessageId, teamId, text: "updated" },
      );
      expectMessageSubscriptionTransition(
        await secondDelivered,
        "second delivered transition",
        { _id: thirdMessageId, teamId, text: "updated" },
        [
          { _id: firstMessageId, teamId, text: "first" },
          { _id: secondMessageId, teamId, text: "second" },
          { _id: thirdMessageId, teamId, text: "updated" },
        ],
        [
          { _id: thirdMessageId, teamId, text: "updated" },
          { _id: secondMessageId, teamId, text: "second" },
        ],
        {
          page: [
            { _id: thirdMessageId, teamId, text: "updated" },
            { _id: secondMessageId, teamId, text: "second" },
          ],
          isDone: false,
        },
        { _id: thirdMessageId, teamId, text: "updated" },
      );
      await expect(
        runtime.persistence.listUndeliveredLiveQueryDeliveries({
          deploymentId,
          limit: 10,
        }),
      ).resolves.toMatchObject({ deliveries: [], hasMore: false });

      sendMutation(firstWs, {
        type: "Mutation",
        requestId: 5,
        udfPath: "messages:update",
        args: [{ teamId, messageId: firstMessageId, text: "z-last" }],
        partitionKey: teamId,
      });
      await expect(nextJsonMessage(firstWs)).resolves.toMatchObject({
        type: "MutationResponse",
        requestId: 5,
        success: true,
        result: firstMessageId,
        ts: expect.any(Number),
      });

      const staleAfterLimitedMembershipChange =
        await runtime.executor.findStaleLiveQuerySubscriptions({
          deploymentId,
          freshnessStore: runtime.freshnessStore,
        });
      expect(staleAfterLimitedMembershipChange.fresh.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:1`,
        `${firstConnectionId}:6`,
        `${secondConnectionId}:1`,
        `${secondConnectionId}:6`,
      ]);
      expect(staleAfterLimitedMembershipChange.unsupported).toEqual([]);
      expect(staleAfterLimitedMembershipChange.stale.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:2`,
        `${firstConnectionId}:3`,
        `${firstConnectionId}:4`,
        `${firstConnectionId}:5`,
        `${secondConnectionId}:2`,
        `${secondConnectionId}:3`,
        `${secondConnectionId}:4`,
        `${secondConnectionId}:5`,
      ]);

      const firstLimitedBoundaryDelivered = nextJsonMessage(firstWs);
      const secondLimitedBoundaryDelivered = nextJsonMessage(secondWs);
      const limitedBoundaryResponse = await harness.mf.dispatchFetch(
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

      expect(limitedBoundaryResponse.status).toBe(200);
      expectSchedulerTriggerResponse(await limitedBoundaryResponse.json(), {
        deploymentId,
        changed: 8,
        claimed: 8,
        acked: 8,
        delivered: 8,
      });
      expectListSubscriptionTransition(
        await firstLimitedBoundaryDelivered,
        "first limited-boundary delivered transition",
        [
          { _id: secondMessageId, teamId, text: "second" },
          { _id: thirdMessageId, teamId, text: "updated" },
          { _id: firstMessageId, teamId, text: "z-last" },
        ],
        [
          { _id: firstMessageId, teamId, text: "z-last" },
          { _id: thirdMessageId, teamId, text: "updated" },
        ],
        {
          page: [
            { _id: firstMessageId, teamId, text: "z-last" },
            { _id: thirdMessageId, teamId, text: "updated" },
          ],
          isDone: false,
        },
        { _id: firstMessageId, teamId, text: "z-last" },
      );
      expectListSubscriptionTransition(
        await secondLimitedBoundaryDelivered,
        "second limited-boundary delivered transition",
        [
          { _id: secondMessageId, teamId, text: "second" },
          { _id: thirdMessageId, teamId, text: "updated" },
          { _id: firstMessageId, teamId, text: "z-last" },
        ],
        [
          { _id: firstMessageId, teamId, text: "z-last" },
          { _id: thirdMessageId, teamId, text: "updated" },
        ],
        {
          page: [
            { _id: firstMessageId, teamId, text: "z-last" },
            { _id: thirdMessageId, teamId, text: "updated" },
          ],
          isDone: false,
        },
        { _id: firstMessageId, teamId, text: "z-last" },
      );
      await expect(
        runtime.persistence.listUndeliveredLiveQueryDeliveries({
          deploymentId,
          limit: 10,
        }),
      ).resolves.toMatchObject({ deliveries: [], hasMore: false });

      sendMutation(firstWs, {
        type: "Mutation",
        requestId: 6,
        udfPath: "messages:update",
        args: [{ teamId, messageId: secondMessageId, text: "zz-top" }],
        partitionKey: teamId,
      });
      await expect(nextJsonMessage(firstWs)).resolves.toMatchObject({
        type: "MutationResponse",
        requestId: 6,
        success: true,
        result: secondMessageId,
        ts: expect.any(Number),
      });

      const staleAfterUniqueMembershipChange =
        await runtime.executor.findStaleLiveQuerySubscriptions({
          deploymentId,
          freshnessStore: runtime.freshnessStore,
        });
      expect(staleAfterUniqueMembershipChange.fresh.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:1`,
        `${secondConnectionId}:1`,
      ]);
      expect(staleAfterUniqueMembershipChange.unsupported).toEqual([]);
      expect(staleAfterUniqueMembershipChange.stale.map(entry =>
        `${entry.subscription.connectionId}:${entry.subscription.queryId}`,
      ).sort()).toEqual([
        `${firstConnectionId}:2`,
        `${firstConnectionId}:3`,
        `${firstConnectionId}:4`,
        `${firstConnectionId}:5`,
        `${firstConnectionId}:6`,
        `${secondConnectionId}:2`,
        `${secondConnectionId}:3`,
        `${secondConnectionId}:4`,
        `${secondConnectionId}:5`,
        `${secondConnectionId}:6`,
      ]);

      const firstUniqueBoundaryDelivered = nextJsonMessage(firstWs);
      const secondUniqueBoundaryDelivered = nextJsonMessage(secondWs);
      const uniqueBoundaryResponse = await harness.mf.dispatchFetch(
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

      expect(uniqueBoundaryResponse.status).toBe(200);
      expectSchedulerTriggerResponse(await uniqueBoundaryResponse.json(), {
        deploymentId,
        changed: 10,
        claimed: 10,
        acked: 10,
        delivered: 10,
      });
      expectListSubscriptionTransition(
        await firstUniqueBoundaryDelivered,
        "first unique-boundary delivered transition",
        [
          { _id: thirdMessageId, teamId, text: "updated" },
          { _id: firstMessageId, teamId, text: "z-last" },
          { _id: secondMessageId, teamId, text: "zz-top" },
        ],
        [
          { _id: secondMessageId, teamId, text: "zz-top" },
          { _id: firstMessageId, teamId, text: "z-last" },
        ],
        {
          page: [
            { _id: secondMessageId, teamId, text: "zz-top" },
            { _id: firstMessageId, teamId, text: "z-last" },
          ],
          isDone: false,
        },
        { _id: secondMessageId, teamId, text: "zz-top" },
        null,
      );
      expectListSubscriptionTransition(
        await secondUniqueBoundaryDelivered,
        "second unique-boundary delivered transition",
        [
          { _id: thirdMessageId, teamId, text: "updated" },
          { _id: firstMessageId, teamId, text: "z-last" },
          { _id: secondMessageId, teamId, text: "zz-top" },
        ],
        [
          { _id: secondMessageId, teamId, text: "zz-top" },
          { _id: firstMessageId, teamId, text: "z-last" },
        ],
        {
          page: [
            { _id: secondMessageId, teamId, text: "zz-top" },
            { _id: firstMessageId, teamId, text: "z-last" },
          ],
          isDone: false,
        },
        { _id: secondMessageId, teamId, text: "zz-top" },
        null,
      );
      await expect(
        runtime.persistence.listUndeliveredLiveQueryDeliveries({
          deploymentId,
          limit: 10,
        }),
      ).resolves.toMatchObject({ deliveries: [], hasMore: false });

      const rerunFailureTeamId = "2:team_unique_failure";
      const firstRerunFailureMessageId = await seedMessage(
        firstWs,
        80,
        rerunFailureTeamId,
        "live-dupe",
      );
      sendUniqueTextSubscription(
        firstWs,
        2,
        3,
        8,
        rerunFailureTeamId,
        "live-dupe",
      );
      expectUniqueTextTransition(
        await nextJsonMessage(firstWs),
        "initial successful unique before duplicate rerun",
        8,
        {
          _id: firstRerunFailureMessageId,
          teamId: rerunFailureTeamId,
          text: "live-dupe",
        },
      );

      await seedMessage(firstWs, 81, rerunFailureTeamId, "live-dupe");
      const rerunFailureDelivered = nextJsonMessage(firstWs);
      const rerunFailureResponse = await harness.mf.dispatchFetch(
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

      expect(rerunFailureResponse.status).toBe(200);
      const rerunFailureBody: unknown = await rerunFailureResponse.json();
      expectSchedulerTriggerResponse(rerunFailureBody, {
        deploymentId,
        changed: 1,
        claimed: 1,
        acked: 1,
        delivered: 1,
      });
      expectQueryFailedTransition(
        await rerunFailureDelivered,
        "previously successful unique rerun failure transition",
        8,
        "Query returned more than one document.",
      );
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
  }).index("by_team_text", ["teamId", "text"]),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/messages.ts"),
    `import { model, mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "flarex/server";
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
      .withIndex("by_team_text", q => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const recentByTeam = query({
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
      .withIndex("by_team_text", q => q.eq("teamId", args.teamId))
      .order("desc")
      .take(2);
  },
});

export const pageByTeam = query({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      _id: v.id("messages"),
      teamId: v.id("teams"),
      text: v.string(),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_team_text", q => q.eq("teamId", args.teamId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const firstByTeam = query({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams") },
  returns: v.union(v.null(), v.object({
    _id: v.id("messages"),
    teamId: v.id("teams"),
    text: v.string(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_team_text", q => q.eq("teamId", args.teamId))
      .order("desc")
      .first();
  },
});

export const uniqueByText = query({
  partition: model.teams.byId("teamId"),
  args: { teamId: v.id("teams"), text: v.string() },
  returns: v.union(v.null(), v.object({
    _id: v.id("messages"),
    teamId: v.id("teams"),
    text: v.string(),
  })),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_team_text", q => q.eq("teamId", args.teamId).eq("text", args.text))
      .unique();
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
      headers: {
        authorization: ANALYZED_START_TEST_AUTHORIZATION,
        "content-type": "application/json",
      },
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
  return finishPushResponseFromUnknown(await response.json()).push;
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

function finishPushResponseFromUnknown(value: unknown): ActivatedFinishPushSummary {
  const record = jsonRecord(value, "finish push response");
  if (record.result !== "activated") {
    throw new Error("finish push response.result must be activated.");
  }
  return {
    result: "activated",
    push: pushStatusFromUnknown(record.push),
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

function jsonArray(value: unknown, name: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`${name} must be an array.`);
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

async function seedMessage(
  ws: SyncWebSocket,
  requestId: number,
  teamId: string,
  text: string,
): Promise<string> {
  sendMutation(ws, {
    type: "Mutation",
    requestId,
    udfPath: "messages:seed",
    args: [{ teamId, text }],
    partitionKey: teamId,
  });
  const created = mutationResponseFromUnknown(await nextJsonMessage(ws));
  expect(created).toMatchObject({
    type: "MutationResponse",
    requestId,
    success: true,
    ts: expect.any(Number),
  });
  const messageId = jsonString(created.result, `seed ${requestId} mutation result`);
  expect(messageId).toMatch(/^1:/);
  return messageId;
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
      {
        type: "Add",
        queryId: 3,
        udfPath: "messages:recentByTeam",
        args: [{ teamId }],
        partitionKey: teamId,
      },
      {
        type: "Add",
        queryId: 4,
        udfPath: "messages:pageByTeam",
        args: [{ teamId, paginationOpts: { numItems: 2, cursor: null } }],
        partitionKey: teamId,
      },
      {
        type: "Add",
        queryId: 5,
        udfPath: "messages:firstByTeam",
        args: [{ teamId }],
        partitionKey: teamId,
      },
      {
        type: "Add",
        queryId: 6,
        udfPath: "messages:uniqueByText",
        args: [{ teamId, text: "second" }],
        partitionKey: teamId,
      },
    ],
  });
}

function sendDuplicateUniqueSubscription(
  ws: SyncWebSocket,
  teamId: string,
): void {
  sendModifyQuerySet(ws, {
    type: "ModifyQuerySet",
    baseVersion: 1,
    newVersion: 2,
    modifications: [
      {
        type: "Add",
        queryId: 7,
        udfPath: "messages:uniqueByText",
        args: [{ teamId, text: "dupe" }],
        partitionKey: teamId,
      },
    ],
  });
}

function sendUniqueTextSubscription(
  ws: SyncWebSocket,
  baseVersion: number,
  newVersion: number,
  queryId: number,
  teamId: string,
  text: string,
): void {
  sendModifyQuerySet(ws, {
    type: "ModifyQuerySet",
    baseVersion,
    newVersion,
    modifications: [
      {
        type: "Add",
        queryId,
        udfPath: "messages:uniqueByText",
        args: [{ teamId, text }],
        partitionKey: teamId,
      },
    ],
  });
}

type ExpectedMessage = {
  _id: string;
  teamId: string;
  text: string;
};

type ExpectedMaybeMessage = ExpectedMessage | null;

type ExpectedPaginatedMessages = Pick<PaginationResult<ExpectedMessage>, "page" | "isDone">;

function expectMessageSubscriptionTransition(
  transition: unknown,
  name: string,
  message: ExpectedMaybeMessage,
  messages: ExpectedMessage[],
  recentMessages: ExpectedMessage[],
  paginatedMessages: ExpectedPaginatedMessages,
  firstMessage: ExpectedMaybeMessage,
  uniqueMessage?: ExpectedMaybeMessage,
): void {
  const updates = transitionUpdatesByQueryId(transition, name);
  expect([...updates.keys()]).toEqual(uniqueMessage === undefined
    ? [1, 2, 3, 4, 5]
    : [1, 2, 3, 4, 5, 6]);
  expect(updates.get(1)).toEqual(message);
  expect(updates.get(2)).toEqual(messages);
  expect(updates.get(3)).toEqual(recentMessages);
  expectPaginatedMessagesResult(updates.get(4), `${name} paginated result`, paginatedMessages);
  expect(updates.get(5)).toEqual(firstMessage);
  if (uniqueMessage !== undefined) {
    expect(updates.get(6)).toEqual(uniqueMessage);
  }
}

function expectListSubscriptionTransition(
  transition: unknown,
  name: string,
  messages: ExpectedMessage[],
  recentMessages: ExpectedMessage[],
  paginatedMessages: ExpectedPaginatedMessages,
  firstMessage: ExpectedMaybeMessage,
  uniqueMessage?: ExpectedMaybeMessage,
): void {
  const updates = transitionUpdatesByQueryId(transition, name);
  expect([...updates.keys()]).toEqual(uniqueMessage === undefined
    ? [2, 3, 4, 5]
    : [2, 3, 4, 5, 6]);
  expect(updates.get(2)).toEqual(messages);
  expect(updates.get(3)).toEqual(recentMessages);
  expectPaginatedMessagesResult(updates.get(4), `${name} paginated result`, paginatedMessages);
  expect(updates.get(5)).toEqual(firstMessage);
  if (uniqueMessage !== undefined) {
    expect(updates.get(6)).toEqual(uniqueMessage);
  }
}

function expectUniqueTextTransition(
  transition: unknown,
  name: string,
  queryId: number,
  uniqueMessage: ExpectedMaybeMessage,
): void {
  const updates = transitionUpdatesByQueryId(transition, name);
  expect([...updates.keys()]).toEqual([queryId]);
  expect(updates.get(queryId)).toEqual(uniqueMessage);
}

function expectPaginatedMessagesResult(
  value: Json | undefined,
  name: string,
  expected: ExpectedPaginatedMessages,
): void {
  const record = jsonRecord(value, name);
  expect(record.page).toEqual(expected.page);
  expect(record.isDone).toBe(expected.isDone);
  expect(jsonString(record.continueCursor, `${name}.continueCursor`).length)
    .toBeGreaterThan(0);
}

function expectQueryFailedTransition(
  transition: unknown,
  name: string,
  queryId: number,
  errorMessage: string,
): void {
  const record = jsonRecord(transition, name);
  if (record.type !== "Transition") {
    throw new Error(`${name}.type must be Transition.`);
  }
  const modifications = jsonArray(record.modifications, `${name}.modifications`);
  expect(modifications).toHaveLength(1);
  const modification = jsonRecord(modifications[0], `${name}.modifications[0]`);
  const expected = {
    type: "QueryFailed",
    queryId,
    errorMessage,
    logLines: [],
    errorData: null,
    journal: null,
  } satisfies QueryFailed;
  expect(modification).toMatchObject(expected);
}

function expectSchedulerTriggerResponse(
  value: unknown,
  expected: {
    deploymentId: string;
    changed: number;
    claimed: number;
    acked: number;
    delivered: number;
  },
): void {
  const record = jsonRecord(value, "scheduler trigger response");
  expect(jsonString(record.deploymentId, "scheduler trigger response.deploymentId"))
    .toBe(expected.deploymentId);
  expect(jsonInteger(record.changed, "scheduler trigger response.changed"))
    .toBe(expected.changed);
  expect(jsonInteger(record.unchanged, "scheduler trigger response.unchanged"))
    .toBe(0);
  expect(jsonInteger(record.unsupported, "scheduler trigger response.unsupported"))
    .toBe(0);
  expect(record.hasMoreStale).toBe(false);
  const delivery = jsonRecord(record.delivery, "scheduler trigger response.delivery");
  expect(delivery.woken).toBe(true);
  expect(jsonInteger(delivery.status, "scheduler trigger response.delivery.status"))
    .toBe(200);
  const result = jsonRecord(delivery.result, "scheduler trigger response.delivery.result");
  expect(jsonString(result.deploymentId, "scheduler trigger response.delivery.result.deploymentId"))
    .toBe(expected.deploymentId);
  expect(jsonInteger(result.claimed, "scheduler trigger response.delivery.result.claimed"))
    .toBe(expected.claimed);
  expect(jsonInteger(result.acked, "scheduler trigger response.delivery.result.acked"))
    .toBe(expected.acked);
  expect(jsonInteger(result.delivered, "scheduler trigger response.delivery.result.delivered"))
    .toBe(expected.delivered);
  expect(jsonInteger(result.skipped, "scheduler trigger response.delivery.result.skipped"))
    .toBe(0);
  expect(result.hasMore).toBe(false);
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
  abandoned: true,
  superseded: true,
} satisfies Record<PushStatus["state"], true>;

function nextJsonMessage(ws: SyncWebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      ws.removeEventListener("error", onError);
    };
    const onError = (event: Event): void => {
      cleanup();
      reject(event);
    };
    const timeout = setTimeout(
      () => {
        cleanup();
        reject(new Error("Timed out waiting for WebSocket message."));
      },
      5000,
    );
    ws.addEventListener("message", event => {
      cleanup();
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
    ws.addEventListener("error", onError, { once: true });
  });
}

function sendMutation(ws: SyncWebSocket, message: MutationRequest): void {
  ws.send(JSON.stringify(message));
}

function sendModifyQuerySet(ws: SyncWebSocket, message: ModifyQuerySet): void {
  ws.send(JSON.stringify(message));
}
