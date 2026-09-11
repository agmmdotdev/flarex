import {
  applicationSchemaDefinition,
  applicationTableDefinition,
  applicationTableDefinitionWithIndex,
  type ApplicationSchemaDefinition,
  type ApplicationTableDefinition,
} from "@flarex/application-schema-definition/application-schema";
import {
  standardV1,
  type StandardFunctionArgsValidatorV1,
  type StandardValidatorOptionalityV1,
  type StandardValidatorV1,
} from "@flarex/standard-application-definition/internal/legacy-authoring";
import type {
  CanonicalDeclarativeFunctionInputV1,
  CanonicalDeclarativeModuleInputV1,
} from "@flarex/declarative-program/v1";
import {
  lowerStandardApplicationRelationIntent,
  type StandardApplicationRelationDeclaration,
} from "@flarex/standard-application-definition/internal/relation-definition";
import { copyBytes } from "@flarex/utils/bytes";

declare const IdTableHint: unique symbol;

export type Id<TableName extends string> = string & Readonly<{
  readonly [IdTableHint]?: TableName;
}>;

export type ValidatorOptionality = "required" | "optional";

declare const ValidatorType: unique symbol;
declare const ValidatorFieldPathsType: unique symbol;
declare const FunctionArgsType: unique symbol;
declare const RelationValidatorType: unique symbol;

export interface Validator<
  Value,
  Optionality extends ValidatorOptionality = "required",
  FieldPaths extends string = never,
> {
  readonly [ValidatorType]: Readonly<{
    readonly value: Value;
    readonly optionality: Optionality;
  }>;
  readonly [ValidatorFieldPathsType]: FieldPaths;
}

interface FunctionArgsCapability {
  readonly [FunctionArgsType]: true;
}

interface RelationValidatorCapability<
  TargetTable extends string,
  Cardinality extends "one" | "many",
> {
  readonly [RelationValidatorType]: Readonly<{
    readonly targetTable: TargetTable;
    readonly cardinality: Cardinality;
  }>;
}

type AnyValidator = Validator<unknown, ValidatorOptionality, string>;
type AuthoredValidator = StandardValidatorV1<
  unknown,
  StandardValidatorOptionalityV1
>;
type AuthoredFunctionDefinition = Omit<
  CanonicalDeclarativeFunctionInputV1,
  "returnsValidator"
> & Readonly<{
  readonly returnsValidator: AuthoredValidator["json"] | null;
}>;

export type ValidatorRecord = Readonly<Record<string, AnyValidator>>;

type RequiredValidatorKeys<Fields extends ValidatorRecord> = {
  readonly [Key in keyof Fields]-?:
    Fields[Key] extends Validator<unknown, "optional", string> ? never : Key;
}[keyof Fields];

type OptionalValidatorKeys<Fields extends ValidatorRecord> = {
  readonly [Key in keyof Fields]-?:
    Fields[Key] extends Validator<unknown, "optional", string> ? Key : never;
}[keyof Fields];

type Simplify<Value> = {
  readonly [Key in keyof Value]: Value[Key];
};

export type InferValidator<Definition> =
  Definition extends Validator<infer Value, ValidatorOptionality, string>
    ? Value
    : never;

export type InferObject<Fields extends ValidatorRecord> = Simplify<
  Readonly<{
    readonly [Key in RequiredValidatorKeys<Fields>]:
      InferValidator<Fields[Key]>;
  }> & Readonly<{
    readonly [Key in OptionalValidatorKeys<Fields>]?:
      InferValidator<Fields[Key]>;
  }>
>;

export type ValidatorFieldPaths<Definition> =
  Definition extends Validator<unknown, ValidatorOptionality, infer Paths>
    ? Paths
    : never;

type FieldPathsForFields<Fields extends ValidatorRecord> = {
  readonly [Field in keyof Fields & string]:
    | Field
    | (ValidatorFieldPaths<Fields[Field]> extends infer Nested extends string
      ? `${Field}.${Nested}`
      : never);
}[keyof Fields & string];

export type ObjectValidator<Fields extends ValidatorRecord> =
  Validator<InferObject<Fields>, "required", FieldPathsForFields<Fields>> &
  FunctionArgsCapability;

type AnyFunctionArgsValidator =
  Validator<unknown, "required", string> & FunctionArgsCapability;

export type FunctionArgsValidator = AnyFunctionArgsValidator;

const validatorStates = new WeakMap<AnyValidator, AuthoredValidator>();
const functionArgsStates = new WeakMap<
  FunctionArgsValidator,
  StandardFunctionArgsValidatorV1
>();

class ValidatorHandle<
  Value,
  Optionality extends ValidatorOptionality,
  FieldPaths extends string,
> implements Validator<Value, Optionality, FieldPaths> {
  declare readonly [ValidatorType]: Readonly<{
    readonly value: Value;
    readonly optionality: Optionality;
  }>;
  declare readonly [ValidatorFieldPathsType]: FieldPaths;

  constructor() {
    Object.freeze(this);
  }
}

class FunctionArgsValidatorHandle<
  Value,
  FieldPaths extends string,
> extends ValidatorHandle<Value, "required", FieldPaths>
  implements FunctionArgsCapability {
  declare readonly [FunctionArgsType]: true;
}

function captureValidator<
  Value,
  Optionality extends ValidatorOptionality,
  FieldPaths extends string,
>(
  authored: StandardValidatorV1<unknown, Optionality>,
): Validator<Value, Optionality, FieldPaths> {
  const handle = new ValidatorHandle<Value, Optionality, FieldPaths>();
  validatorStates.set(handle, authored);
  return handle;
}

function captureFunctionArgsValidator<
  Value,
  FieldPaths extends string,
>(
  authored: StandardFunctionArgsValidatorV1,
): Validator<Value, "required", FieldPaths> & FunctionArgsCapability {
  const handle = new FunctionArgsValidatorHandle<Value, FieldPaths>();
  validatorStates.set(handle, authored);
  functionArgsStates.set(handle, authored);
  return handle;
}

export function inspectValidator<
  Value,
  Optionality extends ValidatorOptionality,
  FieldPaths extends string,
>(
  validator: Validator<Value, Optionality, FieldPaths>,
): StandardValidatorV1<Value, Optionality> {
  const authored = validatorStates.get(validator);
  if (authored === undefined) {
    throw new TypeError("Validator metadata is unavailable.");
  }
  // The private map is populated with the generic handle, so the stored
  // optionality is the handle's exact optionality.
  return authored as StandardValidatorV1<Value, Optionality>;
}

function inspectFunctionArgs(
  validator: FunctionArgsValidator,
): StandardFunctionArgsValidatorV1 {
  const authored = functionArgsStates.get(validator);
  if (authored === undefined) {
    throw new TypeError("Function argument validator metadata is unavailable.");
  }
  return authored;
}

function scalarValidator<Value>(
  authored: StandardValidatorV1<unknown, "required">,
): Validator<Value, "required"> {
  return captureValidator<Value, "required", never>(authored);
}

function idValidator<TableName extends string>(
  tableName: TableName,
): Validator<Id<TableName>, "required"> &
  RelationValidatorCapability<TableName, "one">;
function idValidator<TableName extends string>(
  tableName: TableName,
): Validator<Id<TableName>, "required"> {
  return scalarValidator<Id<TableName>>(standardV1.id(tableName));
}

function arrayValidator<
  TargetTable extends string,
  Value,
  FieldPaths extends string,
>(
  value: Validator<Value, "required", FieldPaths> &
    RelationValidatorCapability<TargetTable, "one">,
): Validator<ReadonlyArray<Value>, "required"> &
  RelationValidatorCapability<TargetTable, "many">;
function arrayValidator<Value>(
  value: Validator<Value, "required", string>,
): Validator<ReadonlyArray<Value>, "required">;
function arrayValidator<Value>(
  value: Validator<Value, "required", string>,
): Validator<ReadonlyArray<Value>, "required"> {
  return scalarValidator<ReadonlyArray<Value>>(
    standardV1.array(inspectValidator(value)),
  );
}

function optionalValidator<
  Value,
  FieldPaths extends string,
  TargetTable extends string,
  Cardinality extends "one" | "many",
>(
  validator: Validator<Value, "required", FieldPaths> &
    RelationValidatorCapability<TargetTable, Cardinality>,
): Validator<Value, "optional", FieldPaths> &
  RelationValidatorCapability<TargetTable, Cardinality>;
function optionalValidator<Value, FieldPaths extends string>(
  validator: Validator<Value, "required", FieldPaths>,
): Validator<Value, "optional", FieldPaths>;
function optionalValidator<Value, FieldPaths extends string>(
  validator: Validator<Value, "required", FieldPaths>,
): Validator<Value, "optional", FieldPaths> {
  return captureValidator<Value, "optional", FieldPaths>(
    standardV1.optional(inspectValidator(validator)),
  );
}

function objectValidator<Fields extends ValidatorRecord>(
  fields: Fields,
): ObjectValidator<Fields> {
  const authoredFields: Record<string, AuthoredValidator> = Object.create(null);
  for (const [fieldName, validator] of Object.entries(fields)) {
    Object.defineProperty(authoredFields, fieldName, {
      enumerable: true,
      value: inspectValidator(validator),
    });
  }
  return captureFunctionArgsValidator<
    InferObject<Fields>,
    FieldPathsForFields<Fields>
  >(standardV1.object(authoredFields));
}

export const v = Object.freeze({
  null: (): Validator<null, "required"> =>
    scalarValidator<null>(standardV1.null()),
  number: (): Validator<number, "required"> =>
    scalarValidator<number>(standardV1.number()),
  bigint: (): Validator<bigint, "required"> =>
    scalarValidator<bigint>(standardV1.bigint()),
  boolean: (): Validator<boolean, "required"> =>
    scalarValidator<boolean>(standardV1.boolean()),
  string: (): Validator<string, "required"> =>
    scalarValidator<string>(standardV1.string()),
  bytes: (): Validator<ArrayBuffer, "required"> =>
    scalarValidator<ArrayBuffer>(standardV1.bytes()),
  any: (): AnyFunctionArgsValidator =>
    captureFunctionArgsValidator<unknown, string>(standardV1.any()),
  id: idValidator,
  literal: <Literal extends string | number | boolean>(
    value: Literal,
  ): Validator<Literal, "required"> =>
    scalarValidator<Literal>(standardV1.literal(value)),
  array: arrayValidator,
  object: objectValidator,
  record: <Key, Value>(
    keys: Validator<Key, "required", string>,
    values: Validator<Value, "required", string>,
  ): Validator<Readonly<Record<string, Value>>, "required"> =>
    scalarValidator<Readonly<Record<string, Value>>>(standardV1.record(
      inspectValidator(keys),
      inspectValidator(values),
    )),
  union: <Members extends readonly [
    Validator<unknown, "required", string>,
    ...ReadonlyArray<Validator<unknown, "required", string>>,
  ]>(
    ...members: Members
  ): Validator<
    InferValidator<Members[number]>,
    "required",
    ValidatorFieldPaths<Members[number]>
  > => {
    const [first, ...rest] = members;
    return captureValidator<
      InferValidator<Members[number]>,
      "required",
      ValidatorFieldPaths<Members[number]>
    >(standardV1.union(
      inspectValidator(first),
      ...rest.map((member) => inspectValidator(member)),
    ));
  },
  optional: optionalValidator,
  nullable: <Value, FieldPaths extends string>(
    validator: Validator<Value, "required", FieldPaths>,
  ): Validator<Value | null, "required", FieldPaths> =>
    captureValidator<Value | null, "required", FieldPaths>(
      standardV1.nullable(inspectValidator(validator)),
    ),
});

export type TableIndexFields = readonly [string, ...ReadonlyArray<string>];
export type TableIndexCatalog = Readonly<Record<string, TableIndexFields>>;

declare const TableDefinitionType: unique symbol;

export interface TableDefinition<
  Fields extends ValidatorRecord = ValidatorRecord,
  Indexes extends TableIndexCatalog = Readonly<Record<never, never>>,
> {
  readonly [TableDefinitionType]: Readonly<{
    readonly fields: Fields;
    readonly indexes: Indexes;
  }>;

  index<
    Descriptor extends string,
    First extends FieldPathsForFields<Fields>,
    Rest extends ReadonlyArray<FieldPathsForFields<Fields>>,
  >(
    descriptor: Descriptor,
    fields: readonly [First, ...Rest],
  ): TableDefinition<
    Fields,
    Indexes & Readonly<Record<Descriptor, readonly [First, ...Rest]>>
  >;
}

export type TableCatalog = Readonly<Record<string, TableDefinition>>;

type AuthoredTable = ApplicationTableDefinition;

const tableDefinitionStates = new WeakMap<TableDefinition, AuthoredTable>();

class TableDefinitionHandle<
  Fields extends ValidatorRecord,
  Indexes extends TableIndexCatalog,
> implements TableDefinition<Fields, Indexes> {
  declare readonly [TableDefinitionType]: Readonly<{
    readonly fields: Fields;
    readonly indexes: Indexes;
  }>;

  constructor(authored: AuthoredTable) {
    tableDefinitionStates.set(this, authored);
    Object.freeze(this);
  }

  index<
    Descriptor extends string,
    First extends FieldPathsForFields<Fields>,
    Rest extends ReadonlyArray<FieldPathsForFields<Fields>>,
  >(
    descriptor: Descriptor,
    fields: readonly [First, ...Rest],
  ): TableDefinition<
    Fields,
    Indexes & Readonly<Record<Descriptor, readonly [First, ...Rest]>>
  > {
    const authored = applicationTableDefinitionWithIndex(
      inspectTableDefinition(this),
      descriptor,
      fields,
    );
    return new TableDefinitionHandle<
      Fields,
      Indexes & Readonly<Record<Descriptor, readonly [First, ...Rest]>>
    >(authored);
  }
}

export function defineTable<Fields extends ValidatorRecord>(
  fields: Fields,
): TableDefinition<Fields> {
  const authoredFields: Record<string, AuthoredValidator> = Object.create(null);
  for (const [fieldName, validator] of Object.entries(fields)) {
    Object.defineProperty(authoredFields, fieldName, {
      enumerable: true,
      value: inspectValidator(validator),
    });
  }
  const document = standardV1.object(authoredFields);
  return new TableDefinitionHandle(applicationTableDefinition(document.json));
}

function inspectTableDefinition(table: TableDefinition): AuthoredTable {
  const authored = tableDefinitionStates.get(table);
  if (authored === undefined) {
    throw new TypeError("Table definition metadata is unavailable.");
  }
  return authored;
}

declare const SchemaDefinitionType: unique symbol;

export interface SchemaDefinition<
  Tables extends TableCatalog = TableCatalog,
> {
  readonly [SchemaDefinitionType]: Tables;
}

type TablesOfSchema<Schema extends SchemaDefinition> =
  Schema extends SchemaDefinition<infer Tables> ? Tables : never;

type TableNamesOfSchema<Schema extends SchemaDefinition> =
  keyof TablesOfSchema<Schema> & string;

type FieldsOfTable<Table extends TableDefinition> =
  Table extends TableDefinition<infer Fields, TableIndexCatalog>
    ? Fields
    : never;

type RelationTargetForValidator<Definition> =
  Definition extends RelationValidatorCapability<infer TableName, "one" | "many">
    ? TableName
    : never;

type RelationValueForValidator<Definition> =
  Definition extends RelationValidatorCapability<string, "many">
    ? Definition extends Validator<unknown, "required", string>
      ? Readonly<{
          readonly cardinality: "many";
          readonly minItems: number;
          readonly maxItems: number;
          readonly ordered: boolean;
        }>
      : never
    : Definition extends RelationValidatorCapability<string, "one">
      ? Definition extends Validator<unknown, infer Optionality, string>
        ? Readonly<{
            readonly cardinality: "one";
            readonly required: Optionality extends "required" ? true : false;
          }>
        : never
      : never;

type RelationDefinitionInputForTable<
  Schema extends SchemaDefinition,
  SourceTable extends TableNamesOfSchema<Schema>,
> = FieldsOfTable<TablesOfSchema<Schema>[SourceTable]> extends infer Fields extends
  ValidatorRecord
  ? {
      readonly [SourceField in keyof Fields & string]: Readonly<{
        readonly source: Readonly<{
          readonly table: SourceTable;
          readonly field: SourceField;
        }>;
        readonly target: Readonly<{
          readonly table: Extract<
            RelationTargetForValidator<Fields[SourceField]>,
            TableNamesOfSchema<Schema>
          >;
        }>;
        readonly value: RelationValueForValidator<Fields[SourceField]>;
        readonly inverse: Readonly<{ readonly name: string | null }>;
        readonly onTargetDelete: "restrict";
      }>;
    }[keyof Fields & string]
  : never;

export type RelationDefinitionInput<Schema extends SchemaDefinition> = {
  readonly [SourceTable in TableNamesOfSchema<Schema>]:
    RelationDefinitionInputForTable<Schema, SourceTable>;
}[TableNamesOfSchema<Schema>];

declare const RelationDefinitionType: unique symbol;

/**
 * Opaque Standard relation intent bound to one authored schema. The handle
 * exposes no protocol envelope, catalog identity, or persistence capability.
 */
export interface RelationDefinition<
  Schema extends SchemaDefinition = SchemaDefinition,
> {
  readonly [RelationDefinitionType]: Schema;
}

export interface RelationDefinitionState {
  readonly schema: SchemaDefinition;
  readonly declaration: StandardApplicationRelationDeclaration;
}

interface CapturedRelationDefinitionInput {
  readonly source: Readonly<{
    readonly table: string;
    readonly field: string;
  }>;
  readonly target: Readonly<{ readonly table: string }>;
  readonly value:
    | Readonly<{ readonly cardinality: "one"; readonly required: boolean }>
    | Readonly<{
        readonly cardinality: "many";
        readonly minItems: number;
        readonly maxItems: number;
        readonly ordered: boolean;
      }>;
  readonly inverse: Readonly<{ readonly name: string | null }>;
  readonly onTargetDelete: "restrict";
}

const relationDefinitionStates = new WeakMap<
  RelationDefinition,
  RelationDefinitionState
>();

class RelationDefinitionHandle<Schema extends SchemaDefinition>
  implements RelationDefinition<Schema> {
  declare readonly [RelationDefinitionType]: Schema;

  constructor(
    schema: Schema,
    declaration: StandardApplicationRelationDeclaration,
  ) {
    relationDefinitionStates.set(this, { schema, declaration });
    Object.freeze(this);
  }
}

export function defineRelation<Schema extends SchemaDefinition>(
  schema: Schema,
  input: RelationDefinitionInput<Schema>,
): RelationDefinition<Schema>;
export function defineRelation(
  schema: SchemaDefinition,
  input: CapturedRelationDefinitionInput,
): RelationDefinition {
  inspectSchemaDefinition(schema);
  const source = input.source;
  const target = input.target;
  const inputValue = input.value;
  const inverse = input.inverse;
  const onTargetDelete = input.onTargetDelete;
  const field = source.field;
  const value = inputValue.cardinality === "one"
    ? Object.freeze({
        cardinality: "one" as const,
        required: inputValue.required,
      })
    : Object.freeze({
        cardinality: "many" as const,
        minItems: inputValue.minItems,
        maxItems: inputValue.maxItems,
        ordered: inputValue.ordered,
      });
  const declaration = lowerStandardApplicationRelationIntent(Object.freeze({
    sourceTable: source.table,
    sourceField: field,
    targetTable: target.table,
    value,
    inverseName: inverse.name,
    onTargetDelete,
  }));
  return new RelationDefinitionHandle(schema, declaration);
}

export function inspectRelationDefinition(
  relation: RelationDefinition,
): RelationDefinitionState {
  const state = relationDefinitionStates.get(relation);
  if (state === undefined) {
    throw new TypeError("Relation definition metadata is unavailable.");
  }
  return state;
}

const schemaDefinitionStates = new WeakMap<
  SchemaDefinition,
  ApplicationSchemaDefinition
>();

class SchemaDefinitionHandle<Tables extends TableCatalog>
  implements SchemaDefinition<Tables> {
  declare readonly [SchemaDefinitionType]: Tables;

  constructor(authored: ApplicationSchemaDefinition) {
    schemaDefinitionStates.set(this, authored);
    Object.freeze(this);
  }
}

export function defineSchema<Tables extends TableCatalog>(
  tables: Tables,
): SchemaDefinition<Tables> {
  const authoredTables: Record<string, AuthoredTable> = Object.create(null);
  for (const [logicalName, table] of Object.entries(tables)) {
    Object.defineProperty(authoredTables, logicalName, {
      enumerable: true,
      value: inspectTableDefinition(table),
    });
  }
  return new SchemaDefinitionHandle(applicationSchemaDefinition(authoredTables));
}

export function inspectSchemaDefinition(
  schema: SchemaDefinition,
): ApplicationSchemaDefinition {
  const authored = schemaDefinitionStates.get(schema);
  if (authored === undefined) {
    throw new TypeError("Schema definition metadata is unavailable.");
  }
  return authored;
}

export type FunctionKind =
  | "query"
  | "mutation"
  | "workflowMutation"
  | "action";

export type FunctionVisibility = "public" | "internal";

declare const FunctionDefinitionType: unique symbol;

export interface FunctionDefinition<
  Kind extends FunctionKind = FunctionKind,
  Visibility extends FunctionVisibility = FunctionVisibility,
  Args extends FunctionArgsValidator = FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string> | null =
    Validator<unknown, "required", string> | null,
> {
  readonly [FunctionDefinitionType]: Readonly<{
    readonly kind: Kind;
    readonly visibility: Visibility;
    readonly args: Args;
    readonly returns: Returns;
  }>;
  readonly kind: Kind;
  readonly visibility: Visibility;
  readonly args: Args;
  readonly returns: Returns;
}

export type FunctionContract = FunctionDefinition;
export type FunctionCatalog = Readonly<Record<string, FunctionContract>>;

export type InferFunctionArgs<Contract> =
  Contract extends FunctionDefinition<
    FunctionKind,
    FunctionVisibility,
    infer Args,
    Validator<unknown, "required", string> | null
  > ? InferValidator<Args> : never;

type RuntimeFunctionResultMember<Value> =
  unknown extends Value ? Value
    : Value extends ArrayBuffer ? ArrayBuffer
    : string extends Value ? string
    : Value extends ReadonlyArray<infer Member>
      ? ReadonlyArray<RuntimeFunctionResultValue<Member>>
    : Value extends object ? {
        readonly [Key in keyof Value]: RuntimeFunctionResultValue<Value[Key]>;
      }
    : Value;

export type RuntimeFunctionResultValue<Value> =
  Value extends unknown ? RuntimeFunctionResultMember<Value> : never;

export type InferFunctionReturn<Contract> =
  Contract extends FunctionDefinition<
    FunctionKind,
    FunctionVisibility,
    FunctionArgsValidator,
    infer Returns
  > ? Returns extends Validator<unknown, "required", string>
      ? RuntimeFunctionResultValue<InferValidator<Returns>>
      : unknown
    : never;

const functionDefinitionStates = new WeakMap<
  FunctionContract,
  Omit<AuthoredFunctionDefinition, "exportName">
>();

class FunctionDefinitionHandle<
  Kind extends FunctionKind,
  Visibility extends FunctionVisibility,
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string> | null,
> implements FunctionDefinition<Kind, Visibility, Args, Returns> {
  declare readonly [FunctionDefinitionType]: Readonly<{
    readonly kind: Kind;
    readonly visibility: Visibility;
    readonly args: Args;
    readonly returns: Returns;
  }>;

  constructor(
    readonly kind: Kind,
    readonly visibility: Visibility,
    readonly args: Args,
    readonly returns: Returns,
    authored: Omit<AuthoredFunctionDefinition, "exportName">,
  ) {
    functionDefinitionStates.set(this, authored);
    Object.freeze(this);
  }
}

interface ValidatedFunctionInput<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
> {
  readonly args: Args;
  readonly returns: Returns;
}

interface UnvalidatedFunctionInput<Args extends FunctionArgsValidator> {
  readonly args: Args;
  readonly returns?: undefined;
}

function makeFunction<
  Kind extends FunctionKind,
  Visibility extends FunctionVisibility,
  Args extends FunctionArgsValidator,
>(
  kind: Kind,
  visibility: Visibility,
  input:
    | ValidatedFunctionInput<
        Args,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<Args>,
): FunctionDefinition<
  Kind,
  Visibility,
  Args,
  Validator<unknown, "required", string> | null
> {
  const args = input.args;
  const returnsInput = input.returns;
  const returns = returnsInput === undefined ? null : returnsInput;
  const authored = Object.freeze({
    kind,
    visibility,
    argsValidator: inspectFunctionArgs(args).json,
    returnsValidator: returns === null ? null : inspectValidator(returns).json,
  });
  const handle = new FunctionDefinitionHandle(
    kind,
    visibility,
    args,
    returns,
    authored,
  );
  return handle;
}

function inspectFunctionDefinition(
  definition: FunctionContract,
): Omit<AuthoredFunctionDefinition, "exportName"> {
  const authored = functionDefinitionStates.get(definition);
  if (authored === undefined) {
    throw new TypeError("Function definition metadata is unavailable.");
  }
  return authored;
}

export function query<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "query",
  "public",
  Args,
  Returns
>;
export function query<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"query", "public", Args, null>;
export function query(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("query", "public", input);
}

export function internalQuery<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "query",
  "internal",
  Args,
  Returns
>;
export function internalQuery<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"query", "internal", Args, null>;
export function internalQuery(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("query", "internal", input);
}

export function mutation<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "mutation",
  "public",
  Args,
  Returns
>;
export function mutation<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"mutation", "public", Args, null>;
export function mutation(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("mutation", "public", input);
}

export function internalMutation<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "mutation",
  "internal",
  Args,
  Returns
>;
export function internalMutation<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"mutation", "internal", Args, null>;
export function internalMutation(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("mutation", "internal", input);
}

export function workflowMutation<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "workflowMutation",
  "public",
  Args,
  Returns
>;
export function workflowMutation<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"workflowMutation", "public", Args, null>;
export function workflowMutation(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("workflowMutation", "public", input);
}

export function action<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "action",
  "public",
  Args,
  Returns
>;
export function action<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"action", "public", Args, null>;
export function action(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("action", "public", input);
}

export function internalAction<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: ValidatedFunctionInput<Args, Returns>): FunctionDefinition<
  "action",
  "internal",
  Args,
  Returns
>;
export function internalAction<Args extends FunctionArgsValidator>(
  input: UnvalidatedFunctionInput<Args>,
): FunctionDefinition<"action", "internal", Args, null>;
export function internalAction(
  input:
    | ValidatedFunctionInput<
        FunctionArgsValidator,
        Validator<unknown, "required", string>
      >
    | UnvalidatedFunctionInput<FunctionArgsValidator>,
): FunctionDefinition {
  return makeFunction("action", "internal", input);
}

declare const FunctionReferenceType: unique symbol;

export interface FunctionReference<
  Path extends string,
  Contract extends FunctionContract,
> {
  readonly [FunctionReferenceType]: Readonly<{
    readonly path: Path;
    readonly contract: Contract;
  }>;
  readonly path: Path;
  readonly contract: Contract;
}

export interface InspectedFunctionReference {
  readonly path: string;
  readonly returnsValidator: AuthoredFunctionDefinition["returnsValidator"];
}

const functionReferenceStates = new WeakMap<
  FunctionReference<string, FunctionContract>,
  InspectedFunctionReference
>();

class FunctionReferenceHandle<
  Path extends string,
  Contract extends FunctionContract,
> implements FunctionReference<Path, Contract> {
  declare readonly [FunctionReferenceType]: Readonly<{
    readonly path: Path;
    readonly contract: Contract;
  }>;

  constructor(
    readonly path: Path,
    readonly contract: Contract,
  ) {
    const definition = inspectFunctionDefinition(contract);
    functionReferenceStates.set(this, Object.freeze({
      path,
      returnsValidator: definition.returnsValidator,
    }));
    Object.freeze(this);
  }
}

export function inspectFunctionReference(
  reference: FunctionReference<string, FunctionContract>,
): InspectedFunctionReference {
  const state = functionReferenceStates.get(reference);
  if (state === undefined) {
    throw new TypeError("Function reference metadata is unavailable.");
  }
  return state;
}

declare const SourceModuleType: unique symbol;

export interface SourceModule {
  readonly [SourceModuleType]: true;
  readonly path: string;
  readonly byteLength: number;
  readonly sourceMapByteLength: number | null;
}

export interface SourceModuleInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sourceMapBytes?: Uint8Array | null;
}

export interface SourceModuleState {
  readonly bytes: Uint8Array;
  readonly sourceMapBytes: Uint8Array | null;
}

const sourceModuleStates = new WeakMap<SourceModule, SourceModuleState>();

class SourceModuleHandle implements SourceModule {
  declare readonly [SourceModuleType]: true;

  constructor(
    readonly path: string,
    readonly byteLength: number,
    readonly sourceMapByteLength: number | null,
  ) {
    Object.freeze(this);
  }
}

export function sourceModule(input: SourceModuleInput): SourceModule {
  const path = input.path;
  const bytes = copyBytes(input.bytes);
  const sourceMapInput = input.sourceMapBytes;
  const sourceMapBytes = sourceMapInput === undefined ||
      sourceMapInput === null
    ? null
    : copyBytes(sourceMapInput);
  const handle = new SourceModuleHandle(
    path,
    bytes.byteLength,
    sourceMapBytes?.byteLength ?? null,
  );
  sourceModuleStates.set(handle, { bytes, sourceMapBytes });
  return handle;
}

export function inspectSourceModule(source: SourceModule): SourceModuleState {
  const state = sourceModuleStates.get(source);
  if (state === undefined) {
    throw new TypeError("Source module metadata is unavailable.");
  }
  return state;
}

declare const ApplicationModuleType: unique symbol;

export interface ApplicationModule<
  Path extends string = string,
  Functions extends FunctionCatalog = FunctionCatalog,
> {
  readonly [ApplicationModuleType]: Readonly<{
    readonly path: Path;
    readonly functions: Functions;
  }>;
  readonly path: Path;
  readonly source: SourceModule;
  readonly functions: Functions;

  reference<ExportName extends keyof Functions & string>(
    exportName: ExportName,
  ): FunctionReference<`${Path}:${ExportName}`, Functions[ExportName]>;
}

export interface ApplicationModuleInput<
  Path extends string,
  Functions extends FunctionCatalog,
> {
  readonly path: Path;
  readonly source: SourceModule;
  readonly functions: Functions;
}

export interface ApplicationModuleState {
  readonly authored: CanonicalDeclarativeModuleInputV1;
  readonly source: SourceModuleState;
}

const applicationModuleStates = new WeakMap<
  ApplicationModule,
  ApplicationModuleState
>();

class ApplicationModuleHandle<
  Path extends string,
  Functions extends FunctionCatalog,
> implements ApplicationModule<Path, Functions> {
  declare readonly [ApplicationModuleType]: Readonly<{
    readonly path: Path;
    readonly functions: Functions;
  }>;

  readonly functions: Functions;

  constructor(
    readonly path: Path,
    readonly source: SourceModule,
    functions: Functions,
    authored: CanonicalDeclarativeModuleInputV1,
    sourceState: SourceModuleState,
  ) {
    this.functions = Object.freeze({ ...functions });
    applicationModuleStates.set(this, { authored, source: sourceState });
    Object.freeze(this);
  }

  reference<ExportName extends keyof Functions & string>(
    exportName: ExportName,
  ): FunctionReference<`${Path}:${ExportName}`, Functions[ExportName]> {
    // SAFETY: both interpolated members retain their generic literal types.
    const path = `${this.path}:${exportName}` as `${Path}:${ExportName}`;
    const contract: Functions[ExportName] | undefined =
      this.functions[exportName];
    if (contract === undefined) {
      throw new TypeError(`Function export ${exportName} is unavailable.`);
    }
    return new FunctionReferenceHandle<
      `${Path}:${ExportName}`,
      Functions[ExportName]
    >(
      path,
      contract,
    );
  }
}

export function defineModule<
  Path extends string,
  Functions extends FunctionCatalog,
>(
  input: ApplicationModuleInput<Path, Functions>,
): ApplicationModule<Path, Functions> {
  const path = input.path;
  const source = input.source;
  const functions = Object.freeze({ ...input.functions });
  const sourceState = inspectSourceModule(source);
  const authored = Object.freeze({
    modulePath: path,
    functions: Object.freeze(Object.entries(functions).map(
      ([exportName, definition]) => Object.freeze({
        exportName,
        ...inspectFunctionDefinition(definition),
      }),
    )),
  });
  return new ApplicationModuleHandle(
    path,
    source,
    functions,
    authored,
    sourceState,
  );
}

export function inspectApplicationModule(
  module: ApplicationModule,
): ApplicationModuleState {
  const state = applicationModuleStates.get(module);
  if (state === undefined) {
    throw new TypeError("Application module metadata is unavailable.");
  }
  return state;
}

declare const ApplicationDefinitionType: unique symbol;

export interface ApplicationDefinition<
  Schema extends SchemaDefinition = SchemaDefinition,
  Modules extends ReadonlyArray<ApplicationModule> =
    ReadonlyArray<ApplicationModule>,
  Relations extends ReadonlyArray<RelationDefinition<Schema>> =
    ReadonlyArray<RelationDefinition<Schema>>,
> {
  readonly [ApplicationDefinitionType]: Readonly<{
    readonly schema: Schema;
    readonly modules: Modules;
    readonly relations: Relations;
  }>;
  readonly schema: Schema;
  readonly modules: Modules;
  readonly relations: Relations;
}

export interface ApplicationDefinitionInput<
  Schema extends SchemaDefinition,
  Modules extends ReadonlyArray<ApplicationModule>,
  Relations extends ReadonlyArray<RelationDefinition<Schema>> =
    ReadonlyArray<RelationDefinition<Schema>>,
> {
  readonly schema: Schema;
  readonly modules: Modules;
  readonly relations?: Relations;
}

export interface ApplicationDefinitionState {
  readonly schema: SchemaDefinition;
  readonly modules: ReadonlyArray<ApplicationModule>;
  readonly relations: ReadonlyArray<RelationDefinition>;
}

const applicationDefinitionStates = new WeakMap<
  ApplicationDefinition,
  ApplicationDefinitionState
>();

class ApplicationDefinitionHandle<
  Schema extends SchemaDefinition,
  Modules extends ReadonlyArray<ApplicationModule>,
  Relations extends ReadonlyArray<RelationDefinition<Schema>>,
> implements ApplicationDefinition<Schema, Modules, Relations> {
  declare readonly [ApplicationDefinitionType]: Readonly<{
    readonly schema: Schema;
    readonly modules: Modules;
    readonly relations: Relations;
  }>;

  constructor(
    readonly schema: Schema,
    readonly modules: Modules,
    readonly relations: Relations,
  ) {
    applicationDefinitionStates.set(this, { schema, modules, relations });
    Object.freeze(this);
  }
}

export function defineApplication<
  Schema extends SchemaDefinition,
  const Modules extends ReadonlyArray<ApplicationModule>,
  const Relations extends ReadonlyArray<RelationDefinition<Schema>> = readonly [],
>(
  input: ApplicationDefinitionInput<Schema, Modules, Relations>,
): ApplicationDefinition<
  Schema,
  ReadonlyArray<Modules[number]>,
  ReadonlyArray<Relations[number]>
> {
  const schema = input.schema;
  const modules = Object.freeze([...input.modules]);
  const relations = Object.freeze([...(input.relations ?? [])]) as
    ReadonlyArray<Relations[number]>;
  for (const module of modules) inspectApplicationModule(module);
  for (const relation of relations) {
    if (inspectRelationDefinition(relation).schema !== schema) {
      throw new TypeError("Relation definition belongs to a different schema.");
    }
  }
  return new ApplicationDefinitionHandle(schema, modules, relations);
}

export function inspectApplicationDefinition(
  definition: ApplicationDefinition,
): ApplicationDefinitionState {
  const state = applicationDefinitionStates.get(definition);
  if (state === undefined) {
    throw new TypeError("Application definition metadata is unavailable.");
  }
  return state;
}
