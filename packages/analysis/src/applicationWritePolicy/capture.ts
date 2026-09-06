import { compareUtf16Strings } from "@flarex/utils/strings";
import { Result, Schema } from "effect";
import {
  encodeCanonicalJson,
  measureCanonicalJsonUtf8Bytes,
  type Json,
} from "flarex-protocol/json";

import {
  APPLICATION_WRITE_POLICY_MAXIMUM_BYTES,
  APPLICATION_WRITE_POLICY_MAXIMUM_TABLES,
  ApplicationWritePoliciesSchema,
  ApplicationWritePolicyError,
  type ApplicationWritePolicies,
} from "./model.ts";

const decodePolicies = Schema.decodeUnknownResult(ApplicationWritePoliciesSchema);
const StrictParseOptions = { onExcessProperty: "error" } as const;
const MAXIMUM_DEPTH = 8;
const MAXIMUM_NODES = 20_000;

/** Capture descriptors before Schema can invoke a getter or traverse an alias. */
export function captureApplicationWritePolicyData(
  input: unknown,
): Result.Result<Json, ApplicationWritePolicyError> {
  const ancestors = new Set<object>();
  let nodes = 0;
  let stringUnits = 0;
  function visit(value: unknown, depth: number, path: string): Result.Result<
    Json, ApplicationWritePolicyError
  > {
    nodes += 1;
    if (depth > MAXIMUM_DEPTH || nodes > MAXIMUM_NODES) {
      return Result.fail(failure("limitExceeded", path));
    }
    if (typeof value === "string") {
      stringUnits += value.length;
      return stringUnits <= APPLICATION_WRITE_POLICY_MAXIMUM_BYTES
        ? Result.succeed(value)
        : Result.fail(failure("limitExceeded", path));
    }
    if (value === null || typeof value === "boolean") return Result.succeed(value);
    if (typeof value === "number" && Number.isFinite(value)) return Result.succeed(value);
    if (typeof value !== "object" || value === null || ancestors.has(value)) {
      return Result.fail(failure("invalidInput", path));
    }
    // The catch surrounds only the foreign reflection boundary. Recursion and
    // domain validation remain outside it, preserving implementation defects.
    const inspected = Result.try({
      try: () => ({
        array: Array.isArray(value),
        prototype: Object.getPrototypeOf(value),
        keys: Reflect.ownKeys(value),
      }),
      catch: () => failure("invalidInput", path),
    });
    return Result.gen(function* () {
      const shape = yield* inspected;
      if (
        shape.keys.length > MAXIMUM_NODES - nodes ||
        (shape.array ? shape.prototype !== Array.prototype :
          shape.prototype !== Object.prototype && shape.prototype !== null)
      ) return yield* Result.fail(failure("invalidInput", path));
      const lengthDescriptor = yield* inspectDescriptor(value, "length", path);
      const length: unknown = lengthDescriptor?.value;
      if (shape.array && (
        typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
        shape.keys.length !== length + 1
      )) return yield* Result.fail(failure("invalidInput", path));
      if (shape.array && typeof length === "number" && length > APPLICATION_WRITE_POLICY_MAXIMUM_TABLES) {
        return yield* Result.fail(failure("limitExceeded", path));
      }
      ancestors.add(value);
      const array: Json[] = [];
      const record: Record<string, Json> = {};
      for (const key of shape.keys) {
        if (shape.array && key === "length") continue;
        if (typeof key !== "string") return yield* Result.fail(failure("invalidInput", path));
        const descriptor = yield* inspectDescriptor(value, key, path);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return yield* Result.fail(failure("invalidInput", `${path}.${key}`));
        }
        if (shape.array && key !== String(array.length)) {
          return yield* Result.fail(failure("invalidInput", `${path}.${key}`));
        }
        stringUnits += key.length;
        if (stringUnits > APPLICATION_WRITE_POLICY_MAXIMUM_BYTES) return yield* Result.fail(failure("limitExceeded", path));
        const child = yield* visit(descriptor.value, depth + 1, `${path}.${key}`);
        if (shape.array) array.push(child);
        else Object.defineProperty(record, key, { value: child, enumerable: true });
      }
      ancestors.delete(value);
      return shape.array ? Object.freeze(array) : Object.freeze(record);
    });
  }
  return visit(input, 0, "writePolicies").pipe(Result.flatMap(value => {
    const size = measureCanonicalJsonUtf8Bytes(value, APPLICATION_WRITE_POLICY_MAXIMUM_BYTES);
    return size.kind === "success" ? Result.succeed(value) :
      Result.fail(failure("limitExceeded", "writePolicies"));
  }));
}

function inspectDescriptor(value: object, key: string, path: string): Result.Result<PropertyDescriptor | undefined, ApplicationWritePolicyError> {
  return Result.try({
    try: () => Object.getOwnPropertyDescriptor(value, key),
    catch: () => failure("invalidInput", `${path}.${key}`),
  });
}

export function decodeApplicationWritePolicies(
  input: unknown,
  logicalTableNames: ReadonlyArray<string>,
): Result.Result<ApplicationWritePolicies, ApplicationWritePolicyError> {
  return Result.gen(function* () {
    const captured = yield* captureApplicationWritePolicyData(input);
    const policies = yield* decodePolicies(captured, StrictParseOptions).pipe(
      Result.mapError(() => failure("invalidInput", "writePolicies")),
    );
    yield* validateOrder(policies.tables.map(table => table.logicalTableName), "tables");
    yield* validateOrder(policies.configuration.tables.map(table => table.logicalTableName), "configuration.tables");
    for (const table of policies.configuration.tables) {
      yield* validateOrder(table.fields.map(field => field.name), `configuration.${table.logicalTableName}.fields`);
    }
    const expected = [...logicalTableNames].sort(compareUtf16Strings);
    if (expected.length !== policies.tables.length || expected.some((name, index) =>
      name !== policies.tables[index]?.logicalTableName
    )) return yield* Result.fail(failure("tableCoverageMismatch", "tables"));
    const managed = policies.tables.filter(table => table.owner === "payload");
    if (managed.length !== policies.configuration.tables.length || managed.some((table, index) =>
      table.logicalTableName !== policies.configuration.tables[index]?.logicalTableName
    )) return yield* Result.fail(failure("configurationMismatch", "configuration.tables"));
    // Schema creates a new plain-data value. Capture owns and freezes that
    // result; re-decoding would discard the recursive ownership guarantee.
    return freezePolicies(policies);
  });
}

export function applicationWritePolicyCanonicalText(value: ApplicationWritePolicies): string {
  return encodeCanonicalJson(value, issue => {
    throw new Error(`Application write policy lost canonical data: ${issue.reason}`);
  });
}

function freezePolicies(value: ApplicationWritePolicies): ApplicationWritePolicies {
  return Object.freeze({
    ...value,
    provenance: Object.freeze({ ...value.provenance }),
    configuration: Object.freeze({
      ...value.configuration,
      tables: Object.freeze(value.configuration.tables.map(table => Object.freeze({
        ...table,
        fields: Object.freeze(table.fields.map(field => Object.freeze({ ...field }))),
      }))),
    }),
    tables: Object.freeze(value.tables.map(table => Object.freeze({ ...table }))),
  });
}

function validateOrder(values: ReadonlyArray<string>, path: string): Result.Result<void, ApplicationWritePolicyError> {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || compareUtf16Strings(previous, current) >= 0) {
      return Result.fail(failure("noncanonicalOrder", path));
    }
  }
  return Result.succeed(undefined);
}

function failure(reason: ApplicationWritePolicyError["reason"], path: string): ApplicationWritePolicyError {
  return new ApplicationWritePolicyError({ reason, path });
}
