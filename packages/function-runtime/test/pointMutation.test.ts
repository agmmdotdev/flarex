import { describe, expect, it, vi } from "vitest";
import {
  MAX_VALIDATOR_JSON_DEPTH_V1,
} from "flarex-protocol/validator-json";

import {
  executePointMutationV1,
  inspectPointMutationRuntimeFailureV1,
  PointMutationRuntimeContractV1Error,
  PointMutationRuntimeJournalBoundaryV1Error,
  PointMutationRuntimeUserCodeV1Error,
  type PointMutationRuntimeContextV1,
  type PointMutationRuntimeInputV1,
  type PointMutationRuntimeInvocationFactoryV1,
} from "../src/pointMutation";

function runtimeFunction(
  handler: (
    context: PointMutationRuntimeContextV1,
    args: Readonly<Record<string, unknown>>,
  ) => unknown | PromiseLike<unknown>,
): unknown {
  return Object.freeze({
    isMutation: true,
    isPublic: true,
    _handler: handler,
  });
}

function input(
  overrides: Partial<PointMutationRuntimeInputV1> = {},
): PointMutationRuntimeInputV1 {
  return Object.freeze({
    function: Object.freeze({
      path: "orders:place",
      kind: "mutation",
      visibility: "public",
      argsValidator: Object.freeze({
        type: "object",
        value: Object.freeze({
          status: Object.freeze({
            fieldType: Object.freeze({ type: "string" }),
            optional: false,
          }),
        }),
      }),
      returnsValidator: Object.freeze({
        type: "id",
        tableName: "orders",
      }),
    }),
    arguments: Object.freeze({ status: "open" }),
    tables: Object.freeze([
      Object.freeze({ tableId: 7, logicalName: "orders" }),
    ]),
    ...overrides,
  });
}

function invocation(
  events: string[],
  drain: () => Promise<void> = async () => undefined,
): PointMutationRuntimeInvocationFactoryV1 {
  return Object.freeze({
    open: () => Object.freeze({
      context: Object.freeze({
        auth: Object.freeze({
          getUserIdentity: async () => null,
        }),
        db: Object.freeze({
          get: async () => null,
          insert: async () => "7:00000000-0000-0000-0000-000000000001",
          patch: async () => undefined,
          replace: async () => undefined,
          delete: async () => undefined,
        }),
      }),
      journal: Object.freeze({
        close: () => events.push("close"),
        drain: async () => {
          events.push("drain");
          await drain();
        },
      }),
      isCoreApplicationError: () => false,
    }),
  });
}

describe("@flarex/function-runtime/point-mutation", () => {
  it("executes a public mutation and settles the journal before returning", async () => {
    const events: string[] = [];
    const result = await executePointMutationV1(
      input(),
      {
        resolve: async (path) => {
          events.push(`resolve:${path}`);
          return runtimeFunction(async (_context, args) => {
            events.push(`handler:${String(args.status)}`);
            return "7:00000000-0000-0000-0000-000000000001";
          });
        },
      },
      invocation(events),
    );

    expect(result).toBe(
      "7:00000000-0000-0000-0000-000000000001",
    );
    expect(events).toEqual([
      "resolve:orders:place",
      "handler:open",
      "close",
      "drain",
    ]);
  });

  it("rejects invalid arguments before opening an invocation", async () => {
    const open = vi.fn();
    const failure = await executePointMutationV1(
      input({ arguments: Object.freeze({ status: 42 }) }),
      { resolve: () => runtimeFunction(() => null) },
      { open },
    ).then(() => undefined, (cause: unknown) => cause);
    expect(failure).toMatchObject({
      name: "PointMutationRuntimeContractV1Error",
      reason: "argumentsInvalid",
    });
    expect(inspectPointMutationRuntimeFailureV1(failure)).toEqual({
      kind: "contract",
      reason: "argumentsInvalid",
      cause: {
        reason: "typeMismatch",
        path: "$arguments.status",
        expected: "string",
      },
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects validator projections beyond the protocol-owned depth", async () => {
    let validator: NonNullable<
      PointMutationRuntimeInputV1["function"]["returnsValidator"]
    > = { type: "null" };
    for (
      let depth = 1;
      depth < MAX_VALIDATOR_JSON_DEPTH_V1 + 1;
      depth += 1
    ) {
      validator = { type: "array", value: validator };
    }
    const resolve = vi.fn();
    const failure = await executePointMutationV1(
      input({
        function: Object.freeze({
          ...input().function,
          returnsValidator: validator,
        }),
      }),
      { resolve },
      invocation([]),
    ).then(() => undefined, (cause: unknown) => cause);
    expect(failure).toMatchObject({
      name: "PointMutationRuntimeContractV1Error",
      reason: "validatorProjectionInvalid",
    });
    expect(inspectPointMutationRuntimeFailureV1(failure)).toEqual({
      kind: "contract",
      reason: "validatorProjectionInvalid",
      cause: { reason: "tooDeep" },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("matches Convex-style undefined object-field omission", async () => {
    const result = await executePointMutationV1(
      input({
        function: Object.freeze({
          ...input().function,
          returnsValidator: { type: "any" as const },
        }),
      }),
      {
        resolve: () => runtimeFunction(() => ({
          kept: "value",
          omitted: undefined,
        })),
      },
      invocation([]),
    );

    expect(result).toEqual({ kept: "value" });
    expect(Object.keys(result as object)).toEqual(["kept"]);
  });

  it("validates return IDs with the verified table projection", async () => {
    await expect(executePointMutationV1(
      input(),
      {
        resolve: () =>
          runtimeFunction(() =>
            "8:00000000-0000-0000-0000-000000000001"
          ),
      },
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationRuntimeUserCodeV1Error);
  });

  it("indexes table authority once for repeated ID validation", async () => {
    let logicalNameReads = 0;
    const lateTable:
      PointMutationRuntimeInputV1["tables"][number] = Object.freeze({
        tableId: 7,
        get logicalName() {
          logicalNameReads += 1;
          return "orders";
        },
      });
    const repeatedIds = Object.freeze(Array.from(
      { length: 256 },
      () => "7:00000000-0000-0000-0000-000000000001",
    ));
    await expect(executePointMutationV1(
      input({
        function: Object.freeze({
          ...input().function,
          argsValidator: Object.freeze({
            type: "object",
            value: Object.freeze({
              ids: Object.freeze({
                fieldType: Object.freeze({
                  type: "array",
                  value: Object.freeze({
                    type: "id",
                    tableName: "orders",
                  }),
                }),
                optional: false,
              }),
            }),
          }),
          returnsValidator: null,
        }),
        arguments: Object.freeze({ ids: repeatedIds }),
        tables: Object.freeze([
          Object.freeze({ tableId: 1, logicalName: "other" }),
          lateTable,
        ]),
      }),
      { resolve: () => runtimeFunction(() => null) },
      invocation([]),
    )).resolves.toBeNull();
    expect(logicalNameReads).toBe(1);
  });

  it("gives journal failure precedence over handler failure", async () => {
    const handlerFailure = new Error("handler failed");
    const journalFailure = new Error("journal failed");
    await expect(executePointMutationV1(
      input({
        function: Object.freeze({
          ...input().function,
          returnsValidator: null,
        }),
      }),
      {
        resolve: () => runtimeFunction(() => {
          throw handlerFailure;
        }),
      },
      invocation([], async () => {
        throw journalFailure;
      }),
    )).rejects.toMatchObject({
      name: "PointMutationRuntimeJournalBoundaryV1Error",
      cause: journalFailure,
    });
  });

  it("rethrows a declared application error only after settling the journal", async () => {
    const events: string[] = [];
    const applicationError = Object.freeze({ kind: "applicationError" });
    const base = invocation(events);
    const execution = executePointMutationV1(
      input(),
      { resolve: () => runtimeFunction(() => { throw applicationError; }) },
      {
        open: () => Object.freeze({
          ...base.open(),
          isCoreApplicationError: (cause: unknown) => cause === applicationError,
        }),
      },
    );
    await expect(execution).rejects.toBe(applicationError);
    expect(events).toEqual(["close", "drain"]);
  });

  it("drains after close fails and preserves the first journal failure", async () => {
    const events: string[] = [];
    const closeFailure = new Error("close failed");
    const drainFailure = new Error("drain failed");
    const execution = executePointMutationV1(
      input({
        function: Object.freeze({
          ...input().function,
          returnsValidator: null,
        }),
      }),
      {
        resolve: () => runtimeFunction(() => {
          throw new Error("handler failed");
        }),
      },
      {
        open: () => {
          const base = invocation(events).open();
          return {
            ...base,
            journal: {
              close: () => {
                events.push("close");
                throw closeFailure;
              },
              drain: async () => {
                events.push("drain");
                throw drainFailure;
              },
            },
          };
        },
      },
    );

    await expect(execution).rejects.toMatchObject({
      name: "PointMutationRuntimeJournalBoundaryV1Error",
      cause: closeFailure,
    });
    expect(events).toEqual(["close", "drain"]);
  });

  it("classifies missing and malformed registry entries as contract failures", async () => {
    await expect(executePointMutationV1(
      input(),
      { resolve: () => undefined },
      invocation([]),
    )).rejects.toBeInstanceOf(PointMutationRuntimeContractV1Error);

    await expect(executePointMutationV1(
      input(),
      {
        resolve: () => ({
          isMutation: true,
          isInternal: true,
          _handler: () => null,
        }),
      },
      invocation([]),
    )).rejects.toMatchObject({
      reason: "functionMetadataInvalid",
    });
  });

  it("keeps registry exceptions in the user-code failure class", async () => {
    const cause = new Error("module import failed");
    await expect(executePointMutationV1(
      input(),
      {
        resolve: () => {
          throw cause;
        },
      },
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationRuntimeUserCodeV1Error",
      cause,
    });
  });

  it("rejects accessors and classifies hostile metadata inspection", async () => {
    const accessor = Object.freeze(Object.defineProperty({
      isMutation: true,
      isPublic: true,
    }, "_handler", {
      get: () => {
        throw new Error("accessor must not run");
      },
      enumerable: true,
    }));
    await expect(executePointMutationV1(
      input(),
      { resolve: () => accessor },
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationRuntimeContractV1Error",
      reason: "functionMetadataInvalid",
    });

    const trapFailure = new Error("metadata trap failed");
    const hostile = new Proxy({}, {
      getPrototypeOf: () => {
        throw trapFailure;
      },
    });
    await expect(executePointMutationV1(
      input(),
      { resolve: () => hostile },
      invocation([]),
    )).rejects.toMatchObject({
      name: "PointMutationRuntimeUserCodeV1Error",
      cause: trapFailure,
    });
  });

  it("does not let user code mint a journal-boundary classification", async () => {
    const cause = new Error("rpc failed");
    const failure = new PointMutationRuntimeJournalBoundaryV1Error(cause);
    const execution = executePointMutationV1(
      input(),
      {
        resolve: () => runtimeFunction(() => {
          throw failure;
        }),
      },
      invocation([]),
    );
    await expect(execution).rejects.toMatchObject({
      name: "PointMutationRuntimeUserCodeV1Error",
      cause: failure,
    });
    const caught = await execution.catch((error: unknown) => error);
    expect(inspectPointMutationRuntimeFailureV1(caught)).toEqual({
      kind: "userCode",
      cause: failure,
    });
  });
});
