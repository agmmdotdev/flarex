import { describe, expect, it } from "vitest";
import { registryFailureToHttpError } from "../src/registry/HttpBoundary";
import { RegistrySqlError } from "../src/registry/Store";
import { HttpError } from "../src/http";

describe("registry HTTP boundary", () => {
  it("maps registry storage failures to the preserved generic 500", () => {
    const failure = new RegistrySqlError({
      operation: "createDeployment",
      cause: new Error("insert failed"),
    });

    const error = registryFailureToHttpError(failure);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(500);
    expect(error.message).toBe("Registry storage error.");
  });
});
