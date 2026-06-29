import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  publicWorkerDispatchError,
  publicWorkerDispatchErrorToHttpError,
  PublicWorkerDispatchError,
} from "../src/worker/PublicRouteDispatchError";

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
});
