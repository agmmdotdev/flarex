import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  cleanupPublicSchedulerConnectionsEffect,
  deadLetterPublicSchedulerDeliveriesEffect,
  reconcilePublicSchedulerConnectionsEffect,
  reconcilePublicSchedulerDeliveriesEffect,
  rerunPublicSchedulerSubscriptionsEffect,
  type PublicSchedulerDispatchTarget,
  triggerPublicSchedulerSubscriptionsEffect,
} from "../src/scheduler/PublicDispatchBoundary";
import type { PublicWorkerDispatchSource } from "../src/worker/PublicRouteDispatchError";

describe("public scheduler dispatch boundary", () => {
  it("dispatches public scheduler operations to the preserved internal routes", async () => {
    const operations = schedulerOperations();

    for (const operation of operations) {
      const requests: DispatchedRequest[] = [];
      const forwarded = Response.json({ ok: true });

      const response = await Effect.runPromise(operation.run(
        schedulerTarget(requests, async () => forwarded),
      ));

      expect(response).toBe(forwarded);
      expect(requests).toEqual([{
        input: `https://flarex.internal${operation.internalPath}`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(operation.body),
      }]);
    }
  });

  it("maps public scheduler dispatch failures to operation-specific worker errors", async () => {
    const operations = schedulerOperations();

    for (const operation of operations) {
      const failure = await Effect.runPromise(Effect.flip(operation.run(
        failingSchedulerTarget(`${operation.source} unavailable`),
      )));

      expect(failure).toMatchObject({
        _tag: "PublicWorkerDispatchError",
        source: operation.source,
        status: 500,
        message: `${operation.source} unavailable`,
      });
    }
  });
});

type DispatchedRequest = {
  readonly input: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: BodyInit | null | undefined;
};

type SchedulerOperation = {
  readonly source: PublicWorkerDispatchSource;
  readonly internalPath: string;
  readonly body: object;
  readonly run: (
    scheduler: PublicSchedulerDispatchTarget,
  ) => Effect.Effect<Response, unknown>;
};

function schedulerOperations(): SchedulerOperation[] {
  return [
    {
      source: "scheduler-delivery-reconcile",
      internalPath: "/reconcile/live-query-deliveries",
      body: { limit: 5, deliveryLimit: 10 },
      run: scheduler => reconcilePublicSchedulerDeliveriesEffect(
        scheduler,
        { limit: 5, deliveryLimit: 10 },
      ),
    },
    {
      source: "scheduler-connection-reconcile",
      internalPath: "/reconcile/live-query-connections",
      body: { expiredAt: "2026-06-23T00:00:05.000Z", limit: 7 },
      run: scheduler => reconcilePublicSchedulerConnectionsEffect(
        scheduler,
        { expiredAt: "2026-06-23T00:00:05.000Z", limit: 7 },
      ),
    },
    {
      source: "scheduler-dead-letter-deliveries",
      internalPath: "/dead-letter/live-query-deliveries",
      body: {
        deploymentId: "deployment-a",
        olderThan: "2026-06-23T00:00:05.000Z",
        stuckAfterMs: 300_000,
        minAttempts: 4,
        limit: 7,
        reason: "stuck test delivery",
        deadLetteredAt: "2026-06-23T00:00:10.000Z",
        maxBatches: 2,
      },
      run: scheduler => deadLetterPublicSchedulerDeliveriesEffect(
        scheduler,
        {
          deploymentId: "deployment-a",
          olderThan: "2026-06-23T00:00:05.000Z",
          stuckAfterMs: 300_000,
          minAttempts: 4,
          limit: 7,
          reason: "stuck test delivery",
          deadLetteredAt: "2026-06-23T00:00:10.000Z",
          maxBatches: 2,
        },
      ),
    },
    {
      source: "scheduler-cleanup-connections",
      internalPath: "/cleanup/live-query-connections",
      body: {
        deploymentId: "deployment-a",
        projectId: "project-a",
        expiredAt: "2026-06-23T00:00:10.000Z",
      },
      run: scheduler => cleanupPublicSchedulerConnectionsEffect(
        scheduler,
        {
          deploymentId: "deployment-a",
          projectId: "project-a",
          expiredAt: "2026-06-23T00:00:10.000Z",
        },
      ),
    },
    {
      source: "scheduler-rerun-subscriptions",
      internalPath: "/rerun/live-query-subscriptions",
      body: {
        deploymentId: "deployment-a",
        projectId: "project-a",
        limit: 4,
        deliveryLimit: 8,
        maxBatches: 2,
      },
      run: scheduler => rerunPublicSchedulerSubscriptionsEffect(
        scheduler,
        {
          deploymentId: "deployment-a",
          projectId: "project-a",
          limit: 4,
          deliveryLimit: 8,
          maxBatches: 2,
        },
      ),
    },
    {
      source: "scheduler-trigger-subscriptions",
      internalPath: "/rerun/live-query-subscriptions",
      body: {
        deploymentId: "deployment-a",
        projectId: "project-a",
        limit: 4,
        deliveryLimit: 8,
        maxBatches: 2,
      },
      run: scheduler => triggerPublicSchedulerSubscriptionsEffect(
        scheduler,
        {
          deploymentId: "deployment-a",
          projectId: "project-a",
          limit: 4,
          deliveryLimit: 8,
          maxBatches: 2,
        },
      ),
    },
  ];
}

function schedulerTarget(
  requests: DispatchedRequest[],
  respond: () => Promise<Response>,
): PublicSchedulerDispatchTarget {
  return {
    fetch: async (input, init) => {
      requests.push({
        input,
        method: init?.method,
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body,
      });
      return respond();
    },
  };
}

function failingSchedulerTarget(message: string): PublicSchedulerDispatchTarget {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}
