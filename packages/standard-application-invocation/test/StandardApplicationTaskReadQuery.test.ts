import {
  TaskRunListStoreFailure,
  type ApplicationTaskRunListStoreShape,
  type TaskRunListQueryApi,
} from "@flarex/durable-task/internal/run-projection";
import type {
  TaskDatabaseTimeMsV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeApplicationTaskReadStore,
  type ApplicationTaskReadStore,
} from
  "@flarex/persistence-postgres/internal/application-task-read-store";
import { Brand, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runListBridge = vi.hoisted(() => ({
  list: vi.fn<TaskRunListQueryApi["list"]>(),
  stores: [] as ApplicationTaskRunListStoreShape[],
}));

vi.mock("@flarex/durable-task/internal/run-projection", async importOriginal => {
  const actual = await importOriginal<typeof import(
    "@flarex/durable-task/internal/run-projection"
  )>();
  const { Layer } = await import("effect");
  return {
    ...actual,
    makeTaskRunListQueryLayer: (store: ApplicationTaskRunListStoreShape) => {
      runListBridge.stores.push(store);
      return Layer.succeed(
        actual.TaskRunListQuery,
        actual.TaskRunListQuery.of({
          list: options => runListBridge.list(options),
        }),
      );
    },
  };
});

import {
  listStandardApplicationTaskRuns,
  makeStandardApplicationTaskReadQueryLayer,
  StandardApplicationTaskRunListQuery,
} from "../src/StandardApplicationTaskReadQuery.js";
import { StandardApplicationTaskRunQuery } from
  "../src/StandardApplicationTaskRunQuery.js";

const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();

describe("StandardApplicationTaskReadQuery list composition", () => {
  beforeEach(() => {
    runListBridge.list.mockReset();
    runListBridge.stores.length = 0;
  });

  it("delegates list reads through the central authenticated bundle", async () => {
    const store = authenticStoreWithoutIo();
    const expected = Object.freeze({
      observedAtMs: databaseTime(2_000),
      items: Object.freeze([]),
      nextCursor: null,
    });
    runListBridge.list.mockReturnValue(Effect.succeed(expected));

    const result = await Effect.runPromise(Effect.gen(function* () {
      const list = yield* StandardApplicationTaskRunListQuery;
      const point = yield* StandardApplicationTaskRunQuery;
      const page = yield* listStandardApplicationTaskRuns({
        pageSize: 7,
        cursor: null,
      });
      return { listScope: list.scope, page, point };
    }).pipe(Effect.provide(
      makeStandardApplicationTaskReadQueryLayer(store),
    )));

    expect(runListBridge.stores).toEqual([store]);
    expect(runListBridge.list).toHaveBeenCalledExactlyOnceWith({
      pageSize: 7,
      cursor: null,
    });
    expect(result.page).toBe(expected);
    expect(result.listScope).toBe(result.point);
  });

  it("preserves a central list failure by identity without retry", async () => {
    const store = authenticStoreWithoutIo();
    const expected = new TaskRunListStoreFailure({
      operation: "list_task_runs",
      reason: "stale_scope_authority",
      cause: null,
    });
    runListBridge.list.mockReturnValue(Effect.fail(expected));

    const received = await Effect.runPromise(Effect.flip(
      listStandardApplicationTaskRuns({ pageSize: 1, cursor: null }).pipe(
        Effect.provide(makeStandardApplicationTaskReadQueryLayer(store)),
      ),
    ));

    expect(received).toBe(expected);
    expect(runListBridge.list).toHaveBeenCalledOnce();
  });
});

function authenticStoreWithoutIo(): ApplicationTaskReadStore {
  const located = Object.freeze({
    authority: Object.freeze({
      deploymentId: "deployment_test",
      scopeId: "scope_00000000-0000-4000-8000-0000000000c1",
      physicalLocator: Object.freeze({
        kind: "schema_per_scope" as const,
        databaseKey: "test",
        schemaName: "test",
      }),
      storageGeneration: 1,
      storageGenerationFence: 1n,
      epoch: "epoch_00000000-0000-4000-8000-0000000000c2",
      lastCommitSeq: 0n,
      lastOutboxSeq: 0n,
    }),
    target: Object.freeze({}),
  }) as unknown as Parameters<typeof makeApplicationTaskReadStore>[0];
  return makeApplicationTaskReadStore(located);
}
