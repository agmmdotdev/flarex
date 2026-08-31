import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
  MAX_QUERY_SYNC_WORK_REVISION,
  captureCanonicalDependencyKey,
  captureQueryGeneration,
  compareCanonicalBase64Url,
  type CanonicalDependencyKey,
  type QueryGeneration,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Encoding, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import { readDeploymentQuerySyncDependencies } from "../src/deploymentSync/EvaluationState";
import type { DeploymentQuerySyncSqlStorage } from "../src/deploymentSync/StorageContract";
import {
  beginEvaluation,
  prepareEvaluationState,
  queryDescriptor,
} from "./deploymentSyncEvaluationStateTestSupport";

describe("deployment query-sync evaluation state limits", () => {
  it.each(["active", "completion"] as const)(
    "streams the 8,192-member %s boundary without cursor toArray",
    role => {
      const queryKey = queryDescriptor(19).queryKey;
      const generation = resultSuccess(captureQueryGeneration(1n));
      const maximumKeys = Array.from(
        { length: MAX_QUERY_DEPENDENCY_KEYS },
        (_value, index) => dependencyKey(index, 2),
      ).toSorted(compareCanonicalBase64Url);
      const atLimit = readDeploymentQuerySyncDependencies(
        dependencySql(role, maximumKeys, queryKey, generation),
        "completeQueryEvaluation",
        role,
        queryKey,
        generation,
        MAX_QUERY_DEPENDENCY_KEYS + 1,
      );
      expect(resultSuccess(atLimit)?.dependencyKeys).toHaveLength(
        MAX_QUERY_DEPENDENCY_KEYS,
      );

      const aboveLimit = readDeploymentQuerySyncDependencies(
        dependencySql(
          role,
          [...maximumKeys, dependencyKey(MAX_QUERY_DEPENDENCY_KEYS, 2)]
            .toSorted(compareCanonicalBase64Url),
          queryKey,
          generation,
        ),
        "completeQueryEvaluation",
        role,
        queryKey,
        generation,
        MAX_QUERY_DEPENDENCY_KEYS + 1,
      );
      expect(resultFailure(aboveLimit)).toMatchObject({
        _tag: "QuerySyncStoredStateCorruptError",
        reason: "storedAggregateInvalid",
        cause: {
          evidence: { reason: "dependencyMemberLimitExceeded" },
        },
      });
    },
  );

  it.each(["active", "completion"] as const)(
    "streams the exact 4 MiB %s dependency-byte boundary",
    role => {
      const queryKey = queryDescriptor(20).queryKey;
      const generation = resultSuccess(captureQueryGeneration(1n));
      const maximumValueBytes = 16_384;
      const exactKeys = Array.from(
        { length: MAX_QUERY_DEPENDENCY_BYTES / maximumValueBytes },
        (_value, index) => dependencyKey(index, maximumValueBytes),
      ).toSorted(compareCanonicalBase64Url);
      const atLimit = readDeploymentQuerySyncDependencies(
        dependencySql(role, exactKeys, queryKey, generation),
        "completeQueryEvaluation",
        role,
        queryKey,
        generation,
        MAX_QUERY_DEPENDENCY_KEYS + 1,
      );
      expect(resultSuccess(atLimit)?.dependencyKeys).toHaveLength(
        exactKeys.length,
      );

      const aboveLimit = readDeploymentQuerySyncDependencies(
        dependencySql(
          role,
          [...exactKeys, dependencyKey(257, 1)]
            .toSorted(compareCanonicalBase64Url),
          queryKey,
          generation,
        ),
        "completeQueryEvaluation",
        role,
        queryKey,
        generation,
        MAX_QUERY_DEPENDENCY_KEYS + 1,
      );
      expect(resultFailure(aboveLimit)).toMatchObject({
        _tag: "QuerySyncStoredStateCorruptError",
        reason: "storedAggregateInvalid",
        cause: {
          evidence: { reason: "dependencyByteLimitExceeded" },
        },
      });
    },
  );

  it("rejects scan budgets outside the portable bound without writes", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await beginEvaluation(prepared, queryDescriptor(21));
      for (const maximumQueryInspections of [
        0,
        MAX_EVALUATION_WORK_QUERY_INSPECTIONS + 1,
      ]) {
        const before = snapshot(prepared.database);
        const exit = await Effect.runPromiseExit(
          prepared.state.claimEvaluationWork({
            maximumQueryInspections,
            continuation: null,
          }),
        );
        expectTypedFailure(exit, {
          _tag: "InvalidEvaluationWorkScanRequestError",
          reason: "maximumQueryInspectionsOutOfRange",
        });
        expect(snapshot(prepared.database)).toEqual(before);
      }
    } finally {
      prepared.database.close();
    }
  });

  it("advances fairness in canonical cyclic order with one-row pages", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const descriptors = [31, 29, 30].map(queryDescriptor);
      for (const descriptor of descriptors) {
        await beginEvaluation(prepared, descriptor);
      }
      const expectedOrder = descriptors.toSorted((left, right) =>
        compareCanonicalBase64Url(left.queryKey, right.queryKey)
      );

      const first = await Effect.runPromise(
        prepared.state.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      if (first._tag !== "claimed") {
        throw new Error(`Expected first claim, received ${first._tag}.`);
      }
      expect(first.attempt.descriptor.queryKey).toBe(expectedOrder[0]?.queryKey);

      const second = await Effect.runPromise(
        prepared.state.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: first.continuation,
        }),
      );
      if (second._tag !== "claimed") {
        throw new Error(`Expected second claim, received ${second._tag}.`);
      }
      expect(second.attempt.descriptor.queryKey).toBe(expectedOrder[1]?.queryKey);

      const third = await Effect.runPromise(
        prepared.state.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: second.continuation,
        }),
      );
      if (third._tag !== "claimed") {
        throw new Error(`Expected third claim, received ${third._tag}.`);
      }
      expect(third.attempt.descriptor.queryKey).toBe(expectedOrder[2]?.queryKey);
    } finally {
      prepared.database.close();
    }
  });

  it("returns revision exhaustion before a terminal outcome write", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const attempt = await beginEvaluation(prepared, queryDescriptor(32));
      prepared.database.prepare(`UPDATE deployment_sync_scope_state
        SET evaluation_work_revision = ?
        WHERE singleton = 1`).run(MAX_QUERY_SYNC_WORK_REVISION.toString());
      const before = snapshot(prepared.database);

      const exit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          attempt,
          "terminalRefusal",
        ),
      );

      expectTypedFailure(exit, {
        _tag: "QuerySyncWorkRevisionExhaustedError",
        operation: "recordEvaluationAttemptOutcome",
      });
      expect(snapshot(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });
});

function dependencyKey(
  index: number,
  byteLength: number,
): CanonicalDependencyKey {
  const bytes = new Uint8Array(byteLength);
  if (byteLength > 1) {
    bytes[0] = Math.floor(index / 256);
    bytes[1] = index % 256;
  } else {
    bytes[0] = index % 256;
  }
  return resultSuccess(captureCanonicalDependencyKey(
    Encoding.encodeBase64Url(bytes),
  ));
}

function dependencySql(
  role: "active" | "completion",
  dependencyKeys: readonly CanonicalDependencyKey[],
  queryKey: ReturnType<typeof queryDescriptor>["queryKey"],
  generation: QueryGeneration,
): DeploymentQuerySyncSqlStorage {
  const rows: readonly Record<string, SqlStorageValue>[] = dependencyKeys.map(
    dependencyKeyValue => Object.freeze({
      role,
      query_key: queryKey,
      generation: generation.toString(),
      dependency_key: dependencyKeyValue,
    }),
  );
  return Object.freeze({
    exec: <Row extends Record<string, SqlStorageValue>>() => {
      // SAFETY: this focused adapter supplies the exact row shape requested by
      // readDeploymentQuerySyncDependencies and deliberately forbids toArray.
      return streamingCursor(rows.map(restoreDependencyRowGeneric<Row>));
    },
  });
}

function restoreDependencyRowGeneric<
  Row extends Record<string, SqlStorageValue>,
>(row: Record<string, SqlStorageValue>): Row {
  // SAFETY: dependencySql is invoked only by the dependency reader, whose
  // caller-selected Row is the exact encoded dependency-row projection above.
  return row as Row;
}

function streamingCursor<Row extends Record<string, SqlStorageValue>>(
  rows: readonly Row[],
): SqlStorageCursor<Row> {
  let nextIndex = 0;
  return {
    next: () => {
      const value = rows[nextIndex];
      if (value === undefined) return { done: true };
      nextIndex += 1;
      return { done: false, value };
    },
    toArray: () => {
      throw new Error("Dependency reads must not materialize the SQL cursor.");
    },
    one: () => {
      throw new Error("Dependency reads must not use cursor.one().");
    },
    raw: emptyRawRows,
    columnNames: ["role", "query_key", "generation", "dependency_key"],
    rowsRead: rows.length,
    rowsWritten: 0,
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
}

function resultSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

function resultFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}

function snapshot(database: import("node:sqlite").DatabaseSync) {
  return Object.freeze({
    scope: database.prepare(
      "SELECT * FROM deployment_sync_scope_state",
    ).all(),
    queries: database.prepare(
      "SELECT * FROM deployment_sync_queries ORDER BY query_key",
    ).all(),
    dependencies: database.prepare(
      `SELECT * FROM deployment_sync_query_dependencies
       ORDER BY query_key, role, generation, dependency_key`,
    ).all(),
    pending: database.prepare(
      "SELECT * FROM deployment_sync_pending_publications ORDER BY query_key",
    ).all(),
  });
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}
