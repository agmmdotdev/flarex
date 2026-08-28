import {
  action,
  defineModule,
  mutation,
  query,
  sourceModule,
  v,
} from "@flarex/application-definition";
import {
  ApplicationActionSystem,
  type ApplicationActionSystemApi,
} from
  "@flarex/standard-application-invocation/internal/application-action-system";
import {
  ApplicationMutationSystem,
  type ApplicationMutationSystemApi,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  ApplicationQuerySystem,
  type ApplicationQuerySystemApi,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { Effect } from "effect";
import {
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { flarexValueToJsonV1 } from "flarex-protocol/value";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  runAction,
  runMutation,
  runQuery,
  type ActionResult,
  type ApplicationResultContractError,
  type MutationOutcome,
} from "../src/index.js";

const module = defineModule({
  path: "messages",
  source: sourceModule({
    path: "functions/messages.js",
    bytes: new TextEncoder().encode("export {};\n"),
  }),
  functions: {
    get: query({
      args: v.object({ id: v.string() }),
      returns: v.object({ text: v.string() }),
    }),
    getId: query({
      args: v.object({}),
      returns: v.id("messages"),
    }),
    save: mutation({
      args: v.object({ text: v.string() }),
      returns: v.bigint(),
    }),
    deliver: action({
      args: v.object({ text: v.string() }),
      returns: v.boolean(),
    }),
  },
});

const getMessage = module.reference("get");
const getMessageId = module.reference("getId");
const saveMessage = module.reference("save");
const deliverMessage = module.reference("deliver");

describe("clean Application invocation primitives", () => {
  it("runs a typed query without a mutation request key", async () => {
    const value = Object.freeze({ text: "hello" });
    const invoke = vi.fn<ApplicationQuerySystemApi["invoke"]>(
      () => Effect.succeed(value),
    );
    const system = ApplicationQuerySystem.of({
      selectionQuery: Object.freeze({
        runQuery: () => Effect.die("selection query must not run"),
      }),
      invoke,
    });
    const identity = Object.freeze({ kind: "anonymous" as const });

    const result = await Effect.runPromise(Effect.scoped(
      runQuery(getMessage, { id: "message-1" }, { identity }).pipe(
        Effect.provideService(ApplicationQuerySystem, system),
      ),
    ));

    expect(result).toBe(value);
    expect(invoke).toHaveBeenCalledWith(
      "messages:get",
      { id: "message-1" },
      identity,
    );
    expectTypeOf(result).toEqualTypeOf<Readonly<{ text: string }>>();
  });

  it("rejects a query result that disagrees with the local reference", async () => {
    const system = ApplicationQuerySystem.of({
      selectionQuery: Object.freeze({
        runQuery: () => Effect.die("selection query must not run"),
      }),
      invoke: () => Effect.succeed(Object.freeze({ text: 1 })),
    });

    const error = await Effect.runPromise(Effect.scoped(
      runQuery(getMessage, { id: "message-1" }).pipe(
        Effect.provideService(ApplicationQuerySystem, system),
        Effect.flip,
      ),
    ));

    expect(isResultContractError(error)).toBe(true);
    if (isResultContractError(error)) {
      expect(error.operation).toBe("query");
      expect(error.cause.issue).toMatchObject({
        reason: "typeMismatch",
        path: "$result.text",
        expected: "string",
      });
    }
  });

  it("does not claim table authority for an ID-shaped query result", async () => {
    const system = ApplicationQuerySystem.of({
      selectionQuery: Object.freeze({
        runQuery: () => Effect.die("selection query must not run"),
      }),
      invoke: () => Effect.succeed("host-neutral-id-text"),
    });

    const result = await Effect.runPromise(Effect.scoped(
      runQuery(getMessageId, {}).pipe(
        Effect.provideService(ApplicationQuerySystem, system),
      ),
    ));

    expect(result).toBe("host-neutral-id-text");
    expectTypeOf(result).toEqualTypeOf<string>();
  });

  it("projects the typed value without losing authoritative mutation evidence", async () => {
    const outcome = Object.freeze({
      status: "committed" as const,
      disposition: "replayed" as const,
      scopeUuid: "scope",
      epochUuid: "epoch",
      commitSeq: 7n,
      value: flarexValueToJsonV1(42n),
    });
    const invoke = vi.fn<ApplicationMutationSystemApi["invoke"]>(
      () => Effect.succeed(outcome),
    );
    const system = ApplicationMutationSystem.of({
      selectionMutation: Object.freeze({
        runMutation: () => Effect.die("selection mutation must not run"),
      }),
      invoke,
      invokeAuthenticated: () => Effect.die("authenticated mutation must not run"),
      invokeAuthenticatedAtTaskLaunch: () =>
        Effect.die("task mutation must not run"),
    });
    const requestKey = TransactionRequestKeyV1Schema.make("save-message");

    const result = await Effect.runPromise(Effect.scoped(
      runMutation(saveMessage, { text: "hello" }, { requestKey }).pipe(
        Effect.provideService(ApplicationMutationSystem, system),
      ),
    ));

    expect(result).not.toBe(outcome);
    expect(result).toEqual({
      status: "committed",
      disposition: "replayed",
      scopeUuid: "scope",
      epochUuid: "epoch",
      commitSeq: 7n,
      value: 42n,
    });
    expect(invoke).toHaveBeenCalledWith(
      "messages:save",
      { text: "hello" },
      requestKey,
    );
    expectTypeOf(result).toEqualTypeOf<MutationOutcome<bigint>>();
  });

  it("rejects a mutation result that disagrees with the local reference", async () => {
    const outcome = Object.freeze({
      status: "committed" as const,
      disposition: "published" as const,
      scopeUuid: "scope",
      epochUuid: "epoch",
      commitSeq: 8n,
      value: "not-a-bigint",
    });
    const system = ApplicationMutationSystem.of({
      selectionMutation: Object.freeze({
        runMutation: () => Effect.die("selection mutation must not run"),
      }),
      invoke: () => Effect.succeed(outcome),
      invokeAuthenticated: () => Effect.die("authenticated mutation must not run"),
      invokeAuthenticatedAtTaskLaunch: () =>
        Effect.die("task mutation must not run"),
    });

    const error = await Effect.runPromise(Effect.scoped(
      runMutation(saveMessage, { text: "hello" }, {
        requestKey: TransactionRequestKeyV1Schema.make("save-mismatch"),
      }).pipe(
        Effect.provideService(ApplicationMutationSystem, system),
        Effect.flip,
      ),
    ));

    expect(isResultContractError(error)).toBe(true);
    if (isResultContractError(error)) {
      expect(error.operation).toBe("mutation");
      if (error.operation === "mutation") {
        expect(error.outcome).toBe(outcome);
        expect(error.outcome).toMatchObject({
          status: "committed",
          disposition: "published",
          scopeUuid: "scope",
          epochUuid: "epoch",
          commitSeq: 8n,
        });
      }
    }
  });

  it("preserves completed and non-completed Action results", async () => {
    const completed = Object.freeze({
      status: "completed" as const,
      disposition: "published" as const,
      invocationId: "invocation-1",
      value: true,
    });
    const nonCompleted = Object.freeze({
      status: "notCompleted" as const,
      disposition: "settled" as const,
      invocationId: "invocation-2",
      lifecycle: "uncertain" as const,
      terminalCode: "outcome_unknown",
    });
    const invoke = vi.fn<ApplicationActionSystemApi["invoke"]>()
      .mockReturnValueOnce(Effect.succeed(completed))
      .mockReturnValueOnce(Effect.succeed(nonCompleted));
    const system = ApplicationActionSystem.of({ invoke });
    const firstKey = TransactionRequestKeyV1Schema.make("deliver-first");
    const secondKey = TransactionRequestKeyV1Schema.make("deliver-second");

    const run = (requestKey: typeof firstKey) => Effect.runPromise(
      Effect.scoped(
        runAction(deliverMessage, { text: "hello" }, { requestKey }).pipe(
          Effect.provideService(ApplicationActionSystem, system),
        ),
      ),
    );
    const first = await run(firstKey);
    const second = await run(secondKey);

    expect(first).toBe(completed);
    expect(second).toBe(nonCompleted);
    expectTypeOf(first).toEqualTypeOf<ActionResult<boolean>>();
  });

  it("rejects a completed Action result that disagrees with the local reference", async () => {
    const completed = Object.freeze({
      status: "completed" as const,
      disposition: "published" as const,
      invocationId: "invocation-mismatch",
      value: "not-a-boolean",
    });
    const system = ApplicationActionSystem.of({
      invoke: () => Effect.succeed(completed),
    });

    const error = await Effect.runPromise(Effect.scoped(
      runAction(deliverMessage, { text: "hello" }, {
        requestKey: TransactionRequestKeyV1Schema.make("deliver-mismatch"),
      }).pipe(
        Effect.provideService(ApplicationActionSystem, system),
        Effect.flip,
      ),
    ));

    expect(isResultContractError(error)).toBe(true);
    if (isResultContractError(error)) {
      expect(error.operation).toBe("action");
      if (error.operation === "action") {
        expect(error.result).toBe(completed);
        expect(error.result).toMatchObject({
          status: "completed",
          disposition: "published",
          invocationId: "invocation-mismatch",
        });
      }
    }
  });
});

function compileTimeContractChecks(): void {
  // @ts-expect-error Query arguments are inferred from the reference.
  runQuery(getMessage, { id: 1 });
  // @ts-expect-error A query reference cannot be used as a mutation.
  runMutation(getMessage, { id: "message-1" }, {
    requestKey: TransactionRequestKeyV1Schema.make("wrong-kind"),
  });
  // @ts-expect-error Function references cannot be structurally fabricated.
  const forged: typeof getMessage = {
    path: getMessage.path,
    contract: getMessage.contract,
  };
  void forged;
}

void compileTimeContractChecks;

function isResultContractError(
  error: unknown,
): error is ApplicationResultContractError {
  return typeof error === "object" && error !== null &&
    "_tag" in error && error._tag === "ApplicationResultContractError";
}
