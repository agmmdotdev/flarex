import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_ENTRIES = Object.entries;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_HAS_OWN = Object.hasOwn;
const REFLECT_APPLY = Reflect.apply;
const WEAK_MAP = WeakMap;
const WEAK_SET = WeakSet;
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_SET_HAS = WeakSet.prototype.has;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_DELETE = WeakSet.prototype.delete;
const GENERATOR_NEXT = Object.getPrototypeOf(function* () {}).prototype.next;
const RANGE_ERROR = RangeError;

export type ApplicationValidatorScalarType = Extract<
  ValidatorJsonV1,
  Readonly<{
    readonly type:
      | "null"
      | "number"
      | "bigint"
      | "commitTs"
      | "boolean"
      | "string"
      | "bytes"
      | "any";
  }>
>["type"];

export interface ApplicationValidatorObjectFieldInput {
  readonly fieldType: ValidatorJsonV1;
  readonly optional: boolean;
}

export function applicationScalarValidatorJson<
  Type extends ApplicationValidatorScalarType,
>(type: Type): Readonly<{ readonly type: Type }> {
  return OBJECT_FREEZE({ type });
}

export function applicationIdValidatorJson(
  tableName: string,
): ValidatorJsonV1 {
  if (typeof tableName !== "string") {
    throw new RANGE_ERROR(
      "Application ID validator table names must be strings.",
    );
  }
  return OBJECT_FREEZE({ type: "id", tableName });
}

export function applicationLiteralValidatorJson<
  Literal extends string | number | bigint | boolean,
>(value: Literal): Readonly<{ readonly type: "literal"; readonly value: Literal }> {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    typeof value !== "boolean"
  ) {
    throw new RANGE_ERROR(
      "Application validator literals must be strings, numbers, bigints, or booleans.",
    );
  }
  return OBJECT_FREEZE({ type: "literal", value });
}

export function applicationArrayValidatorJson(
  value: ValidatorJsonV1,
): ValidatorJsonV1 {
  return snapshotApplicationValidatorJson({ type: "array", value });
}

export function applicationObjectValidatorJson(
  fields: Readonly<Record<string, ApplicationValidatorObjectFieldInput>>,
): ObjectValidatorJsonV1 {
  const value: Record<
    string,
    Readonly<{
      readonly fieldType: ValidatorJsonV1;
      readonly optional: boolean;
    }>
  > = OBJECT_CREATE(null);
  const entries = OBJECT_ENTRIES(fields);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const fieldName = entry[0];
    const field = entry[1];
    OBJECT_DEFINE_PROPERTY(value, fieldName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: OBJECT_FREEZE({
        fieldType: field.fieldType,
        optional: field.optional,
      }),
    });
  }
  OBJECT_FREEZE(value);
  const snapshot = snapshotApplicationValidatorJson({ type: "object", value });
  if (snapshot.type !== "object") throw new TypeError("Application object validator snapshot changed its type.");
  return snapshot;
}

export function applicationRecordValidatorJson(
  keys: ValidatorJsonV1,
  values: ValidatorJsonV1,
): ValidatorJsonV1 {
  return snapshotApplicationValidatorJson({ type: "record", keys, values });
}

export function applicationUnionValidatorJson(
  members: ReadonlyArray<ValidatorJsonV1>,
): ValidatorJsonV1 {
  return snapshotApplicationValidatorJson({ type: "union", value: members });
}

/** SDK construction owns declarations without applying backend semantic admission. */
export function snapshotApplicationValidatorJson(root: ValidatorJsonV1): ValidatorJsonV1 {
  const memo = new WEAK_MAP<object, ValidatorJsonV1>();
  const active = new WEAK_SET<object>();
  function* project(node: ValidatorJsonV1): Generator<ValidatorJsonV1, ValidatorJsonV1, ValidatorJsonV1> {
    switch (node.type) {
      case "null": case "number": case "bigint": case "commitTs": case "boolean": case "string": case "bytes": case "any":
        return applicationScalarValidatorJson(node.type);
      case "id": return applicationIdValidatorJson(node.tableName);
      case "literal": return applicationLiteralValidatorJson(node.value);
      case "array": return OBJECT_FREEZE({ type: "array", value: yield node.value });
      case "record": return OBJECT_FREEZE({ type: "record", keys: yield node.keys, values: yield node.values });
      case "function": {
        const args = node.args === undefined ? undefined : yield node.args;
        const returns = node.returns === undefined ? undefined : yield node.returns;
        return OBJECT_FREEZE({ type: "function", ...(node.fnType === undefined ? {} : { fnType: node.fnType }), ...(args === undefined ? {} : { args }), ...(returns === undefined ? {} : { returns }) });
      }
      case "union": {
        const values: ValidatorJsonV1[] = [];
        OBJECT_DEFINE_PROPERTY(values, "length", { value: node.value.length });
        for (let index = 0; index < node.value.length; index += 1) {
          if (OBJECT_HAS_OWN(node.value, index)) OBJECT_DEFINE_PROPERTY(values, index, { value: yield node.value[index]!, enumerable: true, configurable: true, writable: true });
        }
        return OBJECT_FREEZE({ type: "union", value: OBJECT_FREEZE(values) });
      }
      case "object": {
        const fields: Record<string, ApplicationValidatorObjectFieldInput> = OBJECT_CREATE(null);
        const entries = OBJECT_ENTRIES(node.value);
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]!;
          const fieldType = yield entry[1].fieldType;
          OBJECT_DEFINE_PROPERTY(fields, entry[0], { enumerable: true, value: OBJECT_FREEZE({ fieldType, optional: entry[1].optional }) });
        }
        return OBJECT_FREEZE({ type: "object", value: OBJECT_FREEZE(fields) });
      }
    }
  }
  const stack: { readonly node: ValidatorJsonV1; readonly work: Generator<ValidatorJsonV1, ValidatorJsonV1, ValidatorJsonV1> }[] = [];
  function push(node: ValidatorJsonV1): ValidatorJsonV1 | undefined {
    const previous: ValidatorJsonV1 | undefined = REFLECT_APPLY(WEAK_MAP_GET, memo, [node]);
    if (previous !== undefined) return previous;
    if (REFLECT_APPLY(WEAK_SET_HAS, active, [node])) throw new TypeError("Application validator declarations must not contain cycles.");
    REFLECT_APPLY(WEAK_SET_ADD, active, [node]);
    OBJECT_DEFINE_PROPERTY(stack, stack.length, { value: { node, work: project(node) }, configurable: true, writable: true });
  }
  let completed: ValidatorJsonV1 = { type: "any" };
  push(root);
  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const step: IteratorResult<ValidatorJsonV1, ValidatorJsonV1> = REFLECT_APPLY(GENERATOR_NEXT, current.work, [completed]);
    if (step.done) {
      completed = step.value; stack.length -= 1;
      REFLECT_APPLY(WEAK_SET_DELETE, active, [current.node]);
      REFLECT_APPLY(WEAK_MAP_SET, memo, [current.node, completed]);
    } else {
      const previous = push(step.value);
      if (previous !== undefined) completed = previous;
    }
  }
  return completed;
}

export function applicationFunctionValidatorJson(signature: Readonly<{
  readonly fnType?: "query" | "mutation" | "action";
  readonly args?: ValidatorJsonV1;
  readonly returns?: ValidatorJsonV1;
}> = {}): ValidatorJsonV1 {
  return snapshotApplicationValidatorJson({ type: "function", ...signature });
}
