import { isNonArrayRecord } from "@flarex/utils/records";

/** Structural projection only. Normalize and compare the complete definition before trusting stored input. */
export function relationalSchemaSourceFromDefinition(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.coordinate)) {
    return input;
  }
  return {
    owner: input.coordinate.owner,
    lineageId: input.coordinate.lineageId,
    tables: Array.isArray(input.tables)
      ? input.tables.map(sourceTableInputFromStoredTable)
      : input.tables,
    capabilities: Array.isArray(input.capabilities)
      ? input.capabilities.map(sourceCapabilityInputFromStoredCapability)
      : input.capabilities,
  };
}

function sourceTableInputFromStoredTable(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.identity)) {
    return input;
  }
  return {
    tableId: input.identity.tableId,
    origin: input.origin,
    columns: mapStoredArray(input.columns, sourceColumnInputFromStoredColumn),
    keys: mapStoredArray(input.keys, sourceKeyInputFromStoredKey),
    indexes: mapStoredArray(input.indexes, sourceIndexInputFromStoredIndex),
    constraints: mapStoredArray(
      input.constraints,
      sourceConstraintInputFromStoredConstraint,
    ),
    relationships: mapStoredArray(
      input.relationships,
      sourceRelationshipInputFromStoredRelationship,
    ),
  };
}

function sourceColumnInputFromStoredColumn(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.identity)) {
    return input;
  }
  return {
    columnId: input.identity.columnId,
    type: input.type,
    nullable: input.nullable,
    default: input.default,
    origin: input.origin,
  };
}

function sourceKeyInputFromStoredKey(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.identity)) {
    return input;
  }
  return {
    keyId: input.identity.keyId,
    kind: input.kind,
    columns: mapStoredArray(input.columns, storedColumnId),
    origin: input.origin,
  };
}

function sourceIndexInputFromStoredIndex(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.identity)) {
    return input;
  }
  return {
    indexId: input.identity.indexId,
    kind: input.kind,
    columns: mapStoredArray(input.columns, storedColumnId),
    predicate: input.predicate === null
      ? null
      : sourcePredicateInputFromStoredPredicate(input.predicate),
    origin: input.origin,
  };
}

function sourcePredicateInputFromStoredPredicate(input: unknown) {
  if (!isNonArrayRecord(input)) return input;
  if (input.kind === "isNullAndTextEquals") return {
    kind: input.kind, nullColumnId: storedColumnId(input.nullColumn),
    textColumnId: storedColumnId(input.textColumn), value: input.value,
  };
  return {
    kind: input.kind,
    columnId: storedColumnId(input.column),
  };
}

function sourceConstraintInputFromStoredConstraint(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.identity)) {
    return input;
  }
  if (input.kind === "foreignKey") {
    return {
      constraintId: input.identity.constraintId,
      kind: input.kind,
      sourceColumns: mapStoredArray(input.sourceColumns, storedColumnId),
      targetColumns: mapStoredArray(
        input.targetColumns,
        storedColumnReference,
      ),
      onDelete: input.onDelete,
      onUpdate: input.onUpdate,
      origin: input.origin,
    };
  }
  if (input.kind === "textSet") {
    return { constraintId: input.identity.constraintId, kind: input.kind,
      columnId: storedColumnId(input.column), values: input.values, origin: input.origin };
  }
  if (input.kind === "integerRange") {
    return {
      constraintId: input.identity.constraintId,
      kind: input.kind,
      columnId: storedColumnId(input.column),
      minimum: input.minimum,
      maximum: input.maximum,
      origin: input.origin,
    };
  }
  return input;
}

function sourceRelationshipInputFromStoredRelationship(
  input: unknown,
) {
  if (
    !isNonArrayRecord(input) ||
    !isNonArrayRecord(input.identity) ||
    !isNonArrayRecord(input.foreignKey)
  ) return input;
  return {
    relationshipId: input.identity.relationshipId,
    kind: input.kind,
    foreignKeyConstraintId: input.foreignKey.constraintId,
    origin: input.origin,
  };
}

function sourceCapabilityInputFromStoredCapability(input: unknown) {
  if (!isNonArrayRecord(input) || !isNonArrayRecord(input.identity)) {
    return input;
  }
  const common = {
    capabilityId: input.identity.capabilityId,
    kind: input.kind,
    origin: input.origin,
  };
  if (input.kind === "searchableText") {
    return {
      ...common,
      columns: mapStoredArray(input.columns, storedColumnReference),
    };
  }
  if (input.kind === "exactNumericCompanion") {
    return {
      ...common,
      numericColumn: storedColumnReference(input.numericColumn),
      rawColumn: storedColumnReference(input.rawColumn),
    };
  }
  if (input.kind === "managedTimestamps") {
    return {
      ...common,
      createdAtColumn: storedColumnReference(input.createdAtColumn),
      updatedAtColumn: storedColumnReference(input.updatedAtColumn),
      updateBehavior: input.updateBehavior,
    };
  }
  if (input.kind === "softDelete") {
    return {
      ...common,
      deletedAtColumn: storedColumnReference(input.deletedAtColumn),
      activeRowsIndex: storedIndexReference(input.activeRowsIndex),
    };
  }
  return input;
}

function storedColumnId(input: unknown): unknown {
  return isNonArrayRecord(input) ? input.columnId : input;
}

function storedColumnReference(input: unknown): unknown {
  return isNonArrayRecord(input)
    ? { tableId: input.tableId, columnId: input.columnId }
    : input;
}

function storedIndexReference(input: unknown): unknown {
  return isNonArrayRecord(input)
    ? { tableId: input.tableId, indexId: input.indexId }
    : input;
}

function mapStoredArray(
  input: unknown,
  map: (value: unknown) => unknown,
): unknown {
  return Array.isArray(input) ? input.map(map) : input;
}

