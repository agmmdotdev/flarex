import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  authorizePublicLiveQueryDeliveryRequest,
  publicLiveQueryDeliveryAuthorizationErrorToHttpError,
  PublicLiveQueryDeliveryAuthorizationError,
} from "../src/worker/PublicLiveQueryDeliveryAuthorization";
import type { Env } from "../src/types";

describe("public live query delivery authorization", () => {
  it("allows delivery requests when no token is configured", async () => {
    await expect(Effect.runPromise(authorizePublicLiveQueryDeliveryRequest(
      new Request("https://flarex.test/scheduler/live-query-deliveries/reconcile"),
      {} as Env,
    ))).resolves.toBeUndefined();
  });

  it("exposes unauthorized delivery requests as typed route failures", async () => {
    const request = new Request("https://flarex.test/scheduler/live-query-deliveries/reconcile", {
      headers: { authorization: "Bearer wrong" },
    });
    const env = { FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret" } as Env;

    await expect(Effect.runPromise(authorizePublicLiveQueryDeliveryRequest(request, env)))
      .rejects.toBeInstanceOf(PublicLiveQueryDeliveryAuthorizationError);

    expect(publicLiveQueryDeliveryAuthorizationErrorToHttpError(
      new PublicLiveQueryDeliveryAuthorizationError(),
    )).toMatchObject({
      status: 401,
      message: "Unauthorized live query delivery request.",
    });
  });
});
