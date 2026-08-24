import type {
  CanonicalDeclarativeFunctionInputV1,
  CanonicalDeclarativeFunctionKindV1,
  CanonicalDeclarativeFunctionVisibilityV1,
  CanonicalDeclarativeModuleInputV1,
} from "@flarex/declarative-program/v1";
import {
  applicationArrayValidatorJson,
  applicationIdValidatorJson,
  applicationLiteralValidatorJson,
  applicationObjectValidatorJson,
  applicationRecordValidatorJson,
  applicationScalarValidatorJson,
  applicationUnionValidatorJson,
  snapshotApplicationValidatorJson,
} from "@flarex/application-schema-definition/validator-json";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

import {
  standardSchemaDefinitionV1,
  standardTableDefinitionV1,
} from "./schemaAuthoringV1.js";
import type {
  StandardSchemaDefinitionV1,
  StandardTableCatalogV1,
  StandardTableDefinitionV1,
} from "./schemaAuthoringV1.js";

/**
 * IDs are strings at this host-neutral layer. Table-authoritative branding is
 * added only by a later boundary that can prove the ID belongs to the table.
 */
declare const StandardIdV1TableHint: unique symbol;

export type StandardIdV1<TableName extends string> = string & Readonly<{
  readonly [StandardIdV1TableHint]?: TableName;
}>;

export type StandardValidatorOptionalityV1 = "required" | "optional";

declare const StandardValidatorV1Type: unique symbol;

/**
 * Pure typed metadata that lowers directly to the protocol-owned validator
 * JSON. It does not validate runtime values or establish canonical authority.
 */
export class StandardValidatorV1<
  Value,
  Optionality extends StandardValidatorOptionalityV1 = "required",
  Json extends ValidatorJsonV1 = ValidatorJsonV1,
> {
  declare readonly [StandardValidatorV1Type]: Readonly<{
    readonly value: Value;
    readonly optionality: Optionality;
    readonly json: Json;
  }>;

  constructor(
    readonly json: Json,
    readonly optionality: Optionality,
  ) {
    Object.freeze(this);
  }
}

declare const StandardValidatorFieldPathsV1Type: unique symbol;

/**
 * Type-only capability carried by validators whose indexable descendants are
 * known from their constructor. Keeping it off the base validator makes
 * explicit widening and opaque exact-JSON adaptation safely lose that claim.
 */
export class StandardValidatorWithFieldPathsV1<
  Value,
  Optionality extends StandardValidatorOptionalityV1,
  Json extends ValidatorJsonV1,
  FieldPaths extends string,
> extends StandardValidatorV1<Value, Optionality, Json> {
  declare readonly [StandardValidatorFieldPathsV1Type]: FieldPaths;
}

/**
 * Establishes owned immutable Standard metadata from an already exact
 * protocol validator. This is not an unknown-input decoder: callers must
 * first use the protocol or their producer-owned narrowing boundary.
 */
export function standardValidatorV1FromExactJsonV1(
  json: ValidatorJsonV1,
): StandardValidatorV1<unknown, "required"> {
  return new StandardValidatorV1(
    snapshotApplicationValidatorJson(json),
    "required",
  );
}

export type InferStandardValidatorV1<Validator> =
  Validator extends StandardValidatorV1<
    infer Value,
    StandardValidatorOptionalityV1,
    ValidatorJsonV1
  >
    ? Value
    : never;

export type StandardValidatorRecordV1 = Readonly<
  Record<string, StandardValidatorV1<unknown, StandardValidatorOptionalityV1>>
>;

type RequiredStandardValidatorKeysV1<Fields extends StandardValidatorRecordV1> = {
  readonly [Key in keyof Fields]-?:
    Fields[Key] extends StandardValidatorV1<unknown, "optional"> ? never : Key;
}[keyof Fields];

type OptionalStandardValidatorKeysV1<Fields extends StandardValidatorRecordV1> = {
  readonly [Key in keyof Fields]-?:
    Fields[Key] extends StandardValidatorV1<unknown, "optional"> ? Key : never;
}[keyof Fields];

type SimplifyStandardTypeV1<Value> = {
  readonly [Key in keyof Value]: Value[Key];
};

export type InferStandardObjectV1<Fields extends StandardValidatorRecordV1> =
  SimplifyStandardTypeV1<Readonly<{
    readonly [Key in RequiredStandardValidatorKeysV1<Fields>]:
      InferStandardValidatorV1<Fields[Key]>;
  }> & Readonly<{
    readonly [Key in OptionalStandardValidatorKeysV1<Fields>]?:
      InferStandardValidatorV1<Fields[Key]>;
  }>>;

export type StandardValidatorFieldPathsV1<Validator> =
  Validator extends Readonly<{
    readonly [StandardValidatorFieldPathsV1Type]: infer FieldPaths extends string;
  }> ? FieldPaths : never;

type StandardFieldPathsForFieldsV1<
  Fields extends StandardValidatorRecordV1,
> = {
  readonly [Field in keyof Fields & string]:
    | Field
    | (StandardValidatorFieldPathsV1<Fields[Field]> extends
        infer Nested extends string
      ? `${Field}.${Nested}`
      : never);
}[keyof Fields & string];

export type StandardObjectValidatorV1<
  Fields extends StandardValidatorRecordV1,
> = StandardValidatorWithFieldPathsV1<
  InferStandardObjectV1<Fields>,
  "required",
  ObjectValidatorJsonV1,
  StandardFieldPathsForFieldsV1<Fields>
>;

export type StandardFunctionArgsValidatorV1 =
  | StandardValidatorV1<
      Readonly<Record<string, unknown>>,
      "required",
      ObjectValidatorJsonV1
    >
  | StandardValidatorV1<unknown, "required", Readonly<{ readonly type: "any" }>>;

export interface StandardFunctionContractInputV1<
  Kind extends CanonicalDeclarativeFunctionKindV1,
  Visibility extends CanonicalDeclarativeFunctionVisibilityV1,
  ArgsValidator extends StandardFunctionArgsValidatorV1,
  ReturnsValidator extends StandardValidatorV1<unknown, "required">,
> {
  readonly kind: Kind;
  readonly visibility: Visibility;
  readonly args: ArgsValidator;
  readonly returns: ReturnsValidator;
}

export class StandardFunctionContractV1<
  Kind extends CanonicalDeclarativeFunctionKindV1,
  Visibility extends CanonicalDeclarativeFunctionVisibilityV1,
  ArgsValidator extends StandardFunctionArgsValidatorV1,
  ReturnsValidator extends StandardValidatorV1<unknown, "required">,
> {
  readonly kind: Kind;
  readonly visibility: Visibility;
  readonly args: ArgsValidator;
  readonly returns: ReturnsValidator;

  constructor(
    input: StandardFunctionContractInputV1<
      Kind,
      Visibility,
      ArgsValidator,
      ReturnsValidator
    >,
  ) {
    this.kind = input.kind;
    this.visibility = input.visibility;
    this.args = input.args;
    this.returns = input.returns;
    Object.freeze(this);
  }

  toCanonicalInput(exportName: string): CanonicalDeclarativeFunctionInputV1 {
    return Object.freeze({
      exportName,
      kind: this.kind,
      visibility: this.visibility,
      argsValidator: this.args.json,
      returnsValidator: this.returns.json,
    });
  }
}

export type AnyStandardFunctionContractV1 = StandardFunctionContractV1<
  CanonicalDeclarativeFunctionKindV1,
  CanonicalDeclarativeFunctionVisibilityV1,
  StandardFunctionArgsValidatorV1,
  StandardValidatorV1<unknown, "required">
>;

export type InferStandardFunctionArgsV1<Contract> =
  Contract extends StandardFunctionContractV1<
    CanonicalDeclarativeFunctionKindV1,
    CanonicalDeclarativeFunctionVisibilityV1,
    infer ArgsValidator,
    StandardValidatorV1<unknown, "required">
  > ? InferStandardValidatorV1<ArgsValidator> : never;

export type InferStandardFunctionReturnV1<Contract> =
  Contract extends StandardFunctionContractV1<
    CanonicalDeclarativeFunctionKindV1,
    CanonicalDeclarativeFunctionVisibilityV1,
    StandardFunctionArgsValidatorV1,
    infer ReturnsValidator
  > ? InferStandardValidatorV1<ReturnsValidator> : never;

export interface StandardFunctionReferenceV1<
  Path extends string,
  Contract extends AnyStandardFunctionContractV1,
> {
  readonly path: Path;
  readonly contract: Contract;
}

export type StandardFunctionCatalogV1 = Readonly<
  Record<string, AnyStandardFunctionContractV1>
>;

export class StandardModuleV1<
  ModulePath extends string,
  Functions extends StandardFunctionCatalogV1,
> {
  readonly modulePath: ModulePath;
  readonly functions: Functions;

  constructor(modulePath: ModulePath, functions: Functions) {
    this.modulePath = modulePath;
    this.functions = Object.freeze({ ...functions });
    Object.freeze(this);
  }

  reference<ExportName extends keyof Functions & string>(
    exportName: ExportName,
  ): StandardFunctionReferenceV1<
    `${ModulePath}:${ExportName}`,
    Functions[ExportName]
  > {
    const path = `${this.modulePath}:${exportName}` as
      `${ModulePath}:${ExportName}`;
    return Object.freeze({
      path,
      contract: this.functions[exportName],
    });
  }

  toCanonicalInput(): CanonicalDeclarativeModuleInputV1 {
    return Object.freeze({
      modulePath: this.modulePath,
      functions: Object.freeze(Object.entries(this.functions).map(
        ([exportName, contract]) => contract.toCanonicalInput(exportName),
      )),
    });
  }
}

function requiredValidatorV1<Value, FieldPaths extends string = never>(
  json: ValidatorJsonV1,
): StandardValidatorWithFieldPathsV1<
  Value,
  "required",
  ValidatorJsonV1,
  FieldPaths
> {
  return new StandardValidatorWithFieldPathsV1<
    Value,
    "required",
    ValidatorJsonV1,
    FieldPaths
  >(json, "required");
}

function objectValidatorV1<Fields extends StandardValidatorRecordV1>(
  fields: Fields,
): StandardObjectValidatorV1<Fields> {
  const value: Record<
    string,
    Readonly<{ readonly fieldType: ValidatorJsonV1; readonly optional: boolean }>
  > = Object.create(null);
  for (const [fieldName, field] of Object.entries(fields)) {
    Object.defineProperty(value, fieldName, {
      enumerable: true,
      value: {
        fieldType: field.json,
        optional: field.optionality === "optional",
      },
    });
  }
  return new StandardValidatorWithFieldPathsV1<
    InferStandardObjectV1<Fields>,
    "required",
    ObjectValidatorJsonV1,
    StandardFieldPathsForFieldsV1<Fields>
  >(
    applicationObjectValidatorJson(value),
    "required",
  );
}

function tableDefinitionV1<Fields extends StandardValidatorRecordV1>(
  fields: Fields,
): StandardTableDefinitionV1<Fields> {
  const document = objectValidatorV1(fields);
  return standardTableDefinitionV1(document);
}

function schemaDefinitionV1<Tables extends StandardTableCatalogV1>(
  tables: Tables,
): StandardSchemaDefinitionV1<Tables> {
  return standardSchemaDefinitionV1(tables);
}

function functionContractV1<
  Kind extends CanonicalDeclarativeFunctionKindV1,
  Visibility extends CanonicalDeclarativeFunctionVisibilityV1,
  ArgsValidator extends StandardFunctionArgsValidatorV1,
  ReturnsValidator extends StandardValidatorV1<unknown, "required">,
>(
  input: StandardFunctionContractInputV1<
    Kind,
    Visibility,
    ArgsValidator,
    ReturnsValidator
  >,
): StandardFunctionContractV1<Kind, Visibility, ArgsValidator, ReturnsValidator> {
  return new StandardFunctionContractV1(input);
}

export const standardV1 = Object.freeze({
  null: (): StandardValidatorWithFieldPathsV1<
    null,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationScalarValidatorJson("null")),
  number: (): StandardValidatorWithFieldPathsV1<
    number,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationScalarValidatorJson("number")),
  bigint: (): StandardValidatorWithFieldPathsV1<
    bigint,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationScalarValidatorJson("bigint")),
  boolean: (): StandardValidatorWithFieldPathsV1<
    boolean,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationScalarValidatorJson("boolean")),
  string: (): StandardValidatorWithFieldPathsV1<
    string,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationScalarValidatorJson("string")),
  bytes: (): StandardValidatorWithFieldPathsV1<
    ArrayBuffer,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationScalarValidatorJson("bytes")),
  any: (): StandardValidatorWithFieldPathsV1<
    unknown,
    "required",
    Readonly<{ readonly type: "any" }>,
    string
  > => new StandardValidatorWithFieldPathsV1<
    unknown,
    "required",
    Readonly<{ readonly type: "any" }>,
    string
  >(
    applicationScalarValidatorJson("any"),
    "required",
  ),
  id: <TableName extends string>(
    tableName: TableName,
  ): StandardValidatorWithFieldPathsV1<
    StandardIdV1<TableName>,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationIdValidatorJson(tableName)),
  literal: <Literal extends string | number | boolean>(
    value: Literal,
  ): StandardValidatorWithFieldPathsV1<
    Literal,
    "required",
    ValidatorJsonV1,
    never
  > => {
    return requiredValidatorV1(applicationLiteralValidatorJson(value));
  },
  array: <Value>(
    value: StandardValidatorV1<Value, "required">,
  ): StandardValidatorWithFieldPathsV1<
    ReadonlyArray<Value>,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1(applicationArrayValidatorJson(value.json)),
  object: objectValidatorV1,
  table: tableDefinitionV1,
  schema: schemaDefinitionV1,
  record: <Key, Value>(
    keys: StandardValidatorV1<Key, "required">,
    values: StandardValidatorV1<Value, "required">,
  ): StandardValidatorWithFieldPathsV1<
    Readonly<Record<string, Value>>,
    "required",
    ValidatorJsonV1,
    never
  > =>
    requiredValidatorV1<Readonly<Record<string, Value>>, never>(
      applicationRecordValidatorJson(keys.json, values.json),
    ),
  union: <Members extends readonly [
    StandardValidatorV1<unknown, "required">,
    ...ReadonlyArray<StandardValidatorV1<unknown, "required">>,
  ]>(
    ...members: Members
  ): StandardValidatorWithFieldPathsV1<
    InferStandardValidatorV1<Members[number]>,
    "required",
    ValidatorJsonV1,
    StandardValidatorFieldPathsV1<Members[number]>
  > => {
    const [first, ...rest] = members;
    return requiredValidatorV1<
      InferStandardValidatorV1<Members[number]>,
      StandardValidatorFieldPathsV1<Members[number]>
    >(applicationUnionValidatorJson([
      first.json,
      ...rest.map(member => member.json),
    ]));
  },
  optional: <Validator extends StandardValidatorV1<unknown, "required">>(
    validator: Validator,
  ): StandardValidatorWithFieldPathsV1<
    InferStandardValidatorV1<Validator>,
    "optional",
    ValidatorJsonV1,
    StandardValidatorFieldPathsV1<Validator>
  > =>
    new StandardValidatorWithFieldPathsV1<
      InferStandardValidatorV1<Validator>,
      "optional",
      ValidatorJsonV1,
      StandardValidatorFieldPathsV1<Validator>
    >(validator.json, "optional"),
  nullable: <Validator extends StandardValidatorV1<unknown, "required">>(
    validator: Validator,
  ): StandardValidatorWithFieldPathsV1<
    InferStandardValidatorV1<Validator> | null,
    "required",
    ValidatorJsonV1,
    StandardValidatorFieldPathsV1<Validator>
  > =>
    requiredValidatorV1<
      InferStandardValidatorV1<Validator> | null,
      StandardValidatorFieldPathsV1<Validator>
    >(applicationUnionValidatorJson([
      validator.json,
      applicationScalarValidatorJson("null"),
    ])),
  function: functionContractV1,
  publicQuery: <
    ArgsValidator extends StandardFunctionArgsValidatorV1,
    ReturnsValidator extends StandardValidatorV1<unknown, "required">,
  >(input: Readonly<{ readonly args: ArgsValidator; readonly returns: ReturnsValidator }>) =>
    functionContractV1({ ...input, kind: "query", visibility: "public" }),
  internalQuery: <
    ArgsValidator extends StandardFunctionArgsValidatorV1,
    ReturnsValidator extends StandardValidatorV1<unknown, "required">,
  >(input: Readonly<{ readonly args: ArgsValidator; readonly returns: ReturnsValidator }>) =>
    functionContractV1({ ...input, kind: "query", visibility: "internal" }),
  publicMutation: <
    ArgsValidator extends StandardFunctionArgsValidatorV1,
    ReturnsValidator extends StandardValidatorV1<unknown, "required">,
  >(input: Readonly<{ readonly args: ArgsValidator; readonly returns: ReturnsValidator }>) =>
    functionContractV1({ ...input, kind: "mutation", visibility: "public" }),
  internalMutation: <
    ArgsValidator extends StandardFunctionArgsValidatorV1,
    ReturnsValidator extends StandardValidatorV1<unknown, "required">,
  >(input: Readonly<{ readonly args: ArgsValidator; readonly returns: ReturnsValidator }>) =>
    functionContractV1({ ...input, kind: "mutation", visibility: "internal" }),
  publicWorkflowMutation: <
    ArgsValidator extends StandardFunctionArgsValidatorV1,
    ReturnsValidator extends StandardValidatorV1<unknown, "required">,
  >(input: Readonly<{ readonly args: ArgsValidator; readonly returns: ReturnsValidator }>) =>
    functionContractV1({ ...input, kind: "workflowMutation", visibility: "public" }),
  publicAction: <
    ArgsValidator extends StandardFunctionArgsValidatorV1,
    ReturnsValidator extends StandardValidatorV1<unknown, "required">,
  >(input: Readonly<{ readonly args: ArgsValidator; readonly returns: ReturnsValidator }>) =>
    functionContractV1({ ...input, kind: "action", visibility: "public" }),
  module: <
    ModulePath extends string,
    Functions extends StandardFunctionCatalogV1,
  >(modulePath: ModulePath, functions: Functions): StandardModuleV1<ModulePath, Functions> =>
    new StandardModuleV1(modulePath, functions),
});
