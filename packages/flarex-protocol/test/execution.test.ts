import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ExecutionProtocolValidationError,
  ExecutionStartRequestSchema,
  ExecutionSyscallRequestSchema,
  parseExecutionStartRequest,
  parseExecutionSyscallRequest,
} from "../src/execution";

const decodeExecutionStartRequest = Schema.decodeUnknownSync(
  ExecutionStartRequestSchema,
);
const decodeExecutionSyscallRequest = Schema.decodeUnknownSync(
  ExecutionSyscallRequestSchema,
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

  it("parses execution syscall requests used by ExecutionDO sessions", () => {
    expect(parseExecutionSyscallRequest({ op: "get", id: "1:user" }))
      .toEqual({ op: "get", id: "1:user" });
    expect(parseExecutionSyscallRequest({
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [
            { op: "eq", field: "userId", value: "u1" },
            { op: "gte", field: "lessonId", value: "intro" },
          ],
        },
        limit: 25,
        cursor: "after:intro",
        order: "desc",
      },
    })).toEqual({
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [
            { op: "eq", field: "userId", value: "u1" },
            { op: "gte", field: "lessonId", value: "intro" },
          ],
        },
        limit: 25,
        cursor: "after:intro",
        order: "desc",
      },
    });
    expect(parseExecutionSyscallRequest({
      op: "insert",
      table: "users",
      id: "1:user",
      value: { name: "Ada" },
    })).toEqual({
      op: "insert",
      table: "users",
      id: "1:user",
      value: { name: "Ada" },
    });
    expect(parseExecutionSyscallRequest({
      op: "patch",
      id: "1:user",
      value: { name: "Grace" },
    })).toEqual({
      op: "patch",
      id: "1:user",
      value: { name: "Grace" },
    });
    expect(parseExecutionSyscallRequest({
      op: "replace",
      id: "1:user",
      value: { name: "Lin" },
    })).toEqual({
      op: "replace",
      id: "1:user",
      value: { name: "Lin" },
    });
    expect(decodeExecutionSyscallRequest({ op: "delete", id: "1:user" }))
      .toEqual({ op: "delete", id: "1:user" });
  });

  it("rejects invalid execution syscall bodies", () => {
    expect(() => parseExecutionSyscallRequest(null))
      .toThrow(ExecutionProtocolValidationError);
    expect(() => parseExecutionSyscallRequest([]))
      .toThrow("Execution syscall request must be an object.");
    expect(() => parseExecutionSyscallRequest({ op: "unknown" }))
      .toThrow("Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.");
    expect(() => parseExecutionSyscallRequest({ op: "get" }))
      .toThrow("Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.");
    expect(() => parseExecutionSyscallRequest({
      op: "query",
      request: {
        table: "users",
        order: "sideways",
      },
    }))
      .toThrow("Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.");
    expect(() => parseExecutionSyscallRequest({
      op: "insert",
      table: "users",
      value: Number.NaN,
    }))
      .toThrow(ExecutionProtocolValidationError);
    expect(() => parseExecutionSyscallRequest({
      op: "patch",
      id: "1:user",
      value: new Date(0),
    }))
      .toThrow(ExecutionProtocolValidationError);
  });
});
