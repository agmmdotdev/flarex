import type {
  PointCommitUniqueKeyPlanV1,
  PointCommitUniqueKeyActionV1,
  PointCommitDeveloperIndexEntryActionV1,
} from "./model";
import type {
  OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";

export function preparedUniqueKeyActions(plans: readonly PointCommitUniqueKeyPlanV1[]): readonly PointCommitUniqueKeyActionV1[] {
  const actions: PointCommitUniqueKeyActionV1[] = [];
  for (const plan of plans) {
    const previous = plan.previousCanonical?.kind === "claim" ? plan.previousCanonical : null;
    const next = plan.nextCanonical?.kind === "claim" ? plan.nextCanonical : null;
    if (previous !== null && next !== null && previous.encodedKey === next.encodedKey) continue;
    if (previous !== null) actions.push(uniqueKeyAction("release", plan, previous.encodedKey));
    if (next !== null) actions.push(uniqueKeyAction("claim", plan, next.encodedKey));
  }
  return Object.freeze(actions.toSorted(comparePointCommitUniqueKeyActions));
}

function uniqueKeyAction(
  phase: PointCommitUniqueKeyActionV1["phase"],
  plan: PointCommitUniqueKeyPlanV1,
  sortKey: OrderedIndexKeyHexV1,
): PointCommitUniqueKeyActionV1 {
  return Object.freeze({
    phase,
    definition: plan.definition,
    rowId: plan.rowId,
    sortKey,
  });
}

function pointCommitUniqueKeyPhaseRank(
  phase: PointCommitUniqueKeyActionV1["phase"],
): number {
  return phase === "release" ? 0 : 1;
}

function comparePointCommitUniqueKeyActions(
  left: PointCommitUniqueKeyActionV1,
  right: PointCommitUniqueKeyActionV1,
): number {
  return (
    pointCommitUniqueKeyPhaseRank(left.phase) -
      pointCommitUniqueKeyPhaseRank(right.phase) ||
    left.definition.uniqueConstraintDefinitionId -
      right.definition.uniqueConstraintDefinitionId ||
    left.sortKey.localeCompare(right.sortKey) ||
    left.rowId.localeCompare(right.rowId)
  );
}

export function compareDeveloperIndexEntryActions(
  left: Omit<PointCommitDeveloperIndexEntryActionV1, "membershipHeadEvidence">,
  right: Omit<PointCommitDeveloperIndexEntryActionV1, "membershipHeadEvidence">,
): number {
  return (
    left.definition.indexDefinitionId - right.definition.indexDefinitionId ||
    left.encodedKey.localeCompare(right.encodedKey) ||
    left.rowId.localeCompare(right.rowId) ||
    (left.kind === right.kind ? 0 : left.kind === "tombstone" ? -1 : 1)
  );
}
