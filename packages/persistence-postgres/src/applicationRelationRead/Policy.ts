import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Result } from "effect";

import {
  appDocumentIdV1FromRowIdentity,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";

import type {
  AppRelationEdgeIncomingPageItem,
  AppRelationEdgePosition,
  AppRelationEdgeStorageAction,
} from "../appRelationEdges";

export interface ApplicationRelationIncomingReadItem {
  readonly sourceDocumentId: AppDocumentIdV1;
  readonly duplicateOrdinal: 0;
  readonly position: AppRelationEdgePosition;
}

export type MergeApplicationRelationIncomingPageResult =
  | Readonly<{ readonly status: "needsMoreBase" }>
  | Readonly<{
      readonly status: "complete";
      readonly items: ReadonlyArray<ApplicationRelationIncomingReadItem>;
      readonly exhausted: boolean;
    }>;

export class ApplicationRelationReadOverlayError extends Data.TaggedError(
  "ApplicationRelationReadOverlayError",
)<{
  readonly reason:
    | "invalidLimit"
    | "duplicateBaseOccurrence"
    | "duplicateOverlayOccurrence"
    | "overlayBaseMismatch";
}> {}

interface IncomingPosition {
  readonly sourceRowId: AppRowIdHexV1;
  readonly duplicateOrdinal: 0;
  readonly position: AppRelationEdgePosition;
}

/**
 * Pure O10-R merge. `needsMoreBase` means unseen physical keys could still
 * change the first logical page or its exact exhaustion verdict.
 */
export function mergeApplicationRelationIncomingPageResult(
  input: Readonly<{
    readonly sourceTableId: CatalogTableId;
    readonly targetRowId: AppRowIdHexV1;
    readonly maximumIdentities: number;
    readonly baseItems: ReadonlyArray<AppRelationEdgeIncomingPageItem>;
    readonly baseExhausted: boolean;
    readonly actions: ReadonlyArray<AppRelationEdgeStorageAction>;
  }>,
): Result.Result<
  MergeApplicationRelationIncomingPageResult,
  ApplicationRelationReadOverlayError
> {
  if (
    !Number.isSafeInteger(input.maximumIdentities) ||
    input.maximumIdentities < 1
  ) {
    return Result.fail(overlayError("invalidLimit"));
  }

  const overlayByIdentity = new Map<string, AppRelationEdgeStorageAction>();
  for (const action of input.actions) {
    const source = decodeAppDocumentIdentityV1(
      action.occurrence.sourceDocumentId,
    );
    const target = decodeAppDocumentIdentityV1(
      action.occurrence.targetDocumentId,
    );
    if (target.rowId !== input.targetRowId) continue;
    const key = occurrenceKey(source.rowId, action.occurrence.duplicateOrdinal);
    if (overlayByIdentity.has(key)) {
      return Result.fail(overlayError("duplicateOverlayOccurrence"));
    }
    overlayByIdentity.set(key, action);
  }

  const merged: IncomingPosition[] = [];
  const seenBase = new Set<string>();
  for (const base of input.baseItems) {
    const key = occurrenceKey(base.sourceRowId, base.duplicateOrdinal);
    if (seenBase.has(key)) {
      return Result.fail(overlayError("duplicateBaseOccurrence"));
    }
    seenBase.add(key);
    const overlay = overlayByIdentity.get(key);
    if (overlay?.kind === "put") {
      return Result.fail(overlayError("overlayBaseMismatch"));
    }
    if (overlay?.kind === "remove") {
      overlayByIdentity.delete(key);
      continue;
    }
    if (overlay?.kind === "reorder") {
      merged.push(Object.freeze({
        sourceRowId: base.sourceRowId,
        duplicateOrdinal: base.duplicateOrdinal,
        position: overlay.position,
      }));
      overlayByIdentity.delete(key);
      continue;
    }
    merged.push(Object.freeze({
      sourceRowId: base.sourceRowId,
      duplicateOrdinal: base.duplicateOrdinal,
      position: base.position,
    }));
  }

  for (const action of overlayByIdentity.values()) {
    if (action.kind !== "put") {
      const source = decodeAppDocumentIdentityV1(
        action.occurrence.sourceDocumentId,
      );
      const lastBase = input.baseItems.at(-1);
      if (
        input.baseExhausted ||
        (lastBase !== undefined && compareIncomingPositions(
          {
            sourceRowId: source.rowId,
            duplicateOrdinal: action.occurrence.duplicateOrdinal,
          },
          lastBase,
        ) <= 0)
      ) {
        return Result.fail(overlayError("overlayBaseMismatch"));
      }
      continue;
    }
    const source = decodeAppDocumentIdentityV1(
      action.occurrence.sourceDocumentId,
    );
    merged.push(Object.freeze({
      sourceRowId: source.rowId,
      duplicateOrdinal: action.occurrence.duplicateOrdinal,
      position: action.position,
    }));
  }
  merged.sort(compareIncomingPositions);

  if (!input.baseExhausted) {
    const lastBase = input.baseItems.at(-1);
    const logicalLookahead = merged[input.maximumIdentities];
    if (
      lastBase === undefined ||
      logicalLookahead === undefined ||
      compareIncomingPositions(logicalLookahead, lastBase) > 0
    ) {
      return Result.succeed(Object.freeze({ status: "needsMoreBase" }));
    }
  }

  const page = merged.slice(0, input.maximumIdentities).map(item =>
    applicationRelationIncomingReadItemFromEdge(input.sourceTableId, item)
  );
  return Result.succeed(Object.freeze({
    status: "complete",
    items: Object.freeze(page),
    exhausted: input.baseExhausted &&
      merged.length <= input.maximumIdentities,
  }));
}

export function applicationRelationIncomingReadItemFromEdge(
  sourceTableId: CatalogTableId,
  item: Pick<
    AppRelationEdgeIncomingPageItem,
    "sourceRowId" | "duplicateOrdinal" | "position"
  >,
): ApplicationRelationIncomingReadItem {
  return Object.freeze({
    sourceDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: sourceTableId,
      rowId: item.sourceRowId,
    }),
    duplicateOrdinal: item.duplicateOrdinal,
    position: item.position,
  });
}

function compareIncomingPositions(
  left: Pick<IncomingPosition, "sourceRowId" | "duplicateOrdinal">,
  right: Pick<IncomingPosition, "sourceRowId" | "duplicateOrdinal">,
): number {
  const rowOrder = compareUtf16Strings(left.sourceRowId, right.sourceRowId);
  return rowOrder !== 0
    ? rowOrder
    : left.duplicateOrdinal - right.duplicateOrdinal;
}

function occurrenceKey(sourceRowId: AppRowIdHexV1, duplicateOrdinal: 0) {
  return `${sourceRowId}:${duplicateOrdinal}`;
}

function overlayError(
  reason: ApplicationRelationReadOverlayError["reason"],
): ApplicationRelationReadOverlayError {
  return new ApplicationRelationReadOverlayError({ reason });
}
