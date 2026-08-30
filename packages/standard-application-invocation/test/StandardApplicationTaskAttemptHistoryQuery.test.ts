import {
  TaskAttemptHistoryStoreFailure,
} from "@flarex/durable-task/internal/run-projection";
import type {
  TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeApplicationTaskReadStore,
  type ApplicationTaskReadStore,
} from
  "@flarex/persistence-postgres/internal/application-task-read-store";
import { Brand, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  listStandardApplicationTaskAttempts,
  makeStandardApplicationTaskReadQueryLayer,
  StandardApplicationTaskAttemptHistoryQuery,
  StandardApplicationTaskEventHistoryQuery,
  StandardApplicationTaskRunListQuery,
  type StandardApplicationTaskAttemptHistoryQueryApi,
} from "../src/StandardApplicationTaskReadQuery.js";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
} from "../src/StandardApplicationTaskRunQuery.js";

const runId = Brand.nominal<TaskRunIdV1>()(
  "run_00000000-0000-4000-8000-0000000000b2",
);

describe("StandardApplicationTaskAttemptHistoryQuery", () => {
  it("issues list, point, and history services from one authentic store", async () => {
    const store = authenticStoreWithoutIo();

    const result = await Effect.runPromise(Effect.gen(function* () {
      const history = yield* StandardApplicationTaskAttemptHistoryQuery;
      const point = yield* StandardApplicationTaskRunQuery;
      const events = yield* StandardApplicationTaskEventHistoryQuery;
      const list = yield* StandardApplicationTaskRunListQuery;
      return {
        historyScope: history.scope,
        eventScope: events.scope,
        listScope: list.scope,
        point,
      };
    }).pipe(Effect.provide(
      makeStandardApplicationTaskReadQueryLayer(store),
    )));

    expect(result.historyScope).toBe(result.point);
    expect(result.eventScope).toBe(result.point);
    expect(result.listScope).toBe(result.point);
  });

  it("rejects a structurally mixed read store before service construction", () => {
    const mixed = Object.freeze({
      inspectRunAttempt: () => Effect.die("scope A"),
      listRuns: () => Effect.die("scope A"),
      listAttempts: () => Effect.die("scope B"),
      listEvents: () => Effect.die("scope C"),
    }) as unknown as ApplicationTaskReadStore;

    expect(() => makeStandardApplicationTaskReadQueryLayer(mixed))
      .toThrow("Application Task read store is unavailable.");
  });

  it("does not expose an alternate authentic-store issuance path", () => {
    const store = authenticStoreWithoutIo();
    const EscapedConstructor = Object.getPrototypeOf(store).constructor as
      new (...arguments_: unknown[]) => ApplicationTaskReadStore;

    expect(() => new EscapedConstructor(
      Symbol("forged read-store issuer"),
      () => Effect.die("scope A"),
      () => Effect.die("scope A"),
      () => Effect.die("scope B"),
      () => Effect.die("scope C"),
    )).toThrow("Application Task read store issuance is unavailable.");
  });

  it("preserves a history failure by identity without retry", async () => {
    const expected = new TaskAttemptHistoryStoreFailure({
      operation: "list_task_attempts",
      runId,
      reason: "run_not_found",
      cause: null,
    });
    const list = vi.fn<StandardApplicationTaskAttemptHistoryQueryApi["list"]>(
      () => Effect.fail(expected),
    );
    const scope = pointQueryScope();

    const received = await Effect.runPromise(Effect.flip(
      listStandardApplicationTaskAttempts(runId).pipe(Effect.provideService(
        StandardApplicationTaskAttemptHistoryQuery,
        StandardApplicationTaskAttemptHistoryQuery.of({ scope, list }),
      )),
    ));

    expect(received).toBe(expected);
    expect(list).toHaveBeenCalledOnce();
  });
});

function pointQueryScope(): StandardApplicationTaskRunQueryApi {
  return StandardApplicationTaskRunQuery.of({
    inspect: () => Effect.die("must not inspect the run"),
  });
}

function authenticStoreWithoutIo(): ApplicationTaskReadStore {
  const located = Object.freeze({
    authority: Object.freeze({
      deploymentId: "deployment_test",
      scopeId: "scope_00000000-0000-4000-8000-0000000000b3",
      physicalLocator: Object.freeze({
        kind: "schema_per_scope" as const,
        databaseKey: "test",
        schemaName: "test",
      }),
      storageGeneration: 1,
      storageGenerationFence: 1n,
      epoch: "epoch_00000000-0000-4000-8000-0000000000b4",
      lastCommitSeq: 0n,
      lastOutboxSeq: 0n,
    }),
    target: Object.freeze({}),
  }) as unknown as Parameters<
    typeof makeApplicationTaskReadStore
  >[0];
  return makeApplicationTaskReadStore(located);
}
