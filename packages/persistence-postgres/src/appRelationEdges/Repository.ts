import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import {
  and,
  asc,
  eq,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Cause, Effect, Exit, Option, Result, Schema } from "effect";

import {
  appRowIdHexV1ToBytes,
  appRowIdHexV1FromBytesResult,
  decodeAppDocumentIdentityV1Result,
  AppRowIdHexV1Schema,
  type AppDocumentIdentityV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogRelationIdSchema,
  type CatalogEdgeDefinitionId,
  type CatalogRelationId,
} from "flarex-protocol/catalog";
import {
  decodePhysicalEdgeDefinitionResult,
  RELATION_INCOMING_PAGE_MAXIMUM_BASE_ROWS_V1,
  RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1,
  type PhysicalEdgeDefinitionV1,
} from "flarex-protocol/internal/application-schema-binding";
import { MAX_RELATION_MANY_ITEMS_V1 } from
  "flarex-protocol/internal/relation-declaration-v1";
import {
  canonicalizeRelationOccurrenceV1,
  RelationOccurrenceSha256,
  type RelationOccurrenceSha256Error,
  type RelationOccurrenceV1Error,
  type CanonicalRelationOccurrenceV1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  ScopeIdSchema,
  type CommitSeq,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { observeDrizzleQuery } from "../drizzleQueryObservation";
import {
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
} from "../scopeClock";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
} from "../schema";
import {
  AppRelationEdgeConflictError,
  AppRelationEdgeCorruptionError,
  AppRelationEdgeEvidenceError,
  AppRelationEdgeInputError,
  AppRelationEdgeOccurrenceCollisionError,
  AppRelationEdgePersistenceError,
  type AppRelationEdgeAdjacencyDirection,
  type AppRelationEdgeDefinitionPin,
  type AppRelationEdgeIncomingFrontier,
  type AppRelationEdgeMutationOptions,
  type AppRelationEdgeMutationStatementName,
  type AppRelationEdgeMutationError,
  type AppRelationEdgeOperation,
  type AppRelationEdgePersistenceOperation,
  type AppRelationEdgePosition,
  type AppRelationEdgeReadError,
  type ApplyAppRelationEdgeChangesInput,
  type ApplyAppRelationEdgeChangesResult,
  type HasIncomingAppRelationEdgeInput,
  type ReadAppRelationEdgeAdjacencyVersionInput,
  type ReadIncomingAppRelationEdgePageInput,
  type ReadIncomingAppRelationEdgePageResult,
} from "./Model";
import {
  decodeStoredAdjacencyVersionResult,
  decodeStoredAppRelationEdgeResult,
  decodeStoredIncomingAppRelationEdgePageItemResult,
  type StoredAppRelationEdge,
} from "./RowCodec";

const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeRelationIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogRelationIdSchema),
);
const decodeEdgeDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogEdgeDefinitionIdSchema),
);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodeRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);
const ABSENT_ADJACENCY_VERSION = CommitSeqSchema.make(0n);
const MAXIMUM_MATCH_PREDICATES_PER_STATEMENT = 256;
const MAXIMUM_MUTATION_ROWS_PER_STATEMENT = 500;
const MUTATION_SAVEPOINT = "flarex_app_relation_edges_batch";

interface PreparedDefinitionPin {
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly physical: PhysicalEdgeDefinitionV1;
}

interface PreparedEdgeAction {
  readonly kind: "put" | "remove" | "reorder";
  readonly definition: PreparedDefinitionPin;
  readonly occurrence: CanonicalRelationOccurrenceV1;
  readonly source: AppDocumentIdentityV1;
  readonly target: AppDocumentIdentityV1;
  readonly position: AppRelationEdgePosition;
}

interface PreparedMutationInput {
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly commitSeq: CommitSeq;
  readonly actions: ReadonlyArray<PreparedEdgeAction>;
}

interface MutationContext {
  readonly scopeUuid: ScopeUuidV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly commitSeq: CommitSeq;
}

interface AffectedEndpoint {
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly direction: AppRelationEdgeAdjacencyDirection;
  readonly endpointRowId: AppRowIdHexV1;
}

interface CurrentEdgeSnapshot {
  readonly byIdentity: ReadonlyMap<string, StoredAppRelationEdge>;
  readonly byDigest: ReadonlyMap<string, StoredAppRelationEdge>;
}

interface AdjacencyVersionSnapshot {
  readonly byEndpoint: ReadonlyMap<string, CommitSeq>;
}

/**
 * Apply one bounded set of exact current-edge changes inside the caller's
 * transaction. This operation neither starts nor commits a transaction and it
 * never allocates or advances the scope commit sequence.
 */
export const applyAppRelationEdgeChangesInTransactionEffect = Effect.fn(
  "AppRelationEdges.applyChangesInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: ApplyAppRelationEdgeChangesInput,
  options: AppRelationEdgeMutationOptions = {},
): Effect.fn.Return<
  ApplyAppRelationEdgeChangesResult,
  AppRelationEdgeMutationError,
  RelationOccurrenceSha256
> {
  const prepared = yield* prepareMutationInputEffect(input);
  return yield* applyPreparedMutationWithinSavepointEffect(
    tx,
    prepared,
    options,
  );
});

const applyPreparedMutationEffect = Effect.fn(
  "AppRelationEdges.applyPreparedMutation",
)(function* (
  tx: FlarexMetadataTransaction,
  prepared: PreparedMutationInput,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<ApplyAppRelationEdgeChangesResult, AppRelationEdgeMutationError> {
  observeMutationStatement(options, "lockScopeClock");
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    prepared.scopeId,
  ).pipe(Effect.mapError(mapScopeClockError));
  if (prepared.commitSeq > clock.lastCommitSeq + 1n) {
    return yield* Effect.fail(new AppRelationEdgeInputError({
      operation: "applyChanges",
      reason: "commitSequenceAheadOfScopeClock",
    }));
  }
  const scopeProjection = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(prepared.scopeId).pipe(
      Result.mapError((cause) => new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "scope ID cannot project to target-local UUID",
        cause,
      })),
    ),
  );
  const epochProjection = yield* Effect.fromResult(
    projectScopeEpochUuidV1Result(clock.epoch).pipe(
      Result.mapError((cause) => new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "scope epoch cannot project to target-local UUID",
        cause,
      })),
    ),
  );
  const context: MutationContext = Object.freeze({
    scopeUuid: scopeProjection.scopeUuid,
    writeEpochUuid: epochProjection.epochUuid,
    schemaVersionId: prepared.schemaVersionId,
    commitSeq: prepared.commitSeq,
  });
  const snapshot = yield* readCurrentEdgesForActionsEffect(
    tx,
    context.scopeUuid,
    prepared.actions,
    options,
  );
  const endpoints = affectedEndpoints(prepared.actions);
  const versions = yield* readAffectedAdjacencyVersionsEffect(
    tx,
    context.scopeUuid,
    endpoints,
    options,
  );
  yield* validatePreparedActionsEffect(
    context,
    prepared.actions,
    snapshot,
    endpoints,
    versions,
  );
  return yield* applyPreparedChangesEffect(
    tx,
    context,
    prepared.actions,
    endpoints,
    options,
  );
});

/** Read one endpoint version, interpreting an absent row as the frozen zero. */
export const readAppRelationEdgeAdjacencyVersionInTransactionEffect = Effect.fn(
  "AppRelationEdges.readAdjacencyVersionInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: ReadAppRelationEdgeAdjacencyVersionInput,
): Effect.fn.Return<CommitSeq, AppRelationEdgeReadError> {
  const prepared = yield* Effect.fromResult(
    prepareAdjacencyVersionInputResult(input),
  );
  return yield* readAdjacencyVersionEffect(
    tx,
    prepared.scopeUuid,
    prepared.edgeDefinitionId,
    prepared.direction,
    prepared.endpointRowId,
    "readAdjacencyVersion",
  );
});

/**
 * Exact writer-side anti-existence check for C09 `restrict`. The caller owns
 * the transaction and its scope-clock lock; this is not a runtime relation
 * read and produces no snapshot/OCC evidence.
 */
export const hasIncomingAppRelationEdgeInTransactionEffect = Effect.fn(
  "AppRelationEdges.hasIncomingInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: HasIncomingAppRelationEdgeInput,
): Effect.fn.Return<boolean, AppRelationEdgeReadError> {
  const prepared = yield* Effect.fromResult(
    prepareIncomingEndpointInputResult("hasIncoming", input),
  );
  const query = tx.select({
    edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId,
  }).from(fxAppEdgeCurrent).where(and(
    eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
    eq(
      fxAppEdgeCurrent.edgeDefinitionId,
      prepared.definition.edgeDefinitionId,
    ),
    eq(
      fxAppEdgeCurrent.targetRowId,
      appRowIdHexV1ToBytes(prepared.targetRowId),
    ),
  )).limit(1);
  observeDrizzleQuery("hasIncoming", query, input.observeQuery);
  const rows = yield* runQueryEffect("hasIncoming", query);
  const row = rows[0];
  if (row === undefined) return false;
  if (
    rows.length !== 1 ||
    row.edgeDefinitionId !== prepared.definition.edgeDefinitionId
  ) {
    return yield* Effect.fail(new AppRelationEdgeCorruptionError({
      operation: "hasIncoming",
      reason: "incoming existence query returned invalid evidence",
    }));
  }
  return true;
});

/**
 * Read one physical incoming page with version-before/version-after evidence.
 * This does not decide snapshot eligibility or register an OCC dependency.
 */
export const readIncomingAppRelationEdgePageInTransactionEffect = Effect.fn(
  "AppRelationEdges.readIncomingPageInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: ReadIncomingAppRelationEdgePageInput,
): Effect.fn.Return<
  ReadIncomingAppRelationEdgePageResult,
  AppRelationEdgeReadError
> {
  const prepared = yield* Effect.fromResult(prepareIncomingPageInputResult(
    input,
  ));
  const versionBefore = yield* readAdjacencyVersionEffect(
    tx,
    prepared.scopeUuid,
    prepared.definition.edgeDefinitionId,
    "incoming",
    prepared.targetRowId,
    "readIncomingPage",
  );
  const afterBytes = prepared.after === undefined
    ? undefined
    : appRowIdHexV1ToBytes(prepared.after.sourceRowId);
  const query = tx.select({
    sourceRowId: fxAppEdgeCurrent.sourceRowId,
    duplicateOrdinal: fxAppEdgeCurrent.duplicateOrdinal,
    position: fxAppEdgeCurrent.position,
    commitSeq: fxAppEdgeCurrent.commitSeq,
  }).from(fxAppEdgeCurrent).where(and(
    eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
    eq(
      fxAppEdgeCurrent.edgeDefinitionId,
      prepared.definition.edgeDefinitionId,
    ),
    eq(
      fxAppEdgeCurrent.targetRowId,
      appRowIdHexV1ToBytes(prepared.targetRowId),
    ),
    afterBytes === undefined
      ? undefined
      : sql`(
          ${fxAppEdgeCurrent.sourceRowId},
          ${fxAppEdgeCurrent.duplicateOrdinal}
        ) > (
          ${afterBytes}::bytea,
          ${prepared.after?.duplicateOrdinal ?? 0}::integer
        )`,
  )).orderBy(
    asc(fxAppEdgeCurrent.sourceRowId),
    asc(fxAppEdgeCurrent.duplicateOrdinal),
  ).limit(prepared.maximumIdentities + 1);
  observeDrizzleQuery("readIncomingPage", query, input.observeQuery);
  const rows = yield* runQueryEffect(
    "readIncomingPage",
    query,
  );
  const decoded = [];
  for (const row of rows) {
    const item = yield* Effect.fromResult(
      decodeStoredIncomingAppRelationEdgePageItemResult(row),
    );
    if (!positionMatchesDefinition(item.position, prepared.definition.physical)) {
      return yield* Effect.fail(new AppRelationEdgeCorruptionError({
        operation: "readIncomingPage",
        reason: "stored position disagrees with the physical definition",
      }));
    }
    decoded.push(item);
  }
  if (decoded.length > RELATION_INCOMING_PAGE_MAXIMUM_BASE_ROWS_V1) {
    return yield* Effect.fail(new AppRelationEdgeCorruptionError({
      operation: "readIncomingPage",
      reason: "incoming query exceeded its base-row ceiling",
    }));
  }
  const hasLookahead = decoded.length > prepared.maximumIdentities;
  const items = Object.freeze(decoded.slice(0, prepared.maximumIdentities));
  const last = items.at(-1);
  const nextFrontier = hasLookahead && last !== undefined
    ? Object.freeze({
      sourceRowId: last.sourceRowId,
      duplicateOrdinal: last.duplicateOrdinal,
    })
    : null;
  const versionAfter = yield* readAdjacencyVersionEffect(
    tx,
    prepared.scopeUuid,
    prepared.definition.edgeDefinitionId,
    "incoming",
    prepared.targetRowId,
    "readIncomingPage",
  );
  return Object.freeze({
    items,
    versionBefore,
    versionAfter,
    nextFrontier,
    exhausted: !hasLookahead,
  });
});

const prepareMutationInputEffect = Effect.fn(
  "AppRelationEdges.prepareMutationInput",
)(function* (
  input: ApplyAppRelationEdgeChangesInput,
): Effect.fn.Return<
  PreparedMutationInput,
  AppRelationEdgeInputError | AppRelationEdgeEvidenceError,
  RelationOccurrenceSha256
> {
  const operation = "applyChanges" as const;
  const scopeId = yield* decodeInputEffect(
    operation,
    decodeScopeIdResult(input.scopeId),
    "invalidScope",
  );
  const schemaVersionId = yield* decodeInputEffect(
    operation,
    decodeSchemaVersionIdResult(input.schemaVersionId),
    "invalidSchemaVersion",
  );
  if (!isNonBlankString(schemaVersionId)) {
    return yield* Effect.fail(new AppRelationEdgeInputError({
      operation,
      reason: "invalidSchemaVersion",
    }));
  }
  const commitSeq = yield* decodeInputEffect(
    operation,
    decodeCommitSeqResult(input.commitSeq),
    "invalidCommitSequence",
  );
  if (commitSeq < 1n) {
    return yield* Effect.fail(new AppRelationEdgeInputError({
      operation,
      reason: "invalidCommitSequence",
    }));
  }
  if (
    !Array.isArray(input.actions) ||
    input.actions.length > RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1
  ) {
    return yield* Effect.fail(new AppRelationEdgeInputError({
      operation,
      reason: "transactionOccurrenceLimitExceeded",
    }));
  }
  const actions: PreparedEdgeAction[] = [];
  const identities = new Set<string>();
  for (const action of input.actions.slice()) {
    const prepared = yield* prepareActionEffect(action);
    const identity = actionIdentityKey(prepared);
    if (identities.has(identity)) {
      return yield* Effect.fail(new AppRelationEdgeInputError({
        operation,
        reason: "duplicateBatchIdentity",
      }));
    }
    identities.add(identity);
    actions.push(prepared);
  }
  return Object.freeze({
    scopeId,
    schemaVersionId,
    commitSeq,
    actions: Object.freeze(actions),
  });
});

const prepareActionEffect = Effect.fn("AppRelationEdges.prepareAction")(
  function* (
    action: ApplyAppRelationEdgeChangesInput["actions"][number],
  ): Effect.fn.Return<
    PreparedEdgeAction,
    AppRelationEdgeInputError | AppRelationEdgeEvidenceError,
    RelationOccurrenceSha256
  > {
    const operation = "applyChanges" as const;
    if (
      action === null || typeof action !== "object" ||
      (action.kind !== "put" && action.kind !== "remove" &&
        action.kind !== "reorder")
    ) {
      return yield* Effect.fail(new AppRelationEdgeInputError({
        operation,
        reason: "invalidOccurrence",
      }));
    }
    const definition = yield* Effect.fromResult(
      prepareDefinitionPinResult(operation, action.definition),
    );
    const occurrence = yield* canonicalizeRelationOccurrenceV1(
      action.occurrence,
    ).pipe(Effect.mapError(mapOccurrenceCanonicalizationError));
    const source = yield* decodeInputEffect(
      operation,
      decodeAppDocumentIdentityV1Result(
        occurrence.occurrence.sourceDocumentId,
      ),
      "invalidOccurrence",
    );
    const target = yield* decodeInputEffect(
      operation,
      decodeAppDocumentIdentityV1Result(
        occurrence.occurrence.targetDocumentId,
      ),
      "invalidOccurrence",
    );
    if (
      source.tableId !== definition.physical.sourceTableId ||
      target.tableId !== definition.physical.targetTableId ||
      !sourcePathsEqual(
        occurrence.occurrence.sourcePath,
        definition.physical.sourcePath,
      )
    ) {
      return yield* Effect.fail(new AppRelationEdgeInputError({
        operation,
        reason: "occurrenceDefinitionMismatch",
      }));
    }
    const position = action.kind === "remove" ? null : action.position;
    if (
      action.kind !== "remove" &&
      !positionMatchesDefinition(position, definition.physical)
    ) {
      return yield* Effect.fail(new AppRelationEdgeInputError({
        operation,
        reason: "invalidPosition",
      }));
    }
    return Object.freeze({
      kind: action.kind,
      definition,
      occurrence,
      source,
      target,
      position,
    });
  },
);

function prepareDefinitionPinResult(
  operation: AppRelationEdgeOperation,
  input: AppRelationEdgeDefinitionPin,
): Result.Result<PreparedDefinitionPin, AppRelationEdgeInputError> {
  return Result.gen(function* () {
    if (input === null || typeof input !== "object") {
      return yield* invalidInput(operation, "invalidDefinition");
    }
    const relationId = yield* mapInputResult(
      operation,
      decodeRelationIdResult(input.relationId),
      "invalidDefinition",
    );
    const edgeDefinitionId = yield* mapInputResult(
      operation,
      decodeEdgeDefinitionIdResult(input.edgeDefinitionId),
      "invalidDefinition",
    );
    const physical = yield* mapInputResult(
      operation,
      decodePhysicalEdgeDefinitionResult(input.physical),
      "invalidDefinition",
    );
    return Object.freeze({ relationId, edgeDefinitionId, physical });
  });
}

function prepareAdjacencyVersionInputResult(
  input: ReadAppRelationEdgeAdjacencyVersionInput,
): Result.Result<
  Readonly<{
    scopeUuid: ScopeUuidV1;
    edgeDefinitionId: CatalogEdgeDefinitionId;
    direction: AppRelationEdgeAdjacencyDirection;
    endpointRowId: AppRowIdHexV1;
  }>,
  AppRelationEdgeInputError | AppRelationEdgeCorruptionError
> {
  const operation = "readAdjacencyVersion" as const;
  return Result.gen(function* () {
    const scopeId = yield* mapInputResult(
      operation,
      decodeScopeIdResult(input.scopeId),
      "invalidScope",
    );
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) => new AppRelationEdgeCorruptionError({
        operation,
        reason: "scope ID cannot project to target-local UUID",
        cause,
      })),
    );
    const edgeDefinitionId = yield* mapInputResult(
      operation,
      decodeEdgeDefinitionIdResult(input.edgeDefinitionId),
      "invalidDefinition",
    );
    if (input.direction !== "incoming" && input.direction !== "outgoing") {
      return yield* invalidInput(operation, "invalidDefinition");
    }
    const endpointRowId = yield* mapInputResult(
      operation,
      decodeRowIdResult(input.endpointRowId),
      "invalidOccurrence",
    );
    return Object.freeze({
      scopeUuid: scopeProjection.scopeUuid,
      edgeDefinitionId,
      direction: input.direction,
      endpointRowId,
    });
  });
}

function prepareIncomingPageInputResult(
  input: ReadIncomingAppRelationEdgePageInput,
): Result.Result<
  Readonly<{
    scopeUuid: ScopeUuidV1;
    definition: PreparedDefinitionPin;
    targetRowId: AppRowIdHexV1;
    maximumIdentities: number;
    after?: AppRelationEdgeIncomingFrontier;
  }>,
  AppRelationEdgeInputError | AppRelationEdgeCorruptionError
> {
  const operation = "readIncomingPage" as const;
  return Result.gen(function* () {
    const endpoint = yield* prepareIncomingEndpointInputResult(
      operation,
      input,
    );
    if (
      !Number.isInteger(input.maximumIdentities) ||
      input.maximumIdentities < 1 ||
      input.maximumIdentities > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
    ) {
      return yield* invalidInput(operation, "invalidPageSize");
    }
    let after: AppRelationEdgeIncomingFrontier | undefined;
    if (input.after !== undefined) {
      const sourceRowId = yield* mapInputResult(
        operation,
        decodeRowIdResult(input.after.sourceRowId),
        "invalidFrontier",
      );
      if (input.after.duplicateOrdinal !== 0) {
        return yield* invalidInput(operation, "invalidFrontier");
      }
      after = Object.freeze({ sourceRowId, duplicateOrdinal: 0 });
    }
    return Object.freeze({
      ...endpoint,
      maximumIdentities: input.maximumIdentities,
      ...(after === undefined ? {} : { after }),
    });
  });
}

function prepareIncomingEndpointInputResult(
  operation: "hasIncoming" | "readIncomingPage",
  input: Readonly<{
    readonly scopeId: unknown;
    readonly definition: AppRelationEdgeDefinitionPin;
    readonly targetRowId: unknown;
  }>,
): Result.Result<
  Readonly<{
    scopeUuid: ScopeUuidV1;
    definition: PreparedDefinitionPin;
    targetRowId: AppRowIdHexV1;
  }>,
  AppRelationEdgeInputError | AppRelationEdgeCorruptionError
> {
  return Result.gen(function* () {
    const scopeId = yield* mapInputResult(
      operation,
      decodeScopeIdResult(input.scopeId),
      "invalidScope",
    );
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) => new AppRelationEdgeCorruptionError({
        operation,
        reason: "scope ID cannot project to target-local UUID",
        cause,
      })),
    );
    const definition = yield* prepareDefinitionPinResult(
      operation,
      input.definition,
    );
    const targetRowId = yield* mapInputResult(
      operation,
      decodeRowIdResult(input.targetRowId),
      "invalidOccurrence",
    );
    return Object.freeze({
      scopeUuid: scopeProjection.scopeUuid,
      definition,
      targetRowId,
    });
  });
}

const readCurrentEdgesForActionsEffect = Effect.fn(
  "AppRelationEdges.readCurrentBatch",
)(function* (
  tx: FlarexMetadataTransaction,
  scopeUuid: ScopeUuidV1,
  actions: ReadonlyArray<PreparedEdgeAction>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<
  CurrentEdgeSnapshot,
  AppRelationEdgeCorruptionError | AppRelationEdgePersistenceError
> {
  const byIdentity = new Map<string, StoredAppRelationEdge>();
  const byDigest = new Map<string, StoredAppRelationEdge>();
  for (
    let offset = 0;
    offset < actions.length;
    offset += MAXIMUM_MATCH_PREDICATES_PER_STATEMENT
  ) {
    const batch = actions.slice(
      offset,
      offset + MAXIMUM_MATCH_PREDICATES_PER_STATEMENT,
    );
    observeMutationStatement(options, "readCurrentBatch");
    const rows = yield* runQueryEffect(
      "readCurrentBatch",
      tx.select().from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, scopeUuid),
        or(...batch.map(actionCurrentMatchPredicate)),
      )).for("update"),
    );
    for (const row of rows) {
      const decoded = yield* Effect.fromResult(
        decodeStoredAppRelationEdgeResult("applyChanges", row),
      );
      byIdentity.set(storedIdentityKey(decoded), decoded);
      byDigest.set(storedDigestKey(decoded), decoded);
    }
  }
  return Object.freeze({ byIdentity, byDigest });
});

const readAffectedAdjacencyVersionsEffect = Effect.fn(
  "AppRelationEdges.readAffectedVersions",
)(function* (
  tx: FlarexMetadataTransaction,
  scopeUuid: ScopeUuidV1,
  endpoints: ReadonlyArray<AffectedEndpoint>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<
  AdjacencyVersionSnapshot,
  AppRelationEdgeCorruptionError | AppRelationEdgePersistenceError
> {
  const byEndpoint = new Map<string, CommitSeq>();
  for (
    let offset = 0;
    offset < endpoints.length;
    offset += MAXIMUM_MATCH_PREDICATES_PER_STATEMENT
  ) {
    const batch = endpoints.slice(
      offset,
      offset + MAXIMUM_MATCH_PREDICATES_PER_STATEMENT,
    );
    observeMutationStatement(options, "readAffectedVersions");
    const rows = yield* runQueryEffect(
      "readAffectedVersions",
      tx.select({
        edgeDefinitionId: fxAppEdgeAdjacencyVersions.edgeDefinitionId,
        direction: fxAppEdgeAdjacencyVersions.direction,
        endpointRowId: fxAppEdgeAdjacencyVersions.endpointRowId,
        lastChangedCommitSeq:
          fxAppEdgeAdjacencyVersions.lastChangedCommitSeq,
      }).from(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, scopeUuid),
        or(...batch.map(endpointPredicate)),
      )).for("update"),
    );
    for (const row of rows) {
      const edgeDefinitionId = yield* decodeStoredFieldEffect(
        decodeEdgeDefinitionIdResult(row.edgeDefinitionId),
        "adjacency-version edge-definition ID is invalid",
      );
      if (row.direction !== "incoming" && row.direction !== "outgoing") {
        return yield* Effect.fail(new AppRelationEdgeCorruptionError({
          operation: "applyChanges",
          reason: "adjacency-version direction is invalid",
        }));
      }
      const endpointRowId = yield* decodeStoredFieldEffect(
        appRowIdHexV1FromBytesResult(row.endpointRowId),
        "adjacency-version endpoint row ID is invalid",
      );
      const lastChangedCommitSeq = yield* Effect.fromResult(
        decodeStoredAdjacencyVersionResult(
          "readAdjacencyVersion",
          row.lastChangedCommitSeq,
        ).pipe(Result.mapError((error) =>
          new AppRelationEdgeCorruptionError({
            operation: "applyChanges",
            reason: error.reason,
            cause: error,
          })
        )),
      );
      const endpoint = Object.freeze({
        edgeDefinitionId,
        direction: row.direction,
        endpointRowId,
      });
      byEndpoint.set(endpointKey(endpoint), lastChangedCommitSeq);
    }
  }
  return Object.freeze({ byEndpoint });
});

const validatePreparedActionsEffect = Effect.fn(
  "AppRelationEdges.validatePreparedActions",
)(function* (
  context: MutationContext,
  actions: ReadonlyArray<PreparedEdgeAction>,
  snapshot: CurrentEdgeSnapshot,
  endpoints: ReadonlyArray<AffectedEndpoint>,
  versions: AdjacencyVersionSnapshot,
): Effect.fn.Return<void, AppRelationEdgeMutationError> {
  for (const endpoint of endpoints) {
    const storedVersion = versions.byEndpoint.get(endpointKey(endpoint)) ??
      ABSENT_ADJACENCY_VERSION;
    if (storedVersion > context.commitSeq) {
      return yield* Effect.fail(new AppRelationEdgeConflictError({
        operation: "applyChanges",
        reason: "staleAdjacencyVersion",
        edgeDefinitionId: endpoint.edgeDefinitionId,
      }));
    }
  }
  const batchDigests = new Map<string, PreparedEdgeAction>();
  for (const action of actions) {
    const digestKey = actionDigestKey(action);
    const priorDigest = Option.fromUndefinedOr(batchDigests.get(digestKey));
    if (Option.isSome(priorDigest)) {
      if (
        bytesEqual(
          priorDigest.value.occurrence.canonicalBytes,
          action.occurrence.canonicalBytes,
        )
      ) {
        return yield* Effect.fail(new AppRelationEdgeCorruptionError({
          operation: "applyChanges",
          reason: "equal batch occurrence evidence resolves to different identities",
        }));
      }
      return yield* Effect.fail(new AppRelationEdgeOccurrenceCollisionError({
        operation: "applyChanges",
        edgeDefinitionId: action.definition.edgeDefinitionId,
      }));
    }
    batchDigests.set(digestKey, action);

    const existingIdentity = Option.fromUndefinedOr(
      snapshot.byIdentity.get(actionIdentityKey(action)),
    );
    if (action.kind === "put") {
      if (Option.isSome(existingIdentity)) {
        yield* verifyStoredEdgeEffect(existingIdentity.value, action);
        return yield* Effect.fail(new AppRelationEdgeConflictError({
          operation: "applyChanges",
          reason: "duplicateOccurrence",
          edgeDefinitionId: action.definition.edgeDefinitionId,
        }));
      }
      const existingDigest = Option.fromUndefinedOr(
        snapshot.byDigest.get(digestKey),
      );
      if (Option.isSome(existingDigest)) {
        if (
          !bytesEqual(
            existingDigest.value.occurrenceBytes,
            action.occurrence.canonicalBytes,
          )
        ) {
          return yield* Effect.fail(
            new AppRelationEdgeOccurrenceCollisionError({
              operation: "applyChanges",
              edgeDefinitionId: action.definition.edgeDefinitionId,
            }),
          );
        }
        return yield* Effect.fail(new AppRelationEdgeCorruptionError({
          operation: "applyChanges",
          reason: "equal occurrence evidence resolves to different identities",
        }));
      }
      continue;
    }
    if (Option.isNone(existingIdentity)) {
      return yield* Effect.fail(new AppRelationEdgeConflictError({
        operation: "applyChanges",
        reason: "missingOccurrence",
        edgeDefinitionId: action.definition.edgeDefinitionId,
      }));
    }
    yield* ensureMutationDoesNotRegressEffect(
      existingIdentity.value,
      context,
      action,
    );
    yield* verifyStoredEdgeEffect(existingIdentity.value, action);
  }
});

const applyPreparedMutationWithinSavepointEffect = Effect.fn(
  "AppRelationEdges.applyPreparedMutationWithinSavepoint",
)(function* (
  tx: FlarexMetadataTransaction,
  prepared: PreparedMutationInput,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<ApplyAppRelationEdgeChangesResult, AppRelationEdgeMutationError> {
  observeMutationStatement(options, "createMutationSavepoint");
  yield* runStatementEffect(
    "createMutationSavepoint",
    tx.execute(sql.raw(`savepoint ${MUTATION_SAVEPOINT}`)),
  );
  const outcome = yield* Effect.result(
    applyPreparedMutationEffect(tx, prepared, options),
  );
  return yield* Result.match(outcome, {
    onFailure: (failure) => failAfterSavepointCleanupEffect(
      tx,
      options,
      failure,
    ),
    onSuccess: (result) => Effect.result(
      releaseMutationSavepointEffect(tx, options),
    ).pipe(Effect.flatMap(Result.match({
      onFailure: (failure) => failAfterSavepointCleanupEffect(
        tx,
        options,
        failure,
      ),
      onSuccess: () => Effect.succeed(result),
    }))),
  });
});

const failAfterSavepointCleanupEffect = Effect.fn(
  "AppRelationEdges.failAfterSavepointCleanup",
)(function* <Failure>(
  tx: FlarexMetadataTransaction,
  options: AppRelationEdgeMutationOptions,
  failure: Failure,
): Effect.fn.Return<never, Failure | AppRelationEdgePersistenceError> {
  const cleanup = yield* Effect.exit(
    rollbackMutationSavepointEffect(tx, options),
  );
  if (Exit.isSuccess(cleanup)) return yield* Effect.fail(failure);
  return yield* Effect.failCause(Cause.combine(
    Cause.fail(failure),
    cleanup.cause,
  ));
});

const applyPreparedChangesEffect = Effect.fn(
  "AppRelationEdges.applyPreparedChanges",
)(function* (
  tx: FlarexMetadataTransaction,
  context: MutationContext,
  actions: ReadonlyArray<PreparedEdgeAction>,
  endpoints: ReadonlyArray<AffectedEndpoint>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<ApplyAppRelationEdgeChangesResult, AppRelationEdgeMutationError> {
  const puts = actions.filter((action) => action.kind === "put");
  const removes = actions.filter((action) => action.kind === "remove");
  const reorders = actions.filter((action) => action.kind === "reorder");
  yield* deleteCurrentEdgesEffect(tx, context, removes, options);
  yield* insertCurrentEdgesEffect(tx, context, puts, options);
  yield* reorderCurrentEdgesEffect(tx, context, reorders, options);
  yield* advanceAdjacencyVersionsEffect(tx, context, endpoints, options);
  return Object.freeze({
    putCount: puts.length,
    removeCount: removes.length,
    reorderCount: reorders.length,
    advancedEndpointCount: endpoints.length,
  });
});

const insertCurrentEdgesEffect = Effect.fn(
  "AppRelationEdges.insertCurrentBatch",
)(function* (
  tx: FlarexMetadataTransaction,
  context: MutationContext,
  actions: ReadonlyArray<PreparedEdgeAction>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<
  void,
  AppRelationEdgeCorruptionError | AppRelationEdgePersistenceError
> {
  for (
    let offset = 0;
    offset < actions.length;
    offset += MAXIMUM_MUTATION_ROWS_PER_STATEMENT
  ) {
    const batch = actions.slice(
      offset,
      offset + MAXIMUM_MUTATION_ROWS_PER_STATEMENT,
    );
    observeMutationStatement(options, "insertCurrent");
    const rows = yield* runQueryEffect(
      "insertCurrent",
      tx.insert(fxAppEdgeCurrent).values(
        batch.map((action) => currentEdgeValues(context, action)),
      ).returning({ edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId }),
    );
    if (rows.length !== batch.length) {
      return yield* Effect.fail(new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "current-edge batch insert returned an unexpected row count",
      }));
    }
  }
});

const deleteCurrentEdgesEffect = Effect.fn(
  "AppRelationEdges.deleteCurrentBatch",
)(function* (
  tx: FlarexMetadataTransaction,
  context: MutationContext,
  actions: ReadonlyArray<PreparedEdgeAction>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<
  void,
  AppRelationEdgeConflictError | AppRelationEdgePersistenceError
> {
  for (
    let offset = 0;
    offset < actions.length;
    offset += MAXIMUM_MATCH_PREDICATES_PER_STATEMENT
  ) {
    const batch = actions.slice(
      offset,
      offset + MAXIMUM_MATCH_PREDICATES_PER_STATEMENT,
    );
    observeMutationStatement(options, "deleteCurrent");
    const rows = yield* runQueryEffect(
      "deleteCurrent",
      tx.delete(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, context.scopeUuid),
        or(...batch.map(unscopedIdentityPredicate)),
      )).returning({ edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId }),
    );
    if (rows.length !== batch.length) {
      const first = batch[0];
      if (first === undefined) return;
      return yield* Effect.fail(new AppRelationEdgeConflictError({
        operation: "applyChanges",
        reason: "staleOccurrence",
        edgeDefinitionId: first.definition.edgeDefinitionId,
      }));
    }
  }
});

const reorderCurrentEdgesEffect = Effect.fn(
  "AppRelationEdges.reorderCurrentBatch",
)(function* (
  tx: FlarexMetadataTransaction,
  context: MutationContext,
  actions: ReadonlyArray<PreparedEdgeAction>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<
  void,
  | AppRelationEdgeConflictError
  | AppRelationEdgeCorruptionError
  | AppRelationEdgePersistenceError
> {
  for (
    let offset = 0;
    offset < actions.length;
    offset += MAXIMUM_MUTATION_ROWS_PER_STATEMENT
  ) {
    const batch = actions.slice(
      offset,
      offset + MAXIMUM_MUTATION_ROWS_PER_STATEMENT,
    );
    const values = sql.join(batch.map((action) => sql`(
      ${action.definition.edgeDefinitionId}::integer,
      ${appRowIdHexV1ToBytes(action.source.rowId)}::bytea,
      ${appRowIdHexV1ToBytes(action.target.rowId)}::bytea,
      ${action.occurrence.occurrence.duplicateOrdinal}::integer,
      ${action.position}::integer
    )`), sql`, `);
    observeMutationStatement(options, "updateCurrent");
    const rows = yield* runRawMutationRowsEffect(
      "updateCurrent",
      tx.execute(sql`
        update fx_app_edge_current as current_edge
        set
          position = changes.position,
          schema_version_id = ${context.schemaVersionId}::text,
          write_epoch_uuid = ${context.writeEpochUuid}::uuid,
          commit_seq = ${context.commitSeq}::bigint
        from (values ${values}) as changes(
          edge_definition_id,
          source_row_id,
          target_row_id,
          duplicate_ordinal,
          position
        )
        where current_edge.scope_uuid = ${context.scopeUuid}::uuid
          and current_edge.edge_definition_id = changes.edge_definition_id
          and current_edge.source_row_id = changes.source_row_id
          and current_edge.target_row_id = changes.target_row_id
          and current_edge.duplicate_ordinal = changes.duplicate_ordinal
        returning current_edge.edge_definition_id
      `),
    );
    if (rows.length !== batch.length) {
      const first = batch[0];
      if (first === undefined) return;
      return yield* Effect.fail(new AppRelationEdgeConflictError({
        operation: "applyChanges",
        reason: "staleOccurrence",
        edgeDefinitionId: first.definition.edgeDefinitionId,
      }));
    }
  }
});

const verifyStoredEdgeEffect = Effect.fn("AppRelationEdges.verifyStoredEdge")(
  function* (
    stored: StoredAppRelationEdge,
    action: PreparedEdgeAction,
  ): Effect.fn.Return<
    void,
    | AppRelationEdgeConflictError
    | AppRelationEdgeOccurrenceCollisionError
    | AppRelationEdgeCorruptionError
  > {
    if (
      stored.relationId !== action.definition.relationId ||
      stored.edgeDefinitionId !== action.definition.edgeDefinitionId ||
      stored.sourceTableId !== action.definition.physical.sourceTableId ||
      stored.targetTableId !== action.definition.physical.targetTableId ||
      stored.sourceRowId !== action.source.rowId ||
      stored.targetRowId !== action.target.rowId
    ) {
      return yield* Effect.fail(new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "current edge disagrees with its immutable definition pins",
      }));
    }
    if (!positionMatchesDefinition(stored.position, action.definition.physical)) {
      return yield* Effect.fail(new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "current edge position disagrees with its physical definition",
      }));
    }
    const bytesMatch = bytesEqual(
      stored.occurrenceBytes,
      action.occurrence.canonicalBytes,
    );
    const digestMatches = bytesEqual(
      stored.occurrenceSha256,
      action.occurrence.sha256,
    );
    if (digestMatches && !bytesMatch) {
      return yield* Effect.fail(new AppRelationEdgeOccurrenceCollisionError({
        operation: "applyChanges",
        edgeDefinitionId: action.definition.edgeDefinitionId,
      }));
    }
    if (bytesMatch && !digestMatches) {
      return yield* Effect.fail(new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "canonical occurrence bytes have an inconsistent digest",
      }));
    }
    if (!bytesMatch && !digestMatches) {
      return yield* Effect.fail(new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "canonical occurrence bytes and digest disagree with stored evidence",
      }));
    }
  },
);

const ensureMutationDoesNotRegressEffect = Effect.fn(
  "AppRelationEdges.ensureMutationDoesNotRegress",
)(function* (
  stored: StoredAppRelationEdge,
  context: MutationContext,
  action: PreparedEdgeAction,
): Effect.fn.Return<void, AppRelationEdgeConflictError> {
  if (context.commitSeq < stored.commitSeq) {
    return yield* Effect.fail(new AppRelationEdgeConflictError({
      operation: "applyChanges",
      reason: "staleOccurrence",
      edgeDefinitionId: action.definition.edgeDefinitionId,
    }));
  }
});

const advanceAdjacencyVersionsEffect = Effect.fn(
  "AppRelationEdges.advanceAdjacencyVersions",
)(function* (
  tx: FlarexMetadataTransaction,
  context: MutationContext,
  endpoints: ReadonlyArray<AffectedEndpoint>,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<void, AppRelationEdgePersistenceError> {
  if (endpoints.length === 0) return;
  for (
    let offset = 0;
    offset < endpoints.length;
    offset += MAXIMUM_MUTATION_ROWS_PER_STATEMENT
  ) {
    const batch = endpoints.slice(
      offset,
      offset + MAXIMUM_MUTATION_ROWS_PER_STATEMENT,
    );
    observeMutationStatement(options, "advanceAdjacencyVersions");
    yield* runStatementEffect(
      "advanceAdjacencyVersions",
      tx.insert(fxAppEdgeAdjacencyVersions).values(batch.map((endpoint) => ({
        scopeUuid: context.scopeUuid,
        edgeDefinitionId: endpoint.edgeDefinitionId,
        direction: endpoint.direction,
        endpointRowId: appRowIdHexV1ToBytes(endpoint.endpointRowId),
        lastChangedCommitSeq: context.commitSeq,
      }))).onConflictDoUpdate({
        target: [
          fxAppEdgeAdjacencyVersions.scopeUuid,
          fxAppEdgeAdjacencyVersions.edgeDefinitionId,
          fxAppEdgeAdjacencyVersions.direction,
          fxAppEdgeAdjacencyVersions.endpointRowId,
        ],
        set: {
          lastChangedCommitSeq: sql`greatest(
            ${fxAppEdgeAdjacencyVersions.lastChangedCommitSeq},
            excluded.last_changed_commit_seq
          )`,
        },
      }),
    );
  }
});

const readAdjacencyVersionEffect = Effect.fn(
  "AppRelationEdges.readAdjacencyVersion",
)(function* (
  tx: FlarexMetadataTransaction,
  scopeUuid: ScopeUuidV1,
  edgeDefinitionId: CatalogEdgeDefinitionId,
  direction: AppRelationEdgeAdjacencyDirection,
  endpointRowId: AppRowIdHexV1,
  ownerOperation: "readAdjacencyVersion" | "readIncomingPage",
): Effect.fn.Return<
  CommitSeq,
  AppRelationEdgeCorruptionError | AppRelationEdgePersistenceError
> {
  const rows = yield* runQueryEffect(
    "readAdjacencyVersion",
    tx.select({
      lastChangedCommitSeq:
        fxAppEdgeAdjacencyVersions.lastChangedCommitSeq,
    }).from(fxAppEdgeAdjacencyVersions).where(and(
      eq(fxAppEdgeAdjacencyVersions.scopeUuid, scopeUuid),
      eq(fxAppEdgeAdjacencyVersions.edgeDefinitionId, edgeDefinitionId),
      eq(fxAppEdgeAdjacencyVersions.direction, direction),
      eq(
        fxAppEdgeAdjacencyVersions.endpointRowId,
        appRowIdHexV1ToBytes(endpointRowId),
      ),
    )).limit(1),
  );
  const row = rows[0];
  return row === undefined
    ? ABSENT_ADJACENCY_VERSION
    : yield* Effect.fromResult(decodeStoredAdjacencyVersionResult(
      ownerOperation,
      row.lastChangedCommitSeq,
    ));
});

function currentEdgeValues(
  context: MutationContext,
  action: PreparedEdgeAction,
): typeof fxAppEdgeCurrent.$inferInsert {
  return {
    scopeUuid: context.scopeUuid,
    relationId: action.definition.relationId,
    edgeDefinitionId: action.definition.edgeDefinitionId,
    sourceTableId: action.definition.physical.sourceTableId,
    sourceRowId: appRowIdHexV1ToBytes(action.source.rowId),
    targetTableId: action.definition.physical.targetTableId,
    targetRowId: appRowIdHexV1ToBytes(action.target.rowId),
    duplicateOrdinal: action.occurrence.occurrence.duplicateOrdinal,
    occurrenceCodecVersion: action.occurrence.occurrence.version,
    occurrenceBytes: copyBytes(action.occurrence.canonicalBytes),
    occurrenceSha256: copyBytes(action.occurrence.sha256),
    locale: null,
    position: action.position,
    schemaVersionId: context.schemaVersionId,
    writeEpochUuid: context.writeEpochUuid,
    commitSeq: context.commitSeq,
  };
}

function unscopedIdentityPredicate(
  action: PreparedEdgeAction,
): SQL {
  return sql`(
    ${fxAppEdgeCurrent.edgeDefinitionId} = ${action.definition.edgeDefinitionId}
    and ${fxAppEdgeCurrent.sourceRowId} = ${appRowIdHexV1ToBytes(action.source.rowId)}
    and ${fxAppEdgeCurrent.targetRowId} = ${appRowIdHexV1ToBytes(action.target.rowId)}
    and ${fxAppEdgeCurrent.duplicateOrdinal} = ${action.occurrence.occurrence.duplicateOrdinal}
  )`;
}

function actionCurrentMatchPredicate(action: PreparedEdgeAction): SQL {
  const identity = unscopedIdentityPredicate(action);
  return action.kind === "put"
    ? sql`(
        ${identity}
        or (
          ${fxAppEdgeCurrent.edgeDefinitionId} = ${action.definition.edgeDefinitionId}
          and ${fxAppEdgeCurrent.occurrenceSha256} = ${action.occurrence.sha256}
        )
      )`
    : identity;
}

function endpointPredicate(endpoint: AffectedEndpoint): SQL {
  return sql`(
    ${fxAppEdgeAdjacencyVersions.edgeDefinitionId} = ${endpoint.edgeDefinitionId}
    and ${fxAppEdgeAdjacencyVersions.direction} = ${endpoint.direction}
    and ${fxAppEdgeAdjacencyVersions.endpointRowId} = ${
      appRowIdHexV1ToBytes(endpoint.endpointRowId)
    }
  )`;
}

function affectedEndpoints(
  actions: ReadonlyArray<PreparedEdgeAction>,
): ReadonlyArray<AffectedEndpoint> {
  const endpoints = new Map<string, AffectedEndpoint>();
  for (const action of actions) addAffectedEndpoints(endpoints, action);
  return Object.freeze([...endpoints.values()]);
}

function addAffectedEndpoints(
  endpoints: Map<string, AffectedEndpoint>,
  action: PreparedEdgeAction,
): void {
  const outgoing = Object.freeze({
    edgeDefinitionId: action.definition.edgeDefinitionId,
    direction: "outgoing" as const,
    endpointRowId: action.source.rowId,
  });
  const incoming = Object.freeze({
    edgeDefinitionId: action.definition.edgeDefinitionId,
    direction: "incoming" as const,
    endpointRowId: action.target.rowId,
  });
  endpoints.set(endpointKey(outgoing), outgoing);
  endpoints.set(endpointKey(incoming), incoming);
}

function endpointKey(endpoint: AffectedEndpoint): string {
  return `${endpoint.edgeDefinitionId}:${endpoint.direction}:${endpoint.endpointRowId}`;
}

function actionIdentityKey(action: PreparedEdgeAction): string {
  return `${action.definition.edgeDefinitionId}:${action.source.rowId}:${action.target.rowId}:${action.occurrence.occurrence.duplicateOrdinal}`;
}

function storedIdentityKey(edge: StoredAppRelationEdge): string {
  return `${edge.edgeDefinitionId}:${edge.sourceRowId}:${edge.targetRowId}:${edge.duplicateOrdinal}`;
}

function actionDigestKey(action: PreparedEdgeAction): string {
  return `${action.definition.edgeDefinitionId}:${encodeBytesToLowercaseHex(
    action.occurrence.sha256,
  )}`;
}

function storedDigestKey(edge: StoredAppRelationEdge): string {
  return `${edge.edgeDefinitionId}:${encodeBytesToLowercaseHex(
    edge.occurrenceSha256,
  )}`;
}

function sourcePathsEqual(
  left: PhysicalEdgeDefinitionV1["sourcePath"],
  right: PhysicalEdgeDefinitionV1["sourcePath"],
): boolean {
  return left.length === right.length && left.every((segment, index) => {
    const other = right[index];
    return other !== undefined && segment.kind === other.kind &&
      segment.name === other.name;
  });
}

function positionMatchesDefinition(
  position: AppRelationEdgePosition,
  definition: PhysicalEdgeDefinitionV1,
): boolean {
  return definition.sourceValueExtraction === "scalar"
    ? position === null
    : typeof position === "number" && Number.isInteger(position) &&
      position >= 0 && position < MAX_RELATION_MANY_ITEMS_V1;
}

function mapScopeClockError(
  error: LockScopeClockForUpdateError,
): AppRelationEdgeInputError | AppRelationEdgeCorruptionError |
  AppRelationEdgePersistenceError {
  switch (error._tag) {
    case "ScopeClockNotFoundError":
      return new AppRelationEdgeInputError({
        operation: "applyChanges",
        reason: "invalidScope",
        cause: error,
      });
    case "ScopeClockCorruptionError":
      return new AppRelationEdgeCorruptionError({
        operation: "applyChanges",
        reason: "scope clock is invalid",
        cause: error,
      });
    case "ScopeAuthorizationRevocationEpochPersistenceError":
      return new AppRelationEdgePersistenceError({
        operation: "lockScopeClock",
        cause: error.cause,
      });
  }
}

function mapOccurrenceCanonicalizationError(
  error: RelationOccurrenceV1Error | RelationOccurrenceSha256Error,
): AppRelationEdgeInputError | AppRelationEdgeEvidenceError {
  return error._tag === "RelationOccurrenceV1Error"
    ? new AppRelationEdgeInputError({
      operation: "applyChanges",
      reason: "invalidOccurrence",
      cause: error,
    })
    : new AppRelationEdgeEvidenceError({
      operation: "applyChanges",
      cause: error,
    });
}

function runQueryEffect<Row>(
  operation: AppRelationEdgePersistenceOperation,
  query: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, AppRelationEdgePersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppRelationEdgePersistenceError({
      operation,
      cause,
    }),
  }));
}

function runStatementEffect(
  operation: AppRelationEdgePersistenceOperation,
  query: PromiseLike<unknown>,
): Effect.Effect<void, AppRelationEdgePersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppRelationEdgePersistenceError({
      operation,
      cause,
    }),
  })).pipe(Effect.asVoid);
}

const runRawMutationRowsEffect = Effect.fn(
  "AppRelationEdges.runRawMutationRows",
)(function* (
  operation: AppRelationEdgePersistenceOperation,
  query: PromiseLike<unknown>,
): Effect.fn.Return<
  ReadonlyArray<unknown>,
  AppRelationEdgeCorruptionError | AppRelationEdgePersistenceError
> {
    const result = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => query,
      catch: (cause) => new AppRelationEdgePersistenceError({
        operation,
        cause,
      }),
    }));
    return yield* Effect.try({
      try: () => rowsFromDriverExecuteResult(result, () => {
        throw new AppRelationEdgeCorruptionError({
          operation: "applyChanges",
          reason: "driver mutation result has no rows",
        });
      }),
      catch: (cause) =>
        cause instanceof AppRelationEdgeCorruptionError
          ? cause
          : new AppRelationEdgePersistenceError({ operation, cause }),
    });
});

const rollbackMutationSavepointEffect = Effect.fn(
  "AppRelationEdges.rollbackMutationSavepoint",
)(function* (
  tx: FlarexMetadataTransaction,
  options: AppRelationEdgeMutationOptions,
): Effect.fn.Return<void, AppRelationEdgePersistenceError> {
    observeMutationStatement(options, "rollbackMutationSavepoint");
    yield* runStatementEffect(
      "rollbackMutationSavepoint",
      tx.execute(sql.raw(`rollback to savepoint ${MUTATION_SAVEPOINT}`)),
    );
    yield* releaseMutationSavepointEffect(tx, options);
});

function releaseMutationSavepointEffect(
  tx: FlarexMetadataTransaction,
  options: AppRelationEdgeMutationOptions,
): Effect.Effect<void, AppRelationEdgePersistenceError> {
  observeMutationStatement(options, "releaseMutationSavepoint");
  return runStatementEffect(
    "releaseMutationSavepoint",
    tx.execute(sql.raw(`release savepoint ${MUTATION_SAVEPOINT}`)),
  );
}

function observeMutationStatement(
  options: AppRelationEdgeMutationOptions,
  statement: AppRelationEdgeMutationStatementName,
): void {
  options.observeStatement?.(statement);
}

function decodeInputEffect<Value, Error>(
  operation: AppRelationEdgeOperation,
  result: Result.Result<Value, Error>,
  reason: AppRelationEdgeInputError["reason"],
): Effect.Effect<Value, AppRelationEdgeInputError> {
  return Effect.fromResult(mapInputResult(operation, result, reason));
}

function decodeStoredFieldEffect<Value, Error>(
  result: Result.Result<Value, Error>,
  reason: string,
): Effect.Effect<Value, AppRelationEdgeCorruptionError> {
  return Effect.fromResult(result.pipe(Result.mapError((cause) =>
    new AppRelationEdgeCorruptionError({
      operation: "applyChanges",
      reason,
      cause,
    })
  )));
}

function mapInputResult<Value, Error>(
  operation: AppRelationEdgeOperation,
  result: Result.Result<Value, Error>,
  reason: AppRelationEdgeInputError["reason"],
): Result.Result<Value, AppRelationEdgeInputError> {
  return result.pipe(Result.mapError((cause) => new AppRelationEdgeInputError({
    operation,
    reason,
    cause,
  })));
}

function invalidInput(
  operation: AppRelationEdgeOperation,
  reason: AppRelationEdgeInputError["reason"],
): Result.Result<never, AppRelationEdgeInputError> {
  return Result.fail(new AppRelationEdgeInputError({ operation, reason }));
}
