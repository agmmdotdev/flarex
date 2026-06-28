import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ExecutionProtocolValidationError,
  ExecutionStartRequestSchema,
  parseExecutionStartRequest,
} from "../src/execution";

const decodeExecutionStartRequest = Schema.decodeUnknownSync(
  ExecutionStartRequestSchema,
);

describe("execution protocol schemas", () => {
  it("parses execution start requests used by ExecutionDO sessions", () => {
    expect(parseExecutionStartRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      projectId: "project-a",
      kind: "query",
      idempotencyKey: "start-once",
    })).toEqual({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      projectId: "project-a",
      kind: "query",
      idempotencyKey: "start-once",
    });

    expect(decodeExecutionStartRequest({
      deploymentId: "deployment-b",
      path: "users:create",
      args: ["Ada", 1, null],
      kind: "mutation",
    })).toEqual({
      deploymentId: "deployment-b",
      path: "users:create",
      args: ["Ada", 1, null],
      kind: "mutation",
    });
  });

  it("requires deployment id, function path, and args", () => {
    expect(() => parseExecutionStartRequest({ path: "users:get", args: null }))
      .toThrow("Execution start request must include string deploymentId");
    expect(() => parseExecutionStartRequest({ deploymentId: "deployment-a", args: null }))
      .toThrow("Execution start request must include string deploymentId");
    expect(() => parseExecutionStartRequest({
      deploymentId: "deployment-a",
      path: "users:get",
    }))
      .toThrow("Execution start request must include string deploymentId");
  });

  it("rejects non-object bodies and invalid execution field shapes", () => {
    expect(() => parseExecutionStartRequest(null))
      .toThrow(ExecutionProtocolValidationError);
    expect(() => parseExecutionStartRequest([]))
      .toThrow("Execution start request must be an object.");
    expect(() => parseExecutionStartRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: null,
      kind: "action",
    }))
      .toThrow("Execution start request must include string deploymentId");
    expect(() => parseExecutionStartRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: new Date(0),
    }))
      .toThrow(ExecutionProtocolValidationError);
    expect(() => decodeExecutionStartRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: Number.NaN,
    }))
      .toThrow();
  });
});
