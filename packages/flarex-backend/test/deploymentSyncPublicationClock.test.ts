import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
  DeploymentQuerySyncPublicationClockDefect,
  readDeploymentQuerySyncPublicationInstant,
} from "../src/deploymentSync/PublicationClock";
import type {
  DeploymentQuerySyncSqlStorage,
} from "../src/deploymentSync/StorageContract";
import {
  makeSqliteHarness,
} from "./deploymentSyncStorageContractGeneration3TestSupport";

function substituteClockSql(
  base: DeploymentQuerySyncSqlStorage,
  replacement: string,
): DeploymentQuerySyncSqlStorage {
  return Object.freeze({
    exec: <Row extends Record<string, SqlStorageValue>>(
      _query: string,
    ): SqlStorageCursor<Row> => base.exec<Row>(replacement),
  });
}

describe("deployment query-sync SQLite publication clock", () => {
  it("executes the exact production SQL and captures canonical milliseconds", () => {
    const harness = makeSqliteHarness();
    try {
      const observed: string[] = [];
      const sql: DeploymentQuerySyncSqlStorage = Object.freeze({
        exec: <Row extends Record<string, SqlStorageValue>>(
          query: string,
        ): SqlStorageCursor<Row> => {
          observed.push(query);
          return harness.storage.sql.exec<Row>(query);
        },
      });

      const instant = readDeploymentQuerySyncPublicationInstant(
        sql,
        "claimPublication",
      );

      expect(observed).toEqual([
        DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
      ]);
      expect(String(instant)).toMatch(/^(?:0|[1-9][0-9]*)$/u);
      expect(Number.isSafeInteger(Number(instant))).toBe(true);
    } finally {
      harness.database.close();
    }
  });

  it.each([
    ["SELECT '1' AS publication_attempt_instant WHERE 0", "rowCountInvalid"],
    [`SELECT '1' AS publication_attempt_instant
      UNION ALL SELECT '2' AS publication_attempt_instant`, "rowCountInvalid"],
    ["SELECT '01' AS publication_attempt_instant", "instantInvalid"],
    ["SELECT '-1' AS publication_attempt_instant", "instantInvalid"],
    [
      "SELECT '9007199254740992' AS publication_attempt_instant",
      "instantInvalid",
    ],
    ["SELECT '1' AS unexpected_property", "instantInvalid"],
  ] as const)(
    "rejects a foreign clock result as %s / %s without domain laundering",
    (replacement, reason) => {
      const harness = makeSqliteHarness();
      try {
        let caught: unknown;
        try {
          readDeploymentQuerySyncPublicationInstant(
            substituteClockSql(harness.storage.sql, replacement),
            "recordPublicationAttemptOutcome",
          );
        } catch (cause) {
          caught = cause;
        }

        expect(caught).toBeInstanceOf(
          DeploymentQuerySyncPublicationClockDefect,
        );
        expect(caught).toMatchObject({
          operation: "recordPublicationAttemptOutcome",
          reason,
        });
      } finally {
        harness.database.close();
      }
    },
  );
});
