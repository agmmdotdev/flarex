import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { Effect } from "effect";

import { normalizeDateString } from "./dateStringNormalization";

export interface ResponsePayloadDecoders<Operation, Failure> {
  readonly fail: <A = never>(
    operation: Operation,
    message: string,
  ) => Effect.Effect<A, Failure>;
  readonly record: (
    value: unknown,
    operation: Operation,
    message: string,
  ) => Effect.Effect<UnknownRecord, Failure>;
  readonly array: (
    value: unknown,
    operation: Operation,
    message: string,
  ) => Effect.Effect<unknown[], Failure>;
  readonly nonEmptyString: (
    value: unknown,
    field: string,
    operation: Operation,
  ) => Effect.Effect<string, Failure>;
  readonly isoDateString: (
    value: unknown,
    field: string,
    operation: Operation,
  ) => Effect.Effect<string, Failure>;
  readonly nonNegativeInteger: (
    value: unknown,
    field: string,
    operation: Operation,
  ) => Effect.Effect<number, Failure>;
  readonly boolean: (
    value: unknown,
    field: string,
    operation: Operation,
  ) => Effect.Effect<boolean, Failure>;
}

export function createResponsePayloadDecoders<Operation, Failure>(
  makeFailure: (operation: Operation, message: string) => Failure,
): ResponsePayloadDecoders<Operation, Failure> {
  const fail = <A = never>(
    operation: Operation,
    message: string,
  ): Effect.Effect<A, Failure> => Effect.fail(makeFailure(operation, message));

  const nonEmptyString = (
    value: unknown,
    field: string,
    operation: Operation,
  ): Effect.Effect<string, Failure> =>
    typeof value === "string" && value.length > 0
      ? Effect.succeed(value)
      : fail(operation, `${field} must be a non-empty string.`);

  const isoDateString: ResponsePayloadDecoders<
    Operation,
    Failure
  >["isoDateString"] = Effect.fn(function* (value, field, operation) {
    const text = yield* nonEmptyString(value, field, operation);
    const normalized = normalizeDateString(text);
    if (normalized !== undefined) return normalized;
    return yield* fail(
      operation,
      `${field} must be an ISO date string.`,
    );
  });

  return Object.freeze({
    fail,
    record: (
      value: unknown,
      operation: Operation,
      message: string,
    ): Effect.Effect<UnknownRecord, Failure> =>
      isNonArrayRecord(value)
        ? Effect.succeed(value)
        : fail(operation, message),
    array: (
      value: unknown,
      operation: Operation,
      message: string,
    ): Effect.Effect<unknown[], Failure> =>
      Array.isArray(value) ? Effect.succeed(value) : fail(operation, message),
    nonEmptyString,
    isoDateString,
    nonNegativeInteger: (
      value: unknown,
      field: string,
      operation: Operation,
    ): Effect.Effect<number, Failure> =>
      typeof value === "number" && Number.isInteger(value) && value >= 0
        ? Effect.succeed(value)
        : fail(operation, `${field} must be a non-negative integer.`),
    boolean: (
      value: unknown,
      field: string,
      operation: Operation,
    ): Effect.Effect<boolean, Failure> =>
      typeof value === "boolean"
        ? Effect.succeed(value)
        : fail(operation, `${field} must be a boolean.`),
  });
}
