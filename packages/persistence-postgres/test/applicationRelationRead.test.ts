import { Result } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogRelationId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import type { PhysicalEdgeDefinitionV1 } from
  "flarex-protocol/internal/application-schema-binding";
import {
  decodeRelationDeclarationV1Result,
  type RelationDeclarationV1,
} from "flarex-protocol/internal/relation-declaration-v1";
import {
  decodeRelationOccurrenceV1Result,
  type RelationOccurrenceV1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  type AppRelationEdgeDefinitionPin,
  type AppRelationEdgeIncomingPageItem,
  type AppRelationEdgeStorageAction,
} from "../src/appRelationEdges";
import {
  ApplicationRelationReadOverlayError,
  mergeApplicationRelationIncomingPageResult,
} from "../src/applicationRelationRead";
import { makePhysicalEdgeDefinition } from
  "../src/applicationRelationBinding/Policy";

const sourceTableId = decodeCatalogTableId(11);
const targetTableId = decodeCatalogTableId(12);
const relationId = decodeCatalogRelationId(21);
const targetA = rowId(101);
const targetB = rowId(102);
const definition = definitionPin();

describe("O10-R application relation read overlay", () => {
  it("orders staged inserts around base rows and retains reordered metadata", () => {
    const sourceA = rowId(1);
    const sourceB = rowId(2);
    const sourceC = rowId(3);
    const sourceD = rowId(4);
    const sourceF = rowId(6);
    const sourceG = rowId(7);
    const merged = Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 5,
      baseItems: Object.freeze([
        baseItem(sourceB, null),
        baseItem(sourceD, 4),
        baseItem(sourceF, null),
      ]),
      baseExhausted: true,
      actions: Object.freeze([
        put(sourceA, targetA, 1),
        put(sourceC, targetA, 3),
        reorder(sourceD, targetA, 44),
        put(sourceG, targetA, 7),
        put(rowId(8), targetB, 8),
      ]),
    }));

    expect(merged).toEqual({
      status: "complete",
      items: [
        resultItem(sourceA, 1),
        resultItem(sourceB, null),
        resultItem(sourceC, 3),
        resultItem(sourceD, 44),
        resultItem(sourceF, null),
      ],
      exhausted: false,
    });
  });

  it("requests another base page after staged removals and then proves exhaustion", () => {
    const sourceA = rowId(1);
    const sourceB = rowId(2);
    const sourceD = rowId(4);
    const sourceE = rowId(5);
    const actions = Object.freeze([
      remove(sourceA, targetA),
      remove(sourceB, targetA),
    ]);

    expect(Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 2,
      baseItems: Object.freeze([
        baseItem(sourceA, null),
        baseItem(sourceB, null),
      ]),
      baseExhausted: false,
      actions,
    }))).toEqual({ status: "needsMoreBase" });

    expect(Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 2,
      baseItems: Object.freeze([
        baseItem(sourceA, null),
        baseItem(sourceB, null),
        baseItem(sourceD, null),
        baseItem(sourceE, null),
      ]),
      baseExhausted: true,
      actions,
    }))).toEqual({
      status: "complete",
      items: [resultItem(sourceD, null), resultItem(sourceE, null)],
      exhausted: true,
    });
  });

  it("projects one retarget as removal from the old target and insertion into the new target", () => {
    const source = rowId(3);
    const actions = Object.freeze([
      remove(source, targetA),
      put(source, targetB, null),
    ]);

    expect(Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 1,
      baseItems: Object.freeze([baseItem(source, null)]),
      baseExhausted: true,
      actions,
    }))).toEqual({ status: "complete", items: [], exhausted: true });
    expect(Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetB,
      maximumIdentities: 1,
      baseItems: Object.freeze([]),
      baseExhausted: true,
      actions,
    }))).toEqual({
      status: "complete",
      items: [resultItem(source, null)],
      exhausted: true,
    });
  });

  it("distinguishes partial and empty exhausted pages", () => {
    const sourceA = rowId(1);
    const sourceB = rowId(2);
    const sourceC = rowId(3);
    expect(Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 2,
      baseItems: Object.freeze([
        baseItem(sourceA, null),
        baseItem(sourceB, null),
        baseItem(sourceC, null),
      ]),
      baseExhausted: false,
      actions: Object.freeze([]),
    }))).toEqual({
      status: "complete",
      items: [resultItem(sourceA, null), resultItem(sourceB, null)],
      exhausted: false,
    });
    expect(Result.getOrThrow(mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 2,
      baseItems: Object.freeze([]),
      baseExhausted: true,
      actions: Object.freeze([]),
    }))).toEqual({ status: "complete", items: [], exhausted: true });
  });

  it("rejects duplicate and mismatched overlay evidence", () => {
    const source = rowId(1);
    const duplicateBase = mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 1,
      baseItems: Object.freeze([
        baseItem(source, null),
        baseItem(source, null),
      ]),
      baseExhausted: true,
      actions: Object.freeze([]),
    });
    const duplicateOverlay = mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 1,
      baseItems: Object.freeze([]),
      baseExhausted: true,
      actions: Object.freeze([
        put(source, targetA, null),
        put(source, targetA, 1),
      ]),
    });
    const missingRemoval = mergeApplicationRelationIncomingPageResult({
      sourceTableId,
      targetRowId: targetA,
      maximumIdentities: 1,
      baseItems: Object.freeze([]),
      baseExhausted: true,
      actions: Object.freeze([remove(source, targetA)]),
    });

    for (const [result, reason] of [
      [duplicateBase, "duplicateBaseOccurrence"],
      [duplicateOverlay, "duplicateOverlayOccurrence"],
      [missingRemoval, "overlayBaseMismatch"],
    ] as const) {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ApplicationRelationReadOverlayError);
        expect(result.failure.reason).toBe(reason);
      }
    }
  });
});

function definitionPin(): AppRelationEdgeDefinitionPin {
  const declaration = relationDeclaration();
  const physical: PhysicalEdgeDefinitionV1 = makePhysicalEdgeDefinition(
    sourceTableId,
    targetTableId,
    declaration,
  );
  return Object.freeze({
    relationId,
    edgeDefinitionId: decodeCatalogEdgeDefinitionId(31),
    physical,
  });
}

function relationDeclaration(): RelationDeclarationV1 {
  return Result.getOrThrow(decodeRelationDeclarationV1Result({
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: "posts",
      path: [{ kind: "field", name: "author" }],
      forwardName: "author",
    },
    target: { table: "users" },
    value: { cardinality: "one", required: true },
    inverse: { cardinality: "many", name: "posts" },
    localized: false,
    onTargetDelete: "restrict",
  }));
}

function occurrence(
  sourceRowId: AppRowIdHexV1,
  targetRowId: AppRowIdHexV1,
): RelationOccurrenceV1 {
  return Result.getOrThrow(decodeRelationOccurrenceV1Result({
    format: "flarex.relation-occurrence",
    version: 1,
    sourceDocumentId: sourceDocumentId(sourceRowId),
    sourcePath: [{ kind: "field", name: "author" }],
    targetDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: targetTableId,
      rowId: targetRowId,
    }),
    duplicateOrdinal: 0,
  }));
}

function put(
  sourceRowId: AppRowIdHexV1,
  targetRowId: AppRowIdHexV1,
  position: number | null,
): AppRelationEdgeStorageAction {
  return Object.freeze({
    kind: "put",
    definition,
    occurrence: occurrence(sourceRowId, targetRowId),
    position,
  });
}

function remove(
  sourceRowId: AppRowIdHexV1,
  targetRowId: AppRowIdHexV1,
): AppRelationEdgeStorageAction {
  return Object.freeze({
    kind: "remove",
    definition,
    occurrence: occurrence(sourceRowId, targetRowId),
  });
}

function reorder(
  sourceRowId: AppRowIdHexV1,
  targetRowId: AppRowIdHexV1,
  position: number | null,
): AppRelationEdgeStorageAction {
  return Object.freeze({
    kind: "reorder",
    definition,
    occurrence: occurrence(sourceRowId, targetRowId),
    position,
  });
}

function baseItem(
  sourceRowId: AppRowIdHexV1,
  position: number | null,
): AppRelationEdgeIncomingPageItem {
  return Object.freeze({
    sourceRowId,
    duplicateOrdinal: 0,
    position,
    commitSeq: CommitSeqSchema.make(1n),
  });
}

function resultItem(sourceRowId: AppRowIdHexV1, position: number | null) {
  return Object.freeze({
    sourceDocumentId: sourceDocumentId(sourceRowId),
    duplicateOrdinal: 0 as const,
    position,
  });
}

function sourceDocumentId(sourceRowId: AppRowIdHexV1) {
  return appDocumentIdV1FromRowIdentity({
    tableId: sourceTableId,
    rowId: sourceRowId,
  });
}

function rowId(ordinal: number): AppRowIdHexV1 {
  return decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
}
