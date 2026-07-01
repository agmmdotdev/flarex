import { describe, expect, it } from "vitest";
import { HttpError, ResponseJsonError } from "../src/http";
import { PartitionRequestError } from "../src/transaction";
import {
  publicWorkerDispatchError,
  publicWorkerDispatchErrorToAdapterError,
  publicWorkerDispatchErrorToHttpError,
  publicWorkerDispatchErrorToHttpErrorEffect,
  PublicWorkerDispatchError,
} from "../src/worker/PublicRouteDispatchError";
import { Effect } from "effect";

describe("public Worker route dispatch errors", () => {
  it("preserves downstream HttpError status and message as a typed dispatch failure", () => {
    const cause = new HttpError(503, "Execution DO unavailable.");
    const error = publicWorkerDispatchError("execution-start", cause);

    expect(error).toBeInstanceOf(PublicWorkerDispatchError);
    expect(error).toMatchObject({
      source: "execution-start",
      status: 503,
      message: "Execution DO unavailable.",
      cause,
    });
    expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
      status: 503,
      message: "Execution DO unavailable.",
    });
    expect(publicWorkerDispatchErrorToAdapterError(error)).toMatchObject({
      status: 503,
      message: "Execution DO unavailable.",
    });
  });

  it("preserves partition request failures for public invoke response mapping", () => {
    const cause = new PartitionRequestError(409, {
      code: "OCC_CONFLICT",
      error: "Read set changed.",
    });
    const error = publicWorkerDispatchError("invoke-execute", cause);

    expect(error).toMatchObject({
      source: "invoke-execute",
      status: 500,
      message: "Partition request failed with status 409.",
      cause,
    });
    expect(publicWorkerDispatchErrorToAdapterError(error)).toBe(cause);
  });

  it("maps non-HTTP dispatch failures to the existing 500 adapter shape", () => {
    const error = publicWorkerDispatchError(
      "scheduler-delivery-reconcile",
      new Error("Binding failed."),
    );

    expect(error).toMatchObject({
      source: "scheduler-delivery-reconcile",
      status: 500,
      message: "Binding failed.",
    });
    expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
      status: 500,
      message: "Binding failed.",
    });
  });

  it("maps dispatch failures through a named adapter effect", async () => {
    const error = publicWorkerDispatchError(
      "registry-deployments",
      new Error("registry unavailable"),
    );

    await expect(Effect.runPromise(Effect.flip(
      publicWorkerDispatchErrorToHttpErrorEffect(error),
    ))).resolves.toMatchObject({
      status: 500,
      message: "registry unavailable",
    });
  });

  it("covers public scheduler dispatch sources", () => {
    const sources = [
      "scheduler-delivery-reconcile",
      "scheduler-connection-reconcile",
      "scheduler-dead-letter-deliveries",
      "scheduler-cleanup-connections",
      "scheduler-rerun-subscriptions",
      "scheduler-trigger-subscriptions",
    ] as const;

    for (const source of sources) {
      const error = publicWorkerDispatchError(source, new Error(`${source} failed.`));

      expect(error).toMatchObject({
        source,
        status: 500,
        message: `${source} failed.`,
      });
      expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
        status: 500,
        message: `${source} failed.`,
      });
    }
  });

  it("maps public execution start response JSON failures as typed dispatch failures", () => {
    const cause = new ResponseJsonError({
      message: "Response body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    const error = publicWorkerDispatchError("execution-start-response", cause);

    expect(error).toMatchObject({
      source: "execution-start-response",
      status: 500,
      message: "Response body must be JSON.",
      cause,
    });
    expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
      status: 500,
      message: "Response body must be JSON.",
    });
  });

  it("covers public deployment push dispatch sources", () => {
    const sources = [
      "deployment-read-push",
      "deployment-start-push-analyze",
      "deployment-start-push-store-artifact",
      "deployment-start-push",
      "deployment-start-analyzed-push",
      "deployment-finish-push-artifact",
      "deployment-finish-push",
      "deployment-abandon-push",
    ] as const;

    for (const source of sources) {
      const error = publicWorkerDispatchError(source, new Error(`${source} failed.`));

      expect(error).toMatchObject({
        source,
        status: 500,
        message: `${source} failed.`,
      });
      expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
        status: 500,
        message: `${source} failed.`,
      });
    }
  });

  it("covers public invoke and partition dispatch sources", () => {
    const sources = [
      "invoke-execute",
      "partition-begin",
      "partition-commit",
      "partition-schema-cache",
      "partition-document-read",
      "partition-index-read",
    ] as const;

    for (const source of sources) {
      const error = publicWorkerDispatchError(source, new Error(`${source} failed.`));

      expect(error).toMatchObject({
        source,
        status: 500,
        message: `${source} failed.`,
      });
      expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
        status: 500,
        message: `${source} failed.`,
      });
    }
  });

  it("covers Worker pass-through dispatch sources", () => {
    const sources = [
      "registry-deployments",
      "deployment-active-read",
      "deployment-scheduler",
    ] as const;

    for (const source of sources) {
      const error = publicWorkerDispatchError(source, new Error(`${source} failed.`));

      expect(error).toMatchObject({
        source,
        status: 500,
        message: `${source} failed.`,
      });
      expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
        status: 500,
        message: `${source} failed.`,
      });
    }
  });

  it("covers public sync dispatch sources", () => {
    const sources = [
      "connection-sync",
      "live-query-delivery",
      "delivery-wake",
    ] as const;

    for (const source of sources) {
      const error = publicWorkerDispatchError(source, new Error(`${source} failed.`));

      expect(error).toMatchObject({
        source,
        status: 500,
        message: `${source} failed.`,
      });
      expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
        status: 500,
        message: `${source} failed.`,
      });
    }
  });
});
