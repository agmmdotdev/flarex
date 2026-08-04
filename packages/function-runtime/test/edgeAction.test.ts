import { describe, expect, it, vi } from "vitest";

import {
  EdgeActionRuntimeCallbackBoundaryV1Error,
  EdgeActionRuntimeContractV1Error,
  executeEdgeActionV1,
  openCallbackBoundary,
  type EdgeActionRuntimeContextV1,
  type EdgeActionRuntimeInputV1,
} from "../src/edgeAction";

const LIMITS = Object.freeze({
  maximumSyscalls: 4,
  maximumArgumentBytes: 1_024,
  maximumResultBytes: 1_024,
  maximumCallbackArgumentBytes: 1_024,
  maximumCallbackResultBytes: 1_024,
});

describe("@flarex/function-runtime/edge-action", () => {
  it("executes one exact public action with auth and tracked callbacks", async () => {
    const events: string[] = [];
    const result = await executeEdgeActionV1(
      input(),
      { resolve: () => actionFunction(async context => {
        const identity = await context.auth.getUserIdentity();
        const query = await context.runQuery("orders:get", { id: "order-1" });
        events.push("handler-complete");
        return { subject: identity?.subject ?? "", query };
      }) },
      { invoke: request => {
        events.push(`${request.kind}:${request.ordinal}`);
        return { ok: true };
      } },
      LIMITS,
    );
    expect(result).toEqual({
      subject: "user-1",
      query: { ok: true },
    });
    expect(events).toEqual(["runQuery:1", "handler-complete"]);
  });

  it("drains a dropped callback and preserves callback failure authority", async () => {
    let rejectCallback: ((cause: unknown) => void) | undefined;
    const callback = new Promise<never>((_resolve, reject) => {
      rejectCallback = reject;
    });
    const execution = executeEdgeActionV1(
      input({ function: { ...input().function, returnsValidator: null } }),
      { resolve: () => actionFunction(context => {
        void context.runMutation("orders:update", { id: "order-1" });
        return "returned-before-callback";
      }) },
      { invoke: () => callback },
      LIMITS,
    );
    rejectCallback?.(new Error("mutation outcome lost"));
    await expect(execution).rejects.toBeInstanceOf(
      EdgeActionRuntimeCallbackBoundaryV1Error,
    );
  });

  it("retains an already-settled dropped callback failure for final drain", async () => {
    await expect(executeEdgeActionV1(
      input({ function: { ...input().function, returnsValidator: null } }),
      { resolve: () => actionFunction(async context => {
        void context.runMutation("orders:update", { id: "order-1" });
        await Promise.resolve();
        await Promise.resolve();
        return "must-not-complete";
      }) },
      { invoke: () => Promise.reject(new Error("mutation outcome lost")) },
      LIMITS,
    )).rejects.toBeInstanceOf(EdgeActionRuntimeCallbackBoundaryV1Error);
  });

  it("preserves throw undefined as a user-code failure", async () => {
    await expect(executeEdgeActionV1(
      input({ function: { ...input().function, returnsValidator: null } }),
      { resolve: () => actionFunction(() => { throw undefined; }) },
      { invoke: vi.fn() },
      LIMITS,
    )).rejects.toMatchObject({ name: "EdgeActionRuntimeUserCodeV1Error" });
  });

  it("does not let user code recover final success after callback budget exhaustion", async () => {
    await expect(executeEdgeActionV1(
      input({ function: { ...input().function, returnsValidator: null } }),
      { resolve: () => actionFunction(async context => {
        await context.runQuery("orders:first", {});
        try {
          await context.runQuery("orders:overflow", {});
        } catch {
          return "caught-resource-failure";
        }
        return "unreachable";
      }) },
      { invoke: () => null },
      { ...LIMITS, maximumSyscalls: 1 },
    )).rejects.toMatchObject({
      cause: { reason: "resourceExceeded" },
    });
  });

  it("rejects forged metadata, closed calls, and syscall overflow", async () => {
    await expect(executeEdgeActionV1(
      input(),
      { resolve: () => ({ isMutation: true, isPublic: true, _handler: vi.fn() }) },
      { invoke: vi.fn() },
      LIMITS,
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });

    const boundary = openCallbackBoundary(null, { invoke: () => null }, {
      ...LIMITS,
      maximumSyscalls: 1,
    });
    boundary.close();
    await expect(boundary.context.runQuery("orders:get", {})).rejects
      .toMatchObject({ reason: "callbackClosed" });

    const limited = openCallbackBoundary(null, { invoke: () => null }, {
      ...LIMITS,
      maximumSyscalls: 1,
    });
    await limited.context.runQuery("orders:get", {});
    await expect(limited.context.runQuery("orders:get", {})).rejects
      .toMatchObject({ reason: "resourceExceeded" });
    limited.close();
    await expect(limited.drain()).rejects.toMatchObject({
      reason: "resourceExceeded",
    });
  });
});

function input(
  overrides: Partial<EdgeActionRuntimeInputV1> = {},
): EdgeActionRuntimeInputV1 {
  return {
    function: {
      path: "orders:place",
      kind: "action",
      visibility: "public",
      argsValidator: { type: "object", value: {} },
      returnsValidator: { type: "object", value: {
        subject: { fieldType: { type: "string" }, optional: false },
        query: { fieldType: { type: "object", value: {
          ok: { fieldType: { type: "boolean" }, optional: false },
        } }, optional: false },
      } },
    },
    arguments: {},
    auth: {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "issuer",
    },
    ...overrides,
  };
}

function actionFunction(
  handler: (
    context: EdgeActionRuntimeContextV1,
    argumentsValue: unknown,
  ) => unknown,
) {
  return Object.freeze({
    isAction: true,
    isPublic: true,
    _handler: handler,
  });
}

void EdgeActionRuntimeContractV1Error;
