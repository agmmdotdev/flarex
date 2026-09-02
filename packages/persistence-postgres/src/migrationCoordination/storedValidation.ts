import {
  isBoundedPrivateValueIdentityText,
  isCanonicalPrivateValueInstant,
  isCanonicalPrivateValueNonNegativeInt64,
  isExactPrivateValueRecord,
  isPrivateValueSha256,
} from "../frameworkSchema/privateStoredValueShape";
import {
  isStoredRelationalPhysicalForeignKey,
  isStoredRelationalPhysicalIndex,
  isStoredRelationalPhysicalLayoutFrame,
  isStoredRelationalPhysicalTableProjection,
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS,
} from "../relationalSchema/physical/storedValidation";
import {
  RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
} from "../relationalSchema/physical/model";
import {
  FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
  FRAMEWORK_MIGRATION_PLAN_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_VERSION,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
} from "./model";
import {
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
} from "./targetNamespace";

const STEP_ID = /^step_[0-9a-f]{32}$/;
const PHYSICAL_IDENTIFIER = /^fxr[tcikfh]_[0-9a-v]{52}$/;

export type StoredMigrationNonEventKind =
  | "targetNamespace"
  | "plan"
  | "planAdmission"
  | "collisionHead"
  | "attemptStart"
  | "stepReceipt"
  | "attemptTerminal";

export function isStoredMigrationNonEventFrame(
  kind: StoredMigrationNonEventKind,
  input: unknown,
): boolean {
  switch (kind) {
    case "targetNamespace":
      return isStoredTargetNamespace(input);
    case "plan":
      return isStoredMigrationPlan(input);
    case "planAdmission":
      return isStoredPlanAdmission(input);
    case "collisionHead":
      return isStoredCollisionHead(input);
    case "attemptStart":
      return isStoredAttemptStart(input);
    case "stepReceipt":
      return isStoredStepReceipt(input);
    case "attemptTerminal":
      return isStoredAttemptTerminal(input);
  }
}

export function isStoredTargetNamespace(input: unknown): input is Readonly<{
  readonly deploymentId: string;
  readonly physicalDatabaseIdentity: string;
  readonly schemaName: string;
}> {
  return isExactPrivateValueRecord(input, [
    "format",
    "version",
    "deploymentId",
    "physicalDatabaseIdentity",
    "schemaName",
  ]) &&
    input.format === FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT &&
    input.version === FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION &&
    isBoundedPrivateValueIdentityText(input.deploymentId) &&
    isBoundedPrivateValueIdentityText(input.physicalDatabaseIdentity) &&
    isBoundedPrivateValueIdentityText(input.schemaName, 63);
}

export function isStoredArtifactIdentity(input: unknown): input is Readonly<{
  readonly deploymentId: string;
  readonly owner: "system" | "medusa";
  readonly lineageId: string;
  readonly artifactSha256: string;
}> {
  return isExactPrivateValueRecord(input, [
    "deploymentId",
    "owner",
    "lineageId",
    "artifactSha256",
  ]) &&
    isBoundedPrivateValueIdentityText(input.deploymentId) &&
    isOwner(input.owner) &&
    isBoundedPrivateValueIdentityText(input.lineageId) &&
    isPrivateValueSha256(input.artifactSha256);
}

export function isStoredPhysicalLocator(input: unknown): input is Readonly<{
  readonly kind: string;
  readonly databaseKey: string;
  readonly schemaName: string;
}> {
  return isExactPrivateValueRecord(input, [
    "kind",
    "databaseKey",
    "schemaName",
  ]) &&
    (input.kind === "shared_database" ||
      input.kind === "schema_per_scope" ||
      input.kind === "database_per_scope") &&
    isBoundedPrivateValueIdentityText(input.databaseKey) &&
    isBoundedPrivateValueIdentityText(input.schemaName, 63);
}

export function isStoredCollisionCoordinate(input: unknown): input is Readonly<{
  readonly targetNamespace: Readonly<{
    readonly deploymentId: string;
    readonly physicalDatabaseIdentity: string;
    readonly schemaName: string;
  }>;
  readonly owner: "system" | "medusa";
  readonly lineageId: string;
  readonly physicalNamespaceProfile: string;
}> {
  return isExactPrivateValueRecord(input, [
    "targetNamespace",
    "owner",
    "lineageId",
    "physicalNamespaceProfile",
  ]) &&
    isStoredTargetNamespace(input.targetNamespace) &&
    isOwner(input.owner) &&
    isBoundedPrivateValueIdentityText(input.lineageId) &&
    input.physicalNamespaceProfile === RELATIONAL_PHYSICAL_NAMESPACE_PROFILE;
}

function isStoredMigrationPlan(input: unknown): boolean {
  if (
    !isExactPrivateValueRecord(input, [
      "format",
      "version",
      "artifact",
      "physicalLocator",
      "targetNamespace",
      "collision",
      "baseInstallation",
      "physicalLayout",
      "physicalLayoutSha256",
      "steps",
    ]) ||
    input.format !== FRAMEWORK_MIGRATION_PLAN_FORMAT ||
    input.version !== FRAMEWORK_MIGRATION_PLAN_VERSION ||
    !isStoredArtifactIdentity(input.artifact) ||
    input.artifact.owner !== "system" ||
    !isStoredPhysicalLocator(input.physicalLocator) ||
    !isStoredTargetNamespace(input.targetNamespace) ||
    !isStoredCollisionCoordinate(input.collision) ||
    input.baseInstallation !== null ||
    !isStoredRelationalPhysicalLayoutFrame(input.physicalLayout) ||
    !isPrivateValueSha256(input.physicalLayoutSha256) ||
    !Array.isArray(input.steps) ||
    input.steps.length < 1 ||
    input.steps.length > 66_000
  ) return false;
  if (
    input.artifact.deploymentId !== input.targetNamespace.deploymentId ||
    input.physicalLocator.schemaName !== input.targetNamespace.schemaName ||
    !sameTarget(input.collision.targetNamespace, input.targetNamespace) ||
    input.collision.owner !== input.artifact.owner ||
    input.collision.lineageId !== input.artifact.lineageId ||
    !sameArtifact(input.artifact, input.physicalLayout.artifact) ||
    !samePhysicalLocator(
      input.physicalLocator,
      input.physicalLayout.physicalLocator,
    ) ||
    !sameTarget(input.targetNamespace, input.physicalLayout.targetNamespace)
  ) return false;
  const prior = new Map<string, string>();
  const digests = new Set<string>();
  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    if (!isStoredMigrationStep(step) || step.ordinal !== index) return false;
    if (prior.has(step.stepId) || digests.has(step.stepSha256)) {
      return false;
    }
    const dependencyIds = new Set<string>();
    for (const dependency of step.dependencies) {
      if (!isExactPrivateValueRecord(dependency, ["stepId", "stepSha256"]) ||
        typeof dependency.stepId !== "string" ||
        dependencyIds.has(dependency.stepId) ||
        prior.get(dependency.stepId) !== dependency.stepSha256) {
        return false;
      }
      dependencyIds.add(dependency.stepId);
    }
    prior.set(step.stepId, step.stepSha256);
    digests.add(step.stepSha256);
  }
  return input.steps.at(-1)?.operation.codec.format ===
      "flarex.relational-validate-structure" &&
    planMatchesPhysicalLayout(input);
}

function planMatchesPhysicalLayout(
  input: Readonly<Record<string, unknown>>,
): boolean {
  if (!isStoredRelationalPhysicalLayoutFrame(input.physicalLayout) ||
    !Array.isArray(input.physicalLayout.tables) ||
    !Array.isArray(input.physicalLayout.foreignKeys) ||
    !Array.isArray(input.steps)) return false;
  const steps = input.steps;
  const tableSteps = new Map<string, Readonly<{
    readonly stepId: string;
    readonly stepSha256: string;
  }>>();
  let cursor = 0;
  for (const table of input.physicalLayout.tables) {
    const step = steps[cursor];
    const tableId = physicalTableId(table);
    if (tableId === undefined || !isStoredMigrationStep(step) ||
      step.operation.codec.format !== "flarex.relational-create-table" ||
      !isExactPrivateValueRecord(table, [
        "identity", "name", "scopeColumn", "columns", "keys", "checks",
        "indexes",
      ]) ||
      !samePrivateJson(step.operation.table, {
        identity: table.identity,
        name: table.name,
        scopeColumn: table.scopeColumn,
        columns: table.columns,
        keys: table.keys,
        checks: table.checks,
      }) ||
      !sameStepReferences(step.dependencies, [])) return false;
    tableSteps.set(tableId, storedStepReference(step));
    cursor += 1;
  }
  for (const table of input.physicalLayout.tables) {
    if (!isExactPrivateValueRecord(table, [
      "identity", "name", "scopeColumn", "columns", "keys", "checks",
      "indexes",
    ]) || !Array.isArray(table.indexes)) return false;
    for (const index of table.indexes) {
      const step = steps[cursor];
      const tableId = physicalIndexTableId(index);
      const tableStep = tableId === undefined
        ? undefined
        : tableSteps.get(tableId);
      if (tableStep === undefined || !isStoredMigrationStep(step) ||
        step.operation.codec.format !== "flarex.relational-create-index" ||
        !samePrivateJson(step.operation.index, index) ||
        !sameStepReferences(step.dependencies, [tableStep])) return false;
      cursor += 1;
    }
  }
  for (const foreignKey of input.physicalLayout.foreignKeys) {
    const step = steps[cursor];
    const dependencies = physicalForeignKeyDependencies(
      foreignKey,
      tableSteps,
    );
    if (dependencies === undefined || !isStoredMigrationStep(step) ||
      step.operation.codec.format !==
        "flarex.relational-add-foreign-key" ||
      !samePrivateJson(step.operation.foreignKey, foreignKey) ||
      !sameStepReferences(step.dependencies, dependencies)) return false;
    cursor += 1;
  }
  const validation = steps[cursor];
  if (!isStoredMigrationStep(validation) ||
    validation.operation.codec.format !==
      "flarex.relational-validate-structure" ||
    validation.operation.expectedLayoutSha256 !==
      input.physicalLayoutSha256 ||
    !sameStepReferences(
      validation.dependencies,
      steps.slice(0, cursor).map(storedStepReference),
    )) return false;
  return cursor + 1 === steps.length;
}

function physicalTableId(input: unknown): string | undefined {
  if (!isExactPrivateValueRecord(input, [
    "identity", "name", "scopeColumn", "columns", "keys", "checks", "indexes",
  ]) || !isExactPrivateValueRecord(input.identity, [
    "owner", "lineageId", "tableId",
  ])) return undefined;
  return typeof input.identity.tableId === "string"
    ? input.identity.tableId
    : undefined;
}

function physicalIndexTableId(input: unknown): string | undefined {
  if (!isStoredRelationalPhysicalIndex(input) ||
    !isExactPrivateValueRecord(input, [
      "identity", "table", "name", "kind", "columns", "predicate",
    ]) || !isExactPrivateValueRecord(input.table, [
      "owner", "lineageId", "tableId",
    ])) return undefined;
  return typeof input.table.tableId === "string"
    ? input.table.tableId
    : undefined;
}

function physicalForeignKeyDependencies(
  input: unknown,
  tableSteps: ReadonlyMap<string, Readonly<{
    readonly stepId: string;
    readonly stepSha256: string;
  }>>,
): readonly Readonly<{
  readonly stepId: string;
  readonly stepSha256: string;
}>[] | undefined {
  if (!isStoredRelationalPhysicalForeignKey(input) ||
    !isExactPrivateValueRecord(input, physicalForeignKeyKeys(input))) {
    return undefined;
  }
  if (input.kind === "scopeAuthorityForeignKey") {
    const tableId = tableIdentityId(input.table);
    const source = tableId === undefined ? undefined : tableSteps.get(tableId);
    return source === undefined ? undefined : [source];
  }
  if (input.kind !== "foreignKey") return undefined;
  const sourceId = tableIdentityId(input.sourceTable);
  const targetId = tableIdentityId(input.targetTable);
  const source = sourceId === undefined ? undefined : tableSteps.get(sourceId);
  const target = targetId === undefined ? undefined : tableSteps.get(targetId);
  if (source === undefined || target === undefined) return undefined;
  return source.stepId === target.stepId
    ? [source]
    : [source, target].toSorted((left, right) =>
        compareStrings(left.stepId, right.stepId)
      );
}

function physicalForeignKeyKeys(input: unknown): readonly string[] {
  return readOwnDataValue(input, "kind") === "scopeAuthorityForeignKey"
    ? [
        "kind", "table", "name", "sourceColumns", "targetTable",
        "targetColumns", "onDelete", "onUpdate",
      ]
    : [
        "kind", "identity", "sourceTable", "name", "sourceColumns",
        "targetTable", "targetTableName", "targetColumns", "onDelete",
        "onUpdate",
      ];
}

function tableIdentityId(input: unknown): string | undefined {
  return isExactPrivateValueRecord(input, ["owner", "lineageId", "tableId"]) &&
      typeof input.tableId === "string"
    ? input.tableId
    : undefined;
}

function storedStepReference(
  step: Readonly<{ readonly stepId: string; readonly stepSha256: string }>,
) {
  return {
    stepId: step.stepId,
    stepSha256: step.stepSha256,
  } satisfies Readonly<{
    readonly stepId: string;
    readonly stepSha256: string;
  }>;
}

function sameStepReferences(
  actual: readonly unknown[],
  expected: readonly Readonly<{
    readonly stepId: string;
    readonly stepSha256: string;
  }>[],
): boolean {
  return actual.length === expected.length && actual.every((candidate, index) =>
    isExactPrivateValueRecord(candidate, ["stepId", "stepSha256"]) &&
    candidate.stepId === expected[index]?.stepId &&
    candidate.stepSha256 === expected[index]?.stepSha256
  );
}

function samePrivateJson(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  try {
    while (pending.length > 0) {
      const pair = pending.pop();
      if (pair === undefined) continue;
      const [leftValue, rightValue] = pair;
      if (Object.is(leftValue, rightValue)) continue;
      if (leftValue === null || rightValue === null ||
        typeof leftValue !== "object" || typeof rightValue !== "object") {
        return false;
      }
      const leftArray = Array.isArray(leftValue);
      if (leftArray !== Array.isArray(rightValue)) return false;
      if (leftArray && Array.isArray(rightValue)) {
        if (leftValue.length !== rightValue.length) return false;
        for (let index = 0; index < leftValue.length; index += 1) {
          pending.push([leftValue[index], rightValue[index]]);
        }
        continue;
      }
      const leftKeys = Object.keys(leftValue).toSorted(compareStrings);
      const rightKeys = Object.keys(rightValue).toSorted(compareStrings);
      if (leftKeys.length !== rightKeys.length) return false;
      for (let index = 0; index < leftKeys.length; index += 1) {
        const key = leftKeys[index];
        if (key === undefined || key !== rightKeys[index]) return false;
        const leftDescriptor = Object.getOwnPropertyDescriptor(leftValue, key);
        const rightDescriptor = Object.getOwnPropertyDescriptor(rightValue, key);
        if (leftDescriptor === undefined || rightDescriptor === undefined ||
          !("value" in leftDescriptor) || !("value" in rightDescriptor)) {
          return false;
        }
        pending.push([leftDescriptor.value, rightDescriptor.value]);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readOwnDataValue(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  try {
    return Object.getOwnPropertyDescriptor(input, key)?.value;
  } catch {
    return undefined;
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStoredMigrationStep(input: unknown): input is Readonly<{
  readonly stepId: string;
  readonly stepSha256: string;
  readonly ordinal: number;
  readonly dependencies: readonly unknown[];
  readonly precondition: Readonly<Record<string, unknown>>;
  readonly preconditionSha256: string;
  readonly postcondition: Readonly<Record<string, unknown>>;
  readonly postconditionSha256: string;
  readonly operation: Readonly<Record<string, unknown>> & {
    readonly codec: Readonly<Record<string, unknown>>;
  };
}> {
  return isExactPrivateValueRecord(input, [
    "stepId",
    "stepSha256",
    "ordinal",
    "phase",
    "transactionMode",
    "dependencies",
    "precondition",
    "preconditionSha256",
    "postcondition",
    "postconditionSha256",
    "executionCapability",
    "replayPolicy",
    "checkpointPolicy",
    "operation",
  ]) &&
    typeof input.stepId === "string" && STEP_ID.test(input.stepId) &&
    isPrivateValueSha256(input.stepSha256) &&
    typeof input.ordinal === "number" &&
    Number.isSafeInteger(input.ordinal) && input.ordinal >= 0 &&
    (input.phase === "expansion" || input.phase === "validation") &&
    input.transactionMode === "transactionBound" &&
    Array.isArray(input.dependencies) &&
    input.dependencies.every(isStoredStepReference) &&
    isStoredCondition(input.precondition) &&
    isPrivateValueSha256(input.preconditionSha256) &&
    isStoredCondition(input.postcondition) &&
    isPrivateValueSha256(input.postconditionSha256) &&
    input.executionCapability ===
      "postgres-transactional-relational-structure" &&
    input.replayPolicy === "exactReceipt" &&
    input.checkpointPolicy === "afterStep" &&
    isStoredOperation(input.operation) &&
    operationMatchesStep(input);
}

function isStoredStepReference(input: unknown): boolean {
  return isExactPrivateValueRecord(input, ["stepId", "stepSha256"]) &&
    typeof input.stepId === "string" && STEP_ID.test(input.stepId) &&
    isPrivateValueSha256(input.stepSha256);
}

function isStoredCondition(input: unknown): input is Readonly<{
  readonly kind: string;
  readonly projectionKind: string;
  readonly projectionSha256: string;
}> {
  return isExactPrivateValueRecord(input, [
    "kind",
    "projectionKind",
    "projectionSha256",
  ]) &&
    (input.kind === "absentOrExact" || input.kind === "exact") &&
    (input.projectionKind === "table" || input.projectionKind === "index" ||
      input.projectionKind === "foreignKey" ||
      input.projectionKind === "layout") &&
    isPrivateValueSha256(input.projectionSha256);
}

function isStoredOperation(input: unknown): input is Readonly<
  Record<string, unknown>
> & { readonly codec: Readonly<Record<string, unknown>> } {
  if (!isExactPrivateValueRecord(input, operationKeys(input))) return false;
  if (!isExactPrivateValueRecord(input.codec, ["format", "version"]) ||
    input.codec.version !== 1) return false;
  switch (input.codec.format) {
    case "flarex.relational-create-table":
      return isStoredRelationalPhysicalTableProjection(input.table) &&
        isPrivateValueSha256(input.expectedTableSha256);
    case "flarex.relational-create-index":
      return isStoredRelationalPhysicalIndex(input.index) &&
        isPrivateValueSha256(input.expectedIndexSha256);
    case "flarex.relational-add-foreign-key":
      return isStoredRelationalPhysicalForeignKey(input.foreignKey) &&
        isPrivateValueSha256(input.expectedForeignKeySha256);
    case "flarex.relational-validate-structure":
      return isPrivateValueSha256(input.expectedLayoutSha256);
    default:
      return false;
  }
}

function operationKeys(input: unknown): readonly string[] {
  if (!isExactPrivateValueRecord(input, ["codec"]) &&
    !(input !== null && typeof input === "object" && !Array.isArray(input))) {
    return [];
  }
  const codec = Object.getOwnPropertyDescriptor(input, "codec")?.value;
  const format = codec !== null && typeof codec === "object"
    ? Object.getOwnPropertyDescriptor(codec, "format")?.value
    : undefined;
  switch (format) {
    case "flarex.relational-create-table":
      return ["codec", "table", "expectedTableSha256"];
    case "flarex.relational-create-index":
      return ["codec", "index", "expectedIndexSha256"];
    case "flarex.relational-add-foreign-key":
      return ["codec", "foreignKey", "expectedForeignKeySha256"];
    case "flarex.relational-validate-structure":
      return ["codec", "expectedLayoutSha256"];
    default:
      return [];
  }
}

function operationMatchesStep(
  step: Readonly<Record<string, unknown>>,
): boolean {
  if (!isStoredCondition(step.precondition) ||
    !isStoredCondition(step.postcondition) ||
    !isStoredOperation(step.operation)) return false;
  const format = step.operation.codec.format;
  const expected = operationProjection(format, step.operation);
  if (expected === undefined) return false;
  return step.phase === expected.phase &&
    step.precondition.kind === expected.preconditionKind &&
    step.precondition.projectionKind === expected.projectionKind &&
    step.precondition.projectionSha256 === expected.projectionSha256 &&
    step.postcondition.kind === "exact" &&
    step.postcondition.projectionKind === expected.projectionKind &&
    step.postcondition.projectionSha256 === expected.projectionSha256;
}

function operationProjection(
  format: unknown,
  operation: Readonly<Record<string, unknown>>,
): Readonly<{
  readonly phase: "expansion" | "validation";
  readonly preconditionKind: "absentOrExact" | "exact";
  readonly projectionKind: "table" | "index" | "foreignKey" | "layout";
  readonly projectionSha256: string;
}> | undefined {
  switch (format) {
    case "flarex.relational-create-table":
      return isPrivateValueSha256(operation.expectedTableSha256)
        ? { phase: "expansion", preconditionKind: "absentOrExact",
            projectionKind: "table",
            projectionSha256: operation.expectedTableSha256 }
        : undefined;
    case "flarex.relational-create-index":
      return isPrivateValueSha256(operation.expectedIndexSha256)
        ? { phase: "expansion", preconditionKind: "absentOrExact",
            projectionKind: "index",
            projectionSha256: operation.expectedIndexSha256 }
        : undefined;
    case "flarex.relational-add-foreign-key":
      return isPrivateValueSha256(operation.expectedForeignKeySha256)
        ? { phase: "expansion", preconditionKind: "absentOrExact",
            projectionKind: "foreignKey",
            projectionSha256: operation.expectedForeignKeySha256 }
        : undefined;
    case "flarex.relational-validate-structure":
      return isPrivateValueSha256(operation.expectedLayoutSha256)
        ? { phase: "validation", preconditionKind: "exact",
            projectionKind: "layout",
            projectionSha256: operation.expectedLayoutSha256 }
        : undefined;
    default:
      return undefined;
  }
}

function isStoredPlanAdmission(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "format", "version", "collision", "planSha256", "artifact",
    "physicalLocator", "targetNamespace", "baseInstallation",
    "nameAssignments", "previousPlanSha256", "admissionProfile",
    "admittedAt",
  ]) &&
    input.format === FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT &&
    input.version === FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION &&
    isStoredCollisionCoordinate(input.collision) &&
    isPrivateValueSha256(input.planSha256) &&
    isStoredArtifactIdentity(input.artifact) &&
    input.artifact.owner === "system" &&
    isStoredPhysicalLocator(input.physicalLocator) &&
    isStoredTargetNamespace(input.targetNamespace) &&
    input.baseInstallation === null &&
    isNameAssignmentReferenceSet(input.nameAssignments) &&
    (input.previousPlanSha256 === null ||
      isPrivateValueSha256(input.previousPlanSha256)) &&
    input.admissionProfile === "synthetic-system-fresh" &&
    isCanonicalPrivateValueInstant(input.admittedAt) &&
    sameCoordinateFields(input);
}

function isNameAssignmentReference(input: unknown): input is Readonly<{
  readonly spelling: string;
  readonly assignmentSha256: string;
}> {
  return isExactPrivateValueRecord(input, ["spelling", "assignmentSha256"]) &&
    typeof input.spelling === "string" &&
    PHYSICAL_IDENTIFIER.test(input.spelling) &&
    isPrivateValueSha256(input.assignmentSha256);
}

function isNameAssignmentReferenceSet(input: unknown): boolean {
  if (!Array.isArray(input) || input.length < 1 ||
    input.length > MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS) return false;
  const digests = new Set<string>();
  let previousSpelling: string | undefined;
  for (const reference of input) {
    if (!isNameAssignmentReference(reference) ||
      (previousSpelling !== undefined &&
        compareStrings(previousSpelling, reference.spelling) >= 0) ||
      digests.has(reference.assignmentSha256)) return false;
    previousSpelling = reference.spelling;
    digests.add(reference.assignmentSha256);
  }
  return true;
}

function isStoredCollisionHead(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "format", "version", "collision", "headRevision", "currentPlan",
    "attemptFence", "currentAttempt", "lastEvent", "updatedAt",
  ]) &&
    input.format === FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT &&
    input.version === FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION &&
    isStoredCollisionCoordinate(input.collision) &&
    isCanonicalPrivateValueNonNegativeInt64(input.headRevision) &&
    isExactPrivateValueRecord(input.currentPlan, [
      "planSha256", "admissionSha256",
    ]) &&
    isPrivateValueSha256(input.currentPlan.planSha256) &&
    isPrivateValueSha256(input.currentPlan.admissionSha256) &&
    isCanonicalPrivateValueNonNegativeInt64(input.attemptFence) &&
    isCurrentAttemptOrNull(input.currentAttempt) &&
    (input.currentAttempt === null ||
      input.currentAttempt.attemptFence === input.attemptFence) &&
    isEventTokenOrNull(input.lastEvent) &&
    isCanonicalPrivateValueInstant(input.updatedAt);
}

function isCurrentAttemptOrNull(input: unknown): input is null | Readonly<{
  readonly attemptId: string;
  readonly attemptFence: string;
  readonly leaseOwnerId: string;
  readonly leaseExpiresAt: string;
}> {
  return input === null ||
    (isExactPrivateValueRecord(input, [
      "attemptId", "attemptFence", "leaseOwnerId", "leaseExpiresAt",
    ]) &&
      isBoundedPrivateValueIdentityText(input.attemptId) &&
      isCanonicalPrivateValueNonNegativeInt64(input.attemptFence) &&
      isBoundedPrivateValueIdentityText(input.leaseOwnerId) &&
      isCanonicalPrivateValueInstant(input.leaseExpiresAt));
}

function isEventTokenOrNull(input: unknown): boolean {
  return input === null ||
    (isExactPrivateValueRecord(input, ["sequence", "eventSha256"]) &&
      isCanonicalPrivateValueNonNegativeInt64(input.sequence) &&
      isPrivateValueSha256(input.eventSha256));
}

function isStoredAttemptStart(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "format", "version", "collision", "planSha256", "admissionSha256",
    "attemptId", "attemptFence", "leaseOwnerId", "leaseExpiresAt",
    "previousAttemptId", "startedAt",
  ]) &&
    input.format === FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT &&
    input.version === FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION &&
    isStoredCollisionCoordinate(input.collision) &&
    isPrivateValueSha256(input.planSha256) &&
    isPrivateValueSha256(input.admissionSha256) &&
    isBoundedPrivateValueIdentityText(input.attemptId) &&
    isCanonicalPrivateValueNonNegativeInt64(input.attemptFence) &&
    isBoundedPrivateValueIdentityText(input.leaseOwnerId) &&
    isCanonicalPrivateValueInstant(input.leaseExpiresAt) &&
    (input.previousAttemptId === null ||
      isBoundedPrivateValueIdentityText(input.previousAttemptId)) &&
    isCanonicalPrivateValueInstant(input.startedAt);
}

function isStoredStepReceipt(input: unknown): boolean {
  if (!isExactPrivateValueRecord(input, [
    "format", "version", "collision", "planSha256", "attemptId",
    "attemptFence", "stepId", "stepSha256", "dependencyReceipts",
    "preconditionSha256", "postconditionSha256",
    "observedPostconditionSha256", "completedAt",
  ]) ||
    input.format !== FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT ||
    input.version !== FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION ||
    !isStoredCollisionCoordinate(input.collision) ||
    !isPrivateValueSha256(input.planSha256) ||
    !isBoundedPrivateValueIdentityText(input.attemptId) ||
    !isCanonicalPrivateValueNonNegativeInt64(input.attemptFence) ||
    typeof input.stepId !== "string" || !STEP_ID.test(input.stepId) ||
    !isPrivateValueSha256(input.stepSha256) ||
    !Array.isArray(input.dependencyReceipts) ||
    !isPrivateValueSha256(input.preconditionSha256) ||
    !isPrivateValueSha256(input.postconditionSha256) ||
    input.observedPostconditionSha256 !== input.postconditionSha256 ||
    !isCanonicalPrivateValueInstant(input.completedAt)) return false;
  const ids = new Set<string>();
  let previousStepId: string | undefined;
  for (const receipt of input.dependencyReceipts) {
    if (!isExactPrivateValueRecord(receipt, [
      "stepId", "stepReceiptSha256",
    ]) || typeof receipt.stepId !== "string" ||
      !STEP_ID.test(receipt.stepId) ||
      !isPrivateValueSha256(receipt.stepReceiptSha256) ||
      ids.has(receipt.stepId) ||
      (previousStepId !== undefined &&
        compareStrings(previousStepId, receipt.stepId) >= 0)) return false;
    ids.add(receipt.stepId);
    previousStepId = receipt.stepId;
  }
  return true;
}

function isStoredAttemptTerminal(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "format", "version", "collision", "planSha256", "attemptId",
    "attemptFence", "outcome", "lastStepReceiptSha256", "terminalAt",
  ]) &&
    input.format === FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT &&
    input.version === FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION &&
    isStoredCollisionCoordinate(input.collision) &&
    isPrivateValueSha256(input.planSha256) &&
    isBoundedPrivateValueIdentityText(input.attemptId) &&
    isCanonicalPrivateValueNonNegativeInt64(input.attemptFence) &&
    isAttemptOutcome(input.outcome) &&
    (input.lastStepReceiptSha256 === null ||
      isPrivateValueSha256(input.lastStepReceiptSha256)) &&
    (input.outcome.kind !== "succeeded" ||
      input.lastStepReceiptSha256 !== null) &&
    isCanonicalPrivateValueInstant(input.terminalAt);
}

function isAttemptOutcome(input: unknown): input is Readonly<{
  readonly kind: string;
}> {
  return (isExactPrivateValueRecord(input, [
    "kind", "requiredStepSetSha256",
  ]) && input.kind === "succeeded" &&
    isPrivateValueSha256(input.requiredStepSetSha256)) ||
    (isExactPrivateValueRecord(input, [
      "kind", "reason", "evidenceSha256",
    ]) && input.kind === "failed" &&
      (input.reason === "operationFailed" ||
        input.reason === "validationFailed" ||
        input.reason === "leaseLost" || input.reason === "superseded") &&
      isPrivateValueSha256(input.evidenceSha256)) ||
    (isExactPrivateValueRecord(input, ["kind", "evidenceSha256"]) &&
      input.kind === "decisionUncertain" &&
      isPrivateValueSha256(input.evidenceSha256));
}

function sameCoordinateFields(
  input: Readonly<Record<string, unknown>>,
): boolean {
  if (!isStoredArtifactIdentity(input.artifact) ||
    !isStoredPhysicalLocator(input.physicalLocator) ||
    !isStoredTargetNamespace(input.targetNamespace) ||
    !isStoredCollisionCoordinate(input.collision)) return false;
  return input.artifact.deploymentId === input.targetNamespace.deploymentId &&
    input.physicalLocator.schemaName === input.targetNamespace.schemaName &&
    sameTarget(input.collision.targetNamespace, input.targetNamespace) &&
    input.collision.owner === input.artifact.owner &&
    input.collision.lineageId === input.artifact.lineageId;
}

function sameTarget(left: unknown, right: unknown): boolean {
  return isStoredTargetNamespace(left) && isStoredTargetNamespace(right) &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

function sameArtifact(left: unknown, right: unknown): boolean {
  return isStoredArtifactIdentity(left) && isStoredArtifactIdentity(right) &&
    left.deploymentId === right.deploymentId &&
    left.owner === right.owner &&
    left.lineageId === right.lineageId &&
    left.artifactSha256 === right.artifactSha256;
}

function samePhysicalLocator(left: unknown, right: unknown): boolean {
  return isStoredPhysicalLocator(left) &&
    isStoredPhysicalLocator(right) &&
    left.kind === right.kind && left.databaseKey === right.databaseKey &&
    left.schemaName === right.schemaName;
}

function isOwner(input: unknown): input is "system" | "medusa" {
  return input === "system" || input === "medusa";
}
