import { compareUtf16Strings } from "@flarex/utils/strings";
import { Result } from "effect";

import {
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdV1,
  type AppDocumentIdentityV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
  RELATION_OCCURRENCE_FORMAT_V1,
  RELATION_OCCURRENCE_VERSION_V1,
  type RelationOccurrenceV1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";

import {
  projectAppRelationEdgeAdjacencyChangesResult,
  type AppRelationEdgeStorageAction,
} from "../appRelationEdges";
import {
  ApplicationRelationCommitCorruptionError,
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationConstraintError,
  type ApplicationRelationConstraintReason,
  type ApplicationRelationRestrictProbe,
  type ApplicationRelationRowTransition,
  type ApplicationRelationStoredTargetCheck,
  ApplicationRelationTargetNotLiveError,
  MAX_APPLICATION_RELATION_EDGE_ACTIONS,
  MAX_APPLICATION_RELATION_FINAL_OCCURRENCES,
  MAX_APPLICATION_RELATION_FINAL_TARGETS,
  MAX_APPLICATION_RELATION_PRIOR_OCCURRENCES,
  MAX_APPLICATION_RELATION_RESTRICT_PROBES,
  type LocatedApplicationRelationDefinition,
  type LocatedApplicationRelationDefinitionSet,
  type PrepareApplicationRelationCommitError,
  type PreparedApplicationRelationCommit,
} from "./Model";

interface ExtractedOccurrence {
  readonly occurrence: RelationOccurrenceV1;
  readonly target: AppDocumentIdentityV1;
  readonly position: number | null;
}

interface ExtractionBudget {
  priorOccurrences: number;
  finalOccurrences: number;
}

/** Pure prior/final lowering for the admitted C09 profile. */
export function lowerApplicationRelationCommitResult(
  definitions: LocatedApplicationRelationDefinitionSet,
  transitionsInput: ReadonlyArray<ApplicationRelationRowTransition>,
): Result.Result<
  PreparedApplicationRelationCommit,
  PrepareApplicationRelationCommitError
> {
  return Result.gen(function* () {
    const transitions = transitionsInput.toSorted(
      compareApplicationRelationTransitions,
    );
    const definitionsBySource = yield* indexDefinitionsBySourceResult(
      definitions,
    );
    const budget: ExtractionBudget = {
      priorOccurrences: 0,
      finalOccurrences: 0,
    };
    const actions: AppRelationEdgeStorageAction[] = [];
    const finalTargets = new Map<
      AppDocumentIdV1,
      ApplicationRelationStoredTargetCheck
    >();
    const deletedTransitions: ApplicationRelationRowTransition[] = [];
    const transitionsByDocumentId = new Map<
      AppDocumentIdV1,
      ApplicationRelationRowTransition
    >();

    for (const transition of transitions) {
      yield* validateTransitionIdentityResult(transition);
      if (transitionsByDocumentId.has(transition.documentId)) {
        return yield* Result.fail(commitCorruption(
          "invalidDocumentTransition",
        ));
      }
      transitionsByDocumentId.set(transition.documentId, transition);
      if (transition.final === null) deletedTransitions.push(transition);
      const sourceDefinitions = definitionsBySource.get(transition.tableId) ??
        [];
      for (const definition of sourceDefinitions) {
        const prior = yield* extractRelationOccurrencesResult(
          definition,
          transition.documentId,
          transition.prior,
          "priorOccurrences",
          budget,
        );
        const final = yield* extractRelationOccurrencesResult(
          definition,
          transition.documentId,
          transition.final,
          "finalOccurrences",
          budget,
        );
        for (const occurrence of final) {
          if (!finalTargets.has(occurrence.target.id)) {
            finalTargets.set(occurrence.target.id, Object.freeze({
              documentId: occurrence.target.id,
              tableId: occurrence.target.tableId,
              rowId: occurrence.target.rowId,
              relationId: definition.binding.relationId,
              sourceDocumentId: transition.documentId,
            }));
            if (
              finalTargets.size > MAX_APPLICATION_RELATION_FINAL_TARGETS
            ) {
              return yield* Result.fail(resourceExhaustion(
                "finalTargets",
                finalTargets.size,
                MAX_APPLICATION_RELATION_FINAL_TARGETS,
              ));
            }
          }
        }
        lowerOccurrenceDelta(definition, prior, final, actions);
        if (actions.length > MAX_APPLICATION_RELATION_EDGE_ACTIONS) {
          return yield* Result.fail(resourceExhaustion(
            "edgeActions",
            actions.length,
            MAX_APPLICATION_RELATION_EDGE_ACTIONS,
          ));
        }
      }
    }

    const restrictProbes = yield* prepareRestrictProbesResult(
      definitions.definitions,
      deletedTransitions,
    );
    actions.sort(compareRelationEdgeActions);
    const adjacencyChanges = yield* projectAppRelationEdgeAdjacencyChangesResult(
      actions,
    ).pipe(
      Result.mapError(cause => commitCorruption(
        "invalidDocumentTransition",
        cause,
      )),
    );
    const targets = [...finalTargets.values()].toSorted(
      compareApplicationRelationTargets,
    );
    const storedTargetChecks: ApplicationRelationStoredTargetCheck[] = [];
    for (const target of targets) {
      const sameCommitTarget = transitionsByDocumentId.get(target.documentId);
      if (sameCommitTarget === undefined) {
        storedTargetChecks.push(target);
      } else if (sameCommitTarget.final === null) {
        return yield* Result.fail(new ApplicationRelationTargetNotLiveError({
          targetDocumentId: target.documentId,
        }));
      }
    }
    return Object.freeze({
      actions: Object.freeze(actions),
      adjacencyChanges,
      storedTargetChecks: Object.freeze(storedTargetChecks),
      restrictProbes,
      priorOccurrenceCount: budget.priorOccurrences,
      finalOccurrenceCount: budget.finalOccurrences,
      distinctFinalTargetCount: targets.length,
    });
  });
}

function indexDefinitionsBySourceResult(
  set: LocatedApplicationRelationDefinitionSet,
): Result.Result<
  ReadonlyMap<CatalogTableId, ReadonlyArray<LocatedApplicationRelationDefinition>>,
  ApplicationRelationCommitCorruptionError
> {
  const bySource = new Map<
    CatalogTableId,
    LocatedApplicationRelationDefinition[]
  >();
  let priorOrdinal = 0;
  for (const definition of set.definitions) {
    if (
      definition.binding.relationOrdinal <= priorOrdinal ||
      !definitionProjectionIsCoherent(definition) ||
      !definitionMatchesAdmittedProfile(definition)
    ) {
      return Result.fail(commitCorruption("invalidDefinitionSet"));
    }
    priorOrdinal = definition.binding.relationOrdinal;
    const existing = bySource.get(definition.binding.sourceTableId);
    if (existing === undefined) {
      bySource.set(definition.binding.sourceTableId, [definition]);
    } else {
      existing.push(definition);
    }
  }
  return Result.succeed(new Map([...bySource].map(([tableId, definitions]) => [
    tableId,
    Object.freeze(definitions),
  ] as const)));
}

function definitionMatchesAdmittedProfile(
  definition: LocatedApplicationRelationDefinition,
): boolean {
  const declaration = definition.semantic.declaration;
  const physical = definition.edge.physical;
  return declaration.localized === false &&
    declaration.inverse.cardinality === "many" &&
    declaration.onTargetDelete === "restrict" &&
    physical.duplicates === "forbid" &&
    physical.localization.kind === "none" &&
    (
      declaration.value.cardinality === "one" ||
      declaration.value.duplicates === "forbid"
    );
}

function definitionProjectionIsCoherent(
  definition: LocatedApplicationRelationDefinition,
): boolean {
  const declaration = definition.semantic.declaration;
  const physical = definition.edge.physical;
  return definition.binding.relationId === definition.semantic.relationId &&
    definition.binding.relationId === definition.edge.relationId &&
    definition.binding.edgeDefinitionId === definition.edge.edgeDefinitionId &&
    definition.binding.sourceTableId === definition.semantic.sourceTableId &&
    definition.binding.targetTableId === definition.semantic.targetTableId &&
    physical.sourceTableId === definition.binding.sourceTableId &&
    physical.targetTableId === definition.binding.targetTableId &&
    declaration.source.path.length === 1 &&
    physical.sourcePath.length === 1 &&
    declaration.source.path[0]?.kind === "field" &&
    physical.sourcePath[0]?.kind === "field" &&
    declaration.source.path[0].name === physical.sourcePath[0].name &&
    (
      declaration.value.cardinality === "one"
        ? physical.sourceValueExtraction === "scalar"
        : physical.sourceValueExtraction === "array"
    );
}

function validateTransitionIdentityResult(
  transition: ApplicationRelationRowTransition,
): Result.Result<void, ApplicationRelationCommitCorruptionError> {
  return requireAppDocumentIdentityV1ForTableResult(
    transition.documentId,
    transition.tableId,
  ).pipe(
    Result.filterOrFail(
      (identity) => identity.rowId === transition.rowId,
      () => commitCorruption("invalidDocumentTransition"),
    ),
    Result.mapError((cause) => cause instanceof ApplicationRelationCommitCorruptionError
      ? cause
      : commitCorruption("invalidDocumentTransition", cause)),
    Result.map(() => undefined),
  );
}

function extractRelationOccurrencesResult(
  definition: LocatedApplicationRelationDefinition,
  sourceDocumentId: AppDocumentIdV1,
  document: ApplicationRelationRowTransition["prior"],
  dimension: "priorOccurrences" | "finalOccurrences",
  budget: ExtractionBudget,
): Result.Result<
  ReadonlyArray<ExtractedOccurrence>,
  PrepareApplicationRelationCommitError
> {
  return Result.gen(function* () {
    if (document === null) return Object.freeze([]);
    const root = document.value;
    if (
      !isCanonicalFlarexRuntimeObjectV1(root) ||
      root._id !== sourceDocumentId
    ) {
      return yield* Result.fail(commitCorruption(
        "invalidDocumentTransition",
      ));
    }
    const declaration = definition.semantic.declaration;
    const fieldName = declaration.source.path[0].name;
    const present = Object.hasOwn(root, fieldName);
    const fieldValue = present ? root[fieldName] : undefined;
    const occurrences: ExtractedOccurrence[] = [];
    if (declaration.value.cardinality === "one") {
      if (!present) {
        if (declaration.value.required) {
          return yield* Result.fail(relationValueFailure(
            dimension,
            "missingRequiredValue",
            definition,
            sourceDocumentId,
          ));
        }
      } else {
        const target = yield* requireAppDocumentIdentityV1ForTableResult(
          fieldValue,
          definition.binding.targetTableId,
        ).pipe(Result.mapError((cause) => relationValueFailure(
          dimension,
          "invalidRelationValue",
          definition,
          sourceDocumentId,
          cause,
        )));
        occurrences.push(extractedOccurrence(
          definition,
          sourceDocumentId,
          target,
          null,
        ));
      }
    } else {
      if (!present || !Array.isArray(fieldValue)) {
        return yield* Result.fail(relationValueFailure(
          dimension,
          "invalidRelationValue",
          definition,
          sourceDocumentId,
        ));
      }
      if (
        fieldValue.length < declaration.value.minItems ||
        fieldValue.length > declaration.value.maxItems
      ) {
        return yield* Result.fail(relationValueFailure(
          dimension,
          "relationCardinalityViolation",
          definition,
          sourceDocumentId,
        ));
      }
      const targets = new Set<AppDocumentIdV1>();
      for (let index = 0; index < fieldValue.length; index += 1) {
        if (!Object.hasOwn(fieldValue, index)) {
          return yield* Result.fail(relationValueFailure(
            dimension,
            "invalidRelationValue",
            definition,
            sourceDocumentId,
          ));
        }
        const target = yield* requireAppDocumentIdentityV1ForTableResult(
          fieldValue[index],
          definition.binding.targetTableId,
        ).pipe(Result.mapError((cause) => relationValueFailure(
          dimension,
          "invalidRelationValue",
          definition,
          sourceDocumentId,
          cause,
        )));
        if (targets.has(target.id)) {
          return yield* Result.fail(relationValueFailure(
            dimension,
            "duplicateTarget",
            definition,
            sourceDocumentId,
          ));
        }
        targets.add(target.id);
        occurrences.push(extractedOccurrence(
          definition,
          sourceDocumentId,
          target,
          index,
        ));
      }
    }
    budget[dimension] += occurrences.length;
    const maximum = dimension === "priorOccurrences"
      ? MAX_APPLICATION_RELATION_PRIOR_OCCURRENCES
      : MAX_APPLICATION_RELATION_FINAL_OCCURRENCES;
    if (budget[dimension] > maximum) {
      return yield* Result.fail(resourceExhaustion(
        dimension,
        budget[dimension],
        maximum,
      ));
    }
    return Object.freeze(occurrences);
  });
}

function extractedOccurrence(
  definition: LocatedApplicationRelationDefinition,
  sourceDocumentId: AppDocumentIdV1,
  target: AppDocumentIdentityV1,
  position: number | null,
): ExtractedOccurrence {
  const sourceField = definition.semantic.declaration.source.path[0];
  const sourcePath = Object.freeze([Object.freeze({
    kind: sourceField.kind,
    name: sourceField.name,
  })] as const);
  const occurrence: RelationOccurrenceV1 = Object.freeze({
    format: RELATION_OCCURRENCE_FORMAT_V1,
    version: RELATION_OCCURRENCE_VERSION_V1,
    sourceDocumentId,
    sourcePath,
    targetDocumentId: target.id,
    duplicateOrdinal: RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
  });
  return Object.freeze({ occurrence, target, position });
}

function lowerOccurrenceDelta(
  definition: LocatedApplicationRelationDefinition,
  prior: ReadonlyArray<ExtractedOccurrence>,
  final: ReadonlyArray<ExtractedOccurrence>,
  actions: AppRelationEdgeStorageAction[],
): void {
  const priorByTarget = new Map(prior.map((occurrence) => [
    occurrence.target.id,
    occurrence,
  ] as const));
  const finalByTarget = new Map(final.map((occurrence) => [
    occurrence.target.id,
    occurrence,
  ] as const));
  for (const occurrence of prior) {
    if (!finalByTarget.has(occurrence.target.id)) {
      actions.push(Object.freeze({
        kind: "remove",
        definition: definition.edge,
        occurrence: occurrence.occurrence,
      }));
    }
  }
  for (const occurrence of final) {
    const previous = priorByTarget.get(occurrence.target.id);
    if (previous === undefined) {
      actions.push(Object.freeze({
        kind: "put",
        definition: definition.edge,
        occurrence: occurrence.occurrence,
        position: occurrence.position,
      }));
    } else if (previous.position !== occurrence.position) {
      actions.push(Object.freeze({
        kind: "reorder",
        definition: definition.edge,
        occurrence: occurrence.occurrence,
        position: occurrence.position,
      }));
    }
  }
}

function prepareRestrictProbesResult(
  definitions: ReadonlyArray<LocatedApplicationRelationDefinition>,
  deletedTransitions: ReadonlyArray<ApplicationRelationRowTransition>,
): Result.Result<
  ReadonlyArray<ApplicationRelationRestrictProbe>,
  ApplicationRelationCommitResourceExhaustionError
> {
  const probes: ApplicationRelationRestrictProbe[] = [];
  for (const transition of deletedTransitions) {
    for (const definition of definitions) {
      if (definition.binding.targetTableId !== transition.tableId) continue;
      probes.push(Object.freeze({
        relationId: definition.binding.relationId,
        definition: definition.edge,
        targetDocumentId: transition.documentId,
        targetRowId: transition.rowId,
      }));
      if (probes.length > MAX_APPLICATION_RELATION_RESTRICT_PROBES) {
        return Result.fail(resourceExhaustion(
          "restrictProbes",
          probes.length,
          MAX_APPLICATION_RELATION_RESTRICT_PROBES,
        ));
      }
    }
  }
  probes.sort(compareApplicationRelationRestrictProbes);
  return Result.succeed(Object.freeze(probes));
}

function compareRelationEdgeActions(
  left: AppRelationEdgeStorageAction,
  right: AppRelationEdgeStorageAction,
): number {
  return left.definition.edgeDefinitionId -
      right.definition.edgeDefinitionId ||
    compareUtf16Strings(
      left.occurrence.sourceDocumentId,
      right.occurrence.sourceDocumentId,
    ) ||
    compareUtf16Strings(
      left.occurrence.targetDocumentId,
      right.occurrence.targetDocumentId,
    ) ||
    relationActionRank(left.kind) - relationActionRank(right.kind);
}

function relationActionRank(
  kind: AppRelationEdgeStorageAction["kind"],
): number {
  switch (kind) {
    case "remove":
      return 0;
    case "put":
      return 1;
    case "reorder":
      return 2;
  }
}

function compareApplicationRelationTargets(
  left: ApplicationRelationStoredTargetCheck,
  right: ApplicationRelationStoredTargetCheck,
): number {
  return left.tableId - right.tableId ||
    compareUtf16Strings(left.rowId, right.rowId);
}

function compareApplicationRelationRestrictProbes(
  left: ApplicationRelationRestrictProbe,
  right: ApplicationRelationRestrictProbe,
): number {
  return left.definition.edgeDefinitionId -
      right.definition.edgeDefinitionId ||
    compareUtf16Strings(left.targetRowId, right.targetRowId);
}

function compareApplicationRelationTransitions(
  left: ApplicationRelationRowTransition,
  right: ApplicationRelationRowTransition,
): number {
  return left.tableId - right.tableId ||
    compareUtf16Strings(left.rowId, right.rowId);
}

function relationConstraint(
  reason: ApplicationRelationConstraintReason,
  definition: LocatedApplicationRelationDefinition,
  sourceDocumentId: AppDocumentIdV1,
  cause?: unknown,
): ApplicationRelationConstraintError {
  return new ApplicationRelationConstraintError({
    reason,
    relationId: definition.binding.relationId,
    sourceDocumentId,
    ...(cause === undefined ? {} : { cause }),
  });
}

function relationValueFailure(
  dimension: "priorOccurrences" | "finalOccurrences",
  reason: ApplicationRelationConstraintReason,
  definition: LocatedApplicationRelationDefinition,
  sourceDocumentId: AppDocumentIdV1,
  cause?: unknown,
): ApplicationRelationConstraintError | ApplicationRelationCommitCorruptionError {
  const constraint = relationConstraint(
    reason,
    definition,
    sourceDocumentId,
    cause,
  );
  return dimension === "finalOccurrences"
    ? constraint
    : commitCorruption("invalidPriorRelationValue", constraint);
}

function resourceExhaustion(
  dimension: ApplicationRelationCommitResourceExhaustionError["dimension"],
  observed: number,
  maximum: number,
): ApplicationRelationCommitResourceExhaustionError {
  return new ApplicationRelationCommitResourceExhaustionError({
    dimension,
    observed,
    maximum,
  });
}

function commitCorruption(
  reason: ApplicationRelationCommitCorruptionError["reason"],
  cause?: unknown,
): ApplicationRelationCommitCorruptionError {
  return new ApplicationRelationCommitCorruptionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
