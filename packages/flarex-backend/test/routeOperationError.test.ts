import { describe, expect, it } from "vitest";

import { HttpError } from "../src/http";
import {
  routeOperationErrorFields,
  routeOperationErrorToHttpError,
} from "../src/routeOperationError";

describe("backend route operation errors", () => {
  it("preserves an owned HTTP failure", () => {
    const cause = new HttpError(503, "Route dependency unavailable.");

    expect(routeOperationErrorFields("refresh", cause)).toEqual({
      operation: "refresh",
      status: 503,
      message: "Route dependency unavailable.",
      cause,
    });
  });

  it.each([
    [new Error("Route dependency failed."), "Route dependency failed."],
    ["Route dependency failed.", "Route dependency failed."],
  ])("maps an unowned cause to status 500", (cause, message) => {
    expect(routeOperationErrorFields("refresh", cause)).toEqual({
      operation: "refresh",
      status: 500,
      message,
      cause,
    });
  });

  it("allocates an HTTP error from the shared status and message facet", () => {
    const source = {
      operation: "refresh" as const,
      status: 409,
      message: "Route operation conflicted.",
      cause: new Error("cause retained by the domain error"),
    };

    const projected = routeOperationErrorToHttpError(source);

    expect(projected).toBeInstanceOf(HttpError);
    expect(projected).toMatchObject({
      status: 409,
      message: "Route operation conflicted.",
    });
    expect(projected).not.toBe(source);
  });
});
