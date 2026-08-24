import {
  bytesEqualFullScan as bytesEqual,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { Effect, Result, Schema } from "effect";

import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  AppRowIdHexV1Schema,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogRelationIdSchema,
} from "flarex-protocol/catalog";
import {
  decodePhysicalEdgeDefinitionResult,
} from "flarex-protocol/internal/application-schema-binding";
import {
  canonicalizeRelationOccurrenceV1,
  RelationOccurrenceSha256,
  type RelationOccurrenceSha256Error,
  type RelationOccurrenceV1Error,
} from "flarex-protocol/internal/relation-occurrence-v1";
import {
  projectScopeIdUuidV1Result,
  ScopeIdSchema,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
} from "../schema";
import {
  type AppRelationEdgeDefinitionPin,
} from "./Model";
import {
  decodeStoredAdjacencyVersionResult,
  decodeStoredAppRelationEdgeResult,
  type StoredAppRelationEdge,
} from "./RowCodec";
import {
  APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES,
  APP_RELATION_EDGE_BUILD_MAXIMUM_PRESENCE_ENDPOINTS,
  APP_RELATION_EDGE_BUILD_MAXIMUM_VERSION_ENDPOINTS,
  APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE,
  AppRelationEdgeBuildCorruptionError,
  type AppRelationEdgeBuildError,
  AppRelationEdgeBuildEvidenceError,
  type AppRelationEdgeBuildFrontier,
  type AppRelationEdgeBuildEndpoint,
  AppRelationEdgeBuildInputError,
  AppRelationEdgeBuildPersistenceError,
  type AppRelationEdgeBuildVersionFrontier,
  type CleanAppRelationEdgeDefinitionPageInput,
  type CleanAppRelationEdgeDefinitionPageResult,
  type HasAppRelationEdgeBuildEndpointInput,
  type ReadAppRelationEdgeBuildPageInput,
  type ReadAppRelationEdgeBuildPageResult,
  type ReadAppRelationEdgeBuildEndpointPresenceInput,
  type ReadAppRelationEdgeBuildEndpointPresenceResult,
  type ReadAppRelationEdgeBuildEndpointVersionsInput,
  type ReadAppRelationEdgeBuildEndpointVersionsResult,
  type ReadAppRelationEdgeBuildSourceInput,
  type ReadAppRelationEdgeBuildVersionPageInput,
  type ReadAppRelationEdgeBuildVersionPageResult,
  type StoredAppRelationEdgeBuildVersion,
  type VerifyAppRelationEdgeBuildRowInput,
} from "./BuildModel";

const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeRelationIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogRelationIdSchema),
);
const decodeEdgeDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogEdgeDefinitionIdSchema),
);
const decodeRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);

interface PreparedBuildDefinition {
  readonly scopeUuid: ScopeUuidV1;
  readonly definition: AppRelationEdgeDefinitionPin;
}

export const cleanAppRelationEdgeDefinitionPageInTransactionEffect = Effect.fn(
  "AppRelationEdges.cleanDefinitionPageInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: CleanAppRelationEdgeDefinitionPageInput,
): Effect.fn.Return<
  CleanAppRelationEdgeDefinitionPageResult,
  AppRelationEdgeBuildError
> {
  const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
    "cleanDefinition",
    input.scopeId,
    input.definition,
  ));
  const edgeKeys = yield* queryEffect(
    "selectCleanupEdges",
    tx.select({
      sourceRowId: fxAppEdgeCurrent.sourceRowId,
      targetRowId: fxAppEdgeCurrent.targetRowId,
      duplicateOrdinal: fxAppEdgeCurrent.duplicateOrdinal,
    }).from(fxAppEdgeCurrent).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
      eq(
        fxAppEdgeCurrent.edgeDefinitionId,
        prepared.definition.edgeDefinitionId,
      ),
    )).orderBy(
      asc(fxAppEdgeCurrent.sourceRowId),
      asc(fxAppEdgeCurrent.targetRowId),
      asc(fxAppEdgeCurrent.duplicateOrdinal),
    ).limit(APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE),
  );
  const deletedEdges = edgeKeys.length === 0
    ? 0
    : (yield* queryEffect(
      "deleteCleanupEdges",
      tx.delete(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
        eq(
          fxAppEdgeCurrent.edgeDefinitionId,
          prepared.definition.edgeDefinitionId,
        ),
        or(...edgeKeys.map((key) => and(
          eq(fxAppEdgeCurrent.sourceRowId, key.sourceRowId),
          eq(fxAppEdgeCurrent.targetRowId, key.targetRowId),
          eq(fxAppEdgeCurrent.duplicateOrdinal, key.duplicateOrdinal),
        ))),
      )).returning({ edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId }),
    )).length;
  const versionKeys = yield* queryEffect(
    "selectCleanupVersions",
    tx.select({
      direction: fxAppEdgeAdjacencyVersions.direction,
      endpointRowId: fxAppEdgeAdjacencyVersions.endpointRowId,
    }).from(fxAppEdgeAdjacencyVersions).where(and(
      eq(fxAppEdgeAdjacencyVersions.scopeUuid, prepared.scopeUuid),
      eq(
        fxAppEdgeAdjacencyVersions.edgeDefinitionId,
        prepared.definition.edgeDefinitionId,
      ),
    )).orderBy(
      asc(fxAppEdgeAdjacencyVersions.direction),
      asc(fxAppEdgeAdjacencyVersions.endpointRowId),
    ).limit(APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE),
  );
  const deletedVersions = versionKeys.length === 0
    ? 0
    : (yield* queryEffect(
      "deleteCleanupVersions",
      tx.delete(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, prepared.scopeUuid),
        eq(
          fxAppEdgeAdjacencyVersions.edgeDefinitionId,
          prepared.definition.edgeDefinitionId,
        ),
        or(...versionKeys.map((key) => and(
          eq(fxAppEdgeAdjacencyVersions.direction, key.direction),
          eq(fxAppEdgeAdjacencyVersions.endpointRowId, key.endpointRowId),
        ))),
      )).returning({
        edgeDefinitionId: fxAppEdgeAdjacencyVersions.edgeDefinitionId,
      }),
    )).length;
  if (
    deletedEdges !== edgeKeys.length ||
    deletedVersions !== versionKeys.length
  ) {
    return yield* Effect.fail(new AppRelationEdgeBuildCorruptionError({
      operation: "cleanDefinition",
      reason: "bounded cleanup did not delete its exact selected keys",
    }));
  }
  return Object.freeze({
    deletedEdges,
    deletedVersions,
    exhausted: edgeKeys.length === 0 && versionKeys.length === 0,
  });
});

export const readAppRelationEdgeBuildSourceInTransactionEffect = Effect.fn(
  "AppRelationEdges.readBuildSourceInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: ReadAppRelationEdgeBuildSourceInput,
): Effect.fn.Return<ReadonlyArray<StoredAppRelationEdge>, AppRelationEdgeBuildError> {
  const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
    "readSource",
    input.scopeId,
    input.definition,
  ));
  const sourceRowId = yield* Effect.fromResult(decodeRowIdResult(
    input.sourceRowId,
  ).pipe(Result.mapError((cause) => buildInput(
    "readSource",
    "invalidFrontier",
    cause,
  ))));
  const rows = yield* queryEffect(
    "readSource",
    tx.select().from(fxAppEdgeCurrent).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
      eq(
        fxAppEdgeCurrent.edgeDefinitionId,
        prepared.definition.edgeDefinitionId,
      ),
      eq(fxAppEdgeCurrent.sourceRowId, appRowIdHexV1ToBytes(sourceRowId)),
    )).orderBy(
      asc(fxAppEdgeCurrent.targetRowId),
      asc(fxAppEdgeCurrent.duplicateOrdinal),
    ).limit(APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES + 1),
  );
  if (rows.length > APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES) {
    return yield* Effect.fail(new AppRelationEdgeBuildCorruptionError({
      operation: "readSource",
      reason: "one source exceeds the admitted occurrence maximum",
    }));
  }
  return yield* decodeEdges("readSource", rows);
});

export const readAppRelationEdgeBuildPageInTransactionEffect = Effect.fn(
  "AppRelationEdges.readBuildPageInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: ReadAppRelationEdgeBuildPageInput,
): Effect.fn.Return<ReadAppRelationEdgeBuildPageResult, AppRelationEdgeBuildError> {
  const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
    "readEdges",
    input.scopeId,
    input.definition,
  ));
  const after = yield* Effect.fromResult(prepareEdgeFrontierResult(input.after));
  const rows = yield* queryEffect(
    "readEdges",
    tx.select().from(fxAppEdgeCurrent).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
      eq(
        fxAppEdgeCurrent.edgeDefinitionId,
        prepared.definition.edgeDefinitionId,
      ),
      ...(after === null ? [] : [or(
        gt(fxAppEdgeCurrent.sourceRowId, appRowIdHexV1ToBytes(
          after.sourceRowId,
        )),
        and(
          eq(fxAppEdgeCurrent.sourceRowId, appRowIdHexV1ToBytes(
            after.sourceRowId,
          )),
          gt(fxAppEdgeCurrent.targetRowId, appRowIdHexV1ToBytes(
            after.targetRowId,
          )),
        ),
      )]),
    )).orderBy(
      asc(fxAppEdgeCurrent.sourceRowId),
      asc(fxAppEdgeCurrent.targetRowId),
      asc(fxAppEdgeCurrent.duplicateOrdinal),
    ).limit(APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE),
  );
  const decoded = yield* decodeEdges("readEdges", rows);
  const page = decoded;
  const last = page.at(-1);
  const exhausted = rows.length < APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE;
  return Object.freeze({
    edges: Object.freeze(page),
    nextFrontier: last === undefined || exhausted
      ? null
      : Object.freeze({
        sourceRowId: last.sourceRowId,
        targetRowId: last.targetRowId,
      }),
    exhausted,
  });
});

export const readAppRelationEdgeBuildVersionPageInTransactionEffect = Effect.fn(
  "AppRelationEdges.readBuildVersionPageInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: ReadAppRelationEdgeBuildVersionPageInput,
): Effect.fn.Return<
  ReadAppRelationEdgeBuildVersionPageResult,
  AppRelationEdgeBuildError
> {
  const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
    "readVersions",
    input.scopeId,
    input.definition,
  ));
  const after = yield* Effect.fromResult(
    prepareVersionFrontierResult(input.after),
  );
  const rows = yield* queryEffect(
    "readVersions",
    tx.select({
      direction: fxAppEdgeAdjacencyVersions.direction,
      endpointRowId: fxAppEdgeAdjacencyVersions.endpointRowId,
      lastChangedCommitSeq:
        fxAppEdgeAdjacencyVersions.lastChangedCommitSeq,
    }).from(fxAppEdgeAdjacencyVersions).where(and(
      eq(fxAppEdgeAdjacencyVersions.scopeUuid, prepared.scopeUuid),
      eq(
        fxAppEdgeAdjacencyVersions.edgeDefinitionId,
        prepared.definition.edgeDefinitionId,
      ),
      ...(after === null ? [] : [or(
        gt(fxAppEdgeAdjacencyVersions.direction, after.direction),
        and(
          eq(fxAppEdgeAdjacencyVersions.direction, after.direction),
          gt(
            fxAppEdgeAdjacencyVersions.endpointRowId,
            appRowIdHexV1ToBytes(after.endpointRowId),
          ),
        ),
      )]),
    )).orderBy(
      asc(fxAppEdgeAdjacencyVersions.direction),
      asc(fxAppEdgeAdjacencyVersions.endpointRowId),
    ).limit(APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE),
  );
  const decoded = yield* decodeBuildVersions("readVersions", rows);
  const page = decoded;
  const last = page.at(-1);
  const exhausted = rows.length < APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE;
  return Object.freeze({
    versions: Object.freeze(page),
    nextFrontier: last === undefined || exhausted
      ? null
      : Object.freeze({
        direction: last.direction,
        endpointRowId: last.endpointRowId,
      }),
    exhausted,
  });
});

export const readAppRelationEdgeBuildEndpointVersionsInTransactionEffect =
  Effect.fn("AppRelationEdges.readBuildEndpointVersionsInTransaction")(
    function* (
      tx: FlarexMetadataTransaction,
      input: ReadAppRelationEdgeBuildEndpointVersionsInput,
    ): Effect.fn.Return<
      ReadAppRelationEdgeBuildEndpointVersionsResult,
      AppRelationEdgeBuildError
    > {
      const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
        "readEndpointVersions",
        input.scopeId,
        input.definition,
      ));
      const endpoints = yield* Effect.fromResult(prepareBuildEndpointsResult(
        "readEndpointVersions",
        input.endpoints,
        APP_RELATION_EDGE_BUILD_MAXIMUM_VERSION_ENDPOINTS,
      ));
      if (endpoints.length === 0) return Object.freeze([]);

      const incomingRowIds = endpoints
        .filter((endpoint) => endpoint.direction === "incoming")
        .map((endpoint) => appRowIdHexV1ToBytes(endpoint.endpointRowId));
      const outgoingRowIds = endpoints
        .filter((endpoint) => endpoint.direction === "outgoing")
        .map((endpoint) => appRowIdHexV1ToBytes(endpoint.endpointRowId));
      const rows = yield* queryEffect(
        "readEndpointVersions",
        tx.select({
          direction: fxAppEdgeAdjacencyVersions.direction,
          endpointRowId: fxAppEdgeAdjacencyVersions.endpointRowId,
          lastChangedCommitSeq:
            fxAppEdgeAdjacencyVersions.lastChangedCommitSeq,
        }).from(fxAppEdgeAdjacencyVersions).where(and(
          eq(fxAppEdgeAdjacencyVersions.scopeUuid, prepared.scopeUuid),
          eq(
            fxAppEdgeAdjacencyVersions.edgeDefinitionId,
            prepared.definition.edgeDefinitionId,
          ),
          or(
            ...(incomingRowIds.length === 0
              ? []
              : [and(
                eq(fxAppEdgeAdjacencyVersions.direction, "incoming"),
                inArray(
                  fxAppEdgeAdjacencyVersions.endpointRowId,
                  incomingRowIds,
                ),
              )]),
            ...(outgoingRowIds.length === 0
              ? []
              : [and(
                eq(fxAppEdgeAdjacencyVersions.direction, "outgoing"),
                inArray(
                  fxAppEdgeAdjacencyVersions.endpointRowId,
                  outgoingRowIds,
                ),
              )]),
          ),
        )),
      );
      const decoded = yield* decodeBuildVersions(
        "readEndpointVersions",
        rows,
      );
      const requestedKeys = new Set(
        endpoints.map(buildEndpointKey),
      );
      const versionByKey = new Map<
        string,
        StoredAppRelationEdgeBuildVersion
      >();
      for (const version of decoded) {
        const key = buildEndpointKey(version);
        if (!requestedKeys.has(key) || versionByKey.has(key)) {
          return yield* Effect.fail(new AppRelationEdgeBuildCorruptionError({
            operation: "readEndpointVersions",
            reason: "endpoint version query result is invalid",
          }));
        }
        versionByKey.set(key, version);
      }
      const result: StoredAppRelationEdgeBuildVersion[] = [];
      for (const endpoint of endpoints) {
        const version = versionByKey.get(buildEndpointKey(endpoint));
        if (version !== undefined) result.push(version);
      }
      return Object.freeze(result);
    },
  );

export const readAppRelationEdgeBuildEndpointPresenceInTransactionEffect =
  Effect.fn("AppRelationEdges.readBuildEndpointPresenceInTransaction")(
    function* (
      tx: FlarexMetadataTransaction,
      input: ReadAppRelationEdgeBuildEndpointPresenceInput,
    ): Effect.fn.Return<
      ReadAppRelationEdgeBuildEndpointPresenceResult,
      AppRelationEdgeBuildError
    > {
      const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
        "readEndpointPresence",
        input.scopeId,
        input.definition,
      ));
      const endpoints = yield* Effect.fromResult(prepareBuildEndpointsResult(
        "readEndpointPresence",
        input.endpoints,
        APP_RELATION_EDGE_BUILD_MAXIMUM_PRESENCE_ENDPOINTS,
      ));
      if (endpoints.length === 0) return Object.freeze([]);

      const requestValues = sql.join(
        endpoints.map((endpoint, ordinal) => sql`(
          ${ordinal}::integer,
          ${endpoint.direction}::text,
          ${appRowIdHexV1ToBytes(endpoint.endpointRowId)}::bytea
        )`),
        sql`, `,
      );
      const driverResult = yield* queryEffect(
        "readEndpointPresence",
        tx.execute(sql`
          with requested(ordinal, direction, endpoint_row_id) as (
            values ${requestValues}
          )
          select
            requested.ordinal as "ordinal",
            case requested.direction
              when 'incoming' then exists (
                select 1
                from fx_app_edge_current as current_edge
                where current_edge.scope_uuid = ${prepared.scopeUuid}::uuid
                  and current_edge.edge_definition_id =
                    ${prepared.definition.edgeDefinitionId}::integer
                  and current_edge.target_row_id = requested.endpoint_row_id
              )
              when 'outgoing' then exists (
                select 1
                from fx_app_edge_current as current_edge
                where current_edge.scope_uuid = ${prepared.scopeUuid}::uuid
                  and current_edge.edge_definition_id =
                    ${prepared.definition.edgeDefinitionId}::integer
                  and current_edge.source_row_id = requested.endpoint_row_id
              )
              else false
            end as "present"
          from requested
          order by requested.ordinal asc
        `),
      );
      const invalidDriverResult = new AppRelationEdgeBuildCorruptionError({
        operation: "readEndpointPresence",
        reason: "endpoint presence query result is invalid",
      });
      const rows = yield* Effect.try({
        try: () => rowsFromDriverExecuteResult(driverResult, () => {
          throw invalidDriverResult;
        }),
        catch: (cause) => cause === invalidDriverResult
          ? invalidDriverResult
          : new AppRelationEdgeBuildPersistenceError({
            operation: "readEndpointPresence",
            cause,
          }),
      });
      return yield* Effect.fromResult(decodeEndpointPresenceRowsResult(
        rows,
        endpoints.length,
      ));
    },
  );

export const verifyAppRelationEdgeBuildRowEffect = Effect.fn(
  "AppRelationEdges.verifyBuildRow",
)(function* (
  input: VerifyAppRelationEdgeBuildRowInput,
): Effect.fn.Return<void, AppRelationEdgeBuildError, RelationOccurrenceSha256> {
  const expected = input.expected;
  const canonical = yield* canonicalizeRelationOccurrenceV1(
    expected.occurrence,
  ).pipe(Effect.mapError(mapCanonicalEvidenceError));
  const sourceDocumentId = appDocumentIdV1FromRowIdentity({
    tableId: input.stored.sourceTableId,
    rowId: input.stored.sourceRowId,
  });
  const targetDocumentId = appDocumentIdV1FromRowIdentity({
    tableId: input.stored.targetTableId,
    rowId: input.stored.targetRowId,
  });
  if (
    input.stored.relationId !== expected.definition.relationId ||
    input.stored.edgeDefinitionId !== expected.definition.edgeDefinitionId ||
    input.stored.sourceTableId !== expected.definition.physical.sourceTableId ||
    input.stored.targetTableId !== expected.definition.physical.targetTableId ||
    sourceDocumentId !== expected.occurrence.sourceDocumentId ||
    targetDocumentId !== expected.occurrence.targetDocumentId ||
    input.stored.position !== expected.position ||
    input.stored.commitSeq !== input.frontierCommitSeq ||
    input.stored.writeEpochUuid !== input.writeEpochUuid ||
    !bytesEqual(input.stored.occurrenceBytes, canonical.canonicalBytes) ||
    !bytesEqual(input.stored.occurrenceSha256, canonical.sha256)
  ) {
    return yield* Effect.fail(new AppRelationEdgeBuildCorruptionError({
      operation: "validateEdge",
      reason: "stored edge does not equal its exact expected build evidence",
    }));
  }
});

export const hasAppRelationEdgeBuildEndpointInTransactionEffect = Effect.fn(
  "AppRelationEdges.hasBuildEndpointInTransaction",
)(function* (
  tx: FlarexMetadataTransaction,
  input: HasAppRelationEdgeBuildEndpointInput,
): Effect.fn.Return<boolean, AppRelationEdgeBuildError> {
  const prepared = yield* Effect.fromResult(prepareBuildDefinitionResult(
    "hasEndpoint",
    input.scopeId,
    input.definition,
  ));
  const endpointRowId = yield* Effect.fromResult(decodeRowIdResult(
    input.endpointRowId,
  ).pipe(Result.mapError((cause) => buildInput(
    "hasEndpoint",
    "invalidFrontier",
    cause,
  ))));
  const endpointColumn = input.direction === "incoming"
    ? fxAppEdgeCurrent.targetRowId
    : fxAppEdgeCurrent.sourceRowId;
  const rows = yield* queryEffect(
    "hasEndpoint",
    tx.select({ edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId })
      .from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, prepared.scopeUuid),
        eq(
          fxAppEdgeCurrent.edgeDefinitionId,
          prepared.definition.edgeDefinitionId,
        ),
        eq(endpointColumn, appRowIdHexV1ToBytes(endpointRowId)),
      )).limit(1),
  );
  return rows.length === 1;
});

function prepareBuildDefinitionResult(
  operation: AppRelationEdgeBuildInputError["operation"],
  scopeIdInput: unknown,
  definitionInput: AppRelationEdgeDefinitionPin,
): Result.Result<PreparedBuildDefinition, AppRelationEdgeBuildInputError> {
  return Result.gen(function* () {
    const scopeId = yield* decodeScopeIdResult(scopeIdInput).pipe(
      Result.mapError((cause) => buildInput(
        operation,
        "invalidScope",
        cause,
      )),
    );
    const projected = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) => buildInput(
        operation,
        "invalidScope",
        cause,
      )),
    );
    const relationId = yield* decodeRelationIdResult(
      definitionInput.relationId,
    ).pipe(Result.mapError((cause) => buildInput(
      operation,
      "invalidDefinition",
      cause,
    )));
    const edgeDefinitionId = yield* decodeEdgeDefinitionIdResult(
      definitionInput.edgeDefinitionId,
    ).pipe(Result.mapError((cause) => buildInput(
      operation,
      "invalidDefinition",
      cause,
    )));
    const physical = yield* decodePhysicalEdgeDefinitionResult(
      definitionInput.physical,
    ).pipe(Result.mapError((cause) => buildInput(
      operation,
      "invalidDefinition",
      cause,
    )));
    return Object.freeze({
      scopeUuid: projected.scopeUuid,
      definition: Object.freeze({ relationId, edgeDefinitionId, physical }),
    });
  });
}

function prepareEdgeFrontierResult(
  input: AppRelationEdgeBuildFrontier | null,
): Result.Result<
  AppRelationEdgeBuildFrontier | null,
  AppRelationEdgeBuildInputError
> {
  if (input === null) return Result.succeed(null);
  return Result.all({
    sourceRowId: decodeRowIdResult(input.sourceRowId),
    targetRowId: decodeRowIdResult(input.targetRowId),
  }).pipe(
    Result.map((frontier) => Object.freeze(frontier)),
    Result.mapError((cause) => buildInput(
      "readEdges",
      "invalidFrontier",
      cause,
    )),
  );
}

function prepareVersionFrontierResult(
  input: AppRelationEdgeBuildVersionFrontier | null,
): Result.Result<
  AppRelationEdgeBuildVersionFrontier | null,
  AppRelationEdgeBuildInputError
> {
  if (input === null) return Result.succeed(null);
  if (input.direction !== "incoming" && input.direction !== "outgoing") {
    return Result.fail(buildInput("readVersions", "invalidFrontier"));
  }
  return decodeRowIdResult(input.endpointRowId).pipe(
    Result.map((endpointRowId) => Object.freeze({
      direction: input.direction,
      endpointRowId,
    })),
    Result.mapError((cause) => buildInput(
      "readVersions",
      "invalidFrontier",
      cause,
    )),
  );
}

function prepareBuildEndpointsResult(
  operation: "readEndpointVersions" | "readEndpointPresence",
  input: ReadonlyArray<AppRelationEdgeBuildEndpoint>,
  maximumEndpoints: number,
): Result.Result<
  ReadonlyArray<AppRelationEdgeBuildEndpoint>,
  AppRelationEdgeBuildInputError
> {
  if (!Array.isArray(input)) {
    return Result.fail(buildInput(operation, "invalidEndpoint"));
  }
  if (input.length > maximumEndpoints) {
    return Result.fail(buildInput(operation, "tooManyEndpoints"));
  }
  return Result.gen(function* () {
    const seen = new Set<string>();
    const endpoints: AppRelationEdgeBuildEndpoint[] = [];
    for (const endpoint of input) {
      if (
        !isNonArrayRecord(endpoint) ||
        (endpoint.direction !== "incoming" &&
          endpoint.direction !== "outgoing")
      ) {
        return yield* Result.fail(buildInput(operation, "invalidEndpoint"));
      }
      const endpointRowId = yield* decodeRowIdResult(
        endpoint.endpointRowId,
      ).pipe(Result.mapError((cause) => buildInput(
        operation,
        "invalidEndpoint",
        cause,
      )));
      const prepared = Object.freeze({
        direction: endpoint.direction,
        endpointRowId,
      });
      const key = buildEndpointKey(prepared);
      if (seen.has(key)) {
        return yield* Result.fail(buildInput(operation, "duplicateEndpoint"));
      }
      seen.add(key);
      endpoints.push(prepared);
    }
    return Object.freeze(endpoints);
  });
}

function buildEndpointKey(endpoint: AppRelationEdgeBuildEndpoint): string {
  return `${endpoint.direction}:${endpoint.endpointRowId}`;
}

const decodeBuildVersions = Effect.fn(
  "AppRelationEdges.decodeBuildVersions",
)(function* (
  operation: "readVersions" | "readEndpointVersions",
  rows: ReadonlyArray<{
    readonly direction: unknown;
    readonly endpointRowId: unknown;
    readonly lastChangedCommitSeq: unknown;
  }>,
): Effect.fn.Return<
  ReadonlyArray<StoredAppRelationEdgeBuildVersion>,
  AppRelationEdgeBuildCorruptionError
> {
  const decoded: StoredAppRelationEdgeBuildVersion[] = [];
  for (const row of rows) {
    if (row.direction !== "incoming" && row.direction !== "outgoing") {
      return yield* Effect.fail(new AppRelationEdgeBuildCorruptionError({
        operation,
        reason: "stored adjacency direction is invalid",
      }));
    }
    const endpointRowId = yield* Effect.fromResult(
      appRowIdHexV1FromBytesResult(row.endpointRowId).pipe(
        Result.mapError((cause) =>
          new AppRelationEdgeBuildCorruptionError({
            operation,
            reason: "stored adjacency endpoint identity is invalid",
            cause,
          })
        ),
      ),
    );
    const lastChangedCommitSeq = yield* Effect.fromResult(
      decodeStoredAdjacencyVersionResult(
        "readAdjacencyVersion",
        row.lastChangedCommitSeq,
      ).pipe(Result.mapError((cause) =>
        new AppRelationEdgeBuildCorruptionError({
          operation,
          reason: "stored adjacency version is invalid",
          cause,
        })
      )),
    );
    decoded.push(Object.freeze({
      direction: row.direction,
      endpointRowId,
      lastChangedCommitSeq,
    }));
  }
  return Object.freeze(decoded);
});

function decodeEndpointPresenceRowsResult(
  rows: ReadonlyArray<unknown>,
  expectedCount: number,
): Result.Result<
  ReadAppRelationEdgeBuildEndpointPresenceResult,
  AppRelationEdgeBuildCorruptionError
> {
  if (rows.length !== expectedCount) {
    return Result.fail(invalidEndpointPresenceResult());
  }
  const presence: boolean[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!isNonArrayRecord(row)) {
      return Result.fail(invalidEndpointPresenceResult());
    }
    const ordinal = row.ordinal;
    const present = row.present;
    if (
      !isNonNegativeSafeInteger(ordinal) ||
      ordinal !== index ||
      typeof present !== "boolean"
    ) {
      return Result.fail(invalidEndpointPresenceResult());
    }
    presence.push(present);
  }
  return Result.succeed(Object.freeze(presence));
}

function invalidEndpointPresenceResult(): AppRelationEdgeBuildCorruptionError {
  return new AppRelationEdgeBuildCorruptionError({
    operation: "readEndpointPresence",
    reason: "endpoint presence query result is invalid",
  });
}

function decodeEdges(
  operation: "readSource" | "readEdges",
  rows: ReadonlyArray<Parameters<typeof decodeStoredAppRelationEdgeResult>[1]>,
): Effect.Effect<
  ReadonlyArray<StoredAppRelationEdge>,
  AppRelationEdgeBuildCorruptionError
> {
  const rowOperation = operation === "readSource"
    ? "readBuildSource"
    : "readBuildPage";
  return Effect.forEach(rows, (row) =>
    Effect.fromResult(decodeStoredAppRelationEdgeResult(
      rowOperation,
      row,
    )).pipe(Effect.mapError((cause) =>
      new AppRelationEdgeBuildCorruptionError({
        operation,
        reason: "stored edge row is invalid",
        cause,
      })
    )), { concurrency: 1 }).pipe(
      Effect.map((edges) => Object.freeze(edges)),
    );
}

function mapCanonicalEvidenceError(
  cause: RelationOccurrenceV1Error | RelationOccurrenceSha256Error,
): AppRelationEdgeBuildCorruptionError | AppRelationEdgeBuildEvidenceError {
  return cause._tag === "RelationOccurrenceSha256Error"
    ? new AppRelationEdgeBuildEvidenceError({
      operation: "validateEdge",
      cause,
    })
    : new AppRelationEdgeBuildCorruptionError({
      operation: "validateEdge",
      reason: "expected relation occurrence is invalid",
      cause,
    });
}

function buildInput(
  operation: AppRelationEdgeBuildInputError["operation"],
  reason: AppRelationEdgeBuildInputError["reason"],
  cause?: unknown,
): AppRelationEdgeBuildInputError {
  return new AppRelationEdgeBuildInputError({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function queryEffect<Value>(
  operation: AppRelationEdgeBuildPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, AppRelationEdgeBuildPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppRelationEdgeBuildPersistenceError({
      operation,
      cause,
    }),
  }));
}
