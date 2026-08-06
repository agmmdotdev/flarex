import { describe, expect, it } from "vitest";

import {
  executePointQueryInternalCallV1,
  PointQueryInternalCallApplicationV1Error,
  PointQueryInternalCallRuntimeReadBoundaryV1Error,
  PointQueryInternalCallTerminalV1Error,
  type PointQueryInternalCallRuntimeContextV1,
  type PointQueryInternalCallRuntimeInputV1,
  type PointQueryInternalCallRuntimeInvocationFactoryV1,
} from "../src/pointQueryInternalCall";
import {
  createFunctionRuntimeAuthV1,
  createFunctionRuntimeRunQueryContextV1,
} from "../src/functionApiCore";

const DOCUMENT_ID = "7:00000000-0000-0000-0000-000000000001";
const INTERNAL_REFERENCE = Object.freeze({ _path: "orders:internal" });

describe("@flarex/function-runtime/point-query-internal-call", () => {
  it("executes an authenticated internal query inline with one read boundary", async () => {
    const events: string[] = [];
    const result = await executePointQueryInternalCallV1(
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
        internal: async context => {
          expect(Object.keys(context)).toEqual(["auth", "db", "runQuery"]);
          expect(Object.keys(context.db)).toEqual(["get"]);
          expect("runMutation" in context).toBe(false);
          expect("insert" in context.db).toBe(false);
          return await context.db.get(DOCUMENT_ID);
        },
      }),
      invocation(events),
    );
    expect(result).toEqual({ status: "open" });
    expect(events).toEqual([
      "frame:root-execution:0:1:1:1", "get", "close", "drain",
    ]);
  });

  it("lets user code catch only deterministic child validator failures", async () => {
    const result = await executePointQueryInternalCallV1(
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
            expect(cause).toBeInstanceOf(PointQueryInternalCallApplicationV1Error);
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
    await expect(executePointQueryInternalCallV1(
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
    )).rejects.toBeInstanceOf(PointQueryInternalCallTerminalV1Error);

    const hostFailure = new Error("read unavailable");
    await expect(executePointQueryInternalCallV1(
      input(),
      registry({
        root: async context => {
          try { return await context.runQuery(INTERNAL_REFERENCE, {}); }
          catch { return { status: "caught" }; }
        },
        internal: async context => await context.db.get(DOCUMENT_ID),
      }),
      invocation([], async () => { throw hostFailure; }),
    )).rejects.toMatchObject({
      name: "PointQueryInternalCallRuntimeReadBoundaryV1Error",
      cause: hostFailure,
    });
  });

  it("allows sequential repeats but rejects recursion and cumulative call overflow", async () => {
    const repeated = await executePointQueryInternalCallV1(
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

    await expect(executePointQueryInternalCallV1(
      input(),
      registry({
        root: context => context.runQuery(INTERNAL_REFERENCE, {}),
        internal: context => context.runQuery(INTERNAL_REFERENCE, {}),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointQueryInternalCallTerminalV1Error);

    await expect(executePointQueryInternalCallV1(
      input({ callBudget: { ...input().callBudget, maximumCalls: 1 } }),
      registry({
        root: async context => {
          await context.runQuery(INTERNAL_REFERENCE, {});
          return await context.runQuery(INTERNAL_REFERENCE, {});
        },
        internal: () => ({ status: "open" }),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointQueryInternalCallTerminalV1Error);
  });

  it("drains a dropped child before accepting the root result", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execution = executePointQueryInternalCallV1(
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
    await expect(executePointQueryInternalCallV1(
      input({ internalQueryCatalog: [input().internalQueryCatalog[0]!, {
        ...input().internalQueryCatalog[0]!,
      }] }),
      registry({ root: () => null, internal: () => null }),
      { open: () => { opened = true; return invocation([]).open(); } },
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });
    expect(opened).toBe(false);
  });

  it("rethrows a declared root application error after settling reads", async () => {
    const events: string[] = [];
    const applicationError = Object.freeze({ kind: "applicationError" });
    const base = invocation(events);
    const execution = executePointQueryInternalCallV1(
      input(),
      registry({
        root: () => { throw applicationError; },
        internal: () => null,
      }),
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
  overrides: Partial<PointQueryInternalCallRuntimeInputV1> = {},
): PointQueryInternalCallRuntimeInputV1 {
  const validator = { type: "object" as const, value: {
    status: { fieldType: { type: "string" as const }, optional: false },
  } };
  return {
    executionId: "root-execution",
    function: {
      ordinal: 0, path: "orders:get", kind: "query", visibility: "public",
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
  root: (context: PointQueryInternalCallRuntimeContextV1) => unknown | PromiseLike<unknown>;
  internal: (context: PointQueryInternalCallRuntimeContextV1) => unknown | PromiseLike<unknown>;
}>) {
  return {
    resolve: (path: string) => path === "orders:get"
      ? { isQuery: true, isPublic: true, _handler: handlers.root }
      : path === "orders:internal"
      ? { isQuery: true, isInternal: true, _handler: handlers.internal }
      : undefined,
  };
}

function invocation(
  events: string[],
  drain: () => Promise<void> = async () => undefined,
): PointQueryInternalCallRuntimeInvocationFactoryV1 {
  let terminal: unknown;
  const auth = createFunctionRuntimeAuthV1(
    Object.freeze({ kind: "anonymous" }),
  );
  const database = {
    get: async () => { events.push("get"); return { status: "open" }; },
  };
  return {
    open: () => ({
      createContext: runQuery =>
        createFunctionRuntimeRunQueryContextV1(auth, database, runQuery),
      readBoundary: {
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
      recordTerminalFailure: cause => { terminal ??= cause; },
      isCoreApplicationError: () => false,
    }),
  };
}
