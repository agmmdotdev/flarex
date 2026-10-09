import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  RELATION_INCOMING_PAGE_MAXIMUM_BASE_ROWS_V1,
  RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1,
  type PhysicalEdgeDefinitionV1,
  type RelationCompatibilityClassificationV1,
  type RelationSemanticChangeV1,
} from "flarex-protocol/internal/application-schema-binding";
import type { RelationDeclarationV1 } from
  "flarex-protocol/internal/relation-declaration-v1";
import {
  RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
  RELATION_OCCURRENCE_FORMAT_V1,
  RELATION_OCCURRENCE_VERSION_V1,
} from "flarex-protocol/internal/relation-occurrence-v1";

/** Classify every semantic facet that the admitted V1 declaration can vary. */
export function classifyRelationCompatibility(
  previous: RelationDeclarationV1,
  current: RelationDeclarationV1,
): RelationCompatibilityClassificationV1 {
  const changes: RelationSemanticChangeV1[] = [];
  if (previous.source.table !== current.source.table) {
    changes.push("sourceTable");
  }
  if (!sourcePathsEqual(previous, current)) changes.push("sourcePath");
  if (previous.source.forwardName !== current.source.forwardName) {
    changes.push("forwardName");
  }
  if (previous.target.table !== current.target.table) {
    changes.push("targetTable");
  }
  if (previous.value.cardinality !== current.value.cardinality) {
    changes.push("cardinality");
  } else if (
    previous.value.cardinality === "one" &&
    current.value.cardinality === "one"
  ) {
    if (previous.value.required !== current.value.required) {
      changes.push("required");
    }
  } else if (
    previous.value.cardinality === "many" &&
    current.value.cardinality === "many"
  ) {
    if (previous.value.minItems !== current.value.minItems) {
      changes.push("minimumItems");
    }
    if (previous.value.maxItems !== current.value.maxItems) {
      changes.push("maximumItems");
    }
    if (previous.value.ordered !== current.value.ordered) {
      changes.push("ordering");
    }
    if (previous.value.duplicates !== current.value.duplicates) {
      changes.push("duplicates");
    }
  }
  if (previous.inverse.cardinality !== current.inverse.cardinality) {
    changes.push("inverseCardinality");
  }
  if (previous.inverse.name !== current.inverse.name) {
    changes.push("inverseName");
  }
  if (previous.localized !== current.localized) {
    changes.push("localization");
  }
  if (previous.onTargetDelete !== current.onTargetDelete) {
    changes.push("targetDeletePolicy");
  }
  return Object.freeze({
    declarationCodec: "sameV1" as const,
    changes: Object.freeze(changes),
  } satisfies RelationCompatibilityClassificationV1);
}

/** Derive the complete immutable R01-P physical meaning from one binding. */
export function makePhysicalEdgeDefinition(
  sourceTableId: CatalogTableId,
  targetTableId: CatalogTableId,
  declaration: RelationDeclarationV1,
): PhysicalEdgeDefinitionV1 {
  return {
    format: "flarex.physical-edge-definition",
    version: 1,
    sourceTableId,
    targetTableId,
    sourcePath: declaration.source.path,
    sourceValueExtraction: declaration.value.cardinality === "one"
      ? "scalar"
      : "array",
    duplicates: "forbid",
    localization: { kind: "none" },
    positionRetention: {
      storage: "nullable",
      scalar: "null",
      array: "zeroBasedIndex",
    },
    occurrenceCodec: {
      format: RELATION_OCCURRENCE_FORMAT_V1,
      version: RELATION_OCCURRENCE_VERSION_V1,
      duplicateOrdinal: RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
    },
    currentOccurrenceIdentity: [
      "scopeId",
      "edgeDefinitionId",
      "sourceDocumentId",
      "targetDocumentId",
      "duplicateOrdinal",
    ],
    outgoingCurrentAccess: {
      equalityPrefix: ["scopeId", "edgeDefinitionId", "sourceDocumentId"],
      order: ["targetDocumentId", "duplicateOrdinal"],
    },
    incomingCurrentAccess: {
      equalityPrefix: ["scopeId", "edgeDefinitionId", "targetDocumentId"],
      order: ["sourceDocumentId", "duplicateOrdinal"],
    },
    currentProjection: {
      position: "includedNullable",
      commitProvenance: "included",
    },
    incomingPage: {
      maximumLogicalIdentities:
        RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
      maximumBaseRows: RELATION_INCOMING_PAGE_MAXIMUM_BASE_ROWS_V1,
      internalFrontier: ["sourceDocumentId", "duplicateOrdinal"],
      exhausted: "allReturnedRowsConsumedAndNoLookahead",
      callerAuthoredCursor: "none",
      maximumTransactionBaseOccurrences:
        RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1,
    },
    snapshot: {
      kind: "endpointAdjacencyVersion",
      version: 1,
      key: [
        "scopeId",
        "edgeDefinitionId",
        "direction",
        "endpointDocumentId",
      ],
      value: "lastChangedCommitSeq",
      absentValue: "0",
      advancement: "oncePerAffectedEndpointScopeCommit",
      pageRead: "versionBeforeCurrentPageVersionAfter",
      snapshotEligibility: "versionsEqualAndAtOrBeforeSnapshot",
      dependency: "exactObservedEndpointVersion",
      validationLockOrder: "scopeClockFirst",
      finalValidation: "dependencyUnchanged",
      conflict: "replaceAttemptAndDeterministicallyRerun",
      historyFallback: "forbidden",
    },
  };
}

function sourcePathsEqual(
  previous: RelationDeclarationV1,
  current: RelationDeclarationV1,
): boolean {
  const previousField = previous.source.path[0];
  const currentField = current.source.path[0];
  return previousField !== undefined && currentField !== undefined &&
    previousField.kind === currentField.kind &&
    previousField.name === currentField.name;
}
