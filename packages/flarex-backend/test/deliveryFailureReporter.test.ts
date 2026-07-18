import { Effect, Logger } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

import {
  type DeliveryFailureReportInput,
  reportDeliveryFailureEffect,
} from "../src/delivery/FailureReporter";

const reportInput = {
  deploymentId: "deployment-a",
  deliveries: [{ deliveryId: "delivery-a" }],
  claimOwner: "delivery:deployment-a:owner-a",
  stage: "fanout",
  error: new Error("original delivery failure"),
} satisfies DeliveryFailureReportInput;

describe("reportDeliveryFailureEffect", () => {
  it("logs a non-OK response without replacing the original failure", async () => {
    const fetchJson = vi.fn(async (
      _path: string,
      _body: unknown,
    ): Promise<Response> =>
      Response.json({ error: "report rejected" }, { status: 503 })
    );
    const originalFailure = new Error("original drain failure");
    const logs = captureLogs();
    const failedAt = "2026-07-18T06:30:00.000Z";

    const preservedFailure = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(failedAt));
        return yield* Effect.fail(originalFailure).pipe(
          Effect.tapError(() => reportDeliveryFailureEffect(fetchJson, reportInput)),
          Effect.flip,
        );
      }).pipe(
        Effect.provide(logs.layer),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(preservedFailure).toBe(originalFailure);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const call = fetchJson.mock.calls[0];
    if (call === undefined) throw new Error("Expected a failure report request.");
    expect(call[0]).toBe("/maintenance/live-queries/failure");
    expect(call[1]).toMatchObject({
      deploymentId: "deployment-a",
      deliveryIds: ["delivery-a"],
      claimOwner: "delivery:deployment-a:owner-a",
      stage: "fanout",
      error: "original delivery failure",
      failedAt,
    });
    expectFailureReportTimestamp(call[1], failedAt);
    expect(logText(logs.messages)).toContain(
      "Live query delivery failure report failed with status 503.",
    );
  });

  it("logs a rejected request without replacing the original failure", async () => {
    const reportFailure = new Error("failure report unavailable");
    const fetchJson = vi.fn(async (
      _path: string,
      _body: unknown,
    ): Promise<Response> => {
      throw reportFailure;
    });
    const originalFailure = new Error("original drain failure");
    const logs = captureLogs();

    const preservedFailure = await Effect.runPromise(
      Effect.fail(originalFailure).pipe(
        Effect.tapError(() => reportDeliveryFailureEffect(fetchJson, reportInput)),
        Effect.flip,
        Effect.provide(logs.layer),
      ),
    );

    expect(preservedFailure).toBe(originalFailure);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(logText(logs.messages)).toContain(
      "Live query delivery failure report failed.",
    );
    expect(logText(logs.messages)).toContain(reportFailure.message);
  });
});

function captureLogs() {
  const messages: unknown[] = [];
  const logger = Logger.make(options => {
    messages.push(options.message);
  });
  return {
    messages,
    layer: Logger.layer([logger]),
  };
}

function logText(messages: ReadonlyArray<unknown>): string {
  return messages
    .flatMap(message => Array.isArray(message) ? message : [message])
    .map(message => String(message))
    .join(" ");
}

function expectFailureReportTimestamp(body: unknown, expected: string): void {
  if (body === null || typeof body !== "object") {
    throw new Error("Expected a failure report body.");
  }
  const failedAt = Reflect.get(body, "failedAt");
  expect(failedAt).toBe(expected);
}
