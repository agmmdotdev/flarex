import { describe, expect, it, vi } from "vitest";

import {
  executePointQueryV1,
  PointQueryRuntimeContractV1Error,
  PointQueryRuntimeReadBoundaryV1Error,
  PointQueryRuntimeUserCodeV1Error,
  type PointQueryRuntimeContextV1,
  type PointQueryRuntimeInputV1,
  type PointQueryRuntimeInvocationFactoryV1,
} from "../src/pointQuery";

const DOCUMENT_ID = "7:00000000-0000-0000-0000-000000000001";

describe("@flarex/function-runtime/point-query", () => {
  it("executes exactly one public query and settles reads before returning", async () => {
    const events: string[] = [];
    const result = await executePointQueryV1(
      input(),
      { resolve: path => queryFunction(async (context, args) => {
        events.push(`handler:${path}`);
        return context.db.get(String(args.id));
      }) },
      invocation(events),
    );
    expect(result).toEqual({ status: "open" });
    expect(events).toEqual(["handler:orders:get", "get", "close", "drain"]);
  });

  it("rejects invalid args/results and mutation metadata", async () => {
    const open = vi.fn();
    await expect(executePointQueryV1(
      input({ arguments: { id: 42 } as never }),
      { resolve: () => queryFunction(() => null) },
      { open },
    )).rejects.toBeInstanceOf(PointQueryRuntimeContractV1Error);
    expect(open).not.toHaveBeenCalled();

    await expect(executePointQueryV1(
      input(),
      { resolve: () => ({ isMutation: true, isPublic: true, _handler: () => null }) },
      invocation([]),
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });

    await expect(executePointQueryV1(
      input(),
      { resolve: () => queryFunction(() => 42) },
      invocation([]),
    )).rejects.toBeInstanceOf(PointQueryRuntimeUserCodeV1Error);
  });

  it("keeps caught host read failures terminal and denies writes", async () => {
    const hostFailure = new Error("database unavailable");
    await expect(executePointQueryV1(
      input({ function: { ...input().function, returnsValidator: null } }),
      { resolve: () => queryFunction(async (context) => {
        try { await context.db.get(DOCUMENT_ID); } catch { return "caught"; }
        return "unexpected";
      }) },
      invocation([], async () => { throw hostFailure; }),
    )).rejects.toMatchObject({
      name: "PointQueryRuntimeReadBoundaryV1Error",
      cause: hostFailure,
    });

    await expect(executePointQueryV1(
      input({ function: { ...input().function, returnsValidator: null } }),
      { resolve: () => queryFunction(context => context.db.insert({})) },
      invocation([]),
    )).rejects.toBeInstanceOf(PointQueryRuntimeUserCodeV1Error);
  });

  it("rethrows a declared application error only after settling reads", async () => {
    const events: string[] = [];
    const applicationError = Object.freeze({ kind: "applicationError" });
    const base = invocation(events);
    const execution = executePointQueryV1(
      input(),
      { resolve: () => queryFunction(() => { throw applicationError; }) },
      {
        open: () => ({
          ...base.open(),
          isCoreApplicationError: cause => cause === applicationError,
        }),
      },
    );
    await expect(execution).rejects.toBe(applicationError);
    expect(events).toEqual(["close", "drain"]);
  });
});

function input(
  overrides: Partial<PointQueryRuntimeInputV1> = {},
): PointQueryRuntimeInputV1 {
  return {
    function: {
      path: "orders:get", kind: "query", visibility: "public",
      argsValidator: { type: "object", value: {
        id: { fieldType: { type: "string" }, optional: false },
      } },
      returnsValidator: { type: "object", value: {
        status: { fieldType: { type: "string" }, optional: false },
      } },
    },
    arguments: { id: DOCUMENT_ID },
    tables: [{ tableId: 7, logicalName: "orders" }],
    ...overrides,
  };
}

function queryFunction(
  handler: (context: PointQueryRuntimeContextV1,
    args: Readonly<Record<string, unknown>>) => unknown | PromiseLike<unknown>,
) {
  return { isQuery: true, isPublic: true, _handler: handler };
}

function invocation(
  events: string[],
  drain: () => Promise<void> = async () => undefined,
): PointQueryRuntimeInvocationFactoryV1 {
  return {
    open: () => ({
      context: {
        auth: { getUserIdentity: async () => null },
        db: {
          get: async () => { events.push("get"); return { status: "open" }; },
          insert: () => { throw new Error("writes unavailable"); },
          patch: () => { throw new Error("writes unavailable"); },
          replace: () => { throw new Error("writes unavailable"); },
          delete: () => { throw new Error("writes unavailable"); },
          query: () => { throw new Error("index scans unavailable"); },
          normalizeId: () => { throw new Error("normalization unavailable"); },
          system: {},
        },
      },
      readBoundary: {
        close: () => { events.push("close"); },
        drain: async () => { events.push("drain"); await drain(); },
      },
      isCoreApplicationError: () => false,
    }),
  };
}
