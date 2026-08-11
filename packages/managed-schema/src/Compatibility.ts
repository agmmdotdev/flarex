import type {
  SchemaManifestAppIndexBindingV1,
  SchemaManifestAppSchemaV1,
  SchemaManifestAppTableDefinitionV1,
} from "flarex-protocol/schema-manifest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

import type {
  AppSchemaEvolutionChange,
  AppSchemaEvolutionClassification,
  ValidatorCompatibility,
} from "./Model";

export type {
  AppSchemaEvolutionChange,
  AppSchemaEvolutionClassification,
  AppSchemaEvolutionDisposition,
  ValidatorCompatibility,
} from "./Model";

export const MAX_VALIDATOR_COMPATIBILITY_COMPARISONS = 262_144;

const UNIVERSALLY_COMPATIBLE = Object.freeze({
  disposition: "universallyCompatible",
} satisfies ValidatorCompatibility);

type CompatibilityBudget = { remaining: number };
type StructuralEquality = "equal" | "different" | "comparisonBudgetExceeded";

/**
 * Classifies two already-decoded immutable app-schema manifests. The result is
 * derived policy only: it is not a deployment plan, readiness receipt, or
 * authority to activate a schema.
 */
export function classifyAppSchemaEvolution(
  active: SchemaManifestAppSchemaV1,
  candidate: SchemaManifestAppSchemaV1,
): AppSchemaEvolutionClassification {
  const changes: AppSchemaEvolutionChange[] = [];
  const compatibilityBudget: CompatibilityBudget = {
    remaining: MAX_VALIDATOR_COMPATIBILITY_COMPARISONS,
  };
  const activeTablesById = new Map(
    active.tableDefinitions.tables.map((table) => [table.tableId, table] as const),
  );
  const candidateTablesById = new Map(
    candidate.tableDefinitions.tables.map((table) =>
      [table.tableId, table] as const
    ),
  );
  const activeTablesByName = new Map(
    active.tableDefinitions.tables.map((table) =>
      [table.logicalName, table] as const
    ),
  );
  const candidateTablesByName = new Map(
    candidate.tableDefinitions.tables.map((table) =>
      [table.logicalName, table] as const
    ),
  );

  for (const activeTable of active.tableDefinitions.tables) {
    const candidateByName = candidateTablesByName.get(activeTable.logicalName);
    if (
      candidateByName !== undefined
      && candidateByName.tableId !== activeTable.tableId
    ) {
      changes.push(Object.freeze({
        kind: "tableIdentityChanged",
        logicalName: activeTable.logicalName,
        activeTableId: activeTable.tableId,
        candidateTableId: candidateByName.tableId,
      }));
    }

    const candidateTable = candidateTablesById.get(activeTable.tableId);
    if (candidateTable === undefined) {
      changes.push(Object.freeze({
        kind: "tableRemoved",
        tableId: activeTable.tableId,
        logicalName: activeTable.logicalName,
      }));
      continue;
    }
    if (candidateTable.logicalName !== activeTable.logicalName) {
      changes.push(Object.freeze({
        kind: "tableLogicalNameChanged",
        tableId: activeTable.tableId,
        activeLogicalName: activeTable.logicalName,
        candidateLogicalName: candidateTable.logicalName,
      }));
    }
    const structuralEquality = validatorJsonStructuralEquality(
      activeTable.definition.documentType,
      candidateTable.definition.documentType,
      compatibilityBudget,
    );
    if (structuralEquality !== "equal") {
      changes.push(Object.freeze({
        kind: "tableValidatorChanged",
        tableId: activeTable.tableId,
        logicalName: activeTable.logicalName,
        compatibility: structuralEquality === "comparisonBudgetExceeded"
          ? validationRequired("comparisonBudgetExceeded", "$document")
          : compareValidator(
              activeTable.definition.documentType,
              candidateTable.definition.documentType,
              "$document",
              compatibilityBudget,
            ),
      }));
    }
  }

  for (const candidateTable of candidate.tableDefinitions.tables) {
    if (!activeTablesById.has(candidateTable.tableId)) {
      changes.push(Object.freeze({
        kind: "tableAdded",
        tableId: candidateTable.tableId,
        logicalName: candidateTable.logicalName,
      }));
    }
  }

  classifyIndexChanges(active.indexBindings.indexes, candidate.indexBindings.indexes, changes);
  changes.sort(compareChanges);

  const policies = changes.map(changePolicy);
  const identity = policies.some((policy) => policy.identityRisk)
      || hasAmbiguousReplacement(changes)
    ? "requiresExplicitIntent"
    : "consistent";
  const dataCompatibility = policies.some((policy) => policy.dataValidation)
    ? "requiresDataValidation"
    : "universallyCompatible";
  const physicalRequirements = policies.some((policy) => policy.physicalWork)
    ? "requiresBuildOrRetirement"
    : "unchanged";
  const disposition = identity === "requiresExplicitIntent"
    ? "blocked"
    : dataCompatibility === "requiresDataValidation"
      || physicalRequirements === "requiresBuildOrRetirement"
    ? "managedBuildAndValidation"
    : "safeMetadataActivation";

  return Object.freeze({
    disposition,
    dataCompatibility,
    physicalRequirements,
    identity,
    changes: Object.freeze(changes),
  });
}

export function classifyValidatorCompatibility(
  active: ValidatorJsonV1,
  candidate: ValidatorJsonV1,
): ValidatorCompatibility {
  return compareValidator(
    active,
    candidate,
    "$document",
    { remaining: MAX_VALIDATOR_COMPATIBILITY_COMPARISONS },
  );
}

function classifyIndexChanges(
  active: ReadonlyArray<SchemaManifestAppIndexBindingV1>,
  candidate: ReadonlyArray<SchemaManifestAppIndexBindingV1>,
  changes: AppSchemaEvolutionChange[],
): void {
  const activeById = new Map(active.map((index) =>
    [index.logicalIndexId, index] as const
  ));
  const candidateById = new Map(candidate.map((index) =>
    [index.logicalIndexId, index] as const
  ));
  const candidateByDescriptor = new Map(candidate.map((index) =>
    [indexDescriptorKey(index), index] as const
  ));

  for (const activeIndex of active) {
    const candidateForDescriptor = candidateByDescriptor.get(
      indexDescriptorKey(activeIndex),
    );
    if (
      candidateForDescriptor !== undefined
      && candidateForDescriptor.logicalIndexId !== activeIndex.logicalIndexId
    ) {
      changes.push(Object.freeze({
        kind: "indexIdentityChanged",
        tableId: activeIndex.tableId,
        descriptor: activeIndex.descriptor,
        activeLogicalIndexId: activeIndex.logicalIndexId,
        candidateLogicalIndexId: candidateForDescriptor.logicalIndexId,
      }));
    }

    const candidateIndex = candidateById.get(activeIndex.logicalIndexId);
    if (candidateIndex === undefined) {
      changes.push(indexPresenceChange("indexRemoved", activeIndex));
      continue;
    }
    if (!indexBindingsEqual(activeIndex, candidateIndex)) {
      changes.push(Object.freeze({
        kind: "indexDefinitionChanged",
        logicalIndexId: activeIndex.logicalIndexId,
        activeTableId: activeIndex.tableId,
        candidateTableId: candidateIndex.tableId,
        activeDescriptor: activeIndex.descriptor,
        candidateDescriptor: candidateIndex.descriptor,
      }));
    }
  }

  for (const candidateIndex of candidate) {
    if (!activeById.has(candidateIndex.logicalIndexId)) {
      changes.push(indexPresenceChange("indexAdded", candidateIndex));
    }
  }
}

function compareValidator(
  active: ValidatorJsonV1,
  candidate: ValidatorJsonV1,
  path: string,
  budget: CompatibilityBudget,
): ValidatorCompatibility {
  if (budget.remaining === 0) {
    return validationRequired("comparisonBudgetExceeded", path);
  }
  budget.remaining -= 1;

  if (candidate.type === "any") return UNIVERSALLY_COMPATIBLE;

  if (active.type === "union") {
    for (const [index, member] of active.value.entries()) {
      const result = compareValidator(
        member,
        candidate,
        `${path}<activeUnion:${index}>`,
        budget,
      );
      if (result.disposition !== "universallyCompatible") return result;
    }
    return UNIVERSALLY_COMPATIBLE;
  }

  if (candidate.type === "union") {
    let budgetFailure: ValidatorCompatibility | undefined;
    for (const member of candidate.value) {
      const result = compareValidator(active, member, path, budget);
      if (result.disposition === "universallyCompatible") return result;
      if (result.reason === "comparisonBudgetExceeded") budgetFailure = result;
    }
    return budgetFailure ?? validationRequired("narrowingOrUnknown", path);
  }

  if (active.type === "literal") {
    if (candidate.type === "literal") {
      return literalValuesEqual(active.value, candidate.value)
        ? UNIVERSALLY_COMPATIBLE
        : validationRequired("narrowingOrUnknown", path);
    }
    return literalMatchesPrimitive(active.value, candidate.type)
      ? UNIVERSALLY_COMPATIBLE
      : validationRequired("narrowingOrUnknown", path);
  }

  if (active.type === "id" && candidate.type === "string") {
    return UNIVERSALLY_COMPATIBLE;
  }
  if (active.type !== candidate.type) {
    return validationRequired("narrowingOrUnknown", path);
  }

  switch (active.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
      return UNIVERSALLY_COMPATIBLE;
    case "id":
      return candidate.type === "id" && active.tableName === candidate.tableName
        ? UNIVERSALLY_COMPATIBLE
        : validationRequired("narrowingOrUnknown", path);
    case "array":
      return candidate.type === "array"
        ? compareValidator(active.value, candidate.value, `${path}[]`, budget)
        : validationRequired("narrowingOrUnknown", path);
    case "record": {
      if (candidate.type !== "record") {
        return validationRequired("narrowingOrUnknown", path);
      }
      const keys = compareValidator(
        active.keys,
        candidate.keys,
        `${path}<key>`,
        budget,
      );
      return keys.disposition === "universallyCompatible"
        ? compareValidator(
            active.values,
            candidate.values,
            `${path}<value>`,
            budget,
          )
        : keys;
    }
    case "object":
      return candidate.type === "object"
        ? compareObjectValidator(active, candidate, path, budget)
        : validationRequired("narrowingOrUnknown", path);
  }
}

function compareObjectValidator(
  active: Extract<ValidatorJsonV1, { readonly type: "object" }>,
  candidate: Extract<ValidatorJsonV1, { readonly type: "object" }>,
  path: string,
  budget: CompatibilityBudget,
): ValidatorCompatibility {
  const candidateFieldNames = Object.keys(candidate.value).sort(compareStrings);
  for (const fieldName of candidateFieldNames) {
    const candidateField = candidate.value[fieldName];
    if (candidateField === undefined) return decodedValidatorInvariant();
    if (
      !Object.hasOwn(active.value, fieldName)
      && !candidateField.optional
    ) {
      return validationRequired(
        "narrowingOrUnknown",
        appendFieldPath(path, fieldName),
      );
    }
  }

  const activeFieldNames = Object.keys(active.value).sort(compareStrings);
  for (const fieldName of activeFieldNames) {
    const activeField = active.value[fieldName];
    const candidateField = candidate.value[fieldName];
    const fieldPath = appendFieldPath(path, fieldName);
    if (activeField === undefined) return decodedValidatorInvariant();
    if (candidateField === undefined) {
      return validationRequired("narrowingOrUnknown", fieldPath);
    }
    if (activeField.optional && !candidateField.optional) {
      return validationRequired("narrowingOrUnknown", fieldPath);
    }
    const fieldCompatibility = compareValidator(
      activeField.fieldType,
      candidateField.fieldType,
      fieldPath,
      budget,
    );
    if (fieldCompatibility.disposition !== "universallyCompatible") {
      return fieldCompatibility;
    }
  }
  return UNIVERSALLY_COMPATIBLE;
}

function validatorJsonStructuralEquality(
  left: ValidatorJsonV1,
  right: ValidatorJsonV1,
  budget: CompatibilityBudget,
): StructuralEquality {
  if (left === right) return "equal";
  if (budget.remaining === 0) return "comparisonBudgetExceeded";
  budget.remaining -= 1;
  if (left.type !== right.type) return "different";
  switch (left.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return "equal";
    case "id":
      return right.type === "id" && left.tableName === right.tableName
        ? "equal"
        : "different";
    case "literal":
      return right.type === "literal"
        && literalValuesEqual(left.value, right.value)
        ? "equal"
        : "different";
    case "array":
      return right.type === "array"
        ? validatorJsonStructuralEquality(left.value, right.value, budget)
        : "different";
    case "record": {
      if (right.type !== "record") return "different";
      const keys = validatorJsonStructuralEquality(left.keys, right.keys, budget);
      return keys === "equal"
        ? validatorJsonStructuralEquality(left.values, right.values, budget)
        : keys;
    }
    case "union": {
      if (right.type !== "union" || left.value.length !== right.value.length) {
        return "different";
      }
      for (const [index, member] of left.value.entries()) {
        const rightMember = right.value[index];
        if (rightMember === undefined) return "different";
        const equality = validatorJsonStructuralEquality(
          member,
          rightMember,
          budget,
        );
        if (equality !== "equal") return equality;
      }
      return "equal";
    }
    case "object": {
      if (right.type !== "object") return "different";
      const leftKeys = Object.keys(left.value).sort(compareStrings);
      const rightKeys = Object.keys(right.value).sort(compareStrings);
      if (leftKeys.length !== rightKeys.length) return "different";
      for (const [index, fieldName] of leftKeys.entries()) {
        if (fieldName !== rightKeys[index]) return "different";
        const leftField = left.value[fieldName];
        const rightField = right.value[fieldName];
        if (
          leftField === undefined
          || rightField === undefined
          || leftField.optional !== rightField.optional
        ) return "different";
        const equality = validatorJsonStructuralEquality(
          leftField.fieldType,
          rightField.fieldType,
          budget,
        );
        if (equality !== "equal") return equality;
      }
      return "equal";
    }
  }
}

function indexBindingsEqual(
  left: SchemaManifestAppIndexBindingV1,
  right: SchemaManifestAppIndexBindingV1,
): boolean {
  return left.logicalIndexId === right.logicalIndexId
    && left.tableId === right.tableId
    && left.namespace === right.namespace
    && left.descriptor === right.descriptor
    && left.spec.kind === right.spec.kind
    && left.spec.specVersion === right.spec.specVersion
    && left.spec.fields.length === right.spec.fields.length
    && left.spec.fields.every((field, index) => field === right.spec.fields[index]);
}

function indexPresenceChange(
  kind: "indexAdded" | "indexRemoved",
  index: SchemaManifestAppIndexBindingV1,
): AppSchemaEvolutionChange {
  return Object.freeze({
    kind,
    logicalIndexId: index.logicalIndexId,
    tableId: index.tableId,
    descriptor: index.descriptor,
  });
}

function indexDescriptorKey(index: SchemaManifestAppIndexBindingV1): string {
  return `${index.tableId}\u0000${index.descriptor}`;
}

function literalMatchesPrimitive(
  value: string | number | boolean,
  candidateType: ValidatorJsonV1["type"],
): boolean {
  return candidateType === "string"
    ? typeof value === "string"
    : candidateType === "number"
    ? typeof value === "number"
    : candidateType === "boolean" && typeof value === "boolean";
}

function literalValuesEqual(
  left: string | number | boolean,
  right: string | number | boolean,
): boolean {
  return typeof left === "number" && typeof right === "number"
    ? Object.is(left, right)
    : left === right;
}

function validationRequired(
  reason: Extract<
    ValidatorCompatibility,
    { readonly disposition: "requiresDataValidation" }
  >["reason"],
  path: string,
): ValidatorCompatibility {
  return Object.freeze({
    disposition: "requiresDataValidation",
    reason,
    path,
  });
}

function changePolicy(change: AppSchemaEvolutionChange): Readonly<{
  identityRisk: boolean;
  dataValidation: boolean;
  physicalWork: boolean;
}> {
  switch (change.kind) {
    case "tableAdded":
      return policy(false, false, false);
    case "tableRemoved":
      return policy(false, true, false);
    case "tableIdentityChanged":
    case "tableLogicalNameChanged":
      return policy(true, false, false);
    case "tableValidatorChanged":
      return policy(
        false,
        change.compatibility.disposition === "requiresDataValidation",
        false,
      );
    case "indexAdded":
    case "indexRemoved":
      return policy(false, false, true);
    case "indexIdentityChanged":
      return policy(true, false, true);
    case "indexDefinitionChanged":
      return policy(
        change.activeTableId !== change.candidateTableId
          || change.activeDescriptor !== change.candidateDescriptor,
        false,
        true,
      );
    default:
      return assertNever(change);
  }
}

function policy(
  identityRisk: boolean,
  dataValidation: boolean,
  physicalWork: boolean,
): Readonly<{
  identityRisk: boolean;
  dataValidation: boolean;
  physicalWork: boolean;
}> {
  return { identityRisk, dataValidation, physicalWork };
}

function hasAmbiguousReplacement(
  changes: ReadonlyArray<AppSchemaEvolutionChange>,
): boolean {
  const hasTableRemoval = changes.some((change) =>
    change.kind === "tableRemoved"
  );
  if (
    hasTableRemoval
    && changes.some((change) => change.kind === "tableAdded")
  ) return true;

  const removedIndexTables = new Set(
    changes.flatMap((change) =>
      change.kind === "indexRemoved" ? [change.tableId] : []
    ),
  );
  return changes.some((change) =>
    change.kind === "indexAdded" && removedIndexTables.has(change.tableId)
  );
}

function compareChanges(
  left: AppSchemaEvolutionChange,
  right: AppSchemaEvolutionChange,
): number {
  return compareStrings(changeSortKey(left), changeSortKey(right));
}

function changeSortKey(change: AppSchemaEvolutionChange): string {
  switch (change.kind) {
    case "tableAdded":
    case "tableRemoved":
    case "tableValidatorChanged":
      return `${change.kind}:${change.tableId}:${change.logicalName}`;
    case "tableIdentityChanged":
      return `${change.kind}:${change.logicalName}:${change.activeTableId}:${change.candidateTableId}`;
    case "tableLogicalNameChanged":
      return `${change.kind}:${change.tableId}:${change.activeLogicalName}:${change.candidateLogicalName}`;
    case "indexAdded":
    case "indexRemoved":
      return `${change.kind}:${change.logicalIndexId}:${change.tableId}:${change.descriptor}`;
    case "indexIdentityChanged":
      return `${change.kind}:${change.tableId}:${change.descriptor}:${change.activeLogicalIndexId}:${change.candidateLogicalIndexId}`;
    case "indexDefinitionChanged":
      return `${change.kind}:${change.logicalIndexId}:${change.activeTableId}:${change.candidateTableId}:${change.activeDescriptor}:${change.candidateDescriptor}`;
  }
}

function appendFieldPath(path: string, fieldName: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName)
    ? `${path}.${fieldName}`
    : `${path}[${JSON.stringify(fieldName)}]`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decodedValidatorInvariant(): never {
  throw new Error("Decoded ValidatorJsonV1 object lost an own field.");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled managed-schema change: ${String(value)}`);
}
