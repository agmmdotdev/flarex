import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import {
  decodeExecutionFinishPayload,
  decodeExecutionStartPayload,
  decodeExecutionSyscallPayload,
  decodePublicExecutionActionPayload,
  decodePublicExecutionStartPayload,
} from "../src/execution/Requests";

describe("execution request payloads", () => {
  it("decodes start payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodeExecutionStartPayload(startPayload())))
      .resolves
      .toEqual(startPayload());

    await expect(Effect.runPromise(decodeExecutionStartPayload({
      deploymentId: "deployment-b",
      path: "users:list",
      args: [],
      projectId: "project-a",
    }))).resolves.toEqual({
      deploymentId: "deployment-b",
      path: "users:list",
      args: [],
      projectId: "project-a",
    });
  });

  it("overlays the public start deployment id before protocol validation", async () => {
    await expect(Effect.runPromise(decodePublicExecutionStartPayload({
      deploymentId: "body-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    }, "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    });

    await expect(Effect.runPromise(decodePublicExecutionStartPayload({
      deploymentId: "body-deployment",
      path: "users:list",
      args: {},
    }, "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      path: "users:list",
      args: {},
    });
  });

  it("decodes syscall payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallPayload({
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [{ op: "eq", field: "userId", value: "u1" }],
        },
        order: "asc",
      },
    }))).resolves.toEqual({
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [{ op: "eq", field: "userId", value: "u1" }],
        },
        order: "asc",
      },
    });

    await expect(Effect.runPromise(decodeExecutionSyscallPayload({
      op: "insert",
      table: "lessonProgress",
      value: { completed: false },
      id: "1:progress",
    }))).resolves.toEqual({
      op: "insert",
      table: "lessonProgress",
      value: { completed: false },
      id: "1:progress",
    });
  });

  it("decodes finish and public action payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishPayload({
      value: { ok: true },
    }))).resolves.toEqual({
      value: { ok: true },
    });
    await expect(Effect.runPromise(decodeExecutionFinishPayload({
      value: null,
    }))).resolves.toEqual({ value: null });

    await expect(Effect.runPromise(decodePublicExecutionActionPayload({
      op: "get",
      id: "1:progress",
    }, "syscall"))).resolves.toEqual({
      op: "get",
      id: "1:progress",
    });
    await expect(Effect.runPromise(decodePublicExecutionActionPayload({
      value: "done",
    }, "finish"))).resolves.toEqual({ value: "done" });
    await expect(Effect.runPromise(decodePublicExecutionActionPayload({
      ignored: true,
    }, "abort"))).resolves.toEqual({ ignored: true });
  });

  it("keeps protocol validation failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionStartPayload({
      deploymentId: "deployment-a",
      path: "users:get",
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodePublicExecutionStartPayload(
      "not an object",
      "route-deployment",
    ))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionSyscallPayload({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionFinishPayload({})))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });
});

function startPayload() {
  return {
    deploymentId: "deployment-a",
    path: "users:get",
    args: { id: "1:user" },
    partitionKey: "1:user",
    kind: "query" as const,
    idempotencyKey: "start-once",
  };
}
