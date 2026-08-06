import { describe, expect, it } from "vitest";

import {
  executePointMutationInternalQueryV1,
  PointMutationInternalQueryApplicationV1Error,
  PointMutationInternalQueryTerminalV1Error,
  type PointMutationInternalQueryRuntimeContextV1,
  type PointMutationInternalQueryRuntimeInputV1,
  type PointMutationInternalQueryRuntimeInvocationFactoryV1,
} from "../src/pointMutationInternalQuery";

const DOCUMENT_ID = "7:00000000-0000-0000-0000-000000000001";
const INTERNAL_REFERENCE = Object.freeze({ _path: "orders:internal" });

describe("@flarex/function-runtime/point-mutation-internal-query", () => {
  it("executes an authenticated internal query inline on one mutation journal", async () => {
    const events: string[] = [];
    const result = await executePointMutationInternalQueryV1(
      input({ internalQueryCatalog: [{
        ...input().internalQueryCatalog[0]!,
        argsValidator: { type: "object", value: {
          id: { fieldType: { type: "string" }, optional: false },
        } },
      }] }),
      registry({
        root: async context => await context.runQuery(INTERNAL_REFERENCE, {
          id: DOCUMENT_ID,
        }),
        internal: async context => await context.db.get(DOCUMENT_ID),
      }),
      invocation(events),
    );
    expect(result).toEqual({ status: "open" });
    expect(events).toEqual([
      "frame:root-execution:0:1:1:1", "get", "close", "drain",
    ]);
  });

  it("lets user code catch only deterministic child validator failures", async () => {
    const result = await executePointMutationInternalQueryV1(
      input({ internalQueryCatalog: [{
        ...input().internalQueryCatalog[0]!,
        argsValidator: { type: "object", value: {
          id: { fieldType: { type: "string" }, optional: false },
        } },
      }] }),
      registry({
        root: async context => {
          try { return await context.runQuery(INTERNAL_REFERENCE, { id: 42 }); }
          catch (cause) {
            expect(cause).toBeInstanceOf(PointMutationInternalQueryApplicationV1Error);
            return { status: "caught" };
          }
        },
        internal: () => ({ status: "unused" }),
      }),
      invocation([]),
    );
    expect(result).toEqual({ status: "caught" });
  });

  it("keeps unknown targets and read failures terminal even when caught", async () => {
    await expect(executePointMutationInternalQueryV1(
      input(),
      registry({
        root: async context => {
          try { await context.runQuery({ _path: "orders:missing" }, {}); }
          catch { return { status: "caught" }; }
          return { status: "unreachable" };
        },
        internal: () => null,
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationInternalQueryTerminalV1Error);

    const hostFailure = new Error("read unavailable");
    await expect(executePointMutationInternalQueryV1(
      input(),
      registry({
        root: async context => {
          try { return await context.runQuery(INTERNAL_REFERENCE, {}); }
          catch { return { status: "caught" }; }
        },
        internal: async context => await context.db.get(DOCUMENT_ID),
      }),
      invocation([], async () => { throw hostFailure; }),
    )).rejects.toEqual(expect.objectContaining({
      name: "PointMutationInternalQueryRuntimeJournalBoundaryV1Error",
      cause: hostFailure,
    }));

    await expect(executePointMutationInternalQueryV1(
      input(),
      registry({
        root: async context => {
          try { return await context.runQuery(INTERNAL_REFERENCE, {}); }
          catch { return { status: "caught" }; }
        },
        internal: () => { throw new TypeError("arbitrary child failure"); },
      }),
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationInternalQueryTerminalV1Error",
      reason: "internalTargetInvalid",
      cause: expect.objectContaining({ message: "arbitrary child failure" }),
    });
  });

  it("allows sequential repeats but rejects recursion and cumulative call overflow", async () => {
    const repeated = await executePointMutationInternalQueryV1(
      input(),
      registry({
        root: async context => {
          await context.runQuery(INTERNAL_REFERENCE, { id: DOCUMENT_ID });
          return await context.runQuery(INTERNAL_REFERENCE, { id: DOCUMENT_ID });
        },
        internal: () => ({ status: "open" }),
      }),
      invocation([]),
    );
    expect(repeated).toEqual({ status: "open" });

    await expect(executePointMutationInternalQueryV1(
      input(),
      registry({
        root: context => context.runQuery(INTERNAL_REFERENCE, {}),
        internal: context => context.runQuery(INTERNAL_REFERENCE, {}),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationInternalQueryTerminalV1Error);

    await expect(executePointMutationInternalQueryV1(
      input({ callBudget: { ...input().callBudget, maximumCalls: 1 } }),
      registry({
        root: async context => {
          await context.runQuery(INTERNAL_REFERENCE, {});
          return await context.runQuery(INTERNAL_REFERENCE, {});
        },
        internal: () => ({ status: "open" }),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationInternalQueryTerminalV1Error);
  });

  it("admits depth eight and rejects depth nine", async () => {
    const catalog = Array.from({ length: 9 }, (_, index) => ({
      ordinal: index + 1,
      path: `orders:q${index + 1}`,
      kind: "query" as const,
      visibility: "internal" as const,
      argsValidator: { type: "any" as const },
      returnsValidator: input().function.returnsValidator,
    }));
    const handlers = new Map<string, (
      context: PointMutationInternalQueryRuntimeContextV1,
    ) => unknown | PromiseLike<unknown>>();
    handlers.set("orders:update", context =>
      context.runQuery({ _path: "orders:q1" }, {}));
    for (let index = 1; index <= 7; index += 1) {
      handlers.set(`orders:q${index}`, context =>
        context.runQuery({ _path: `orders:q${index + 1}` }, {}));
    }
    handlers.set("orders:q8", () => ({ status: "open" }));
    const resolve = (path: string) => {
      const handler = handlers.get(path);
      if (handler === undefined) return undefined;
      return path === "orders:update"
        ? { isMutation: true, isPublic: true, _handler: handler }
        : { isQuery: true, isInternal: true, _handler: handler };
    };
    await expect(executePointMutationInternalQueryV1(
      input({ internalQueryCatalog: catalog }),
      { resolve },
      invocation([]),
    )).resolves.toEqual({ status: "open" });

    handlers.set("orders:q8", context =>
      context.runQuery({ _path: "orders:q9" }, {}));
    handlers.set("orders:q9", () => ({ status: "too-deep" }));
    await expect(executePointMutationInternalQueryV1(
      input({ internalQueryCatalog: catalog }),
      { resolve },
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationInternalQueryTerminalV1Error",
      reason: "callBudgetExceeded",
    });
  });

  it("drains a dropped child before accepting the root result", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execution = executePointMutationInternalQueryV1(
      input(),
      registry({
        root: context => {
          void context.runQuery(INTERNAL_REFERENCE, {});
          return { status: "root" };
        },
        internal: async () => {
          await gate;
          return { status: "child" };
        },
      }),
      invocation([]),
    );
    let settled = false;
    void execution.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(execution).resolves.toEqual({ status: "root" });
  });

  it("rejects duplicate catalog authority before opening an invocation", async () => {
    let opened = false;
    await expect(executePointMutationInternalQueryV1(
      input({ internalQueryCatalog: [input().internalQueryCatalog[0]!, {
        ...input().internalQueryCatalog[0]!,
      }] }),
      registry({ root: () => null, internal: () => null }),
      { open: () => { opened = true; return invocation([]).open(); } },
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });
    expect(opened).toBe(false);
  });
});

function input(
  overrides: Partial<PointMutationInternalQueryRuntimeInputV1> = {},
): PointMutationInternalQueryRuntimeInputV1 {
  const validator = { type: "object" as const, value: {
    status: { fieldType: { type: "string" as const }, optional: false },
  } };
  return {
    executionId: "root-execution",
    function: {
      ordinal: 0, path: "orders:update", kind: "mutation", visibility: "public",
      argsValidator: { type: "any" }, returnsValidator: validator,
    },
    internalQueryCatalog: [{
      ordinal: 1, path: "orders:internal", kind: "query", visibility: "internal",
      argsValidator: { type: "any" }, returnsValidator: validator,
    }],
    callBudget: {
      maximumCalls: 64, maximumDepth: 8,
      maximumArgumentBytes: 8 * 1_048_576,
      maximumResultBytes: 8 * 1_048_576,
    },
    arguments: {},
    tables: [{ tableId: 7, logicalName: "orders" }],
    ...overrides,
  };
}

function registry(handlers: Readonly<{
  root: (context: PointMutationInternalQueryRuntimeContextV1) => unknown | PromiseLike<unknown>;
  internal: (context: PointMutationInternalQueryRuntimeContextV1) => unknown | PromiseLike<unknown>;
}>) {
  return {
    resolve: (path: string) => path === "orders:update"
      ? { isMutation: true, isPublic: true, _handler: handlers.root }
      : path === "orders:internal"
      ? { isQuery: true, isInternal: true, _handler: handlers.internal }
      : undefined,
  };
}

function invocation(
  events: string[],
  drain: () => Promise<void> = async () => undefined,
): PointMutationInternalQueryRuntimeInvocationFactoryV1 {
  let terminal: unknown;
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
          query: () => { throw new Error("scans unavailable"); },
          normalizeId: () => { throw new Error("normalization unavailable"); },
          system: {},
        },
      },
      journal: {
        close: () => { events.push("close"); },
        drain: async () => {
          events.push("drain");
          await drain();
          if (terminal !== undefined) throw terminal;
        },
      },
      recordCallFrame: frame => {
        events.push(
          `frame:${frame.rootExecutionId}:${frame.parentOrdinal}:` +
            `${frame.calleeOrdinal}:${frame.sequence}:${frame.depth}`,
        );
      },
      isCoreApplicationError: () => false,
      recordTerminalFailure: cause => { terminal ??= cause; },
    }),
  };
}
