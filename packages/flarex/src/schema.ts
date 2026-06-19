import type { GenericDataModel } from "./dataModel";
import {
  asObjectValidator,
  type GenericValidator,
  type Id,
  type Infer,
  type ObjectType,
  type PropertyValidators,
  type Validator,
} from "./values";

export type Placement =
  | { kind: "partitionBy"; field: string }
  | { kind: "colocateWith"; table: string; field: string }
  | { kind: "global" };
type Indexes = Record<string, readonly string[]>;
type FieldPathsForFields<Fields extends PropertyValidators> = {
  [Field in keyof Fields & string]:
    | Field
    | (Fields[Field]["fieldPaths"] extends string
        ? `${Field}.${Fields[Field]["fieldPaths"]}`
        : never);
}[keyof Fields & string];
type ValidatorForFields<Fields extends PropertyValidators> = Validator<
  ObjectType<Fields>,
  "required",
  FieldPathsForFields<Fields>
>;

export class TableDefinition<
  DocumentValidator extends GenericValidator = GenericValidator,
  TableIndexes extends Indexes = {},
> {
  readonly kind = "table";
  readonly indexes: Array<{ name: string; fields: readonly string[] }> = [];
  placement?: Placement;

  constructor(
    readonly validator: DocumentValidator,
    readonly fields: PropertyValidators,
  ) {}

  index<
    Name extends string,
    First extends DocumentValidator["fieldPaths"],
    Rest extends DocumentValidator["fieldPaths"][],
  >(
    name: Name,
    fields: readonly [First, ...Rest],
  ): TableDefinition<DocumentValidator, TableIndexes & Record<Name, readonly [First, ...Rest]>> {
    this.indexes.push({ name, fields });
    return this as never;
  }

  build() {
    return this;
  }
}

export class ProjectionDefinition {
  readonly kind = "projection";
  readonly indexes: Array<{ name: string; fields: readonly string[] }> = [];

  constructor(readonly sources: readonly string[]) {}

  index(name: string, fields: readonly string[]): this {
    this.indexes.push({ name, fields });
    return this;
  }

  build() {
    return this;
  }
}

export type GenericSchema = Record<string, TableDefinition | ProjectionDefinition>;

export class SchemaDefinition<Definitions extends GenericSchema> {
  constructor(readonly tables: Definitions) {}
}

export function defineTable<Fields extends PropertyValidators>(
  fields: Fields,
): TableDefinition<ValidatorForFields<Fields>>;
export function defineTable<DocumentValidator extends Validator<Record<string, any>, "required", any>>(
  validator: DocumentValidator,
): TableDefinition<DocumentValidator>;
export function defineTable(value: PropertyValidators | Validator<Record<string, any>, "required", any>) {
  return new TableDefinition(asObjectValidator(value), isPropertyValidators(value) ? value : {});
}

export function definePartitionTable<Fields extends PropertyValidators>(
  fields: Fields,
): TableDefinition<ValidatorForFields<Fields>>;
export function definePartitionTable<DocumentValidator extends Validator<Record<string, any>, "required", any>>(
  validator: DocumentValidator,
): TableDefinition<DocumentValidator>;
export function definePartitionTable(
  value: PropertyValidators | Validator<Record<string, any>, "required", any>,
) {
  const table = defineTable(value as never);
  table.placement = { kind: "partitionBy", field: "_id" };
  return table;
}

export function defineColocatedTable<
  Fields extends PropertyValidators,
  Field extends FieldPathsForFields<Fields>,
>(
  table: string,
  field: Field,
  fields: Fields,
): TableDefinition<ValidatorForFields<Fields>>;
export function defineColocatedTable<
  DocumentValidator extends Validator<Record<string, any>, "required", any>,
  Field extends DocumentValidator["fieldPaths"],
>(
  table: string,
  field: Field,
  validator: DocumentValidator,
): TableDefinition<DocumentValidator>;
export function defineColocatedTable(
  table: string,
  field: string,
  value: PropertyValidators | Validator<Record<string, any>, "required", any>,
) {
  const definition = defineTable(value as never);
  definition.placement = { kind: "colocateWith", table, field };
  return definition;
}

export function defineGlobalTable<Fields extends PropertyValidators>(
  fields: Fields,
): TableDefinition<ValidatorForFields<Fields>>;
export function defineGlobalTable<DocumentValidator extends Validator<Record<string, any>, "required", any>>(
  validator: DocumentValidator,
): TableDefinition<DocumentValidator>;
export function defineGlobalTable(
  value: PropertyValidators | Validator<Record<string, any>, "required", any>,
) {
  const table = defineTable(value as never);
  table.placement = { kind: "global" };
  return table;
}

function isPropertyValidators(
  value: PropertyValidators | Validator<Record<string, any>, "required", any>,
): value is PropertyValidators {
  return !("isFlarexValidator" in value);
}

export function defineProjection(config: { sources: readonly string[] }): ProjectionDefinition {
  return new ProjectionDefinition(config.sources);
}

export function defineSchema<Definitions extends GenericSchema>(
  definitions: Definitions,
): SchemaDefinition<Definitions> {
  return new SchemaDefinition(definitions);
}

export type DataModelFromSchemaDefinition<Schema extends SchemaDefinition<any>> = {
  [Name in keyof Schema["tables"] & string as Schema["tables"][Name] extends TableDefinition
    ? Name
    : never]: Schema["tables"][Name] extends TableDefinition<infer DocumentValidator, infer TableIndexes>
    ? {
        document: {
          [Field in keyof (Infer<DocumentValidator> & {
            _id: Id<Name>;
            _creationTime: number;
          })]: (Infer<DocumentValidator> & {
            _id: Id<Name>;
            _creationTime: number;
          })[Field];
        };
        fieldPaths: DocumentValidator["fieldPaths"] | "_id" | "_creationTime";
        indexes: TableIndexes & {
          by_id: readonly ["_id"];
          by_creation_time: readonly ["_creationTime"];
        };
      }
    : never;
} extends infer Model extends GenericDataModel
  ? Model
  : never;
