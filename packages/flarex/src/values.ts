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
import {
  flarexValueToJsonV1,
  jsonToFlarexValueV1,
  type FlarexValue,
} from "flarex-protocol/value";
import {
  decodeValidatorJsonV1,
  type ValidatorJsonV1,
} from "flarex-protocol/validator-json";

import type { JSONValue } from "./auth";
import {
  captureOwnedValidator,
  isOwnedValidator,
} from "./validatorOwnership";

const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_ENTRIES = Object.entries;
const OBJECT_FREEZE = Object.freeze;
const OWNED_VALIDATOR_JSON = Symbol("flarex.owned-validator-json");

export type Id<Table extends string> = string & {
  readonly __tableName: Table;
};

export type OptionalProperty = "optional" | "required";
export type ValidatorJSON = ValidatorJsonV1;

export class Validator<
  Type,
  IsOptional extends OptionalProperty = "required",
  FieldPaths extends string = never,
> {
  readonly type!: Type;
  readonly fieldPaths!: FieldPaths;
  readonly isFlarexValidator = true;
  readonly kind: string;
  readonly json: ValidatorJSON;
  readonly isOptional: IsOptional;

  constructor(kind: string, json: ValidatorJSON, isOptional: IsOptional);
  constructor(
    kind: string,
    json: ValidatorJSON,
    isOptional: IsOptional,
    ownership: typeof OWNED_VALIDATOR_JSON,
  );
  constructor(
    kind: string,
    json: ValidatorJSON,
    isOptional: IsOptional,
    ownership?: typeof OWNED_VALIDATOR_JSON,
  ) {
    this.kind = kind;
    this.json = ownership === OWNED_VALIDATOR_JSON
      ? json
      : snapshotApplicationValidatorJson(decodeValidatorJsonV1(json));
    this.isOptional = isOptional;
    OBJECT_FREEZE(this);
    captureOwnedValidator(this);
  }

  asOptional(): Validator<Type | undefined, "optional", FieldPaths> {
    return new Validator(
      this.kind,
      validatorJsonForComposition(this),
      "optional",
      OWNED_VALIDATOR_JSON,
    );
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
  return new Validator(kind, json, "required", OWNED_VALIDATOR_JSON);
}

function validatorJsonForComposition(
  validator: GenericValidator,
): ValidatorJSON {
  if (isOwnedValidator(validator)) return validator.json;
  return snapshotApplicationValidatorJson(
    decodeValidatorJsonV1(validator.json),
  );
}

export function isValidator(value: unknown): value is GenericValidator {
  return typeof value === "object"
    && value !== null
    && "isFlarexValidator" in value
    && value.isFlarexValidator === true;
}

export function asObjectValidator<Value extends GenericValidator | PropertyValidators>(
  value: Value,
): Value extends GenericValidator ? Value : Validator<ObjectType<Extract<Value, PropertyValidators>>> {
  return (isValidator(value) ? value : v.object(value)) as never;
}

export const v = {
  id: <Table extends string>(tableName: Table) =>
    required<Id<Table>>("id", applicationIdValidatorJson(tableName)),
  null: () => required<null>("null", applicationScalarValidatorJson("null")),
  number: () =>
    required<number>("number", applicationScalarValidatorJson("number")),
  float64: () =>
    required<number>("float64", applicationScalarValidatorJson("number")),
  bigint: () =>
    required<bigint>("int64", applicationScalarValidatorJson("bigint")),
  int64: () =>
    required<bigint>("int64", applicationScalarValidatorJson("bigint")),
  boolean: () =>
    required<boolean>("boolean", applicationScalarValidatorJson("boolean")),
  string: () =>
    required<string>("string", applicationScalarValidatorJson("string")),
  bytes: () =>
    required<ArrayBuffer>("bytes", applicationScalarValidatorJson("bytes")),
  any: () =>
    required<FlarexValue, string>("any", applicationScalarValidatorJson("any")),
  literal: <Value extends string | number | boolean>(value: Value) =>
    required<Value>("literal", applicationLiteralValidatorJson(value)),
  array: <Element extends Validator<any, "required", any>>(element: Element) =>
    required<Array<Infer<Element>>>(
      "array",
      applicationArrayValidatorJson(validatorJsonForComposition(element)),
    ),
  object: <Fields extends PropertyValidators>(fields: Fields) => {
    const entries: Record<
      string,
      Readonly<{ readonly fieldType: ValidatorJSON; readonly optional: boolean }>
    > = OBJECT_CREATE(null);
    const fieldEntries = OBJECT_ENTRIES(fields);
    for (let index = 0; index < fieldEntries.length; index += 1) {
      const fieldEntry = fieldEntries[index]!;
      const name = fieldEntry[0];
      const field = fieldEntry[1];
      const fieldType = validatorJsonForComposition(field);
      OBJECT_DEFINE_PROPERTY(entries, name, {
        enumerable: true,
        value: {
          fieldType,
          optional: field.isOptional === "optional",
        },
      });
    }
    return required<ObjectType<Fields>, FieldPaths<Fields>>(
      "object",
      applicationObjectValidatorJson(entries),
    );
  },
  record: <
    Key extends Validator<string, "required", any>,
    Value extends Validator<any, "required", any>,
  >(
    keys: Key,
    values: Value,
  ) =>
    required<Record<Infer<Key>, Infer<Value>>, string>(
      "record",
      applicationRecordValidatorJson(
        validatorJsonForComposition(keys),
        validatorJsonForComposition(values),
      ),
    ),
  union: <Members extends readonly [
    Validator<any, "required", any>,
    ...ReadonlyArray<Validator<any, "required", any>>,
  ]>(...members: Members) => {
    const first = members[0]!;
    const memberJson: [ValidatorJSON, ...ValidatorJSON[]] = [
      validatorJsonForComposition(first),
    ];
    for (let index = 1; index < members.length; index += 1) {
      OBJECT_DEFINE_PROPERTY(memberJson, index, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: validatorJsonForComposition(members[index]!),
      });
    }
    return required<
      Infer<Members[number]>,
      Members[number]["fieldPaths"]
    >("union", applicationUnionValidatorJson(memberJson));
  },
  optional: <Value extends GenericValidator>(value: Value) =>
    new Validator<Infer<Value> | undefined, "optional", Value["fieldPaths"]>(
      value.kind,
      validatorJsonForComposition(value),
      "optional",
      OWNED_VALIDATOR_JSON,
    ),
  nullable: <Value extends Validator<any, "required", any>>(value: Value) =>
    required<Infer<Value> | null>("union", applicationUnionValidatorJson([
      validatorJsonForComposition(value),
      applicationScalarValidatorJson("null"),
    ])),
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
    OBJECT_DEFINE_PROPERTY(this, "name", { value: "FlarexError" });
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
