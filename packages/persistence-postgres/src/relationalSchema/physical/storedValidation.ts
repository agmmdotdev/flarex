import {
  isBoundedPrivateValueIdentityText,
  isExactPrivateValueRecord,
  isPrivateValueSha256,
  isPrivateValueStringArray,
  isPrivateValueText,
} from "../../frameworkSchema/privateStoredValueShape";
import {
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
} from "../../migrationCoordination/targetNamespace";
import type { JsonObject } from "flarex-protocol/json";
import { compareUtf16Strings } from "@flarex/utils/strings";
import {
  MAX_RELATIONAL_SCHEMA_CAPABILITIES,
  MAX_RELATIONAL_SCHEMA_COLUMNS_PER_TABLE,
  MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE,
  MAX_RELATIONAL_SCHEMA_REFERENCE_COLUMNS,
  MAX_RELATIONAL_SCHEMA_TABLES,
} from "../policy";
import {
  RELATIONAL_PHYSICAL_ISOLATION_PROFILE,
  RELATIONAL_PHYSICAL_LAYOUT_FORMAT,
  RELATIONAL_PHYSICAL_LAYOUT_VERSION,
  RELATIONAL_PHYSICAL_LOWERING_PROFILE,
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
  RELATIONAL_PHYSICAL_NAME_FORMAT,
  RELATIONAL_PHYSICAL_NAME_VERSION,
  RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  type RelationalPhysicalCapabilityEvidence,
  type RelationalPhysicalColumn,
  type RelationalPhysicalColumnReference,
  type RelationalPhysicalForeignKey,
  type RelationalPhysicalIndex,
  type RelationalPhysicalIntegerRangeCheck,
  type RelationalPhysicalKey,
  type RelationalPhysicalLayoutFrame,
  type RelationalPhysicalNameAssignmentFrame,
  type RelationalPhysicalNameSubject,
  type RelationalPhysicalRelationshipEvidence,
  type RelationalPhysicalTable,
} from "./model";

const PHYSICAL_IDENTIFIER = /^fxr[tcikfh]_[0-9a-v]{52}$/;
const EXACT_NUMERIC = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
const POSTGRES_INTEGER_MINIMUM = -2_147_483_648;
const POSTGRES_INTEGER_MAXIMUM = 2_147_483_647;
export const MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS =
  MAX_RELATIONAL_SCHEMA_TABLES *
  (2 + MAX_RELATIONAL_SCHEMA_COLUMNS_PER_TABLE +
    3 * MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE);
const MAX_RELATIONAL_PHYSICAL_FOREIGN_KEYS = MAX_RELATIONAL_SCHEMA_TABLES *
  (1 + MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE);
const MAX_RELATIONAL_PHYSICAL_RELATIONSHIPS =
  MAX_RELATIONAL_SCHEMA_TABLES * MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE;

export function isStoredRelationalPhysicalNameFrame(
  input: unknown,
): input is JsonObject {
  return isExactPrivateValueRecord(input, [
    "format",
    "version",
    "deploymentId",
    "owner",
    "lineageId",
    "subject",
    "physicalNamespaceProfile",
  ]) &&
    input.format === RELATIONAL_PHYSICAL_NAME_FORMAT &&
    input.version === RELATIONAL_PHYSICAL_NAME_VERSION &&
    isBoundedPrivateValueIdentityText(input.deploymentId) &&
    isOwner(input.owner) &&
    isBoundedPrivateValueIdentityText(input.lineageId) &&
    isPhysicalNameSubject(input.subject) &&
    input.subject.identity.owner === input.owner &&
    input.subject.identity.lineageId === input.lineageId &&
    input.physicalNamespaceProfile === RELATIONAL_PHYSICAL_NAMESPACE_PROFILE;
}

export function isStoredRelationalPhysicalNameAssignmentFrame(
  input: unknown,
): input is RelationalPhysicalNameAssignmentFrame {
  return isExactPrivateValueRecord(input, [
    "format",
    "version",
    "targetNamespace",
    "name",
    "nameSha256",
    "nameCanonicalJson",
    "spelling",
  ]) &&
    input.format === RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT &&
    input.version === RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION &&
    isTargetNamespace(input.targetNamespace) &&
    isStoredRelationalPhysicalNameFrame(input.name) &&
    input.targetNamespace.deploymentId === input.name.deploymentId &&
    isPrivateValueSha256(input.nameSha256) &&
    typeof input.nameCanonicalJson === "string" &&
    isPhysicalIdentifier(input.spelling) &&
    isExactPrivateValueRecord(input.name.subject, ["kind", "identity"]) &&
    spellingMatchesSubject(input.spelling, input.name.subject);
}

export function isStoredRelationalPhysicalLayoutFrame(
  input: unknown,
): input is RelationalPhysicalLayoutFrame {
  if (
    !isExactPrivateValueRecord(input, [
      "format",
      "version",
      "artifact",
      "physicalLocator",
      "targetNamespace",
      "profiles",
      "nameAssignments",
      "tables",
      "foreignKeys",
      "relationships",
      "requiredPhysicalCapabilities",
    ]) ||
    input.format !== RELATIONAL_PHYSICAL_LAYOUT_FORMAT ||
    input.version !== RELATIONAL_PHYSICAL_LAYOUT_VERSION ||
    !isArtifactIdentity(input.artifact) ||
    !isPhysicalLocator(input.physicalLocator) ||
    !isTargetNamespace(input.targetNamespace) ||
    input.artifact.deploymentId !== input.targetNamespace.deploymentId ||
    input.physicalLocator.schemaName !== input.targetNamespace.schemaName ||
    !isExactPrivateValueRecord(input.profiles, [
      "namespace",
      "lowering",
      "isolation",
    ]) ||
    input.profiles.namespace !== RELATIONAL_PHYSICAL_NAMESPACE_PROFILE ||
    input.profiles.lowering !== RELATIONAL_PHYSICAL_LOWERING_PROFILE ||
    input.profiles.isolation !== RELATIONAL_PHYSICAL_ISOLATION_PROFILE ||
    !isBoundedArrayOf(
      input.nameAssignments,
      0,
      MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS,
      isStoredRelationalPhysicalNameAssignmentFrame,
    ) ||
    !isBoundedArrayOf(
      input.tables,
      1,
      MAX_RELATIONAL_SCHEMA_TABLES,
      isStoredRelationalPhysicalTable,
    ) ||
    !isBoundedArrayOf(
      input.foreignKeys,
      1,
      MAX_RELATIONAL_PHYSICAL_FOREIGN_KEYS,
      isStoredRelationalPhysicalForeignKey,
    ) ||
    !isBoundedArrayOf(
      input.relationships,
      0,
      MAX_RELATIONAL_PHYSICAL_RELATIONSHIPS,
      isPhysicalRelationship,
    ) ||
    !isBoundedArrayOf(
      input.requiredPhysicalCapabilities,
      0,
      MAX_RELATIONAL_SCHEMA_CAPABILITIES,
      isStoredRelationalPhysicalCapability,
    ) ||
    !layoutCoordinatesMatch(input)
  ) {
    return false;
  }
  const spellings = new Set<string>();
  for (const assignment of input.nameAssignments) {
    if (!isStoredRelationalPhysicalNameAssignmentFrame(assignment) ||
      !isTargetNamespace(assignment.targetNamespace)) return false;
    if (
      assignment.targetNamespace.deploymentId !==
        input.targetNamespace.deploymentId ||
      assignment.targetNamespace.physicalDatabaseIdentity !==
        input.targetNamespace.physicalDatabaseIdentity ||
      assignment.targetNamespace.schemaName !== input.targetNamespace.schemaName ||
      typeof assignment.spelling !== "string" ||
      spellings.has(assignment.spelling)
    ) return false;
    spellings.add(assignment.spelling);
  }
  return validatePhysicalLayoutSemantics({
    nameAssignments: input.nameAssignments,
    tables: input.tables,
    foreignKeys: input.foreignKeys,
    relationships: input.relationships,
    requiredPhysicalCapabilities: input.requiredPhysicalCapabilities,
  });
}

function layoutCoordinatesMatch(
  input: Readonly<Record<string, unknown>>,
): boolean {
  if (!isArtifactIdentity(input.artifact)) return false;
  return embeddedCoordinatesMatch(
    input,
    input.artifact.deploymentId,
    input.artifact.owner,
    input.artifact.lineageId,
  );
}

function embeddedCoordinatesMatch(
  current: unknown,
  deploymentId: string,
  owner: "system" | "medusa",
  lineageId: string,
): boolean {
  if (current === null || typeof current !== "object") return true;
  try {
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!embeddedCoordinatesMatch(
          current[index],
          deploymentId,
          owner,
          lineageId,
        )) return false;
      }
      return true;
    }
    const nestedOwner = Object.getOwnPropertyDescriptor(
      current,
      "owner",
    )?.value;
    const nestedLineage = Object.getOwnPropertyDescriptor(
      current,
      "lineageId",
    )?.value;
    const nestedDeployment = Object.getOwnPropertyDescriptor(
      current,
      "deploymentId",
    )?.value;
    if ((nestedOwner !== undefined || nestedLineage !== undefined) &&
      (nestedOwner !== owner || nestedLineage !== lineageId)) return false;
    if (nestedDeployment !== undefined &&
      nestedDeployment !== deploymentId) return false;
    for (const key in current) {
      if (!Object.hasOwn(current, key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !("value" in descriptor) ||
        !embeddedCoordinatesMatch(
          descriptor.value,
          deploymentId,
          owner,
          lineageId,
        )) return false;
    }
    return true;
  } catch {
    return false;
  }
}

interface PhysicalTableState {
  readonly table: RelationalPhysicalTable;
  readonly columnsById: ReadonlyMap<string, RelationalPhysicalColumn>;
  readonly columnsByName: ReadonlyMap<string, RelationalPhysicalColumn>;
  readonly indexesById: ReadonlyMap<string, RelationalPhysicalIndex>;
  readonly constraints: Set<string>;
}

interface PhysicalLayoutSemanticsInput {
  readonly nameAssignments: readonly RelationalPhysicalNameAssignmentFrame[];
  readonly tables: readonly RelationalPhysicalTable[];
  readonly foreignKeys: readonly RelationalPhysicalForeignKey[];
  readonly relationships: readonly RelationalPhysicalRelationshipEvidence[];
  readonly requiredPhysicalCapabilities:
    readonly RelationalPhysicalCapabilityEvidence[];
}

function validatePhysicalLayoutSemantics(
  input: PhysicalLayoutSemanticsInput,
): boolean {
  const expectedNames = new Map<string, string>();
  const expectedSpellings = new Set<string>();
  const tables = new Map<string, PhysicalTableState>();
  let previousTableId: string | undefined;

  for (const table of input.tables) {
    const tableId = table.identity.tableId;
    if (!strictlyAfter(previousTableId, tableId) ||
      !recordExpectedName(
        expectedNames,
        expectedSpellings,
        physicalSubjectKey("table", tableId),
        table.name,
      )) return false;
    previousTableId = tableId;

    const columnsById = new Map<string, RelationalPhysicalColumn>();
    const columnsByName = new Map<string, RelationalPhysicalColumn>();
    let previousColumnId: string | undefined;
    for (const column of table.columns) {
      const columnId = column.identity.columnId;
      if (!sameTableIdentity(column.identity, table.identity) ||
        !strictlyAfter(previousColumnId, columnId) ||
        columnsByName.has(column.name) ||
        !recordExpectedName(
          expectedNames,
          expectedSpellings,
          physicalSubjectKey("column", tableId, columnId),
          column.name,
        )) return false;
      previousColumnId = columnId;
      columnsById.set(columnId, column);
      columnsByName.set(column.name, column);
    }

    let primaryKeyCount = 0;
    let previousKeyId: string | undefined;
    for (const key of table.keys) {
      const keyId = key.identity.keyId;
      if (!sameTableIdentity(key.identity, table.identity) ||
        !strictlyAfter(previousKeyId, keyId) ||
        !validateScopedColumns(key.columns, columnsByName) ||
        !recordExpectedName(
          expectedNames,
          expectedSpellings,
          physicalSubjectKey("key", tableId, keyId),
          key.name,
        )) return false;
      previousKeyId = keyId;
      if (key.kind === "primary") {
        primaryKeyCount += 1;
        for (const name of key.columns.slice(1)) {
          if (columnsByName.get(name)?.nullable !== false) return false;
        }
      }
    }
    if (primaryKeyCount !== 1) return false;

    const constraints = new Set<string>();
    let previousConstraintId: string | undefined;
    for (const check of table.checks) {
      const constraintId = check.identity.constraintId;
      const column = columnsByName.get(check.column);
      if (!sameTableIdentity(check.identity, table.identity) ||
        !strictlyAfter(previousConstraintId, constraintId) ||
        column === undefined || column.type !== "integer" ||
        (check.minimum === null && check.maximum === null) ||
        (column.default.kind === "integerLiteral" &&
          ((check.minimum !== null &&
            column.default.value < check.minimum) ||
            (check.maximum !== null &&
              column.default.value > check.maximum))) ||
        !recordExpectedName(
          expectedNames,
          expectedSpellings,
          physicalSubjectKey("checkConstraint", tableId, constraintId),
          check.name,
        )) return false;
      previousConstraintId = constraintId;
      constraints.add(constraintId);
    }

    const indexesById = new Map<string, RelationalPhysicalIndex>();
    let previousIndexId: string | undefined;
    for (const index of table.indexes) {
      const indexId = index.identity.indexId;
      if (!sameTableIdentity(index.identity, table.identity) ||
        !sameTableIdentity(index.table, table.identity) ||
        !strictlyAfter(previousIndexId, indexId) ||
        !validateScopedColumns(index.columns, columnsByName) ||
        (index.predicate !== null &&
          (!index.columns.includes(index.predicate.column) ||
            !columnsByName.has(index.predicate.column))) ||
        !recordExpectedName(
          expectedNames,
          expectedSpellings,
          physicalSubjectKey("index", tableId, indexId),
          index.name,
        )) return false;
      previousIndexId = indexId;
      indexesById.set(indexId, index);
    }

    tables.set(tableId, {
      table,
      columnsById,
      columnsByName,
      indexesById,
      constraints,
    });
  }

  const ordinaryForeignKeys = new Map<string, RelationalPhysicalForeignKey & {
    readonly kind: "foreignKey";
  }>();
  const scopeForeignKeyTables = new Set<string>();
  let previousForeignKeyKey: string | undefined;
  for (const foreignKey of input.foreignKeys) {
    const sortKey = physicalForeignKeySortKey(foreignKey);
    if (!strictlyAfter(previousForeignKeyKey, sortKey)) return false;
    previousForeignKeyKey = sortKey;
    if (foreignKey.kind === "scopeAuthorityForeignKey") {
      const tableId = foreignKey.table.tableId;
      if (!tables.has(tableId) || scopeForeignKeyTables.has(tableId) ||
        !recordExpectedName(
          expectedNames,
          expectedSpellings,
          physicalSubjectKey("scopeAuthorityForeignKey", tableId),
          foreignKey.name,
        )) return false;
      scopeForeignKeyTables.add(tableId);
      continue;
    }
    const constraintId = foreignKey.identity.constraintId;
    const source = tables.get(foreignKey.sourceTable.tableId);
    const target = tables.get(foreignKey.targetTable.tableId);
    if (source === undefined || target === undefined ||
      foreignKey.identity.tableId !== foreignKey.sourceTable.tableId ||
      !sameTableIdentity(foreignKey.identity, foreignKey.sourceTable) ||
      target.table.name !== foreignKey.targetTableName ||
      source.constraints.has(constraintId) ||
      source.constraints.size >= MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE ||
      !validateScopedColumns(foreignKey.sourceColumns, source.columnsByName) ||
      !validateScopedColumns(foreignKey.targetColumns, target.columnsByName) ||
      foreignKey.sourceColumns.length !== foreignKey.targetColumns.length ||
      !foreignKeyColumnTypesMatch(foreignKey, source, target) ||
      !target.table.keys.some(key =>
        sameStringSets(key.columns, foreignKey.targetColumns)
      ) ||
      ordinaryForeignKeys.has(foreignKey.name) ||
      !recordExpectedName(
        expectedNames,
        expectedSpellings,
        physicalSubjectKey(
          "foreignKey",
          foreignKey.sourceTable.tableId,
          constraintId,
        ),
        foreignKey.name,
      )) return false;
    source.constraints.add(constraintId);
    ordinaryForeignKeys.set(foreignKey.name, foreignKey);
  }
  if (scopeForeignKeyTables.size !== tables.size) return false;

  let previousRelationshipKey: string | undefined;
  const relationshipCounts = new Map<string, number>();
  for (const relationship of input.relationships) {
    const relationshipKey = `${relationship.identity.tableId}\0${
      relationship.identity.relationshipId}`;
    const table = tables.get(relationship.identity.tableId);
    const foreignKey = ordinaryForeignKeys.get(relationship.foreignKeyName);
    const tableRelationshipCount = relationshipCounts.get(
      relationship.identity.tableId,
    ) ?? 0;
    if (!strictlyAfter(previousRelationshipKey, relationshipKey) ||
      table === undefined || foreignKey === undefined ||
      tableRelationshipCount >= MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE ||
      foreignKey.sourceTable.tableId !== table.table.identity.tableId ||
      relationship.sourceUnique !== table.table.keys.some(key =>
        sameStringSets(key.columns, foreignKey.sourceColumns)
      )) return false;
    previousRelationshipKey = relationshipKey;
    relationshipCounts.set(
      relationship.identity.tableId,
      tableRelationshipCount + 1,
    );
  }

  const derivedColumns = new Set<string>();
  const implicitColumns = new Set<string>();
  let previousCapabilityId: string | undefined;
  for (const capability of input.requiredPhysicalCapabilities) {
    const capabilityId = capability.identity.capabilityId;
    if (!strictlyAfter(previousCapabilityId, capabilityId) ||
      !validatePhysicalCapability(
        capability,
        tables,
        derivedColumns,
        implicitColumns,
      )) return false;
    previousCapabilityId = capabilityId;
  }

  if (input.nameAssignments.length !== expectedNames.size) return false;
  const observedSubjects = new Set<string>();
  let previousSpelling: string | undefined;
  for (const assignment of input.nameAssignments) {
    const subjectKey = physicalNameSubjectKey(assignment.name.subject);
    if (!strictlyAfter(previousSpelling, assignment.spelling) ||
      observedSubjects.has(subjectKey) ||
      expectedNames.get(subjectKey) !== assignment.spelling) return false;
    previousSpelling = assignment.spelling;
    observedSubjects.add(subjectKey);
  }
  return observedSubjects.size === expectedNames.size;
}

function validatePhysicalCapability(
  capability: RelationalPhysicalCapabilityEvidence,
  tables: ReadonlyMap<string, PhysicalTableState>,
  derivedColumns: Set<string>,
  implicitColumns: Set<string>,
): boolean {
  switch (capability.kind) {
    case "searchableText": {
      let previous: string | undefined;
      for (const reference of capability.columns) {
        const key = physicalColumnIdentityKey(reference.identity);
        const column = resolvePhysicalColumnReference(reference, tables);
        if (!strictlyAfter(previous, key) ||
          column === undefined || column.type !== "text") return false;
        previous = key;
      }
      return true;
    }
    case "exactNumericCompanion": {
      const numeric = resolvePhysicalColumnReference(
        capability.numericColumn,
        tables,
      );
      const raw = resolvePhysicalColumnReference(capability.rawColumn, tables);
      const rawKey = physicalColumnIdentityKey(capability.rawColumn.identity);
      if (numeric === undefined || raw === undefined ||
        capability.numericColumn.identity.tableId !==
          capability.rawColumn.identity.tableId ||
        numeric.type !== "numeric" || raw.type !== "jsonb" ||
        numeric.nullable !== raw.nullable ||
        numeric.default.kind !== "exactNumericLiteral" ||
        raw.default.kind !== "exactNumericRawLiteral" ||
        numeric.default.value !== raw.default.value ||
        !samePhysicalDefault(numeric.default, capability.numericDefault) ||
        !samePhysicalDefault(raw.default, capability.rawDefault) ||
        derivedColumns.has(rawKey)) return false;
      derivedColumns.add(rawKey);
      return true;
    }
    case "managedTimestamps": {
      const createdAt = resolvePhysicalColumnReference(
        capability.createdAtColumn,
        tables,
      );
      const updatedAt = resolvePhysicalColumnReference(
        capability.updatedAtColumn,
        tables,
      );
      const createdKey = physicalColumnIdentityKey(
        capability.createdAtColumn.identity,
      );
      const updatedKey = physicalColumnIdentityKey(
        capability.updatedAtColumn.identity,
      );
      if (createdAt === undefined || updatedAt === undefined ||
        capability.createdAtColumn.identity.tableId !==
          capability.updatedAtColumn.identity.tableId ||
        createdKey === updatedKey || !isManagedTimestamp(createdAt) ||
        !isManagedTimestamp(updatedAt) ||
        implicitColumns.has(createdKey) || implicitColumns.has(updatedKey)) {
        return false;
      }
      implicitColumns.add(createdKey);
      implicitColumns.add(updatedKey);
      return true;
    }
    case "softDelete": {
      const deletedAt = resolvePhysicalColumnReference(
        capability.deletedAtColumn,
        tables,
      );
      const table = tables.get(capability.activeRowsIndex.tableId);
      const index = table?.indexesById.get(
        capability.activeRowsIndex.indexId,
      );
      const deletedKey = physicalColumnIdentityKey(
        capability.deletedAtColumn.identity,
      );
      if (deletedAt === undefined || table === undefined || index === undefined ||
        capability.deletedAtColumn.identity.tableId !==
          capability.activeRowsIndex.tableId ||
        deletedAt.type !== "timestamp with time zone" ||
        !deletedAt.nullable || deletedAt.default.kind !== "none" ||
        index.name !== capability.activeRowsIndexName ||
        index.columns.length !== 2 || index.columns[0] !== "scope_uuid" ||
        index.columns[1] !== deletedAt.name ||
        index.predicate?.kind !== "isNull" ||
        index.predicate.column !== deletedAt.name ||
        implicitColumns.has(deletedKey)) return false;
      implicitColumns.add(deletedKey);
      return true;
    }
  }
}

function resolvePhysicalColumnReference(
  reference: RelationalPhysicalColumnReference,
  tables: ReadonlyMap<string, PhysicalTableState>,
): RelationalPhysicalColumn | undefined {
  const table = tables.get(reference.identity.tableId);
  const column = table?.columnsById.get(reference.identity.columnId);
  return table === undefined || column === undefined ||
      table.table.name !== reference.tableName ||
      column.name !== reference.columnName
    ? undefined
    : column;
}

function foreignKeyColumnTypesMatch(
  foreignKey: RelationalPhysicalForeignKey & { readonly kind: "foreignKey" },
  source: PhysicalTableState,
  target: PhysicalTableState,
): boolean {
  for (let index = 1; index < foreignKey.sourceColumns.length; index += 1) {
    const sourceName = foreignKey.sourceColumns[index];
    const targetName = foreignKey.targetColumns[index];
    if (sourceName === undefined || targetName === undefined ||
      source.columnsByName.get(sourceName)?.type !==
        target.columnsByName.get(targetName)?.type) return false;
  }
  return true;
}

function validateScopedColumns(
  columns: readonly string[],
  available: ReadonlyMap<string, RelationalPhysicalColumn>,
): boolean {
  if (columns[0] !== "scope_uuid") return false;
  const observed = new Set<string>();
  for (let index = 1; index < columns.length; index += 1) {
    const name = columns[index];
    if (name === undefined || observed.has(name) || !available.has(name)) {
      return false;
    }
    observed.add(name);
  }
  return true;
}

function samePhysicalDefault(
  left: RelationalPhysicalColumn["default"],
  right: RelationalPhysicalColumn["default"],
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "none":
    case "currentTimestamp":
      return true;
    case "textLiteral":
    case "integerLiteral":
    case "exactNumericLiteral":
      return right.kind === left.kind && left.value === right.value;
    case "exactNumericRawLiteral":
      return right.kind === "exactNumericRawLiteral" &&
        left.value === right.value && left.precision === right.precision;
  }
}

function isManagedTimestamp(column: RelationalPhysicalColumn): boolean {
  return column.type === "timestamp with time zone" &&
    !column.nullable && column.default.kind === "currentTimestamp";
}

function recordExpectedName(
  names: Map<string, string>,
  spellings: Set<string>,
  subjectKey: string,
  spelling: string,
): boolean {
  if (names.has(subjectKey) || spellings.has(spelling)) return false;
  names.set(subjectKey, spelling);
  spellings.add(spelling);
  return true;
}

function physicalNameSubjectKey(subject: RelationalPhysicalNameSubject): string {
  switch (subject.kind) {
    case "table":
    case "scopeAuthorityForeignKey":
      return physicalSubjectKey(subject.kind, subject.identity.tableId);
    case "column":
      return physicalSubjectKey(
        subject.kind,
        subject.identity.tableId,
        subject.identity.columnId,
      );
    case "key":
      return physicalSubjectKey(
        subject.kind,
        subject.identity.tableId,
        subject.identity.keyId,
      );
    case "index":
      return physicalSubjectKey(
        subject.kind,
        subject.identity.tableId,
        subject.identity.indexId,
      );
    case "foreignKey":
    case "checkConstraint":
      return physicalSubjectKey(
        subject.kind,
        subject.identity.tableId,
        subject.identity.constraintId,
      );
  }
}

function physicalSubjectKey(
  kind: RelationalPhysicalNameSubject["kind"],
  tableId: string,
  semanticId = "",
): string {
  return `${kind}\0${tableId}\0${semanticId}`;
}

function physicalForeignKeySortKey(
  foreignKey: RelationalPhysicalForeignKey,
): string {
  return foreignKey.kind === "scopeAuthorityForeignKey"
    ? `0\0${foreignKey.table.tableId}`
    : `1\0constraint\0${foreignKey.identity.tableId}\0${
      foreignKey.identity.constraintId}`;
}

function physicalColumnIdentityKey(
  identity: RelationalPhysicalColumn["identity"],
): string {
  return `${identity.tableId}\0${identity.columnId}`;
}

function sameTableIdentity(
  left: Readonly<{ owner: string; lineageId: string; tableId: string }>,
  right: Readonly<{ owner: string; lineageId: string; tableId: string }>,
): boolean {
  return left.owner === right.owner && left.lineageId === right.lineageId &&
    left.tableId === right.tableId;
}

function sameStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(right);
  return values.size === right.length && left.every(value => values.has(value));
}

function strictlyAfter(previous: string | undefined, current: string): boolean {
  return previous === undefined || compareUtf16Strings(previous, current) < 0;
}

function isOwner(input: unknown): input is "system" | "medusa" {
  return input === "system" || input === "medusa";
}

function isArtifactIdentity(input: unknown): input is Readonly<{
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

function isTargetNamespace(input: unknown): input is Readonly<{
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

function isPhysicalLocator(input: unknown): input is Readonly<{
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

function isPhysicalNameSubject(
  input: unknown,
): input is RelationalPhysicalNameSubject {
  if (!isExactPrivateValueRecord(input, ["kind", "identity"])) return false;
  switch (input.kind) {
    case "table":
    case "scopeAuthorityForeignKey":
      return isTableIdentity(input.identity);
    case "column":
      return isColumnIdentity(input.identity);
    case "key":
      return isDefinitionIdentity(input.identity, "keyId");
    case "index":
      return isDefinitionIdentity(input.identity, "indexId");
    case "foreignKey":
    case "checkConstraint":
      return isDefinitionIdentity(input.identity, "constraintId");
    default:
      return false;
  }
}

function isTableIdentity(input: unknown): input is Readonly<{
  readonly tableId: string;
}> {
  return isExactPrivateValueRecord(input, [
    "owner",
    "lineageId",
    "tableId",
  ]) && isIdentityCoordinate(input) &&
    isBoundedPrivateValueIdentityText(input.tableId);
}

function isColumnIdentity(input: unknown): boolean {
  return isDefinitionIdentity(input, "columnId");
}

function isDefinitionIdentity(input: unknown, field: string): boolean {
  return isExactPrivateValueRecord(input, [
    "owner",
    "lineageId",
    "tableId",
    field,
  ]) &&
    isIdentityCoordinate(input) &&
    isBoundedPrivateValueIdentityText(input.tableId) &&
    isBoundedPrivateValueIdentityText(input[field]);
}

function isIdentityCoordinate(
  input: Readonly<Record<string, unknown>>,
): boolean {
  return isOwner(input.owner) &&
    isBoundedPrivateValueIdentityText(input.lineageId);
}

export function isStoredRelationalPhysicalTable(
  input: unknown,
): input is RelationalPhysicalTable {
  return isExactPrivateValueRecord(input, [
    "identity",
    "name",
    "scopeColumn",
    "columns",
    "keys",
    "checks",
    "indexes",
  ]) &&
    isTableIdentity(input.identity) &&
    isPhysicalIdentifier(input.name) &&
    isExactPrivateValueRecord(input.scopeColumn, [
      "name",
      "type",
      "nullable",
    ]) &&
    input.scopeColumn.name === "scope_uuid" &&
    input.scopeColumn.type === "uuid" &&
    input.scopeColumn.nullable === false &&
    isBoundedArrayOf(
      input.columns,
      1,
      MAX_RELATIONAL_SCHEMA_COLUMNS_PER_TABLE,
      isPhysicalColumn,
    ) &&
    isBoundedArrayOf(
      input.keys,
      1,
      MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE,
      isPhysicalKey,
    ) &&
    isBoundedArrayOf(
      input.checks,
      0,
      MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE,
      isPhysicalCheck,
    ) &&
    isBoundedArrayOf(
      input.indexes,
      0,
      MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE,
      isStoredRelationalPhysicalIndex,
    );
}

export function isStoredRelationalPhysicalTableProjection(
  input: unknown,
): boolean {
  return isExactPrivateValueRecord(input, [
    "identity",
    "name",
    "scopeColumn",
    "columns",
    "keys",
    "checks",
  ]) &&
    isTableIdentity(input.identity) &&
    isPhysicalIdentifier(input.name) &&
    isExactPrivateValueRecord(input.scopeColumn, [
      "name",
      "type",
      "nullable",
    ]) &&
    input.scopeColumn.name === "scope_uuid" &&
    input.scopeColumn.type === "uuid" &&
    input.scopeColumn.nullable === false &&
    Array.isArray(input.columns) && input.columns.every(isPhysicalColumn) &&
    Array.isArray(input.keys) && input.keys.every(isPhysicalKey) &&
    Array.isArray(input.checks) && input.checks.every(isPhysicalCheck);
}

function isPhysicalColumn(input: unknown): input is RelationalPhysicalColumn {
  return isExactPrivateValueRecord(input, [
    "identity",
    "name",
    "type",
    "nullable",
    "default",
  ]) &&
    isColumnIdentity(input.identity) &&
    isPhysicalIdentifier(input.name) &&
    (input.type === "text" || input.type === "integer" ||
      input.type === "numeric" || input.type === "jsonb" ||
      input.type === "timestamp with time zone") &&
    typeof input.nullable === "boolean" &&
    isPhysicalDefault(input.default) &&
    physicalDefaultMatchesType(input.default, input.type);
}

function isPhysicalDefault(input: unknown): boolean {
  if (isExactPrivateValueRecord(input, ["kind"])) {
    return input.kind === "none" || input.kind === "currentTimestamp";
  }
  if (isExactPrivateValueRecord(input, ["kind", "value"])) {
    return (input.kind === "textLiteral" && isPrivateValueText(input.value)) ||
      (input.kind === "integerLiteral" && isPostgresInteger(input.value)) ||
      (input.kind === "exactNumericLiteral" && isExactNumeric(input.value));
  }
  return isExactPrivateValueRecord(input, ["kind", "value", "precision"]) &&
    input.kind === "exactNumericRawLiteral" &&
    isExactNumeric(input.value) &&
    typeof input.precision === "number" &&
    Number.isSafeInteger(input.precision) &&
    input.precision > 0 && input.precision <= 1_000;
}

function physicalDefaultMatchesType(
  input: unknown,
  columnType: unknown,
): boolean {
  if (!isExactPrivateValueRecord(input, ["kind"]) &&
    !isExactPrivateValueRecord(input, ["kind", "value"]) &&
    !isExactPrivateValueRecord(input, ["kind", "value", "precision"])) {
    return false;
  }
  switch (input.kind) {
    case "none":
      return true;
    case "textLiteral":
      return columnType === "text";
    case "integerLiteral":
      return columnType === "integer";
    case "exactNumericLiteral":
      return columnType === "numeric";
    case "exactNumericRawLiteral":
      return columnType === "jsonb";
    case "currentTimestamp":
      return columnType === "timestamp with time zone";
    default:
      return false;
  }
}

function isPhysicalKey(input: unknown): input is RelationalPhysicalKey {
  return isExactPrivateValueRecord(input, [
    "identity",
    "name",
    "kind",
    "columns",
  ]) &&
    isDefinitionIdentity(input.identity, "keyId") &&
    isPhysicalIdentifier(input.name) &&
    (input.kind === "primary" || input.kind === "unique") &&
    isScopePrefixedColumns(input.columns);
}

export function isStoredRelationalPhysicalIndex(
  input: unknown,
): input is RelationalPhysicalIndex {
  return isExactPrivateValueRecord(input, [
    "identity",
    "table",
    "name",
    "kind",
    "columns",
    "predicate",
  ]) &&
    isDefinitionIdentity(input.identity, "indexId") &&
    isTableIdentity(input.table) &&
    isPhysicalIdentifier(input.name) &&
    input.kind === "btree" &&
    isScopePrefixedColumns(input.columns) &&
    (input.predicate === null ||
      (isExactPrivateValueRecord(input.predicate, ["kind", "column"]) &&
        input.predicate.kind === "isNull" &&
        isPhysicalIdentifier(input.predicate.column)));
}

function isPhysicalCheck(
  input: unknown,
): input is RelationalPhysicalIntegerRangeCheck {
  return isExactPrivateValueRecord(input, [
    "identity",
    "name",
    "kind",
    "column",
    "minimum",
    "maximum",
  ]) &&
    isDefinitionIdentity(input.identity, "constraintId") &&
    isPhysicalIdentifier(input.name) &&
    input.kind === "integerRange" &&
    isPhysicalIdentifier(input.column) &&
    isNullablePostgresInteger(input.minimum) &&
    isNullablePostgresInteger(input.maximum) &&
    (input.minimum === null || input.maximum === null ||
      input.minimum <= input.maximum);
}

export function isStoredRelationalPhysicalForeignKey(
  input: unknown,
): input is RelationalPhysicalForeignKey {
  if (!isExactPrivateValueRecord(input, [
    "kind",
    "table",
    "name",
    "sourceColumns",
    "targetTable",
    "targetColumns",
    "onDelete",
    "onUpdate",
  ])) {
    return isExactPrivateValueRecord(input, [
      "kind",
      "identity",
      "sourceTable",
      "name",
      "sourceColumns",
      "targetTable",
      "targetTableName",
      "targetColumns",
      "onDelete",
      "onUpdate",
    ]) &&
      input.kind === "foreignKey" &&
      isDefinitionIdentity(input.identity, "constraintId") &&
      isTableIdentity(input.sourceTable) &&
      isTableIdentity(input.targetTable) &&
      isPhysicalIdentifier(input.name) &&
      isPhysicalIdentifier(input.targetTableName) &&
      isScopePrefixedColumns(input.sourceColumns) &&
      isScopePrefixedColumns(input.targetColumns) &&
      input.sourceColumns.length === input.targetColumns.length &&
      input.onDelete === "restrict" && input.onUpdate === "restrict";
  }
  return input.kind === "scopeAuthorityForeignKey" &&
    isTableIdentity(input.table) &&
    isPhysicalIdentifier(input.name) &&
    isPrivateValueStringArray(input.sourceColumns) &&
    input.sourceColumns.length === 1 && input.sourceColumns[0] === "scope_uuid" &&
    input.targetTable === "fx_system_scope_clock" &&
    isPrivateValueStringArray(input.targetColumns) &&
    input.targetColumns.length === 1 && input.targetColumns[0] === "scope_uuid" &&
    input.onDelete === "restrict" && input.onUpdate === "restrict";
}

function isPhysicalRelationship(
  input: unknown,
): input is RelationalPhysicalRelationshipEvidence {
  return isExactPrivateValueRecord(input, [
    "identity",
    "kind",
    "foreignKeyName",
    "sourceUnique",
  ]) &&
    isDefinitionIdentity(input.identity, "relationshipId") &&
    (input.kind === "manyToOne" || input.kind === "oneToOne") &&
    isPhysicalIdentifier(input.foreignKeyName) &&
    input.sourceUnique === (input.kind === "oneToOne");
}

export function isStoredRelationalPhysicalCapability(
  input: unknown,
): input is RelationalPhysicalCapabilityEvidence {
  if (!isExactPrivateValueRecord(input, ["identity", "kind", ...capabilityKeys(
    readOwnDataValue(input, "kind"),
  )])) return false;
  if (!isCapabilityIdentity(input.identity)) return false;
  switch (input.kind) {
    case "searchableText":
      return isBoundedArrayOf(
        input.columns,
        1,
        MAX_RELATIONAL_SCHEMA_REFERENCE_COLUMNS,
        isPhysicalColumnReference,
      ) &&
        input.residualRequirement === "searchableTextQueryBehavior";
    case "exactNumericCompanion":
      return isPhysicalColumnReference(input.numericColumn) &&
        isPhysicalColumnReference(input.rawColumn) &&
        input.matchingNullability === true &&
        isPhysicalDefault(input.numericDefault) &&
        isPhysicalDefault(input.rawDefault) &&
        input.residualRequirement ===
          "exactNumericCompanionWriteBehavior";
    case "managedTimestamps":
      return isPhysicalColumnReference(input.createdAtColumn) &&
        isPhysicalColumnReference(input.updatedAtColumn) &&
        input.databaseCurrentDefaults === true &&
        input.residualRequirement === "managedTimestampUpdateBehavior";
    case "softDelete":
      return isPhysicalColumnReference(input.deletedAtColumn) &&
        isDefinitionIdentity(input.activeRowsIndex, "indexId") &&
        isPhysicalIdentifier(input.activeRowsIndexName) &&
        input.residualRequirement === "softDeleteStoreBehavior";
    default:
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

function isCapabilityIdentity(input: unknown): boolean {
  return isExactPrivateValueRecord(input, [
    "owner",
    "lineageId",
    "capabilityId",
  ]) && isIdentityCoordinate(input) &&
    isBoundedPrivateValueIdentityText(input.capabilityId);
}

function capabilityKeys(input: unknown): readonly string[] {
  switch (input) {
    case "searchableText":
      return ["columns", "residualRequirement"];
    case "exactNumericCompanion":
      return [
        "numericColumn",
        "rawColumn",
        "matchingNullability",
        "numericDefault",
        "rawDefault",
        "residualRequirement",
      ];
    case "managedTimestamps":
      return [
        "createdAtColumn",
        "updatedAtColumn",
        "databaseCurrentDefaults",
        "residualRequirement",
      ];
    case "softDelete":
      return [
        "deletedAtColumn",
        "activeRowsIndex",
        "activeRowsIndexName",
        "residualRequirement",
      ];
    default:
      return [];
  }
}

function isPhysicalColumnReference(
  input: unknown,
): input is RelationalPhysicalColumnReference {
  return isExactPrivateValueRecord(input, [
    "identity",
    "tableName",
    "columnName",
  ]) &&
    isColumnIdentity(input.identity) &&
    isPhysicalIdentifier(input.tableName) &&
    isPhysicalIdentifier(input.columnName);
}

function isScopePrefixedColumns(input: unknown): input is readonly string[] {
  return isPrivateValueStringArray(input, isPhysicalColumnName) &&
    input.length >= 2 &&
    input.length <= MAX_RELATIONAL_SCHEMA_REFERENCE_COLUMNS + 1 &&
    input[0] === "scope_uuid";
}

function isPhysicalColumnName(input: unknown): boolean {
  return input === "scope_uuid" || isPhysicalIdentifier(input);
}

function isPhysicalIdentifier(input: unknown): input is string {
  return typeof input === "string" && PHYSICAL_IDENTIFIER.test(input);
}

function spellingMatchesSubject(
  spelling: string,
  subject: Readonly<Record<string, unknown>>,
): boolean {
  switch (subject.kind) {
    case "table":
      return spelling.startsWith("fxrt_");
    case "column":
      return spelling.startsWith("fxrc_");
    case "key":
      return spelling.startsWith("fxrk_");
    case "index":
      return spelling.startsWith("fxri_");
    case "foreignKey":
    case "scopeAuthorityForeignKey":
      return spelling.startsWith("fxrf_");
    case "checkConstraint":
      return spelling.startsWith("fxrh_");
    default:
      return false;
  }
}

function isNullablePostgresInteger(
  input: unknown,
): input is number | null {
  return input === null || isPostgresInteger(input);
}

function isPostgresInteger(input: unknown): input is number {
  return typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input >= POSTGRES_INTEGER_MINIMUM &&
    input <= POSTGRES_INTEGER_MAXIMUM;
}

function isExactNumeric(input: unknown): input is string {
  return typeof input === "string" &&
    input !== "-0" &&
    input.length <= 512 &&
    EXACT_NUMERIC.test(input);
}

function isBoundedArrayOf<Value>(
  input: unknown,
  minimumLength: number,
  maximumLength: number,
  member: (value: unknown) => value is Value,
): input is readonly Value[] {
  if (!Array.isArray(input)) return false;
  try {
    if (
      Object.getPrototypeOf(input) !== Array.prototype ||
      input.length < minimumLength ||
      input.length > maximumLength
    ) return false;
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !member(descriptor.value)
      ) return false;
    }
    let enumerableKeys = 0;
    for (const key in input) {
      if (!Object.hasOwn(input, key)) return false;
      enumerableKeys += 1;
    }
    // Actual stored inputs come directly from JSON.parse, so enumerable index
    // count plus the descriptor loop proves a dense undecorated JSON array
    // without allocating a second potentially wide key list.
    return enumerableKeys === input.length;
  } catch {
    return false;
  }
}
