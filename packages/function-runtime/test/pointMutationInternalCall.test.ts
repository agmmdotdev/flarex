import { describe, expect, it } from "vitest";

import {
  executePointMutationInternalCallV1,
  PointMutationInternalCallApplicationV1Error,
  PointMutationInternalCallTerminalV1Error,
  type PointMutationInternalCallRuntimeContextV1,
  type PointMutationInternalCallRuntimeInputV1,
  type PointMutationInternalCallRuntimeInvocationFactoryV1,
} from "../src/pointMutationInternalCall";

const DOCUMENT_ID = "7:00000000-0000-0000-0000-000000000001";
const INTERNAL_REFERENCE = Object.freeze({ _path: "orders:internal" });
const INTERNAL_MUTATION_REFERENCE = Object.freeze({ _path: "orders:mutateInternal" });

describe("@flarex/function-runtime/point-mutation-internal-call", () => {
  it("executes an authenticated internal query inline on one mutation journal", async () => {
    const events: string[] = [];
    const result = await executePointMutationInternalCallV1(
      input({ internalFunctionCatalog: [{
        ...input().internalFunctionCatalog[0]!,
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
      "enter:orders:update", "frame:root-execution:0:1:1:1",
      "enter:orders:internal", "get",
      "leave:orders:internal", "leave:orders:update", "close", "drain",
    ]);
  });

  it("lets user code catch only deterministic child validator failures", async () => {
    const result = await executePointMutationInternalCallV1(
      input({ internalFunctionCatalog: [{
        ...input().internalFunctionCatalog[0]!,
        argsValidator: { type: "object", value: {
          id: { fieldType: { type: "string" }, optional: false },
        } },
      }] }),
      registry({
        root: async context => {
          try { return await context.runQuery(INTERNAL_REFERENCE, { id: 42 }); }
          catch (cause) {
            expect(cause).toBeInstanceOf(PointMutationInternalCallApplicationV1Error);
            return { status: "caught" };
          }
        },
        internal: () => ({ status: "unused" }),
      }),
      invocation([]),
    );
    expect(result).toEqual({ status: "caught" });
  });

  it("runs nested internal mutations on the same database and preserves settled writes when caught", async () => {
    const events: string[] = [];
    const catalog = [...input().internalFunctionCatalog, {
      ordinal: 2,
      path: "orders:mutateInternal",
      kind: "mutation" as const,
      visibility: "internal" as const,
      argsValidator: { type: "any" as const },
      returnsValidator: { type: "object" as const, value: {
        status: { fieldType: { type: "string" as const }, optional: false },
      } },
    }];
    const result = await executePointMutationInternalCallV1(
      input({ internalFunctionCatalog: catalog }),
      {
        resolve: path => path === "orders:update"
          ? { isMutation: true, isPublic: true, _handler: async (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => {
              try {
                await context.runMutation(INTERNAL_MUTATION_REFERENCE, {});
              } catch (cause) {
                expect(cause).toBeInstanceOf(
                  PointMutationInternalCallApplicationV1Error,
                );
              }
              return await context.runQuery(INTERNAL_REFERENCE, {});
            } }
          : path === "orders:mutateInternal"
          ? { isMutation: true, isInternal: true, _handler: async (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => {
              await context.db.patch(DOCUMENT_ID, { status: "child" });
              await context.runQuery(INTERNAL_REFERENCE, {});
              return 42;
            } }
          : path === "orders:internal"
          ? { isQuery: true, isInternal: true, _handler: async (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => await context.db.get(DOCUMENT_ID) }
          : undefined,
      },
      invocation(events),
    );
    expect(result).toEqual({ status: "open" });
    expect(events.filter(event => event === "patch" || event === "get"))
      .toEqual(["patch", "get", "get"]);
  });

  it("lets a parent catch only an authenticated child document-validation failure", async () => {
    const validationFailure = new Error("authenticated document validation");
    const mutation = {
      ordinal: 2,
      path: "orders:mutateInternal",
      kind: "mutation" as const,
      visibility: "internal" as const,
      argsValidator: { type: "any" as const },
      returnsValidator: input().function.returnsValidator,
    };
    const events: string[] = [];
    const result = await executePointMutationInternalCallV1(
      input({
        internalFunctionCatalog: [...input().internalFunctionCatalog, mutation],
      }),
      {
        resolve: path => path === "orders:update"
          ? { isMutation: true, isPublic: true, _handler: async (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => {
              try {
                await context.runMutation(INTERNAL_MUTATION_REFERENCE, {});
              } catch (cause) {
                expect(cause).toBe(validationFailure);
              }
              return await context.runQuery(INTERNAL_REFERENCE, {});
            } }
          : path === "orders:mutateInternal"
          ? { isMutation: true, isInternal: true, _handler: () => {
              throw validationFailure;
            } }
          : path === "orders:internal"
          ? { isQuery: true, isInternal: true, _handler: () => ({
              status: "open",
            }) }
          : undefined,
      },
      invocation(
        events,
        async () => undefined,
        cause => cause === validationFailure,
      ),
    );
    expect(result).toEqual({ status: "open" });
    expect(events).not.toContain("terminal");
  });

  it("keeps unknown targets and read failures terminal even when caught", async () => {
    await expect(executePointMutationInternalCallV1(
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
    )).rejects.toBeInstanceOf(PointMutationInternalCallTerminalV1Error);

    const hostFailure = new Error("read unavailable");
    await expect(executePointMutationInternalCallV1(
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
      name: "PointMutationInternalCallRuntimeJournalBoundaryV1Error",
      cause: hostFailure,
    }));

    await expect(executePointMutationInternalCallV1(
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
      name: "PointMutationInternalCallTerminalV1Error",
      reason: "internalTargetInvalid",
      cause: expect.objectContaining({ message: "arbitrary child failure" }),
    });
  });

  it("keeps query-to-mutation forbidden and terminal outside user catch", async () => {
    const mutation = {
      ordinal: 2,
      path: "orders:mutateInternal",
      kind: "mutation" as const,
      visibility: "internal" as const,
      argsValidator: { type: "any" as const },
      returnsValidator: input().function.returnsValidator,
    };
    await expect(executePointMutationInternalCallV1(
      input({
        internalFunctionCatalog: [...input().internalFunctionCatalog, mutation],
      }),
      {
        resolve: path => path === "orders:update"
          ? { isMutation: true, isPublic: true, _handler: (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => context.runQuery(INTERNAL_REFERENCE, {}) }
          : path === "orders:internal"
          ? { isQuery: true, isInternal: true, _handler: async (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => {
              try {
                return await context.runMutation(
                  INTERNAL_MUTATION_REFERENCE,
                  {},
                );
              } catch {
                return { status: "caught" };
              }
            } }
          : path === "orders:mutateInternal"
          ? { isMutation: true, isInternal: true, _handler: () => ({
              status: "unreachable",
            }) }
          : undefined,
      },
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationInternalCallTerminalV1Error",
      reason: "internalTargetInvalid",
    });
  });

  it("allows sequential repeats but rejects recursion and cumulative call overflow", async () => {
    const repeated = await executePointMutationInternalCallV1(
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

    await expect(executePointMutationInternalCallV1(
      input(),
      registry({
        root: context => context.runQuery(INTERNAL_REFERENCE, {}),
        internal: context => context.runQuery(INTERNAL_REFERENCE, {}),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationInternalCallTerminalV1Error);

    const internalMutation = {
      ordinal: 2,
      path: "orders:mutateInternal",
      kind: "mutation" as const,
      visibility: "internal" as const,
      argsValidator: { type: "any" as const },
      returnsValidator: input().function.returnsValidator,
    };
    await expect(executePointMutationInternalCallV1(
      input({
        internalFunctionCatalog: [
          ...input().internalFunctionCatalog,
          internalMutation,
        ],
      }),
      {
        resolve: path => path === "orders:update"
          ? { isMutation: true, isPublic: true, _handler: (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => context.runMutation(INTERNAL_MUTATION_REFERENCE, {}) }
          : path === "orders:mutateInternal"
          ? { isMutation: true, isInternal: true, _handler: (
              context: PointMutationInternalCallRuntimeContextV1,
            ) => context.runMutation(INTERNAL_MUTATION_REFERENCE, {}) }
          : undefined,
      },
      invocation([]),
    )).rejects.toMatchObject({ reason: "callCycle" });

    await expect(executePointMutationInternalCallV1(
      input({ callBudget: { ...input().callBudget, maximumCalls: 1 } }),
      registry({
        root: async context => {
          await context.runQuery(INTERNAL_REFERENCE, {});
          return await context.runQuery(INTERNAL_REFERENCE, {});
        },
        internal: () => ({ status: "open" }),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationInternalCallTerminalV1Error);
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
      context: PointMutationInternalCallRuntimeContextV1,
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
    await expect(executePointMutationInternalCallV1(
      input({ internalFunctionCatalog: catalog }),
      { resolve },
      invocation([]),
    )).resolves.toEqual({ status: "open" });

    handlers.set("orders:q8", context =>
      context.runQuery({ _path: "orders:q9" }, {}));
    handlers.set("orders:q9", () => ({ status: "too-deep" }));
    await expect(executePointMutationInternalCallV1(
      input({ internalFunctionCatalog: catalog }),
      { resolve },
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationInternalCallTerminalV1Error",
      reason: "callBudgetExceeded",
    });
  });

  it("drains a dropped child before accepting the root result", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execution = executePointMutationInternalCallV1(
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
    await expect(executePointMutationInternalCallV1(
      input({ internalFunctionCatalog: [input().internalFunctionCatalog[0]!, {
        ...input().internalFunctionCatalog[0]!,
      }] }),
      registry({ root: () => null, internal: () => null }),
      { open: () => { opened = true; return invocation([]).open(); } },
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });
    expect(opened).toBe(false);
  });
});

function input(
  overrides: Partial<PointMutationInternalCallRuntimeInputV1> = {},
): PointMutationInternalCallRuntimeInputV1 {
  const validator = { type: "object" as const, value: {
    status: { fieldType: { type: "string" as const }, optional: false },
  } };
  return {
    executionId: "root-execution",
    function: {
      ordinal: 0, path: "orders:update", kind: "mutation", visibility: "public",
      argsValidator: { type: "any" }, returnsValidator: validator,
    },
    internalFunctionCatalog: [{
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
  root: (context: PointMutationInternalCallRuntimeContextV1) => unknown | PromiseLike<unknown>;
  internal: (context: PointMutationInternalCallRuntimeContextV1) => unknown | PromiseLike<unknown>;
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
  isApplicationCatchableError: (cause: unknown) => boolean = () => false,
): PointMutationInternalCallRuntimeInvocationFactoryV1 {
  let terminal: unknown;
  let depth = 0;
  return {
    open: () => ({
      context: {
        auth: { getUserIdentity: async () => null },
        db: {
          get: async () => { events.push("get"); return { status: "open" }; },
          insert: async () => { events.push("insert"); return DOCUMENT_ID; },
          patch: async () => { events.push("patch"); },
          replace: async () => { events.push("replace"); },
          delete: async () => { events.push("delete"); },
          query: () => { throw new Error("scans unavailable"); },
          normalizeId: () => { throw new Error("normalization unavailable"); },
          system: {},
        },
      },
      invokeWithContext: <A>(
        _context: PointMutationInternalCallRuntimeContextV1,
        operation: () => A | PromiseLike<A>,
      ): Promise<Awaited<A>> => {
        const label = depth === 0 ? "orders:update" : "orders:internal";
        depth += 1;
        events.push(`enter:${label}`);
        const release = () => {
          depth -= 1;
          events.push(`leave:${label}`);
        };
        try { return Promise.resolve(operation()).finally(release); }
        catch (cause) { release(); throw cause; }
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
      isApplicationCatchableError,
      recordTerminalFailure: cause => {
        events.push("terminal");
        terminal ??= cause;
      },
    }),
  };
}
