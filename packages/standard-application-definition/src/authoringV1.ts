import type {
  CanonicalDeclarativeFunctionInputV1,
  CanonicalDeclarativeFunctionKindV1,
  CanonicalDeclarativeFunctionVisibilityV1,
  CanonicalDeclarativeModuleInputV1,
} from "@flarex/declarative-program/v1";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

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

function requiredValidatorV1<Value>(
  json: ValidatorJsonV1,
): StandardValidatorV1<Value, "required"> {
  return new StandardValidatorV1(json, "required");
}

function scalarValidatorJsonV1(
  type: Extract<
    ValidatorJsonV1,
    { readonly type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  >["type"],
): ValidatorJsonV1 {
  return Object.freeze({ type });
}

function objectValidatorV1<Fields extends StandardValidatorRecordV1>(
  fields: Fields,
): StandardValidatorV1<
  InferStandardObjectV1<Fields>,
  "required",
  ObjectValidatorJsonV1
> {
  const value: Record<
    string,
    Readonly<{ readonly fieldType: ValidatorJsonV1; readonly optional: boolean }>
  > = Object.create(null) as Record<
    string,
    Readonly<{ readonly fieldType: ValidatorJsonV1; readonly optional: boolean }>
  >;
  for (const [fieldName, field] of Object.entries(fields)) {
    Object.defineProperty(value, fieldName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: Object.freeze({
        fieldType: field.json,
        optional: field.optionality === "optional",
      }),
    });
  }
  Object.freeze(value);
  return new StandardValidatorV1(
    Object.freeze({ type: "object", value }),
    "required",
  );
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
  null: (): StandardValidatorV1<null, "required"> =>
    requiredValidatorV1(scalarValidatorJsonV1("null")),
  number: (): StandardValidatorV1<number, "required"> =>
    requiredValidatorV1(scalarValidatorJsonV1("number")),
  bigint: (): StandardValidatorV1<bigint, "required"> =>
    requiredValidatorV1(scalarValidatorJsonV1("bigint")),
  boolean: (): StandardValidatorV1<boolean, "required"> =>
    requiredValidatorV1(scalarValidatorJsonV1("boolean")),
  string: (): StandardValidatorV1<string, "required"> =>
    requiredValidatorV1(scalarValidatorJsonV1("string")),
  bytes: (): StandardValidatorV1<ArrayBuffer, "required"> =>
    requiredValidatorV1(scalarValidatorJsonV1("bytes")),
  any: (): StandardValidatorV1<
    unknown,
    "required",
    Readonly<{ readonly type: "any" }>
  > => new StandardValidatorV1(Object.freeze({ type: "any" }), "required"),
  id: <TableName extends string>(
    tableName: TableName,
  ): StandardValidatorV1<StandardIdV1<TableName>, "required"> =>
    requiredValidatorV1(Object.freeze({ type: "id", tableName })),
  literal: <Literal extends string | number | boolean>(
    value: Literal,
  ): StandardValidatorV1<Literal, "required"> => {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || Object.is(value, -0))
    ) {
      throw new RangeError(
        "Standard numeric validator literals must be finite and not negative zero.",
      );
    }
    return requiredValidatorV1(Object.freeze({ type: "literal", value }));
  },
  array: <Value>(
    value: StandardValidatorV1<Value, "required">,
  ): StandardValidatorV1<ReadonlyArray<Value>, "required"> =>
    requiredValidatorV1(Object.freeze({ type: "array", value: value.json })),
  object: objectValidatorV1,
  record: <Key, Value>(
    keys: StandardValidatorV1<Key, "required">,
    values: StandardValidatorV1<Value, "required">,
  ): StandardValidatorV1<Readonly<Record<string, Value>>, "required"> =>
    requiredValidatorV1(Object.freeze({
      type: "record",
      keys: keys.json,
      values: values.json,
    })),
  union: <Members extends readonly [
    StandardValidatorV1<unknown, "required">,
    ...ReadonlyArray<StandardValidatorV1<unknown, "required">>,
  ]>(
    ...members: Members
  ): StandardValidatorV1<InferStandardValidatorV1<Members[number]>, "required"> =>
    requiredValidatorV1(Object.freeze({
      type: "union",
      value: Object.freeze(members.map(member => member.json)),
    })),
  optional: <Value>(
    validator: StandardValidatorV1<Value, "required">,
  ): StandardValidatorV1<Value, "optional"> =>
    new StandardValidatorV1(validator.json, "optional"),
  nullable: <Value>(
    validator: StandardValidatorV1<Value, "required">,
  ): StandardValidatorV1<Value | null, "required"> =>
    requiredValidatorV1(Object.freeze({
      type: "union",
      value: Object.freeze([validator.json, scalarValidatorJsonV1("null")]),
    })),
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
