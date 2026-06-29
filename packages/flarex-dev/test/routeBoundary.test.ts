import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeDevInvokeBody,
  decodeLocalAnalyzerRequest,
} from "../src/routeBoundary";
import type { SourcePackage } from "../src/sourcePackage";

describe("flarex-dev route boundaries", () => {
  it("decodes local dev invoke bodies with header partition precedence", async () => {
    const request = jsonRequest(
      {
        path: "users:get",
        args: { id: "user:1" },
        partitionKey: "body-partition",
        kind: "query",
        idempotencyKey: "mutation-1",
      },
      { "x-flarex-partition": "header-partition" },
    );

    await expect(Effect.runPromise(decodeDevInvokeBody(request))).resolves.toEqual({
      path: "users:get",
      args: { id: "user:1" },
      partitionKey: "header-partition",
      kind: "query",
      idempotencyKey: "mutation-1",
    });
  });

  it("returns typed validation failures for invalid local dev invoke bodies", async () => {
    await expect(Effect.runPromise(decodeDevInvokeBody(jsonRequest({ args: null }))))
      .rejects.toMatchObject({
        _tag: "DevRouteValidationError",
        message: "Missing function path.",
      });
  });

  it("returns typed JSON failures for malformed local dev invoke bodies", async () => {
    const request = new Request("http://flarex.test/__flarex_dev/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    await expect(Effect.runPromise(decodeDevInvokeBody(request)))
      .rejects.toMatchObject({ _tag: "DevRequestJsonError" });
  });

  it("decodes local analyzer requests", async () => {
    const sourcePackage = testSourcePackage();

    await expect(Effect.runPromise(
      decodeLocalAnalyzerRequest(jsonRequest({ sourcePackage })),
    )).resolves.toEqual({ sourcePackage });
  });

  it("returns typed validation failures for local analyzer requests without sourcePackage", async () => {
    await expect(Effect.runPromise(decodeLocalAnalyzerRequest(jsonRequest({}))))
      .rejects.toMatchObject({
        _tag: "DevRouteValidationError",
        message: "Analyzer request missing sourcePackage.",
      });
  });
});

function jsonRequest(
  body: unknown,
  headers: HeadersInit = {},
): Request {
  return new Request("http://flarex.test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function testSourcePackage(): SourcePackage {
  return {
    modules: [{
      path: "_flarex/execution.js",
      source: "export default {};",
      environment: "isolate",
      sha256: "0".repeat(64),
    }],
    functions: [],
    execution: "_flarex/execution.js",
  };
}
