import { createMemoryFreshnessMirrorStore } from "@flarex/freshness";
import { Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { DeploymentProjectMismatchError } from "../src";
import {
  findStaleLiveQuerySubscriptionsEffect,
  listExpiredLiveQueryConnectionDeploymentsEffect,
  makeLiveQueryTimeEffect,
  recordLiveQuerySubscriptionEffect,
  removeExpiredLiveQuerySubscriptionsEffect,
  removeLiveQuerySubscriptionsForConnectionEffect,
  rerunStaleLiveQuerySubscriptionsEffect,
  touchLiveQueryConnectionEffect,
} from "../src/liveQueries";
import { runEffect } from "./effectTestRuntime";
import { memoryPersistence } from "./helpers/persistence";

describe("executor Effect-native live query lease timing", () => {
  it("uses TestClock for connection lease and close observations", async () => {
    const basePersistence = memoryPersistence();
    const leaseTimes: Date[] = [];
    const expiryTimes: Date[] = [];
    const closeTimes: Date[] = [];
    const persistence = {
      ...basePersistence,
      async upsertLiveQueryConnectionLease(
        input: Parameters<
          typeof basePersistence.upsertLiveQueryConnectionLease
        >[0],
      ) {
        leaseTimes.push(input.lastSeenAt);
        expiryTimes.push(input.expiresAt);
        return await basePersistence.upsertLiveQueryConnectionLease(input);
      },
      async closeLiveQueryConnection(
        input: Parameters<typeof basePersistence.closeLiveQueryConnection>[0],
      ) {
        closeTimes.push(input.closedAt);
        return await basePersistence.closeLiveQueryConnection(input);
      },
    };

    await runEffect(Effect.gen(function* () {
      const readTime = makeLiveQueryTimeEffect(undefined);
      yield* TestClock.setTime(1_000);
      yield* touchLiveQueryConnectionEffect(persistence, readTime, {
        deploymentId: "deployment_live_query_effect",
        projectId: "project_live_query_effect",
        connectionId: "connection_effect",
        leaseDurationMs: 60,
      });
      yield* TestClock.setTime(2_000);
      yield* removeLiveQuerySubscriptionsForConnectionEffect(
        persistence,
        readTime,
        {
          deploymentId: "deployment_live_query_effect",
          projectId: "project_live_query_effect",
          connectionId: "connection_effect",
        },
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(leaseTimes).toEqual([new Date(1_000)]);
    expect(expiryTimes).toEqual([new Date(1_060)]);
    expect(closeTimes).toEqual([new Date(2_000)]);
  });

  it("suppresses time reads for every explicit lease and cutoff override", async () => {
    const timeDefect = new Error("live query time must not be read");
    const readTime = Effect.die(timeDefect);
    const basePersistence = memoryPersistence();
    const leaseTimes: Date[] = [];
    const expiryCutoffs: Date[] = [];
    const activeCutoffs: Date[] = [];
    const persistence = {
      ...basePersistence,
      async upsertLiveQueryConnectionLease(
        input: Parameters<
          typeof basePersistence.upsertLiveQueryConnectionLease
        >[0],
      ) {
        leaseTimes.push(input.lastSeenAt);
        return await basePersistence.upsertLiveQueryConnectionLease(input);
      },
      async upsertLiveQuerySubscriptionWithLease(
        input: Parameters<
          typeof basePersistence.upsertLiveQuerySubscriptionWithLease
        >[0],
      ) {
        leaseTimes.push(input.lastSeenAt);
        return await basePersistence.upsertLiveQuerySubscriptionWithLease(input);
      },
      async deleteExpiredLiveQuerySubscriptions(
        input: Parameters<
          typeof basePersistence.deleteExpiredLiveQuerySubscriptions
        >[0],
      ) {
        expiryCutoffs.push(input.expiredAt);
        return await basePersistence.deleteExpiredLiveQuerySubscriptions(input);
      },
      async listExpiredLiveQueryConnectionDeployments(
        input: Parameters<
          typeof basePersistence.listExpiredLiveQueryConnectionDeployments
        >[0],
      ) {
        expiryCutoffs.push(input.expiredAt);
        return await basePersistence.listExpiredLiveQueryConnectionDeployments(
          input,
        );
      },
      async listActiveLiveQuerySubscriptions(
        input: Parameters<
          typeof basePersistence.listActiveLiveQuerySubscriptions
        >[0],
      ) {
        activeCutoffs.push(input.activeAt);
        return await basePersistence.listActiveLiveQuerySubscriptions(input);
      },
    };
    const touchNow = new Date(100);
    const updatedAt = new Date(200);
    const expiredAt = new Date(0);
    const activeAt = new Date(300);
    const freshnessStore = createMemoryFreshnessMirrorStore();

    await runEffect(touchLiveQueryConnectionEffect(persistence, readTime, {
      deploymentId: "deployment_live_query_override",
      projectId: "project_live_query_override",
      connectionId: "connection_touch",
      now: touchNow,
    }));
    await runEffect(recordLiveQuerySubscriptionEffect(
      persistence,
      readTime,
      {
        deploymentId: "deployment_live_query_override",
        projectId: "project_live_query_override",
        connectionId: "connection_subscription",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 1,
        readSet: {},
        resultJson: null,
        updatedAt,
      },
    ));
    await runEffect(removeExpiredLiveQuerySubscriptionsEffect(
      persistence,
      readTime,
      {
        deploymentId: "deployment_live_query_override",
        projectId: "project_live_query_override",
        expiredAt,
      },
    ));
    await runEffect(listExpiredLiveQueryConnectionDeploymentsEffect(
      persistence,
      readTime,
      { expiredAt },
    ));
    await runEffect(findStaleLiveQuerySubscriptionsEffect(
      persistence,
      readTime,
      {
        deploymentId: "deployment_live_query_override",
        freshnessStore,
        activeAt,
      },
    ));
    await runEffect(rerunStaleLiveQuerySubscriptionsEffect(
      persistence,
      readTime,
      { nextId: () => "delivery_must_not_be_needed" },
      {
        deploymentId: "deployment_live_query_override",
        freshnessStore,
        activeAt,
        async runQuery() {
          throw new Error("fresh subscription must not rerun");
        },
      },
    ));

    expect(leaseTimes).toEqual([touchNow, updatedAt]);
    expect(expiryCutoffs).toEqual([expiredAt, expiredAt]);
    expect(activeCutoffs).toEqual([activeAt, activeAt]);
  });

  it("preserves project mismatch as a directly typed Effect failure", async () => {
    const persistence = memoryPersistence();
    await persistence.ensureDeploymentAuthority({
      deploymentId: "deployment_live_query_project_mismatch_effect",
      projectId: "project_actual",
    });

    const result = await runEffect(Effect.result(
      touchLiveQueryConnectionEffect(
        persistence,
        Effect.die(new Error("project mismatch must suppress time")),
        {
          deploymentId: "deployment_live_query_project_mismatch_effect",
          projectId: "project_expected",
          connectionId: "connection_mismatch",
        },
      ),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeploymentProjectMismatchError);
    }
  });
});
