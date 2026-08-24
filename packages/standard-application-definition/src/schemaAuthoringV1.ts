import type { CanonicalDeclarativeSchemaInputV1 } from
  "@flarex/declarative-program/v1";
import {
  applicationSchemaDefinition,
  applicationTableDefinition,
  applicationTableDefinitionWithIndex,
  type ApplicationTableDefinition,
  type ApplicationTableIndexDefinition,
} from "@flarex/application-schema-definition/application-schema";

import type {
  StandardObjectValidatorV1,
  StandardValidatorFieldPathsV1,
  StandardValidatorRecordV1,
} from "./authoringV1.js";

export type StandardTableFieldPathsV1<
  Fields extends StandardValidatorRecordV1,
> = {
  readonly [Field in keyof Fields & string]:
    | Field
    | (StandardValidatorFieldPathsV1<Fields[Field]> extends
        infer Nested extends string
      ? `${Field}.${Nested}`
      : never);
}[keyof Fields & string];

export type StandardTableIndexFieldsV1 = readonly [
  string,
  ...ReadonlyArray<string>,
];

export type StandardTableIndexCatalogV1 = Readonly<
  Record<string, StandardTableIndexFieldsV1>
>;

declare const StandardTableDefinitionV1Type: unique symbol;

export interface StandardTableDefinitionV1<
  Fields extends StandardValidatorRecordV1 = StandardValidatorRecordV1,
  Indexes extends StandardTableIndexCatalogV1 = Readonly<Record<never, never>>,
> {
  readonly [StandardTableDefinitionV1Type]: Readonly<{
    readonly fields: Fields;
    readonly indexes: Indexes;
  }>;
  readonly document: StandardObjectValidatorV1<Fields>;
  readonly indexes: ReadonlyArray<ApplicationTableIndexDefinition>;

  index<
    Descriptor extends string,
    First extends StandardTableFieldPathsV1<Fields>,
    Rest extends ReadonlyArray<StandardTableFieldPathsV1<Fields>>,
  >(
    descriptor: Descriptor,
    fields: readonly [First, ...Rest],
  ): StandardTableDefinitionV1<
    Fields,
    Indexes & Readonly<Record<Descriptor, readonly [First, ...Rest]>>
  >;
}

export type StandardTableCatalogV1 = Readonly<
  Record<
    string,
    StandardTableDefinitionV1<
      StandardValidatorRecordV1,
      StandardTableIndexCatalogV1
    >
  >
>;

const standardTableDefinitions = new WeakMap<
  StandardTableDefinitionV1,
  ApplicationTableDefinition
>();

class StandardTableDefinitionV1Impl<
  Fields extends StandardValidatorRecordV1,
  Indexes extends StandardTableIndexCatalogV1,
> implements StandardTableDefinitionV1<Fields, Indexes> {
  declare readonly [StandardTableDefinitionV1Type]: Readonly<{
    readonly fields: Fields;
    readonly indexes: Indexes;
  }>;
  readonly indexes: ReadonlyArray<ApplicationTableIndexDefinition>;

  constructor(
    readonly document: StandardObjectValidatorV1<Fields>,
    definition: ApplicationTableDefinition,
  ) {
    this.indexes = definition.indexes;
    standardTableDefinitions.set(this, definition);
    Object.freeze(this);
  }

  index<
    Descriptor extends string,
    First extends StandardTableFieldPathsV1<Fields>,
    Rest extends ReadonlyArray<StandardTableFieldPathsV1<Fields>>,
  >(
    descriptor: Descriptor,
    fields: readonly [First, ...Rest],
  ): StandardTableDefinitionV1<
    Fields,
    Indexes & Readonly<Record<Descriptor, readonly [First, ...Rest]>>
  > {
    const definition = standardTableDefinitions.get(this);
    if (definition === undefined) {
      throw new TypeError("Standard table authoring metadata is unavailable.");
    }
    return new StandardTableDefinitionV1Impl<
      Fields,
      Indexes & Readonly<Record<Descriptor, readonly [First, ...Rest]>>
    >(
      this.document,
      applicationTableDefinitionWithIndex(definition, descriptor, fields),
    );
  }
}

declare const StandardSchemaDefinitionV1Type: unique symbol;

export class StandardSchemaDefinitionV1<
  Tables extends StandardTableCatalogV1,
> {
  declare readonly [StandardSchemaDefinitionV1Type]: Tables;
  readonly canonicalInput: CanonicalDeclarativeSchemaInputV1;

  constructor(tables: Tables) {
    const definitions: Record<string, ApplicationTableDefinition> =
      Object.create(null);
    for (const [logicalName, table] of Object.entries(tables)) {
      const definition = standardTableDefinitions.get(table);
      if (definition === undefined) {
        throw new TypeError(
          `Standard table ${JSON.stringify(logicalName)} was not created by standardV1.table().`,
        );
      }
      Object.defineProperty(definitions, logicalName, {
        enumerable: true,
        value: definition,
      });
    }
    this.canonicalInput = applicationSchemaDefinition(definitions);
    Object.freeze(this);
  }

  toCanonicalInput(): CanonicalDeclarativeSchemaInputV1 {
    return this.canonicalInput;
  }
}

export function standardTableDefinitionV1<
  Fields extends StandardValidatorRecordV1,
>(
  document: StandardObjectValidatorV1<Fields>,
): StandardTableDefinitionV1<Fields> {
  return new StandardTableDefinitionV1Impl(
    document,
    applicationTableDefinition(document.json),
  );
}

export function standardSchemaDefinitionV1<
  Tables extends StandardTableCatalogV1,
>(tables: Tables): StandardSchemaDefinitionV1<Tables> {
  return new StandardSchemaDefinitionV1(tables);
}
