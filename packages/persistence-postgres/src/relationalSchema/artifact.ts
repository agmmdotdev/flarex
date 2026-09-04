import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings, isNonBlankString } from "@flarex/utils/strings";
import { Effect, Result } from "effect";

import { captureFrameworkSchemaArtifact } from
  "../frameworkSchema/artifact/canonical";
import type { FrameworkSchemaArtifactError } from
  "../frameworkSchema/artifact/errors";
import type { FrameworkSchemaArtifact } from
  "../frameworkSchema/artifact/model";
import { RelationalSchemaError } from "./errors";
import {
  RELATIONAL_SCHEMA_FORMAT,
  RELATIONAL_SCHEMA_FORMAT_VERSION,
  type CapturedRelationalSchemaArtifact,
  type RelationalSchema,
  type RelationalSchemaArtifactCaptureInput,
  type RelationalSchemaArtifactProvenance,
} from "./model";
import { normalizeRelationalSchema } from "./policy";

const MAX_PROVENANCE_TEXT_UTF8_BYTES = 4_096;
const MAX_PROVENANCE_PATHS = 256;
const UTF8 = new TextEncoder();
const capturedRelationalSchemas = new WeakMap<
  import("../frameworkSchema/artifact/model").FrameworkSchemaArtifact,
  RelationalSchema
>();

export const captureRelationalSchemaArtifact = Effect.fn(
  "RelationalSchema.captureArtifact",
)(function* (
  input: RelationalSchemaArtifactCaptureInput,
): Effect.fn.Return<
  CapturedRelationalSchemaArtifact,
  RelationalSchemaError | FrameworkSchemaArtifactError
> {
  const fields = yield* Effect.fromResult(exactRecord(
    input,
    ["deploymentId", "provenance", "schema"],
    "$",
  ));
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(fields.at(2)));
  const provenance = yield* Effect.fromResult(
    normalizeRelationalSchemaArtifactProvenance(fields.at(1)),
  );
  const artifact = yield* captureFrameworkSchemaArtifact({
    deploymentId: fields.at(0),
    owner: schema.coordinate.owner,
    lineageId: schema.coordinate.lineageId,
    payloadCodec: {
      format: RELATIONAL_SCHEMA_FORMAT,
      version: RELATIONAL_SCHEMA_FORMAT_VERSION,
    },
    provenance,
    capabilities: deriveArtifactCapabilityIds(schema),
    dependencies: [],
    payload: schema,
  });
  capturedRelationalSchemas.set(artifact, schema);
  return Object.freeze({ schema, artifact });
});

/**
 * Reissues relational lowering authority only after a repository-restored
 * artifact reproduces its complete canonical artifact value exactly.
 */
export const authenticateStoredRelationalSchemaArtifactEffect = Effect.fn(
  "RelationalSchema.authenticateStoredArtifact",
)(function* (
  artifact: FrameworkSchemaArtifact,
): Effect.fn.Return<
  CapturedRelationalSchemaArtifact,
  RelationalSchemaError | FrameworkSchemaArtifactError
> {
  const captured = yield* captureRelationalSchemaArtifact({
    deploymentId: artifact.identity.deploymentId,
    provenance: artifact.provenance,
    schema: sourceSchemaInputFromStoredPayload(artifact.payload),
  });
  if (
    captured.artifact.canonicalJson !== artifact.canonicalJson ||
    captured.artifact.identity.artifactSha256 !==
      artifact.identity.artifactSha256
  ) {
    return yield* Effect.fail(RelationalSchemaError.invalidInput(
      "$",
      "composeArtifact",
    ));
  }
  return captured;
});

function sourceSchemaInputFromStoredPayload(input: unknown) {
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

/** Package-private semantic value paired with this exact issued artifact. */
export function readCapturedRelationalSchemaArtifactSchema(
  artifact: FrameworkSchemaArtifact,
): RelationalSchema | undefined {
  return capturedRelationalSchemas.get(artifact);
}

export function normalizeRelationalSchemaArtifactProvenance(
  input: unknown,
): Result.Result<RelationalSchemaArtifactProvenance, RelationalSchemaError> {
  return Result.gen(function* () {
    const kind = yield* readKind(input, "$.provenance");
    if (kind === "synthetic") {
      const fields = yield* exactRecord(
        input,
        ["kind", "fixtureId"],
        "$.provenance",
      );
      const fixtureId = yield* provenanceText(
        fields.at(1),
        "$.provenance.fixtureId",
      );
      return Object.freeze({ kind, fixtureId });
    }
    if (kind === "sourceSnapshot") {
      const fields = yield* exactRecord(
        input,
        ["kind", "repository", "revision", "paths"],
        "$.provenance",
      );
      const repository = yield* provenanceText(
        fields.at(1),
        "$.provenance.repository",
      );
      const revision = yield* provenanceText(
        fields.at(2),
        "$.provenance.revision",
      );
      const pathInputs = yield* denseArray(
        fields.at(3),
        "$.provenance.paths",
        MAX_PROVENANCE_PATHS,
      );
      if (pathInputs.length === 0) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          "$.provenance.paths",
          "composeArtifact",
        ));
      }
      const paths: string[] = [];
      for (let index = 0; index < pathInputs.length; index += 1) {
        paths.push(yield* provenanceText(
          pathInputs[index],
          `$.provenance.paths[${index}]`,
        ));
      }
      paths.sort(compareUtf16Strings);
      if (paths.some((path, index) => index > 0 && path === paths[index - 1])) {
        return yield* Result.fail(RelationalSchemaError.invalidInput(
          "$.provenance.paths",
          "composeArtifact",
        ));
      }
      return Object.freeze({
        kind,
        repository,
        revision,
        paths: Object.freeze(paths),
      });
    }
    return yield* Result.fail(RelationalSchemaError.unsupportedCapability(
      "$.provenance.kind",
      kind,
      "composeArtifact",
    ));
  });
}

function deriveArtifactCapabilityIds(schema: RelationalSchema): readonly string[] {
  const capabilities = new Set<string>(["relational-schema"]);
  for (const table of schema.tables) {
    for (const column of table.columns) {
      capabilities.add(`relational-schema.column.${column.type}`);
      if (column.default.kind !== "none") {
        capabilities.add(`relational-schema.default.${column.default.kind}`);
      }
    }
    for (const key of table.keys) {
      capabilities.add(`relational-schema.key.${key.kind}`);
    }
    for (const index of table.indexes) {
      capabilities.add(`relational-schema.index.${index.kind}`);
      if (index.predicate !== null) {
        capabilities.add(
          `relational-schema.index-predicate.${index.predicate.kind}`,
        );
      }
    }
    for (const constraint of table.constraints) {
      capabilities.add(`relational-schema.constraint.${constraint.kind}`);
    }
    for (const relationship of table.relationships) {
      capabilities.add(
        `relational-schema.relationship.${relationship.kind}`,
      );
    }
  }
  for (const capability of schema.capabilities) {
    capabilities.add(`relational-schema.persistence.${capability.kind}`);
  }
  return Object.freeze([...capabilities].toSorted(compareUtf16Strings));
}

function readKind(
  input: unknown,
  path: string,
): Result.Result<string, RelationalSchemaError> {
  return Result.flatMap(inspectRecord(input, path), record => {
    const kind = record.get("kind");
    return typeof kind === "string"
      ? Result.succeed(kind)
      : Result.fail(RelationalSchemaError.invalidInput(
          `${path}.kind`,
          "composeArtifact",
        ));
  });
}

function provenanceText(
  input: unknown,
  path: string,
): Result.Result<string, RelationalSchemaError> {
  if (
    !isNonBlankString(input) ||
    input.includes("\0") ||
    UTF8.encode(input).byteLength > MAX_PROVENANCE_TEXT_UTF8_BYTES
  ) {
    return Result.fail(RelationalSchemaError.invalidInput(
      path,
      "composeArtifact",
    ));
  }
  return Result.succeed(input);
}

function exactRecord(
  input: unknown,
  keys: readonly string[],
  path: string,
): Result.Result<readonly unknown[], RelationalSchemaError> {
  return Result.flatMap(inspectRecord(input, path), record => {
    if (record.size !== keys.length || keys.some(key => !record.has(key))) {
      return Result.fail(RelationalSchemaError.invalidInput(
        path,
        "composeArtifact",
      ));
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
      return Result.fail(RelationalSchemaError.invalidInput(
        path,
        "composeArtifact",
      ));
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return Result.fail(RelationalSchemaError.invalidInput(
        path,
        "composeArtifact",
      ));
    }
    const output = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") {
        return Result.fail(RelationalSchemaError.invalidInput(
          path,
          "composeArtifact",
        ));
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(RelationalSchemaError.invalidInput(
          path,
          "composeArtifact",
        ));
      }
      output.set(key, descriptor.value);
    }
    return Result.succeed(output);
  } catch {
    return Result.fail(RelationalSchemaError.invalidInput(
      path,
      "composeArtifact",
    ));
  }
}

function denseArray(
  input: unknown,
  path: string,
  maximumLength: number,
): Result.Result<readonly unknown[], RelationalSchemaError> {
  try {
    if (!Array.isArray(input)) {
      return Result.fail(RelationalSchemaError.invalidInput(
        path,
        "composeArtifact",
      ));
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      Object.getPrototypeOf(input) !== Array.prototype ||
      lengthDescriptor === undefined ||
      lengthDescriptor.enumerable ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    ) {
      return Result.fail(RelationalSchemaError.invalidInput(
        path,
        "composeArtifact",
      ));
    }
    const length: number = lengthDescriptor.value;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== length + 1 || keys.some(key => typeof key === "symbol")) {
      return Result.fail(RelationalSchemaError.invalidInput(
        path,
        "composeArtifact",
      ));
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(RelationalSchemaError.invalidInput(
          path,
          "composeArtifact",
        ));
      }
      output.push(descriptor.value);
    }
    return Result.succeed(Object.freeze(output));
  } catch {
    return Result.fail(RelationalSchemaError.invalidInput(
      path,
      "composeArtifact",
    ));
  }
}
