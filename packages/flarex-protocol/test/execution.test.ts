import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeExecutionFinishRequestEffect,
  decodeExecutionStartRequestEffect,
  decodeExecutionSyscallRequestEffect,
  ExecutionProtocolValidationError,
  ExecutionFinishRequestSchema,
  ExecutionStartRequestSchema,
  ExecutionSyscallRequestSchema,
} from "../src/execution";

const decodeExecutionStartRequest = Schema.decodeUnknownSync(
  ExecutionStartRequestSchema,
);
const decodeExecutionSyscallRequest = Schema.decodeUnknownSync(
  ExecutionSyscallRequestSchema,
);
const decodeExecutionFinishRequest = Schema.decodeUnknownSync(
  ExecutionFinishRequestSchema,
);

describe("execution protocol schemas", () => {
  it("decodes execution start requests used by ExecutionDO sessions", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      projectId: "project-a",
      kind: "query",
      idempotencyKey: "start-once",
    }))).resolves.toEqual({
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

  it("requires deployment id, function path, and args", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({ path: "users:get", args: null })))
      .rejects.toThrow("Execution start request must include string deploymentId");
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({ deploymentId: "deployment-a", args: null })))
      .rejects.toThrow("Execution start request must include string deploymentId");
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({
      deploymentId: "deployment-a",
      path: "users:get",
    })))
      .rejects.toThrow("Execution start request must include string deploymentId");
  });

  it("exposes typed execution start decode failures before compatibility parsing", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({
      deploymentId: "deployment-a",
      path: "users:get",
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionStartRequestEffect([])))
      .rejects.toMatchObject({
        schema: "ExecutionStartRequest",
        message: "Execution start request must be an object.",
      });
  });

  it("rejects non-object bodies and invalid execution field shapes", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect([])))
      .rejects.toThrow("Execution start request must be an object.");
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({
      deploymentId: "deployment-a",
      path: "users:get",
      args: null,
      kind: "action",
    })))
      .rejects.toThrow("Execution start request must include string deploymentId");
    await expect(Effect.runPromise(decodeExecutionStartRequestEffect({
      deploymentId: "deployment-a",
      path: "users:get",
      args: new Date(0),
    })))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    expect(() => decodeExecutionStartRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: Number.NaN,
    }))
      .toThrow();
  });

  it("decodes execution syscall requests used by ExecutionDO sessions", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({ op: "get", id: "1:user" })))
      .resolves.toEqual({ op: "get", id: "1:user" });
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
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
    }))).resolves.toEqual({
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
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "insert",
      table: "users",
      id: "1:user",
      value: { name: "Ada" },
    }))).resolves.toEqual({
      op: "insert",
      table: "users",
      id: "1:user",
      value: { name: "Ada" },
    });
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "patch",
      id: "1:user",
      value: { name: "Grace" },
    }))).resolves.toEqual({
      op: "patch",
      id: "1:user",
      value: { name: "Grace" },
    });
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "replace",
      id: "1:user",
      value: { name: "Lin" },
    }))).resolves.toEqual({
      op: "replace",
      id: "1:user",
      value: { name: "Lin" },
    });
    expect(decodeExecutionSyscallRequest({ op: "delete", id: "1:user" }))
      .toEqual({ op: "delete", id: "1:user" });
  });

  it("rejects invalid execution syscall bodies", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect([])))
      .rejects.toThrow("Execution syscall request must be an object.");
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({ op: "unknown" })))
      .rejects.toThrow("Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.");
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({ op: "get" })))
      .rejects.toThrow("Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.");
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "query",
      request: {
        table: "users",
        order: "sideways",
      },
    })))
      .rejects.toThrow("Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.");
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "insert",
      table: "users",
      value: Number.NaN,
    })))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "patch",
      id: "1:user",
      value: new Date(0),
    })))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("exposes typed execution syscall decode failures before compatibility parsing", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect({
      op: "query",
      request: {
        table: "users",
        order: "sideways",
      },
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionSyscallRequestEffect(null)))
      .rejects.toMatchObject({
        schema: "ExecutionSyscallRequest",
        message: "Execution syscall request must be an object.",
      });
  });

  it("decodes execution finish requests used by ExecutionDO sessions", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect({
      value: { ok: true, ids: ["1:user", null] },
    }))).resolves.toEqual({
      value: { ok: true, ids: ["1:user", null] },
    });
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect({ value: null })))
      .resolves.toEqual({ value: null });
    expect(decodeExecutionFinishRequest({ value: ["Ada", 1, false] }))
      .toEqual({ value: ["Ada", 1, false] });
  });

  it("rejects invalid execution finish bodies", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect([])))
      .rejects.toThrow("Execution finish request must be an object.");
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect({})))
      .rejects.toThrow("Execution finish request must include JSON value.");
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect({ value: Number.NaN })))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect({ value: new Date(0) })))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("exposes typed execution finish decode failures before compatibility parsing", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect({})))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionFinishRequestEffect("done")))
      .rejects.toMatchObject({
        schema: "ExecutionFinishRequest",
        message: "Execution finish request must be an object.",
      });
  });
});
