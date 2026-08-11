import { describe, expect, it, vi } from "vitest";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

import {
  ApplicationFunctionRuntimeApplicationV1Error,
  ApplicationFunctionRuntimeBoundaryV1Error,
  ApplicationFunctionRuntimeContractV1Error,
  ApplicationFunctionRuntimeTerminalV1Error,
  ApplicationFunctionRuntimeUserCodeV1Error,
  executeApplicationFunctionActionRuntimeV1,
  executeApplicationFunctionTransactionRuntimeV1,
  inspectApplicationFunctionRuntimeFailureV1,
  type ApplicationFunctionRuntimeFunctionV1,
  type ApplicationFunctionRuntimeInvocationFactoryV1,
  type ApplicationFunctionRuntimeMutationContextV1,
  type ApplicationFunctionRuntimeQueryContextV1,
  type ApplicationFunctionTransactionRuntimeInputV1,
} from "../src/applicationFunctionRuntimeV1";
import type { EdgeActionRuntimeContextV1 } from "../src/edgeAction";

const DOCUMENT_ID = "7:00000000-0000-0000-0000-000000000001";
const LIMITS = Object.freeze({
  maximumSyscalls: 4,
  maximumArgumentBytes: 1_024,
  maximumResultBytes: 1_024,
  maximumCallbackArgumentBytes: 1_024,
  maximumCallbackResultBytes: 1_024,
});

describe("@flarex/function-runtime/internal/application-function-runtime-v1", () => {
  it("executes a public query and one table-aware internal query", async () => {
    const events: string[] = [];
    const child = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
      args: idArguments(),
      returns: { type: "object", value: {
        found: { fieldType: { type: "boolean" }, optional: false },
      } },
    });
    const result = await executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("query", "public", async context =>
          await context.runQuery({ _path: "users:internal" }, {
            id: DOCUMENT_ID,
          })),
        "users:internal": registered("query", "internal", async context => {
          expect(Object.keys(context)).toEqual(["auth", "db", "runQuery"]);
          return { found: (await context.db.get(DOCUMENT_ID)) !== null };
        }),
      }),
      invocation(events),
    );
    expect(result).toEqual({ found: true });
    expect(events).toEqual([
      "open:query",
      "frame:0:1:1:1",
      "get",
      "close",
      "drain",
    ]);
  });

  it("executes an internal root only when its trusted catalog entry agrees", async () => {
    const root = definition({ visibility: "internal" });
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ function: root, internalFunctionCatalog: [root] }),
      registry({
        "users:get": registered("query", "internal", () => "internal-root"),
      }),
      invocation([]),
    )).resolves.toBe("internal-root");

    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ function: root, internalFunctionCatalog: [] }),
      registry({
        "users:get": registered("query", "internal", () => null),
      }),
      invocation([]),
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });
  });

  it("consumes the protocol-decoded 4096-byte execution ID without narrowing it", async () => {
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ executionId: "x".repeat(4_096) }),
      registry({ "users:get": registered("query", "public", () => null) }),
      invocation([]),
    )).resolves.toBeNull();
  });

  it("executes nested mutations on one journal and drains before returning", async () => {
    const events: string[] = [];
    const root = definition({ kind: "mutation" });
    const child = definition({
      ordinal: 1,
      path: "users:updateInternal",
      moduleName: "users",
      exportName: "updateInternal",
      kind: "mutation",
      visibility: "internal",
    });
    const result = await executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({
        function: root,
        internalFunctionCatalog: [child],
      }),
      registry({
        "users:get": registered("mutation", "public", async context => {
          await context.runMutation("users:updateInternal", {});
          return { status: "done" };
        }),
        "users:updateInternal": registered(
          "mutation",
          "internal",
          async context => {
            await context.db.patch(DOCUMENT_ID, { status: "updated" });
            return null;
          },
        ),
      }),
      invocation(events),
    );
    expect(result).toEqual({ status: "done" });
    expect(events).toEqual([
      "open:mutation",
      "frame:0:1:1:1",
      "patch",
      "close",
      "drain",
    ]);
  });

  it("requires exact kind and visibility registration markers", async () => {
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput(),
      registry({
        "users:get": registered("query", "internal", () => null),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(ApplicationFunctionRuntimeContractV1Error);

    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput(),
      { resolve: () => ({
        isQuery: true,
        isMutation: true,
        isPublic: true,
        _handler: () => null,
      }) },
      invocation([]),
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });
  });

  it("applies table-aware ID validation at the root boundary", async () => {
    const root = definition({ args: idArguments() });
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({
        function: root,
        arguments: { id: "8:00000000-0000-0000-0000-000000000001" },
      }),
      registry({ "users:get": registered("query", "public", () => null) }),
      invocation([]),
    )).rejects.toMatchObject({ reason: "argumentsInvalid" });
  });

  it("allows concurrent siblings while rejecting a real recursive cycle", async () => {
    const child = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
    });
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("query", "public", async context =>
          await Promise.all([
            context.runQuery("users:internal", {}),
            context.runQuery("users:internal", {}),
          ])),
        "users:internal": registered("query", "internal", async () => {
          await Promise.resolve();
          return "ok";
        }),
      }),
      invocation([]),
    )).resolves.toEqual(["ok", "ok"]);

    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("query", "public", async context => {
          try { await context.runQuery("users:internal", {}); } catch { /* terminal */ }
          return "caught";
        }),
        "users:internal": registered("query", "internal", async context =>
          await context.runQuery("users:internal", {})),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(ApplicationFunctionRuntimeTerminalV1Error);
  });

  it("charges a forwarded child result once against the internal result budget", async () => {
    const child = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
    });
    const value = { status: "forwarded" };
    const exactBytes = normalizeFlarexValueV1(value).semanticSizeBytes;
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({
        internalFunctionCatalog: [child],
        callBudget: {
          ...transactionInput().callBudget,
          maximumResultBytes: exactBytes,
        },
      }),
      registry({
        "users:get": registered("query", "public", async context =>
          await context.runQuery("users:internal", {})),
        "users:internal": registered("query", "internal", () => value),
      }),
      invocation([]),
    )).resolves.toEqual(value);
  });

  it("keeps internal-call failures sticky whether dropped or caught", async () => {
    const root = definition({ kind: "mutation" });
    const child = definition({
      ordinal: 1,
      path: "users:updateInternal",
      moduleName: "users",
      exportName: "updateInternal",
      kind: "mutation",
      visibility: "internal",
      returns: { type: "null" },
    });
    const entries = {
      "users:updateInternal": registered(
        "mutation",
        "internal",
        async context => {
          await context.db.patch(DOCUMENT_ID, { status: "written" });
          return "invalid-result";
        },
      ),
    };
    const droppedEvents: string[] = [];
    const dropped = executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ function: root, internalFunctionCatalog: [child] }),
      registry({
        ...entries,
        "users:get": registered("mutation", "public", async context => {
          void context.runMutation("users:updateInternal", {});
          await Promise.resolve();
          await Promise.resolve();
          return "must-not-succeed";
        }),
      }),
      invocation(droppedEvents),
    );
    await expect(dropped).rejects.toBeInstanceOf(
      ApplicationFunctionRuntimeApplicationV1Error,
    );
    expect(droppedEvents).toContain("patch");

    const caught = executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ function: root, internalFunctionCatalog: [child] }),
      registry({
        ...entries,
        "users:get": registered("mutation", "public", async context => {
          try {
            await context.runMutation("users:updateInternal", {});
          } catch (cause) {
            expect(cause).toBeInstanceOf(
              ApplicationFunctionRuntimeApplicationV1Error,
            );
          }
          return "caught";
        }),
      }),
      invocation([]),
    );
    await expect(caught).rejects.toBeInstanceOf(
      ApplicationFunctionRuntimeApplicationV1Error,
    );
  });

  it("does not let handled continuation chains launder an internal failure", async () => {
    const root = definition({ kind: "mutation" });
    const child = definition({
      ordinal: 1,
      path: "users:updateInternal",
      moduleName: "users",
      exportName: "updateInternal",
      kind: "mutation",
      visibility: "internal",
      returns: { type: "null" },
    });
    const childRegistration = registered(
      "mutation",
      "internal",
      () => "invalid-result",
    );
    const passThroughs = [
      (call: Promise<unknown>) => {
        void call.then(() => undefined).catch(() => undefined);
      },
      (call: Promise<unknown>) => {
        void call.finally(() => undefined).catch(() => undefined);
      },
      (call: Promise<unknown>) => {
        void call.catch(undefined).catch(() => undefined);
      },
      (call: Promise<unknown>) => {
        void call.catch(() => { throw new Error("rethrown"); })
          .catch(() => undefined);
      },
      (call: Promise<unknown>) => {
        void Promise.prototype.then.call(
          call,
          undefined,
          () => undefined,
        );
      },
    ];
    for (const passThrough of passThroughs) {
      const execution = executeApplicationFunctionTransactionRuntimeV1(
        transactionInput({ function: root, internalFunctionCatalog: [child] }),
        registry({
          "users:get": registered("mutation", "public", async context => {
            passThrough(context.runMutation("users:updateInternal", {}));
            await Promise.resolve();
            await Promise.resolve();
            return "must-not-succeed";
          }),
          "users:updateInternal": childRegistration,
        }),
        invocation([]),
      );
      const failure = await execution.catch(cause => cause);
      expect(failure).toBeInstanceOf(Error);
      expect(["applicationError", "userCode"]).toContain(
        inspectApplicationFunctionRuntimeFailureV1(failure)?.kind,
      );
    }

    const handled = executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ function: root, internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("mutation", "public", async context => {
          await context.runMutation("users:updateInternal", {})
            .finally(() => undefined)
            .catch(cause => {
              expect(cause).toBeInstanceOf(
                ApplicationFunctionRuntimeApplicationV1Error,
              );
            });
          return "handled";
        }),
        "users:updateInternal": childRegistration,
      }),
      invocation([]),
    );
    await expect(handled).rejects.toBeInstanceOf(
      ApplicationFunctionRuntimeApplicationV1Error,
    );
  });

  it("does not let native Promise assimilation launder an internal failure", async () => {
    const root = definition({ kind: "mutation" });
    const child = definition({
      ordinal: 1,
      path: "users:updateInternal",
      moduleName: "users",
      exportName: "updateInternal",
      kind: "mutation",
      visibility: "internal",
      returns: { type: "null" },
    });
    const childRegistration = registered(
      "mutation",
      "internal",
      () => "invalid-result",
    );
    const assimilators = [
      (call: Promise<unknown>) => {
        void Promise.all([call]).catch(() => undefined);
      },
      (call: Promise<unknown>) => {
        void Promise.resolve(call).catch(() => undefined);
      },
      (call: Promise<unknown>) => {
        void (async () => await call)().catch(() => undefined);
      },
    ];
    for (const assimilate of assimilators) {
      const execution = executeApplicationFunctionTransactionRuntimeV1(
        transactionInput({ function: root, internalFunctionCatalog: [child] }),
        registry({
          "users:get": registered("mutation", "public", async context => {
            assimilate(context.runMutation("users:updateInternal", {}));
            await Promise.resolve();
            await Promise.resolve();
            return "must-not-succeed";
          }),
          "users:updateInternal": childRegistration,
        }),
        invocation([]),
      );
      await expect(execution).rejects.toBeInstanceOf(
        ApplicationFunctionRuntimeApplicationV1Error,
      );
    }
  });

  it("keeps wrong-kind and exhausted calls terminal even when user code catches", async () => {
    const child = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
    });
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("query", "public", async context => {
          try { await context.runQuery("users:missing", {}); } catch { /* terminal */ }
          return "caught";
        }),
      }),
      invocation([]),
    )).rejects.toMatchObject({ reason: "internalTargetInvalid" });

    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({
        internalFunctionCatalog: [child],
        callBudget: { ...transactionInput().callBudget, maximumCalls: 1 },
      }),
      registry({
        "users:get": registered("query", "public", async context => {
          await context.runQuery("users:internal", {});
          try { await context.runQuery("users:internal", {}); } catch { /* terminal */ }
          return "caught";
        }),
        "users:internal": registered("query", "internal", () => null),
      }),
      invocation([]),
    )).rejects.toMatchObject({ reason: "callBudgetExceeded" });
  });

  it("classifies boundary failures ahead of user results", async () => {
    const failure = new Error("read drain failed");
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput(),
      registry({ "users:get": registered("query", "public", () => "ok") }),
      invocation([], { drainFailure: failure }),
    )).rejects.toEqual(expect.objectContaining({
      name: "ApplicationFunctionRuntimeBoundaryV1Error",
      boundary: "read",
      cause: failure,
    }));
  });

  it("rejects retained-context calls before boundary drain can start them", async () => {
    const child = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
    });
    let lateCall: (() => Promise<unknown>) | undefined;
    const childHandler = vi.fn(() => null);
    const execution = executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("query", "public", context => {
          lateCall = () => context.runQuery("users:internal", {});
          return "root-complete";
        }),
        "users:internal": registered("query", "internal", childHandler),
      }),
      invocation([], {
        duringDrain: async () => {
          const call = lateCall?.();
          expect(call).toBeDefined();
          await expect(call).rejects.toBeInstanceOf(
            ApplicationFunctionRuntimeTerminalV1Error,
          );
        },
      }),
    );
    await expect(execution).rejects.toMatchObject({
      reason: "internalTargetInvalid",
    });
    expect(childHandler).not.toHaveBeenCalled();
  });

  it("preserves nested read and journal boundary classifications", async () => {
    const queryChild = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
    });
    const readFailure = new ApplicationFunctionRuntimeBoundaryV1Error(
      "read",
      new Error("nested read"),
    );
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [queryChild] }),
      registry({
        "users:get": registered("query", "public", async context =>
          await context.runQuery("users:internal", {})),
        "users:internal": registered(
          "query",
          "internal",
          () => { throw readFailure; },
        ),
      }),
      invocation([]),
    )).rejects.toBe(readFailure);

    const mutationRoot = definition({ kind: "mutation" });
    const mutationChild = definition({
      ordinal: 1,
      path: "users:updateInternal",
      moduleName: "users",
      exportName: "updateInternal",
      kind: "mutation",
      visibility: "internal",
    });
    const journalFailure = new ApplicationFunctionRuntimeBoundaryV1Error(
      "journal",
      new Error("nested journal"),
    );
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({
        function: mutationRoot,
        internalFunctionCatalog: [mutationChild],
      }),
      registry({
        "users:get": registered("mutation", "public", async context =>
          await context.runMutation("users:updateInternal", {})),
        "users:updateInternal": registered(
          "mutation",
          "internal",
          () => { throw journalFailure; },
        ),
      }),
      invocation([]),
    )).rejects.toBe(journalFailure);
  });

  it("distinguishes user failures from catchable Application failures", async () => {
    const userFailure = new Error("boom");
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput(),
      registry({
        "users:get": registered("query", "public", () => { throw userFailure; }),
      }),
      invocation([]),
    )).rejects.toBeInstanceOf(ApplicationFunctionRuntimeUserCodeV1Error);

    const applicationFailure = new Error("FlarexError");
    const execution = executeApplicationFunctionTransactionRuntimeV1(
      transactionInput(),
      registry({
        "users:get": registered(
          "query",
          "public",
          () => { throw applicationFailure; },
        ),
      }),
      invocation([], { coreApplicationError: applicationFailure }),
    );
    await expect(execution).rejects.toBeInstanceOf(
      ApplicationFunctionRuntimeApplicationV1Error,
    );
  });

  it("preserves an uncaught internal validator failure as an Application error", async () => {
    const child = definition({
      ordinal: 1,
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
      args: idArguments(),
    });
    const execution = executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      registry({
        "users:get": registered("query", "public", async context =>
          await context.runQuery("users:internal", { id: "not-an-id" })),
      }),
      invocation([]),
    );
    await expect(execution).rejects.toBeInstanceOf(
      ApplicationFunctionRuntimeApplicationV1Error,
    );
  });

  it("fails workflow mutation closed before registry or invocation work", async () => {
    const resolve = vi.fn();
    const open = vi.fn();
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ function: definition({ kind: "workflowMutation" }) }),
      { resolve },
      { open },
    )).rejects.toMatchObject({ reason: "workflowMutationUnsupported" });
    expect(resolve).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects public-root ordinal collisions during catalog admission", async () => {
    const child = definition({
      path: "users:internal",
      moduleName: "users",
      exportName: "internal",
      visibility: "internal",
    });
    const resolve = vi.fn();
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput({ internalFunctionCatalog: [child] }),
      { resolve },
      invocation([]),
    )).rejects.toMatchObject({ reason: "functionMetadataInvalid" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("inspects only bounded known registration descriptors", async () => {
    let descriptorReads = 0;
    const target = registered("query", "public", () => null);
    const registration = new Proxy(target, {
      ownKeys: () => { throw new Error("unbounded enumeration"); },
      getOwnPropertyDescriptor: (value, property) => {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(value, property);
      },
    });
    await expect(executeApplicationFunctionTransactionRuntimeV1(
      transactionInput(),
      { resolve: () => registration },
      invocation([]),
    )).resolves.toBeNull();
    expect(descriptorReads).toBe(7);
  });

  it("executes an exact internal action and drains callback work", async () => {
    const events: string[] = [];
    const action = definition({ kind: "action", visibility: "internal" });
    const result = await executeApplicationFunctionActionRuntimeV1(
      { function: action, arguments: {}, auth: null },
      registry({
        "users:get": registered("action", "internal", async context => {
          const value = await context.runQuery("users:lookup", {});
          events.push("handler");
          return value;
        }),
      }),
      {
        callbackBridge: { invoke: request => {
          events.push(`${request.kind}:${request.ordinal}`);
          return { ok: true };
        } },
        limits: LIMITS,
        isCoreApplicationError: () => false,
      },
    );
    expect(result).toEqual({ ok: true });
    expect(events).toEqual(["runQuery:1", "handler"]);
  });

  it("preserves action callback failure authority after user catch", async () => {
    const action = definition({ kind: "action" });
    const execution = executeApplicationFunctionActionRuntimeV1(
      { function: action, arguments: {}, auth: null },
      registry({
        "users:get": registered("action", "public", async context => {
          try { await context.runQuery("users:lookup", {}); } catch { /* boundary */ }
          return "caught";
        }),
      }),
      {
        callbackBridge: { invoke: () => { throw new Error("callback failed"); } },
        limits: LIMITS,
        isCoreApplicationError: () => false,
      },
    );
    await expect(execution).rejects.toBeInstanceOf(
      ApplicationFunctionRuntimeBoundaryV1Error,
    );
  });

  it("translates invalid action limits into the Application contract family", async () => {
    const action = definition({ kind: "action" });
    const execution = executeApplicationFunctionActionRuntimeV1(
      { function: action, arguments: {}, auth: null },
      registry({
        "users:get": registered("action", "public", () => null),
      }),
      {
        callbackBridge: { invoke: () => null },
        limits: { ...LIMITS, maximumSyscalls: 0 },
        isCoreApplicationError: () => false,
      },
    );
    const failure = await execution.catch(cause => cause);
    expect(failure).toBeInstanceOf(ApplicationFunctionRuntimeContractV1Error);
    expect(inspectApplicationFunctionRuntimeFailureV1(failure)).toMatchObject({
      kind: "contract",
      reason: "resourceExceeded",
    });
  });

  it("retains the action result-validator issue as the user failure cause", async () => {
    const action = definition({
      kind: "action",
      returns: { type: "string" },
    });
    const failure = await executeApplicationFunctionActionRuntimeV1(
      { function: action, arguments: {}, auth: null },
      registry({
        "users:get": registered("action", "public", () => 42),
      }),
      {
        callbackBridge: { invoke: () => null },
        limits: LIMITS,
        isCoreApplicationError: () => false,
      },
    ).catch(cause => cause);
    expect(failure).toBeInstanceOf(ApplicationFunctionRuntimeUserCodeV1Error);
    expect(failure.cause).toEqual(expect.objectContaining({
      name: "ApplicationFunctionRuntimeApplicationV1Error",
      reason: "resultInvalid",
      cause: expect.anything(),
    }));
  });

  it("publishes stable failure inspections without classifying foreign errors", () => {
    const failure = new ApplicationFunctionRuntimeApplicationV1Error(
      "resultInvalid",
    );
    expect(inspectApplicationFunctionRuntimeFailureV1(failure)).toMatchObject({
      kind: "applicationError",
      reason: "resultInvalid",
    });
    expect(inspectApplicationFunctionRuntimeFailureV1(new Error("foreign")))
      .toBeUndefined();
    expect(new ApplicationFunctionRuntimeBoundaryV1Error("journal", failure))
      .toBeInstanceOf(Error);
  });
});

function definition(
  overrides: Partial<ApplicationFunctionRuntimeFunctionV1> = {},
): ApplicationFunctionRuntimeFunctionV1 {
  return {
    ordinal: 0,
    path: "users:get",
    moduleName: "users",
    exportName: "get",
    kind: "query",
    visibility: "public",
    args: { type: "object", value: {} },
    returns: { type: "any" },
    partition: null,
    entrySha256: "a".repeat(64),
    ...overrides,
  };
}

function idArguments() {
  return {
    type: "object" as const,
    value: {
      id: {
        fieldType: { type: "id" as const, tableName: "users" },
        optional: false,
      },
    },
  };
}

function transactionInput(
  overrides: Partial<ApplicationFunctionTransactionRuntimeInputV1> = {},
): ApplicationFunctionTransactionRuntimeInputV1 {
  return {
    executionId: "execution-1",
    function: definition(),
    internalFunctionCatalog: [],
    callBudget: {
      maximumCalls: 8,
      maximumDepth: 4,
      maximumArgumentBytes: 4_096,
      maximumResultBytes: 4_096,
    },
    arguments: {},
    tables: [{ tableId: 7, logicalName: "users" }],
    ...overrides,
  };
}

type RegisteredKind = "query" | "mutation" | "action";
type RegisteredVisibility = "public" | "internal";
interface RegisteredHandlers {
  readonly query: (
    context: ApplicationFunctionRuntimeQueryContextV1,
    argumentsValue: unknown,
  ) => unknown;
  readonly mutation: (
    context: ApplicationFunctionRuntimeMutationContextV1,
    argumentsValue: unknown,
  ) => unknown;
  readonly action: (
    context: EdgeActionRuntimeContextV1,
    argumentsValue: unknown,
  ) => unknown;
}

function registered<Kind extends RegisteredKind>(
  kind: Kind,
  visibility: RegisteredVisibility,
  handler: RegisteredHandlers[Kind],
) {
  return Object.freeze({
    [kind === "query" ? "isQuery" : kind === "mutation" ? "isMutation" : "isAction"]:
      true,
    [visibility === "public" ? "isPublic" : "isInternal"]: true,
    _handler: handler,
  });
}

function registry(entries: Readonly<Record<string, unknown>>) {
  return { resolve: (path: string) => entries[path] };
}

function invocation(
  events: string[],
  options: Readonly<{
    readonly drainFailure?: unknown;
    readonly coreApplicationError?: unknown;
    readonly duringDrain?: () => unknown | PromiseLike<unknown>;
  }> = {},
): ApplicationFunctionRuntimeInvocationFactoryV1 {
  return {
    open: kind => {
      events.push(`open:${kind}`);
      const auth = Object.freeze({ getUserIdentity: async () => null });
      const queryDatabase = Object.freeze({
        get: async (_documentId: string) => {
          events.push("get");
          return { _id: DOCUMENT_ID };
        },
        queryIndexRange: async () => ({ documents: [], isDone: true }),
      });
      const mutationDatabase = Object.freeze({
        ...queryDatabase,
        insert: async (_tableName: string, _value: unknown) => DOCUMENT_ID,
        patch: async (_documentId: string, _value: unknown) => {
          events.push("patch");
        },
        replace: async (_documentId: string, _value: unknown) => undefined,
        delete: async (_documentId: string) => undefined,
      });
      return {
        boundary: {
          close: () => { events.push("close"); },
          drain: async () => {
            events.push("drain");
            await options.duringDrain?.();
            if (options.drainFailure !== undefined) throw options.drainFailure;
          },
        },
        createQueryContext: runQuery => Object.freeze({
          auth,
          db: queryDatabase,
          runQuery,
        }),
        createMutationContext: (runQuery, runMutation) => Object.freeze({
          auth,
          db: mutationDatabase,
          runQuery,
          runMutation,
        }),
        recordCallFrame: frame => {
          events.push(
            `frame:${frame.parentOrdinal}:${frame.calleeOrdinal}:${frame.sequence}:${frame.depth}`,
          );
        },
        isApplicationError: cause =>
          cause === options.coreApplicationError,
        isCoreApplicationError: cause => cause === options.coreApplicationError,
        recordTerminalFailure: () => undefined,
      };
    },
  };
}
