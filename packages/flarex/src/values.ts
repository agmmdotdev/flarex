import {
  flarexValueToJsonV1,
  jsonToFlarexValueV1,
  type FlarexValue,
} from "flarex-protocol/value";

import type { JSONValue } from "./auth";

export type Id<Table extends string> = string & {
  readonly __tableName: Table;
};

export type OptionalProperty = "optional" | "required";
export type ValidatorJSON =
  | { type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { type: "id"; tableName: string }
  | { type: "literal"; value: string | number | bigint | boolean }
  | { type: "array"; value: ValidatorJSON }
  | { type: "object"; value: Record<string, { fieldType: ValidatorJSON; optional: boolean }> }
  | { type: "record"; keys: ValidatorJSON; values: ValidatorJSON }
  | { type: "union"; value: ValidatorJSON[] };

export class Validator<
  Type,
  IsOptional extends OptionalProperty = "required",
  FieldPaths extends string = never,
> {
  readonly type!: Type;
  readonly fieldPaths!: FieldPaths;
  readonly isFlarexValidator = true;

  constructor(
    readonly kind: string,
    readonly json: ValidatorJSON,
    readonly isOptional: IsOptional,
  ) {}

  asOptional(): Validator<Type | undefined, "optional", FieldPaths> {
    return new Validator(this.kind, this.json, "optional");
  }
}

export type GenericValidator = Validator<any, OptionalProperty, any>;
export type PropertyValidators = Record<string, GenericValidator>;
export type Infer<Value extends GenericValidator> = Value["type"];

type OptionalKeys<Fields extends PropertyValidators> = {
  [Field in keyof Fields]: Fields[Field]["isOptional"] extends "optional" ? Field : never;
}[keyof Fields];

export type ObjectType<Fields extends PropertyValidators> = {
  [Field in OptionalKeys<Fields>]?: Exclude<Infer<Fields[Field]>, undefined>;
} & {
  [Field in Exclude<keyof Fields, OptionalKeys<Fields>>]: Infer<Fields[Field]>;
};

type FieldPaths<Fields extends PropertyValidators> = {
  [Field in keyof Fields & string]:
    | Field
    | (Fields[Field]["fieldPaths"] extends string
        ? `${Field}.${Fields[Field]["fieldPaths"]}`
        : never);
}[keyof Fields & string];

function required<Type, Paths extends string = never>(
  kind: string,
  json: ValidatorJSON,
): Validator<Type, "required", Paths> {
  return new Validator(kind, json, "required");
}

export function isValidator(value: unknown): value is GenericValidator {
  return typeof value === "object" && value !== null && "isFlarexValidator" in value;
}

export function asObjectValidator<Value extends GenericValidator | PropertyValidators>(
  value: Value,
): Value extends GenericValidator ? Value : Validator<ObjectType<Extract<Value, PropertyValidators>>> {
  return (isValidator(value) ? value : v.object(value)) as never;
}

export const v = {
  id: <Table extends string>(tableName: Table) =>
    required<Id<Table>>("id", { type: "id", tableName }),
  null: () => required<null>("null", { type: "null" }),
  number: () => required<number>("number", { type: "number" }),
  float64: () => required<number>("float64", { type: "number" }),
  bigint: () => required<bigint>("int64", { type: "bigint" }),
  int64: () => required<bigint>("int64", { type: "bigint" }),
  boolean: () => required<boolean>("boolean", { type: "boolean" }),
  string: () => required<string>("string", { type: "string" }),
  bytes: () => required<ArrayBuffer>("bytes", { type: "bytes" }),
  any: () => required<any, string>("any", { type: "any" }),
  literal: <Value extends string | number | bigint | boolean>(value: Value) =>
    required<Value>("literal", { type: "literal", value }),
  array: <Element extends Validator<any, "required", any>>(element: Element) =>
    required<Array<Infer<Element>>>("array", { type: "array", value: element.json }),
  object: <Fields extends PropertyValidators>(fields: Fields) =>
    required<ObjectType<Fields>, FieldPaths<Fields>>("object", {
      type: "object",
      value: Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [
          name,
          { fieldType: field.json, optional: field.isOptional === "optional" },
        ]),
      ),
    }),
  record: <
    Key extends Validator<string, "required", any>,
    Value extends Validator<any, "required", any>,
  >(
    keys: Key,
    values: Value,
  ) =>
    required<Record<Infer<Key>, Infer<Value>>, string>("record", {
      type: "record",
      keys: keys.json,
      values: values.json,
    }),
  union: <Members extends Array<Validator<any, "required", any>>>(...members: Members) =>
    required<Infer<Members[number]>, Members[number]["fieldPaths"]>("union", {
      type: "union",
      value: members.map(member => member.json),
    }),
  optional: <Value extends GenericValidator>(value: Value) => value.asOptional(),
  nullable: <Value extends Validator<any, "required", any>>(value: Value) =>
    required<Infer<Value> | null>("union", {
      type: "union",
      value: [value.json, { type: "null" }],
    }),
};

export {
  functionArgsToValidatorJson,
  validateFunctionArgs,
  validateValue,
  validatorToJson,
  ValidationError,
} from "./validation";

export type Value = FlarexValue;

/**
 * A declared application failure that callers may handle as ordinary function
 * output failure. Exact Flarex runtimes replace this authoring constructor with
 * an isolate-local constructor backed by an unforgeable provenance registry.
 */
export class FlarexError<Data extends Value = Value> extends Error {
  readonly code: string;
  declare readonly data?: Data;

  constructor(code: string, message: string, data?: Data) {
    super(message);
    Object.defineProperty(this, "name", { value: "FlarexError" });
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export function flarexToJson(value: Value): JSONValue {
  return flarexValueToJsonV1(value, "generalValue");
}

export function jsonToFlarex(value: JSONValue): Value {
  return jsonToFlarexValueV1(value, "generalValue");
}
