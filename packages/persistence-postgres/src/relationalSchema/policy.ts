import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  compareUtf16Strings,
  isNonBlankString,
} from "@flarex/utils/strings";
import { Brand, Result } from "effect";

import { RelationalSchemaError } from "./errors";
import {
  RELATIONAL_SCHEMA_FORMAT,
  RELATIONAL_SCHEMA_FORMAT_VERSION,
  type RelationalColumnDefault,
  type RelationalColumnDefinition,
  type RelationalColumnId,
  type RelationalColumnIdentity,
  type RelationalColumnReference,
  type RelationalColumnType,
  type RelationalConstraintDefinition,
  type RelationalConstraintId,
  type RelationalConstraintIdentity,
  type RelationalDefinitionOrigin,
  type RelationalDefinitionSourceId,
  type RelationalIndexDefinition,
  type RelationalIndexId,
  type RelationalIndexIdentity,
  type RelationalIndexPredicate,
  type RelationalKeyDefinition,
  type RelationalKeyId,
  type RelationalKeyIdentity,
  type RelationalPersistenceCapability,
  type RelationalPersistenceCapabilityId,
  type RelationalPersistenceCapabilityIdentity,
  type RelationalRelationshipDefinition,
  type RelationalRelationshipId,
  type RelationalRelationshipIdentity,
  type RelationalSchema,
  type RelationalSchemaCoordinate,
  type RelationalSchemaOwner,
  type RelationalTableDefinition,
  type RelationalTableId,
  type RelationalTableIdentity,
} from "./model";
import type { FrameworkSchemaLineageId } from
  "../frameworkSchema/artifact/model";
import { MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES } from
  "../frameworkSchema/artifact/policy";

export const MAX_RELATIONAL_SCHEMA_ID_UTF8_BYTES = 512;
export const MAX_RELATIONAL_SCHEMA_TABLES = 128;
export const MAX_RELATIONAL_SCHEMA_COLUMNS_PER_TABLE = 256;
export const MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE = 256;
export const MAX_RELATIONAL_SCHEMA_CAPABILITIES = 256;
export const MAX_RELATIONAL_SCHEMA_REFERENCE_COLUMNS = 32;
// Definitions consume one unit and nested identity references consume their own
// unit. Every unit expands to at most 16 framework-artifact JSON nodes. The
// retained headroom covers the relational root and outer artifact frame.
const MAX_RELATIONAL_SCHEMA_OUTPUT_NODES_PER_DECODE_UNIT = 16;
const RELATIONAL_SCHEMA_OUTER_ARTIFACT_NODE_HEADROOM = 6_144;
export const MAX_RELATIONAL_SCHEMA_DECODE_UNITS = Math.floor(
  (MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES -
    RELATIONAL_SCHEMA_OUTER_ARTIFACT_NODE_HEADROOM) /
    MAX_RELATIONAL_SCHEMA_OUTPUT_NODES_PER_DECODE_UNIT,
);

const UTF8 = new TextEncoder();
const EXACT_NUMERIC = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
const POSTGRES_INTEGER_MINIMUM = -2_147_483_648;
const POSTGRES_INTEGER_MAXIMUM = 2_147_483_647;
const brandLineageId = Brand.nominal<FrameworkSchemaLineageId>();
const brandTableId = Brand.nominal<RelationalTableId>();
const brandColumnId = Brand.nominal<RelationalColumnId>();
const brandKeyId = Brand.nominal<RelationalKeyId>();
const brandIndexId = Brand.nominal<RelationalIndexId>();
const brandConstraintId = Brand.nominal<RelationalConstraintId>();
const brandRelationshipId = Brand.nominal<RelationalRelationshipId>();
const brandCapabilityId = Brand.nominal<RelationalPersistenceCapabilityId>();
const brandSourceId = Brand.nominal<RelationalDefinitionSourceId>();

interface TableLookup {
  readonly table: RelationalTableDefinition;
  readonly columns: ReadonlyMap<string, RelationalColumnDefinition>;
  readonly keys: ReadonlyMap<string, RelationalKeyDefinition>;
  readonly indexes: ReadonlyMap<string, RelationalIndexDefinition>;
  readonly constraints: ReadonlyMap<string, RelationalConstraintDefinition>;
}

interface RelationalSchemaDecodeBudget {
  units: number;
}

export function normalizeRelationalSchema(
  input: unknown,
): Result.Result<RelationalSchema, RelationalSchemaError> {
  return Result.gen(function* () {
    const budget: RelationalSchemaDecodeBudget = { units: 1 };
    const root = yield* exactRecord(
      input,
      ["owner", "lineageId", "tables", "capabilities"],
      "$",
    );
    const owner = yield* decodeOwner(root.at(0), "$.owner");
    const lineageId = yield* decodeIdentityString(
      root.at(1),
      "$.lineageId",
      brandLineageId,
    );
    const coordinate = Object.freeze({
      owner,
      lineageId,
    } satisfies RelationalSchemaCoordinate);
    const tableInputs = yield* denseArray(
      root.at(2),
      "$.tables",
      MAX_RELATIONAL_SCHEMA_TABLES,
    );
    if (tableInputs.length === 0) {
      return yield* Result.fail(RelationalSchemaError.invalidInput("$.tables"));
    }
    const tables: RelationalTableDefinition[] = [];
    for (let index = 0; index < tableInputs.length; index += 1) {
      tables.push(yield* decodeTable(
        tableInputs[index],
        coordinate,
        `$.tables[${index}]`,
        budget,
      ));
    }
    tables.sort((left, right) => compareUtf16Strings(
      left.identity.tableId,
      right.identity.tableId,
    ));

    const capabilityInputs = yield* denseArray(
      root.at(3),
      "$.capabilities",
      MAX_RELATIONAL_SCHEMA_CAPABILITIES,
    );
    const capabilities: RelationalPersistenceCapability[] = [];
    for (let index = 0; index < capabilityInputs.length; index += 1) {
      capabilities.push(yield* decodeCapability(
        capabilityInputs[index],
        coordinate,
        `$.capabilities[${index}]`,
        budget,
      ));
    }
    capabilities.sort((left, right) => compareUtf16Strings(
      left.identity.capabilityId,
      right.identity.capabilityId,
    ));

    const schema = Object.freeze({
      format: RELATIONAL_SCHEMA_FORMAT,
      version: RELATIONAL_SCHEMA_FORMAT_VERSION,
      coordinate,
      tables: Object.freeze(tables),
      capabilities: Object.freeze(capabilities),
    } satisfies RelationalSchema);
    yield* validateRelationalSchema(schema);
    return schema;
  });
}

function decodeTable(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalTableDefinition, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(input, [
      "tableId",
      "origin",
      "columns",
      "keys",
      "indexes",
      "constraints",
      "relationships",
    ], path);
    const tableId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.tableId`,
      brandTableId,
    );
    const identity = tableIdentity(coordinate, tableId);
    const origin = yield* decodeOrigin(fields.at(1), `${path}.origin`);
    const columnInputs = yield* denseArray(
      fields.at(2),
      `${path}.columns`,
      MAX_RELATIONAL_SCHEMA_COLUMNS_PER_TABLE,
    );
    if (columnInputs.length === 0) {
      return yield* Result.fail(RelationalSchemaError.invalidInput(
        `${path}.columns`,
      ));
    }
    const columns: RelationalColumnDefinition[] = [];
    for (let index = 0; index < columnInputs.length; index += 1) {
      columns.push(yield* decodeColumn(
        columnInputs[index],
        coordinate,
        tableId,
        `${path}.columns[${index}]`,
        budget,
      ));
    }
    columns.sort((left, right) => compareUtf16Strings(
      left.identity.columnId,
      right.identity.columnId,
    ));

    const keys = yield* decodeArrayMembers(
      fields.at(3),
      `${path}.keys`,
      inputValue => decodeKey(
        inputValue.value,
        coordinate,
        tableId,
        inputValue.path,
        budget,
      ),
    );
    keys.sort((left, right) => compareUtf16Strings(
      left.identity.keyId,
      right.identity.keyId,
    ));
    const indexes = yield* decodeArrayMembers(
      fields.at(4),
      `${path}.indexes`,
      inputValue => decodeIndex(
        inputValue.value,
        coordinate,
        tableId,
        inputValue.path,
        budget,
      ),
    );
    indexes.sort((left, right) => compareUtf16Strings(
      left.identity.indexId,
      right.identity.indexId,
    ));
    const constraints = yield* decodeArrayMembers(
      fields.at(5),
      `${path}.constraints`,
      inputValue => decodeConstraint(
        inputValue.value,
        coordinate,
        tableId,
        inputValue.path,
        budget,
      ),
    );
    constraints.sort((left, right) => compareUtf16Strings(
      left.identity.constraintId,
      right.identity.constraintId,
    ));
    const relationships = yield* decodeArrayMembers(
      fields.at(6),
      `${path}.relationships`,
      inputValue => decodeRelationship(
        inputValue.value,
        coordinate,
        tableId,
        inputValue.path,
        budget,
      ),
    );
    relationships.sort((left, right) => compareUtf16Strings(
      left.identity.relationshipId,
      right.identity.relationshipId,
    ));

    return Object.freeze({
      identity,
      origin,
      columns: Object.freeze(columns),
      keys: Object.freeze(keys),
      indexes: Object.freeze(indexes),
      constraints: Object.freeze(constraints),
      relationships: Object.freeze(relationships),
    } satisfies RelationalTableDefinition);
  });
}

function decodeColumn(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalColumnDefinition, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(
      input,
      ["columnId", "type", "nullable", "default", "origin"],
      path,
    );
    const columnId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.columnId`,
      brandColumnId,
    );
    const type = yield* decodeColumnType(fields.at(1), `${path}.type`);
    const nullable = yield* decodeBoolean(fields.at(2), `${path}.nullable`);
    const defaultValue = yield* decodeColumnDefault(
      fields.at(3),
      `${path}.default`,
    );
    const origin = yield* decodeOrigin(fields.at(4), `${path}.origin`);
    return Object.freeze({
      identity: columnIdentity(coordinate, tableId, columnId),
      type,
      nullable,
      default: defaultValue,
      origin,
    } satisfies RelationalColumnDefinition);
  });
}

function decodeKey(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalKeyDefinition, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(
      input,
      ["keyId", "kind", "columns", "origin"],
      path,
    );
    const keyId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.keyId`,
      brandKeyId,
    );
    const kindInput = fields.at(1);
    if (kindInput !== "primary" && kindInput !== "unique") {
      return yield* unsupported(`${path}.kind`, kindInput);
    }
    const columns = yield* decodeLocalColumnIdentities(
      fields.at(2),
      coordinate,
      tableId,
      `${path}.columns`,
      budget,
    );
    const origin = yield* decodeOrigin(fields.at(3), `${path}.origin`);
    return Object.freeze({
      identity: keyIdentity(coordinate, tableId, keyId),
      kind: kindInput,
      columns,
      origin,
    } satisfies RelationalKeyDefinition);
  });
}

function decodeIndex(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalIndexDefinition, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(
      input,
      ["indexId", "kind", "columns", "predicate", "origin"],
      path,
    );
    const indexId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.indexId`,
      brandIndexId,
    );
    if (fields.at(1) !== "btree") {
      return yield* unsupported(`${path}.kind`, fields.at(1));
    }
    const columns = yield* decodeLocalColumnIdentities(
      fields.at(2),
      coordinate,
      tableId,
      `${path}.columns`,
      budget,
    );
    const predicate = yield* decodeIndexPredicate(
      fields.at(3),
      coordinate,
      tableId,
      `${path}.predicate`,
      budget,
    );
    const origin = yield* decodeOrigin(fields.at(4), `${path}.origin`);
    return Object.freeze({
      identity: indexIdentity(coordinate, tableId, indexId),
      kind: "btree",
      columns,
      predicate,
      origin,
    } satisfies RelationalIndexDefinition);
  });
}

function decodeIndexPredicate(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalIndexPredicate, RelationalSchemaError> {
  if (input === null) return Result.succeed(null);
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const kind = yield* discriminant(input, path);
    if (kind !== "isNull") return yield* unsupported(`${path}.kind`, kind);
    const fields = yield* exactRecord(input, ["kind", "columnId"], path);
    const columnId = yield* decodeIdentityString(
      fields.at(1),
      `${path}.columnId`,
      brandColumnId,
    );
    return Object.freeze({
      kind: "isNull",
      column: columnIdentity(coordinate, tableId, columnId),
    });
  });
}

function decodeConstraint(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalConstraintDefinition, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const kind = yield* discriminant(input, path);
    if (kind === "foreignKey") {
      const fields = yield* exactRecord(input, [
        "constraintId",
        "kind",
        "sourceColumns",
        "targetColumns",
        "onDelete",
        "onUpdate",
        "origin",
      ], path);
      const constraintId = yield* decodeIdentityString(
        fields.at(0),
        `${path}.constraintId`,
        brandConstraintId,
      );
      const sourceColumns = yield* decodeLocalColumnIdentities(
        fields.at(2),
        coordinate,
        tableId,
        `${path}.sourceColumns`,
        budget,
      );
      const targetColumns = yield* decodeColumnReferences(
        fields.at(3),
        coordinate,
        `${path}.targetColumns`,
        false,
        budget,
      );
      if (fields.at(4) !== "restrict") {
        return yield* unsupported(`${path}.onDelete`, fields.at(4));
      }
      if (fields.at(5) !== "restrict") {
        return yield* unsupported(`${path}.onUpdate`, fields.at(5));
      }
      const origin = yield* decodeOrigin(fields.at(6), `${path}.origin`);
      return Object.freeze({
        identity: constraintIdentity(coordinate, tableId, constraintId),
        kind: "foreignKey",
        sourceColumns,
        targetColumns,
        onDelete: "restrict",
        onUpdate: "restrict",
        origin,
      });
    }
    if (kind === "integerRange") {
      const fields = yield* exactRecord(input, [
        "constraintId",
        "kind",
        "columnId",
        "minimum",
        "maximum",
        "origin",
      ], path);
      const constraintId = yield* decodeIdentityString(
        fields.at(0),
        `${path}.constraintId`,
        brandConstraintId,
      );
      const columnId = yield* decodeIdentityString(
        fields.at(2),
        `${path}.columnId`,
        brandColumnId,
      );
      yield* consumeDecodeUnit(budget, `${path}.columnId`);
      const minimum = yield* decodeNullablePostgresInteger(
        fields.at(3),
        `${path}.minimum`,
      );
      const maximum = yield* decodeNullablePostgresInteger(
        fields.at(4),
        `${path}.maximum`,
      );
      if (
        (minimum === null && maximum === null) ||
        (minimum !== null && maximum !== null && minimum > maximum)
      ) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(path));
      }
      const origin = yield* decodeOrigin(fields.at(5), `${path}.origin`);
      return Object.freeze({
        identity: constraintIdentity(coordinate, tableId, constraintId),
        kind: "integerRange",
        column: columnIdentity(coordinate, tableId, columnId),
        minimum,
        maximum,
        origin,
      });
    }
    return yield* unsupported(`${path}.kind`, kind);
  });
}

function decodeRelationship(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalRelationshipDefinition, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(
      input,
      ["relationshipId", "kind", "foreignKeyConstraintId", "origin"],
      path,
    );
    const relationshipId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.relationshipId`,
      brandRelationshipId,
    );
    const kind = fields.at(1);
    if (kind !== "manyToOne" && kind !== "oneToOne") {
      return yield* unsupported(`${path}.kind`, kind);
    }
    const foreignKeyConstraintId = yield* decodeIdentityString(
      fields.at(2),
      `${path}.foreignKeyConstraintId`,
      brandConstraintId,
    );
    const origin = yield* decodeOrigin(fields.at(3), `${path}.origin`);
    return Object.freeze({
      identity: relationshipIdentity(coordinate, tableId, relationshipId),
      kind,
      foreignKey: constraintIdentity(
        coordinate,
        tableId,
        foreignKeyConstraintId,
      ),
      origin,
    });
  });
}

function decodeCapability(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalPersistenceCapability, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const kind = yield* discriminant(input, path);
    if (kind === "searchableText") {
      const fields = yield* exactRecord(
        input,
        ["capabilityId", "kind", "columns", "origin"],
        path,
      );
      const capabilityId = yield* decodeIdentityString(
        fields.at(0),
        `${path}.capabilityId`,
        brandCapabilityId,
      );
      const columns = yield* decodeColumnReferences(
        fields.at(2),
        coordinate,
        `${path}.columns`,
        true,
        budget,
      );
      const origin = yield* decodeOrigin(fields.at(3), `${path}.origin`);
      return Object.freeze({
        identity: capabilityIdentity(coordinate, capabilityId),
        kind,
        columns,
        origin,
      });
    }
    if (kind === "exactNumericCompanion") {
      const fields = yield* exactRecord(input, [
        "capabilityId",
        "kind",
        "numericColumn",
        "rawColumn",
        "origin",
      ], path);
      const capabilityId = yield* decodeIdentityString(
        fields.at(0),
        `${path}.capabilityId`,
        brandCapabilityId,
      );
      const numericColumn = yield* decodeColumnReference(
        fields.at(2),
        coordinate,
        `${path}.numericColumn`,
        budget,
      );
      const rawColumn = yield* decodeColumnReference(
        fields.at(3),
        coordinate,
        `${path}.rawColumn`,
        budget,
      );
      const origin = yield* decodeOrigin(fields.at(4), `${path}.origin`);
      return Object.freeze({
        identity: capabilityIdentity(coordinate, capabilityId),
        kind,
        numericColumn,
        rawColumn,
        origin,
      });
    }
    if (kind === "managedTimestamps") {
      const fields = yield* exactRecord(input, [
        "capabilityId",
        "kind",
        "createdAtColumn",
        "updatedAtColumn",
        "updateBehavior",
        "origin",
      ], path);
      const capabilityId = yield* decodeIdentityString(
        fields.at(0),
        `${path}.capabilityId`,
        brandCapabilityId,
      );
      const createdAtColumn = yield* decodeColumnReference(
        fields.at(2),
        coordinate,
        `${path}.createdAtColumn`,
        budget,
      );
      const updatedAtColumn = yield* decodeColumnReference(
        fields.at(3),
        coordinate,
        `${path}.updatedAtColumn`,
        budget,
      );
      if (fields.at(4) !== "currentTimestampOnUpdate") {
        return yield* unsupported(`${path}.updateBehavior`, fields.at(4));
      }
      const origin = yield* decodeOrigin(fields.at(5), `${path}.origin`);
      return Object.freeze({
        identity: capabilityIdentity(coordinate, capabilityId),
        kind,
        createdAtColumn,
        updatedAtColumn,
        updateBehavior: "currentTimestampOnUpdate",
        origin,
      });
    }
    if (kind === "softDelete") {
      const fields = yield* exactRecord(input, [
        "capabilityId",
        "kind",
        "deletedAtColumn",
        "activeRowsIndex",
        "origin",
      ], path);
      const capabilityId = yield* decodeIdentityString(
        fields.at(0),
        `${path}.capabilityId`,
        brandCapabilityId,
      );
      const deletedAtColumn = yield* decodeColumnReference(
        fields.at(2),
        coordinate,
        `${path}.deletedAtColumn`,
        budget,
      );
      const activeRowsIndex = yield* decodeIndexReference(
        fields.at(3),
        coordinate,
        `${path}.activeRowsIndex`,
        budget,
      );
      const origin = yield* decodeOrigin(fields.at(4), `${path}.origin`);
      return Object.freeze({
        identity: capabilityIdentity(coordinate, capabilityId),
        kind,
        deletedAtColumn,
        activeRowsIndex,
        origin,
      });
    }
    return yield* unsupported(`${path}.kind`, kind);
  });
}

function validateRelationalSchema(
  schema: RelationalSchema,
): Result.Result<void, RelationalSchemaError> {
  return Result.gen(function* () {
    const tables = new Map<string, TableLookup>();
    for (const table of schema.tables) {
      const tablePath = `$.tables[${table.identity.tableId}]`;
      if (tables.has(table.identity.tableId)) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          `${tablePath}.tableId`,
        ));
      }
      const columns = yield* uniqueMap(
        table.columns,
        column => column.identity.columnId,
        `${tablePath}.columns`,
      );
      const keys = yield* uniqueMap(
        table.keys,
        key => key.identity.keyId,
        `${tablePath}.keys`,
      );
      const indexes = yield* uniqueMap(
        table.indexes,
        index => index.identity.indexId,
        `${tablePath}.indexes`,
      );
      const constraints = yield* uniqueMap(
        table.constraints,
        constraint => constraint.identity.constraintId,
        `${tablePath}.constraints`,
      );
      yield* uniqueMap(
        table.relationships,
        relationship => relationship.identity.relationshipId,
        `${tablePath}.relationships`,
      );
      const primaryKeys = table.keys.filter(key => key.kind === "primary");
      if (primaryKeys.length !== 1) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          `${tablePath}.keys`,
        ));
      }
      for (const column of table.columns) {
        yield* validateColumnDefault(column, tablePath);
      }
      for (const key of table.keys) {
        yield* validateLocalColumns(
          key.columns,
          columns,
          `${tablePath}.keys[${key.identity.keyId}].columns`,
        );
        if (key.kind === "primary") {
          for (const columnIdentityValue of key.columns) {
            const column = columns.get(columnIdentityValue.columnId);
            if (column === undefined || column.nullable) {
              return yield* Result.fail(RelationalSchemaError.invalidInput(
                `${tablePath}.keys[${key.identity.keyId}]`,
              ));
            }
          }
        }
      }
      for (const index of table.indexes) {
        yield* validateLocalColumns(
          index.columns,
          columns,
          `${tablePath}.indexes[${index.identity.indexId}].columns`,
        );
        if (index.predicate !== null) {
          yield* requireColumn(
            columns,
            index.predicate.column,
            `${tablePath}.indexes[${index.identity.indexId}].predicate`,
          );
          if (!index.columns.some(column =>
            column.columnId === index.predicate?.column.columnId
          )) {
            return yield* Result.fail(RelationalSchemaError.invalidInput(
              `${tablePath}.indexes[${index.identity.indexId}].predicate`,
            ));
          }
        }
      }
      tables.set(table.identity.tableId, {
        table,
        columns,
        keys,
        indexes,
        constraints,
      });
    }

    for (const lookup of tables.values()) {
      const tablePath = `$.tables[${lookup.table.identity.tableId}]`;
      for (const constraint of lookup.table.constraints) {
        const constraintPath =
          `${tablePath}.constraints[${constraint.identity.constraintId}]`;
        if (constraint.kind === "integerRange") {
          const column = yield* requireColumn(
            lookup.columns,
            constraint.column,
            `${constraintPath}.column`,
          );
          if (column.type !== "integer") {
            return yield* Result.fail(RelationalSchemaError.invalidInput(
              `${constraintPath}.column`,
            ));
          }
          if (
            column.default.kind === "integerLiteral" &&
            (
              (constraint.minimum !== null &&
                column.default.value < constraint.minimum) ||
              (constraint.maximum !== null &&
                column.default.value > constraint.maximum)
            )
          ) {
            return yield* Result.fail(RelationalSchemaError.invalidInput(
              `${constraintPath}.column`,
            ));
          }
          continue;
        }
        yield* validateLocalColumns(
          constraint.sourceColumns,
          lookup.columns,
          `${constraintPath}.sourceColumns`,
        );
        const targetTableId = yield* commonTableId(
          constraint.targetColumns,
          `${constraintPath}.targetColumns`,
        );
        const target = tables.get(targetTableId);
        if (target === undefined) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            `${constraintPath}.targetColumns`,
          ));
        }
        yield* validateLocalColumns(
          constraint.targetColumns,
          target.columns,
          `${constraintPath}.targetColumns`,
        );
        if (constraint.sourceColumns.length !== constraint.targetColumns.length) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            constraintPath,
          ));
        }
        for (let index = 0; index < constraint.sourceColumns.length; index += 1) {
          const sourceIdentity = constraint.sourceColumns[index];
          const targetIdentity = constraint.targetColumns[index];
          if (sourceIdentity === undefined || targetIdentity === undefined) {
            return yield* Result.fail(RelationalSchemaError.invalidInput(
              constraintPath,
            ));
          }
          const sourceColumn = lookup.columns.get(sourceIdentity.columnId);
          const targetColumn = target.columns.get(targetIdentity.columnId);
          if (
            sourceColumn === undefined ||
            targetColumn === undefined ||
            sourceColumn.type !== targetColumn.type
          ) {
            return yield* Result.fail(RelationalSchemaError.invalidInput(
              constraintPath,
            ));
          }
        }
        const targetColumnIds = constraint.targetColumns.map(
          column => column.columnId,
        );
        if (!target.table.keys.some(key =>
          sameStringSets(
            key.columns.map(column => column.columnId),
            targetColumnIds,
          )
        )) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            `${constraintPath}.targetColumns`,
          ));
        }
      }

      for (const relationship of lookup.table.relationships) {
        const relationshipPath =
          `${tablePath}.relationships[${relationship.identity.relationshipId}]`;
        const constraint = lookup.constraints.get(
          relationship.foreignKey.constraintId,
        );
        if (constraint === undefined || constraint.kind !== "foreignKey") {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            `${relationshipPath}.foreignKey`,
          ));
        }
        const sourceColumnIds = constraint.sourceColumns.map(
          column => column.columnId,
        );
        const sourceIsUnique = lookup.table.keys.some(key =>
          sameStringSets(
            key.columns.map(column => column.columnId),
            sourceColumnIds,
          )
        );
        if (
          (relationship.kind === "oneToOne" && !sourceIsUnique) ||
          (relationship.kind === "manyToOne" && sourceIsUnique)
        ) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            relationshipPath,
          ));
        }
      }
    }

    const capabilityIds = new Set<string>();
    const derivedColumns = new Set<string>();
    const implicitColumns = new Set<string>();
    for (const capability of schema.capabilities) {
      const capabilityPath =
        `$.capabilities[${capability.identity.capabilityId}]`;
      if (capabilityIds.has(capability.identity.capabilityId)) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          `${capabilityPath}.capabilityId`,
        ));
      }
      capabilityIds.add(capability.identity.capabilityId);
      if (capability.kind === "searchableText") {
        if (capability.origin.kind !== "authored") {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            `${capabilityPath}.origin`,
          ));
        }
        yield* uniqueReferences(capability.columns, `${capabilityPath}.columns`);
        for (const reference of capability.columns) {
          const column = yield* resolveColumn(tables, reference, capabilityPath);
          if (column.type !== "text" || column.origin.kind !== "authored") {
            return yield* Result.fail(RelationalSchemaError.invalidInput(
              `${capabilityPath}.columns`,
            ));
          }
        }
        continue;
      }
      if (capability.kind === "exactNumericCompanion") {
        const numeric = yield* resolveColumn(
          tables,
          capability.numericColumn,
          `${capabilityPath}.numericColumn`,
        );
        const raw = yield* resolveColumn(
          tables,
          capability.rawColumn,
          `${capabilityPath}.rawColumn`,
        );
        if (
          capability.origin.kind !== "derived" ||
          numeric.identity.tableId !== raw.identity.tableId ||
          numeric.type !== "numeric" ||
          numeric.origin.kind !== "authored" ||
          raw.type !== "jsonb" ||
          raw.origin.kind !== "derived" ||
          numeric.nullable !== raw.nullable ||
          numeric.default.kind !== "exactNumericLiteral" ||
          raw.default.kind !== "exactNumericRawLiteral" ||
          numeric.default.value !== raw.default.value
        ) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            capabilityPath,
          ));
        }
        const rawKey = columnKey(raw.identity);
        if (derivedColumns.has(rawKey)) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            capabilityPath,
          ));
        }
        derivedColumns.add(rawKey);
        continue;
      }
      if (capability.kind === "managedTimestamps") {
        const createdAt = yield* resolveColumn(
          tables,
          capability.createdAtColumn,
          `${capabilityPath}.createdAtColumn`,
        );
        const updatedAt = yield* resolveColumn(
          tables,
          capability.updatedAtColumn,
          `${capabilityPath}.updatedAtColumn`,
        );
        if (
          capability.origin.kind !== "implicit" ||
          createdAt.identity.tableId !== updatedAt.identity.tableId ||
          createdAt.identity.columnId === updatedAt.identity.columnId ||
          !isManagedTimestampColumn(createdAt) ||
          !isManagedTimestampColumn(updatedAt)
        ) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            capabilityPath,
          ));
        }
        const createdKey = columnKey(createdAt.identity);
        const updatedKey = columnKey(updatedAt.identity);
        if (implicitColumns.has(createdKey) || implicitColumns.has(updatedKey)) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            capabilityPath,
          ));
        }
        implicitColumns.add(createdKey);
        implicitColumns.add(updatedKey);
        continue;
      }
      const deletedAt = yield* resolveColumn(
        tables,
        capability.deletedAtColumn,
        `${capabilityPath}.deletedAtColumn`,
      );
      const table = tables.get(capability.activeRowsIndex.tableId);
      const index = table?.indexes.get(capability.activeRowsIndex.indexId);
      if (
        capability.origin.kind !== "implicit" ||
        deletedAt.identity.tableId !== capability.activeRowsIndex.tableId ||
        deletedAt.type !== "timestamptz" ||
        !deletedAt.nullable ||
        deletedAt.default.kind !== "none" ||
        deletedAt.origin.kind !== "implicit" ||
        index === undefined ||
        index.columns.length !== 1 ||
        index.columns[0]?.columnId !== deletedAt.identity.columnId ||
        index.origin.kind !== "implicit" ||
        index.predicate?.kind !== "isNull" ||
        index.predicate.column.columnId !== deletedAt.identity.columnId
      ) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          capabilityPath,
        ));
      }
      const deletedKey = columnKey(deletedAt.identity);
      if (implicitColumns.has(deletedKey)) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          capabilityPath,
        ));
      }
      implicitColumns.add(deletedKey);
    }

    for (const table of schema.tables) {
      for (const column of table.columns) {
        const key = columnKey(column.identity);
        if (
          (column.origin.kind === "derived" && !derivedColumns.has(key)) ||
          (column.origin.kind === "implicit" && !implicitColumns.has(key))
        ) {
          return yield* Result.fail(RelationalSchemaError.invalidInput(
            `$.tables[${table.identity.tableId}].columns[${column.identity.columnId}].origin`,
          ));
        }
      }
    }
  });
}

function validateColumnDefault(
  column: RelationalColumnDefinition,
  tablePath: string,
): Result.Result<void, RelationalSchemaError> {
  const path = `${tablePath}.columns[${column.identity.columnId}].default`;
  const defaultValue = column.default;
  if (defaultValue.kind === "none") return Result.succeed(undefined);
  const valid =
    (defaultValue.kind === "textLiteral" && column.type === "text") ||
    (defaultValue.kind === "integerLiteral" && column.type === "integer") ||
    (defaultValue.kind === "exactNumericLiteral" && column.type === "numeric") ||
    (defaultValue.kind === "exactNumericRawLiteral" && column.type === "jsonb") ||
    (defaultValue.kind === "currentTimestamp" && column.type === "timestamptz");
  return valid
    ? Result.succeed(undefined)
    : Result.fail(RelationalSchemaError.invalidInput(path));
}

function isManagedTimestampColumn(column: RelationalColumnDefinition): boolean {
  return column.type === "timestamptz" &&
    !column.nullable &&
    column.default.kind === "currentTimestamp" &&
    column.origin.kind === "implicit";
}

function decodeColumnDefault(
  input: unknown,
  path: string,
): Result.Result<RelationalColumnDefault, RelationalSchemaError> {
  return Result.gen(function* () {
    const kind = yield* discriminant(input, path);
    if (kind === "none" || kind === "currentTimestamp") {
      yield* exactRecord(input, ["kind"], path);
      return Object.freeze({ kind });
    }
    if (kind === "textLiteral") {
      const fields = yield* exactRecord(input, ["kind", "value"], path);
      const value = yield* decodeText(fields.at(1), `${path}.value`);
      return Object.freeze({ kind, value });
    }
    if (kind === "integerLiteral") {
      const fields = yield* exactRecord(input, ["kind", "value"], path);
      const value = yield* decodePostgresInteger(fields.at(1), `${path}.value`);
      return Object.freeze({ kind, value });
    }
    if (kind === "exactNumericLiteral") {
      const fields = yield* exactRecord(input, ["kind", "value"], path);
      const value = yield* decodeExactNumeric(fields.at(1), `${path}.value`);
      return Object.freeze({ kind, value });
    }
    if (kind === "exactNumericRawLiteral") {
      const fields = yield* exactRecord(
        input,
        ["kind", "value", "precision"],
        path,
      );
      const value = yield* decodeExactNumeric(fields.at(1), `${path}.value`);
      const precision = fields.at(2);
      if (!isPositiveSafeInteger(precision) || precision > 1_000) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          `${path}.precision`,
        ));
      }
      return Object.freeze({ kind, value, precision });
    }
    return yield* unsupported(`${path}.kind`, kind);
  });
}

function decodeOrigin(
  input: unknown,
  path: string,
): Result.Result<RelationalDefinitionOrigin, RelationalSchemaError> {
  return Result.gen(function* () {
    const fields = yield* exactRecord(input, ["kind", "sourceId"], path);
    const kind = yield* decodeOriginKind(fields.at(0), `${path}.kind`);
    const sourceId = yield* decodeIdentityString(
      fields.at(1),
      `${path}.sourceId`,
      brandSourceId,
    );
    return Object.freeze({
      kind,
      sourceId,
    });
  });
}

function decodeColumnType(
  input: unknown,
  path: string,
): Result.Result<RelationalColumnType, RelationalSchemaError> {
  switch (input) {
    case "text":
    case "integer":
    case "numeric":
    case "jsonb":
    case "timestamptz":
      return Result.succeed(input);
    default:
      return unsupported(path, input);
  }
}

function decodeOwner(
  input: unknown,
  path: string,
): Result.Result<RelationalSchemaOwner, RelationalSchemaError> {
  switch (input) {
    case "medusa":
    case "system":
      return Result.succeed(input);
    default:
      return unsupported(path, input);
  }
}

function decodeOriginKind(
  input: unknown,
  path: string,
): Result.Result<RelationalDefinitionOrigin["kind"], RelationalSchemaError> {
  switch (input) {
    case "authored":
    case "derived":
    case "implicit":
    case "synthetic":
      return Result.succeed(input);
    default:
      return unsupported(path, input);
  }
}

function decodeLocalColumnIdentities(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<readonly RelationalColumnIdentity[], RelationalSchemaError> {
  return Result.gen(function* () {
    const inputs = yield* denseArray(
      input,
      path,
      MAX_RELATIONAL_SCHEMA_REFERENCE_COLUMNS,
    );
    if (inputs.length === 0) {
      return yield* Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const output: RelationalColumnIdentity[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      yield* consumeDecodeUnit(budget, `${path}[${index}]`);
      const columnId = yield* decodeIdentityString(
        inputs[index],
        `${path}[${index}]`,
        brandColumnId,
      );
      output.push(columnIdentity(coordinate, tableId, columnId));
    }
    return Object.freeze(output);
  });
}

function decodeColumnReferences(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  path: string,
  sort: boolean,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<readonly RelationalColumnReference[], RelationalSchemaError> {
  return Result.gen(function* () {
    const inputs = yield* denseArray(
      input,
      path,
      MAX_RELATIONAL_SCHEMA_REFERENCE_COLUMNS,
    );
    if (inputs.length === 0) {
      return yield* Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const output: RelationalColumnReference[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      output.push(yield* decodeColumnReference(
        inputs[index],
        coordinate,
        `${path}[${index}]`,
        budget,
      ));
    }
    if (sort) output.sort(compareColumnReferences);
    return Object.freeze(output);
  });
}

function decodeColumnReference(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalColumnReference, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(input, ["tableId", "columnId"], path);
    const tableId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.tableId`,
      brandTableId,
    );
    const columnId = yield* decodeIdentityString(
      fields.at(1),
      `${path}.columnId`,
      brandColumnId,
    );
    return columnIdentity(coordinate, tableId, columnId);
  });
}

function decodeIndexReference(
  input: unknown,
  coordinate: RelationalSchemaCoordinate,
  path: string,
  budget: RelationalSchemaDecodeBudget,
): Result.Result<RelationalIndexIdentity, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* consumeDecodeUnit(budget, path);
    const fields = yield* exactRecord(input, ["tableId", "indexId"], path);
    const tableId = yield* decodeIdentityString(
      fields.at(0),
      `${path}.tableId`,
      brandTableId,
    );
    const indexId = yield* decodeIdentityString(
      fields.at(1),
      `${path}.indexId`,
      brandIndexId,
    );
    return indexIdentity(coordinate, tableId, indexId);
  });
}

function compareColumnReferences(
  left: RelationalColumnReference,
  right: RelationalColumnReference,
): number {
  const tableOrder = compareUtf16Strings(left.tableId, right.tableId);
  return tableOrder === 0
    ? compareUtf16Strings(left.columnId, right.columnId)
    : tableOrder;
}

function consumeDecodeUnit(
  budget: RelationalSchemaDecodeBudget,
  path: string,
): Result.Result<void, RelationalSchemaError> {
  if (budget.units >= MAX_RELATIONAL_SCHEMA_DECODE_UNITS) {
    return Result.fail(RelationalSchemaError.invalidInput(path));
  }
  budget.units += 1;
  return Result.succeed(undefined);
}

function decodeArrayMembers<T>(
  input: unknown,
  path: string,
  decode: (input: Readonly<{ value: unknown; path: string }>) =>
    Result.Result<T, RelationalSchemaError>,
): Result.Result<T[], RelationalSchemaError> {
  return Result.gen(function* () {
    const inputs = yield* denseArray(
      input,
      path,
      MAX_RELATIONAL_SCHEMA_DEFINITIONS_PER_TABLE,
    );
    const output: T[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      output.push(yield* decode({
        value: inputs[index],
        path: `${path}[${index}]`,
      }));
    }
    return output;
  });
}

function decodeIdentityString<T extends string>(
  input: unknown,
  path: string,
  brand: (value: string) => T,
): Result.Result<T, RelationalSchemaError> {
  if (
    !isNonBlankString(input) ||
    input.includes("\0") ||
    !isWellFormedUtf16(input) ||
    UTF8.encode(input).byteLength > MAX_RELATIONAL_SCHEMA_ID_UTF8_BYTES
  ) {
    return Result.fail(RelationalSchemaError.invalidInput(path));
  }
  return Result.succeed(brand(input));
}

function decodeText(
  input: unknown,
  path: string,
): Result.Result<string, RelationalSchemaError> {
  return typeof input === "string" &&
      !input.includes("\0") &&
      isWellFormedUtf16(input)
    ? Result.succeed(input)
    : Result.fail(RelationalSchemaError.invalidInput(path));
}

function decodeExactNumeric(
  input: unknown,
  path: string,
): Result.Result<string, RelationalSchemaError> {
  return typeof input === "string" &&
      input !== "-0" &&
      input.length <= MAX_RELATIONAL_SCHEMA_ID_UTF8_BYTES &&
      EXACT_NUMERIC.test(input)
    ? Result.succeed(input)
    : Result.fail(RelationalSchemaError.invalidInput(path));
}

function decodeBoolean(
  input: unknown,
  path: string,
): Result.Result<boolean, RelationalSchemaError> {
  return typeof input === "boolean"
    ? Result.succeed(input)
    : Result.fail(RelationalSchemaError.invalidInput(path));
}

function decodePostgresInteger(
  input: unknown,
  path: string,
): Result.Result<number, RelationalSchemaError> {
  return typeof input === "number" &&
      Number.isSafeInteger(input) &&
      input >= POSTGRES_INTEGER_MINIMUM &&
      input <= POSTGRES_INTEGER_MAXIMUM
    ? Result.succeed(input === 0 ? 0 : input)
    : Result.fail(RelationalSchemaError.invalidInput(path));
}

function decodeNullablePostgresInteger(
  input: unknown,
  path: string,
): Result.Result<number | null, RelationalSchemaError> {
  return input === null
    ? Result.succeed(null)
    : decodePostgresInteger(input, path);
}

function discriminant(
  input: unknown,
  path: string,
): Result.Result<string, RelationalSchemaError> {
  return Result.flatMap(inspectRecord(input, path), record => {
    const kind = record.get("kind");
    if (typeof kind !== "string") {
      return Result.fail(RelationalSchemaError.invalidInput(`${path}.kind`));
    }
    return Result.succeed(kind);
  });
}

function exactRecord(
  input: unknown,
  keys: readonly string[],
  path: string,
): Result.Result<readonly unknown[], RelationalSchemaError> {
  return Result.flatMap(inspectRecord(input, path), record => {
    if (record.size !== keys.length || keys.some(key => !record.has(key))) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    return Result.succeed(Object.freeze(keys.map(key => record.get(key))));
  });
}

function inspectRecord(
  input: unknown,
  path: string,
): Result.Result<ReadonlyMap<string, unknown>, RelationalSchemaError> {
  try {
    if (!isNonArrayRecord(input)) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const values = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") {
        return Result.fail(RelationalSchemaError.invalidInput(path));
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(RelationalSchemaError.invalidInput(path));
      }
      values.set(key, descriptor.value);
    }
    return Result.succeed(values);
  } catch {
    return Result.fail(RelationalSchemaError.invalidInput(path));
  }
}

function denseArray(
  input: unknown,
  path: string,
  maximumLength: number,
): Result.Result<readonly unknown[], RelationalSchemaError> {
  try {
    if (!Array.isArray(input)) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    if (Object.getPrototypeOf(input) !== Array.prototype) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      lengthDescriptor === undefined ||
      lengthDescriptor.enumerable ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    ) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const length: number = lengthDescriptor.value;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== length + 1 || keys.some(key => typeof key === "symbol")) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(RelationalSchemaError.invalidInput(path));
      }
      output.push(descriptor.value);
    }
    return Result.succeed(Object.freeze(output));
  } catch {
    return Result.fail(RelationalSchemaError.invalidInput(path));
  }
}

function unsupported(
  path: string,
  value: unknown,
): Result.Result<never, RelationalSchemaError> {
  if (typeof value !== "string") {
    return Result.fail(RelationalSchemaError.invalidInput(path));
  }
  return Result.fail(RelationalSchemaError.unsupportedCapability(
    path,
    value,
  ));
}

function tableIdentity(
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
): RelationalTableIdentity {
  return Object.freeze({ ...coordinate, tableId });
}

function columnIdentity(
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  columnId: RelationalColumnId,
): RelationalColumnIdentity {
  return Object.freeze({ ...coordinate, tableId, columnId });
}

function keyIdentity(
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  keyId: RelationalKeyId,
): RelationalKeyIdentity {
  return Object.freeze({ ...coordinate, tableId, keyId });
}

function indexIdentity(
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  indexId: RelationalIndexId,
): RelationalIndexIdentity {
  return Object.freeze({ ...coordinate, tableId, indexId });
}

function constraintIdentity(
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  constraintId: RelationalConstraintId,
): RelationalConstraintIdentity {
  return Object.freeze({ ...coordinate, tableId, constraintId });
}

function relationshipIdentity(
  coordinate: RelationalSchemaCoordinate,
  tableId: RelationalTableId,
  relationshipId: RelationalRelationshipId,
): RelationalRelationshipIdentity {
  return Object.freeze({ ...coordinate, tableId, relationshipId });
}

function capabilityIdentity(
  coordinate: RelationalSchemaCoordinate,
  capabilityId: RelationalPersistenceCapabilityId,
): RelationalPersistenceCapabilityIdentity {
  return Object.freeze({ ...coordinate, capabilityId });
}

function uniqueMap<T>(
  values: readonly T[],
  key: (value: T) => string,
  path: string,
): Result.Result<ReadonlyMap<string, T>, RelationalSchemaError> {
  const output = new Map<string, T>();
  for (const value of values) {
    const currentKey = key(value);
    if (output.has(currentKey)) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    output.set(currentKey, value);
  }
  return Result.succeed(output);
}

function validateLocalColumns(
  identities: readonly RelationalColumnIdentity[],
  columns: ReadonlyMap<string, RelationalColumnDefinition>,
  path: string,
): Result.Result<void, RelationalSchemaError> {
  return Result.gen(function* () {
    yield* uniqueReferences(identities, path);
    for (const identity of identities) {
      yield* requireColumn(columns, identity, path);
    }
  });
}

function requireColumn(
  columns: ReadonlyMap<string, RelationalColumnDefinition>,
  identity: RelationalColumnIdentity,
  path: string,
): Result.Result<RelationalColumnDefinition, RelationalSchemaError> {
  const column = columns.get(identity.columnId);
  return column === undefined
    ? Result.fail(RelationalSchemaError.invalidInput(path))
    : Result.succeed(column);
}

function resolveColumn(
  tables: ReadonlyMap<string, TableLookup>,
  identity: RelationalColumnIdentity,
  path: string,
): Result.Result<RelationalColumnDefinition, RelationalSchemaError> {
  const column = tables.get(identity.tableId)?.columns.get(identity.columnId);
  return column === undefined
    ? Result.fail(RelationalSchemaError.invalidInput(path))
    : Result.succeed(column);
}

function uniqueReferences(
  identities: readonly RelationalColumnIdentity[],
  path: string,
): Result.Result<void, RelationalSchemaError> {
  const observed = new Set<string>();
  for (const identity of identities) {
    const key = columnKey(identity);
    if (observed.has(key)) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
    observed.add(key);
  }
  return Result.succeed(undefined);
}

function commonTableId(
  identities: readonly RelationalColumnIdentity[],
  path: string,
): Result.Result<string, RelationalSchemaError> {
  const first = identities[0];
  if (first === undefined) {
    return Result.fail(RelationalSchemaError.invalidInput(path));
  }
  for (const identity of identities) {
    if (identity.tableId !== first.tableId) {
      return Result.fail(RelationalSchemaError.invalidInput(path));
    }
  }
  return Result.succeed(first.tableId);
}

function columnKey(identity: RelationalColumnIdentity): string {
  return `${identity.tableId}\0${identity.columnId}`;
}

function sameStringSets(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return rightValues.size === right.length && left.every(value =>
    rightValues.has(value)
  );
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
