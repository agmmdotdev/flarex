import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  encodeCanonicalJson,
  measureCanonicalJsonUtf8Bytes,
  type Json,
} from "flarex-protocol/json";
import type {
  SchemaManifestAppSchemaV1,
  SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";

import { classifyAppSchemaEvolution } from "./Compatibility";
import type { AppSchemaEvolutionChange } from "./Model";
import type {
  AppSchemaEvolutionActivationPrerequisiteV1,
  AppSchemaEvolutionPlanAuthorityPinsV1,
  AppSchemaEvolutionPlanBlockerCodeV1,
  AppSchemaEvolutionPlanEvidenceV1,
  AppSchemaEvolutionPlanOperationV1,
  AppSchemaEvolutionPlanV1,
  AppSchemaEvolutionRemediationActionV1,
  AppSchemaEvolutionRollbackPrerequisiteV1,
  AppSchemaRenameIntentV1,
  AppSchemaResolvedRenameV1,
} from "./PlanningModel";

export type {
  AppSchemaEvolutionActivationPrerequisiteV1,
  AppSchemaEvolutionPlanAuthorityPinsV1,
  AppSchemaEvolutionPlanBlockerCodeV1,
  AppSchemaEvolutionPlanEvidenceV1,
  AppSchemaEvolutionPlanOperationV1,
  AppSchemaEvolutionPlanV1,
  AppSchemaEvolutionRemediationActionV1,
  AppSchemaEvolutionRollbackPrerequisiteV1,
  AppSchemaRenameIntentV1,
  AppSchemaResolvedRenameV1,
} from "./PlanningModel";

export const APP_SCHEMA_EVOLUTION_PLAN_FORMAT_V1 =
  "flarex.managed-schema/evolution-plan/v1" as const;
export const MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1 = 20_000;
export const MAX_APP_SCHEMA_EVOLUTION_OPERATIONS_V1 = 40_000;
export const MAX_APP_SCHEMA_EVOLUTION_EVIDENCE_ENTRIES_V1 = 256;
export const MAX_APP_SCHEMA_EVOLUTION_CANONICAL_BYTES_V1 = 4 * 1024 * 1024;

export interface PlanAppSchemaEvolutionV1Input {
  readonly authority: AppSchemaEvolutionPlanAuthorityPinsV1;
  readonly activeManifest: SchemaManifestAppSchemaV1;
  readonly candidateManifest: SchemaManifestAppSchemaV1;
  readonly renameIntents?: ReadonlyArray<AppSchemaRenameIntentV1>;
}

export type AppSchemaEvolutionPlanningV1Issue =
  | Readonly<{
      readonly reason: "limitExceeded";
      readonly dimension: "renameIntents" | "operations" | "canonicalBytes";
      readonly observed: number;
      readonly maximum: number;
    }>
  | Readonly<{
      readonly reason: "duplicateRenameIntent" | "extraneousRenameIntent";
      readonly intentKey: string;
    }>
  | Readonly<{ readonly reason: "digestUnavailable" }>;

export class AppSchemaEvolutionPlanningV1Error extends Data.TaggedError(
  "AppSchemaEvolutionPlanningV1Error",
)<{ readonly issue: AppSchemaEvolutionPlanningV1Issue }> {}

type PlanWithoutIdentity = Omit<
  AppSchemaEvolutionPlanV1,
  "canonicalText" | "planSha256Hex"
>;

const ACTIVATION_PREREQUISITES = Object.freeze([
  "activeAuthorityPinsStillMatch",
  "candidateArtifactDigestStillMatches",
  "dataFrontierStillCoversValidation",
  "requiredPhysicalBuildsAreEnabled",
  "planHasNoIdentityBlockers",
  "recomputedPlanDigestMatches",
] satisfies AppSchemaEvolutionActivationPrerequisiteV1[]);

const ROLLBACK_PREREQUISITES = Object.freeze([
  "previousActiveArtifactRetained",
  "rollbackTargetAuthorityRevalidated",
  "rollbackUsesExistingActivationOwner",
] satisfies AppSchemaEvolutionRollbackPrerequisiteV1[]);

/**
 * Plans over already-decoded, authenticated immutable artifacts. It performs no
 * catalog, row, DDL, readiness, or activation I/O and grants no apply authority.
 */
export const planAppSchemaEvolutionV1Effect = Effect.fn(
  "ManagedSchema.planAppSchemaEvolutionV1",
)(function* (
  input: PlanAppSchemaEvolutionV1Input,
): Effect.fn.Return<AppSchemaEvolutionPlanV1, AppSchemaEvolutionPlanningV1Error> {
  const renameIntents = input.renameIntents ?? [];
  yield* enforceLimit(
    "renameIntents",
    renameIntents.length,
    MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1,
  );

  const classification = classifyAppSchemaEvolution(
    input.activeManifest,
    input.candidateManifest,
  );
  yield* enforceLimit(
    "operations",
    classification.changes.length,
    MAX_APP_SCHEMA_EVOLUTION_OPERATIONS_V1,
  );

  const resolvedRenames = yield* Effect.fromResult(resolveRenameIntentsResult(
    eligibleRenameKeys(classification.changes),
    renameIntents,
  ));
  const resolvedKeys = new Set<string>(resolvedRenames.map(renameIntentKey));
  const evidence = buildEvidence(classification.changes, resolvedKeys);
  const operations = Object.freeze(classification.changes.map((change, ordinal) =>
    Object.freeze({
      ordinal,
      safetyClass: operationSafetyClass(change, resolvedKeys),
      change,
    }) satisfies AppSchemaEvolutionPlanOperationV1
  ));
  const hasIdentityBlockers = [...evidence.codes].some(isIdentityBlockerCode);
  const disposition = hasIdentityBlockers
    ? "blocked"
    : classification.dataCompatibility === "requiresDataValidation"
      || classification.physicalRequirements === "requiresBuildOrRetirement"
    ? "managedBuildAndValidation"
    : "safeMetadataActivation";
  const plan = Object.freeze({
    format: APP_SCHEMA_EVOLUTION_PLAN_FORMAT_V1,
    planVersion: 1,
    authority: freezeAuthority(input.authority),
    disposition,
    classification: Object.freeze({
      disposition,
      dataCompatibility: classification.dataCompatibility,
      physicalRequirements: classification.physicalRequirements,
      identity: hasIdentityBlockers ? "requiresExplicitIntent" : "consistent",
    }),
    resolvedRenames,
    operations,
    incompatibilityEvidence: Object.freeze({
      entries: Object.freeze(evidence.entries),
      observedCount: evidence.observedCount,
      truncated: evidence.observedCount > evidence.entries.length,
    }),
    remediationActions: remediationActions(classification.changes, evidence.codes),
    activationPrerequisites: ACTIVATION_PREREQUISITES,
    rollbackPrerequisites: ROLLBACK_PREREQUISITES,
  } satisfies PlanWithoutIdentity);

  const identityJson = planningIdentityJson(plan);
  const measured = measureCanonicalJsonUtf8Bytes(
    identityJson,
    MAX_APP_SCHEMA_EVOLUTION_CANONICAL_BYTES_V1,
  );
  if (measured.kind === "invalid") return canonicalEncodingInvariant();
  if (measured.kind === "exceeded") {
    return yield* Effect.fail(planningError({
      reason: "limitExceeded",
      dimension: "canonicalBytes",
      observed: measured.observed,
      maximum: MAX_APP_SCHEMA_EVOLUTION_CANONICAL_BYTES_V1,
    }));
  }
  const canonicalText = encodeCanonicalJson(
    identityJson,
    canonicalEncodingInvariant,
  );
  const canonicalBytes = new TextEncoder().encode(canonicalText);
  if (canonicalBytes.byteLength !== measured.bytes) {
    return canonicalEncodingInvariant();
  }
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(canonicalBytes),
    ),
    catch: () => planningError({ reason: "digestUnavailable" }),
  });
  return Object.freeze({
    ...plan,
    canonicalText,
    planSha256Hex: encodeBytesToLowercaseHex(new Uint8Array(digest)),
  });
});

function resolveRenameIntentsResult(
  eligibleKeys: ReadonlySet<string>,
  intents: ReadonlyArray<AppSchemaRenameIntentV1>,
): Result.Result<
  ReadonlyArray<AppSchemaResolvedRenameV1>,
  AppSchemaEvolutionPlanningV1Error
> {
  return Result.gen(function* () {
    const seen = new Set<string>();
    const resolved: AppSchemaResolvedRenameV1[] = [];
    for (const intent of intents) {
      const key = renameIntentKey(intent);
      if (seen.has(key)) {
        return yield* Result.fail(planningError({
          reason: "duplicateRenameIntent",
          intentKey: key,
        }));
      }
      seen.add(key);
      if (!eligibleKeys.has(key)) {
        return yield* Result.fail(planningError({
          reason: "extraneousRenameIntent",
          intentKey: key,
        }));
      }
      resolved.push(Object.freeze({ ...intent }));
    }
    resolved.sort((left, right) => compareStrings(renameIntentKey(left), renameIntentKey(right)));
    return Object.freeze(resolved);
  });
}

function eligibleRenameKeys(
  changes: ReadonlyArray<AppSchemaEvolutionChange>,
): ReadonlySet<string> {
  const eligible = new Set<string>();
  for (const change of changes) {
    if (change.kind === "tableLogicalNameChanged") {
      eligible.add(renameIntentKey({
        kind: "table",
        tableId: change.tableId,
        fromLogicalName: change.activeLogicalName,
        toLogicalName: change.candidateLogicalName,
      }));
    } else if (
      change.kind === "indexDefinitionChanged"
      && change.activeTableId === change.candidateTableId
      && change.activeDescriptor !== change.candidateDescriptor
    ) {
      eligible.add(renameIntentKey({
        kind: "index",
        logicalIndexId: change.logicalIndexId,
        tableId: change.activeTableId,
        fromDescriptor: change.activeDescriptor,
        toDescriptor: change.candidateDescriptor,
      }));
    }
  }
  return eligible;
}

function buildEvidence(
  changes: ReadonlyArray<AppSchemaEvolutionChange>,
  resolvedKeys: ReadonlySet<string>,
): EvidenceCollection {
  const evidence: EvidenceCollection = {
    entries: [],
    observedCount: 0,
    codes: new Set(),
  };
  const removedTables = changes.filter((change) => change.kind === "tableRemoved");
  const addedTables = changes.filter((change) => change.kind === "tableAdded");
  if (removedTables.length > 0 && addedTables.length > 0) {
    for (const change of [...removedTables, ...addedTables]) {
      recordEvidence(evidence, Object.freeze({
        code: "tableReplacementAmbiguous",
        tableId: change.tableId,
        logicalName: change.logicalName,
      }));
    }
  }

  const removedIndexesByTable = new Map<number, AppSchemaEvolutionChange[]>();
  for (const change of changes) {
    if (change.kind !== "indexRemoved") continue;
    const entries = removedIndexesByTable.get(change.tableId) ?? [];
    entries.push(change);
    removedIndexesByTable.set(change.tableId, entries);
  }
  const addedIndexTables = new Set(changes.flatMap((change) =>
    change.kind === "indexAdded" ? [change.tableId] : []
  ));
  for (const change of changes) {
    if (
      change.kind === "indexRemoved"
      && addedIndexTables.has(change.tableId)
      || change.kind === "indexAdded"
        && removedIndexesByTable.has(change.tableId)
    ) {
      recordEvidence(
        evidence,
        indexEvidence("indexReplacementAmbiguous", change),
      );
    }
  }

  for (const change of changes) {
    switch (change.kind) {
      case "tableLogicalNameChanged": {
        const key = renameIntentKey({
          kind: "table",
          tableId: change.tableId,
          fromLogicalName: change.activeLogicalName,
          toLogicalName: change.candidateLogicalName,
        });
        if (!resolvedKeys.has(key)) {
          recordEvidence(evidence, Object.freeze({
            code: "explicitTableRenameIntentRequired",
            tableId: change.tableId,
            logicalName: change.candidateLogicalName,
          }));
        }
        break;
      }
      case "tableIdentityChanged":
        recordEvidence(evidence, Object.freeze({
          code: "tableIdentityReplacement",
          tableId: change.candidateTableId,
          logicalName: change.logicalName,
        }));
        break;
      case "indexIdentityChanged":
        recordEvidence(evidence, Object.freeze({
          code: "indexIdentityReplacement",
          tableId: change.tableId,
          logicalIndexId: change.candidateLogicalIndexId,
          descriptor: change.descriptor,
        }));
        break;
      case "indexDefinitionChanged": {
        if (change.activeTableId !== change.candidateTableId) {
          recordEvidence(evidence, Object.freeze({
            code: "indexMovedAcrossTables",
            tableId: change.candidateTableId,
            logicalIndexId: change.logicalIndexId,
            descriptor: change.candidateDescriptor,
          }));
        } else if (change.activeDescriptor !== change.candidateDescriptor) {
          const key = renameIntentKey({
            kind: "index",
            logicalIndexId: change.logicalIndexId,
            tableId: change.activeTableId,
            fromDescriptor: change.activeDescriptor,
            toDescriptor: change.candidateDescriptor,
          });
          if (!resolvedKeys.has(key)) {
            recordEvidence(evidence, Object.freeze({
              code: "explicitIndexRenameIntentRequired",
              tableId: change.candidateTableId,
              logicalIndexId: change.logicalIndexId,
              descriptor: change.candidateDescriptor,
            }));
          }
        }
        break;
      }
      case "tableValidatorChanged":
        if (change.compatibility.disposition === "requiresDataValidation") {
          recordEvidence(evidence, Object.freeze({
            code: "candidateDocumentValidationRequired",
            tableId: change.tableId,
            logicalName: change.logicalName,
            validatorPath: change.compatibility.path,
            reason: change.compatibility.reason,
          }));
        }
        break;
      case "tableRemoved":
        recordEvidence(evidence, Object.freeze({
          code: "candidateTableEmptinessValidationRequired",
          tableId: change.tableId,
          logicalName: change.logicalName,
        }));
        break;
      case "tableAdded":
      case "indexAdded":
      case "indexRemoved":
        break;
      default:
        assertNever(change);
    }
  }
  return evidence;
}

interface EvidenceCollection {
  readonly entries: AppSchemaEvolutionPlanEvidenceV1[];
  observedCount: number;
  readonly codes: Set<AppSchemaEvolutionPlanEvidenceV1["code"]>;
}

function recordEvidence(
  collection: EvidenceCollection,
  evidence: AppSchemaEvolutionPlanEvidenceV1,
): void {
  collection.observedCount += 1;
  collection.codes.add(evidence.code);
  const firstGreaterIndex = collection.entries.findIndex((entry) =>
    compareEvidence(entry, evidence) > 0
  );
  const insertionIndex = firstGreaterIndex === -1
    ? collection.entries.length
    : firstGreaterIndex;
  if (insertionIndex >= MAX_APP_SCHEMA_EVOLUTION_EVIDENCE_ENTRIES_V1) return;
  collection.entries.splice(insertionIndex, 0, evidence);
  if (collection.entries.length > MAX_APP_SCHEMA_EVOLUTION_EVIDENCE_ENTRIES_V1) {
    collection.entries.pop();
  }
}

function operationSafetyClass(
  change: AppSchemaEvolutionChange,
  resolvedKeys: ReadonlySet<string>,
): AppSchemaEvolutionPlanOperationV1["safetyClass"] {
  switch (change.kind) {
    case "tableAdded":
      return "metadataOnly";
    case "tableRemoved":
      return "requiresDataValidation";
    case "tableValidatorChanged":
      return change.compatibility.disposition === "requiresDataValidation"
        ? "requiresDataValidation"
        : "metadataOnly";
    case "indexAdded":
    case "indexRemoved":
      return "requiresPhysicalWork";
    case "tableIdentityChanged":
    case "indexIdentityChanged":
      return "blockedIdentity";
    case "tableLogicalNameChanged":
      return resolvedKeys.has(renameIntentKey({
          kind: "table",
          tableId: change.tableId,
          fromLogicalName: change.activeLogicalName,
          toLogicalName: change.candidateLogicalName,
        })) ? "metadataOnly" : "blockedIdentity";
    case "indexDefinitionChanged":
      if (change.activeTableId !== change.candidateTableId) return "blockedIdentity";
      if (change.activeDescriptor === change.candidateDescriptor) return "requiresPhysicalWork";
      return resolvedKeys.has(renameIntentKey({
          kind: "index",
          logicalIndexId: change.logicalIndexId,
          tableId: change.activeTableId,
          fromDescriptor: change.activeDescriptor,
          toDescriptor: change.candidateDescriptor,
        })) ? "requiresPhysicalWork" : "blockedIdentity";
    default:
      return assertNever(change);
  }
}

function remediationActions(
  changes: ReadonlyArray<AppSchemaEvolutionChange>,
  evidenceCodes: ReadonlySet<AppSchemaEvolutionPlanEvidenceV1["code"]>,
): ReadonlyArray<AppSchemaEvolutionRemediationActionV1> {
  const actions = new Set<AppSchemaEvolutionRemediationActionV1>();
  if ([...evidenceCodes].some(isIdentityBlockerCode)) {
    actions.add("resolveEveryBlockingIdentityDecision");
  }
  if (
    evidenceCodes.has("explicitTableRenameIntentRequired")
    || evidenceCodes.has("explicitIndexRenameIntentRequired")
  ) actions.add("declareStableIdentityRenameIntent");
  if (
    evidenceCodes.has("tableIdentityReplacement")
    || evidenceCodes.has("indexIdentityReplacement")
    || evidenceCodes.has("tableReplacementAmbiguous")
    || evidenceCodes.has("indexReplacementAmbiguous")
    || evidenceCodes.has("indexMovedAcrossTables")
  ) actions.add("regenerateCandidatePreservingStableIdentity");
  if (evidenceCodes.has("candidateDocumentValidationRequired")) {
    actions.add("validateCandidateDocumentsAtPinnedFrontier");
  }
  if (evidenceCodes.has("candidateTableEmptinessValidationRequired")) {
    actions.add("emptyRemovedTablesThenReplanAtNewFrontier");
  }
  if (changes.some((change) =>
    change.kind === "indexAdded"
    || change.kind === "indexRemoved"
    || change.kind === "indexDefinitionChanged"
    || change.kind === "indexIdentityChanged"
  )) actions.add("buildOrRetireCandidateIndexes");
  return Object.freeze([...actions].sort(compareStrings));
}

function freezeAuthority(
  authority: AppSchemaEvolutionPlanAuthorityPinsV1,
): PlanWithoutIdentity["authority"] {
  return Object.freeze({
    scopeId: authority.scopeId,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence.toString(),
    scopeEpoch: authority.scopeEpoch,
    activeSchemaVersionId: authority.activeSchemaVersionId,
    activeManifestSha256Hex: schemaManifestDigestHex(authority.activeManifestSha256),
    candidateSchemaVersionId: authority.candidateSchemaVersionId,
    candidateManifestSha256Hex: schemaManifestDigestHex(authority.candidateManifestSha256),
    dataFrontierCommitSeq: authority.dataFrontierCommitSeq.toString(),
  });
}

function schemaManifestDigestHex(value: SchemaManifestSha256): string {
  return encodeBytesToLowercaseHex(value);
}

function planningIdentityJson(plan: PlanWithoutIdentity): Json {
  return {
    format: plan.format,
    planVersion: plan.planVersion,
    authority: {
      scopeId: plan.authority.scopeId,
      storageGeneration: plan.authority.storageGeneration,
      storageGenerationFence: plan.authority.storageGenerationFence,
      scopeEpoch: plan.authority.scopeEpoch,
      activeSchemaVersionId: plan.authority.activeSchemaVersionId,
      activeManifestSha256Hex: plan.authority.activeManifestSha256Hex,
      candidateSchemaVersionId: plan.authority.candidateSchemaVersionId,
      candidateManifestSha256Hex: plan.authority.candidateManifestSha256Hex,
      dataFrontierCommitSeq: plan.authority.dataFrontierCommitSeq,
    },
    disposition: plan.disposition,
    classification: {
      disposition: plan.classification.disposition,
      dataCompatibility: plan.classification.dataCompatibility,
      physicalRequirements: plan.classification.physicalRequirements,
      identity: plan.classification.identity,
    },
    resolvedRenames: plan.resolvedRenames.map(renameIntentJson),
    operations: plan.operations.map((operation) => ({
      ordinal: operation.ordinal,
      safetyClass: operation.safetyClass,
      change: changeJson(operation.change),
    })),
    incompatibilityEvidence: {
      entries: plan.incompatibilityEvidence.entries.map(evidenceJson),
      observedCount: plan.incompatibilityEvidence.observedCount,
      truncated: plan.incompatibilityEvidence.truncated,
    },
    remediationActions: plan.remediationActions,
    activationPrerequisites: plan.activationPrerequisites,
    rollbackPrerequisites: plan.rollbackPrerequisites,
  };
}

function renameIntentJson(intent: AppSchemaRenameIntentV1): Json {
  return intent.kind === "table" ? {
    kind: intent.kind,
    tableId: intent.tableId,
    fromLogicalName: intent.fromLogicalName,
    toLogicalName: intent.toLogicalName,
  } : {
    kind: intent.kind,
    logicalIndexId: intent.logicalIndexId,
    tableId: intent.tableId,
    fromDescriptor: intent.fromDescriptor,
    toDescriptor: intent.toDescriptor,
  };
}

function changeJson(change: AppSchemaEvolutionChange): Json {
  switch (change.kind) {
    case "tableAdded":
    case "tableRemoved":
      return {
        kind: change.kind,
        tableId: change.tableId,
        logicalName: change.logicalName,
      };
    case "tableIdentityChanged":
      return {
        kind: change.kind,
        logicalName: change.logicalName,
        activeTableId: change.activeTableId,
        candidateTableId: change.candidateTableId,
      };
    case "tableLogicalNameChanged":
      return {
        kind: change.kind,
        tableId: change.tableId,
        activeLogicalName: change.activeLogicalName,
        candidateLogicalName: change.candidateLogicalName,
      };
    case "tableValidatorChanged":
      return {
        kind: change.kind,
        tableId: change.tableId,
        logicalName: change.logicalName,
        compatibility: change.compatibility.disposition === "universallyCompatible"
          ? { disposition: change.compatibility.disposition }
          : {
              disposition: change.compatibility.disposition,
              reason: change.compatibility.reason,
              path: change.compatibility.path,
            },
      };
    case "indexAdded":
    case "indexRemoved":
      return {
        kind: change.kind,
        logicalIndexId: change.logicalIndexId,
        tableId: change.tableId,
        descriptor: change.descriptor,
      };
    case "indexIdentityChanged":
      return {
        kind: change.kind,
        tableId: change.tableId,
        descriptor: change.descriptor,
        activeLogicalIndexId: change.activeLogicalIndexId,
        candidateLogicalIndexId: change.candidateLogicalIndexId,
      };
    case "indexDefinitionChanged":
      return {
        kind: change.kind,
        logicalIndexId: change.logicalIndexId,
        activeTableId: change.activeTableId,
        candidateTableId: change.candidateTableId,
        activeDescriptor: change.activeDescriptor,
        candidateDescriptor: change.candidateDescriptor,
      };
    default:
      return assertNever(change);
  }
}

function evidenceJson(evidence: AppSchemaEvolutionPlanEvidenceV1): Json {
  if (evidence.code === "candidateDocumentValidationRequired") {
    return {
      code: evidence.code,
      tableId: evidence.tableId,
      logicalName: evidence.logicalName,
      validatorPath: evidence.validatorPath,
      reason: evidence.reason,
    };
  }
  if (evidence.code === "candidateTableEmptinessValidationRequired") {
    return {
      code: evidence.code,
      tableId: evidence.tableId,
      logicalName: evidence.logicalName,
    };
  }
  const output: Record<string, Json> = { code: evidence.code };
  if (evidence.tableId !== undefined) output.tableId = evidence.tableId;
  if (evidence.logicalName !== undefined) output.logicalName = evidence.logicalName;
  if (evidence.logicalIndexId !== undefined) {
    output.logicalIndexId = evidence.logicalIndexId;
  }
  if (evidence.descriptor !== undefined) output.descriptor = evidence.descriptor;
  return output;
}

function indexEvidence(
  code: AppSchemaEvolutionPlanBlockerCodeV1,
  change: Extract<AppSchemaEvolutionChange, { readonly kind: "indexAdded" | "indexRemoved" }>,
): AppSchemaEvolutionPlanEvidenceV1 {
  return Object.freeze({
    code,
    tableId: change.tableId,
    logicalIndexId: change.logicalIndexId,
    descriptor: change.descriptor,
  });
}

function isIdentityBlockerCode(
  code: AppSchemaEvolutionPlanEvidenceV1["code"],
): boolean {
  switch (code) {
    case "candidateDocumentValidationRequired":
    case "candidateTableEmptinessValidationRequired":
      return false;
    case "explicitTableRenameIntentRequired":
    case "explicitIndexRenameIntentRequired":
    case "tableIdentityReplacement":
    case "indexIdentityReplacement":
    case "tableReplacementAmbiguous":
    case "indexReplacementAmbiguous":
    case "indexMovedAcrossTables":
      return true;
    default:
      return assertNever(code);
  }
}

function renameIntentKey(intent: AppSchemaRenameIntentV1): string {
  return intent.kind === "table"
    ? `table:${intent.tableId}:${intent.fromLogicalName}:${intent.toLogicalName}`
    : `index:${intent.logicalIndexId}:${intent.tableId}:${intent.fromDescriptor}:${intent.toDescriptor}`;
}

function compareEvidence(
  left: AppSchemaEvolutionPlanEvidenceV1,
  right: AppSchemaEvolutionPlanEvidenceV1,
): number {
  if (left.code !== right.code) return compareStrings(left.code, right.code);
  const tableDifference = (left.tableId ?? -1) - (right.tableId ?? -1);
  if (tableDifference !== 0) return tableDifference;
  const leftName = "logicalName" in left ? left.logicalName ?? "" : "";
  const rightName = "logicalName" in right ? right.logicalName ?? "" : "";
  if (leftName !== rightName) return compareStrings(leftName, rightName);
  const leftIndexId = "logicalIndexId" in left ? left.logicalIndexId ?? -1 : -1;
  const rightIndexId = "logicalIndexId" in right ? right.logicalIndexId ?? -1 : -1;
  if (leftIndexId !== rightIndexId) return leftIndexId - rightIndexId;
  const leftDescriptor = "descriptor" in left ? left.descriptor ?? "" : "";
  const rightDescriptor = "descriptor" in right ? right.descriptor ?? "" : "";
  return compareStrings(leftDescriptor, rightDescriptor);
}

function enforceLimit(
  dimension: Extract<
    AppSchemaEvolutionPlanningV1Issue,
    { readonly reason: "limitExceeded" }
  >["dimension"],
  observed: number,
  maximum: number,
): Effect.Effect<void, AppSchemaEvolutionPlanningV1Error> {
  return observed > maximum
    ? Effect.fail(planningError({ reason: "limitExceeded", dimension, observed, maximum }))
    : Effect.void;
}

function planningError(
  issue: AppSchemaEvolutionPlanningV1Issue,
): AppSchemaEvolutionPlanningV1Error {
  return new AppSchemaEvolutionPlanningV1Error({ issue });
}

function canonicalEncodingInvariant(): never {
  throw new Error("Owned managed-schema plan lost a canonical JSON member.");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled managed-schema planning value: ${String(value)}`);
}
