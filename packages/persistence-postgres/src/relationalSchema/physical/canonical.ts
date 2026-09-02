import { compareUtf16Strings, isNonBlankString } from "@flarex/utils/strings";
import { Brand, Effect, Result } from "effect";
import type { JsonObject } from "flarex-protocol/json";

import {
  captureFrameworkSchemaTargetNamespace,
  frameworkSchemaTargetNamespacesEqual,
  type FrameworkSchemaTargetNamespace,
} from "../../migrationCoordination/targetNamespace";
import {
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../../frameworkSchema/artifact/canonical";
import type { FrameworkSchemaArtifact } from
  "../../frameworkSchema/artifact/model";
import {
  capturePrivateCanonicalValue,
  verifyStoredPrivateCanonicalValue,
} from
  "../../frameworkSchema/privateCanonicalValue";
import type {
  RelationalPhysicalLayoutSha256,
  RelationalPhysicalNameAssignmentSha256,
  RelationalPhysicalNameSha256,
} from "../../migrationCoordination/identity";
import type { ScopePhysicalLocator } from "../../scopeMetadataTypes";
import { captureScopePhysicalLocator } from "../../scopePhysicalLocator";
import {
  RELATIONAL_SCHEMA_FORMAT,
  RELATIONAL_SCHEMA_FORMAT_VERSION,
  type RelationalColumnDefault,
  type RelationalColumnIdentity,
  type RelationalConstraintIdentity,
  type RelationalPersistenceCapability,
  type RelationalSchema,
  type RelationalTableDefinition,
  type RelationalTableIdentity,
} from "../model";
import { readCapturedRelationalSchemaArtifactSchema } from "../artifact";
import {
  hasCapturedRelationalPhysicalLayout,
  registerCapturedRelationalPhysicalLayout,
} from "./authority";
import { RelationalPhysicalValueError } from "./errors";
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
  type RelationalPhysicalColumnType,
  type RelationalPhysicalDefault,
  type RelationalPhysicalForeignKey,
  type RelationalPhysicalIndex,
  type RelationalPhysicalIntegerRangeCheck,
  type RelationalPhysicalKey,
  type RelationalPhysicalLayout,
  type RelationalPhysicalLayoutFrame,
  type RelationalPhysicalName,
  type RelationalPhysicalNameAssignment,
  type RelationalPhysicalNameAssignmentFrame,
  type RelationalPhysicalNameFrame,
  type RelationalPhysicalNameSubject,
  type RelationalPhysicalRelationshipEvidence,
  type RelationalPhysicalTable,
} from "./model";
import {
  isStoredRelationalPhysicalLayoutFrame,
  isStoredRelationalPhysicalNameAssignmentFrame,
  isStoredRelationalPhysicalNameFrame,
} from "./storedValidation";

export const MAX_RELATIONAL_PHYSICAL_NAME_CANONICAL_BYTES = 8_192;
export const MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES = 20_480;
export const MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES = 4_194_304;

const BASE32HEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv";
const UTF8 = new TextEncoder();
const brandNameSha256 = Brand.nominal<RelationalPhysicalNameSha256>();
const brandAssignmentSha256 =
  Brand.nominal<RelationalPhysicalNameAssignmentSha256>();
const brandLayoutSha256 = Brand.nominal<RelationalPhysicalLayoutSha256>();

export interface CaptureRelationalPhysicalLayoutInput {
  readonly artifact: FrameworkSchemaArtifact;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly targetNamespace: FrameworkSchemaTargetNamespace;
}

export type RelationalPhysicalNameAssignmentReplay =
  | "exact"
  | "physicalNameCollision"
  | "differentTargetOrSpelling";

export const captureRelationalPhysicalLayout = Effect.fn(
  "RelationalPhysicalLayout.capture",
)(function* (
  input: CaptureRelationalPhysicalLayoutInput,
): Effect.fn.Return<RelationalPhysicalLayout, RelationalPhysicalValueError> {
  const schema = yield* Effect.fromResult(admitRelationalArtifact(
    input.artifact,
  ));
  const locator = yield* Effect.fromResult(capturePhysicalLocator(
    input.physicalLocator,
  ));
  const targetNamespace = yield* authenticateInertTargetNamespace(
    input.targetNamespace,
  );
  if (
    targetNamespace.frame.deploymentId !==
      input.artifact.identity.deploymentId ||
    targetNamespace.frame.schemaName !== locator.schemaName
  ) {
    return yield* Effect.fail(RelationalPhysicalValueError.invalidInput());
  }

  const names = new Map<string, RelationalPhysicalName>();
  const assignments: RelationalPhysicalNameAssignment[] = [];
  const nameFor = Effect.fn("RelationalPhysicalLayout.nameFor")(
    function* (
      subject: RelationalPhysicalNameSubject,
    ): Effect.fn.Return<RelationalPhysicalName, RelationalPhysicalValueError> {
      const name = yield* captureRelationalPhysicalName(
        input.artifact.identity.deploymentId,
        schema,
        subject,
      );
      const previous = names.get(name.spelling);
      if (
        previous !== undefined &&
        previous.canonicalJson !== name.canonicalJson
      ) {
        return yield* Effect.fail(
          RelationalPhysicalValueError.physicalNameCollision(name.spelling),
        );
      }
      if (previous === undefined) {
        names.set(name.spelling, name);
        assignments.push(yield* captureRelationalPhysicalNameAssignment(
          targetNamespace,
          name,
        ));
      }
      return name;
    },
  );

  const tableNames = new Map<string, string>();
  const columnNames = new Map<string, string>();
  const indexNames = new Map<string, string>();
  const foreignKeyNames = new Map<string, string>();
  for (const table of schema.tables) {
    tableNames.set(
      table.identity.tableId,
      (yield* nameFor(Object.freeze({
        kind: "table",
        identity: copyTableIdentity(table.identity),
      }))).spelling,
    );
    for (const column of table.columns) {
      columnNames.set(
        columnIdentityKey(column.identity),
        (yield* nameFor(Object.freeze({
          kind: "column",
          identity: copyColumnIdentity(column.identity),
        }))).spelling,
      );
    }
    for (const key of table.keys) {
      yield* nameFor(Object.freeze({
        kind: "key",
        identity: copyKeyIdentity(key.identity),
      }));
    }
    for (const index of table.indexes) {
      const name = yield* nameFor(Object.freeze({
        kind: "index",
        identity: copyIndexIdentity(index.identity),
      }));
      indexNames.set(indexIdentityKey(index.identity), name.spelling);
    }
    for (const constraint of table.constraints) {
      const subject = physicalConstraintNameSubject(constraint);
      const name = yield* nameFor(subject);
      switch (constraint.kind) {
        case "foreignKey":
          foreignKeyNames.set(
            constraintIdentityKey(constraint.identity),
            name.spelling,
          );
          break;
        case "integerRange":
          break;
        default:
          unreachablePhysicalVocabulary(constraint);
      }
    }
    const scopeForeignKey = yield* nameFor(Object.freeze({
      kind: "scopeAuthorityForeignKey",
      identity: copyTableIdentity(table.identity),
    }));
    foreignKeyNames.set(
      scopeForeignKeyKey(table.identity),
      scopeForeignKey.spelling,
    );
  }

  const tables: RelationalPhysicalTable[] = [];
  const foreignKeys: RelationalPhysicalForeignKey[] = [];
  const relationships: RelationalPhysicalRelationshipEvidence[] = [];
  for (const table of schema.tables) {
    const physicalTable = yield* Effect.fromResult(lowerTable(
      table,
      tableNames,
      columnNames,
      indexNames,
      names,
    ));
    tables.push(physicalTable);
    foreignKeys.push(yield* Effect.fromResult(lowerScopeAuthorityForeignKey(
      table.identity,
      foreignKeyNames,
    )));
    for (const constraint of table.constraints) {
      switch (constraint.kind) {
        case "foreignKey":
          foreignKeys.push(yield* Effect.fromResult(lowerForeignKey(
            constraint,
            tableNames,
            columnNames,
            foreignKeyNames,
          )));
          break;
        case "integerRange":
          break;
        default:
          unreachablePhysicalVocabulary(constraint);
      }
    }
    for (const relationship of table.relationships) {
      const foreignKeyName = foreignKeyNames.get(
        constraintIdentityKey(relationship.foreignKey),
      );
      if (foreignKeyName === undefined) {
        return yield* Effect.fail(RelationalPhysicalValueError.invalidInput());
      }
      relationships.push(Object.freeze({
        identity: copyRelationshipIdentity(relationship.identity),
        kind: relationship.kind,
        foreignKeyName,
        sourceUnique: relationshipSourceUnique(relationship.kind),
      }));
    }
  }
  foreignKeys.sort((left, right) => compareUtf16Strings(
    foreignKeySortKey(left),
    foreignKeySortKey(right),
  ));
  relationships.sort((left, right) => compareUtf16Strings(
    relationshipIdentityKey(left.identity),
    relationshipIdentityKey(right.identity),
  ));

  const requiredPhysicalCapabilities: RelationalPhysicalCapabilityEvidence[] =
    [];
  for (const capability of schema.capabilities) {
    requiredPhysicalCapabilities.push(yield* Effect.fromResult(lowerCapability(
      capability,
      schema,
      tableNames,
      columnNames,
      indexNames,
    )));
  }
  requiredPhysicalCapabilities.sort((left, right) => compareUtf16Strings(
    left.identity.capabilityId,
    right.identity.capabilityId,
  ));
  assignments.sort((left, right) => compareUtf16Strings(
    left.frame.spelling,
    right.frame.spelling,
  ));

  const frame = Object.freeze({
    format: RELATIONAL_PHYSICAL_LAYOUT_FORMAT,
    version: RELATIONAL_PHYSICAL_LAYOUT_VERSION,
    artifact: copyArtifactIdentity(input.artifact.identity),
    physicalLocator: locator,
    targetNamespace: targetNamespace.frame,
    profiles: Object.freeze({
      namespace: RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
      lowering: RELATIONAL_PHYSICAL_LOWERING_PROFILE,
      isolation: RELATIONAL_PHYSICAL_ISOLATION_PROFILE,
    }),
    nameAssignments: Object.freeze(assignments.map(assignment =>
      assignment.frame
    )),
    tables: Object.freeze(tables),
    foreignKeys: Object.freeze(foreignKeys),
    relationships: Object.freeze(relationships),
    requiredPhysicalCapabilities: Object.freeze(requiredPhysicalCapabilities),
  } satisfies RelationalPhysicalLayoutFrame);
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
    physicalErrorPolicy("captureLayout"),
  );
  const layout = Object.freeze({
    frame,
    layoutSha256: brandLayoutSha256(captured.sha256Hex),
    canonicalJson: captured.canonicalJson,
    nameAssignments: Object.freeze(assignments),
    targetNamespace,
  });
  registerCapturedRelationalPhysicalLayout(layout);
  return layout;
});

export function isCapturedRelationalPhysicalLayout(
  value: RelationalPhysicalLayout,
): boolean {
  return hasCapturedRelationalPhysicalLayout(value);
}

export function encodeLowercaseBase32Hex(input: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let availableBits = 0;
  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    availableBits += 8;
    while (availableBits >= 5) {
      availableBits -= 5;
      output += BASE32HEX_ALPHABET[(accumulator >>> availableBits) & 31];
      accumulator &= (1 << availableBits) - 1;
    }
  }
  if (availableBits > 0) {
    output += BASE32HEX_ALPHABET[(accumulator << (5 - availableBits)) & 31];
  }
  return output;
}

export function classifyRelationalPhysicalNameAssignmentReplay(
  left: RelationalPhysicalNameAssignmentFrame,
  right: RelationalPhysicalNameAssignmentFrame,
): RelationalPhysicalNameAssignmentReplay {
  if (
    left.targetNamespace.deploymentId !==
      right.targetNamespace.deploymentId ||
    left.targetNamespace.physicalDatabaseIdentity !==
      right.targetNamespace.physicalDatabaseIdentity ||
    left.targetNamespace.schemaName !== right.targetNamespace.schemaName ||
    left.spelling !== right.spelling
  ) {
    return "differentTargetOrSpelling";
  }
  return left.nameSha256 === right.nameSha256 &&
      left.nameCanonicalJson === right.nameCanonicalJson
    ? "exact"
    : "physicalNameCollision";
}

export type StoredRelationalPhysicalValueKind =
  | "physicalName"
  | "nameAssignment"
  | "physicalLayout";

export interface VerifyStoredRelationalPhysicalValueInput {
  readonly kind: StoredRelationalPhysicalValueKind;
  readonly canonicalBytes: unknown;
  readonly sha256Hex: unknown;
}

export const verifyStoredRelationalPhysicalValue = Effect.fn(
  "RelationalPhysicalValue.verifyStored",
)(function* (
  input: VerifyStoredRelationalPhysicalValueInput,
): Effect.fn.Return<JsonObject, RelationalPhysicalValueError> {
  const contract = storedPhysicalContract(input.kind);
  const frame = yield* verifyStoredPrivateCanonicalValue({
    canonicalBytes: input.canonicalBytes,
    sha256Hex: input.sha256Hex,
    expectedFormat: contract.format,
    expectedVersion: contract.version,
    maximumCanonicalBytes: contract.maximumBytes,
    expectedKeys: contract.keys,
    validateFrame: candidate => isStoredPhysicalFrame(input.kind, candidate),
  }, {
    storedCorruption: RelationalPhysicalValueError.storedStateCorrupt,
    hashFailure: cause => RelationalPhysicalValueError.resourceFailure(
      "decodeStoredValue",
      cause,
    ),
  });
  const valid = yield* validateStoredPhysicalFrame(input.kind, frame);
  if (!valid) {
    return yield* Effect.fail(RelationalPhysicalValueError.storedStateCorrupt());
  }
  return frame;
});

function isStoredPhysicalFrame(
  kind: StoredRelationalPhysicalValueKind,
  frame: JsonObject,
): boolean {
  switch (kind) {
    case "physicalName":
      return isStoredRelationalPhysicalNameFrame(frame);
    case "nameAssignment":
      return isStoredRelationalPhysicalNameAssignmentFrame(frame);
    case "physicalLayout":
      return isStoredRelationalPhysicalLayoutFrame(frame);
  }
}

const validateStoredPhysicalFrame = Effect.fn(
  "RelationalPhysicalValue.validateStoredFrame",
)(function* (
  kind: StoredRelationalPhysicalValueKind,
  frame: JsonObject,
): Effect.fn.Return<boolean, RelationalPhysicalValueError> {
  switch (kind) {
    case "physicalName":
      return isStoredRelationalPhysicalNameFrame(frame);
    case "nameAssignment":
      return yield* validateStoredNameAssignment(frame);
    case "physicalLayout":
      if (!isStoredRelationalPhysicalLayoutFrame(frame)) return false;
      if (!Array.isArray(frame.nameAssignments)) return false;
      for (const assignment of frame.nameAssignments) {
        if (!(yield* validateStoredNameAssignment(assignment))) return false;
      }
      return true;
  }
});

const validateStoredNameAssignment = Effect.fn(
  "RelationalPhysicalValue.validateStoredNameAssignment",
)(function* (
  input: unknown,
): Effect.fn.Return<boolean, RelationalPhysicalValueError> {
  if (
    !isStoredRelationalPhysicalNameAssignmentFrame(input) ||
    !isStoredRelationalPhysicalNameFrame(input.name) ||
    typeof input.nameSha256 !== "string" ||
    typeof input.nameCanonicalJson !== "string" ||
    typeof input.spelling !== "string"
  ) return false;
  const captured = yield* capturePrivateCanonicalValue(
    input.name,
    MAX_RELATIONAL_PHYSICAL_NAME_CANONICAL_BYTES,
    {
      invalidInput: RelationalPhysicalValueError.storedStateCorrupt,
      hashFailure: cause => RelationalPhysicalValueError.resourceFailure(
        "decodeStoredValue",
        cause,
      ),
    },
  );
  const prefix = storedPhysicalNamePrefix(input.name.subject);
  return prefix !== undefined &&
    input.nameSha256 === captured.sha256Hex &&
    input.nameCanonicalJson === captured.canonicalJson &&
    input.spelling ===
      `${prefix}${encodeLowercaseBase32Hex(captured.copySha256Bytes())}`;
});

function storedPhysicalNamePrefix(input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const kind = Object.getOwnPropertyDescriptor(input, "kind")?.value;
  switch (kind) {
    case "table":
      return "fxrt_";
    case "column":
      return "fxrc_";
    case "key":
      return "fxrk_";
    case "index":
      return "fxri_";
    case "foreignKey":
    case "scopeAuthorityForeignKey":
      return "fxrf_";
    case "checkConstraint":
      return "fxrh_";
    default:
      return undefined;
  }
}

const captureRelationalPhysicalName = Effect.fn(
  "RelationalPhysicalName.capture",
)(function* (
  deploymentId: string,
  schema: RelationalSchema,
  subject: RelationalPhysicalNameSubject,
): Effect.fn.Return<RelationalPhysicalName, RelationalPhysicalValueError> {
  const frame = Object.freeze({
    format: RELATIONAL_PHYSICAL_NAME_FORMAT,
    version: RELATIONAL_PHYSICAL_NAME_VERSION,
    deploymentId,
    owner: schema.coordinate.owner,
    lineageId: schema.coordinate.lineageId,
    subject,
    physicalNamespaceProfile: RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  } satisfies RelationalPhysicalNameFrame);
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    MAX_RELATIONAL_PHYSICAL_NAME_CANONICAL_BYTES,
    physicalErrorPolicy("captureName"),
  );
  const encoded = encodeLowercaseBase32Hex(captured.copySha256Bytes());
  if (encoded.length !== 52) {
    return yield* Effect.die(new Error(
      "SHA-256 base32hex encoding produced an invalid length",
    ));
  }
  return Object.freeze({
    frame,
    nameSha256: brandNameSha256(captured.sha256Hex),
    canonicalJson: captured.canonicalJson,
    spelling: `${physicalNamePrefix(subject.kind)}${encoded}`,
  });
});

const captureRelationalPhysicalNameAssignment = Effect.fn(
  "RelationalPhysicalNameAssignment.capture",
)(function* (
  targetNamespace: FrameworkSchemaTargetNamespace,
  name: RelationalPhysicalName,
): Effect.fn.Return<
  RelationalPhysicalNameAssignment,
  RelationalPhysicalValueError
> {
  const frame = Object.freeze({
    format: RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
    version: RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
    targetNamespace: targetNamespace.frame,
    name: name.frame,
    nameSha256: name.nameSha256,
    nameCanonicalJson: name.canonicalJson,
    spelling: name.spelling,
  } satisfies RelationalPhysicalNameAssignmentFrame);
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
    physicalErrorPolicy("captureName"),
  );
  return Object.freeze({
    frame,
    assignmentSha256: brandAssignmentSha256(captured.sha256Hex),
    canonicalJson: captured.canonicalJson,
  });
});

function admitRelationalArtifact(
  artifact: FrameworkSchemaArtifact,
): Result.Result<RelationalSchema, RelationalPhysicalValueError> {
  if (
    copyCapturedFrameworkSchemaArtifactEvidence(artifact) === undefined ||
    artifact.codec.format !== RELATIONAL_SCHEMA_FORMAT ||
    artifact.codec.version !== RELATIONAL_SCHEMA_FORMAT_VERSION
  ) {
    return Result.fail(RelationalPhysicalValueError.unsupportedArtifact());
  }
  const schema = readCapturedRelationalSchemaArtifactSchema(artifact);
  if (
    schema === undefined ||
    schema.coordinate.owner !== artifact.identity.owner ||
    schema.coordinate.lineageId !== artifact.identity.lineageId ||
    !sameStrings(artifact.capabilities, deriveArtifactCapabilityIds(schema))
  ) {
    return Result.fail(RelationalPhysicalValueError.unsupportedArtifact());
  }
  return Result.succeed(schema);
}

const authenticateInertTargetNamespace = Effect.fn(
  "RelationalPhysicalLayout.authenticateInertTargetNamespace",
)(function* (
  input: FrameworkSchemaTargetNamespace,
): Effect.fn.Return<
  FrameworkSchemaTargetNamespace,
  RelationalPhysicalValueError
> {
  const captured = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: input.frame.deploymentId,
    physicalDatabaseIdentity: input.frame.physicalDatabaseIdentity,
    schemaName: input.frame.schemaName,
  }).pipe(Effect.mapError(error =>
    error.reason === "resourceFailure"
      ? RelationalPhysicalValueError.resourceFailure(
          "captureLayout",
          error.cause,
        )
      : RelationalPhysicalValueError.invalidInput("captureLayout")
  ));
  return frameworkSchemaTargetNamespacesEqual(captured, input)
    ? captured
    : yield* Effect.fail(RelationalPhysicalValueError.invalidInput(
      "captureLayout",
    ));
});

function capturePhysicalLocator(
  input: ScopePhysicalLocator,
): Result.Result<Readonly<ScopePhysicalLocator>, RelationalPhysicalValueError> {
  try {
    const keys = Reflect.ownKeys(input);
    if (
      Object.getPrototypeOf(input) !== Object.prototype ||
      keys.length !== 3 ||
      keys.some(key =>
        typeof key !== "string" ||
        !["kind", "databaseKey", "schemaName"].includes(key)
      )
    ) {
      return Result.fail(RelationalPhysicalValueError.invalidInput());
    }
    const kindDescriptor = Object.getOwnPropertyDescriptor(input, "kind");
    const databaseKeyDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "databaseKey",
    );
    const schemaNameDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "schemaName",
    );
    if (kindDescriptor === undefined ||
      !("value" in kindDescriptor) || !kindDescriptor.enumerable ||
      databaseKeyDescriptor === undefined ||
      !("value" in databaseKeyDescriptor) ||
      !databaseKeyDescriptor.enumerable || schemaNameDescriptor === undefined ||
      !("value" in schemaNameDescriptor) ||
      !schemaNameDescriptor.enumerable) {
      return Result.fail(RelationalPhysicalValueError.invalidInput());
    }
    const kind = kindDescriptor.value;
    const databaseKey = databaseKeyDescriptor.value;
    const schemaName = schemaNameDescriptor.value;
    if (
      kind !== "shared_database" &&
      kind !== "schema_per_scope" &&
      kind !== "database_per_scope"
    ) {
      return Result.fail(RelationalPhysicalValueError.invalidInput());
    }
    if (
      !isBoundedIdentityText(databaseKey, 512) ||
      !isBoundedIdentityText(schemaName, 63)
    ) {
      return Result.fail(RelationalPhysicalValueError.invalidInput());
    }
    return Result.succeed(captureScopePhysicalLocator({
      kind,
      databaseKey,
      schemaName,
    }));
  } catch {
    return Result.fail(RelationalPhysicalValueError.invalidInput());
  }
}

function lowerTable(
  table: RelationalTableDefinition,
  tableNames: ReadonlyMap<string, string>,
  columnNames: ReadonlyMap<string, string>,
  indexNames: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, RelationalPhysicalName>,
): Result.Result<RelationalPhysicalTable, RelationalPhysicalValueError> {
  return Result.gen(function* () {
    const name = yield* required(tableNames, table.identity.tableId);
    const columns: RelationalPhysicalColumn[] = [];
    for (const column of table.columns) {
      columns.push(Object.freeze({
        identity: copyColumnIdentity(column.identity),
        name: yield* required(columnNames, columnIdentityKey(column.identity)),
        type: physicalColumnType(column.type),
        nullable: column.nullable,
        default: copyPhysicalDefault(column.default),
      }));
    }
    const keys: RelationalPhysicalKey[] = [];
    for (const key of table.keys) {
      const physicalName = findNameBySubject(
        names,
        "key",
        key.identity.tableId,
        key.identity.keyId,
      );
      if (physicalName === undefined) {
        return yield* Result.fail(RelationalPhysicalValueError.invalidInput());
      }
      const physicalColumns: string[] = ["scope_uuid"];
      for (const column of key.columns) {
        physicalColumns.push(yield* required(
          columnNames,
          columnIdentityKey(column),
        ));
      }
      keys.push(Object.freeze({
        identity: copyKeyIdentity(key.identity),
        name: physicalName,
        kind: physicalKeyKind(key.kind),
        columns: Object.freeze(physicalColumns),
      }));
    }
    const checks: RelationalPhysicalIntegerRangeCheck[] = [];
    for (const constraint of table.constraints) {
      switch (constraint.kind) {
        case "foreignKey":
          break;
        case "integerRange": {
          const physicalName = findNameBySubject(
            names,
            "checkConstraint",
            constraint.identity.tableId,
            constraint.identity.constraintId,
          );
          if (physicalName === undefined) {
            return yield* Result.fail(
              RelationalPhysicalValueError.invalidInput(),
            );
          }
          checks.push(Object.freeze({
            identity: copyConstraintIdentity(constraint.identity),
            name: physicalName,
            kind: "integerRange",
            column: yield* required(
              columnNames,
              columnIdentityKey(constraint.column),
            ),
            minimum: constraint.minimum,
            maximum: constraint.maximum,
          }));
          break;
        }
        default:
          unreachablePhysicalVocabulary(constraint);
      }
    }
    const indexes: RelationalPhysicalIndex[] = [];
    for (const index of table.indexes) {
      const physicalColumns: string[] = ["scope_uuid"];
      for (const column of index.columns) {
        physicalColumns.push(yield* required(
          columnNames,
          columnIdentityKey(column),
        ));
      }
      const predicate = index.predicate === null
        ? null
        : yield* physicalIndexPredicate(index.predicate, columnNames);
      indexes.push(Object.freeze({
        identity: copyIndexIdentity(index.identity),
        table: copyTableIdentity(table.identity),
        name: yield* required(indexNames, indexIdentityKey(index.identity)),
        kind: physicalIndexKind(index.kind),
        columns: Object.freeze(physicalColumns),
        predicate,
      }));
    }
    return Object.freeze({
      identity: copyTableIdentity(table.identity),
      name,
      scopeColumn: Object.freeze({
        name: "scope_uuid",
        type: "uuid",
        nullable: false,
      }),
      columns: Object.freeze(columns),
      keys: Object.freeze(keys),
      checks: Object.freeze(checks),
      indexes: Object.freeze(indexes),
    });
  });
}

function lowerScopeAuthorityForeignKey(
  table: RelationalTableIdentity,
  foreignKeyNames: ReadonlyMap<string, string>,
): Result.Result<RelationalPhysicalForeignKey, RelationalPhysicalValueError> {
  return Result.map(required(foreignKeyNames, scopeForeignKeyKey(table)), name =>
    Object.freeze({
      kind: "scopeAuthorityForeignKey" as const,
      table: copyTableIdentity(table),
      name,
      sourceColumns: Object.freeze(["scope_uuid"] as const),
      targetTable: "fx_system_scope_clock" as const,
      targetColumns: Object.freeze(["scope_uuid"] as const),
      onDelete: "restrict" as const,
      onUpdate: "restrict" as const,
    })
  );
}

function lowerForeignKey(
  constraint: Extract<
    RelationalTableDefinition["constraints"][number],
    { readonly kind: "foreignKey" }
  >,
  tableNames: ReadonlyMap<string, string>,
  columnNames: ReadonlyMap<string, string>,
  foreignKeyNames: ReadonlyMap<string, string>,
): Result.Result<RelationalPhysicalForeignKey, RelationalPhysicalValueError> {
  return Result.gen(function* () {
    const sourceColumns: string[] = ["scope_uuid"];
    for (const column of constraint.sourceColumns) {
      sourceColumns.push(yield* required(
        columnNames,
        columnIdentityKey(column),
      ));
    }
    const targetColumns: string[] = ["scope_uuid"];
    for (const column of constraint.targetColumns) {
      targetColumns.push(yield* required(
        columnNames,
        columnIdentityKey(column),
      ));
    }
    const targetTable = constraint.targetColumns[0]?.tableId;
    if (targetTable === undefined) {
      return yield* Result.fail(RelationalPhysicalValueError.invalidInput());
    }
    return Object.freeze({
      kind: "foreignKey",
      identity: copyConstraintIdentity(constraint.identity),
      sourceTable: copyTableIdentity({
        owner: constraint.identity.owner,
        lineageId: constraint.identity.lineageId,
        tableId: constraint.identity.tableId,
      }),
      name: yield* required(
        foreignKeyNames,
        constraintIdentityKey(constraint.identity),
      ),
      sourceColumns: Object.freeze(sourceColumns),
      targetTable: copyTableIdentity({
        owner: constraint.identity.owner,
        lineageId: constraint.identity.lineageId,
        tableId: targetTable,
      }),
      targetTableName: yield* required(tableNames, targetTable),
      targetColumns: Object.freeze(targetColumns),
      onDelete: physicalForeignKeyAction(constraint.onDelete),
      onUpdate: physicalForeignKeyAction(constraint.onUpdate),
    });
  });
}

function lowerCapability(
  capability: RelationalPersistenceCapability,
  schema: RelationalSchema,
  tableNames: ReadonlyMap<string, string>,
  columnNames: ReadonlyMap<string, string>,
  indexNames: ReadonlyMap<string, string>,
): Result.Result<
  RelationalPhysicalCapabilityEvidence,
  RelationalPhysicalValueError
> {
  switch (capability.kind) {
    case "searchableText":
      return Result.gen(function* () {
        const columns: RelationalPhysicalColumnReference[] = [];
        for (const column of capability.columns) {
          columns.push(yield* physicalColumnReference(
            column,
            tableNames,
            columnNames,
          ));
        }
        return Object.freeze({
          identity: copyCapabilityIdentity(capability.identity),
          kind: "searchableText",
          columns: Object.freeze(columns),
          residualRequirement: "searchableTextQueryBehavior",
        });
      });
    case "exactNumericCompanion":
      return Result.gen(function* () {
        const numeric = yield* resolveSemanticColumn(
          schema,
          capability.numericColumn,
        );
        const raw = yield* resolveSemanticColumn(schema, capability.rawColumn);
        return Object.freeze({
          identity: copyCapabilityIdentity(capability.identity),
          kind: "exactNumericCompanion",
          numericColumn: yield* physicalColumnReference(
            capability.numericColumn,
            tableNames,
            columnNames,
          ),
          rawColumn: yield* physicalColumnReference(
            capability.rawColumn,
            tableNames,
            columnNames,
          ),
          matchingNullability: true,
          numericDefault: copyPhysicalDefault(numeric.default),
          rawDefault: copyPhysicalDefault(raw.default),
          residualRequirement: "exactNumericCompanionWriteBehavior",
        });
      });
    case "managedTimestamps":
      return Result.gen(function* () {
        const databaseCurrentDefaults = physicalManagedTimestampBehavior(
          capability.updateBehavior,
        );
        return Object.freeze({
          identity: copyCapabilityIdentity(capability.identity),
          kind: "managedTimestamps",
          createdAtColumn: yield* physicalColumnReference(
            capability.createdAtColumn,
            tableNames,
            columnNames,
          ),
          updatedAtColumn: yield* physicalColumnReference(
            capability.updatedAtColumn,
            tableNames,
            columnNames,
          ),
          databaseCurrentDefaults,
          residualRequirement: "managedTimestampUpdateBehavior",
        });
      });
    case "softDelete":
      return Result.gen(function* () {
        return Object.freeze({
          identity: copyCapabilityIdentity(capability.identity),
          kind: "softDelete",
          deletedAtColumn: yield* physicalColumnReference(
            capability.deletedAtColumn,
            tableNames,
            columnNames,
          ),
          activeRowsIndex: copyIndexIdentity(capability.activeRowsIndex),
          activeRowsIndexName: yield* required(
            indexNames,
            indexIdentityKey(capability.activeRowsIndex),
          ),
          residualRequirement: "softDeleteStoreBehavior",
        });
      });
    default:
      return unreachablePhysicalVocabulary(capability);
  }
}

function physicalColumnReference(
  identity: RelationalColumnIdentity,
  tableNames: ReadonlyMap<string, string>,
  columnNames: ReadonlyMap<string, string>,
): Result.Result<
  RelationalPhysicalColumnReference,
  RelationalPhysicalValueError
> {
  return Result.gen(function* () {
    return Object.freeze({
      identity: copyColumnIdentity(identity),
      tableName: yield* required(tableNames, identity.tableId),
      columnName: yield* required(columnNames, columnIdentityKey(identity)),
    });
  });
}

function resolveSemanticColumn(
  schema: RelationalSchema,
  identity: RelationalColumnIdentity,
): Result.Result<
  RelationalTableDefinition["columns"][number],
  RelationalPhysicalValueError
> {
  const column = schema.tables.find(table =>
    table.identity.tableId === identity.tableId
  )?.columns.find(candidate =>
    candidate.identity.columnId === identity.columnId
  );
  return column === undefined
    ? Result.fail(RelationalPhysicalValueError.invalidInput())
    : Result.succeed(column);
}

function physicalColumnType(
  type: RelationalSchema["tables"][number]["columns"][number]["type"],
): RelationalPhysicalColumnType {
  switch (type) {
    case "text":
    case "integer":
    case "numeric":
    case "jsonb":
      return type;
    case "timestamptz":
      return "timestamp with time zone";
    default:
      return unreachablePhysicalVocabulary(type);
  }
}

function copyPhysicalDefault(
  value: RelationalColumnDefault,
): RelationalPhysicalDefault {
  switch (value.kind) {
    case "none":
    case "currentTimestamp":
      return Object.freeze({ kind: value.kind });
    case "textLiteral":
      return Object.freeze({ kind: value.kind, value: value.value });
    case "integerLiteral":
      return Object.freeze({ kind: value.kind, value: value.value });
    case "exactNumericLiteral":
      return Object.freeze({ kind: value.kind, value: value.value });
    case "exactNumericRawLiteral":
      return Object.freeze({
        kind: value.kind,
        value: value.value,
        precision: value.precision,
      });
    default:
      return unreachablePhysicalVocabulary(value);
  }
}

function physicalConstraintNameSubject(
  constraint: RelationalTableDefinition["constraints"][number],
): RelationalPhysicalNameSubject {
  switch (constraint.kind) {
    case "foreignKey":
      return Object.freeze({
        kind: "foreignKey",
        identity: copyConstraintIdentity(constraint.identity),
      });
    case "integerRange":
      return Object.freeze({
        kind: "checkConstraint",
        identity: copyConstraintIdentity(constraint.identity),
      });
    default:
      return unreachablePhysicalVocabulary(constraint);
  }
}

function physicalKeyKind(
  kind: RelationalTableDefinition["keys"][number]["kind"],
): RelationalPhysicalKey["kind"] {
  switch (kind) {
    case "primary":
    case "unique":
      return kind;
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function physicalIndexKind(
  kind: RelationalTableDefinition["indexes"][number]["kind"],
): RelationalPhysicalIndex["kind"] {
  switch (kind) {
    case "btree":
      return kind;
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function physicalIndexPredicate(
  predicate: NonNullable<RelationalTableDefinition["indexes"][number]["predicate"]>,
  columnNames: ReadonlyMap<string, string>,
): Result.Result<
  NonNullable<RelationalPhysicalIndex["predicate"]>,
  RelationalPhysicalValueError
> {
  switch (predicate.kind) {
    case "isNull":
      return Result.map(
        required(columnNames, columnIdentityKey(predicate.column)),
        column => Object.freeze({ kind: "isNull" as const, column }),
      );
  }
}

function physicalForeignKeyAction(
  action: Extract<
    RelationalTableDefinition["constraints"][number],
    { readonly kind: "foreignKey" }
  >["onDelete" | "onUpdate"],
): "restrict" {
  switch (action) {
    case "restrict":
      return action;
    default:
      return unreachablePhysicalVocabulary(action);
  }
}

function relationshipSourceUnique(
  kind: RelationalTableDefinition["relationships"][number]["kind"],
): boolean {
  switch (kind) {
    case "manyToOne":
      return false;
    case "oneToOne":
      return true;
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function physicalManagedTimestampBehavior(
  behavior: Extract<
    RelationalPersistenceCapability,
    { readonly kind: "managedTimestamps" }
  >["updateBehavior"],
): true {
  switch (behavior) {
    case "currentTimestampOnUpdate":
      return true;
    default:
      return unreachablePhysicalVocabulary(behavior);
  }
}

function physicalNamePrefix(
  kind: RelationalPhysicalNameSubject["kind"],
): string {
  switch (kind) {
    case "table":
      return "fxrt_";
    case "column":
      return "fxrc_";
    case "key":
      return "fxrk_";
    case "index":
      return "fxri_";
    case "foreignKey":
    case "scopeAuthorityForeignKey":
      return "fxrf_";
    case "checkConstraint":
      return "fxrh_";
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function deriveArtifactCapabilityIds(
  schema: RelationalSchema,
): readonly string[] {
  const capabilities = new Set<string>(["relational-schema"]);
  for (const table of schema.tables) {
    admitDefinitionOrigin(table.origin.kind);
    for (const column of table.columns) {
      admitDefinitionOrigin(column.origin.kind);
      capabilities.add(columnCapabilityId(column.type));
      const defaultCapability = defaultCapabilityId(column.default);
      if (defaultCapability !== null) capabilities.add(defaultCapability);
    }
    for (const key of table.keys) {
      admitDefinitionOrigin(key.origin.kind);
      capabilities.add(keyCapabilityId(key.kind));
    }
    for (const index of table.indexes) {
      admitDefinitionOrigin(index.origin.kind);
      capabilities.add(indexCapabilityId(index.kind));
      if (index.predicate !== null) {
        capabilities.add(indexPredicateCapabilityId(index.predicate));
      }
    }
    for (const constraint of table.constraints) {
      admitDefinitionOrigin(constraint.origin.kind);
      capabilities.add(constraintCapabilityId(constraint));
    }
    for (const relationship of table.relationships) {
      admitDefinitionOrigin(relationship.origin.kind);
      capabilities.add(relationshipCapabilityId(relationship.kind));
    }
  }
  for (const capability of schema.capabilities) {
    admitDefinitionOrigin(capability.origin.kind);
    capabilities.add(persistenceCapabilityId(capability));
  }
  return Object.freeze([...capabilities].toSorted(compareUtf16Strings));
}

function admitDefinitionOrigin(
  kind: RelationalTableDefinition["origin"]["kind"],
): void {
  switch (kind) {
    case "authored":
    case "derived":
    case "implicit":
    case "synthetic":
      return;
    default:
      unreachablePhysicalVocabulary(kind);
  }
}

function columnCapabilityId(
  type: RelationalTableDefinition["columns"][number]["type"],
): string {
  switch (type) {
    case "text":
      return "relational-schema.column.text";
    case "integer":
      return "relational-schema.column.integer";
    case "numeric":
      return "relational-schema.column.numeric";
    case "jsonb":
      return "relational-schema.column.jsonb";
    case "timestamptz":
      return "relational-schema.column.timestamptz";
    default:
      return unreachablePhysicalVocabulary(type);
  }
}

function defaultCapabilityId(
  value: RelationalColumnDefault,
): string | null {
  switch (value.kind) {
    case "none":
      return null;
    case "textLiteral":
      return "relational-schema.default.textLiteral";
    case "integerLiteral":
      return "relational-schema.default.integerLiteral";
    case "exactNumericLiteral":
      return "relational-schema.default.exactNumericLiteral";
    case "exactNumericRawLiteral":
      return "relational-schema.default.exactNumericRawLiteral";
    case "currentTimestamp":
      return "relational-schema.default.currentTimestamp";
    default:
      return unreachablePhysicalVocabulary(value);
  }
}

function keyCapabilityId(
  kind: RelationalTableDefinition["keys"][number]["kind"],
): string {
  switch (kind) {
    case "primary":
      return "relational-schema.key.primary";
    case "unique":
      return "relational-schema.key.unique";
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function indexCapabilityId(
  kind: RelationalTableDefinition["indexes"][number]["kind"],
): string {
  switch (kind) {
    case "btree":
      return "relational-schema.index.btree";
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function indexPredicateCapabilityId(
  predicate: NonNullable<RelationalTableDefinition["indexes"][number]["predicate"]>,
): string {
  switch (predicate.kind) {
    case "isNull":
      return "relational-schema.index-predicate.isNull";
  }
}

function constraintCapabilityId(
  constraint: RelationalTableDefinition["constraints"][number],
): string {
  switch (constraint.kind) {
    case "foreignKey":
      physicalForeignKeyAction(constraint.onDelete);
      physicalForeignKeyAction(constraint.onUpdate);
      return "relational-schema.constraint.foreignKey";
    case "integerRange":
      return "relational-schema.constraint.integerRange";
    default:
      return unreachablePhysicalVocabulary(constraint);
  }
}

function relationshipCapabilityId(
  kind: RelationalTableDefinition["relationships"][number]["kind"],
): string {
  switch (kind) {
    case "manyToOne":
      return "relational-schema.relationship.manyToOne";
    case "oneToOne":
      return "relational-schema.relationship.oneToOne";
    default:
      return unreachablePhysicalVocabulary(kind);
  }
}

function persistenceCapabilityId(
  capability: RelationalPersistenceCapability,
): string {
  switch (capability.kind) {
    case "searchableText":
      return "relational-schema.persistence.searchableText";
    case "exactNumericCompanion":
      return "relational-schema.persistence.exactNumericCompanion";
    case "managedTimestamps":
      physicalManagedTimestampBehavior(capability.updateBehavior);
      return "relational-schema.persistence.managedTimestamps";
    case "softDelete":
      return "relational-schema.persistence.softDelete";
    default:
      return unreachablePhysicalVocabulary(capability);
  }
}

function unreachablePhysicalVocabulary(value: never): never {
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - exhaustive helper is reachable only if authenticated closed relational vocabulary violates its union
  throw new Error(`Unhandled relational physical vocabulary: ${String(value)}`);
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) =>
    value === right[index]
  );
}

function required(
  values: ReadonlyMap<string, string>,
  key: string,
): Result.Result<string, RelationalPhysicalValueError> {
  const value = values.get(key);
  return value === undefined
    ? Result.fail(RelationalPhysicalValueError.invalidInput())
    : Result.succeed(value);
}

function findNameBySubject(
  names: ReadonlyMap<string, RelationalPhysicalName>,
  kind: RelationalPhysicalNameSubject["kind"],
  tableId: string,
  semanticId: string,
): string | undefined {
  for (const name of names.values()) {
    const identity = name.frame.subject.identity;
    if (name.frame.subject.kind !== kind) continue;
    if (
      identity.tableId === tableId &&
      (("keyId" in identity && identity.keyId === semanticId) ||
        ("constraintId" in identity && identity.constraintId === semanticId))
    ) {
      return name.spelling;
    }
  }
  return undefined;
}

function foreignKeySortKey(value: RelationalPhysicalForeignKey): string {
  return value.kind === "scopeAuthorityForeignKey"
    ? `0\0${value.table.tableId}`
    : `1\0${constraintIdentityKey(value.identity)}`;
}

function columnIdentityKey(identity: RelationalColumnIdentity): string {
  return `${identity.tableId}\0${identity.columnId}`;
}

function indexIdentityKey(
  identity: RelationalPhysicalIndex["identity"],
): string {
  return `${identity.tableId}\0${identity.indexId}`;
}

function constraintIdentityKey(
  identity: RelationalConstraintIdentity,
): string {
  return `constraint\0${identity.tableId}\0${identity.constraintId}`;
}

function relationshipIdentityKey(
  identity: RelationalPhysicalRelationshipEvidence["identity"],
): string {
  return `${identity.tableId}\0${identity.relationshipId}`;
}

function scopeForeignKeyKey(identity: RelationalTableIdentity): string {
  return `scope-authority\0${identity.tableId}`;
}

function copyArtifactIdentity(
  identity: FrameworkSchemaArtifact["identity"],
) {
  return Object.freeze({
    deploymentId: identity.deploymentId,
    owner: identity.owner,
    lineageId: identity.lineageId,
    artifactSha256: identity.artifactSha256,
  });
}

function copyTableIdentity(identity: RelationalTableIdentity) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    tableId: identity.tableId,
  });
}

function copyColumnIdentity(identity: RelationalColumnIdentity) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    tableId: identity.tableId,
    columnId: identity.columnId,
  });
}

function copyKeyIdentity(
  identity: RelationalTableDefinition["keys"][number]["identity"],
) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    tableId: identity.tableId,
    keyId: identity.keyId,
  });
}

function copyIndexIdentity(
  identity: RelationalTableDefinition["indexes"][number]["identity"],
) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    tableId: identity.tableId,
    indexId: identity.indexId,
  });
}

function copyConstraintIdentity(identity: RelationalConstraintIdentity) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    tableId: identity.tableId,
    constraintId: identity.constraintId,
  });
}

function copyRelationshipIdentity(
  identity: RelationalTableDefinition["relationships"][number]["identity"],
) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    tableId: identity.tableId,
    relationshipId: identity.relationshipId,
  });
}

function copyCapabilityIdentity(
  identity: RelationalPersistenceCapability["identity"],
) {
  return Object.freeze({
    owner: identity.owner,
    lineageId: identity.lineageId,
    capabilityId: identity.capabilityId,
  });
}

function isBoundedIdentityText(
  input: unknown,
  maximumUtf8Bytes: number,
): input is string {
  return isNonBlankString(input) &&
    !input.includes("\0") &&
    isWellFormedUtf16(input) &&
    UTF8.encode(input).byteLength <= maximumUtf8Bytes;
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

function physicalErrorPolicy(
  operation: "captureName" | "captureLayout",
) {
  return Object.freeze({
    invalidInput: () => RelationalPhysicalValueError.invalidInput(operation),
    hashFailure: (cause: unknown) =>
      RelationalPhysicalValueError.resourceFailure(operation, cause),
  });
}

function storedPhysicalContract(kind: StoredRelationalPhysicalValueKind) {
  switch (kind) {
    case "physicalName":
      return Object.freeze({
        format: RELATIONAL_PHYSICAL_NAME_FORMAT,
        version: RELATIONAL_PHYSICAL_NAME_VERSION,
        maximumBytes: MAX_RELATIONAL_PHYSICAL_NAME_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "deploymentId",
          "owner",
          "lineageId",
          "subject",
          "physicalNamespaceProfile",
        ]),
      });
    case "nameAssignment":
      return Object.freeze({
        format: RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
        version: RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
        maximumBytes: MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "targetNamespace",
          "name",
          "nameSha256",
          "nameCanonicalJson",
          "spelling",
        ]),
      });
    case "physicalLayout":
      return Object.freeze({
        format: RELATIONAL_PHYSICAL_LAYOUT_FORMAT,
        version: RELATIONAL_PHYSICAL_LAYOUT_VERSION,
        maximumBytes: MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
        keys: Object.freeze([
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
        ]),
      });
  }
}
