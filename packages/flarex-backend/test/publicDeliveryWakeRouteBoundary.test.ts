import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePublicDeliveryWakeRequest,
  readPublicDeliveryWakeRequest,
} from "../src/delivery/PublicWakeRouteBoundary";

describe("public delivery wake route boundary", () => {
  it("decodes wake requests with the route deployment id", async () => {
    await expect(readPublicDeliveryWakeRequest(jsonRequest({
      deploymentId: "body-deployment",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      ignored: true,
    }), "route-deployment")).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
    });
  });

  it("maps invalid wake bodies to 400", () => {
    expect(() => parsePublicDeliveryWakeRequest(null, "deployment-a"))
      .toThrow(HttpError);

    const cases: Array<{
      field: "limit" | "maxBatches" | "leaseDurationMs";
      expected: string;
    }> = [
      { field: "limit", expected: "limit must be a positive integer." },
      { field: "maxBatches", expected: "maxBatches must be a positive integer." },
      {
        field: "leaseDurationMs",
        expected: "leaseDurationMs must be a positive integer.",
      },
    ];
    for (const testCase of cases) {
      try {
        parsePublicDeliveryWakeRequest({
          [testCase.field]: 0,
        }, "deployment-a");
        throw new Error("Expected parsePublicDeliveryWakeRequest to fail.");
      } catch (error) {
        expect(error).toMatchObject({
          status: 400,
          message: testCase.expected,
        });
      }
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readPublicDeliveryWakeRequest(new Request(
      "https://flarex.test/deployments/deployment-a/sync/wake-delivery",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), "deployment-a")).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/deployments/deployment-a/sync/wake-delivery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
