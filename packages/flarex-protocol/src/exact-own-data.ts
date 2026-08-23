import { Result } from "effect";

export type ExactOwnDataIssue =
  | Readonly<{
      readonly reason: "invalidOwnData";
      readonly path: string;
      readonly cause?: unknown;
    }>
  | Readonly<{
      readonly reason: "maximumLengthExceeded";
      readonly path: string;
      readonly observed: number;
      readonly maximum: number;
    }>;

export interface InspectedOwnDataRecord {
  readonly properties: ReadonlyMap<string, unknown>;
  readonly ancestors: ReadonlySet<object>;
}

export interface InspectedOwnDataArray {
  readonly values: ReadonlyArray<unknown>;
  readonly ancestors: ReadonlySet<object>;
}

const NO_ANCESTORS: ReadonlySet<object> = new Set<object>();

declare const INSPECTED_OWN_DATA_OBJECT: unique symbol;
interface InspectedOwnDataObject {
  readonly [INSPECTED_OWN_DATA_OBJECT]?: never;
}

/**
 * Captures enumerable own data properties without invoking caller code.
 * Exact domain key policy remains with the caller.
 */
export function inspectOwnDataRecord(
  input: unknown,
  path: string,
  ancestors: ReadonlySet<object> = NO_ANCESTORS,
): Result.Result<InspectedOwnDataRecord, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const value = yield* inspectObjectKind(input, false, path, ancestors);
    const keys = yield* ownKeys(value, path);
    const properties = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== "string") {
        return yield* Result.fail(issue(path));
      }
      const descriptor = yield* ownPropertyDescriptor(value, key, path);
      if (
        descriptor === undefined || !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return yield* Result.fail(issue(`${path}.${key}`));
      }
      properties.set(key, descriptor.value);
    }
    return Object.freeze({
      properties,
      ancestors: withAncestor(ancestors, value),
    });
  });
}

/**
 * Captures a dense exact array. Extra string or symbol properties, accessors,
 * holes, cycles, and reflection traps are rejected before member traversal.
 */
export function inspectOwnDataArray(
  input: unknown,
  path: string,
  options: Readonly<{
    readonly exactLength?: number;
    readonly maximumLength?: number;
  }> = {},
  ancestors: ReadonlySet<object> = NO_ANCESTORS,
): Result.Result<InspectedOwnDataArray, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const value = yield* inspectObjectKind(input, true, path, ancestors);
    const lengthDescriptor = yield* ownPropertyDescriptor(
      value,
      "length",
      `${path}.length`,
    );
    if (
      lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      lengthDescriptor.enumerable !== false ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return yield* Result.fail(issue(`${path}.length`));
    }
    const length = lengthDescriptor.value;
    if (options.exactLength !== undefined && length !== options.exactLength) {
      return yield* Result.fail(issue(path));
    }
    if (
      options.maximumLength !== undefined && length > options.maximumLength
    ) {
      return yield* Result.fail(Object.freeze({
        reason: "maximumLengthExceeded",
        path,
        observed: length,
        maximum: options.maximumLength,
      }));
    }

    const keys = yield* ownKeys(value, path);
    if (keys.length !== length + 1) {
      return yield* Result.fail(issue(path));
    }
    for (const key of keys) {
      if (key === "length") continue;
      if (
        typeof key !== "string" || !isCanonicalArrayIndex(key, length)
      ) {
        return yield* Result.fail(issue(path));
      }
    }

    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const memberPath = `${path}[${index}]`;
      const descriptor = yield* ownPropertyDescriptor(
        value,
        String(index),
        memberPath,
      );
      if (
        descriptor === undefined || !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return yield* Result.fail(issue(memberPath));
      }
      values.push(descriptor.value);
    }
    return Object.freeze({
      values: Object.freeze(values),
      ancestors: withAncestor(ancestors, value),
    });
  });
}

export function hasExactOwnDataKeys(
  properties: ReadonlyMap<string, unknown>,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  return properties.size === expectedKeys.length &&
    expectedKeys.every(key => properties.has(key));
}

export function exactOwnDataIssue(
  path: string,
  cause?: unknown,
): ExactOwnDataIssue {
  return Object.freeze({
    reason: "invalidOwnData",
    path,
    ...(cause === undefined ? {} : { cause }),
  });
}

function inspectObjectKind(
  input: unknown,
  expectedArray: boolean,
  path: string,
  ancestors: ReadonlySet<object>,
): Result.Result<InspectedOwnDataObject, ExactOwnDataIssue> {
  return Result.gen(function* () {
    if (input === null || typeof input !== "object") {
      return yield* Result.fail(issue(path));
    }
    const arrayVerdict = yield* isArray(input, path);
    if (arrayVerdict !== expectedArray || ancestors.has(input)) {
      return yield* Result.fail(issue(path));
    }
    return input;
  });
}

function isArray(
  value: InspectedOwnDataObject,
  path: string,
): Result.Result<boolean, ExactOwnDataIssue> {
  try {
    return Result.succeed(Array.isArray(value));
  } catch (cause) {
    return Result.fail(issue(path, cause));
  }
}

function ownKeys(
  value: InspectedOwnDataObject,
  path: string,
): Result.Result<ReadonlyArray<PropertyKey>, ExactOwnDataIssue> {
  try {
    return Result.succeed(Reflect.ownKeys(value));
  } catch (cause) {
    return Result.fail(issue(path, cause));
  }
}

function ownPropertyDescriptor(
  value: InspectedOwnDataObject,
  key: PropertyKey,
  path: string,
): Result.Result<PropertyDescriptor | undefined, ExactOwnDataIssue> {
  try {
    return Result.succeed(Object.getOwnPropertyDescriptor(value, key));
  } catch (cause) {
    return Result.fail(issue(path, cause));
  }
}

function withAncestor(
  ancestors: ReadonlySet<object>,
  value: InspectedOwnDataObject,
): ReadonlySet<object> {
  const next = new Set(ancestors);
  next.add(value);
  return next;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length &&
    String(index) === key;
}

function issue(path: string, cause?: unknown): ExactOwnDataIssue {
  return exactOwnDataIssue(path, cause);
}
