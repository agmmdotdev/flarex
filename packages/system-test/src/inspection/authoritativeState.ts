import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  AppRowIdHexV1Schema,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  projectScopeIdUuidV1Result,
} from "flarex-protocol/storage-authority";

import type { FlarexPersistence } from "@flarex/persistence-postgres";

const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeAppRowIdHexResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);
const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;

export interface CurrentRowInspection {
  readonly tableName: string;
  readonly documentId: AppDocumentIdV1;
  readonly commitSeq: string;
  readonly valueState: "live" | "tombstone";
}

export interface AuthoritativeInspection {
  readonly version: 1;
  readonly currentRows:
    readonly CurrentRowInspection[];
  readonly currentRowCount: number;
  readonly liveRowCount: number;
  readonly revisionRowCount: number;
  readonly commitSeqs: readonly string[];
  readonly idempotencyOutcomeCommitSeqs: readonly string[];
  readonly commitFeedCommitSeqs: readonly string[];
  readonly outboxCommitSeqs: readonly string[];
  readonly mutationRuntimeExecutions: number;
  readonly queryRuntimeExecutions: number;
}

export class InspectionError
  extends Data.TaggedError(
    "InspectionError",
  )<{
    readonly reason:
      | "scopeResolutionFailed"
      | "scopeMissing"
      | "scopeProjectionFailed"
      | "queryFailed"
      | "invalidResult";
    readonly applicationId: string;
    readonly cause: unknown;
  }> {}

export interface ApplicationInspector {
  readonly inspectAuthoritativeState: () => Effect.Effect<
    AuthoritativeInspection,
    InspectionError
  >;
}

export interface MakeApplicationInspectorInput {
  readonly applicationId: string;
  readonly deploymentId: string;
  readonly controlPersistence: FlarexPersistence;
  readonly targetPersistence: FlarexPersistence;
  readonly getMutationRuntimeExecutions: () => number;
  readonly getQueryRuntimeExecutions: () => number;
}

/**
 * Builds one test-run-local logical inspector. It intentionally exposes no SQL,
 * transaction, persistence, scope, or physical-locator capability.
 */
export const makeApplicationInspector = Effect.fn(
  "ApplicationSystemTest.makeInspector",
)(function* (
  input: MakeApplicationInspectorInput,
): Effect.fn.Return<
  ApplicationInspector,
  InspectionError
> {
  const scopeMetadata = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => input.controlPersistence.getScopeMetadataByDeploymentId(
      input.deploymentId,
    ),
    catch: cause => inspectionError(
      input.applicationId,
      "scopeResolutionFailed",
      cause,
    ),
  }));
  if (scopeMetadata === null) {
    return yield* Effect.fail(inspectionError(
      input.applicationId,
      "scopeMissing",
      new Error("The Standard Application test scope metadata is missing."),
    ));
  }
  const scopeProjection = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(scopeMetadata.scopeId).pipe(Result.mapError(
      cause => inspectionError(
        input.applicationId,
        "scopeProjectionFailed",
        cause,
      ),
    )),
  );

  const inspectAuthoritativeState:
    ApplicationInspector["inspectAuthoritativeState"] =
      Effect.fn(
        "ApplicationSystemTest.inspectAuthoritativeState",
      )(function* () {
        const result = yield* Effect.uninterruptible(Effect.tryPromise({
          try: () => input.targetPersistence.query<Record<string, unknown>>(
            INSPECTION_SQL,
            [scopeProjection.scopeUuid, input.deploymentId],
          ),
          catch: cause => inspectionError(
            input.applicationId,
            "queryFailed",
            cause,
          ),
        }));
        return yield* Effect.fromResult(decodeInspectionResult(
          input.applicationId,
          result.rows,
          input.getMutationRuntimeExecutions(),
          input.getQueryRuntimeExecutions(),
        ));
      });

  return Object.freeze({ inspectAuthoritativeState });
});

const INSPECTION_SQL = `select
  (select count(*)::text
     from fx_app_row_current
    where scope_uuid = $1) as current_pointer_count,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'tableName', table_metadata.logical_name,
        'tableId', current_row.table_id,
        'rowIdHex', encode(current_row.row_id, 'hex'),
        'commitSeq', current_row.commit_seq::text,
        'valueState', case
          when revision.is_tombstone then 'tombstone'
          else 'live'
        end
      ) order by current_row.table_id, current_row.row_id
    )
      from fx_app_row_current as current_row
      join fx_app_row_rev as revision
        on revision.scope_uuid = current_row.scope_uuid
       and revision.table_id = current_row.table_id
       and revision.row_id = current_row.row_id
       and revision.commit_seq = current_row.commit_seq
      join fx_control_table as table_metadata
        on table_metadata.deployment_id = $2
       and table_metadata.table_id = current_row.table_id
       and table_metadata.namespace = 'app'
     where current_row.scope_uuid = $1
  ), '[]'::jsonb) as current_rows,
  (select count(*)::text
     from fx_app_row_rev
    where scope_uuid = $1) as revision_count,
  coalesce((
    select jsonb_agg(commit_seq::text order by commit_seq)
      from fx_system_commit
     where scope_uuid = $1
  ), '[]'::jsonb) as commit_seqs,
  coalesce((
    select jsonb_agg(commit_seq::text order by commit_seq)
      from fx_system_idempotency
     where scope_uuid = $1
  ), '[]'::jsonb) as outcome_commit_seqs,
  coalesce((
    select jsonb_agg(commit_seq::text order by commit_seq, change_ordinal)
      from fx_system_commit_app_row_change
     where scope_uuid = $1
  ), '[]'::jsonb) as feed_commit_seqs,
  coalesce((
    select jsonb_agg(commit_seq::text order by outbox_seq)
      from fx_system_outbox
     where scope_uuid = $1
  ), '[]'::jsonb) as outbox_commit_seqs`;

function decodeInspectionResult(
  applicationId: string,
  rows: readonly Record<string, unknown>[],
  mutationRuntimeExecutions: number,
  queryRuntimeExecutions: number,
): Result.Result<
  AuthoritativeInspection,
  InspectionError
> {
  if (rows.length !== 1) {
    return Result.fail(invalidInspectionResult(
      applicationId,
      "The inspection query did not return exactly one row.",
    ));
  }
  const row = rows[0];
  if (row === undefined || !isNonArrayRecord(row)) {
    return Result.fail(invalidInspectionResult(
      applicationId,
      "The inspection query row is not a record.",
    ));
  }
  return Result.gen(function* () {
    const currentPointerCount = yield* decodeCount(
      applicationId,
      "current_pointer_count",
      row.current_pointer_count,
    );
    const currentRows = yield* decodeCurrentRows(
      applicationId,
      row.current_rows,
    );
    if (currentRows.length !== currentPointerCount) {
      return yield* Result.fail(invalidInspectionResult(
        applicationId,
        "The logical current-row projection omitted an authoritative pointer.",
      ));
    }
    const revisionRowCount = yield* decodeCount(
      applicationId,
      "revision_count",
      row.revision_count,
    );
    const commitSeqs = yield* decodeCommitSeqArray(
      applicationId,
      "commit_seqs",
      row.commit_seqs,
    );
    const idempotencyOutcomeCommitSeqs = yield* decodeCommitSeqArray(
      applicationId,
      "outcome_commit_seqs",
      row.outcome_commit_seqs,
    );
    const commitFeedCommitSeqs = yield* decodeCommitSeqArray(
      applicationId,
      "feed_commit_seqs",
      row.feed_commit_seqs,
    );
    const outboxCommitSeqs = yield* decodeCommitSeqArray(
      applicationId,
      "outbox_commit_seqs",
      row.outbox_commit_seqs,
    );
    if (
      !isNonNegativeSafeInteger(mutationRuntimeExecutions) ||
      !isNonNegativeSafeInteger(queryRuntimeExecutions)
    ) {
      return yield* Result.fail(invalidInspectionResult(
        applicationId,
        "The runtime execution counters are invalid.",
      ));
    }
    return Object.freeze({
      version: 1,
      currentRows,
      currentRowCount: currentRows.length,
      liveRowCount: currentRows.filter(row => row.valueState === "live").length,
      revisionRowCount,
      commitSeqs,
      idempotencyOutcomeCommitSeqs,
      commitFeedCommitSeqs,
      outboxCommitSeqs,
      mutationRuntimeExecutions,
      queryRuntimeExecutions,
    } satisfies AuthoritativeInspection);
  });
}

function decodeCurrentRows(
  applicationId: string,
  value: unknown,
): Result.Result<
  readonly CurrentRowInspection[],
  InspectionError
> {
  if (!Array.isArray(value)) {
    return Result.fail(invalidInspectionResult(
      applicationId,
      "The current-row projection is not an array.",
    ));
  }
  return Result.gen(function* () {
    const decoded: CurrentRowInspection[] = [];
    for (const item of value) {
      if (!isNonArrayRecord(item)) {
        return yield* Result.fail(invalidInspectionResult(
          applicationId,
          "A current-row projection is not a record.",
        ));
      }
      if (!isNonBlankString(item.tableName)) {
        return yield* Result.fail(invalidInspectionResult(
          applicationId,
          "A current-row table name is invalid.",
        ));
      }
      const tableId = yield* decodeCatalogTableIdResult(item.tableId).pipe(
        Result.mapError(cause => inspectionError(
          applicationId,
          "invalidResult",
          cause,
        )),
      );
      const rowId = yield* decodeAppRowIdHexResult(item.rowIdHex).pipe(
        Result.mapError(cause => inspectionError(
          applicationId,
          "invalidResult",
          cause,
        )),
      );
      if (!isPositiveDecimalText(item.commitSeq)) {
        return yield* Result.fail(invalidInspectionResult(
          applicationId,
          "A current-row commit sequence is invalid.",
        ));
      }
      if (item.valueState !== "live" && item.valueState !== "tombstone") {
        return yield* Result.fail(invalidInspectionResult(
          applicationId,
          "A current-row value state is invalid.",
        ));
      }
      decoded.push(Object.freeze({
        tableName: item.tableName,
        documentId: appDocumentIdV1FromRowIdentity({ tableId, rowId }),
        commitSeq: item.commitSeq,
        valueState: item.valueState,
      } satisfies CurrentRowInspection));
    }
    return Object.freeze(decoded);
  });
}

function decodeCount(
  applicationId: string,
  field: string,
  value: unknown,
): Result.Result<number, InspectionError> {
  if (typeof value !== "string" || !NON_NEGATIVE_DECIMAL_PATTERN.test(value)) {
    return Result.fail(invalidInspectionResult(
      applicationId,
      `The ${field} count is not a canonical non-negative decimal.`,
    ));
  }
  const count = Number(value);
  return isNonNegativeSafeInteger(count)
    ? Result.succeed(count)
    : Result.fail(invalidInspectionResult(
      applicationId,
      `The ${field} count exceeds the safe inspection range.`,
    ));
}

function decodeCommitSeqArray(
  applicationId: string,
  field: string,
  value: unknown,
): Result.Result<
  readonly string[],
  InspectionError
> {
  if (!Array.isArray(value)) {
    return Result.fail(invalidInspectionResult(
      applicationId,
      `The ${field} projection is not an array.`,
    ));
  }
  const decoded: string[] = [];
  for (const item of value) {
    if (!isPositiveDecimalText(item)) {
      return Result.fail(invalidInspectionResult(
        applicationId,
        `The ${field} projection contains an invalid commit sequence.`,
      ));
    }
    decoded.push(item);
  }
  return Result.succeed(Object.freeze(decoded));
}

function isPositiveDecimalText(value: unknown): value is string {
  return typeof value === "string" && POSITIVE_DECIMAL_PATTERN.test(value);
}

function invalidInspectionResult(
  applicationId: string,
  message: string,
): InspectionError {
  return inspectionError(applicationId, "invalidResult", new Error(message));
}

function inspectionError(
  applicationId: string,
  reason: InspectionError["reason"],
  cause: unknown,
): InspectionError {
  return new InspectionError({
    reason,
    applicationId,
    cause,
  });
}
