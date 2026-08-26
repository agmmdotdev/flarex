import { compareUtf16Strings } from "@flarex/utils/strings";
import { Result } from "effect";

import {
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdV1Error,
} from "flarex-protocol/app-document-id";

import type {
  AppRelationEdgeAdjacencyChange,
  AppRelationEdgeStorageAction,
} from "./Model";

export interface AppRelationEdgeActionEndpoints {
  readonly edgeDefinitionId: AppRelationEdgeAdjacencyChange["edgeDefinitionId"];
  readonly sourceRowId: AppRelationEdgeAdjacencyChange["endpointRowId"];
  readonly targetRowId: AppRelationEdgeAdjacencyChange["endpointRowId"];
}

/**
 * Pure endpoint projection shared by S12 adjacency versions and R03 facts.
 * The caller retains authority over the actions; this helper only decodes,
 * coalesces, freezes, and orders their exact physical adjacency identities.
 */
export function projectAppRelationEdgeAdjacencyChangesResult(
  actions: ReadonlyArray<AppRelationEdgeStorageAction>,
): Result.Result<
  ReadonlyArray<AppRelationEdgeAdjacencyChange>,
  AppDocumentIdV1Error
> {
  return Result.gen(function* () {
    const endpoints: AppRelationEdgeActionEndpoints[] = [];
    for (const action of actions) {
      const source = yield* requireAppDocumentIdentityV1ForTableResult(
        action.occurrence.sourceDocumentId,
        action.definition.physical.sourceTableId,
      );
      const target = yield* requireAppDocumentIdentityV1ForTableResult(
        action.occurrence.targetDocumentId,
        action.definition.physical.targetTableId,
      );
      endpoints.push(Object.freeze({
        edgeDefinitionId: action.definition.edgeDefinitionId,
        sourceRowId: source.rowId,
        targetRowId: target.rowId,
      }));
    }
    return projectAppRelationEdgeAdjacencyChanges(endpoints);
  });
}

/** Coalesce and order already-decoded action endpoints. */
export function projectAppRelationEdgeAdjacencyChanges(
  endpoints: ReadonlyArray<AppRelationEdgeActionEndpoints>,
): ReadonlyArray<AppRelationEdgeAdjacencyChange> {
  const changes = new Map<string, AppRelationEdgeAdjacencyChange>();
  for (const endpoint of endpoints) {
    addChange(changes, Object.freeze({
      edgeDefinitionId: endpoint.edgeDefinitionId,
      direction: "outgoing",
      endpointRowId: endpoint.sourceRowId,
    }));
    addChange(changes, Object.freeze({
      edgeDefinitionId: endpoint.edgeDefinitionId,
      direction: "incoming",
      endpointRowId: endpoint.targetRowId,
    }));
  }
  return Object.freeze([...changes.values()].toSorted(compareChanges));
}

function addChange(
  changes: Map<string, AppRelationEdgeAdjacencyChange>,
  change: AppRelationEdgeAdjacencyChange,
): void {
  changes.set(
    `${change.edgeDefinitionId}:${change.direction}:${change.endpointRowId}`,
    change,
  );
}

function compareChanges(
  left: AppRelationEdgeAdjacencyChange,
  right: AppRelationEdgeAdjacencyChange,
): number {
  return left.edgeDefinitionId - right.edgeDefinitionId ||
    directionRank(left.direction) - directionRank(right.direction) ||
    compareUtf16Strings(left.endpointRowId, right.endpointRowId);
}

function directionRank(
  direction: AppRelationEdgeAdjacencyChange["direction"],
): number {
  return direction === "outgoing" ? 0 : 1;
}
