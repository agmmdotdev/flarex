import {
  applicationSchemaDefinition,
  applicationTableDefinition,
  applicationTableDefinitionWithIndex,
  type ApplicationSchemaDefinition,
  type ApplicationTableDefinition,
} from "@flarex/application-schema-definition/application-schema";
import {
  standardV1,
  type AnyStandardFunctionContractV1,
  type StandardFunctionArgsValidatorV1,
  type StandardFunctionCatalogV1,
  type StandardModuleV1,
  type StandardValidatorOptionalityV1,
  type StandardValidatorV1,
} from "@flarex/standard-application-definition/v1";
import { copyBytes } from "@flarex/utils/bytes";

declare const IdTableHint: unique symbol;

export type Id<TableName extends string> = string & Readonly<{
  readonly [IdTableHint]?: TableName;
}>;

export type ValidatorOptionality = "required" | "optional";

declare const ValidatorType: unique symbol;
declare const ValidatorFieldPathsType: unique symbol;
declare const FunctionArgsType: unique symbol;

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

type AnyValidator = Validator<unknown, ValidatorOptionality, string>;
type AuthoredValidator = StandardValidatorV1<
  unknown,
  StandardValidatorOptionalityV1
>;

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

function inspectValidator<
  Value,
  Optionality extends ValidatorOptionality,
  FieldPaths extends string,
>(
  validator: Validator<Value, Optionality, FieldPaths>,
): StandardValidatorV1<unknown, Optionality> {
  const authored = validatorStates.get(validator);
  if (authored === undefined) {
    throw new TypeError("Validator metadata is unavailable.");
  }
  // The private map is populated with the generic handle, so the stored
  // optionality is the handle's exact optionality.
  return authored as StandardValidatorV1<unknown, Optionality>;
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
  id: <TableName extends string>(
    tableName: TableName,
  ): Validator<Id<TableName>, "required"> =>
    scalarValidator<Id<TableName>>(standardV1.id(tableName)),
  literal: <Literal extends string | number | boolean>(
    value: Literal,
  ): Validator<Literal, "required"> =>
    scalarValidator<Literal>(standardV1.literal(value)),
  array: <Value>(
    value: Validator<Value, "required", string>,
  ): Validator<ReadonlyArray<Value>, "required"> =>
    scalarValidator<ReadonlyArray<Value>>(
      standardV1.array(inspectValidator(value)),
    ),
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
  optional: <Value, FieldPaths extends string>(
    validator: Validator<Value, "required", FieldPaths>,
  ): Validator<Value, "optional", FieldPaths> =>
    captureValidator<Value, "optional", FieldPaths>(
      standardV1.optional(inspectValidator(validator)),
    ),
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
  Returns extends Validator<unknown, "required", string> =
    Validator<unknown, "required", string>,
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
    Validator<unknown, "required", string>
  > ? InferValidator<Args> : never;

export type InferFunctionReturn<Contract> =
  Contract extends FunctionDefinition<
    FunctionKind,
    FunctionVisibility,
    FunctionArgsValidator,
    infer Returns
  > ? InferValidator<Returns> : never;

const functionDefinitionStates = new WeakMap<
  FunctionContract,
  AnyStandardFunctionContractV1
>();

class FunctionDefinitionHandle<
  Kind extends FunctionKind,
  Visibility extends FunctionVisibility,
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
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
    authored: AnyStandardFunctionContractV1,
  ) {
    functionDefinitionStates.set(this, authored);
    Object.freeze(this);
  }
}

interface FunctionInput<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
> {
  readonly args: Args;
  readonly returns: Returns;
}

function makeFunction<
  Kind extends FunctionKind,
  Visibility extends FunctionVisibility,
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(
  kind: Kind,
  visibility: Visibility,
  input: FunctionInput<Args, Returns>,
): FunctionDefinition<Kind, Visibility, Args, Returns> {
  const args = input.args;
  const returns = input.returns;
  const authored = standardV1.function({
    kind,
    visibility,
    args: inspectFunctionArgs(args),
    returns: inspectValidator(returns),
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
): AnyStandardFunctionContractV1 {
  const authored = functionDefinitionStates.get(definition);
  if (authored === undefined) {
    throw new TypeError("Function definition metadata is unavailable.");
  }
  return authored;
}

export function query<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "query",
  "public",
  Args,
  Returns
> {
  return makeFunction("query", "public", input);
}

export function internalQuery<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "query",
  "internal",
  Args,
  Returns
> {
  return makeFunction("query", "internal", input);
}

export function mutation<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "mutation",
  "public",
  Args,
  Returns
> {
  return makeFunction("mutation", "public", input);
}

export function internalMutation<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "mutation",
  "internal",
  Args,
  Returns
> {
  return makeFunction("mutation", "internal", input);
}

export function workflowMutation<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "workflowMutation",
  "public",
  Args,
  Returns
> {
  return makeFunction("workflowMutation", "public", input);
}

export function action<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "action",
  "public",
  Args,
  Returns
> {
  return makeFunction("action", "public", input);
}

export function internalAction<
  Args extends FunctionArgsValidator,
  Returns extends Validator<unknown, "required", string>,
>(input: FunctionInput<Args, Returns>): FunctionDefinition<
  "action",
  "internal",
  Args,
  Returns
> {
  return makeFunction("action", "internal", input);
}

export interface FunctionReference<
  Path extends string,
  Contract extends FunctionContract,
> {
  readonly path: Path;
  readonly contract: Contract;
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
  readonly authored: StandardModuleV1<string, StandardFunctionCatalogV1>;
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
    authored: StandardModuleV1<Path, StandardFunctionCatalogV1>,
    sourceState: SourceModuleState,
  ) {
    this.functions = Object.freeze({ ...functions });
    applicationModuleStates.set(this, { authored, source: sourceState });
    Object.freeze(this);
  }

  reference<ExportName extends keyof Functions & string>(
    exportName: ExportName,
  ): FunctionReference<`${Path}:${ExportName}`, Functions[ExportName]> {
    const path = `${this.path}:${exportName}` as `${Path}:${ExportName}`;
    return Object.freeze({
      path,
      contract: this.functions[exportName],
    });
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
  const authoredFunctions: Record<
    string,
    AnyStandardFunctionContractV1
  > = Object.create(null);
  for (const [exportName, definition] of Object.entries(functions)) {
    Object.defineProperty(authoredFunctions, exportName, {
      enumerable: true,
      value: inspectFunctionDefinition(definition),
    });
  }
  const authored = standardV1.module(path, authoredFunctions);
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
> {
  readonly [ApplicationDefinitionType]: Readonly<{
    readonly schema: Schema;
    readonly modules: Modules;
  }>;
  readonly schema: Schema;
  readonly modules: Modules;
}

export interface ApplicationDefinitionInput<
  Schema extends SchemaDefinition,
  Modules extends ReadonlyArray<ApplicationModule>,
> {
  readonly schema: Schema;
  readonly modules: Modules;
}

export interface ApplicationDefinitionState {
  readonly schema: SchemaDefinition;
  readonly modules: ReadonlyArray<ApplicationModule>;
}

const applicationDefinitionStates = new WeakMap<
  ApplicationDefinition,
  ApplicationDefinitionState
>();

class ApplicationDefinitionHandle<
  Schema extends SchemaDefinition,
  Modules extends ReadonlyArray<ApplicationModule>,
> implements ApplicationDefinition<Schema, Modules> {
  declare readonly [ApplicationDefinitionType]: Readonly<{
    readonly schema: Schema;
    readonly modules: Modules;
  }>;

  constructor(
    readonly schema: Schema,
    readonly modules: Modules,
  ) {
    applicationDefinitionStates.set(this, { schema, modules });
    Object.freeze(this);
  }
}

export function defineApplication<
  Schema extends SchemaDefinition,
  const Modules extends ReadonlyArray<ApplicationModule>,
>(
  input: ApplicationDefinitionInput<Schema, Modules>,
): ApplicationDefinition<Schema, ReadonlyArray<Modules[number]>> {
  const schema = input.schema;
  const modules = Object.freeze([...input.modules]);
  for (const module of modules) inspectApplicationModule(module);
  return new ApplicationDefinitionHandle(schema, modules);
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
