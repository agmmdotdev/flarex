import { compareUtf16Strings } from "@flarex/utils/strings";
import {
  decodeSchemaManifestAppIndexDeclarationsV1,
  decodeSchemaManifestAppTableDeclarationsV1,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";
import type { ObjectValidatorJsonV1 } from "flarex-protocol/validator-json";

import { snapshotApplicationValidatorJson } from "./ValidatorJson.js";

const DRAFT_TABLE_LOGICAL_NAME = "table";

export interface ApplicationTableIndexDefinition {
  readonly descriptor: string;
  readonly fields: ReadonlyArray<string>;
}

export interface ApplicationTableDefinition {
  readonly documentType: ObjectValidatorJsonV1;
  readonly indexes: ReadonlyArray<ApplicationTableIndexDefinition>;
}

export interface ApplicationSchemaDefinitionInput {
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationInputV1>;
}

export interface ApplicationSchemaDefinition {
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
}

export function applicationTableDefinition(
  documentType: ObjectValidatorJsonV1,
): ApplicationTableDefinition {
  return Object.freeze({
    documentType: snapshotObjectValidator(documentType),
    indexes: Object.freeze([]),
  });
}

export function applicationTableDefinitionWithIndex(
  definition: ApplicationTableDefinition,
  descriptor: string,
  fields: readonly [string, ...ReadonlyArray<string>],
): ApplicationTableDefinition {
  return snapshotApplicationTableDefinition({
    documentType: definition.documentType,
    indexes: [
      ...definition.indexes,
      { descriptor, fields },
    ],
  });
}

export function snapshotApplicationTableDefinition(
  definition: ApplicationTableDefinition,
): ApplicationTableDefinition {
  const decodedIndexes = decodeSchemaManifestAppIndexDeclarationsV1(
    definition.indexes.map(index => ({
      tableLogicalName: DRAFT_TABLE_LOGICAL_NAME,
      descriptor: index.descriptor,
      fields: index.fields,
    })),
  );
  return Object.freeze({
    documentType: snapshotObjectValidator(definition.documentType),
    indexes: Object.freeze(decodedIndexes.map(index => Object.freeze({
      descriptor: index.descriptor,
      fields: Object.freeze([...index.fields]),
    }))),
  });
}

export function applicationSchemaDefinition(
  definitions: Readonly<Record<string, ApplicationTableDefinition>>,
): ApplicationSchemaDefinition {
  const entries = Object.entries(definitions).sort(([left], [right]) =>
    compareUtf16Strings(left, right)
  );
  const tables: SchemaManifestAppTableDeclarationInputV1[] = [];
  const indexes: SchemaManifestAppIndexDeclarationInputV1[] = [];
  for (const [logicalName, input] of entries) {
    const definition = snapshotApplicationTableDefinition(input);
    tables.push({
      logicalName,
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: definition.documentType,
      },
    });
    for (const index of definition.indexes) {
      indexes.push({
        tableLogicalName: logicalName,
        descriptor: index.descriptor,
        fields: index.fields,
      });
    }
  }
  return snapshotApplicationSchemaDefinition({ tables, indexes });
}

export function snapshotApplicationSchemaDefinition(
  input: ApplicationSchemaDefinitionInput,
): ApplicationSchemaDefinition {
  const decodedTables = decodeSchemaManifestAppTableDeclarationsV1(input.tables);
  const decodedIndexes = decodeSchemaManifestAppIndexDeclarationsV1(input.indexes);
  const tableNames = new Set(decodedTables.map(table => table.logicalName));
  for (const index of decodedIndexes) {
    if (!tableNames.has(index.tableLogicalName)) {
      throw new RangeError(
        `Application index ${JSON.stringify(index.descriptor)} references unknown table ${JSON.stringify(index.tableLogicalName)}.`,
      );
    }
  }

  const tables = decodedTables.map(table => Object.freeze({
    logicalName: table.logicalName,
    definition: Object.freeze({
      kind: "appDocument" as const,
      definitionVersion: 1 as const,
      documentType: snapshotObjectValidator(table.definition.documentType),
    }),
  }));
  tables.sort((left, right) =>
    compareUtf16Strings(left.logicalName, right.logicalName)
  );

  const indexes = decodedIndexes.map(index => Object.freeze({
    tableLogicalName: index.tableLogicalName,
    descriptor: index.descriptor,
    fields: Object.freeze([...index.fields]),
  }));
  indexes.sort((left, right) => {
    const table = compareUtf16Strings(
      left.tableLogicalName,
      right.tableLogicalName,
    );
    return table === 0
      ? compareUtf16Strings(left.descriptor, right.descriptor)
      : table;
  });

  return Object.freeze({
    tables: Object.freeze(tables),
    indexes: Object.freeze(indexes),
  });
}

function snapshotObjectValidator(
  documentType: ObjectValidatorJsonV1,
): ObjectValidatorJsonV1 {
  const snapshot = snapshotApplicationValidatorJson(documentType);
  if (snapshot.type !== "object") {
    throw new TypeError("Application table definitions require an object validator.");
  }
  return snapshot;
}
