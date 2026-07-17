import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
import {
  decodePartitionCommitPayload,
  decodePartitionConnectionUnregisterPayload,
  decodePartitionSchemaCachePayload,
  decodePartitionSubscriptionRegistrationPayload,
  decodePartitionSubscriptionTargetPayload,
  PartitionRoutePayloadError,
  type PartitionCommitRequest,
  type PartitionConnectionUnregisterRequest,
  type PartitionSchemaCacheRequest,
  type PartitionSubscriptionRegistrationRequest,
  type PartitionSubscriptionTargetRequest,
} from "./Requests";

export {
  PartitionRoutePayloadError,
  type PartitionCommitRequest,
  type PartitionConnectionUnregisterRequest,
  type PartitionSchemaCacheRequest,
  type PartitionSubscriptionRegistrationRequest,
  type PartitionSubscriptionTargetRequest,
} from "./Requests";

export type PartitionRouteError = RequestJsonError | PartitionRoutePayloadError;

export type PartitionDocumentReadRequest = {
  readonly tableId: number;
  readonly id: string;
  readonly at?: number;
};

export type PartitionIndexReadRequest = {
  readonly indexId: number;
  readonly at?: number;
  readonly lower?: string;
  readonly upper?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly order?: "asc" | "desc";
};

export const decodePartitionSchemaCacheRequest = Effect.fn(
  "PartitionRouteBoundary.decodeSchemaCacheRequest",
)(
  (request: Request): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(decodePartitionSchemaCacheRoutePayload),
    ),
);

export const decodePartitionSchemaCacheRoutePayload = Effect.fn(
  "PartitionRouteBoundary.decodeSchemaCachePayload",
)(
  (value: unknown): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> =>
    decodePartitionSchemaCachePayload(value),
);

export const decodePartitionCommitRequest = Effect.fn(
  "PartitionRouteBoundary.decodeCommitRequest",
)(
  (request: Request): Effect.Effect<PartitionCommitRequest, PartitionRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(decodePartitionCommitRoutePayload),
    ),
);

export const decodePartitionCommitRoutePayload = Effect.fn(
  "PartitionRouteBoundary.decodeCommitPayload",
)(
  (value: unknown): Effect.Effect<PartitionCommitRequest, PartitionRoutePayloadError> =>
    decodePartitionCommitPayload(value),
);

export const decodePartitionSubscriptionRegistrationRequest = Effect.fn(
  "PartitionRouteBoundary.decodeSubscriptionRegistrationRequest",
)(
  (request: Request): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(decodePartitionSubscriptionRegistrationRoutePayload),
    ),
);

export const decodePartitionSubscriptionRegistrationRoutePayload = Effect.fn(
  "PartitionRouteBoundary.decodeSubscriptionRegistrationPayload",
)(
  (
    value: unknown,
  ): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> =>
    decodePartitionSubscriptionRegistrationPayload(value),
);

export const decodePartitionSubscriptionTargetRequest = Effect.fn(
  "PartitionRouteBoundary.decodeSubscriptionTargetRequest",
)(
  (request: Request): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(decodePartitionSubscriptionTargetRoutePayload),
    ),
);

export const decodePartitionSubscriptionTargetRoutePayload = Effect.fn(
  "PartitionRouteBoundary.decodeSubscriptionTargetPayload",
)(
  (value: unknown): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> =>
    decodePartitionSubscriptionTargetPayload(value),
);

export const decodePartitionConnectionUnregisterRequest = Effect.fn(
  "PartitionRouteBoundary.decodeConnectionUnregisterRequest",
)(
  (request: Request): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRouteError> =>
    readJsonEffect(request).pipe(
      Effect.flatMap(decodePartitionConnectionUnregisterRoutePayload),
    ),
);

export const decodePartitionConnectionUnregisterRoutePayload = Effect.fn(
  "PartitionRouteBoundary.decodeConnectionUnregisterPayload",
)(
  (
    value: unknown,
  ): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> =>
    decodePartitionConnectionUnregisterPayload(value),
);

export const decodePartitionDocumentReadSearchParams = Effect.fn(
  "PartitionRouteBoundary.decodeDocumentReadSearchParams",
)(function* (
  searchParams: URLSearchParams,
): Effect.fn.Return<PartitionDocumentReadRequest, PartitionRoutePayloadError> {
  const tableId = requiredIntegerSearchParam(searchParams, "tableId", "tableId and id are required.");
  const id = searchParams.get("id");
  if (tableId._tag === "Failure" || !id) {
    return yield* Effect.fail(new PartitionRoutePayloadError({
      message: "tableId and id are required.",
    }));
  }
  const at = optionalIntegerSearchParam(searchParams, "at");
  if (at._tag === "Failure") return yield* Effect.fail(at.error);
  return {
    tableId: tableId.value,
    id,
    ...(at.value === undefined ? {} : { at: at.value }),
  };
});

export const decodePartitionIndexReadSearchParams = Effect.fn(
  "PartitionRouteBoundary.decodeIndexReadSearchParams",
)(function* (
  searchParams: URLSearchParams,
): Effect.fn.Return<PartitionIndexReadRequest, PartitionRoutePayloadError> {
  const indexId = requiredIntegerSearchParam(searchParams, "indexId", "indexId is required.");
  if (indexId._tag === "Failure") return yield* Effect.fail(indexId.error);
  const at = optionalIntegerSearchParam(searchParams, "at");
  if (at._tag === "Failure") return yield* Effect.fail(at.error);
  const limit = optionalIntegerSearchParam(searchParams, "limit");
  if (limit._tag === "Failure") return yield* Effect.fail(limit.error);
  const order = searchParams.get("order") === "desc" ? "desc" : undefined;
  return {
    indexId: indexId.value,
    ...(at.value === undefined ? {} : { at: at.value }),
    ...(searchParams.get("lower") === null ? {} : { lower: searchParams.get("lower")! }),
    ...(searchParams.get("upper") === null ? {} : { upper: searchParams.get("upper")! }),
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(searchParams.get("cursor") === null ? {} : { cursor: searchParams.get("cursor")! }),
    ...(order === undefined ? {} : { order }),
  };
});

type SearchParamIntegerResult =
  | { readonly _tag: "Success"; readonly value: number | undefined }
  | { readonly _tag: "Failure"; readonly error: PartitionRoutePayloadError };

type RequiredSearchParamIntegerResult =
  | { readonly _tag: "Success"; readonly value: number }
  | { readonly _tag: "Failure"; readonly error: PartitionRoutePayloadError };

function requiredIntegerSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
): RequiredSearchParamIntegerResult {
  const value = searchParams.get(name);
  if (value === null || value === "") {
    return { _tag: "Failure", error: new PartitionRoutePayloadError({ message }) };
  }
  const number = Number(value);
  if (Number.isInteger(number)) return { _tag: "Success", value: number };
  return { _tag: "Failure", error: new PartitionRoutePayloadError({ message }) };
}

function optionalIntegerSearchParam(
  searchParams: URLSearchParams,
  name: string,
): SearchParamIntegerResult {
  const value = searchParams.get(name);
  if (value === null) return { _tag: "Success", value: undefined };
  const number = Number(value);
  if (Number.isInteger(number)) return { _tag: "Success", value: number };
  return {
    _tag: "Failure",
    error: new PartitionRoutePayloadError({ message: `${name} must be an integer.` }),
  };
}
