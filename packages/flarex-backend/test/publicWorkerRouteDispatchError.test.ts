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
    const error = publicWorkerDispatchError("delivery-wake", new Error("Binding failed."));

    expect(error).toMatchObject({
      source: "delivery-wake",
      status: 500,
      message: "Binding failed.",
    });
    expect(publicWorkerDispatchErrorToHttpError(error)).toMatchObject({
      status: 500,
      message: "Binding failed.",
    });
  });
});
