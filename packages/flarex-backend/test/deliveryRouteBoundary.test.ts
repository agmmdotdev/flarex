import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseDeliveryWakeRequest,
  readDeliveryWakeRequest,
} from "../src/delivery/RouteBoundary";

describe("delivery route boundary", () => {
  it("decodes wake requests", async () => {
    await expect(readDeliveryWakeRequest(jsonRequest({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
    });
  });

  it("maps invalid wake bodies to 400", () => {
    expect(() => parseDeliveryWakeRequest(null))
      .toThrow(HttpError);
    try {
      parseDeliveryWakeRequest({
        deploymentId: "deployment-a",
        limit: 0,
      });
      throw new Error("Expected parseDeliveryWakeRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "limit must be a positive integer.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readDeliveryWakeRequest(new Request("https://flarex.test/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/wake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
