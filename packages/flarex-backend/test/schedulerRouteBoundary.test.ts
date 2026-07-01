import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeSchedulerCleanupConnectionsRoutePayload,
  decodeSchedulerCleanupConnectionsRequest,
  decodeSchedulerConnectionReconcileRoutePayload,
  decodeSchedulerConnectionReconcileRequest,
  decodeSchedulerDeadLetterDeliveriesRoutePayload,
  decodeSchedulerDeadLetterDeliveriesRequest,
  decodeSchedulerDeliveryReconcileRoutePayload,
  decodeSchedulerDeliveryReconcileRequest,
  decodeSchedulerRerunSubscriptionsRoutePayload,
  decodeSchedulerRerunSubscriptionsRequest,
  parseSchedulerCleanupConnectionsRequest,
  parseSchedulerDeadLetterDeliveriesRequest,
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeliveryReconcileRequest,
  parseSchedulerDeliveryReconcileRequestEffect,
  parseSchedulerRerunSubscriptionsRequest,
  readSchedulerCleanupConnectionsRequest,
  readSchedulerDeadLetterDeliveriesRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeliveryReconcileRequest,
  readSchedulerRerunSubscriptionsRequest,
  schedulerRouteErrorToHttpError,
} from "../src/scheduler/RouteBoundary";
import {
  decodeSchedulerCleanupConnectionsPayload,
  decodeSchedulerDeadLetterDeliveriesPayload,
  decodeSchedulerDeliveryReconcilePayload,
  decodeSchedulerRerunSubscriptionsPayload,
  SchedulerRoutePayloadError,
} from "../src/scheduler/Requests";
import {
  decodePendingConnectionCleanupFromStorage,
  decodePendingDeliveryReconcileFromStorage,
  decodePendingRerunFromStorage,
  SchedulerPendingStateError,
  schedulerPendingStateErrorToHttpError,
  type PendingLiveQueryConnectionCleanup,
  type PendingLiveQueryDeliveryReconcile,
  type PendingLiveQueryRerun,
} from "../src/scheduler/PendingState";
import {
  SchedulerRouteOperationError,
  schedulerRouteOperationError,
  schedulerRouteOperationErrorToHttpError,
} from "../src/scheduler/RouteOperationError";
import {
  SchedulerConnectionTargetError,
  SchedulerContinuationCursorError,
  schedulerRuntimeErrorToHttpError,
} from "../src/scheduler/RuntimeError";
import {
  routeSchedulerContinueConnectionCleanup,
  routeSchedulerEffectJsonResult,
  runSchedulerRoute,
  schedulerInternalRouteErrorToHttpErrorEffect,
  schedulerInternalRouteErrorToResponseEffect,
} from "../src/scheduler/InternalRouteBoundary";
import type { Env } from "../src/types";

describe("scheduler route boundary", () => {
  it("decodes scheduler maintenance payloads through a shared typed boundary", async () => {
    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcilePayload({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000+00:00",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("decodes scheduler route payloads through named Effect boundaries", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcileRoutePayload({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000+00:00",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });

    await expect(Effect.runPromise(decodeSchedulerConnectionReconcileRoutePayload({
      cursor: {
        oldestExpiredAt: "not a date",
        deploymentId: "deployment-a",
      },
    }))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "cursor.oldestExpiredAt must be an ISO date string.",
    });

    await expect(Effect.runPromise(decodeSchedulerRerunSubscriptionsRoutePayload({
      deploymentId: "deployment-a",
      maxBatches: 3,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      maxBatches: 3,
    });

    await expect(Effect.runPromise(decodeSchedulerDeadLetterDeliveriesRoutePayload({
      stuckAfterMs: 0,
    }))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "stuckAfterMs must be a positive integer.",
    });

    await expect(Effect.runPromise(decodeSchedulerCleanupConnectionsRoutePayload({
      deploymentId: "deployment-a",
    }, env))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-default",
    });

    await expect(Effect.runPromise(decodeSchedulerCleanupConnectionsRoutePayload({
      deploymentId: "deployment-a",
    }, {} as Env))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });
  });

  it("decodes delivery reconcile requests", async () => {
    await expect(readSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 3,
    })))).resolves.toEqual({ limit: 3 });
  });

  it("maps invalid delivery reconcile bodies to 400", () => {
    expect(() => parseSchedulerDeliveryReconcileRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerDeliveryReconcileRequest({
        cursor: {
          oldestCreatedAt: "not a date",
          deploymentId: "deployment-a",
        },
      });
      throw new Error("Expected parseSchedulerDeliveryReconcileRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "cursor.oldestCreatedAt must be an ISO date string.",
      });
    }
  });

  it("exposes typed delivery reconcile validation failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(parseSchedulerDeliveryReconcileRequestEffect({
      cursor: {
        oldestCreatedAt: "not a date",
        deploymentId: "deployment-a",
      },
    }))).rejects.toBeInstanceOf(SchedulerRoutePayloadError);
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readSchedulerDeliveryReconcileRequest(new Request(
      "https://flarex.test/reconcile/live-query-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcileRequest(new Request(
      "https://flarex.test/reconcile/live-query-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("decodes connection cleanup reconcile requests", async () => {
    await expect(readSchedulerConnectionReconcileRequest(jsonRequest({
      expiredAt: "2026-06-23T00:00:05.000Z",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      expiredAt: "2026-06-23T00:00:05.000Z",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
    await expect(Effect.runPromise(decodeSchedulerConnectionReconcileRequest(jsonRequest({
      limit: 4,
    })))).resolves.toEqual({ limit: 4 });
  });

  it("maps invalid connection cleanup reconcile bodies to 400", () => {
    expect(() => parseSchedulerConnectionReconcileRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerConnectionReconcileRequest({
        cursor: {
          oldestExpiredAt: "not a date",
          deploymentId: "deployment-a",
        },
      });
      throw new Error("Expected parseSchedulerConnectionReconcileRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "cursor.oldestExpiredAt must be an ISO date string.",
      });
    }
  });

  it("preserves malformed connection cleanup reconcile JSON as the shared JSON body error", async () => {
    await expect(readSchedulerConnectionReconcileRequest(new Request(
      "https://flarex.test/reconcile/live-query-connections",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes live query subscription rerun requests", async () => {
    await expect(readSchedulerRerunSubscriptionsRequest(jsonRequest({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
    });
    await expect(Effect.runPromise(decodeSchedulerRerunSubscriptionsRequest(jsonRequest({
      deploymentId: "deployment-b",
    })))).resolves.toEqual({ deploymentId: "deployment-b" });
  });

  it("maps invalid live query subscription rerun bodies to 400", () => {
    expect(() => parseSchedulerRerunSubscriptionsRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerRerunSubscriptionsRequest({
        deploymentId: "",
        limit: 1,
      });
      throw new Error("Expected parseSchedulerRerunSubscriptionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "deploymentId must be a non-empty string.",
      });
    }
  });

  it("maps invalid live query subscription rerun limits to 400", () => {
    try {
      parseSchedulerRerunSubscriptionsRequest({
        deploymentId: "deployment-a",
        maxBatches: 0,
      });
      throw new Error("Expected parseSchedulerRerunSubscriptionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "maxBatches must be a positive integer.",
      });
    }
  });

  it("preserves malformed live query subscription rerun JSON as the shared JSON body error", async () => {
    await expect(readSchedulerRerunSubscriptionsRequest(new Request(
      "https://flarex.test/rerun/live-query-subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes dead-letter delivery requests", async () => {
    const cursor = { deliveryId: "delivery-a" };
    await expect(readSchedulerDeadLetterDeliveriesRequest(jsonRequest({
      deploymentId: "deployment-a",
      olderThan: "2026-06-23T00:00:05.000Z",
      minAttempts: 4,
      cursor,
      limit: 7,
      reason: "stuck test delivery",
      deadLetteredAt: "2026-06-23T00:00:10.000Z",
      maxBatches: 2,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 5 * 60 * 1000,
      minAttempts: 4,
      cursor,
      limit: 7,
      reason: "stuck test delivery",
      deadLetteredAt: "2026-06-23T00:00:10.000Z",
      maxBatches: 2,
    });
    await expect(Effect.runPromise(decodeSchedulerDeadLetterDeliveriesRequest(jsonRequest({
      olderThan: "2026-06-23T00:00:05.000Z",
    })))).resolves.toMatchObject({
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 5 * 60 * 1000,
    });
  });

  it("preserves dead-letter request defaults", () => {
    const before = Date.now();
    const request = parseSchedulerDeadLetterDeliveriesRequest({});
    const after = Date.now();

    expect(request.stuckAfterMs).toBe(5 * 60 * 1000);
    expect(request.minAttempts).toBe(3);
    expect(request.limit).toBe(100);
    expect(request.reason).toBe("live query delivery stuck");
    expect(request.maxBatches).toBe(3);
    expect(new Date(request.olderThan).getTime()).toBeGreaterThanOrEqual(
      before - request.stuckAfterMs,
    );
    expect(new Date(request.olderThan).getTime()).toBeLessThanOrEqual(
      after - request.stuckAfterMs,
    );
    expect(new Date(request.deadLetteredAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(request.deadLetteredAt).getTime()).toBeLessThanOrEqual(after);
  });

  it("preserves explicit dead-letter olderThan precedence over stuckAfterMs", () => {
    expect(parseSchedulerDeadLetterDeliveriesRequest({
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 0,
    })).toMatchObject({
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 5 * 60 * 1000,
    });
  });

  it("maps invalid dead-letter delivery bodies to 400", () => {
    expect(() => parseSchedulerDeadLetterDeliveriesRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerDeadLetterDeliveriesRequest({
        olderThan: "not a date",
      });
      throw new Error("Expected parseSchedulerDeadLetterDeliveriesRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "olderThan must be an ISO date string.",
      });
    }
  });

  it("maps invalid dead-letter delivery limits to 400", () => {
    try {
      parseSchedulerDeadLetterDeliveriesRequest({
        stuckAfterMs: 0,
      });
      throw new Error("Expected parseSchedulerDeadLetterDeliveriesRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "stuckAfterMs must be a positive integer.",
      });
    }
  });

  it("preserves malformed dead-letter delivery JSON as the shared JSON body error", async () => {
    await expect(readSchedulerDeadLetterDeliveriesRequest(new Request(
      "https://flarex.test/dead-letter/live-query-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes live query connection cleanup requests", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    await expect(readSchedulerCleanupConnectionsRequest(jsonRequest({
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-06-23T00:00:10.000+00:00",
      ignored: true,
    }), env)).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-06-23T00:00:10.000Z",
    });
    await expect(Effect.runPromise(decodeSchedulerCleanupConnectionsRequest(jsonRequest({
      deploymentId: "deployment-b",
    }), env))).resolves.toEqual({
      deploymentId: "deployment-b",
      projectId: "project-default",
    });
  });

  it("uses the configured project id for cleanup requests without projectId", () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    expect(parseSchedulerCleanupConnectionsRequest({
      deploymentId: "deployment-a",
    }, env)).toEqual({
      deploymentId: "deployment-a",
      projectId: "project-default",
    });
  });

  it("maps invalid live query connection cleanup bodies to 400", () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    expect(() => parseSchedulerCleanupConnectionsRequest(null, env))
      .toThrow(HttpError);
    try {
      parseSchedulerCleanupConnectionsRequest({
        deploymentId: "deployment-a",
        expiredAt: "not a date",
      }, env);
      throw new Error("Expected parseSchedulerCleanupConnectionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "expiredAt must be an ISO date string.",
      });
    }
  });

  it("requires projectId when cleanup request env has no project id", () => {
    const env = {} as Env;

    expect(() => parseSchedulerCleanupConnectionsRequest({
      deploymentId: "deployment-a",
    }, env)).toThrowError(
      "projectId is required when FLAREX_PROJECT_ID is not configured.",
    );
  });

  it("preserves malformed live query connection cleanup JSON as the shared JSON body error", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(readSchedulerCleanupConnectionsRequest(new Request(
      "https://flarex.test/cleanup/live-query-connections",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), env)).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("maps typed scheduler route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(schedulerRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new SchedulerRoutePayloadError({
      message: "limit must be a positive integer.",
    });
    expect(schedulerRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "limit must be a positive integer.",
    });
  });

  it("exposes shared typed scheduler payload failures before HTTP mapping", async () => {
    const deliveryFailure = await Effect.runPromise(Effect.flip(decodeSchedulerDeliveryReconcilePayload({
      cursor: {
        oldestCreatedAt: "not a date",
        deploymentId: "deployment-a",
      },
    })));

    expect(deliveryFailure).toBeInstanceOf(SchedulerRoutePayloadError);
    expect(deliveryFailure).toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "cursor.oldestCreatedAt must be an ISO date string.",
    });

    await expect(Effect.runPromise(Effect.flip(decodeSchedulerRerunSubscriptionsPayload({
      deploymentId: "",
    })))).resolves.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "deploymentId must be a non-empty string.",
    });

    await expect(Effect.runPromise(Effect.flip(decodeSchedulerDeadLetterDeliveriesPayload({
      stuckAfterMs: 0,
    })))).resolves.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "stuckAfterMs must be a positive integer.",
    });

    await expect(Effect.runPromise(Effect.flip(decodeSchedulerCleanupConnectionsPayload({
      deploymentId: "deployment-a",
    }, {} as Env)))).resolves.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });
  });

  it("exposes typed scheduler pending-state failures", async () => {
    const deliveryPending: PendingLiveQueryDeliveryReconcile = {
      limit: 20,
      deliveryLimit: 10,
      maxBatches: 3,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
      retryAttempt: 1,
      nextRunAt: "2026-06-23T00:00:11.000Z",
    };
    await expect(Effect.runPromise(
      decodePendingDeliveryReconcileFromStorage(deliveryPending),
    )).resolves.toEqual(deliveryPending);

    await expectSchedulerPendingStateFailure(
      decodePendingDeliveryReconcileFromStorage(null),
      "pending live query delivery reconcile must be an object.",
    );
    await expectSchedulerPendingStateFailure(
      decodePendingDeliveryReconcileFromStorage({
        ...deliveryPending,
        cursor: {
          oldestCreatedAt: "not a date",
          deploymentId: "deployment-a",
        },
      }),
      "pending delivery reconcile cursor.oldestCreatedAt must be an ISO date string.",
    );

    const cleanupPending: PendingLiveQueryConnectionCleanup = {
      expiredAt: "2026-06-23T00:00:00.000Z",
      limit: 25,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
      retryAttempt: 2,
      nextRunAt: "2026-06-23T00:00:12.000Z",
    };
    await expect(Effect.runPromise(
      decodePendingConnectionCleanupFromStorage(cleanupPending),
    )).resolves.toEqual(cleanupPending);
    await expectSchedulerPendingStateFailure(
      decodePendingConnectionCleanupFromStorage({
        ...cleanupPending,
        expiredAt: "not a date",
      }),
      "pending connection cleanup expiredAt must be an ISO date string.",
    );

    const rerunPending: PendingLiveQueryRerun = {
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 50,
      deliveryLimit: 10,
      maxBatches: 3,
      retryAttempt: 0,
      nextRunAt: "2026-06-23T00:00:13.000Z",
    };
    await expect(Effect.runPromise(
      decodePendingRerunFromStorage(rerunPending),
    )).resolves.toEqual(rerunPending);
    await expectSchedulerPendingStateFailure(
      decodePendingRerunFromStorage({
        ...rerunPending,
        limit: 0,
      }),
      "pending rerun limit must be a positive integer.",
    );
  });

  it("maps scheduler pending-state errors at the adapter boundary", () => {
    expect(schedulerPendingStateErrorToHttpError(
      new SchedulerPendingStateError({
        message: "pending rerun limit must be a positive integer.",
      }),
    )).toMatchObject({
      status: 500,
      message: "pending rerun limit must be a positive integer.",
    });
  });

  it("maps malformed connection cleanup continuation state through the continue route adapter", async () => {
    const response = await runSchedulerRoute(
      routeSchedulerContinueConnectionCleanup(() =>
        Effect.fail(new SchedulerPendingStateError({
          message: "pending connection cleanup limit must be a positive integer.",
        }))
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "pending connection cleanup limit must be a positive integer.",
    });
  });

  it("maps scheduler internal route errors through the named response adapter", async () => {
    await expect(Effect.runPromise(schedulerInternalRouteErrorToHttpErrorEffect(
      new SchedulerPendingStateError({
        message: "pending scheduler state is invalid.",
      }),
    ))).rejects.toMatchObject({
      status: 500,
      message: "pending scheduler state is invalid.",
    });

    const response = await Effect.runPromise(schedulerInternalRouteErrorToResponseEffect(
      new SchedulerPendingStateError({
        message: "pending scheduler state is invalid.",
      }),
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "pending scheduler state is invalid.",
    });
  });

  it("maps malformed delivery continuation state through the scheduler route adapter", async () => {
    const response = await runSchedulerRoute(
      routeSchedulerEffectJsonResult(() =>
        Effect.fail(new SchedulerPendingStateError({
          message: "pending delivery reconcile limit must be a positive integer.",
        }))
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "pending delivery reconcile limit must be a positive integer.",
    });
  });

  it("maps malformed rerun continuation state through the scheduler route adapter", async () => {
    const response = await runSchedulerRoute(
      routeSchedulerEffectJsonResult(() =>
        Effect.fail(new SchedulerPendingStateError({
          message: "pending rerun deploymentId must be a non-empty string.",
        }))
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "pending rerun deploymentId must be a non-empty string.",
    });
  });

  it("maps scheduler runtime consistency errors at the adapter boundary", () => {
    expect(schedulerRuntimeErrorToHttpError(
      new SchedulerContinuationCursorError({
        operation: "delivery-reconcile",
        message: "Pending delivery deployment scan returned hasMore without nextCursor.",
      }),
    )).toMatchObject({
      status: 502,
      message: "Pending delivery deployment scan returned hasMore without nextCursor.",
    });

    expect(schedulerRuntimeErrorToHttpError(
      new SchedulerConnectionTargetError({
        connectionId: "invalid-connection",
        message: "Invalid live query connection id invalid-connection.",
      }),
    )).toMatchObject({
      status: 502,
      message: "Invalid live query connection id invalid-connection.",
    });
  });

  it("maps scheduler runtime failures through the scheduler route adapter", async () => {
    const response = await runSchedulerRoute(
      routeSchedulerEffectJsonResult(() =>
        Effect.fail(new SchedulerConnectionTargetError({
          connectionId: "invalid-connection",
          message: "Invalid live query connection id invalid-connection.",
        }))
      ),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid live query connection id invalid-connection.",
    });
  });

  it("preserves scheduler operation failures before HTTP mapping", () => {
    const cause = new HttpError(502, "Pending deployments failed.");
    const httpFailure = schedulerRouteOperationError("delivery-reconcile", cause);

    expect(httpFailure).toBeInstanceOf(SchedulerRouteOperationError);
    expect(httpFailure).toMatchObject({
      operation: "delivery-reconcile",
      status: 502,
      message: "Pending deployments failed.",
      cause,
    });
    expect(schedulerRouteOperationErrorToHttpError(httpFailure)).toMatchObject({
      status: 502,
      message: "Pending deployments failed.",
    });

    const runtimeFailure = schedulerRouteOperationError(
      "continue-connection-cleanup",
      new Error("storage alarm failed"),
    );
    expect(runtimeFailure).toMatchObject({
      operation: "continue-connection-cleanup",
      status: 500,
      message: "storage alarm failed",
    });
    expect(schedulerRouteOperationErrorToHttpError(runtimeFailure)).toMatchObject({
      status: 500,
      message: "storage alarm failed",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/reconcile/live-query-deliveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectSchedulerPendingStateFailure(
  effect: Effect.Effect<unknown, SchedulerPendingStateError>,
  message: string,
): Promise<void> {
  const failure = await Effect.runPromise(effect.pipe(
    Effect.catchTag("SchedulerPendingStateError", error => Effect.succeed(error)),
  ));
  expect(failure).toBeInstanceOf(SchedulerPendingStateError);
  if (!(failure instanceof SchedulerPendingStateError)) {
    throw new Error("Expected SchedulerPendingStateError.");
  }
  expect(failure.message).toBe(message);
}
