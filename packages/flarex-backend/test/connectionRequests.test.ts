import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { LiveQueryDeliveryChangePayloadError } from "../src/liveQueryDelivery";
import {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationPayload,
  decodeConnectionLiveQueryDeliveryPayload,
} from "../src/connection/Requests";

describe("connection request payloads", () => {
  it("decodes invalidation payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationPayload({ queryId: 42 })))
      .resolves
      .toBe(42);
  });

  it("keeps invalidation payload failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationPayload({
      queryId: "42",
    }))).rejects.toBeInstanceOf(ConnectionRouteValidationError);
  });

  it("decodes live-query delivery payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryPayload({
      deliveries: [liveQueryDeliveryChange()],
    }))).resolves.toEqual([liveQueryDeliveryChange()]);
  });

  it("keeps live-query delivery payload failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryPayload({
      deliveries: [{ queryId: 1 }],
    }))).rejects.toBeInstanceOf(LiveQueryDeliveryChangePayloadError);
  });
});

function liveQueryDeliveryChange() {
  return {
    kind: "updated",
    deploymentId: "deployment-a",
    connectionId: "connection:deployment-a:session-a",
    queryId: 1,
    functionPath: "users:get",
    argsJson: { id: "1:user" },
    resultJson: { name: "Ada" },
    previousResultHash: "previous",
    resultHash: "result",
  };
}
