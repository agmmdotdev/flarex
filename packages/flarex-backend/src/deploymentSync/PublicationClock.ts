import {
  capturePublicationAttemptInstant,
  type PublicationAttemptInstant,
} from "@flarex/query-sync/internal/kernel";
import { Result } from "effect";

import type { DeploymentQuerySyncSqlStorage } from "./StorageContract";

export const DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL = `SELECT
  strftime('%s', 'now') || substr(strftime('%f', 'now'), 4, 3)
    AS publication_attempt_instant`;

const CANONICAL_NON_NEGATIVE_DECIMAL_TEXT = /^(?:0|[1-9][0-9]*)$/;

export type DeploymentQuerySyncPublicationClockOperation =
  | "claimPublication"
  | "recordPublicationAttemptOutcome";

export type DeploymentQuerySyncPublicationInstantReader = (
  sql: DeploymentQuerySyncSqlStorage,
  operation: DeploymentQuerySyncPublicationClockOperation,
) => PublicationAttemptInstant;

export class DeploymentQuerySyncPublicationClockDefect extends Error {
  constructor(
    readonly operation: DeploymentQuerySyncPublicationClockOperation,
    readonly reason: "rowCountInvalid" | "instantInvalid",
    readonly observed: unknown,
  ) {
    super(`Deployment query-sync ${operation} database clock is invalid.`);
  }
}

interface EncodedPublicationClockRow {
  readonly [key: string]: SqlStorageValue;
  readonly publication_attempt_instant: string;
}

export const readDeploymentQuerySyncPublicationInstant:
  DeploymentQuerySyncPublicationInstantReader = (sql, operation) => {
    const rows = sql.exec<EncodedPublicationClockRow>(
      DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
    ).toArray();
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new DeploymentQuerySyncPublicationClockDefect(
        operation,
        "rowCountInvalid",
        rows.length,
      );
    }
    const encoded: unknown = rows[0].publication_attempt_instant;
    if (
      typeof encoded !== "string"
      || !CANONICAL_NON_NEGATIVE_DECIMAL_TEXT.test(encoded)
    ) {
      throw new DeploymentQuerySyncPublicationClockDefect(
        operation,
        "instantInvalid",
        encoded,
      );
    }
    const numeric = Number(encoded);
    if (
      !Number.isSafeInteger(numeric)
      || numeric < 0
      || String(numeric) !== encoded
    ) {
      throw new DeploymentQuerySyncPublicationClockDefect(
        operation,
        "instantInvalid",
        encoded,
      );
    }
    return Result.match(capturePublicationAttemptInstant(numeric), {
      onFailure: cause => {
        throw new DeploymentQuerySyncPublicationClockDefect(
          operation,
          "instantInvalid",
          cause,
        );
      },
      onSuccess: instant => instant,
    });
  };
