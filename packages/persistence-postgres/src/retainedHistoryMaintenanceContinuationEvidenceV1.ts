import { Result, Schema } from "effect";
import {
  AppRowIdHexV1Schema,
} from "flarex-protocol/app-document-id";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
} from "flarex-protocol/ordered-index";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationSchema,
} from "flarex-protocol/storage-authority";

import type { RetainedAppRowHistoryCursor } from
  "./retainedAppRowHistoryCompaction";
import type { RetainedIndexHistoryCursor } from
  "./retainedIndexHistoryCompaction";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";

const StrictParseOptions = { onExcessProperty: "error" } as const;

const NonBlankStringSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    value.trim().length > 0 ? undefined : "Expected a nonblank string"
  ),
);

const CanonicalNonnegativeInt64TextSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value.length > 19 || !/^(0|[1-9][0-9]*)$/.test(value)) {
      return "Expected canonical nonnegative int64 text";
    }
    return BigInt(value) <= MAX_PERSISTED_SIGNED_INT64_V1
      ? undefined
      : "Expected canonical nonnegative int64 text";
  }),
);

const CanonicalPositiveInt64TextSchema = CanonicalNonnegativeInt64TextSchema
  .check(Schema.makeFilter((value) =>
    value === "0" ? "Expected canonical positive int64 text" : undefined
  ));

const ScopePhysicalLocatorSchema = Schema.Struct({
  kind: Schema.Literals([
    "shared_database",
    "schema_per_scope",
    "database_per_scope",
  ]),
  databaseKey: NonBlankStringSchema,
  schemaName: NonBlankStringSchema,
});

const RetainedIndexHistoryIdentitySchema = Schema.Struct({
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  encodedKey: OrderedIndexKeyBytesHexV1Schema,
  rowId: OrderedIndexRowIdHexV1Schema,
});

const RetainedIndexHistoryCursorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("start") }),
  Schema.Struct({
    kind: Schema.Literals(["after", "exact"]),
    identity: RetainedIndexHistoryIdentitySchema,
  }),
]);

const RetainedAppRowHistoryIdentitySchema = Schema.Struct({
  tableId: CatalogTableIdSchema,
  rowId: AppRowIdHexV1Schema,
});

const RetainedAppRowHistoryCursorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("start") }),
  Schema.Struct({
    kind: Schema.Literals(["after", "exact"]),
    identity: RetainedAppRowHistoryIdentitySchema,
  }),
]);

const RetainedHistoryMaintenancePhaseEvidenceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("commitHistory") }),
  Schema.Struct({
    kind: Schema.Literal("indexHistory"),
    cursor: RetainedIndexHistoryCursorSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("appRowHistory"),
    cursor: RetainedAppRowHistoryCursorSchema,
  }),
]);

export const RetainedHistoryMaintenanceContinuationEvidenceSchemaV1 =
  Schema.Struct({
    version: Schema.Literal(
      "flarex.retained-history-maintenance-continuation.v1",
    ),
    deploymentId: NonBlankStringSchema,
    scopeId: ScopeIdSchema,
    retainedFloor: CanonicalNonnegativeInt64TextSchema,
    authority: Schema.Struct({
      physicalLocator: ScopePhysicalLocatorSchema,
      storageGeneration: StorageGenerationSchema,
      storageGenerationFence: CanonicalPositiveInt64TextSchema,
      epoch: ScopeEpochSchema,
    }),
    phase: RetainedHistoryMaintenancePhaseEvidenceSchema,
  });

export type RetainedHistoryMaintenanceContinuationEvidenceV1 =
  typeof RetainedHistoryMaintenanceContinuationEvidenceSchemaV1.Type;

const decodeEvidenceResult = Schema.decodeUnknownResult(
  RetainedHistoryMaintenanceContinuationEvidenceSchemaV1,
  StrictParseOptions,
);

export function decodeRetainedHistoryMaintenanceContinuationEvidenceV1Result(
  input: unknown,
): Result.Result<RetainedHistoryMaintenanceContinuationEvidenceV1, unknown> {
  return decodeEvidenceResult(input).pipe(Result.map(captureEvidence));
}

export function captureRetainedHistoryMaintenanceContinuationEvidenceV1(
  input: RetainedHistoryMaintenanceContinuationEvidenceV1,
): RetainedHistoryMaintenanceContinuationEvidenceV1 {
  return captureEvidence(input);
}

function captureEvidence(
  input: RetainedHistoryMaintenanceContinuationEvidenceV1,
): RetainedHistoryMaintenanceContinuationEvidenceV1 {
  return Object.freeze({
    version: input.version,
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    retainedFloor: input.retainedFloor,
    authority: Object.freeze({
      physicalLocator: captureLocator(input.authority.physicalLocator),
      storageGeneration: input.authority.storageGeneration,
      storageGenerationFence: input.authority.storageGenerationFence,
      epoch: input.authority.epoch,
    }),
    phase: capturePhase(input.phase),
  });
}

function captureLocator(locator: ScopePhysicalLocator): ScopePhysicalLocator {
  return Object.freeze({
    kind: locator.kind,
    databaseKey: locator.databaseKey,
    schemaName: locator.schemaName,
  });
}

function capturePhase(
  phase: RetainedHistoryMaintenanceContinuationEvidenceV1["phase"],
): RetainedHistoryMaintenanceContinuationEvidenceV1["phase"] {
  switch (phase.kind) {
    case "commitHistory":
      return Object.freeze({ kind: "commitHistory" });
    case "indexHistory":
      return Object.freeze({
        kind: "indexHistory",
        cursor: captureIndexCursor(phase.cursor),
      });
    case "appRowHistory":
      return Object.freeze({
        kind: "appRowHistory",
        cursor: captureAppRowCursor(phase.cursor),
      });
  }
}

function captureIndexCursor(
  cursor: RetainedIndexHistoryCursor,
): RetainedIndexHistoryCursor {
  return cursor.kind === "start"
    ? Object.freeze({ kind: "start" })
    : Object.freeze({
      kind: cursor.kind,
      identity: Object.freeze({ ...cursor.identity }),
    });
}

function captureAppRowCursor(
  cursor: RetainedAppRowHistoryCursor,
): RetainedAppRowHistoryCursor {
  return cursor.kind === "start"
    ? Object.freeze({ kind: "start" })
    : Object.freeze({
      kind: cursor.kind,
      identity: Object.freeze({ ...cursor.identity }),
    });
}
